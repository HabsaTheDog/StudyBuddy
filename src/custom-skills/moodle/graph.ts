import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createCodexClient, type CodexClient } from "./codexClient.js";
import { AgentStateAnnotation, initialAgentState, type AgentState, type LangGraphAgentState } from "./state.js";
import type { MoodleGraphInput, MoodleGraphResult, MoodleRuntimeConfig } from "./types.js";
import { createRuntimeConfig, sanitizeConfig } from "./config.js";
import { RunDiagnostics, type SourceCoverage } from "./runDiagnostics.js";
import { raceWithAbort, StudyBuddyTimeoutError } from "./runtimeAbort.js";
import { extractedDataJsonSchema } from "./schemas.js";
import { createAnalyzerNode } from "./nodes/analyzerNode.js";
import { createCisScraperNode } from "./nodes/cisScraperNode.js";
import { createDiskWriterNode } from "./nodes/diskWriterNode.js";
import { createFormatterNode } from "./nodes/formatterNode.js";
import { createScraperNode } from "./nodes/scraperNode.js";
import { createVisualAssetResolverNode } from "./nodes/visualAssetResolverNode.js";
import { createVisualDiscoveryNode } from "./nodes/visualDiscoveryNode.js";
import { createSourceOrchestratorNode, createSourcePlannerNode } from "./sourceOrchestrator.js";
import { typstPdfPath } from "./typstTemplate.js";
import { getStudyBuddyTypstSupportFiles } from "./typstAssets.js";
import { validateTypst } from "./validation.js";
import { validateExtractedData } from "./validation.js";
import { writeRunProgress } from "./runProgress.js";
import {
  expectsDownloadedSourceEvidence,
  hasRequiredTopicEvidence,
  isDcDcRequest,
} from "./sourceHints.js";

const MAX_RETRIES = 3;
let typstPreflightPromise: Promise<void> | null = null;

export interface GraphDependencies {
  codex?: CodexClient;
  scraperNode?: ReturnType<typeof createScraperNode>;
  cisScraperNode?: ReturnType<typeof createCisScraperNode>;
}

