import { validateWebLayoutHtml, validationReportToJson } from "../validation.js";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutKind, WebLayoutRuntimeConfig } from "../types.js";

export function createValidatorNode(config: WebLayoutRuntimeConfig) {
  return async function validatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    const report = await validateWebLayoutHtml(state.html_document, effectiveKind(config.kind, state), {
      runDir: config.runDir,
      headed: config.browserHeaded,
      skip: config.skipBrowserValidation,
    });
    const validationReport = validationReportToJson(report);
    if (!report.ok) {
      const message = `HTML validation failed:\n- ${report.issues.map((entry) => entry.message).join("\n- ")}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        validation_report: validationReport,
        error_log: message,
        retry_count: state.retry_count + 1,
      };
    }
    await config.diagnostics?.log("info", "validator", "HTML validation passed.");
    return {
      validation_report: validationReport,
      error_log: null,
    };
  };
}

function effectiveKind(fallback: WebLayoutKind, state: LangGraphWebLayoutState): WebLayoutKind {
  const kind = state.layout_spec.kind;
  if (
    kind === "flashcards" ||
    kind === "concept-visualization" ||
    kind === "simulation" ||
    kind === "exam-practice" ||
    kind === "quiz" ||
    kind === "worksheet" ||
    kind === "reference"
  ) {
    return kind;
  }
  return fallback;
}
