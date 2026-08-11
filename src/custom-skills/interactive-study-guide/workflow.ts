import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMoodleGraph } from "../moodle/graph.js";
import type { MoodleGraphInput, MoodleGraphResult } from "../moodle/types.js";
import { publishStudyBuddyDeliverables, type PublishedDeliverable } from "../shared/deliverables.js";
import type { OutputLanguagePreference } from "../shared/languagePolicy.js";
import type { StudyBuddyExecutionProfile, StudyBuddyModelPolicyOverrides } from "../shared/modelPolicy.js";
import { acquireQueuedRunSlot, acquireRunLease } from "../shared/runLease.js";
import { resolveOptionalConcurrency } from "../shared/concurrency.js";
import { executeStudyWorkflowPlan, type StudyWorkflowModule } from "../shared/studyWorkflowPlan.js";
import {
  REQUEST_CONTRACT_FILE,
  REQUEST_CONTRACT_INTEGRITY_FILE,
  RequestContractSchema,
  verifyRequestContractIntegrity,
} from "../shared/requestContract.js";
import { ensurePrivateDirectorySync, ensureStudyBuddyWorkspaceData, resolveStudyBuddyWorkspaceDataPaths, safePathSegment } from "../shared/workspaceData.js";
import { runWebLayoutGraph } from "../web-layout/graph.js";
import type { WebLayoutInput, WebLayoutResult } from "../web-layout/types.js";

export interface InteractiveStudyGuideInput {
  prompt: string;
  originalUserPrompt?: string;
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
  pdfRenderRunDir?: string;
  outputPath?: string;
  pdfPath?: string;
  publishedDeliverables: PublishedDeliverable[];
  summaryPath: string;
  error?: string;
}

export interface InteractiveStudyGuideDependencies {
  runExtraction?: (input: MoodleGraphInput) => Promise<MoodleGraphResult>;
  runWebLayout?: (input: WebLayoutInput) => Promise<WebLayoutResult>;
  runPdfRender?: (input: MoodleGraphInput) => Promise<MoodleGraphResult>;
  publish?: typeof publishStudyBuddyDeliverables;
  now?: () => Date;
  acquireWorkflowSlot?: (onWait: (activeSlots: number, totalSlots: number) => Promise<void>) => Promise<() => Promise<void>>;
  workflowConcurrency?: number;
  workflowQueueDirectory?: string;
}

const RECOVERABLE_EXTRACTION = /Study Buddy run timed out after|Extraction checkpoint required:|Extraction capacity checkpoint required:|content_analyzer model call timed out after/i;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL_WORKFLOW_QUEUE = path.resolve(MODULE_DIR, "../../..", "study-buddy-data", ".interactive-study-guide-queue");

