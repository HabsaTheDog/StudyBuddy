#!/usr/bin/env node
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { prepareWebLayoutArtifact } from "./assetPipeline.js";
import { createWebLayoutRuntimeConfig } from "./config.js";
import { applyOfflineSecurityPolicy } from "./htmlShell.js";
import { renderAdaptiveStudyGuide } from "./adaptiveStudyGuideRenderer.js";
import { buildAdaptiveStudyModel } from "./adaptiveStudyModel.js";
import {
  assessmentSolutionSetSchema,
  missingAssessmentSolutionIds,
} from "./assessmentSolutions.js";
import { studyGuideContentSchema } from "./studyGuideContent.js";
import { learningVisualSetSchema } from "./learningVisualTypes.js";
import { validateWebLayoutFile, validationReportToJson } from "./validation.js";

const startedMs = Date.now();
const startedAt = new Date(startedMs).toISOString();
const program = new Command()
  .name("web-layout-rerender-study-guide")
  .description("Deterministically rerender and browser-validate a persisted adaptive Study Guide content bank without another model call.")
  .argument("<source-run-dir>", "Successful web-layout run containing study-guide-content.json")
  .requiredOption("--run-dir <path>", "New canonical output run directory")
  .option("--original-user-prompt <prompt>", "Exact untranslated latest user request")
  .option("--language <language>", "Artifact language: de or en")
  .option("--browser-headed", "Show the validation browser")
  .parse(process.argv);

const sourceRunDir = path.resolve(program.args[0]);
const options = program.opts<{
  runDir: string;
  originalUserPrompt?: string;
  language?: string;
  browserHeaded?: boolean;
}>();
const runDir = path.resolve(options.runDir);
const [contentText, priorConfigText, layoutText, sourceText, solutionText, visualText] = await Promise.all([
  readFile(path.join(sourceRunDir, "study-guide-content.json"), "utf8"),
  readFile(path.join(sourceRunDir, "config.json"), "utf8"),
  readFile(path.join(sourceRunDir, "layout-spec.json"), "utf8"),
  readFile(path.join(sourceRunDir, "source.txt"), "utf8"),
  readFile(path.join(sourceRunDir, "assessment-solutions.json"), "utf8").catch(() => ""),
  readFile(path.join(sourceRunDir, "learning-visuals.json"), "utf8").catch(() => ""),
]);
const content = JSON.parse(contentText);
const priorConfig = JSON.parse(priorConfigText) as Record<string, unknown>;
const prompt = typeof priorConfig.prompt === "string" && priorConfig.prompt.trim()
  ? priorConfig.prompt
  : "Rerender persisted standard Study Guide";
if (options.language && options.language !== "de" && options.language !== "en") {
  throw new Error(`Expected --language de or en, got ${options.language}`);
}
const language = options.language === "en" ||
    (!options.language && priorConfig.language === "en")
  ? "en"
  : "de";
const originalUserPrompt = options.originalUserPrompt?.trim() ||
  (typeof priorConfig.originalUserPrompt === "string"
    ? priorConfig.originalUserPrompt
    : prompt);
