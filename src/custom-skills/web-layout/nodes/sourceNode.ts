import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";

export function createSourceNode(config: WebLayoutRuntimeConfig) {
  return async function sourceNode(): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const chunks = [`# User prompt\n${config.prompt.trim()}`];
      if (config.sourceRunDir) {
        chunks.push(await readMoodleHandoff(config.sourceRunDir));
      }
      for (const filePath of config.sourceFiles) {
        chunks.push(await readTextSourceFile(filePath));
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
  const [summary, errorLog, rawText, extractedData, coverage] = await Promise.all([
    readRequired(path.join(sourceRunDir, "run-summary.md")),
    readRequired(path.join(sourceRunDir, "error.log")),
    readRequired(path.join(sourceRunDir, "moodle_raw.txt")),
    readRequired(path.join(sourceRunDir, "extracted-data.json")),
    readRequired(path.join(sourceRunDir, "source_coverage.json")),
  ]);
  if (!/^Run status:\s*success$/m.test(summary)) {
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
  return [
    `# Moodle extraction handoff: ${sourceRunDir}`,
    "## Source coverage",
    coverage.trim(),
    "## Extracted data",
    extractedData.trim(),
    "## Raw source text",
    rawText.trim(),
  ].join("\n\n");
}

async function readRequired(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Required handoff file is missing or unreadable: ${filePath}`);
  }
}