export async function runInteractiveStudyGuideWorkflow(
  input: InteractiveStudyGuideInput,
  dependencies: InteractiveStudyGuideDependencies = {},
): Promise<InteractiveStudyGuideResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Interactive Study Guide prompt must not be empty.");
  const originalUserPrompt = input.originalUserPrompt?.trim() ?? prompt;
  if (!originalUserPrompt) {
    throw new Error("Interactive Study Guide original user prompt must not be empty.");
  }
  const workspace = ensureStudyBuddyWorkspaceData(resolveStudyBuddyWorkspaceDataPaths());
  const now = dependencies.now ?? (() => new Date());
  const requestName = safePathSegment(input.requestName ?? prompt).slice(0, 80) || "interactive-study-guide";
  const workflowDir = path.resolve(input.resumeRunDir ?? input.runDir ?? path.join(workspace.runsRoot, requestName, timestamp(now())));
  ensureInsideWorkspaceDataRoot(workspace.dataRoot, workflowDir);
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
  await writeWorkflowSummary(summaryPath, { ...baseResult }, "queued", prompt);
  let releaseWorkflowSlot: () => Promise<void> = async () => undefined;
  let sourceRunDir: string | undefined;
  let webLayoutRunDir: string | undefined;
  let pdfRenderRunDir: string | undefined;
  let outputPath: string | undefined;
  let pdfPath: string | undefined;

  try {
    const acquireWorkflowSlot = dependencies.acquireWorkflowSlot ?? (
      (onWait) => acquireInteractiveWorkflowAdmission({
        onWait,
        concurrency: dependencies.workflowConcurrency,
        queueDirectory: dependencies.workflowQueueDirectory,
      })
    );
    releaseWorkflowSlot = await acquireWorkflowSlot(async (activeSlots, totalSlots) => {
      await writeWorkflowSummary(summaryPath, {
        ...baseResult,
        error: `Queued behind ${activeSlots}/${totalSlots} active interactive Study Guide workflow(s).`,
      }, "queued", prompt);
    });
    await writeWorkflowSummary(summaryPath, { ...baseResult }, "running", prompt);
    const runExtraction = dependencies.runExtraction ?? runMoodleGraph;
    const runWebLayout = dependencies.runWebLayout ?? runWebLayoutGraph;
    const publish = dependencies.publish ?? publishStudyBuddyDeliverables;
    const maximumAttempts = clamp(input.maxExtractionAttempts ?? 3, 1, 4);
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
      const result = await runExtraction(extractionInput(
        input,
        prompt,
        originalUserPrompt,
        extractionRunDir,
        previousRunDir,
      ));
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
    const validatedSourceRunDir = sourceRunDir;

    const requestedBranches = await requestedArtifactBranches(validatedSourceRunDir);
    const runPdfRender = dependencies.runPdfRender ?? runMoodleGraph;
    webLayoutRunDir = path.join(workflowDir, "web-layout");
    pdfRenderRunDir = requestedBranches.pdf ? path.join(workflowDir, "pdf-render") : undefined;
    const existingHtml = await validExistingHtml(webLayoutRunDir);
    const existingPdf = pdfRenderRunDir ? await validExistingPdf(pdfRenderRunDir) : undefined;
    const branchModules: StudyWorkflowModule[] = [
      ...(!existingHtml ? [{
        id: "artifact-html",
        kind: "artifact.interactive_html",
        dependsOn: [],
        exclusiveResourceKeys: [path.join(workflowDir, "web-layout")],
        required: true,
      }] : []),
      ...(requestedBranches.pdf && pdfRenderRunDir && !existingPdf ? [{
        id: "artifact-pdf",
        kind: "artifact.study_pdf",
        dependsOn: [],
        exclusiveResourceKeys: [path.join(workflowDir, "pdf-render")],
        required: true,
      }] : []),
    ];
    let webResult: WebLayoutResult | undefined;
    let pdfResult: MoodleGraphResult | undefined;
    const branchErrors: string[] = [];
    if (branchModules.length > 0) {
      const execution = await executeStudyWorkflowPlan<{
        branch: "html" | "pdf";
        result: WebLayoutResult | MoodleGraphResult;
      }>({ schemaVersion: 1, modules: branchModules }, async (module) => {
        if (module.kind === "artifact.interactive_html") {
          const result = await runWebLayout({
            prompt,
            originalUserPrompt,
            kind: "study-guide",
            sourceRunDir: validatedSourceRunDir,
            runDir: webLayoutRunDir!,
            language: input.language ?? "auto",
            browserHeaded: input.browserHeaded,
            maxRuntimeMs: input.maxRuntimeMs,
            idleTimeoutMs: input.idleTimeoutMs,
            codexModel: input.codexModel,
            codexReasoningEffort: input.codexReasoningEffort,
            executionProfile: input.executionProfile ?? "balanced",
            modelPolicyOverrides: input.modelPolicyOverrides,
          });
          return { branch: "html", result };
        }
        if (module.kind === "artifact.study_pdf" && pdfRenderRunDir) {
          const result = await runPdfRender(pdfRenderInput(
            input,
            prompt,
            originalUserPrompt,
            validatedSourceRunDir,
            pdfRenderRunDir,
          ));
          return { branch: "pdf", result };
        }
        throw new Error(`No workflow handler is registered for ${module.kind}.`);
      });
      for (const moduleResult of execution.results) {
        if (moduleResult.status !== "success" || !moduleResult.value) {
          branchErrors.push(`${moduleResult.moduleId}: ${moduleResult.error ?? "module failed"}`);
          continue;
        }
        if (moduleResult.value.branch === "html") webResult = moduleResult.value.result as WebLayoutResult;
        else pdfResult = moduleResult.value.result as MoodleGraphResult;
      }
    }
    outputPath = existingHtml ?? webResult?.outputPath;
    pdfPath = existingPdf ?? pdfResult?.pdfPath;
    if (webResult && (!webResult.ok || !webResult.outputPath)) {
      branchErrors.push(`HTML: ${webResult.error ?? "validated HTML was not produced."}`);
    }
    if (requestedBranches.pdf && pdfResult && (!pdfResult.ok || !pdfResult.pdfPath)) {
      branchErrors.push(`PDF: ${pdfResult.error ?? "validated PDF was not produced."}`);
    }
    if (!outputPath) branchErrors.push("HTML: validated HTML was not produced.");
    if (requestedBranches.pdf && !pdfPath) branchErrors.push("PDF: validated PDF was not produced.");
    if (branchErrors.length > 0) {
      const failed = {
        ...baseResult,
        extractionRunDirs,
        sourceRunDir,
        webLayoutRunDir,
        pdfRenderRunDir,
        outputPath,
        pdfPath,
        error: `Study artifact rendering failed: ${branchErrors.join(" | ")}`,
      };
      await writeWorkflowSummary(summaryPath, failed, "failed", prompt);
      return failed;
    }

    const publishedDeliverables = await publish({
      prompt,
      runDir: workflowDir,
      sourcePaths: [outputPath, pdfPath].filter((value): value is string => Boolean(value)),
      deliverTo: input.deliverTo,
    });
    const completed: InteractiveStudyGuideResult = {
      ok: true,
      runDir: workflowDir,
      extractionRunDirs,
      sourceRunDir,
      webLayoutRunDir,
      pdfRenderRunDir,
      outputPath,
      pdfPath,
      publishedDeliverables,
      summaryPath,
    };
    await writeWorkflowSummary(summaryPath, completed, "success", prompt);
    return completed;
  } catch (error) {
    const failed = {
      ...baseResult,
      extractionRunDirs,
      sourceRunDir,
      webLayoutRunDir,
      pdfRenderRunDir,
      outputPath,
      pdfPath,
      error: error instanceof Error ? error.message : String(error),
    };
    await writeWorkflowSummary(summaryPath, failed, "failed", prompt);
    return failed;
  } finally {
    await releaseWorkflowSlot();
    await releaseLease();
  }
}

