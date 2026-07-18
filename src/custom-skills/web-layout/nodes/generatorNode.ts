import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { offlineHtmlRules, studyBuddyDesignGuidelines } from "../designGuidelines.js";
import { applyOfflineSecurityPolicy, stripHtmlFence } from "../htmlShell.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";
import { adaptiveLearningInteractionGuidance } from "../learningInteractionGuidance.js";
import { studyGuideBlockGuidance } from "../studyGuideBlockContract.js";
import { renderStandardStudyGuide } from "../standardStudyGuideRenderer.js";

const REPAIR_DOCUMENT_PATH = ".repair/document.html";

export function createGeneratorNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function generatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      if (
        config.kind === "study-guide" &&
        config.language === "de" &&
        Object.keys(state.study_guide_content).length > 0
      ) {
        const html = applyOfflineSecurityPolicy(renderStandardStudyGuide(state.study_guide_content, config.language));
        assertCompleteHtmlResponse(html);
        await config.diagnostics?.log("info", "generator", `Rendered standardized study-guide HTML deterministically (${html.length} chars).`);
        return { html_document: html, error_log: null };
      }
      const repairMode = Boolean(state.error_log && state.html_document.trim());
      const repairPath = path.join(config.runDir, REPAIR_DOCUMENT_PATH);
      if (repairMode) {
        await mkdir(path.dirname(repairPath), { recursive: true });
        await writeFile(repairPath, state.html_document, "utf8");
      }
      const response = await codex.run(buildGeneratorPrompt(config, state), {
        task: "artifact_builder",
        attempt: state.retry_count + 1,
      });
      const responseHtml = stripHtmlFence(response);
      const stagedHtml = repairMode ? await readFile(repairPath, "utf8") : "";
      const rawHtml = repairMode && !hasCompleteHtmlStructure(responseHtml)
        ? stagedHtml
        : responseHtml;
      if (repairMode && rawHtml === state.html_document) {
        throw new Error(
          `Model did not modify the staged repair artifact ${REPAIR_DOCUMENT_PATH}.`,
        );
      }
      const html = applyOfflineSecurityPolicy(rawHtml);
      assertCompleteHtmlResponse(html);
      await config.diagnostics?.log(
        "info",
        "generator",
        `${repairMode ? "Repaired staged" : "Generated"} HTML (${html.length} chars).`,
      );
      return {
        html_document: html,
        error_log: null,
      };
    } catch (error) {
      const message = `HTML generator failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "generator", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        generator_retry_count: state.generator_retry_count + 1,
      };
    }
  };
}

function assertCompleteHtmlResponse(html: string): void {
  const required = [
    ["doctype", /<!doctype\s+html/i],
    ["html", /<html\b/i],
    ["head", /<head\b/i],
    ["body", /<body\b/i],
    ["style", /<style\b/i],
    ["script", /<script\b/i],
  ] as const;
  const missing = required.filter(([, pattern]) => !pattern.test(html)).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Model returned an incomplete HTML response; missing ${missing.join(", ")}.`);
  }
}

function hasCompleteHtmlStructure(html: string): boolean {
  return /<!doctype\s+html/i.test(html) &&
    /<html\b/i.test(html) &&
    /<head\b/i.test(html) &&
    /<body\b/i.test(html) &&
    /<style\b/i.test(html) &&
    /<script\b/i.test(html);
}

