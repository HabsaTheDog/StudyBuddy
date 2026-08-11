import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import {
  hashRequestContract,
  minimalRequestContract,
  REQUEST_CONTRACT_FILE,
  REQUEST_CONTRACT_INTEGRITY_FILE,
  RequestContractSchema,
  verifyRequestContractIntegrity,
  type RequestContract,
} from "../../shared/requestContract.js";

const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_HANDOFF_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COMBINED_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_PRACTICE_FILE_BYTES = 160 * 1024;
const MAX_PRACTICE_CORPUS_BYTES = 750 * 1024;
const PRACTICE_FILE_PATTERN = /(?:minitest|quiz|test|lösung|loesung|übungs|uebungs|worksheet|practice|example|assignment)/i;

export function createSourceNode(config: WebLayoutRuntimeConfig) {
  return async function sourceNode(): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      if (config.sourceMode === "prompt" && requestsMoodleSources(config.prompt)) {
        throw new Error(
          "Moodle-derived web layouts require a successful extraction handoff. " +
          "Run study_buddy_task.sh extract first, then retry with --source-run-dir <extraction-run>.",
        );
      }
      const chunks = [`# User prompt\n${config.originalUserPrompt.trim()}`];
      let requestContract = minimalRequestContract(config.originalUserPrompt, [config.kind]);
      if (config.sourceRunDir) {
        const handoff = await readMoodleHandoff(config.sourceRunDir);
        if (handoff.requestContract.originalPrompt !== config.originalUserPrompt) {
          throw new Error(
            "Moodle request contract does not match the exact original user prompt for this HTML run.",
          );
        }
        chunks.push(handoff.text);
        requestContract = handoff.requestContract;
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
      if (Buffer.byteLength(sourceText) > MAX_COMBINED_SOURCE_BYTES) {
        throw new Error("Combined web-layout source exceeds the 50 MiB safety limit.");
      }
      await config.diagnostics?.log("info", "source", `Prepared source text (${sourceText.length} chars).`);
      return {
        source_text: sourceText,
        request_contract: requestContract,
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
  const buffer = await readBoundedFile(filePath, MAX_SOURCE_FILE_BYTES);
  if (buffer.includes(0)) {
    throw new Error(`Source file appears to be binary: ${filePath}`);
  }
  const text = buffer.toString("utf8").trim();
  if (!text) {
    throw new Error(`Source file is empty: ${filePath}`);
  }
  return `# Source file: ${filePath}\n${text}`;
}

async function readMoodleHandoff(sourceRunDir: string): Promise<{ text: string; requestContract: RequestContract }> {
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
    requestContract,
    requestContractIntegrity,
    practiceCorpus,
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
    readRequired(path.join(sourceRunDir, REQUEST_CONTRACT_FILE)),
    readRequired(path.join(sourceRunDir, REQUEST_CONTRACT_INTEGRITY_FILE)),
    readPracticeCorpus(sourceRunDir),
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
  const parsedRequestContract = RequestContractSchema.parse(JSON.parse(requestContract));
  const verifiedIntegrity = verifyRequestContractIntegrity(
    parsedRequestContract,
    JSON.parse(requestContractIntegrity),
  );
  if (verifiedIntegrity.contractHash !== hashRequestContract(parsedRequestContract)) {
    throw new Error("Verified Moodle request contract hash changed during HTML handoff loading.");
  }
  return { text: [
    `# Moodle extraction handoff: ${sourceRunDir}`,
    "## Source coverage",
    coverage.trim(),
    "## Extracted data",
    extractedData.trim(),
    sourceMap ? `## Resource graph\n${sourceMap.trim()}` : "",
    evidencePackage ? `## Evidence package summary\n${summarizeEvidencePackage(evidencePackage)}` : "",
    studyModel ? `## Validated study model\n${studyModel.trim()}` : "",
    reviewReport ? `## Student-first review\n${reviewReport.trim()}` : "",
    `## Evaluated user request contract\n${requestContract.trim()}`,
    practiceCorpus ? `## Full extracted practice corpus\n${practiceCorpus}` : "",
    studyModel ? "" : `## Raw source text\n${rawText.trim()}`,
  ].join("\n\n"), requestContract: parsedRequestContract };
}

async function readPracticeCorpus(sourceRunDir: string): Promise<string> {
  const sourcesDir = path.join(sourceRunDir, "sources");
  const entries = await readdir(sourcesDir, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".extracted.txt") && PRACTICE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "de"));
  const chunks: string[] = [];
  let totalBytes = 0;
  for (const name of candidates) {
    const filePath = path.join(sourcesDir, name);
    const details = await stat(filePath).catch(() => null);
    if (!details?.isFile() || details.size === 0 || details.size > MAX_PRACTICE_FILE_BYTES) continue;
    if (totalBytes + details.size > MAX_PRACTICE_CORPUS_BYTES) break;
    const text = (await readFile(filePath, "utf8")).trim();
    if (!text) continue;
    chunks.push(`### Practice source: ${name}\n${text}`);
    totalBytes += details.size;
  }
  return chunks.join("\n\n");
}

function summarizeEvidencePackage(value: string): string {
  const parsed = JSON.parse(value) as {
    records?: Array<{ kind?: unknown; resourceId?: unknown }>;
    warnings?: unknown[];
  };
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  const byKind: Record<string, number> = {};
  const resourceIds = new Set<string>();
  for (const record of records) {
    const kind = typeof record.kind === "string" ? record.kind : "unknown";
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (typeof record.resourceId === "string") resourceIds.add(record.resourceId);
  }
  return JSON.stringify({
    recordCount: records.length,
    resourceCount: resourceIds.size,
    byKind,
    warningCount: Array.isArray(parsed.warnings) ? parsed.warnings.length : 0,
    note: "Full evidence records remain in the canonical Moodle run; the web planner receives the validated extracted data, source map, and study model instead of duplicating the multi-megabyte evidence package.",
  }, null, 2);
}

async function readRequired(filePath: string): Promise<string> {
  try {
    return (await readBoundedFile(filePath, MAX_HANDOFF_FILE_BYTES)).toString("utf8");
  } catch (error) {
    throw new Error(`Required handoff file is missing or unreadable: ${filePath}`);
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return (await readBoundedFile(filePath, MAX_HANDOFF_FILE_BYTES)).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer> {
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error(`Source path is not a file: ${filePath}`);
  if (details.size > maxBytes) {
    throw new Error(`Source file exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB safety limit: ${filePath}`);
  }
  return readFile(filePath);
}