export async function runMoodleGraph(
  input: MoodleGraphInput,
  dependencies: GraphDependencies = {},
): Promise<MoodleGraphResult> {
  const baseConfig = createRuntimeConfig(input);
  const initialCoverage = baseConfig.stage === "render"
    ? await loadSourceCoverage(baseConfig.sourceRunDir)
    : undefined;
  const diagnostics = new RunDiagnostics({
    runDir: baseConfig.runDir,
    secrets: [
      baseConfig.username,
      baseConfig.password,
      baseConfig.cisUsername,
      baseConfig.cisPassword,
    ].filter((value): value is string => Boolean(value)),
    initialCoverage,
  });
  await diagnostics.init();
  const abortController = new AbortController();
  const config: MoodleRuntimeConfig = {
    ...baseConfig,
    diagnostics,
    abortSignal: abortController.signal,
  };
  await writeRunProgress(config, { status: "running", phase: "planning_sources" });
  await diagnostics.log("info", "config", `Run directory: ${config.runDir}`);
  await writeJson(path.join(config.runDir, "config.json"), sanitizeConfig(config));
  await writeJson(path.join(config.runDir, "schema.json"), extractedDataJsonSchema);

  let state: AgentState = initialAgentState;
  let route = baseConfig.stage === "extract"
    ? "extraction"
    : baseConfig.stage === "render"
      ? "render"
      : "document";
  try {
    if (config.diagnosticOnly) {
      route = "diagnostic";
      state = await runDiagnosticOnly(config);
    } else {
      const initialStateForStage = config.stage === "render"
        ? await loadRenderState(config.sourceRunDir)
        : initialAgentState;
      if (config.stage !== "extract") {
        await ensureTypstPreflight();
        await diagnostics.log("info", "typst", "Study Buddy Typst toolchain preflight passed.");
      }
      const graph = config.stage === "extract"
        ? buildExtractionGraph(config, dependencies)
        : config.stage === "render"
          ? buildRenderGraph(config, dependencies)
          : buildMoodleGraph(config, dependencies);
      state = (await withRuntimeGuard(
        config,
        abortController,
        () => graph.invoke(initialStateForStage),
      )) as AgentState;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state = {
      ...state,
      error_log: message,
    };
    const coverage = diagnostics.getCoverage();
    if (
      !message.startsWith("Study Buddy Typst toolchain preflight failed") &&
      (coverage.moodle.status === "not_requested" || coverage.moodle.status === "attempted")
    ) {
      await diagnostics.markFailure("moodle", {
        detail: message,
        attemptedUrls: [config.moodleUrl],
        failureKind: error instanceof StudyBuddyTimeoutError ? "timeout" : "unknown",
      });
    }
    await diagnostics.log("error", "cleanup", `Moodle graph failed: ${message}`);
  }

  const hasDocument = Boolean(state.final_document.trim());
  const hasExtractedData = Object.keys(state.extracted_data).length > 0;
  const extractedDataPath = hasExtractedData
    ? path.join(config.runDir, "extracted-data.json")
    : undefined;
  const pdfPath = hasDocument ? await existingPdfPath(config.outputPath) : undefined;
  if (
    !config.diagnosticOnly &&
    config.stage !== "extract" &&
    !state.error_log &&
    hasDocument &&
    !pdfPath
  ) {
    state = {
      ...state,
      error_log: "Document generation did not produce a readable PDF artifact.",
    };
  }
  const ok =
    !state.error_log &&
    (
      config.diagnosticOnly
        ? Boolean(state.moodle_raw_text.trim())
        : config.stage === "extract"
          ? hasExtractedData
          : hasDocument && Boolean(pdfPath)
    );
  const sourceCoverage = diagnostics.getCoverage();
  const coverageComplete = isCoverageComplete(config, sourceCoverage);
  await persistRunDiagnostics(config, state);
  const timedOut = state.error_log?.startsWith("Study Buddy run timed out") ?? false;
  await diagnostics.writeSummary({
    route,
    status: ok ? (coverageComplete ? "success" : "partial") : timedOut ? "timeout" : "failed",
    prompt: config.prompt,
    error: state.error_log ?? undefined,
    outputPath: ok && hasDocument ? config.outputPath : undefined,
    pdfPath,
    stateHasRawText: Boolean(state.moodle_raw_text.trim()),
    stateHasDocument: hasDocument,
    extractedDataPath,
  });
  await writeRunProgress(config, {
    status: ok ? (coverageComplete ? "success" : "partial") : timedOut ? "timeout" : "failed",
    phase: "finalizing",
    error: state.error_log ? { message: state.error_log, retryable: !timedOut } : undefined,
    artifacts: {
      extractedDataPath,
      typstPath: ok && hasDocument ? config.outputPath : undefined,
      pdfPath,
    },
  });

  return {
    ok,
    coverageComplete,
    outputPath: ok && hasDocument ? config.outputPath : undefined,
    pdfPath,
    runDir: config.runDir,
    runSummaryPath: diagnostics.runSummaryPath,
    state,
    sourceCoverage,
    error: state.error_log ?? undefined,
    extractedDataPath,
  };
}

async function ensureTypstPreflight(): Promise<void> {
  typstPreflightPromise ??= (async () => {
    const toolchain = await validateTypst(
      typstPreflightDocument(),
      await getStudyBuddyTypstSupportFiles(),
      { preview: true },
    );
    if (!toolchain.ok) {
      throw new Error(`Study Buddy Typst toolchain preflight failed:\n${toolchain.error}`);
    }
  })();
  return typstPreflightPromise;
}

function typstPreflightDocument(): string {
  return `#import "study-buddy-components.typ": *

#sb-document(
  title: "Toolchain Preflight",
  short-title: "Preflight",
  course: "Study Buddy 2.0",
  kind: "Systemtest",
  semester: "n/a",
  status: "Preflight",
  date: "07.06.2026",
  body: [
    #sb-formula(
      name: "Einzelelement-Test",
      variables: "U: Spannung",
      units: "V",
    )[$ U = R I $]
  ],
)
`;
}

export function buildMoodleGraph(config: MoodleRuntimeConfig, dependencies: GraphDependencies = {}) {
  const codex = dependencies.codex ?? createCodexClient(config);

  return new StateGraph(AgentStateAnnotation)
    .addNode("sourcePlanner", createSourcePlannerNode(config))
    .addNode("sourceOrchestrator", createSourceOrchestratorNode(config, dependencies))
    .addNode("sourceGate", createSourceGateNode(config))
    .addNode("visualDiscovery", createVisualDiscoveryNode(config))
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addNode("formatter", createFormatterNode(config, codex))
    .addNode("diskWriter", createDiskWriterNode(config))
    .addEdge(START, "sourcePlanner")
    .addEdge("sourcePlanner", "sourceOrchestrator")
    .addEdge("sourceOrchestrator", "sourceGate")
    .addConditionalEdges("sourceGate", routeAfterSourceGate, {
      analyzer: "visualDiscovery",
      abort: END,
    })
    .addEdge("visualDiscovery", "analyzer")
    .addConditionalEdges("analyzer", routeAfterAnalyzer, {
      analyzer: "analyzer",
      formatter: "formatter",
      abort: END,
    })
    .addConditionalEdges("formatter", routeAfterFormatter, {
      formatter: "formatter",
      diskWriter: "diskWriter",
      abort: END,
    })
    .addEdge("diskWriter", END)
    .compile();
}

export function buildExtractionGraph(
  config: MoodleRuntimeConfig,
  dependencies: GraphDependencies = {},
) {
  const codex = dependencies.codex ?? createCodexClient(config);
  return new StateGraph(AgentStateAnnotation)
    .addNode("sourcePlanner", createSourcePlannerNode(config))
    .addNode("sourceOrchestrator", createSourceOrchestratorNode(config, dependencies))
    .addNode("sourceGate", createSourceGateNode(config))
    .addNode("visualDiscovery", createVisualDiscoveryNode(config))
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addEdge(START, "sourcePlanner")
    .addEdge("sourcePlanner", "sourceOrchestrator")
    .addEdge("sourceOrchestrator", "sourceGate")
    .addConditionalEdges("sourceGate", routeAfterSourceGate, {
      analyzer: "visualDiscovery",
      abort: END,
    })
    .addEdge("visualDiscovery", "analyzer")
    .addConditionalEdges("analyzer", routeAfterExtractionAnalyzer, {
      analyzer: "analyzer",
      done: END,
      abort: END,
    })
    .compile();
}

export function buildRenderGraph(
  config: MoodleRuntimeConfig,
  dependencies: GraphDependencies = {},
) {
  const codex = dependencies.codex ?? createCodexClient(config);
  return new StateGraph(AgentStateAnnotation)
    .addNode("visualAssetResolver", createVisualAssetResolverNode(config))
    .addNode("formatter", createFormatterNode(config, codex))
    .addNode("diskWriter", createDiskWriterNode(config))
    .addEdge(START, "visualAssetResolver")
    .addConditionalEdges("visualAssetResolver", routeAfterVisualAssetResolver, {
      formatter: "formatter",
      abort: END,
    })
    .addConditionalEdges("formatter", routeAfterFormatter, {
      formatter: "formatter",
      diskWriter: "diskWriter",
      abort: END,
    })
    .addEdge("diskWriter", END)
    .compile();
}

function routeAfterVisualAssetResolver(state: LangGraphAgentState): "formatter" | "abort" {
  return state.error_log ? "abort" : "formatter";
}

function createSourceGateNode(config: MoodleRuntimeConfig) {
  return async function sourceGateNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const coverage = config.diagnostics?.getCoverage();
    if (!coverage) {
      return { error_log: null };
    }
    const plan = config.sourcePlan;
    const needsMoodle =
      !plan ||
      plan.targets.includes("moodle") ||
      plan.needsCourseMaterial ||
      plan.needsFiles ||
      plan.needsQuizOrAssignment;
    const needsCis = Boolean(plan?.targets.includes("cis") || plan?.needsCurrentScheduleData);
    const cisStatus = coverage.cis.status;
    if (needsCis && cisStatus !== "success" && cisStatus !== "partial") {
      const detail = coverage.cis.detail || "CIS source coverage is unavailable.";
      return {
        error_log: `Required CIS source failed (${cisStatus}): ${detail}`,
      };
    }
    if (!needsMoodle) {
      return { error_log: null };
    }
    const status = coverage?.moodle.status ?? "not_requested";
    if (status === "success" || status === "partial") {
      if (!hasRequiredTopicEvidence(config.prompt, state.moodle_raw_text)) {
        return {
          error_log:
            "Required Moodle source is reachable, but it contains no evidence for the requested topic. Refusing to generate a misleading PDF.",
        };
      }
      if (isDcDcRequest(config.prompt) && coverage.moodle.artifacts.length === 0) {
        return {
          error_log:
            "The DC-DC source page was found, but no readable Moodle file was downloaded. Refusing to generate an incomplete calculation document.",
        };
      }
      if (expectsDownloadedSourceEvidence(config.prompt) && coverage.moodle.artifacts.length === 0) {
        return {
          error_log:
            "The request asks for Moodle files, slides, PDFs, downloads, or screenshots, but no readable Moodle file was downloaded. Refusing to generate a source-weak document.",
        };
      }
      return { error_log: null };
    }
    const detail = coverage?.moodle.detail || "Moodle source coverage is unavailable.";
    return {
      error_log: `Required Moodle source failed (${status}): ${detail}`,
    };
  };
}