const config = createWebLayoutRuntimeConfig({
  prompt,
  originalUserPrompt,
  kind: "study-guide",
  runDir,
  outputPath: path.join(runDir, "document.html"),
  language,
  browserHeaded: options.browserHeaded,
  sourceRunDir: typeof priorConfig.sourceRunDir === "string" ? priorConfig.sourceRunDir : undefined,
});
await mkdir(runDir, { recursive: true });
const adaptive = buildAdaptiveStudyModel(
  studyGuideContentSchema.parse(content),
  sourceText,
  language,
  solutionText
    ? assessmentSolutionSetSchema.parse(JSON.parse(solutionText))
    : undefined,
  visualText
    ? learningVisualSetSchema.parse(JSON.parse(visualText))
    : undefined,
);
const missingSolutions = missingAssessmentSolutionIds(adaptive);
if (missingSolutions.length > 0) {
  throw new Error(
    `Deterministic rerender requires reviewed assessment-solutions.json for: ${missingSolutions.join(", ")}. ` +
    "Run the full Study Guide workflow once to generate and review the missing solutions.",
  );
}
const html = applyOfflineSecurityPolicy(renderAdaptiveStudyGuide(content, adaptive, language));
const prepared = await prepareWebLayoutArtifact(html, config);
const report = await validateWebLayoutFile(prepared.validationHtml, prepared.report.buildPath, "study-guide", {
  runDir,
  headed: options.browserHeaded,
});
if (!report.ok) {
  const message = report.issues.map((issue) => issue.message).join("\n");
  await writeFile(path.join(runDir, "error.log"), `${message}\n`, "utf8");
  throw new Error(`Deterministic Study Guide rerender failed validation:\n${message}`);
}
const completedAt = new Date().toISOString();
const wallMs = Math.max(1, Date.now() - startedMs);
await Promise.all([
  copyFile(prepared.report.buildPath, config.outputPath),
  writeFile(path.join(runDir, "config.json"), `${JSON.stringify({
    ...priorConfig,
    prompt,
    originalUserPrompt: config.originalUserPrompt,
    kind: "study-guide",
    language,
    runDir,
    outputPath: config.outputPath,
    sourceRunDir,
    renderer: "adaptive-study-guide-v2",
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "study-guide-content.json"), contentText, "utf8"),
  ...(solutionText
    ? [writeFile(path.join(runDir, "assessment-solutions.json"), solutionText, "utf8")]
    : []),
  ...(visualText
    ? [writeFile(path.join(runDir, "learning-visuals.json"), visualText, "utf8")]
    : []),
  writeFile(path.join(runDir, "course-blueprint.json"), `${JSON.stringify(adaptive.courseBlueprint, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "assessment-blueprint.json"), `${JSON.stringify(adaptive.assessmentBlueprint, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "question-bank.json"), `${JSON.stringify(adaptive.questionBank, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "layout-spec.json"), layoutText, "utf8"),
  writeFile(path.join(runDir, "source.txt"), sourceText, "utf8"),
  writeFile(path.join(runDir, "validation-report.json"), `${JSON.stringify({
    ...validationReportToJson(report),
    artifact: prepared.report,
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "quality-review.json"), `${JSON.stringify({
    ok: true,
    summary: "Adaptive Study Guide passed deterministic content-contract and browser validation.",
    findings: [],
    renderer: "adaptive-study-guide-v2",
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "run-metrics.json"), `${JSON.stringify({
    schemaVersion: 1,
    policyVersion: "adaptive-study-guide-v2-deterministic-rerender",
    profile: "fast",
    status: "success",
    startedAt,
    updatedAt: completedAt,
    completedAt,
    wallMs,
    configuredDownloadConcurrency: 0,
    totals: {
      inputTokens: 0,
      cachedInputTokens: 0,
      freshInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      modelCalls: 0,
      modelDurationMs: 0,
      modelQueueWaitMs: 0,
      retries: 0,
      toolCalls: 0,
      leafToolPolicyViolations: 0,
    },
    phases: [],
    modelCalls: [],
    resources: {
      discovered: 0,
      selected: 0,
      started: 0,
      completed: 0,
      failed: 0,
      timedOut: 0,
      canceled: 0,
      bytes: 0,
    },
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "error.log"), "", "utf8"),
]);
const bytes = (await stat(config.outputPath)).size;
await writeFile(path.join(runDir, "run-summary.md"), [
  "# Deterministic adaptive Study Guide rerender",
  "",
  "Run status: success",
  `Source run: ${sourceRunDir}`,
  `Canonical HTML: ${config.outputPath}`,
  `Artifact bytes: ${bytes}`,
  `Browser states audited: ${report.browserChecks.length ? "complete" : "none"}`,
  "Error: none",
  "",
].join("\n"), "utf8");
console.log(`Canonical HTML: ${config.outputPath}`);
console.log(`Validation report: ${path.join(runDir, "validation-report.json")}`);
console.log(`Artifact bytes: ${bytes}`);
