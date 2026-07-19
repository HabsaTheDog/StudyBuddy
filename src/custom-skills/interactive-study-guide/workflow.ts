import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMoodleGraph } from "../moodle/graph.js";
import type { MoodleGraphInput, MoodleGraphResult } from "../moodle/types.js";
import { publishStudyBuddyDeliverables, type PublishedDeliverable } from "../shared/deliverables.js";
import type { OutputLanguagePreference } from "../shared/languagePolicy.js";
import type { StudyBuddyExecutionProfile, StudyBuddyModelPolicyOverrides } from "../shared/modelPolicy.js";
import { acquireRunLease } from "../shared/runLease.js";
import { ensurePrivateDirectorySync, ensureStudyBuddyWorkspaceData, resolveStudyBuddyWorkspaceDataPaths, safePathSegment } from "../shared/workspaceData.js";
import { runWebLayoutGraph } from "../web-layout/graph.js";
import type { WebLayoutInput, WebLayoutResult } from "../web-layout/types.js";

export interface InteractiveStudyGuideInput {
  prompt: string;
  moodleUrl?: string;
  requestName?: string;
  runDir?: string;
  resumeRunDir?: string;
  deliverTo?: string;
  language?: OutputLanguagePreference;
  browserHeaded?: boolean;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  maxExtractionAttempts?: number;
  maxPages?: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  executionProfile?: StudyBuddyExecutionProfile;
  modelPolicyOverrides?: StudyBuddyModelPolicyOverrides;
}

export interface InteractiveStudyGuideResult {
  ok: boolean;
  runDir: string;
  extractionRunDirs: string[];
  sourceRunDir?: string;
  webLayoutRunDir?: string;
  outputPath?: string;
  publishedDeliverables: PublishedDeliverable[];
  summaryPath: string;
  error?: string;
}

export interface InteractiveStudyGuideDependencies {
  runExtraction?: (input: MoodleGraphInput) => Promise<MoodleGraphResult>;
  runWebLayout?: (input: WebLayoutInput) => Promise<WebLayoutResult>;
  publish?: typeof publishStudyBuddyDeliverables;
  now?: () => Date;
}

const RECOVERABLE_EXTRACTION = /Study Buddy run timed out after|Extraction checkpoint required:|Extraction capacity checkpoint required:|content_analyzer model call timed out after/i;