function routeAfterSourceGate(state: LangGraphAgentState): "analyzer" | "abort" {
  return state.error_log ? "abort" : "analyzer";
}

async function runDiagnosticOnly(config: MoodleRuntimeConfig): Promise<AgentState> {
  await config.diagnostics?.log("info", "diagnostic", "Running diagnostic-only Moodle/CIS probe.");
  const moodleState = await createScraperNode({
    ...config,
    maxPages: Math.min(config.maxPages, 3),
    maxDepth: 1,
    allowFileDownloads: false,
  })(initialAgentState);
  const stateAfterMoodle = { ...initialAgentState, ...moodleState };
  const cisState = await createCisScraperNode({
    ...config,
    maxCisPages: Math.min(config.maxCisPages, 3),
    maxDepth: 1,
    allowFileDownloads: false,
  })(stateAfterMoodle);
  return {
    ...stateAfterMoodle,
    ...cisState,
    final_document: "",
    error_log: null,
  };
}

function routeAfterAnalyzer(state: LangGraphAgentState): "analyzer" | "formatter" | "abort" {
  if (!state.error_log) {
    return "formatter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "analyzer";
}

function routeAfterExtractionAnalyzer(state: LangGraphAgentState): "analyzer" | "done" | "abort" {
  if (!state.error_log) {
    return "done";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "analyzer";
}

function routeAfterFormatter(state: LangGraphAgentState): "formatter" | "diskWriter" | "abort" {
  if (!state.error_log) {
    return "diskWriter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "formatter";
}

function isCoverageComplete(
  config: MoodleRuntimeConfig,
  coverage: ReturnType<RunDiagnostics["getCoverage"]>,
): boolean {
  const plan = config.sourcePlan;
  const needsMoodle = !plan || plan.targets.includes("moodle");
  const needsCis = Boolean(plan?.targets.includes("cis"));
  const moodleOk =
    !needsMoodle ||
    coverage.moodle.status === "success" ||
    coverage.moodle.status === "partial";
  const cisOk =
    !needsCis ||
    coverage.cis.status === "success" ||
    coverage.cis.status === "partial";
  return moodleOk && cisOk;
}

export async function persistRunDiagnostics(
  config: MoodleRuntimeConfig,
  state: AgentState,
): Promise<void> {
  await mkdir(config.runDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(config.runDir, "moodle_raw.txt"), state.moodle_raw_text, "utf8"),
    writeJson(path.join(config.runDir, "state.json"), {
      ...state,
      moodle_raw_text: state.moodle_raw_text ? "[see moodle_raw.txt]" : "",
      final_document: state.final_document ? "[see document.typ]" : "",
    }),
    writeFile(path.join(config.runDir, "error.log"), state.error_log ?? "", "utf8"),
  ]);
}

async function existingPdfPath(outputPath: string): Promise<string | undefined> {
  const pdfPath = typstPdfPath(outputPath);
  const pdfStat = await stat(pdfPath).catch(() => null);
  return pdfStat?.isFile() && pdfStat.size > 0 ? pdfPath : undefined;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadSourceCoverage(sourceRunDir: string | undefined): Promise<SourceCoverage> {
  if (!sourceRunDir) {
    throw new Error("Render stage requires --source-run-dir.");
  }
  const coveragePath = path.join(sourceRunDir, "source_coverage.json");
  return JSON.parse(await readFile(coveragePath, "utf8")) as SourceCoverage;
}

async function loadRenderState(sourceRunDir: string | undefined): Promise<AgentState> {
  if (!sourceRunDir) {
    throw new Error("Render stage requires --source-run-dir.");
  }
  const [summary, errorLog, rawText, extractedText] = await Promise.all([
    readFile(path.join(sourceRunDir, "run-summary.md"), "utf8"),
    readFile(path.join(sourceRunDir, "error.log"), "utf8"),
    readFile(path.join(sourceRunDir, "moodle_raw.txt"), "utf8"),
    readFile(path.join(sourceRunDir, "extracted-data.json"), "utf8"),
  ]);
  if (!/^Run status:\s*success$/m.test(summary) || errorLog.trim()) {
    throw new Error(`Render source is not a successful extraction run: ${sourceRunDir}`);
  }
  return {
    ...initialAgentState,
    moodle_raw_text: rawText,
    extracted_data: validateExtractedData(JSON.parse(extractedText)),
  };
}

async function withRuntimeGuard<T>(
  config: MoodleRuntimeConfig,
  abortController: AbortController,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let heartbeat: NodeJS.Timeout | null = null;
  let guard: NodeJS.Timeout | null = null;
  try {
    heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      const idleSeconds = config.diagnostics
        ? Math.round((Date.now() - config.diagnostics.lastActivityAt) / 1000)
        : elapsedSeconds;
      void config.diagnostics?.log(
        "info",
        "diagnostic",
        `Heartbeat: run still active, ${elapsedSeconds}s elapsed, ${idleSeconds}s idle.`,
      );
    }, 15_000);
    guard = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const idleMs = config.diagnostics
        ? Date.now() - config.diagnostics.lastActivityAt
        : elapsedMs;
      const reason =
        elapsedMs >= config.maxRuntimeMs
          ? `Study Buddy run timed out after ${config.maxRuntimeMs}ms.`
          : idleMs >= config.idleTimeoutMs
            ? `Study Buddy run timed out after ${config.idleTimeoutMs}ms without pipeline progress.`
            : null;
      if (!reason || abortController.signal.aborted) {
        return;
      }
      void config.diagnostics?.log("error", "cleanup", reason);
      abortController.abort(new StudyBuddyTimeoutError(reason));
    }, 1_000);
    return await raceWithAbort(run(), abortController.signal);
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    if (guard) {
      clearInterval(guard);
    }
  }
}
