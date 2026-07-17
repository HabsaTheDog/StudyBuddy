import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createCodexClient, type CodexClient } from "./codexClient.js";
import { createWebLayoutRuntimeConfig, sanitizeWebLayoutConfig } from "./config.js";
import { WebLayoutRunDiagnostics } from "./runDiagnostics.js";
import { initialWebLayoutState, type WebLayoutState, WebLayoutStateAnnotation, type LangGraphWebLayoutState } from "./state.js";
import type { WebLayoutInput, WebLayoutResult, WebLayoutRuntimeConfig } from "./types.js";
import { createDiskWriterNode } from "./nodes/diskWriterNode.js";
import { createGeneratorNode } from "./nodes/generatorNode.js";
import { createPlannerNode } from "./nodes/plannerNode.js";
import { createSourceNode } from "./nodes/sourceNode.js";
import { createValidatorNode } from "./nodes/validatorNode.js";
import { createQualityReviewerNode } from "./nodes/qualityReviewerNode.js";

const MAX_RETRIES = 3;

export interface WebLayoutGraphDependencies {
  codex?: CodexClient;
  sourceNode?: ReturnType<typeof createSourceNode>;
  plannerNode?: ReturnType<typeof createPlannerNode>;
  generatorNode?: ReturnType<typeof createGeneratorNode>;
  validatorNode?: ReturnType<typeof createValidatorNode>;
  qualityReviewerNode?: ReturnType<typeof createQualityReviewerNode>;
  diskWriterNode?: ReturnType<typeof createDiskWriterNode>;
}

export async function runWebLayoutGraph(
  input: WebLayoutInput,
  dependencies: WebLayoutGraphDependencies = {},
): Promise<WebLayoutResult> {
  const baseConfig = createWebLayoutRuntimeConfig(input);
  const diagnostics = new WebLayoutRunDiagnostics({ runDir: baseConfig.runDir });
  await diagnostics.init();
  const abortController = new AbortController();
  const config: WebLayoutRuntimeConfig = {
    ...baseConfig,
    diagnostics,
    abortSignal: abortController.signal,
  };
  await diagnostics.log("info", "config", `Run directory: ${config.runDir}`);
  await writeJson(path.join(config.runDir, "config.json"), sanitizeWebLayoutConfig(config));

  let state: WebLayoutState = initialWebLayoutState;
  try {
    const graph = buildWebLayoutGraph(config, dependencies);
    state = (await withRuntimeGuard(
      config,
      abortController,
      () => graph.invoke(initialWebLayoutState),
    )) as WebLayoutState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state = {
      ...state,
      error_log: message,
    };
    await diagnostics.log("error", "cleanup", `Web layout graph failed: ${message}`);
  }

  const outputExists = await fileExistsAndNonEmpty(config.outputPath);
  const validationReportPath = path.join(config.runDir, "validation-report.json");
  const validationReportExists = await fileExistsAndNonEmpty(validationReportPath);
  const screenshotPaths = extractScreenshotPaths(state);
  if (!state.error_log && state.html_document.trim() && !outputExists) {
    state = {
      ...state,
      error_log: "HTML generation did not produce a readable document.html artifact.",
    };
  }

  await persistRunArtifacts(config, state);
  const ok = !state.error_log && outputExists && validationReportExists;
  await diagnostics.writeSummary({
    status: ok ? "success" : state.error_log?.startsWith("Study Buddy web layout run timed out") ? "timeout" : "failed",
    prompt: config.prompt,
    outputPath: ok ? config.outputPath : undefined,
    validationReportPath: validationReportExists ? validationReportPath : undefined,
    screenshotPaths,
    error: state.error_log ?? undefined,
    stateHasSource: Boolean(state.source_text.trim()),
    stateHasLayoutSpec: Object.keys(state.layout_spec).length > 0,
    stateHasHtml: Boolean(state.html_document.trim()),
  });

  return {
    ok,
    outputPath: ok ? config.outputPath : undefined,
    runDir: config.runDir,
    runSummaryPath: diagnostics.runSummaryPath,
    state,
    error: state.error_log ?? undefined,
    validationReportPath: validationReportExists ? validationReportPath : undefined,
    screenshotPaths,
  };
}

