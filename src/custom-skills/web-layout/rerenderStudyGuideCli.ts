#!/usr/bin/env node
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { prepareWebLayoutArtifact } from "./assetPipeline.js";
import { createWebLayoutRuntimeConfig } from "./config.js";
import { applyOfflineSecurityPolicy } from "./htmlShell.js";
import { renderStandardStudyGuide } from "./standardStudyGuideRenderer.js";
import { validateWebLayoutFile, validationReportToJson } from "./validation.js";

const program = new Command()
  .name("web-layout-rerender-study-guide")
  .description("Deterministically rerender and browser-validate a persisted standard Study Guide content bank without another model call.")
  .argument("<source-run-dir>", "Successful web-layout run containing study-guide-content.json")
  .requiredOption("--run-dir <path>", "New canonical output run directory")
  .option("--browser-headed", "Show the validation browser")
  .parse(process.argv);

const sourceRunDir = path.resolve(program.args[0]);
const options = program.opts<{ runDir: string; browserHeaded?: boolean }>();
const runDir = path.resolve(options.runDir);
const [contentText, priorConfigText, layoutText, sourceText] = await Promise.all([
  readFile(path.join(sourceRunDir, "study-guide-content.json"), "utf8"),
  readFile(path.join(sourceRunDir, "config.json"), "utf8"),
  readFile(path.join(sourceRunDir, "layout-spec.json"), "utf8"),
  readFile(path.join(sourceRunDir, "source.txt"), "utf8"),
]);
const content = JSON.parse(contentText);
const priorConfig = JSON.parse(priorConfigText) as Record<string, unknown>;
const prompt = typeof priorConfig.prompt === "string" && priorConfig.prompt.trim()
  ? priorConfig.prompt
  : "Rerender persisted standard Study Guide";
const language = priorConfig.language === "en" ? "en" : "de";
const config = createWebLayoutRuntimeConfig({
  prompt,
  originalUserPrompt: typeof priorConfig.originalUserPrompt === "string" ? priorConfig.originalUserPrompt : prompt,
  kind: "study-guide",
  runDir,
  outputPath: path.join(runDir, "document.html"),
  language,
  browserHeaded: options.browserHeaded,
  sourceRunDir: typeof priorConfig.sourceRunDir === "string" ? priorConfig.sourceRunDir : undefined,
});
await mkdir(runDir, { recursive: true });
const html = applyOfflineSecurityPolicy(renderStandardStudyGuide(content, language));
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
await Promise.all([
  copyFile(prepared.report.buildPath, config.outputPath),
  writeFile(path.join(runDir, "study-guide-content.json"), contentText, "utf8"),
  writeFile(path.join(runDir, "layout-spec.json"), layoutText, "utf8"),
  writeFile(path.join(runDir, "source.txt"), sourceText, "utf8"),
  writeFile(path.join(runDir, "validation-report.json"), `${JSON.stringify({
    ...validationReportToJson(report),
    artifact: prepared.report,
  }, null, 2)}\n`, "utf8"),
  writeFile(path.join(runDir, "error.log"), "", "utf8"),
]);
const bytes = (await stat(config.outputPath)).size;
await writeFile(path.join(runDir, "run-summary.md"), [
  "# Deterministic standard Study Guide rerender",
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
