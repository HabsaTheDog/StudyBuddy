import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { offlineHtmlRules, studyBuddyDesignGuidelines } from "../designGuidelines.js";
import { applyOfflineSecurityPolicy, stripHtmlFence } from "../htmlShell.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";
import { adaptiveLearningInteractionGuidance } from "../learningInteractionGuidance.js";
import { studyGuideBlockGuidance } from "../studyGuideBlockContract.js";
import { renderAdaptiveStudyGuide } from "../adaptiveStudyGuideRenderer.js";
import { buildAdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { studyGuideContentSchema } from "../studyGuideContent.js";

const REPAIR_DOCUMENT_PATH = ".repair/document.html";

export function createGeneratorNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function generatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const repairMode = Boolean(state.error_log && state.html_document.trim());
      if (
        !repairMode &&
        config.kind === "study-guide" &&
        Object.keys(state.study_guide_content).length > 0
      ) {
        const adaptive = Object.keys(state.course_blueprint).length &&
            Object.keys(state.assessment_blueprint).length &&
            Object.keys(state.question_bank).length
          ? {
              courseBlueprint: state.course_blueprint,
              assessmentBlueprint: state.assessment_blueprint,
              questionBank: state.question_bank,
            }
          : buildAdaptiveStudyModel(
              studyGuideContentSchema.parse(state.study_guide_content),
              state.source_text,
              config.language,
            );
        const html = applyOfflineSecurityPolicy(
          renderAdaptiveStudyGuide(state.study_guide_content, adaptive, config.language),
        );
        assertCompleteHtmlResponse(html);
        await config.diagnostics?.log("info", "generator", `Rendered standardized study-guide HTML deterministically (${html.length} chars).`);
        return {
          html_document: html,
          error_log: null,
          artifact_repair_stage: 0,
        };
      }
      if (
        repairMode &&
        state.artifact_repair_stage === 0 &&
        hasResponsiveLayoutFailure(state.validation_report)
      ) {
        const html = applyResponsiveLayoutRepair(state.html_document, "targeted");
        assertCompleteHtmlResponse(html);
        await config.diagnostics?.log(
          "info",
          "generator",
          "Applied the bounded deterministic responsive-layout repair before model escalation.",
        );
        return {
          html_document: html,
          error_log: null,
          artifact_repair_stage: 1,
        };
      }
      if (
        repairMode &&
        state.artifact_repair_stage === 2 &&
        hasResponsiveLayoutFailure(state.validation_report)
      ) {
        const html = applyResponsiveLayoutRepair(state.html_document, "fallback");
        assertCompleteHtmlResponse(html);
        await config.diagnostics?.log(
          "warn",
          "generator",
          "Applied the conservative responsive fallback after the targeted model repair remained invalid.",
        );
        return {
          html_document: html,
          error_log: null,
          artifact_repair_stage: 3,
        };
      }
      const repairPath = path.join(config.runDir, REPAIR_DOCUMENT_PATH);
      if (repairMode) {
        await mkdir(path.dirname(repairPath), { recursive: true });
        await writeFile(repairPath, state.html_document, "utf8");
      }
      const response = await codex.run(buildGeneratorPrompt(config, state), {
        task: repairMode ? "artifact_repair" : "artifact_builder",
        // Escalation is task-local: earlier content and validator retries must
        // not turn the first HTML repair into a fourth repair attempt.
        attempt: state.generator_retry_count + 1,
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
        ...(repairMode ? { artifact_repair_stage: 2 } : {}),
      };
    } catch (error) {
      const message = `HTML generator failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "generator", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        generator_retry_count: state.generator_retry_count + 1,
        ...(message.includes("did not modify the staged repair artifact")
          ? { artifact_repair_stage: 3 }
          : {}),
      };
    }
  };
}

function hasResponsiveLayoutFailure(report: JsonObject): boolean {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  return issues.some((entry) =>
    Boolean(entry) &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    (
      (entry as JsonObject).code === "horizontal-overflow" ||
      (
        (entry as JsonObject).code === "adaptive-study-guide-matrix" &&
        /responsive layout|overflow|clipped/i.test(String((entry as JsonObject).message ?? ""))
      )
    )
  );
}

function applyResponsiveLayoutRepair(html: string, mode: "targeted" | "fallback"): string {
  const marker = `data-sb-repair="responsive-${mode}-v1"`;
  if (html.includes(marker)) return html;
  const css = mode === "targeted"
    ? `
<style ${marker}>
:where(.app-shell,.hotbar-main,.workspace,.topic-workspace,.topic-layout,.catalog-workspace,.catalog-filters,.exam-result-summary,.exam-comparison,.section-heading,.question-card,.reading-card,.concept-card,.assessment-card,.exam-shell)>*{min-width:0}
:where(main,.module-tabs){min-width:0;max-width:100%}
:where(.module-tab,.module-tab strong){min-width:0;max-width:100%;overflow-wrap:anywhere}
:where(img,svg,canvas,video){max-width:100%;height:auto}
:where(.question-card,.reading-card,.concept-card,.assessment-card,.exam-shell,pre,code){overflow-wrap:anywhere;word-break:normal}
@media (min-width:761px) and (max-width:1230px){:where(.course-hero,.main-tabs,main){max-width:calc(100% - 36px)}}
</style>`
    : `
<style ${marker}>
:where(main,header,footer,nav,section,article,aside,form,fieldset,div){min-width:0;max-width:100%}
:where(img,svg,canvas,video){max-width:100%;height:auto}
:where(pre,table,.math-scroll,.formula-grid,.answer-options){max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}
:where(p,li,h1,h2,h3,h4,label,button,summary,.question-card,.reading-card,.concept-card,.assessment-card,.exam-shell){overflow-wrap:anywhere}
</style>`;
  if (!/<\/head>/i.test(html)) {
    throw new Error("Cannot apply responsive repair because </head> is missing.");
  }
  return html.replace(/<\/head>/i, `${css}\n</head>`);
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
  state: Pick<LangGraphWebLayoutState, "source_text" | "request_contract" | "layout_spec" | "html_document" | "error_log" | "validation_report"> & { study_guide_content?: JsonObject },
): string {
  const repairMode = Boolean(state.error_log && state.html_document.trim());
  return [
    repairMode
      ? [
          "Repair the existing Study Buddy interactive learning webpage in place.",
          `The complete last-known-good artifact is staged at ${REPAIR_DOCUMENT_PATH}, relative to the working directory.`,
          `Use your file tools to inspect and edit only ${REPAIR_DOCUMENT_PATH}. Do not reproduce the complete HTML in your response.`,
          "Make the smallest coherent changes that resolve every supplied finding while preserving all unrelated working content and interactions.",
          "Do not rewrite, summarize, add, or remove learning content, sources, question IDs, answers, or assessment rules. This role repairs presentation and runtime defects only.",
          "Inspect the structured validator details first. Prefer a local CSS/DOM fix tied to the reported offending selector over broad restyling.",
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
    config.kind === "study-guide" ? "" : adaptiveLearningInteractionGuidance(),
    config.kind === "study-guide" ? studyGuideBlockGuidance() : "",
    config.kind === "study-guide" ? [
      "Canonical study-guide content-bank rules:",
      "- The supplied study-guide content bank is the complete renderer input. Render every topic, worked example, exercise, retrieval item, and source from it exactly once.",
      "- Do not generate, parameterize, clone, or summarize exercises. Do not create generic qs(), calc(), makeQuestion(), or equivalent task factories.",
      "- Build controls directly from each concrete exercise record. Respect selectionMode, show option-specific feedback, and reveal the supplied explanation only after evaluation.",
      "- Calculation fields must accept every supplied acceptedAnswers value after trimming and decimal-comma normalization; never leak accepted answers into the initial DOM-visible prompt.",
      "- Open application fields must preserve drafts and reveal the supplied sample response plus self-check criteria only on request; let the learner mark the response complete or needing revision.",
      "- Convert formula strings and mathematical expressions into real structured MathML using elements such as mfrac, msup, msub, msqrt, mrow, mo, mi, and mn. Never wrap a whole formula in mtext.",
      "- Preserve the validated topic order. Inside each topic, render only the optional blocks actually present in the content bank; do not add a conventional theory/example/practice/retrieval sequence.",
      "- Store answer drafts, evaluated state, completed items, topic progress, and last position in localStorage.",
    ].join("\n") : "",
    "Scope control:",
    config.kind === "study-guide"
      ? "- Render the validated course journey and its supplied learning objects coherently. Absence of examples, retrieval, calculations, visuals, or a final mixed check is valid unless the evaluated request contract requires that component."
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
    `Exact original user request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract, null, 2)}`,
    `Validated layout spec:\n${JSON.stringify(state.layout_spec, null, 2)}`,
    state.error_log ? `Validator or generator error to repair:\n${state.error_log}` : "",
    Object.keys(state.validation_report).length
      ? `Previous validation report:\n${JSON.stringify(state.validation_report, null, 2)}`
      : "",
    config.kind === "study-guide"
      ? repairMode
        ? "The canonical learning bank and its reviewed IDs are already embedded in the staged artifact. Preserve them byte-for-byte unless a supplied validator finding identifies an exact presentation/runtime field; do not place the bank in this repair prompt or regenerate it."
        : `Canonical validated study-guide content bank:\n${JSON.stringify(state.study_guide_content ?? {}, null, 2)}`
      : `Source text:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function interactionGuidance(kind: string): string {
  const shared = "Use accessible controls, clear state, and mobile-safe responsive layout.";
  const byKind: Record<string, string> = {
    "study-guide": [
      "Render the supplied course-dependent learning bank, not a generic quiz dashboard.",
      "Do not synthesize a block, interaction type, or learning-stage sequence from the course label or from a conventional study-guide recipe.",
      "Use data-sb-learning-content for supplied reading, data-sb-practice for supplied practice, data-sb-progress for persisted progress, and data-sb-retrieval only when retrieval records exist.",
      "Persist the state of the learning objects that are actually present.",
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
