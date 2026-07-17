import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";

export function createSourceNode(config: WebLayoutRuntimeConfig) {
  return async function sourceNode(): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      if (config.sourceMode === "prompt" && requestsMoodleSources(config.prompt)) {
        throw new Error(
          "Moodle-derived web layouts require a successful extraction handoff. " +
          "Run study_buddy_task.sh extract first, then retry with --source-run-dir <extraction-run>.",
        );
      }
      const chunks = [`# User prompt\n${config.prompt.trim()}`];
      if (config.sourceRunDir) {
        chunks.push(await readMoodleHandoff(config.sourceRunDir));
        chunks.push(
          `# Local Moodle artifact root\n${config.sourceRunDir}\n` +
          "Visual assets may be referenced only by a validated visual_assets.relative_path from the extraction handoff.",
        );
      }
      for (const filePath of config.sourceFiles) {
        chunks.push(await readTextSourceFile(filePath));
      }
      if (config.assetFiles.length) {
        chunks.push([
          "# Approved local image assets",
          ...config.assetFiles.map((filePath) => `- assets/${path.basename(filePath)} (${filePath})`),
        ].join("\n"));
      }
      const sourceText = chunks.join("\n\n---\n\n");
      await config.diagnostics?.log("info", "source", `Prepared source text (${sourceText.length} chars).`);
      return {
        source_text: sourceText,
        error_log: null,
      };
    } catch (error) {
      return {
        error_log: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

function requestsMoodleSources(prompt: string): boolean {
  return /\bmoodle\b/i.test(prompt);
}

async function readTextSourceFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error(`Source file appears to be binary: ${filePath}`);
  }
  const text = buffer.toString("utf8").trim();
  if (!text) {
    throw new Error(`Source file is empty: ${filePath}`);
  }
  return `# Source file: ${filePath}\n${text}`;
}

async function readMoodleHandoff(sourceRunDir: string): Promise<string> {
  const [
    summary,
    errorLog,
    rawText,
    extractedData,
    coverage,
    sourceMap,
    evidencePackage,
    studyModel,
    reviewReport,
  ] = await Promise.all([
    readRequired(path.join(sourceRunDir, "run-summary.md")),
    readRequired(path.join(sourceRunDir, "error.log")),
    readRequired(path.join(sourceRunDir, "moodle_raw.txt")),
    readRequired(path.join(sourceRunDir, "extracted-data.json")),
    readRequired(path.join(sourceRunDir, "source_coverage.json")),
    readOptional(path.join(sourceRunDir, "source-map.json")),
    readOptional(path.join(sourceRunDir, "evidence-package.json")),
    readOptional(path.join(sourceRunDir, "study-model.json")),
    readOptional(path.join(sourceRunDir, "review-report.json")),
  ]);
  if (!/^Run status:\s*(?:success|partial)$/m.test(summary)) {
    throw new Error(`Moodle handoff is not a successful extraction run: ${sourceRunDir}`);
  }
  if (errorLog.trim()) {
    throw new Error(`Moodle handoff error.log is not empty: ${sourceRunDir}`);
  }
  if (!rawText.trim()) {
    throw new Error(`Moodle handoff moodle_raw.txt is empty: ${sourceRunDir}`);
  }
  JSON.parse(extractedData);
  JSON.parse(coverage);
  for (const optionalJson of [sourceMap, evidencePackage, studyModel, reviewReport]) {
    if (optionalJson) JSON.parse(optionalJson);
  }
  return [
    `# Moodle extraction handoff: ${sourceRunDir}`,
    "## Source coverage",
    coverage.trim(),
    "## Extracted data",
    extractedData.trim(),
    sourceMap ? `## Resource graph\n${sourceMap.trim()}` : "",
    evidencePackage ? `## Evidence package\n${evidencePackage.trim()}` : "",
    studyModel ? `## Validated study model\n${studyModel.trim()}` : "",
    reviewReport ? `## Student-first review\n${reviewReport.trim()}` : "",
    studyModel ? "" : `## Raw source text\n${rawText.trim()}`,
  ].join("\n\n");
}

async function readRequired(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Required handoff file is missing or unreadable: ${filePath}`);
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  return readFile(filePath, "utf8").catch(() => null);
}