export function buildGeneratorPrompt(
  config: WebLayoutRuntimeConfig,
  state: Pick<LangGraphWebLayoutState, "source_text" | "layout_spec" | "html_document" | "error_log" | "validation_report"> & { study_guide_content?: JsonObject },
): string {
  return [
    state.error_log && state.html_document.trim()
      ? [
          "Repair the existing Study Buddy interactive learning webpage in place.",
          `The complete last-known-good artifact is staged at ${REPAIR_DOCUMENT_PATH}, relative to the working directory.`,
          `Use your file tools to inspect and edit only ${REPAIR_DOCUMENT_PATH}. Do not reproduce the complete HTML in your response.`,
          "Make the smallest coherent changes that resolve every supplied finding while preserving all unrelated working content and interactions.",
          "After saving the repaired file, respond with exactly UPDATED_DOCUMENT_HTML.",
        ].join("\n")
      : "Generate one complete Study Buddy interactive learning webpage.\nOutput raw HTML only. Do not wrap it in Markdown fences. Do not include explanations outside the HTML.",
    offlineHtmlRules(),
    studyBuddyDesignGuidelines(),
    "Media source rules:",
    "- Use useful validated images when they materially improve learning; do not add decorative media merely to fill space.",
    "- For Moodle images, use the exact visual_assets.relative_path from the extraction handoff.",
    "- For --asset inputs, use the listed assets/<filename> alias.",
    "- Do not read, generate, or paste Base64. The official optimizer and bundler handle binary media after generation.",
    "- Use one src per image rather than srcset; the offline optimizer controls final dimensions and encoding.",
    "- Every image needs meaningful alt text and, when evidential, a source-aware caption.",
    "- Large PDFs and videos must remain user-triggered HTTPS Moodle/source links; label that they require connectivity or login.",
    "Interaction requirements:",
    interactionGuidance(config.kind),
    adaptiveLearningInteractionGuidance(),
    config.kind === "study-guide" ? studyGuideBlockGuidance() : "",
    config.kind === "study-guide" ? [
      "Canonical study-guide content-bank rules:",
      "- The supplied study-guide content bank is the complete renderer input. Render every topic, worked example, exercise, retrieval item, and source from it exactly once.",
      "- Do not generate, parameterize, clone, or summarize exercises. Do not create generic qs(), calc(), makeQuestion(), or equivalent task factories.",
      "- Build controls directly from each concrete exercise record. Respect selectionMode, show option-specific feedback, and reveal the supplied explanation only after evaluation.",
      "- Calculation fields must accept every supplied acceptedAnswers value after trimming and decimal-comma normalization; never leak accepted answers into the initial DOM-visible prompt.",
      "- Convert formula strings and mathematical expressions into real structured MathML using elements such as mfrac, msup, msub, msqrt, mrow, mo, mi, and mn. Never wrap a whole formula in mtext.",
      "- The UI architecture is fixed: one sticky top Hotbar, one centered responsive chapter dropdown containing the tablist, then repeated topic blocks in the order Orientierung → Theorie → worked example → evidence-appropriate practice → retrieval. Never create a left sidebar or separate previous/next navigation arrows.",
      "- Store answer drafts, evaluated state, completed items, topic progress, and last position in localStorage.",
    ].join("\n") : "",
    "Scope control:",
    config.kind === "study-guide"
      ? "- Build one coherent learning journey with readable instruction and a primary practice workspace. Supporting retrieval practice, worked examples, progress, and a final mixed check are expected when the source supports them; they must share the same chapter model and must not feel like unrelated mini-apps."
      : "- Implement one coherent primary learning interaction. Prefer a smaller complete experience over a broad dashboard of loosely related tools.",
    "- Do not add content editors, authoring workflows, import/export/download controls, source search/filtering, or modal source previews unless explicitly requested.",
    config.sourceMode === "prompt"
      ? "- The prompt is the only source: label the page as a demo, avoid course-specific factual claims, and do not build citations or source-management controls."
      : "- Build citations only from sources actually present in the supplied source text.",
    "Reliability requirements learned from validation:",
    "- At 390px viewport width, no element may cause horizontal document overflow. Wrap or scroll wide local content inside its own labelled container.",
    "- A quiz or scored interaction may award credit at most once per task until an explicit reset.",
    "- Do not require a physical unit for every technical term. Mention units only for quantities, or say 'falls anwendbar'.",
    "- Prefer inline details for secondary information. If an overlay behaves like a modal, implement dialog semantics, initial focus, focus containment, Escape/close handling, and focus restoration.",
    "- Avoid SVG fragment references such as href='#id', xlink:href='#id', or url(#id); draw small reusable shapes directly so strict offline validation cannot mistake fragments for external resources.",
    "- Never present layout specifications, UI metadata, generated examples, or the user prompt as fachliche Quellen.",
    `Requested kind: ${config.kind}`,
    `Language: ${config.language}`,
    `Validated layout spec:\n${JSON.stringify(state.layout_spec, null, 2)}`,
    state.error_log ? `Validator or generator error to repair:\n${state.error_log}` : "",
    Object.keys(state.validation_report).length
      ? `Previous validation report:\n${JSON.stringify(state.validation_report, null, 2)}`
      : "",
    config.kind === "study-guide"
      ? `Canonical validated study-guide content bank:\n${JSON.stringify(state.study_guide_content ?? {}, null, 2)}`
      : `Source text:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function interactionGuidance(kind: string): string {
  const shared = "Use accessible controls, clear state, and mobile-safe responsive layout.";
  const byKind: Record<string, string> = {
    "study-guide": [
      "Create a course-dependent study guide, not a quiz dashboard.",
      "Include persistent topic navigation and progress, readable source-grounded theory, properly typeset formula/reference content, worked examples with collapsible reasoning, deterministic applied practice, a small retrieval/flashcard layer only where useful, and a mixed final check.",
      "Use data-sb-learning-content for the reading workspace, data-sb-practice for applied practice, data-sb-progress for the persisted progress readout, and data-sb-retrieval for the retrieval-practice layer.",
      "Each chapter must tell the learner what to read, what to notice, what to do next, and how to diagnose a mistake. Persist progress and practice state locally.",
    ].join("\n"),
    flashcards: "Include deck progress, flip interaction, next/previous, known/needs-review marking, review summary, and keyboard support.",
    "concept-visualization": "Include inline SVG or canvas, controls that modify the visualization, explanatory state readout, and reset.",
    simulation: "Include numeric range/number controls with units, live calculated output, input bounds, and explanation of current state.",
    "exam-practice": [
      "Include question navigation, answer reveal or submission mode, scoring, and review. Do not claim official exam status unless sourced.",
      "Expose the standardized Study Buddy exam persistence contract so the real browser validator can exercise start → draft → reload → finish:",
      "- start control: data-sb-exam-start",
      "- visible active exam surface: data-sb-exam-surface",
      "- at least one representative persisted draft input: data-sb-exam-draft",
      "- countdown: data-sb-exam-timer with a numeric data-remaining-ms updated at least once per second",
      "- current score: data-sb-exam-score",
      "- finish control: data-sb-exam-end",
      "- persistent post-exam evaluation: data-sb-exam-result",
      "- navigation/help/formula/source regions unavailable during an exam: data-sb-exam-lock",
      "- set document.body.dataset.sbExamActive to 'true' only while the restored exam is active.",
      "Persist active state, randomized order, current item/index, timestamps, score, submitted answers, and unsubmitted drafts on both input and change. Restore them automatically on reload.",
    ].join("\n"),
    quiz: "Include multiple question types where useful, immediate feedback, score, and retry/reset.",
    worksheet: "Include editable answer fields, solution reveal, and progress/completion state.",
    reference: "Create a compact interactive reference with navigation/filtering if useful; keep it offline and branded.",
    auto: "Choose exactly one primary interaction model from flashcards, visualization, simulation, quiz, exam practice, worksheet, or reference. A compact navigation/progress aid is allowed, but do not combine multiple mini-apps.",
  };
  return `${shared}\n${byKind[kind] ?? byKind.auto}`;
}
