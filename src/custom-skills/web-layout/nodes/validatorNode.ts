import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prepareWebLayoutArtifact } from "../assetPipeline.js";
import { validateWebLayoutFile, validationReportToJson } from "../validation.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutArtifactReport } from "../assetPipeline.js";
import type { WebLayoutKind, WebLayoutRuntimeConfig } from "../types.js";

export function createValidatorNode(config: WebLayoutRuntimeConfig) {
  return async function validatorNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (!isCompleteHtmlCandidate(state.html_document)) {
      const message = "HTML generator returned prose or an incomplete document; preserved the existing source workspace and build.";
      await config.diagnostics?.log("warn", "validator", message);
      return {
        validation_report: { ok: false, issues: [{ code: "incomplete-generator-output", message }] },
        error_log: message,
        retry_count: state.retry_count + 1,
        validator_retry_count: state.validator_retry_count + 1,
      };
    }
    const contentCoverageIssues = validateStudyGuideRenderCoverage(state.html_document, state.study_guide_content);
    if (effectiveKind(config.kind, state) === "study-guide" && contentCoverageIssues.length > 0) {
      const message = `Study-guide render coverage failed:\n- ${contentCoverageIssues.join("\n- ")}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        validation_report: { ok: false, issues: contentCoverageIssues.map((entry) => ({ code: "study-guide-content-coverage", message: entry })) },
        error_log: message,
        retry_count: state.retry_count + 1,
        validator_retry_count: state.validator_retry_count + 1,
      };
    }
    const backupPath = await backupExistingBuild(config.runDir);
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
      const restoredHtml = await restorePreviousBuild(backupPath, config.runDir);
      const message = `Artifact preparation failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "bundle", message);
      return {
        validation_report: { ok: false, issues: [{ code: "artifact-build", message }] },
        error_log: message,
        retry_count: state.retry_count + 1,
        validator_retry_count: state.validator_retry_count + 1,
        ...(restoredHtml ? { html_document: restoredHtml } : {}),
      };
    }
    let report;
    try {
      report = await validateWebLayoutFile(
        prepared.validationHtml,
        prepared.report.buildPath,
        effectiveKind(config.kind, state),
        {
          runDir: config.runDir,
          headed: config.browserHeaded,
          skip: config.skipBrowserValidation,
        },
      );
    } catch (error) {
      const restoredHtml = await restorePreviousBuild(backupPath, config.runDir);
      const message = `Browser validation failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        validation_report: {
          ok: false,
          issues: [{ code: "browser-validation", message }],
          artifact: artifactSummary(prepared.report),
        },
        error_log: message,
        retry_count: state.retry_count + 1,
        validator_retry_count: state.validator_retry_count + 1,
        ...(restoredHtml ? { html_document: restoredHtml } : {}),
      };
    }
    const validationReport: JsonObject = {
      ...validationReportToJson(report),
      artifact: artifactSummary(prepared.report),
    };
    if (!report.ok) {
      const restoredHtml = await restorePreviousBuild(backupPath, config.runDir);
      const message = `HTML validation failed:\n- ${report.issues.map((entry) => entry.message).join("\n- ")}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        validation_report: validationReport,
        error_log: message,
        retry_count: state.retry_count + 1,
        validator_retry_count: state.validator_retry_count + 1,
        ...(restoredHtml ? { html_document: restoredHtml } : {}),
      };
    }
    await config.diagnostics?.log("info", "validator", "HTML validation passed.");
    return {
      validation_report: validationReport,
      error_log: null,
    };
  };
}

export function validateStudyGuideRenderCoverage(html: string, content: JsonObject): string[] {
  const topics = Array.isArray(content.topics) ? content.topics : [];
  if (topics.length === 0) return ["The canonical study-guide content bank is missing."];
  const records = topics.filter(isJsonObject);
  const exercises = records.flatMap((topic) => Array.isArray(topic.exercises) ? topic.exercises : [])
    .filter(isJsonObject);
  const crossCount = exercises.filter((exercise) => exercise.type === "cross").length;
  const calculationCount = exercises.filter((exercise) => exercise.type === "calculation").length;
  const missingIds = exercises
    .map((exercise) => typeof exercise.id === "string" ? exercise.id : "")
    .filter((id) => id && !html.includes(id));
  const issues: string[] = [];
  if (missingIds.length > 0) issues.push(`The rendered artifact omits ${missingIds.length} canonical exercise IDs (for example ${missingIds.slice(0, 3).join(", ")}).`);
  if (crossCount > 0 && !/data-sb-cross-exercise/i.test(html)) issues.push("The renderer does not expose the standardized selection-practice block marker required by the content bank.");
  if (calculationCount > 0 && !/data-sb-calculation-exercise/i.test(html)) issues.push("The renderer does not expose the standardized calculation block marker required by the content bank.");
  if (/function\s+(?:qs|calc|makeQuestion)\s*\(/i.test(html)) issues.push("Generic exercise factory functions are forbidden; render the canonical content records directly.");
  if (/<math\b[^>]*>[\s\S]{0,120}<mtext>[^<]*(?:[=+\-*/^]|lim|int|sqrt)[^<]*<\/mtext>/i.test(html)) issues.push("A mathematical expression is flattened into mtext instead of structured MathML.");
  return issues;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && !Array.isArray(value) && typeof value === "object";
}

function isCompleteHtmlCandidate(html: string): boolean {
  const trimmed = html.trim();
  return /^<!doctype html>/i.test(trimmed) &&
    /<html\b/i.test(trimmed) &&
    /<head\b/i.test(trimmed) &&
    /<body\b/i.test(trimmed) &&
    /<style\b[^>]*>[\s\S]*?<\/style>/i.test(trimmed) &&
    /<script\b[^>]*>[\s\S]*?<\/script>/i.test(trimmed);
}

async function backupExistingBuild(runDir: string): Promise<string | null> {
  const buildPath = path.join(runDir, ".build", "document.html");
  const buildStat = await stat(buildPath).catch(() => null);
  if (!buildStat?.isFile() || buildStat.size === 0) return null;
  const backupPath = path.join(runDir, ".build", "last-known-good.html");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(buildPath, backupPath);
  return backupPath;
}

async function restorePreviousBuild(backupPath: string | null, runDir: string): Promise<string | null> {
  if (!backupPath) return null;
  const html = await readFile(backupPath, "utf8");
  await copyFile(backupPath, path.join(runDir, ".build", "document.html"));
  return html;
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
    kind === "study-guide" ||
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
