import { prepareWebLayoutArtifact } from "../assetPipeline.js";
import { validateWebLayoutFile, validationReportToJson } from "../validation.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutArtifactReport } from "../assetPipeline.js";
import type { WebLayoutKind, WebLayoutRuntimeConfig } from "../types.js";

export function createValidatorNode(config: WebLayoutRuntimeConfig) {
  return async function validatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    let prepared;
    try {
      prepared = await prepareWebLayoutArtifact(state.html_document, config);
      await config.diagnostics?.log(
        "info",
        "bundle",
        `Prepared ${prepared.report.artifactBytes} byte single-file artifact with ${prepared.report.assets.length} embedded media asset(s).`,
      );
      for (const warning of prepared.report.warnings) {
        await config.diagnostics?.log("warn", "bundle", warning);
      }
    } catch (error) {
      const message = `Artifact preparation failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "bundle", message);
      return {
        validation_report: { ok: false, issues: [{ code: "artifact-build", message }] },
        error_log: message,
        retry_count: state.retry_count + 1,
      };
    }
    const report = await validateWebLayoutFile(
      prepared.validationHtml,
      prepared.report.buildPath,
      effectiveKind(config.kind, state),
      {
        runDir: config.runDir,
        headed: config.browserHeaded,
        skip: config.skipBrowserValidation,
      },
    );
    const validationReport: JsonObject = {
      ...validationReportToJson(report),
      artifact: artifactSummary(prepared.report),
    };
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

function artifactSummary(report: WebLayoutArtifactReport): JsonObject {
  return {
    sourceBundlePath: report.sourceBundlePath,
    mediaManifestPath: report.mediaManifestPath,
    buildPath: report.buildPath,
    artifactBytes: report.artifactBytes,
    embeddedAssetBytes: report.embeddedAssetBytes,
    base64PayloadBytes: report.base64PayloadBytes,
    estimatedDecodedImageBytes: report.estimatedDecodedImageBytes,
    maxArtifactBytes: report.maxArtifactBytes,
    sizeClass: report.sizeClass,
    assetCount: report.assets.length,
    warnings: report.warnings,
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