export function buildWebLayoutGraph(
  config: WebLayoutRuntimeConfig,
  dependencies: WebLayoutGraphDependencies = {},
) {
  const codex =
    dependencies.codex ??
    (!dependencies.plannerNode ||
    !dependencies.generatorNode ||
    !dependencies.qualityReviewerNode
      ? createCodexClient(config)
      : undefined);
  return new StateGraph(WebLayoutStateAnnotation)
    .addNode("source", dependencies.sourceNode ?? createSourceNode(config))
    .addNode("planner", dependencies.plannerNode ?? createPlannerNode(config, codex!))
    .addNode("generator", dependencies.generatorNode ?? createGeneratorNode(config, codex!))
    .addNode("validator", dependencies.validatorNode ?? createValidatorNode(config))
    .addNode(
      "qualityReviewer",
      dependencies.qualityReviewerNode ?? createQualityReviewerNode(config, codex!),
    )
    .addNode("diskWriter", dependencies.diskWriterNode ?? createDiskWriterNode(config))
    .addEdge(START, "source")
    .addConditionalEdges("source", routeAfterSource, {
      planner: "planner",
      abort: END,
    })
    .addConditionalEdges("planner", routeAfterPlanner, {
      planner: "planner",
      generator: "generator",
      abort: END,
    })
    .addConditionalEdges("generator", routeAfterGenerator, {
      generator: "generator",
      validator: "validator",
      abort: END,
    })
    .addConditionalEdges("validator", routeAfterValidator, {
      generator: "generator",
      diskWriter: "qualityReviewer",
      abort: END,
    })
    .addConditionalEdges("qualityReviewer", routeAfterQualityReview, {
      generator: "generator",
      diskWriter: "diskWriter",
      abort: END,
    })
    .addEdge("diskWriter", END)
    .compile();
}

function routeAfterSource(state: LangGraphWebLayoutState): "planner" | "abort" {
  return state.error_log ? "abort" : "planner";
}

function routeAfterPlanner(state: LangGraphWebLayoutState): "planner" | "generator" | "abort" {
  if (!state.error_log) {
    return "generator";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "planner";
}

function routeAfterGenerator(state: LangGraphWebLayoutState): "generator" | "validator" | "abort" {
  if (!state.error_log) {
    return "validator";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "generator";
}

function routeAfterValidator(state: LangGraphWebLayoutState): "generator" | "diskWriter" | "abort" {
  if (!state.error_log) {
    return "diskWriter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "generator";
}

function routeAfterQualityReview(
  state: LangGraphWebLayoutState,
): "generator" | "diskWriter" | "abort" {
  if (!state.error_log) return "diskWriter";
  return state.retry_count >= MAX_RETRIES ? "abort" : "generator";
}

async function persistRunArtifacts(config: WebLayoutRuntimeConfig, state: WebLayoutState): Promise<void> {
  await mkdir(config.runDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(config.runDir, "source.txt"), state.source_text, "utf8"),
    writeJson(path.join(config.runDir, "layout-spec.json"), state.layout_spec),
    writeJson(path.join(config.runDir, "validation-report.json"), state.validation_report),
    writeJson(path.join(config.runDir, "state.json"), {
      ...state,
      source_text: state.source_text ? "[see source.txt]" : "",
      html_document: state.html_document ? "[see document.html]" : "",
    }),
    writeFile(path.join(config.runDir, "error.log"), state.error_log ?? "", "utf8"),
  ]);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fileExistsAndNonEmpty(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isFile() && fileStat.size > 0);
}

function extractScreenshotPaths(state: WebLayoutState): string[] {
  const value = state.validation_report.screenshotPaths;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function withRuntimeGuard<T>(
  config: WebLayoutRuntimeConfig,
  abortController: AbortController,
  run: () => Promise<T>,
): Promise<T> {
  let heartbeat: NodeJS.Timeout | null = null;
  let guard: NodeJS.Timeout | null = null;
  const startedAt = Date.now();
  try {
    heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      const idleSeconds = config.diagnostics
        ? Math.round((Date.now() - config.diagnostics.lastActivityAt) / 1000)
        : elapsedSeconds;
      void config.diagnostics?.log("info", "cleanup", `Heartbeat: web layout run active, ${elapsedSeconds}s elapsed, ${idleSeconds}s idle.`);
    }, 15_000);
    guard = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      const idleMs = config.diagnostics ? Date.now() - config.diagnostics.lastActivityAt : elapsedMs;
      const reason =
        elapsedMs >= config.maxRuntimeMs
          ? `Study Buddy web layout run timed out after ${config.maxRuntimeMs}ms.`
          : idleMs >= config.idleTimeoutMs
            ? `Study Buddy web layout run timed out after ${config.idleTimeoutMs}ms without pipeline progress.`
            : null;
      if (!reason || abortController.signal.aborted) {
        return;
      }
      abortController.abort(new Error(reason));
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

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Run aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
