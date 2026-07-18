import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createCodexClient, type CodexClient } from "./codexClient.js";
import { createWebLayoutRuntimeConfig, sanitizeWebLayoutConfig } from "./config.js";
import { WebLayoutRunDiagnostics } from "./runDiagnostics.js";
import { initialWebLayoutState, type JsonObject, type WebLayoutState, WebLayoutStateAnnotation, type LangGraphWebLayoutState } from "./state.js";
import type { WebLayoutInput, WebLayoutResult, WebLayoutRuntimeConfig } from "./types.js";
import { validateWebLayoutFile, validationReportToJson } from "./validation.js";
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
    state = config.resumeRunDir
      ? await loadResumeState(config)
      : initialWebLayoutState;
    const graph = buildWebLayoutGraph(config, dependencies);
    state = (await withRuntimeGuard(
      config,
      abortController,
      () => graph.invoke(state),
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
  const artifactSummary = extractArtifactSummary(state);
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
    sourceBundlePath: artifactSummary?.sourceBundlePath,
    mediaManifestPath: artifactSummary?.mediaManifestPath,
    artifactBytes: artifactSummary?.artifactBytes,
    embeddedAssetBytes: artifactSummary?.embeddedAssetBytes,
    estimatedDecodedImageBytes: artifactSummary?.estimatedDecodedImageBytes,
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
    .addNode("resumeValidator", createResumeValidatorNode(config))
    .addNode(
      "qualityReviewer",
      dependencies.qualityReviewerNode ?? createQualityReviewerNode(config, codex!),
    )
    .addNode("diskWriter", dependencies.diskWriterNode ?? createDiskWriterNode(config))
    .addConditionalEdges(START, (state) => routeAtStart(config, state), {
      source: "source",
      planner: "planner",
      resumeValidator: "resumeValidator",
      qualityReviewer: "qualityReviewer",
    })
    .addConditionalEdges("source", (state) => routeAfterSource(config, state), {
      planner: "planner",
      resumeValidator: "resumeValidator",
      qualityReviewer: "qualityReviewer",
      abort: END,
    })
    .addConditionalEdges("planner", (state) => routeAfterPlanner(config, state), {
      planner: "planner",
      generator: "generator",
      resumeValidator: "resumeValidator",
      qualityReviewer: "qualityReviewer",
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
    .addConditionalEdges("resumeValidator", routeAfterValidator, {
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

function routeAtStart(
  config: WebLayoutRuntimeConfig,
  state: LangGraphWebLayoutState,
): "source" | "planner" | "resumeValidator" | "qualityReviewer" {
  if (!config.resumeRunDir || !state.html_document.trim()) return "source";
  if (!state.source_text.trim() || Object.keys(state.layout_spec).length === 0) return "planner";
  if (Object.keys(state.validation_report).length === 0) return "resumeValidator";
  return "qualityReviewer";
}

function routeAfterSource(
  config: WebLayoutRuntimeConfig,
  state: LangGraphWebLayoutState,
): "planner" | "resumeValidator" | "qualityReviewer" | "abort" {
  if (state.error_log) return "abort";
  if (!config.resumeRunDir || !state.html_document.trim()) return "planner";
  if (Object.keys(state.layout_spec).length === 0) return "planner";
  return Object.keys(state.validation_report).length === 0 ? "resumeValidator" : "qualityReviewer";
}

function routeAfterPlanner(
  config: WebLayoutRuntimeConfig,
  state: LangGraphWebLayoutState,
): "planner" | "generator" | "resumeValidator" | "qualityReviewer" | "abort" {
  if (!state.error_log) {
    if (config.resumeRunDir && state.html_document.trim()) {
      return Object.keys(state.validation_report).length === 0 ? "resumeValidator" : "qualityReviewer";
    }
    return "generator";
  }
  return state.planner_retry_count >= MAX_RETRIES ? "abort" : "planner";
}

function createResumeValidatorNode(config: WebLayoutRuntimeConfig) {
  return async function resumeValidatorNode(
    state: LangGraphWebLayoutState,
  ): Promise<Partial<LangGraphWebLayoutState>> {
    const buildPath = path.join(config.runDir, ".build", "document.html");
    try {
      const report = await validateWebLayoutFile(
        state.html_document,
        buildPath,
        config.kind,
        {
          runDir: config.runDir,
          headed: config.browserHeaded,
          skip: config.skipBrowserValidation,
        },
      );
      const buildStat = await stat(buildPath);
      const validationReport: JsonObject = {
        ...validationReportToJson(report),
        artifact: {
          buildPath,
          artifactBytes: buildStat.size,
          maxArtifactBytes: config.maxArtifactBytes,
          sizeClass: buildStat.size >= 10_000_000 ? "large" : "standard",
          assetCount: 0,
          warnings: ["Resumed a previously bundled single-file artifact without re-running asset preparation."],
        },
      };
      if (!report.ok) {
        const message = `Resumed HTML validation failed:\n- ${report.issues.map((entry) => entry.message).join("\n- ")}`;
        await config.diagnostics?.log("warn", "validator", message);
        return {
          validation_report: validationReport,
          error_log: message,
          retry_count: state.retry_count + 1,
          validator_retry_count: state.validator_retry_count + 1,
        };
      }
      await config.diagnostics?.log("info", "validator", "Resumed bundled HTML validation passed.");
      return { validation_report: validationReport, error_log: null };
    } catch (error) {
      const message = `Resumed HTML validation failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        validation_report: { ok: false, issues: [{ code: "resume-validation", message }] },
        error_log: message,
        retry_count: state.retry_count + 1,
        validator_retry_count: state.validator_retry_count + 1,
      };
    }
  };
}

function routeAfterGenerator(state: LangGraphWebLayoutState): "generator" | "validator" | "abort" {
  if (!state.error_log) {
    return "validator";
  }
  return state.generator_retry_count >= MAX_RETRIES ? "abort" : "generator";
}

function routeAfterValidator(state: LangGraphWebLayoutState): "generator" | "diskWriter" | "abort" {
  if (!state.error_log) {
    return "diskWriter";
  }
  return state.validator_retry_count >= MAX_RETRIES ? "abort" : "generator";
}

function routeAfterQualityReview(
  state: LangGraphWebLayoutState,
): "generator" | "diskWriter" | "abort" {
  if (!state.error_log) return "diskWriter";
  return state.quality_retry_count >= MAX_RETRIES ? "abort" : "generator";
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
      html_document: state.html_document ? "[see source/index.html and document.html]" : "",
    }),
    writeFile(path.join(config.runDir, "error.log"), state.error_log ?? "", "utf8"),
  ]);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadResumeState(config: WebLayoutRuntimeConfig): Promise<WebLayoutState> {
  const resumeDir = config.resumeRunDir;
  if (!resumeDir) return initialWebLayoutState;
  const [persistedSourceText, layoutSpec] = await Promise.all([
    readFile(path.join(resumeDir, "source.txt"), "utf8").catch(() => ""),
    readOptionalResumeJson(path.join(resumeDir, "layout-spec.json")),
  ]);
  const sourceText = persistedSourceText.trim()
    ? persistedSourceText
    : await rebuildResumeSourceText(config, resumeDir);
  const sourceBuildPath = await firstNonEmptyFile([
    path.join(resumeDir, ".build", "document.html"),
    path.join(resumeDir, "document.html"),
  ]);
  if (!sourceBuildPath) {
    throw new Error(`Resume run has no non-empty validated HTML build: ${resumeDir}`);
  }
  const htmlDocument = await readFile(sourceBuildPath, "utf8");
  const targetBuildPath = path.join(config.runDir, ".build", "document.html");
  await mkdir(path.dirname(targetBuildPath), { recursive: true });
  await copyFile(sourceBuildPath, targetBuildPath);
  await config.diagnostics?.log("info", "config", `Resuming validated web-layout build from ${resumeDir}.`);
  return {
    source_text: sourceText,
    layout_spec: layoutSpec ?? {},
    html_document: htmlDocument,
    // A failed source run may contain a stale validation report for a rejected
    // candidate even though .build/document.html has already been restored to
    // the last-known-good artifact. Always validate the copied resume build so
    // quality review receives evidence for the HTML it is actually reviewing.
    validation_report: {},
    error_log: null,
    retry_count: 0,
    planner_retry_count: 0,
    generator_retry_count: 0,
    validator_retry_count: 0,
    quality_retry_count: 0,
  };
}

async function rebuildResumeSourceText(
  config: WebLayoutRuntimeConfig,
  resumeDir: string,
): Promise<string> {
  const result = await createSourceNode(config)();
  if (result.error_log || !result.source_text?.trim()) {
    throw new Error(
      `Resume source is empty and could not be reconstructed from configured local sources: ${resumeDir}. ` +
      (result.error_log ?? "No source text was produced."),
    );
  }
  await config.diagnostics?.log(
    "info",
    "source",
    `Reconstructed resume source from configured local handoff/files because ${resumeDir}/source.txt was empty.`,
  );
  return result.source_text;
}

async function readOptionalResumeJson(
  filePath: string,
): Promise<WebLayoutState["layout_spec"] | null> {
  const value = await readFile(filePath, "utf8").catch(() => "");
  if (!value.trim()) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && !Array.isArray(parsed) && typeof parsed === "object"
    ? parsed as WebLayoutState["layout_spec"]
    : null;
}

async function firstNonEmptyFile(filePaths: string[]): Promise<string | null> {
  for (const filePath of filePaths) {
    if (await fileExistsAndNonEmpty(filePath)) return filePath;
  }
  return null;
}


async function fileExistsAndNonEmpty(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isFile() && fileStat.size > 0);
}

function extractScreenshotPaths(state: WebLayoutState): string[] {
  const value = state.validation_report.screenshotPaths;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function extractArtifactSummary(state: WebLayoutState): {
  sourceBundlePath?: string;
  mediaManifestPath?: string;
  artifactBytes?: number;
  embeddedAssetBytes?: number;
  estimatedDecodedImageBytes?: number;
} | null {
  const value = state.validation_report.artifact;
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    sourceBundlePath: typeof record.sourceBundlePath === "string" ? record.sourceBundlePath : undefined,
    mediaManifestPath: typeof record.mediaManifestPath === "string" ? record.mediaManifestPath : undefined,
    artifactBytes: typeof record.artifactBytes === "number" ? record.artifactBytes : undefined,
    embeddedAssetBytes: typeof record.embeddedAssetBytes === "number" ? record.embeddedAssetBytes : undefined,
    estimatedDecodedImageBytes: typeof record.estimatedDecodedImageBytes === "number" ? record.estimatedDecodedImageBytes : undefined,
  };
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
