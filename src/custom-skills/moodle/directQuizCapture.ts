import type { AgentBrowserClient } from "./interactive/agentBrowserClient.js";
import type { QuizPageExtraction, QuizQuestion } from "./interactive/nodes/quizReviewNode.js";

export interface QuizInventory {
  confirmed: boolean;
  questions: Array<{ key: string; slot: string | null; number: number; page: number }>;
  pages: number[];
  contextSlots?: Array<{ slot: string; page: number }>;
}

/** Only native quiz navigation supplies the expected question set; page text is not a total. */
export async function inspectDirectQuizInventory(
  client: AgentBrowserClient,
  page: QuizPageExtraction,
  navigation: "single-page" | "free" | "unknown",
): Promise<QuizInventory> {
  const entries: Array<{
    slot: string | null;
    number: number;
    page: number;
    information?: boolean;
  }> =
    typeof client.evalJson === "function"
      ? await client.evalJson<
          Array<{ slot: string | null; number: number; page: number; information?: boolean }>
        >(`JSON.stringify((() => {
      const here = new URL(location.href);
      return Array.from(document.querySelectorAll('.qnbutton')).map(button => {
        let page = Number(button.getAttribute('data-quiz-page'));
        if (!button.hasAttribute('data-quiz-page')) {
          try {
            const link = new URL(button.getAttribute('href'), location.href);
            if (link.origin !== here.origin || link.pathname !== here.pathname || link.searchParams.get('attempt') !== here.searchParams.get('attempt')) return null;
            page = Number(link.searchParams.get('page') || 0);
          } catch { return null; }
        }
        const slot = button.getAttribute('data-quiz-slot') || /^quiznavbutton(\\d+)$/.exec(button.id)?.[1] || null;
        const label = button.cloneNode(true);
        label.querySelectorAll('.accesshide, .sr-only, .visually-hidden, .flagstate').forEach(node => node.remove());
        const visible = (label.textContent || '').trim();
        const information = !!slot && (Array.from(document.querySelectorAll('.que.description')).some(node => node.id.endsWith('-' + slot)) || /^Information\\s*$/i.test(button.querySelector('.accesshide, .sr-only, .visually-hidden')?.textContent?.trim() || ''));
        const number = information ? 0 : Number(visible.match(/^\\d+/)?.[0]);
        return { slot, number, page, information };
      });
    })())`)
      : navigation === "single-page"
        ? page.questions.map((question) => ({
            slot: questionSlot(question),
            number: question.question_index,
            page: pageNumber(page.url),
          }))
        : [];
  const valid =
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.every(
      (entry) =>
        entry &&
        Number.isSafeInteger(entry.number) &&
        (entry.information ? !!entry.slot : entry.number > 0) &&
        Number.isSafeInteger(entry.page) &&
        entry.page >= 0 &&
        (entry.slot === null || /^\d+$/.test(entry.slot)),
    );
  if (!valid) return { confirmed: false, questions: [], pages: [] };
  const questions = entries
    .filter((entry) => !entry.information)
    .map(({ information: _information, ...entry }) => ({
      ...entry,
      key: entry.slot ? `slot:${entry.slot}` : `number:${entry.number}`,
    }));
  if (new Set(questions.map((question) => question.key)).size !== questions.length)
    return { confirmed: false, questions: [], pages: [] };
  return {
    confirmed: true,
    questions,
    pages: [...new Set(entries.map((question) => question.page))].sort((a, b) => a - b),
    contextSlots: entries
      .filter((entry) => entry.information)
      .map((entry) => ({ slot: entry.slot!, page: entry.page })),
  };
}

export function questionSlot(question: QuizQuestion): string | null {
  return /^question-[^-]+-(\d+)$/.exec(question.question_id)?.[1] ?? null;
}
export function pageNumber(url: string): number {
  return Number(new URL(url).searchParams.get("page") ?? 0);
}

