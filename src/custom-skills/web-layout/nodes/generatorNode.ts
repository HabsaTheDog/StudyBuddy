import { offlineHtmlRules, studyBuddyDesignGuidelines } from "../designGuidelines.js";
import { stripHtmlFence } from "../htmlShell.js";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";

export function createGeneratorNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function generatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const response = await codex.run(buildGeneratorPrompt(config, state), {
        task: "artifact_builder",
        attempt: state.retry_count + 1,
      });
      const html = stripHtmlFence(response);
      await config.diagnostics?.log("info", "generator", `Generated HTML (${html.length} chars).`);
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

export function buildGeneratorPrompt(
  config: WebLayoutRuntimeConfig,
  state: Pick<LangGraphWebLayoutState, "source_text" | "layout_spec" | "error_log" | "validation_report">,
): string {
  return [
    "Generate one complete Study Buddy interactive learning webpage.",
    "Output raw HTML only. Do not wrap it in Markdown fences. Do not include explanations outside the HTML.",
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
    "Scope control:",
    "- Implement one coherent primary learning interaction. Prefer a smaller complete experience over a broad dashboard of loosely related tools.",
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
    `Source text:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function interactionGuidance(kind: string): string {
  const shared = "Use accessible controls, clear state, and mobile-safe responsive layout.";
  const byKind: Record<string, string> = {
    flashcards: "Include deck progress, flip interaction, next/previous, known/needs-review marking, review summary, and keyboard support.",
    "concept-visualization": "Include inline SVG or canvas, controls that modify the visualization, explanatory state readout, and reset.",
    simulation: "Include numeric range/number controls with units, live calculated output, input bounds, and explanation of current state.",
    "exam-practice": "Include question navigation, answer reveal or submission mode, scoring, and review. Do not claim official exam status unless sourced.",
    quiz: "Include multiple question types where useful, immediate feedback, score, and retry/reset.",
    worksheet: "Include editable answer fields, solution reveal, and progress/completion state.",
    reference: "Create a compact interactive reference with navigation/filtering if useful; keep it offline and branded.",
    auto: "Choose exactly one primary interaction model from flashcards, visualization, simulation, quiz, exam practice, worksheet, or reference. A compact navigation/progress aid is allowed, but do not combine multiple mini-apps.",
  };
  return `${shared}\n${byKind[kind] ?? byKind.auto}`;
}