export async function acquireInteractiveWorkflowAdmission(input: {
  onWait?: (activeSlots: number, totalSlots: number) => void | Promise<void>;
  concurrency?: number;
  queueDirectory?: string;
  signal?: AbortSignal;
} = {}): Promise<() => Promise<void>> {
  const concurrency = resolveOptionalConcurrency(
    input.concurrency ?? process.env.STUDY_BUDDY_INTERACTIVE_WORKFLOW_CONCURRENCY,
  );
  if (concurrency === null) return async () => undefined;
  return acquireQueuedRunSlot(input.queueDirectory ?? GLOBAL_WORKFLOW_QUEUE, {
    slots: concurrency,
    pollMs: 1_000,
    signal: input.signal,
    onWait: input.onWait,
  });
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
  originalUserPrompt: string,
  runDir: string,
  resumeExtractionRunDir?: string,
): MoodleGraphInput {
  return {
    prompt,
    originalUserPrompt,
    moodleUrl: input.moodleUrl ?? process.env.STUDY_BUDDY_MOODLE_URL ?? "https://moodle.technikum-wien.at/my/",
    runDir,
    maxDepth: resumeExtractionRunDir ? 0 : 2,
    maxPages: resumeExtractionRunDir ? 0 : input.maxPages ?? 12,
    maxCisPages: 0,
    allowFileDownloads: !resumeExtractionRunDir,
    stage: "extract",
    evidenceHandoffOnly: true,
    resumeExtractionRunDir,
    includeCis: false,
    sourceMode: "moodle",
    artifactProfile: "interactive_learning",
    formats: explicitlyRequestedArtifactFormats(originalUserPrompt),
    visualsEnabled: false,
    visualMode: "off",
    outputLanguage: input.language ?? "auto",
    browserHeaded: input.browserHeaded,
    maxRuntimeMs: input.maxRuntimeMs,
    idleTimeoutMs: input.idleTimeoutMs,
    codexModel: input.codexModel,
    codexReasoningEffort: input.codexReasoningEffort,
    executionProfile: input.executionProfile ?? "balanced",
    modelPolicyOverrides: input.modelPolicyOverrides,
  };
}

function explicitlyRequestedArtifactFormats(prompt: string): Array<"html" | "pdf"> {
  const normalized = prompt.toLocaleLowerCase("de");
  const forbidsPdf = /\b(?:kein(?:e[snm]?)?|ohne|not|no)\s+(?:pdf|pdf-datei|pdf-dokument)\b/.test(normalized);
  return !forbidsPdf && /\bpdf(?:-datei|-dokument)?\b/.test(normalized)
    ? ["html", "pdf"]
    : ["html"];
}