/** Normalize editable response state in a DOM clone, never by rewriting source mathematics. */
export type DirectQuizPage = QuizPageExtraction & { descriptions?: QuizQuestion[] };
export async function canonicalDirectQuizPage(
  client: AgentBrowserClient,
  page: QuizPageExtraction,
): Promise<DirectQuizPage> {
  if (typeof client.evalJson !== "function") return page;
  const canonical = await client.evalJson<{
    shared: string;
    questions: Array<{
      id: string;
      html: string;
      prompt: string;
      context: string;
      latex: string;
      controls: Array<{ id: string; optionText: string; latex: string }>;
    }>;
  }>(`JSON.stringify((() => {
    const slash = String.fromCharCode(92);
    const mathSource = copy => {
      const scripts = Array.from(copy.querySelectorAll('script[type^="math/tex"]'));
      for (const math of copy.querySelectorAll('mjx-container, math, .MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_CHTML')) {
        if (!copy.contains(math)) continue;
        const id = math.id || math.querySelector('[id$="-Frame"]')?.id || '';
        const sibling = math.nextElementSibling;
        const source = scripts.find(script => script.id && id === script.id + '-Frame') ||
          (sibling?.matches('script[type^="math/tex"]') ? sibling : null);
        if (source) { math.remove(); continue; }
        const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        if (tex) {
          const display = math.getAttribute('display') === 'block' || math.getAttribute('display') === 'true';
          math.replaceWith(copy.ownerDocument.createTextNode(slash + (display ? '[' : '(') + tex + slash + (display ? ']' : ')')));
        }
      }
      for (const script of scripts) {
        const display = (script.getAttribute('type') || '').includes('mode=display');
        script.replaceWith(copy.ownerDocument.createTextNode(slash + (display ? '[' : '(') + script.textContent + slash + (display ? ']' : ')')));
      }
      copy.querySelectorAll('script, style, .MathJax_Preview, .MJX_Assistive_MathML, mjx-assistive-mml').forEach(item => item.remove());
      return copy;
    };
    const text = node => (mathSource(node.cloneNode(true)).textContent || '').replace(/\\s+/g, ' ').trim();
    const latex = node => {
      if (!node) return '';
      const plain = text(node);
      const bits = [];
      for (const [open, close] of [['(', ')'], ['[', ']']]) {
        let offset = 0;
        while (offset < plain.length) {
          const start = plain.indexOf(slash + open, offset);
          if (start < 0) break;
          const end = plain.indexOf(slash + close, start + 2);
          if (end < 0) break;
          bits.push(plain.slice(start + 2, end));
          offset = end + 2;
        }
      }
      for (const image of node.querySelectorAll('img[alt], img[title]')) bits.push(image.getAttribute('alt') || image.getAttribute('title') || '');
      return [...new Set(bits)].filter(Boolean).join(' ');
    };
    const questions = Array.from(document.querySelectorAll('.que, [id^="question-"]')).map(node => {
      const copy = node.cloneNode(true);
      // Moodle Cloze has no .qtext wrapper. Answer status, flags and hidden
      // sequence/session fields are transport state, not question content.
      copy.querySelectorAll('.info, .questionflag, input[type="hidden"]').forEach(item => item.remove());
      // YUI stamps nodes lazily during focus/typesetting; these generated IDs
      // identify a browser instance, while editable control IDs remain bound.
      for (const element of copy.querySelectorAll('[id]')) {
        if (!element.matches('input, textarea, select') && /^yui_(?:[0-9]+_)+[0-9]+$/.test(element.id)) element.removeAttribute('id');
      }
      if (node.classList.contains('ddimageortext')) {
        // Drop positions/choices remain bound through the public response model
        // and original media. Moving pieces and reusable clones are responses.
        copy.querySelectorAll('.dropzones, .draghomes, .dropzone, .draghome').forEach(item => item.remove());
      }
      // Playwright's caret/screenshot restoration can leave an inert style="" attribute.
      for (const element of copy.querySelectorAll('[style]')) if (!(element.getAttribute('style') || '').trim()) element.removeAttribute('style');
      for (const control of copy.querySelectorAll('input, textarea, select')) {
        if (control.disabled || control.readOnly || control.type === 'hidden' || ['submit', 'button'].includes(control.type)) continue;
        if (['text', 'number'].includes(control.type) || control.tagName === 'TEXTAREA') control.removeAttribute('value');
        control.removeAttribute('checked');
        control.removeAttribute('data-initial-value');
        if (control.tagName === 'TEXTAREA') control.textContent = '';
        if (control.tagName === 'SELECT') control.querySelectorAll('option').forEach(option => option.removeAttribute('selected'));
      }
      mathSource(copy);
      const prompt = copy.querySelector('.qtext, .formulation') || copy;
      const controls = Array.from(copy.querySelectorAll('input, textarea, select')).map(control => {
        const label = Array.from(copy.querySelectorAll('label')).find(label => label.getAttribute('for') === control.id) || control.closest('label');
        const container = label || control.closest('label, .r0, .r1, .answer div, p, li');
        return { id: control.id, optionText: container ? text(container) : '', latex: latex(container || control) };
      });
      return { id: node.id, html: prompt.innerHTML, prompt: text(prompt), context: text(copy), latex: latex(prompt), controls };
    });
    const shared = mathSource(document.body.cloneNode(true));
    // Course navigation is shell UI, not a shared question stem. Its lazy
    // drawer contents may change independently while answers are saved.
    shared.querySelectorAll('#theme_boost-drawers-courseindex, .courseindex, .drawer, [data-region="drawer"], nav, [role="navigation"]').forEach(node => node.remove());
    shared.querySelectorAll('.que:not(.description), [id^="question-"]:not(.description), #mod_quiz_navblock, #quiz-timer, .quiztimer, [data-region="quiz-timer"], script, style, input, button, select, textarea').forEach(node => node.remove());
    return { shared: text(shared), questions };
  })())`);
  if (!canonical || typeof canonical.shared !== "string" || !Array.isArray(canonical.questions))
    throw Error("Invalid native shared-question context.");
  const descriptions = page.questions.filter(
    (question) =>
      question.question_type === "description" &&
      !question.controls.some(
        (control) =>
          !control.disabled &&
          !control.readonly &&
          !["hidden", "button", "submit"].includes(String(control.type)),
      ),
  );
  return {
    ...page,
    body_text: canonical.shared,
    descriptions,
    questions: page.questions
      .filter((question) => !descriptions.includes(question))
      .map((question) => {
        const match = canonical.questions.find((item) => item.id === question.question_id);
        if (!match) throw Error("Native canonical question set changed during extraction.");
        return {
          ...question,
          question_classes: question.question_classes?.filter(name =>
            !["notyetanswered", "answersaved", "complete", "invalid", "needsgrading", "gradedright", "gradedpartial", "gradedwrong", "gaveup", "mangraderight", "mangradepartial", "mangradewrong"].includes(name)),
          prompt: match.prompt,
          prompt_html: match.html,
          prompt_latex: match.latex,
          options: question.controls.filter(control => ["radio", "checkbox"].includes(String(control.type)))
            .map(control => match.controls.find(item => item.id === control.control_id)?.optionText || String(control.option_text || ""))
            .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index).slice(0, 20),
          visible_context: match.context,
          interaction_hints: question.response_model?.adapter === "drag-drop-image" && question.interaction_hints
            ? { ...question.interaction_hints,
                drag_items: new Set(question.controls.flatMap(control =>
                  (Array.isArray(control.options) ? control.options : []).map(option => String(control.group) + ":" + String(option.value)))).size,
                drop_zones: question.controls.length }
            : question.interaction_hints,
          controls: question.controls.map((control) => {
            const stable = match.controls.find((item) => item.id === control.control_id);
            return stable
              ? { ...control, option_text: stable.optionText, latex: stable.latex }
              : control;
          }),
        };
      }),
  };
}