export async function runInteractiveStudyGuideWorkflow(
  input: InteractiveStudyGuideInput,
  dependencies: InteractiveStudyGuideDependencies = {},
): Promise<InteractiveStudyGuideResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Interactive Study Guide prompt must not be empty.");
  const workspace = ensureStudyBuddyWorkspaceData(resolveStudyBuddyWorkspaceDataPaths());
  const now = dependencies.now ?? (() => new Date());
  const requestName = safePathSegment(input.requestName ?? prompt).slice(0, 80) || "interactive-study-guide";
  const workflowDir = path.resolve(input.resumeRunDir ?? input.runDir ?? path.join(workspace.runsRoot, requestName, timestamp(now())));
  ensurePrivateDirectorySync(workflowDir);
  const releaseLease = await acquireRunLease(workflowDir, { reentrant: true });
  const summaryPath = path.join(workflowDir, "workflow-summary.md");
  const extractionRunDirs = await existingExtractionRunDirs(workflowDir);
  const baseResult: InteractiveStudyGuideResult = {
    ok: false,
    runDir: workflowDir,
    extractionRunDirs,
    publishedDeliverables: [],
    summaryPath,
  };
  await writeWorkflowSummary(summaryPath, { ...baseResult }, "running", prompt);

  try {
    const runExtraction = dependencies.runExtraction ?? runMoodleGraph;
    const runWebLayout = dependencies.runWebLayout ?? runWebLayoutGraph;
    const publish = dependencies.publish ?? publishStudyBuddyDeliverables;
    const maximumAttempts = clamp(input.maxExtractionAttempts ?? 3, 1, 4);
    let sourceRunDir: string | undefined;
    for (let index = 0; index < extractionRunDirs.length; index += 1) {
      await hydrateRecoveryHandoff(extractionRunDirs[index]!, extractionRunDirs.slice(0, index));
    }
    for (const candidate of [...extractionRunDirs].reverse()) {
      if ((await validateExtractionHandoff(candidate)).ok) {
        sourceRunDir = candidate;
        break;
      }
    }
    let previousRunDir = extractionRunDirs.at(-1);
    let lastExtractionError = "Extraction did not start.";

    if (previousRunDir && !sourceRunDir) {
      lastExtractionError = (await readFile(path.join(previousRunDir, "error.log"), "utf8").catch(() => "")).trim() || lastExtractionError;
      if (!await isRecoverableExtraction(previousRunDir, lastExtractionError)) previousRunDir = undefined;
    }

    for (let attempt = 1; !sourceRunDir && attempt <= maximumAttempts; attempt += 1) {
      const ordinal = extractionRunDirs.length;
      const extractionRunDir = path.join(workflowDir, ordinal === 0 ? "extraction" : `extraction-recovery-${ordinal}`);
      extractionRunDirs.push(extractionRunDir);
      const result = await runExtraction(extractionInput(input, prompt, extractionRunDir, previousRunDir));
      await hydrateRecoveryHandoff(result.runDir, extractionRunDirs.slice(0, -1));
      const handoff = await validateExtractionHandoff(result.runDir);
      if (result.ok && handoff.ok) {
        sourceRunDir = result.runDir;
        break;
      }
      lastExtractionError = result.error || handoff.error || "Extraction failed without a diagnostic.";
      if (attempt >= maximumAttempts || !await isRecoverableExtraction(result.runDir, lastExtractionError)) break;
      previousRunDir = result.runDir;
    }

    if (!sourceRunDir) {
      const failed = { ...baseResult, extractionRunDirs, error: `Interactive Study Guide extraction failed: ${lastExtractionError}` };
      await writeWorkflowSummary(summaryPath, failed, "failed", prompt);
      return failed;
    }

    const webLayoutRunDir = path.join(workflowDir, "web-layout");
    const webResult = await runWebLayout({
      prompt,
      kind: "study-guide",
      sourceRunDir,
      runDir: webLayoutRunDir,
      language: input.language ?? "auto",
      browserHeaded: input.browserHeaded,
      maxRuntimeMs: input.maxRuntimeMs,
      idleTimeoutMs: input.idleTimeoutMs,
      codexModel: input.codexModel,
      codexReasoningEffort: input.codexReasoningEffort,
      executionProfile: input.executionProfile ?? "quality",
      modelPolicyOverrides: input.modelPolicyOverrides,
    });
    if (!webResult.ok || !webResult.outputPath) {
      const failed = {
        ...baseResult,
        extractionRunDirs,
        sourceRunDir,
        webLayoutRunDir: webResult.runDir,
        error: `Interactive Study Guide rendering failed: ${webResult.error ?? "validated HTML was not produced."}`,
      };
      await writeWorkflowSummary(summaryPath, failed, "failed", prompt);
      return failed;
    }

    const publishedDeliverables = await publish({
      prompt,
      runDir: workflowDir,
      sourcePaths: [webResult.outputPath],
      deliverTo: input.deliverTo,
    });
    const completed: InteractiveStudyGuideResult = {
      ok: true,
      runDir: workflowDir,
      extractionRunDirs,
      sourceRunDir,
      webLayoutRunDir: webResult.runDir,
      outputPath: webResult.outputPath,
      publishedDeliverables,
      summaryPath,
    };
    await writeWorkflowSummary(summaryPath, completed, "success", prompt);
    return completed;
  } catch (error) {
    const failed = { ...baseResult, extractionRunDirs, error: error instanceof Error ? error.message : String(error) };
    await writeWorkflowSummary(summaryPath, failed, "failed", prompt);
    return failed;
  } finally {
    await releaseLease();
  }
}

async function hydrateRecoveryHandoff(targetRunDir: string, priorRunDirs: string[]): Promise<void> {
  const target = path.join(targetRunDir, "moodle_raw.txt");
  if (await nonEmpty(target)) return;
  const localEvidence = await readFile(path.join(targetRunDir, "evidence-package.json"), "utf8").catch(() => "");
  if (localEvidence.trim()) {
    await writeFile(target, `# Moodle evidence package\n\n${localEvidence.trim()}\n`, "utf8");
    return;
  }
  for (const priorRunDir of [...priorRunDirs].reverse()) {
    const source = path.join(priorRunDir, "moodle_raw.txt");
    if (!await nonEmpty(source)) continue;
    await copyFile(source, target);
    return;
  }
}

async function existingExtractionRunDirs(workflowDir: string): Promise<string[]> {
  const names = await readdir(workflowDir).catch(() => [] as string[]);
  return names
    .filter((name) => name === "extraction" || /^extraction-recovery-\d+$/.test(name))
    .sort((left, right) => extractionOrdinal(left) - extractionOrdinal(right))
    .map((name) => path.join(workflowDir, name));
}