function pdfRenderInput(
  input: InteractiveStudyGuideInput,
  prompt: string,
  originalUserPrompt: string,
  sourceRunDir: string,
  runDir: string,
): MoodleGraphInput {
  return {
    prompt,
    originalUserPrompt,
    moodleUrl: input.moodleUrl ?? process.env.STUDY_BUDDY_MOODLE_URL ?? "https://moodle.technikum-wien.at/my/",
    runDir,
    maxDepth: 0,
    maxPages: 0,
    maxCisPages: 0,
    allowFileDownloads: false,
    stage: "render",
    sourceRunDir,
    includeCis: false,
    sourceMode: "moodle",
    artifactProfile: "study_guide",
    formats: ["pdf"],
    outputLanguage: input.language ?? "auto",
    browserHeaded: input.browserHeaded,
    maxRuntimeMs: input.maxRuntimeMs,
    idleTimeoutMs: input.idleTimeoutMs,
    codexModel: input.codexModel,
    codexReasoningEffort: input.codexReasoningEffort,
    executionProfile: input.executionProfile ?? "balanced",
    modelPolicyOverrides: input.modelPolicyOverrides,
  };
}

async function requestedArtifactBranches(sourceRunDir: string): Promise<{ html: true; pdf: boolean }> {
  const contractPath = path.join(sourceRunDir, REQUEST_CONTRACT_FILE);
  const integrityPath = path.join(sourceRunDir, REQUEST_CONTRACT_INTEGRITY_FILE);
  const [contractText, integrityText] = await Promise.all([
    readFile(contractPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    }),
    readFile(integrityPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    }),
  ]);
  if (!contractText && !integrityText) {
    // Legacy handoffs predate request contracts and remain HTML-only.
    return { html: true, pdf: false };
  }
  if (!contractText || !integrityText) {
    throw new Error("Artifact branch planning requires both request-contract.json and its integrity sidecar.");
  }
  try {
    const contract = RequestContractSchema.parse(JSON.parse(contractText));
    verifyRequestContractIntegrity(contract, JSON.parse(integrityText));
    return {
      html: true,
      pdf: contract.deliverables.some((deliverable) => /(?:pdf|document|print)/i.test(deliverable.kind)),
    };
  } catch (error) {
    throw new Error(
      `Artifact branch planning rejected an invalid request contract: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function validExistingHtml(runDir: string): Promise<string | undefined> {
  const output = path.join(runDir, "document.html");
  const [summary, errorLog, qualityReview] = await Promise.all([
    readFile(path.join(runDir, "run-summary.md"), "utf8").catch(() => ""),
    readFile(path.join(runDir, "error.log"), "utf8").catch(() => "missing"),
    readFile(path.join(runDir, "quality-review.json"), "utf8").catch(() => ""),
  ]);
  if (!/^Run status:\s*success$/m.test(summary) || errorLog.trim() || !await nonEmpty(output)) return undefined;
  try {
    if ((JSON.parse(qualityReview) as { ok?: boolean }).ok !== true) return undefined;
  } catch {
    return undefined;
  }
  return output;
}

async function validExistingPdf(runDir: string): Promise<string | undefined> {
  const typst = path.join(runDir, "document.typ");
  const pdf = path.join(runDir, "document.pdf");
  const [summary, errorLog, postRenderReview] = await Promise.all([
    readFile(path.join(runDir, "run-summary.md"), "utf8").catch(() => ""),
    readFile(path.join(runDir, "error.log"), "utf8").catch(() => "missing"),
    readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8").catch(() => ""),
  ]);
  if (!/^Run status:\s*success$/m.test(summary) || errorLog.trim() || !await nonEmpty(typst) || !await nonEmpty(pdf)) {
    return undefined;
  }
  try {
    if ((JSON.parse(postRenderReview) as { ok?: boolean }).ok !== true) return undefined;
  } catch {
    return undefined;
  }
  return pdf;
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
  status: "queued" | "running" | "success" | "failed",
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
    `PDF render run: ${result.pdfRenderRunDir ?? "not requested"}`,
    `Canonical HTML: ${result.outputPath ?? "pending"}`,
    `Canonical PDF: ${result.pdfPath ?? "not requested"}`,
    `Published deliverables: ${result.publishedDeliverables.map((item) => item.publishedPath).join(", ") || "pending"}`,
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

function ensureInsideWorkspaceDataRoot(dataRoot: string, workflowDir: string): void {
  const relative = path.relative(path.resolve(dataRoot), path.resolve(workflowDir));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      `Interactive Study Guide run directory is outside the resolved workspace data root (${dataRoot}): ${workflowDir}. ` +
      "Check STUDY_BUDDY_WORKSPACE propagation before starting the workflow.",
    );
  }
}
