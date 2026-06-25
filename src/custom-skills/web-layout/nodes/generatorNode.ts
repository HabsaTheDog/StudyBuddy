import { offlineHtmlRules, studyBuddyDesignGuidelines } from "../designGuidelines.js";
import { stripHtmlFence } from "../htmlShell.js";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";

export function createGeneratorNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function generatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const response = await codex.run(buildGeneratorPrompt(config, state));
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
    "Interaction requirements:",
    interactionGuidance(config.kind),
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
    auto: "Choose the best interaction model from flashcards, visualization, simulation, quiz, exam practice, worksheet, or reference.",
  };
  return `${shared}\n${byKind[kind] ?? byKind.auto}`;
}