function extractionOrdinal(name: string): number {
  if (name === "extraction") return 0;
  return Number(name.match(/(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function extractionInput(
  input: InteractiveStudyGuideInput,
  prompt: string,
  runDir: string,
  resumeExtractionRunDir?: string,
): MoodleGraphInput {
  return {
    prompt,
    moodleUrl: input.moodleUrl ?? process.env.STUDY_BUDDY_MOODLE_URL ?? "https://moodle.technikum-wien.at/my/",
    runDir,
    maxDepth: resumeExtractionRunDir ? 0 : 2,
    maxPages: resumeExtractionRunDir ? 0 : input.maxPages ?? 12,
    maxCisPages: 0,
    allowFileDownloads: !resumeExtractionRunDir,
    stage: "extract",
    resumeExtractionRunDir,
    includeCis: false,
    sourceMode: "moodle",
    artifactProfile: "interactive_learning",
    formats: ["html"],
    outputLanguage: input.language ?? "auto",
    browserHeaded: input.browserHeaded,
    maxRuntimeMs: input.maxRuntimeMs,
    idleTimeoutMs: input.idleTimeoutMs,
    codexModel: input.codexModel,
    codexReasoningEffort: input.codexReasoningEffort,
    executionProfile: input.executionProfile ?? "quality",
    modelPolicyOverrides: input.modelPolicyOverrides,
  };
}

export async function validateExtractionHandoff(runDir: string): Promise<{ ok: boolean; error?: string }> {
  const summary = await readFile(path.join(runDir, "run-summary.md"), "utf8").catch(() => "");
  const errorLog = await readFile(path.join(runDir, "error.log"), "utf8").catch(() => "missing error.log");
  const required = await Promise.all(["moodle_raw.txt", "extracted-data.json", "source_coverage.json"].map(async (name) => {
    const size = await stat(path.join(runDir, name)).then((value) => value.size, () => 0);
    return { name, size };
  }));
  const missing = required.filter((entry) => entry.size === 0).map((entry) => entry.name);
  if (!/^Run status:\s*(?:success|partial)$/m.test(summary)) return { ok: false, error: "Extraction summary is not terminal success/partial." };
  if (errorLog.trim()) return { ok: false, error: errorLog.trim() };
  if (missing.length) return { ok: false, error: `Extraction handoff is missing non-empty ${missing.join(", ")}.` };
  try {
    JSON.parse(await readFile(path.join(runDir, "extracted-data.json"), "utf8"));
    JSON.parse(await readFile(path.join(runDir, "source_coverage.json"), "utf8"));
  } catch (error) {
    return { ok: false, error: `Extraction handoff JSON is invalid: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true };
}

async function isRecoverableExtraction(runDir: string, error: string): Promise<boolean> {
  if (!RECOVERABLE_EXTRACTION.test(error)) return false;
  const support = await Promise.all(["source-map.json", "evidence-package.json", "coverage-report.json"].map((name) => nonEmpty(path.join(runDir, name))));
  if (support.every(Boolean)) return true;
  return nonEmpty(path.join(runDir, "extracted-data.json")) || nonEmpty(path.join(runDir, "chapter-handoffs"));
}

async function nonEmpty(target: string): Promise<boolean> {
  return stat(target).then((value) => value.isDirectory() || value.size > 0, () => false);
}

async function writeWorkflowSummary(
  summaryPath: string,
  result: InteractiveStudyGuideResult,
  status: "running" | "success" | "failed",
  prompt: string,
): Promise<void> {
  const lines = [
    "# Interactive Study Guide workflow",
    "",
    `Run status: ${status}`,
    `Prompt: ${prompt}`,
    `Workflow directory: ${result.runDir}`,
    `Extraction runs: ${result.extractionRunDirs.join(", ") || "pending"}`,
    `Successful extraction: ${result.sourceRunDir ?? "pending"}`,
    `Web layout run: ${result.webLayoutRunDir ?? "pending"}`,
    `Canonical HTML: ${result.outputPath ?? "pending"}`,
    `Published HTML: ${result.publishedDeliverables.map((item) => item.publishedPath).join(", ") || "pending"}`,
    result.error ? `Error: ${result.error}` : "Error: none",
    "",
  ];
  await writeFile(summaryPath, lines.join("\n"), "utf8");
  await writeFile(summaryPath.replace(/\.md$/, ".json"), `${JSON.stringify({ schemaVersion: 1, status, prompt, ...result }, null, 2)}\n`, "utf8");
}

function timestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, "-");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
