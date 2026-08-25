import { cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createCodexClient, type CodexClient } from "./codexClient.js";
import { AgentStateAnnotation, initialAgentState, type AgentState, type LangGraphAgentState } from "./state.js";
import type { MoodleGraphInput, MoodleGraphResult, MoodleRuntimeConfig } from "./types.js";
import { createRuntimeConfig, sanitizeConfig } from "./config.js";
import { RunDiagnostics, type SourceCoverage } from "./runDiagnostics.js";
import { raceWithAbort, StudyBuddyTimeoutError } from "./runtimeAbort.js";
import { extractedDataJsonSchema } from "./schemas.js";
import {
  createAnalyzerNode,
  reconcileRequestedCourseIdentity,
} from "./nodes/analyzerNode.js";
import { answerJsonPath, answerPath, createAnswerWriterNode } from "./nodes/answerWriterNode.js";
import { createCisScraperNode } from "./nodes/cisScraperNode.js";
import { createCalendarNode } from "./nodes/calendarNode.js";
import { createDiskWriterNode } from "./nodes/diskWriterNode.js";
import { createFormatterNode } from "./nodes/formatterNode.js";
import { createScraperNode } from "./nodes/scraperNode.js";
import { createCourseResolverNode } from "./nodes/courseResolverNode.js";
import { createVisualAssetResolverNode } from "./nodes/visualAssetResolverNode.js";
import { createVisualDiscoveryNode } from "./nodes/visualDiscoveryNode.js";
import { createVisualPlannerNode } from "./nodes/visualPlannerNode.js";
import { createPracticeVisualEvidenceNode } from "./practiceVisualEvidence.js";
import { createResourceManifestNode } from "./nodes/resourceManifestNode.js";
import { createEvidenceNode } from "./nodes/evidenceNode.js";
import { createEvidenceHandoffNode } from "./nodes/evidenceHandoffNode.js";
import { createRequestEvaluatorNode } from "./nodes/requestEvaluatorNode.js";
import { createCoverageNode } from "./nodes/coverageNode.js";
import { createStudyModelNode } from "./nodes/studyModelNode.js";
import { createReviewNode } from "./nodes/reviewNode.js";
import { createQualityReviewerNode } from "./nodes/qualityReviewerNode.js";
import {
  canFinalizePartialExtraction,
  createPartialExtractionFinalizerNode,
} from "./nodes/partialExtractionFinalizerNode.js";
import { createBundleWriterNode } from "./nodes/bundleWriterNode.js";
import { createSourceOrchestratorNode, createSourcePlannerNode } from "./sourceOrchestrator.js";
import {
  createSourceArchitectNode,
  createTargetedAcquisitionNode,
  MAX_LEARNING_MODULES,
  reconcileLearningArchitectureWithCatalog,
  routeAfterSourceArchitect,
  type CatalogEntry,
} from "./sourceArchitect.js";
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
import type { StudyBuddyIntent } from "./taskIntent.js";
import {
  CoverageAssessmentSchema,
  EvidencePackageSchema,
  ResourceManifestSchema,
  ReviewReportSchema,
  StudyModelSchema,
} from "./examNavigatorContracts.js";
import { hydrateExtractedVisualAssets } from "./visualAssets.js";
import { ExecutionTelemetry } from "./executionTelemetry.js";
import {
  resolveTaskModelPolicy,
  STUDY_BUDDY_MODEL_POLICY_VERSION,
  type StudyBuddyModelTask,
} from "./modelPolicy.js";
import {
  buildResourceManifest,
  repairResourceManifestCourseScope,
} from "./resourceManifest.js";
import { buildEvidencePackage } from "./evidencePackage.js";
import { assessExamNavigatorCoverage } from "./coveragePolicy.js";
import { buildStudyModel } from "./studyModel.js";
import { reviewStudyModel } from "./studentFirstReview.js";
import {
  createRequestContractIntegrity,
  REQUEST_CONTRACT_FILE,
  REQUEST_CONTRACT_INTEGRITY_FILE,
  RequestContractSchema,
  verifyRequestContractIntegrity,
  type RequestContract,
} from "../shared/requestContract.js";
import {
  boundLearningArchitecture,
  parseLearningArchitectureModelJson,
} from "./learningArchitecture.js";
import { resolveTaskBudget } from "./taskBudget.js";
import { inspectSystemDependencies } from "./systemDependencies.js";
import {
  CodexRuntimePreflightError,
  preflightCodexRuntime,
  type CodexRuntimeReport,
} from "./codexRuntime.js";
import {
  PENDING_EXTRACTION_REPAIRS_FILE,
  pendingExtractionRepairError,
  readPendingExtractionRepairs,
} from "./pendingExtractionRepairs.js";

const MAX_RETRIES = 3;
// Keep semantic repair inside the same global three-retry ceiling. Analyzer
// schema failures can consume an earlier retry before the first semantic
// review; using the full ceiling still leaves one localized quality repair in
// that case without permitting an unbounded whole-course loop.
const MAX_EXTRACTION_SEMANTIC_REVIEW_ATTEMPTS = MAX_RETRIES;
// Source-architect rounds and analyzer/formatter/reviewer repair loops are each
// independently bounded. The default LangGraph limit of 25 is too small for a
// legitimate worst-case path through those bounded loops.
const GRAPH_RECURSION_LIMIT = 60;
let typstPreflightPromise: Promise<void> | null = null;

export interface GraphDependencies {
  codex?: CodexClient;
  runtimePreflight?: (config: MoodleRuntimeConfig) => Promise<CodexRuntimeReport>;
  courseResolverNode?: ReturnType<typeof createCourseResolverNode>;
  scraperNode?: ReturnType<typeof createScraperNode>;
  cisScraperNode?: ReturnType<typeof createCisScraperNode>;
  calendarNode?: ReturnType<typeof createCalendarNode>;
}

export async function runMoodleGraph(
  input: MoodleGraphInput,
  dependencies: GraphDependencies = {},
): Promise<MoodleGraphResult> {
  const unvalidatedConfig = createRuntimeConfig(input);
  const validatedSourceRunDir = unvalidatedConfig.stage === "render"
    ? await validateRenderSource(unvalidatedConfig.sourceRunDir)
    : undefined;
  const validatedResumeRunDir = unvalidatedConfig.resumeExtractionRunDir
    ? await validateExtractionRecoverySource(unvalidatedConfig.resumeExtractionRunDir)
    : undefined;
  const baseConfig: MoodleRuntimeConfig = {
    ...unvalidatedConfig,
    ...(validatedSourceRunDir ? { sourceRunDir: validatedSourceRunDir } : {}),
    ...(validatedResumeRunDir ? { resumeExtractionRunDir: validatedResumeRunDir } : {}),
  };
  const initialCoverage = baseConfig.stage === "render"
    ? await loadSourceCoverage(baseConfig.sourceRunDir)
    : baseConfig.resumeExtractionRunDir
      ? await loadSourceCoverage(baseConfig.resumeExtractionRunDir)
      : undefined;
  const diagnostics = new RunDiagnostics({
    runDir: baseConfig.runDir,
    secrets: [
      baseConfig.username,
      baseConfig.password,
      baseConfig.cisUsername,
      baseConfig.cisPassword,
      baseConfig.calendarUrl,
    ].filter((value): value is string => Boolean(value)),
    initialCoverage,
  });
  await diagnostics.init();
  const executionTelemetry = new ExecutionTelemetry({
    runDir: baseConfig.runDir,
    policyVersion: STUDY_BUDDY_MODEL_POLICY_VERSION,
    profile: baseConfig.executionProfile,
    configuredDownloadConcurrency: baseConfig.downloadConcurrency,
  });
  await executionTelemetry.init();
  const abortController = new AbortController();
  const config: MoodleRuntimeConfig = {
    ...baseConfig,
    diagnostics,
    executionTelemetry,
    abortSignal: abortController.signal,
  };
  const needsRuntimePreflight = !config.diagnosticOnly && Boolean(dependencies.runtimePreflight || !dependencies.codex);
  await writeRunProgress(config, {
    status: "running",
    phase: needsRuntimePreflight ? "checking_runtime" : "planning_sources",
  });
  await diagnostics.log("info", "config", `Run directory: ${config.runDir}`);
  await writeJson(path.join(config.runDir, "config.json"), sanitizeConfig(config));
  await writeJson(path.join(config.runDir, "schema.json"), extractedDataJsonSchema);

  let state: AgentState = initialAgentState;
  let codexRuntime: CodexRuntimeReport | undefined;
  let route: StudyBuddyIntent = baseConfig.intentDecision?.intent ?? (
    baseConfig.stage === "extract"
      ? "extraction"
      : baseConfig.stage === "render"
        ? "render"
        : "document"
  );
  try {
    const systemDependencies = await inspectSystemDependencies();
    const dependencyDiagnosticsPath = path.join(config.runDir, "runtime-dependencies.json");
    await writeJson(dependencyDiagnosticsPath, systemDependencies);
    await diagnostics.updateCoverage("moodle", { artifacts: [dependencyDiagnosticsPath] });
    if (config.diagnosticOnly) {
      route = "diagnostic";
      state = await runDiagnosticOnly(config);
    } else {
      if (needsRuntimePreflight) {
        const runtimePreflight = dependencies.runtimePreflight ?? ((runtimeConfig) =>
          preflightCodexRuntime({
            runDir: runtimeConfig.runDir,
            cacheDir: runtimeConfig.runtimeCacheDir,
            codexPath: runtimeConfig.codexPath,
            models: resolvePreflightModels(runtimeConfig),
            explicitModel: runtimeConfig.codexModelExplicit,
            fallbackModel: runtimeConfig.codexCompatibilityFallbackModel,
            mode: runtimeConfig.codexPreflightMode,
            diagnostics: runtimeConfig.diagnostics,
          }));
        codexRuntime = await runtimePreflight(config);
        if (codexRuntime.fallbackApplied) {
          config.codexModel = codexRuntime.fallbackApplied;
          await writeJson(path.join(config.runDir, "config.json"), sanitizeConfig(config));
        }
      }
      if (
        config.stage !== "render" &&
        !config.resumeExtractionRunDir &&
        config.intentDecision?.needsDownloadedFiles
      ) {
        if (!systemDependencies.dependencies.pdftotext.available) {
          await diagnostics.log("warn", "analyzer", `pdftotext is unavailable; PDF text extraction may be incomplete. ${systemDependencies.dependencies.pdftotext.remediation.join(" or ")}`);
        }
        if (!systemDependencies.dependencies.pdftoppm.available && config.visualsEnabled) {
          await diagnostics.log("warn", "analyzer", `pdftoppm is unavailable; selected PDF pages cannot be rendered for the visual asset pipeline. ${systemDependencies.dependencies.pdftoppm.remediation.join(" or ")}`);
        }
      }
      const initialStateForStage = config.stage === "render"
        ? await loadRenderState(config)
        : config.resumeExtractionRunDir
          ? await loadExtractionReviewState(config)
          : initialAgentState;
      if (config.resumeExtractionRunDir) {
        await diagnostics.markSuccess("moodle", {
          detail: `Reused persisted extraction handoff for normalization and quality review: ${config.resumeExtractionRunDir}`,
          urls: [initialStateForStage.resource_manifest.courseUrl ?? config.moodleUrl],
          pages: 1,
          partial: initialStateForStage.coverage_assessment.status !== "complete",
        });
      }
      if (config.stage !== "extract" && !config.intentDecision?.wantsQuickAnswer) {
        await ensureTypstPreflight();
        await diagnostics.log("info", "typst", "Study Buddy Typst toolchain preflight passed.");
      }
      const graph = config.stage === "extract"
        ? config.resumeExtractionRunDir
          ? buildExtractionReviewGraph(config, dependencies)
          : config.evidenceHandoffOnly
            ? buildEvidenceHandoffExtractionGraph(config, dependencies)
            : buildExtractionGraph(config, dependencies)
        : config.stage === "render"
          ? buildRenderGraph(config, dependencies)
          : config.intentDecision?.wantsQuickAnswer
            ? buildAnswerGraph(config, dependencies)
            : buildMoodleGraph(config, dependencies);
      state = (await withRuntimeGuard(
        config,
        abortController,
        () => graph.invoke(initialStateForStage, { recursionLimit: GRAPH_RECURSION_LIMIT }),
      )) as AgentState;
    }
  } catch (error) {
    if (error instanceof CodexRuntimePreflightError) {
      codexRuntime = error.report ?? codexRuntime;
      await diagnostics.log("error", "runtime", error.message, {
        updateCommand: error.updateCommand,
        effectiveCliVersion: error.report?.effectiveCliVersion,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    state = {
      ...state,
      error_log: message,
    };
    const coverage = diagnostics.getCoverage();
    if (
      !message.startsWith("Study Buddy Typst toolchain preflight failed") &&
      !(error instanceof CodexRuntimePreflightError) &&
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
  if (config.stage === "extract" && hasExtractedData) {
    try {
      await persistFinalExtractionArtifact(config.runDir, state.extracted_data);
    } catch (error) {
      state = {
        ...state,
        error_log: `Failed to persist final extraction artifact: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  const extractedDataPath = hasExtractedData
    ? await existingFilePath(path.join(config.runDir, "extracted-data.json"))
    : undefined;
  const answerArtifactPath = config.intentDecision?.wantsQuickAnswer ? await existingFilePath(answerPath(config)) : undefined;
  const answerDataArtifactPath = config.intentDecision?.wantsQuickAnswer
    ? await existingFilePath(answerJsonPath(config))
    : undefined;
  const pdfPath = hasDocument ? await existingPdfPath(config.outputPath) : undefined;
  const htmlPath = state.artifact_bundle?.htmlPath
    ? await existingFilePath(state.artifact_bundle.htmlPath)
    : undefined;
  if (
    !config.diagnosticOnly &&
    config.stage !== "extract" &&
    !config.intentDecision?.wantsQuickAnswer &&
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
          : config.intentDecision?.wantsQuickAnswer
            ? Boolean(answerArtifactPath && answerDataArtifactPath)
            : hasDocument && Boolean(pdfPath)
    );
  const sourceCoverage = diagnostics.getCoverage();
  const sourceFamiliesComplete = isCoverageComplete(config, sourceCoverage);
  const coverageComplete =
    sourceFamiliesComplete &&
    (
      config.intentDecision?.wantsQuickAnswer ||
      state.coverage_assessment.status === "complete"
    );
  await persistRunDiagnostics(config, state);
  const timedOut = state.error_log?.startsWith("Study Buddy run timed out") ?? false;
  await diagnostics.writeSummary({
    route,
    status: ok ? (coverageComplete ? "success" : "partial") : timedOut ? "timeout" : "failed",
    prompt: config.originalUserPrompt,
    taskPrompt: config.prompt,
    error: state.error_log ?? undefined,
    outputPath: ok && hasDocument && !config.intentDecision?.wantsQuickAnswer ? config.outputPath : undefined,
    pdfPath: config.intentDecision?.wantsQuickAnswer ? undefined : pdfPath,
    answerPath: answerArtifactPath,
    answerJsonPath: answerDataArtifactPath,
    stateHasRawText: Boolean(state.moodle_raw_text.trim()),
    stateHasDocument: hasDocument,
    extractedDataPath,
    codexRuntime,
  });
  const terminalStatus = ok ? (coverageComplete ? "success" : "partial") : timedOut ? "timeout" : "failed";
  await executionTelemetry.transitionPhase("finalizing");
  await executionTelemetry.complete(terminalStatus);
  await writeRunProgress(config, {
    status: terminalStatus,
    phase: "finalizing",
    error: state.error_log
      ? {
          message: state.error_log,
          retryable: !timedOut && !state.error_log.startsWith("Codex runtime preflight failed"),
        }
      : undefined,
    artifacts: {
      extractedDataPath,
      typstPath: ok && hasDocument && !config.intentDecision?.wantsQuickAnswer ? config.outputPath : undefined,
      pdfPath,
      answerPath: answerArtifactPath,
      answerJsonPath: answerDataArtifactPath,
    },
  }, { transitionTelemetry: false });

  return {
    ok,
    coverageComplete,
    outputPath: ok && hasDocument && !config.intentDecision?.wantsQuickAnswer ? config.outputPath : undefined,
    pdfPath: config.intentDecision?.wantsQuickAnswer ? undefined : pdfPath,
    answerPath: answerArtifactPath,
    answerJsonPath: answerDataArtifactPath,
    route,
    runDir: config.runDir,
    runSummaryPath: diagnostics.runSummaryPath,
    state,
    sourceCoverage,
    error: state.error_log ?? undefined,
    extractedDataPath,
    htmlPath,
    artifactBundle: state.artifact_bundle ?? undefined,
    metricsPath: executionTelemetry.metricsPath,
    codexRuntime,
  };
}

export function resolvePreflightModels(config: MoodleRuntimeConfig): string[] {
  const tasks: StudyBuddyModelTask[] = config.stage === "render"
    ? ["artifact_builder", "artifact_repair", "quality_reviewer"]
    : config.stage === "extract"
      ? config.evidenceHandoffOnly
        ? ["artifact_planner"]
        : [
          "artifact_planner",
          "content_analyzer",
          "content_repair",
          "quality_reviewer",
        ]
      : config.intentDecision?.wantsQuickAnswer
        ? ["content_analyzer", "content_repair"]
        : [
            "artifact_planner",
            "content_analyzer",
            "content_repair",
            "artifact_builder",
            "artifact_repair",
            "quality_reviewer",
          ];
  return [...new Set(tasks.flatMap((task) => {
    const primary = resolveTaskModelPolicy({
      profile: config.executionProfile,
      task,
      attempt: 1,
      globalModel: config.codexModel,
      globalReasoningEffort: config.codexReasoningEffort,
      overrides: config.modelPolicyOverrides,
    });
    const escalation = resolveTaskModelPolicy({
      profile: config.executionProfile,
      task,
      attempt: 2,
      globalModel: config.codexModel,
      globalReasoningEffort: config.codexReasoningEffort,
      overrides: config.modelPolicyOverrides,
    });
    return [primary.model, escalation.model];
  }))];
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
  course: "Study Buddy",
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

function resolveCourseResolverNode(
  config: MoodleRuntimeConfig,
  codex: CodexClient,
  dependencies: GraphDependencies,
): ReturnType<typeof createCourseResolverNode> {
  if (dependencies.courseResolverNode) return dependencies.courseResolverNode;
  if (dependencies.scraperNode) {
    return async () => ({ error_log: null });
  }
  return createCourseResolverNode(config, codex);
}

function createRequestContractCheckpointNode(config: MoodleRuntimeConfig) {
  return async function requestContractCheckpointNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const contractHash = await persistVerifiedRequestContract(
      config.runDir,
      state.request_contract,
      "extraction",
    );
    return { request_contract_hash: contractHash, error_log: null };
  };
}

export async function persistVerifiedRequestContract(
  runDir: string,
  contract: RequestContract,
  context: string,
): Promise<string> {
  const parsedContract = RequestContractSchema.parse(contract);
  const integrity = createRequestContractIntegrity(parsedContract);
  const [existingContractText, existingIntegrityText] = await Promise.all([
    readOptional(path.join(runDir, REQUEST_CONTRACT_FILE)),
    readOptional(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE)),
  ]);
  if (Boolean(existingContractText) !== Boolean(existingIntegrityText)) {
    throw new Error(
      `Request contract integrity pair is incomplete in ${context}; both contract and integrity files are required.`,
    );
  }
  if (existingContractText && existingIntegrityText) {
    const existingContract = RequestContractSchema.parse(JSON.parse(existingContractText));
    const existingIntegrity = verifyRequestContractIntegrity(
      existingContract,
      JSON.parse(existingIntegrityText),
    );
    if (existingIntegrity.contractHash !== integrity.contractHash) {
      const samePromptRevision = context === "extraction" &&
        existingContract.originalPrompt === parsedContract.originalPrompt;
      if (samePromptRevision) {
        await Promise.all([
          writeJson(path.join(runDir, REQUEST_CONTRACT_FILE), parsedContract),
          writeJson(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE), integrity),
        ]);
        return integrity.contractHash;
      }
      throw new Error(
        `Request contract mismatch in ${context}: existing ${existingIntegrity.contractHash}, incoming ${integrity.contractHash}.`,
      );
    }
  }
  await Promise.all([
    writeJson(path.join(runDir, REQUEST_CONTRACT_FILE), parsedContract),
    writeJson(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE), integrity),
  ]);
  return integrity.contractHash;
}

async function loadVerifiedRequestContract(
  runDir: string,
  context: string,
): Promise<{ contract: RequestContract; contractHash: string }> {
  const [contractText, integrityText] = await Promise.all([
    readOptional(path.join(runDir, REQUEST_CONTRACT_FILE)),
    readOptional(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE)),
  ]);
  if (!contractText || !integrityText) {
    const missing = [
      !contractText ? REQUEST_CONTRACT_FILE : null,
      !integrityText ? REQUEST_CONTRACT_INTEGRITY_FILE : null,
    ].filter(Boolean).join(", ");
    throw new Error(
      `Verified RequestContract required for ${context}; missing ${missing} in ${runDir}.`,
    );
  }
  const contract = RequestContractSchema.parse(JSON.parse(contractText));
  const integrity = verifyRequestContractIntegrity(contract, JSON.parse(integrityText));
  return { contract, contractHash: integrity.contractHash };
}

export function buildMoodleGraph(config: MoodleRuntimeConfig, dependencies: GraphDependencies = {}) {
  const codex = dependencies.codex ?? createCodexClient(config);

  return new StateGraph(AgentStateAnnotation)
    .addNode("sourcePlanner", createSourcePlannerNode(config))
    .addNode("courseResolver", resolveCourseResolverNode(config, codex, dependencies))
    .addNode("sourceOrchestrator", createSourceOrchestratorNode(config, dependencies))
    .addNode("resourceManifest", createResourceManifestNode(config))
    .addNode("evidence", createEvidenceNode(config))
    .addNode("requestEvaluator", createRequestEvaluatorNode(config, codex))
    .addNode("requestContractCheckpoint", createRequestContractCheckpointNode(config))
    .addNode("sourceArchitect", createSourceArchitectNode(config, codex))
    .addNode("targetedAcquisition", createTargetedAcquisitionNode(config))
    .addNode("coverage", createCoverageNode(config))
    .addNode("sourceGate", createSourceGateNode(config))
    .addNode("visualPlanner", createVisualPlannerNode(config, codex))
    .addNode("visualDiscovery", createVisualDiscoveryNode(config))
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addNode("partialFinalizer", createPartialExtractionFinalizerNode(config))
    .addNode("formatter", createFormatterNode(config, codex))
    .addNode("qualityReviewer", createQualityReviewerNode(config, codex))
    .addNode("studyModel", createStudyModelNode(config))
    .addNode("review", createReviewNode(config))
    .addNode("diskWriter", createDiskWriterNode(config, codex))
    .addNode("pdfPostRenderGate", checkpointPdfPostRenderReview)
    .addNode("bundleWriter", createBundleWriterNode(config))
    .addEdge(START, "sourcePlanner")
    .addEdge("sourcePlanner", "courseResolver")
    .addConditionalEdges("courseResolver", routeAfterCourseResolver, {
      sourceOrchestrator: "sourceOrchestrator",
      abort: END,
    })
    .addEdge("sourceOrchestrator", "resourceManifest")
    .addEdge("resourceManifest", "evidence")
    .addEdge("evidence", "requestEvaluator")
    .addEdge("requestEvaluator", "requestContractCheckpoint")
    .addEdge("requestContractCheckpoint", "sourceArchitect")
    .addConditionalEdges("sourceArchitect", routeAfterSourceArchitect, {
      targetedAcquisition: "targetedAcquisition",
      coverage: "coverage",
      abort: END,
    })
    .addEdge("targetedAcquisition", "resourceManifest")
    .addConditionalEdges("coverage", routeAfterCoverage, {
      sourceGate: "sourceGate",
      abort: END,
    })
    .addConditionalEdges("sourceGate", routeAfterSourceGate, {
      analyzer: "visualPlanner",
      abort: END,
    })
    .addEdge("visualPlanner", "visualDiscovery")
    .addEdge("visualDiscovery", "analyzer")
    .addConditionalEdges("analyzer", routeAfterAnalyzer, {
      analyzer: "analyzer",
      formatter: "studyModel",
      partialFinalizer: "partialFinalizer",
      abort: END,
    })
    .addConditionalEdges("partialFinalizer", routeAfterPartialFinalizer, {
      studyModel: "studyModel",
      abort: END,
    })
    .addConditionalEdges("studyModel", routeAfterStudyModel, {
      studyModel: "studyModel",
      review: "review",
      abort: END,
    })
    .addConditionalEdges("review", routeAfterReview, {
      analyzer: "analyzer",
      formatter: "formatter",
      done: END,
      abort: END,
    })
    .addConditionalEdges("formatter", routeAfterFormatter, {
      formatter: "formatter",
      diskWriter: "qualityReviewer",
      abort: END,
    })
    .addConditionalEdges("qualityReviewer", routeAfterArtifactQualityReview, {
      artifactBuilder: "formatter",
      qualityReviewer: "qualityReviewer",
      done: "diskWriter",
      abort: END,
    })
    .addEdge("diskWriter", "pdfPostRenderGate")
    .addConditionalEdges("pdfPostRenderGate", routeAfterPdfPostRenderReview, {
      formatter: "formatter",
      bundleWriter: "bundleWriter",
      abort: END,
    })
    .addEdge("bundleWriter", END)
    .compile();
}

export function buildAnswerGraph(config: MoodleRuntimeConfig, dependencies: GraphDependencies = {}) {
  const codex = dependencies.codex ?? createCodexClient(config);

  return new StateGraph(AgentStateAnnotation)
    .addNode("sourcePlanner", createSourcePlannerNode(config))
    .addNode("courseResolver", resolveCourseResolverNode(config, codex, dependencies))
    .addNode("sourceOrchestrator", createSourceOrchestratorNode(config, dependencies))
    .addNode("sourceGate", createSourceGateNode(config))
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addNode("answerWriter", createAnswerWriterNode(config))
    .addEdge(START, "sourcePlanner")
    .addEdge("sourcePlanner", "courseResolver")
    .addConditionalEdges("courseResolver", routeAfterCourseResolver, {
      sourceOrchestrator: "sourceOrchestrator",
      abort: END,
    })
    .addEdge("sourceOrchestrator", "sourceGate")
    .addConditionalEdges("sourceGate", (state) => routeAfterAnswerSourceGate(config, state), {
      analyzer: "analyzer",
      answerWriter: "answerWriter",
      abort: END,
    })
    .addConditionalEdges("analyzer", routeAfterAnswerAnalyzer, {
      analyzer: "analyzer",
      done: "answerWriter",
      abort: END,
    })
    .addEdge("answerWriter", END)
    .compile();
}

export function buildExtractionGraph(
  config: MoodleRuntimeConfig,
  dependencies: GraphDependencies = {},
) {
  const codex = dependencies.codex ?? createCodexClient(config);
  return new StateGraph(AgentStateAnnotation)
    .addNode("sourcePlanner", createSourcePlannerNode(config))
    .addNode("courseResolver", resolveCourseResolverNode(config, codex, dependencies))
    .addNode("sourceOrchestrator", createSourceOrchestratorNode(config, dependencies))
    .addNode("resourceManifest", createResourceManifestNode(config))
    .addNode("evidence", createEvidenceNode(config))
    .addNode("requestEvaluator", createRequestEvaluatorNode(config, codex))
    .addNode("requestContractCheckpoint", createRequestContractCheckpointNode(config))
    .addNode("sourceArchitect", createSourceArchitectNode(config, codex))
    .addNode("targetedAcquisition", createTargetedAcquisitionNode(config))
    .addNode("coverage", createCoverageNode(config))
    .addNode("sourceGate", createSourceGateNode(config))
    .addNode("visualPlanner", createVisualPlannerNode(config, codex))
    .addNode("visualDiscovery", createVisualDiscoveryNode(config))
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addNode("partialFinalizer", createPartialExtractionFinalizerNode(config))
    .addNode("studyModel", createStudyModelNode(config))
    .addNode("review", createReviewNode(config))
    .addNode("qualityReviewer", createQualityReviewerNode(config, codex))
    .addEdge(START, "sourcePlanner")
    .addEdge("sourcePlanner", "courseResolver")
    .addConditionalEdges("courseResolver", routeAfterCourseResolver, {
      sourceOrchestrator: "sourceOrchestrator",
      abort: END,
    })
    .addEdge("sourceOrchestrator", "resourceManifest")
    .addEdge("resourceManifest", "evidence")
    .addEdge("evidence", "requestEvaluator")
    .addEdge("requestEvaluator", "requestContractCheckpoint")
    .addEdge("requestContractCheckpoint", "sourceArchitect")
    .addConditionalEdges("sourceArchitect", routeAfterSourceArchitect, {
      targetedAcquisition: "targetedAcquisition",
      coverage: "coverage",
      abort: END,
    })
    .addEdge("targetedAcquisition", "resourceManifest")
    .addConditionalEdges("coverage", routeAfterCoverage, {
      sourceGate: "sourceGate",
      abort: END,
    })
    .addConditionalEdges("sourceGate", routeAfterSourceGate, {
      analyzer: "visualPlanner",
      abort: END,
    })
    .addEdge("visualPlanner", "visualDiscovery")
    .addEdge("visualDiscovery", "analyzer")
    .addConditionalEdges("analyzer", routeAfterExtractionAnalyzer, {
      analyzer: "analyzer",
      done: "studyModel",
      partialFinalizer: "partialFinalizer",
      abort: END,
    })
    .addConditionalEdges("partialFinalizer", routeAfterPartialFinalizer, {
      studyModel: "studyModel",
      abort: END,
    })
    .addConditionalEdges("studyModel", routeAfterStudyModel, {
      studyModel: "studyModel",
      review: "review",
      abort: END,
    })
    .addConditionalEdges("review", routeAfterReview, {
      analyzer: "analyzer",
      formatter: "qualityReviewer",
      done: END,
      abort: END,
    })
    .addConditionalEdges("qualityReviewer", routeAfterExtractionQualityReview, {
      sourceArchitect: "sourceArchitect",
      contentAnalyzer: "analyzer",
      qualityReviewer: "qualityReviewer",
      partialFinalizer: "partialFinalizer",
      done: END,
      abort: END,
    })
    .compile();
}

/**
 * Source-only extraction for interactive Study Guides. It retains the real
 * Moodle resolver, browser, downloader, resource manifest, evidence package,
 * request-bound source architecture, targeted acquisition, and coverage gate,
 * but deliberately performs no teaching synthesis. The web-layout graph is
 * the single owner of that work.
 */
export function buildEvidenceHandoffExtractionGraph(
  config: MoodleRuntimeConfig,
  dependencies: GraphDependencies = {},
) {
  const codex = dependencies.codex ?? createCodexClient(config);
  return new StateGraph(AgentStateAnnotation)
    .addNode("sourcePlanner", createSourcePlannerNode(config))
    .addNode("courseResolver", resolveCourseResolverNode(config, codex, dependencies))
    .addNode("sourceOrchestrator", createSourceOrchestratorNode(config, dependencies))
    .addNode("resourceManifest", createResourceManifestNode(config))
    .addNode("evidence", createEvidenceNode(config))
    .addNode("requestEvaluator", createRequestEvaluatorNode(config, codex))
    .addNode("requestContractCheckpoint", createRequestContractCheckpointNode(config))
    .addNode("sourceArchitect", createSourceArchitectNode(config, codex))
    .addNode("targetedAcquisition", createTargetedAcquisitionNode(config))
    .addNode("coverage", createCoverageNode(config))
    .addNode("sourceGate", createSourceGateNode(config))
    .addNode("practiceVisualEvidence", createPracticeVisualEvidenceNode(config, codex))
    .addNode("evidenceHandoff", createEvidenceHandoffNode(config))
    .addEdge(START, "sourcePlanner")
    .addEdge("sourcePlanner", "courseResolver")
    .addConditionalEdges("courseResolver", routeAfterCourseResolver, {
      sourceOrchestrator: "sourceOrchestrator",
      abort: END,
    })
    .addEdge("sourceOrchestrator", "resourceManifest")
    .addEdge("resourceManifest", "evidence")
    .addEdge("evidence", "requestEvaluator")
    .addEdge("requestEvaluator", "requestContractCheckpoint")
    .addEdge("requestContractCheckpoint", "sourceArchitect")
    .addConditionalEdges("sourceArchitect", routeAfterSourceArchitect, {
      targetedAcquisition: "targetedAcquisition",
      coverage: "coverage",
      abort: END,
    })
    .addEdge("targetedAcquisition", "resourceManifest")
    .addConditionalEdges("coverage", routeAfterCoverage, {
      sourceGate: "sourceGate",
      abort: END,
    })
    .addConditionalEdges("sourceGate", routeAfterSourceGate, {
      analyzer: "practiceVisualEvidence",
      abort: END,
    })
    .addEdge("practiceVisualEvidence", "evidenceHandoff")
    .addEdge("evidenceHandoff", END)
    .compile();
}

/**
 * Recovery graph for a persisted extraction that reached extracted-data.json
 * or persisted validated chapter handoffs before a timeout. It intentionally has
 * no scraper, downloader, source architect, or visual planner edge. Review
 * findings may trigger a bounded, targeted analyzer repair of the persisted
 * chapter handoffs, but never a new source crawl.
 */
export function buildExtractionReviewGraph(
  config: MoodleRuntimeConfig,
  dependencies: GraphDependencies = {},
) {
  const codex = dependencies.codex ?? createCodexClient(config);
  return new StateGraph(AgentStateAnnotation)
    .addNode("analyzer", createAnalyzerNode(config, codex))
    .addNode("partialFinalizer", createPartialExtractionFinalizerNode(config))
    .addNode("studyModel", createStudyModelNode(config))
    .addNode("review", createReviewNode(config))
    .addNode("qualityReviewer", createQualityReviewerNode(config, codex))
    .addConditionalEdges(START, (state) =>
      Object.keys(state.extracted_data).length > 0 ? "studyModel" : "analyzer", {
      analyzer: "analyzer",
      studyModel: "studyModel",
    })
    .addConditionalEdges("studyModel", routeAfterStudyModel, {
      studyModel: "studyModel",
      review: "review",
      abort: END,
    })
    .addConditionalEdges("review", routeAfterExtractionRecoveryReview, {
      analyzer: "analyzer",
      qualityReviewer: "qualityReviewer",
      abort: END,
    })
    .addConditionalEdges("analyzer", routeAfterExtractionAnalyzer, {
      analyzer: "analyzer",
      done: "studyModel",
      partialFinalizer: "partialFinalizer",
      abort: END,
    })
    .addConditionalEdges("partialFinalizer", routeAfterPartialFinalizer, {
      studyModel: "studyModel",
      abort: END,
    })
    .addConditionalEdges("qualityReviewer", routeAfterExtractionRecoveryQualityReview, {
      analyzer: "analyzer",
      qualityReviewer: "qualityReviewer",
      partialFinalizer: "partialFinalizer",
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
    .addNode("diskWriter", createDiskWriterNode(config, codex))
    .addNode("pdfPostRenderGate", checkpointPdfPostRenderReview)
    .addNode("bundleWriter", createBundleWriterNode(config))
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
    .addEdge("diskWriter", "pdfPostRenderGate")
    .addConditionalEdges("pdfPostRenderGate", routeAfterPdfPostRenderReview, {
      formatter: "formatter",
      bundleWriter: "bundleWriter",
      abort: END,
    })
    .addEdge("bundleWriter", END)
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
    if (
      !config.intentDecision?.wantsQuickAnswer &&
      state.coverage_assessment.status === "blocked"
    ) {
      return {
        error_log: `Student-first coverage blocked publication: ${state.coverage_assessment.detail}`,
      };
    }
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
    const scheduleCoveredByCalendar =
      coverage.calendar.status === "success" && config.calendarSelection?.complete === true;
    const needsCis = Boolean(
      plan?.targets.includes("cis") ||
      (plan?.needsCurrentScheduleData && !scheduleCoveredByCalendar),
    );
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
            "Required Moodle source is reachable, but it contains no evidence for the requested target course or topic.",
        };
      }
      if (isDcDcRequest(config.prompt) && coverage.moodle.artifacts.length === 0) {
        return {
          error_log:
            "The DC-DC source page was found, but no readable Moodle file was downloaded. Refusing to generate an incomplete calculation document.",
        };
      }
      if (
        expectsDownloadedSourceEvidence(config.prompt) &&
        coverage.moodle.artifacts.length === 0 &&
        (config.intentDecision?.needsDownloadedFiles ?? true)
      ) {
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

function routeAfterAnswerSourceGate(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
): "analyzer" | "answerWriter" | "abort" {
  if (state.error_log) return "abort";
  if (
    !resolveTaskBudget(config.intentDecision).allowModel
  ) {
    return "answerWriter";
  }
  return "analyzer";
}

async function runDiagnosticOnly(config: MoodleRuntimeConfig): Promise<AgentState> {
  await config.diagnostics?.log("info", "diagnostic", "Running diagnostic-only Moodle/CIS/calendar probe.");
  const calendarState = await createCalendarNode(config)(initialAgentState);
  const moodleState = await createScraperNode({
    ...config,
    maxPages: Math.min(config.maxPages, 3),
    maxDepth: 1,
    allowFileDownloads: false,
  })({ ...initialAgentState, ...calendarState });
  const stateAfterMoodle = {
    ...initialAgentState,
    ...calendarState,
    ...moodleState,
    moodle_raw_text: [calendarState.moodle_raw_text, moodleState.moodle_raw_text]
      .filter((value): value is string => Boolean(value))
      .join("\n\n"),
  };
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

function routeAfterAnalyzer(
  state: LangGraphAgentState,
): "analyzer" | "formatter" | "partialFinalizer" | "abort" {
  if (!state.error_log) {
    return "formatter";
  }
  if (state.retry_count < MAX_RETRIES) return "analyzer";
  return canFinalizePartialExtraction(state) ? "partialFinalizer" : "abort";
}

function routeAfterCourseResolver(
  state: LangGraphAgentState,
): "sourceOrchestrator" | "abort" {
  return state.error_log ? "abort" : "sourceOrchestrator";
}

function routeAfterCoverage(state: LangGraphAgentState): "sourceGate" | "abort" {
  return state.error_log ? "abort" : "sourceGate";
}

function routeAfterStudyModel(state: LangGraphAgentState): "studyModel" | "review" | "abort" {
  if (!state.error_log) return "review";
  return state.retry_count >= MAX_RETRIES ? "abort" : "studyModel";
}

function routeAfterReview(
  state: LangGraphAgentState,
): "analyzer" | "formatter" | "done" | "abort" {
  if (!state.error_log) {
    return state.final_document ? "done" : "formatter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "analyzer";
}

function routeAfterExtractionAnalyzer(
  state: LangGraphAgentState,
): "analyzer" | "done" | "partialFinalizer" | "abort" {
  if (!state.error_log) {
    return "done";
  }
  if (state.retry_count < MAX_RETRIES) return "analyzer";
  return canFinalizePartialExtraction(state) ? "partialFinalizer" : "abort";
}

function routeAfterAnswerAnalyzer(
  state: LangGraphAgentState,
): "analyzer" | "done" | "abort" {
  if (!state.error_log) return "done";
  return state.retry_count >= MAX_RETRIES ? "abort" : "analyzer";
}

function routeAfterPartialFinalizer(
  state: LangGraphAgentState,
): "studyModel" | "abort" {
  return state.error_log ? "abort" : "studyModel";
}

function routeAfterFormatter(state: LangGraphAgentState): "formatter" | "diskWriter" | "abort" {
  if (!state.error_log) {
    return "diskWriter";
  }
  return state.retry_count >= MAX_RETRIES ? "abort" : "formatter";
}

const PDF_POST_RENDER_FAILURE_PREFIX = "PDF post-render review failed;";

export function checkpointPdfPostRenderReview(
  state: LangGraphAgentState,
): Partial<LangGraphAgentState> {
  if (!state.error_log?.startsWith(PDF_POST_RENDER_FAILURE_PREFIX)) return {};
  return { retry_count: state.retry_count + 1 };
}

export function routeAfterPdfPostRenderReview(
  state: LangGraphAgentState,
): "formatter" | "bundleWriter" | "abort" {
  if (!state.error_log) return "bundleWriter";
  if (!state.error_log.startsWith(PDF_POST_RENDER_FAILURE_PREFIX)) return "abort";
  return state.retry_count >= MAX_RETRIES ? "abort" : "formatter";
}

function routeAfterArtifactQualityReview(
  state: LangGraphAgentState,
): "artifactBuilder" | "qualityReviewer" | "done" | "abort" {
  if (!state.error_log) return "done";
  if (state.retry_count >= MAX_RETRIES) return "abort";
  return isQualityReviewerExecutionFailure(state.error_log)
    ? "qualityReviewer"
    : "artifactBuilder";
}

export function routeAfterExtractionQualityReview(
  state: LangGraphAgentState,
): "sourceArchitect" | "contentAnalyzer" | "qualityReviewer" | "partialFinalizer" | "done" | "abort" {
  if (!state.error_log) return "done";
  if (state.retry_count >= MAX_RETRIES) {
    return canFinalizePartialExtraction(state) ? "partialFinalizer" : "abort";
  }
  if (isQualityReviewerExecutionFailure(state.error_log)) return "qualityReviewer";
  if (
    state.error_log.startsWith("Semantic quality review failed:") &&
    state.retry_count >= MAX_EXTRACTION_SEMANTIC_REVIEW_ATTEMPTS
  ) return "abort";
  return qualityFailureNeedsSourceAcquisition(state.error_log)
    ? "sourceArchitect"
    : "contentAnalyzer";
}

function routeAfterExtractionRecoveryReview(
  state: LangGraphAgentState,
): "analyzer" | "qualityReviewer" | "abort" {
  if (!state.error_log) return "qualityReviewer";
  return state.retry_count >= MAX_RETRIES ? "abort" : "analyzer";
}

function routeAfterExtractionRecoveryQualityReview(
  state: LangGraphAgentState,
): "analyzer" | "qualityReviewer" | "partialFinalizer" | "done" | "abort" {
  if (!state.error_log) return "done";
  if (state.retry_count >= MAX_RETRIES) {
    return canFinalizePartialExtraction(state) ? "partialFinalizer" : "abort";
  }
  if (
    state.error_log.startsWith("Semantic quality review failed:") &&
    state.retry_count >= MAX_EXTRACTION_SEMANTIC_REVIEW_ATTEMPTS
  ) return "abort";
  return isQualityReviewerExecutionFailure(state.error_log) ? "qualityReviewer" : "analyzer";
}

export function qualityFailureNeedsSourceAcquisition(error: string): boolean {
  if (!error.startsWith("Semantic quality review failed:")) return false;
  // The independent reviewer owns semantic classification. Routing consumes
  // its typed repair target instead of guessing from German/English content
  // words such as "formula", "example", or "missing source".
  return /\[repair:\s*source_architect\]/i.test(error);
}

function isQualityReviewerExecutionFailure(error: string): boolean {
  return error.startsWith("Quality reviewer failed:");
}

function isCoverageComplete(
  config: MoodleRuntimeConfig,
  coverage: ReturnType<RunDiagnostics["getCoverage"]>,
): boolean {
  const plan = config.sourcePlan;
  const needsMoodle = !plan || plan.targets.includes("moodle");
  const needsCis = Boolean(plan?.targets.includes("cis"));
  const needsCalendar = Boolean(plan?.targets.includes("calendar"));
  const moodleOk =
    !needsMoodle ||
    coverage.moodle.status === "success" ||
    coverage.moodle.status === "partial";
  const cisOk =
    !needsCis ||
    coverage.cis.status === "success" ||
    coverage.cis.status === "partial";
  const calendarOk =
    !needsCalendar ||
    coverage.calendar.status === "success" ||
    (
      config.calendarSelection?.needsCisFallback === true &&
      (coverage.cis.status === "success" || coverage.cis.status === "partial")
    );
  return moodleOk && cisOk && calendarOk;
}

export async function persistRunDiagnostics(
  config: MoodleRuntimeConfig,
  state: AgentState,
): Promise<void> {
  await mkdir(config.runDir, { recursive: true });
  await mkdir(path.join(config.runDir, "extraction"), { recursive: true });
  await mkdir(path.join(config.runDir, "render"), { recursive: true });
  const durableRawText = await durableMoodleRawText(config.runDir, state.moodle_raw_text);
  await Promise.all([
    writeFile(path.join(config.runDir, "moodle_raw.txt"), durableRawText, "utf8"),
    writeJson(path.join(config.runDir, "state.json"), {
      ...state,
      moodle_raw_text: durableRawText ? "[see moodle_raw.txt]" : "",
      final_document: state.final_document
        ? config.intentDecision?.wantsQuickAnswer ? "[see answer.md]" : "[see document.typ]"
        : "",
    }),
    writeFile(path.join(config.runDir, "error.log"), state.error_log ?? "", "utf8"),
    writeJson(path.join(config.runDir, "extraction", "visual-status.json"), {
      visualMode: config.visualMode,
      visualsEnabled: config.visualsEnabled,
      status:
        config.visualMode === "inline"
          ? "inline"
          : config.visualMode === "deferred"
            ? "deferred"
            : "off",
      warning:
        config.visualMode === "deferred"
          ? "Visual intake was deferred so the text-first handoff/render can complete first."
          : undefined,
    }),
    writeJson(path.join(config.runDir, "render", "render-manifest.json"), {
      stage: config.stage,
      outputPath: config.outputPath,
      pdfPath: state.final_document.trim() ? typstPdfPath(config.outputPath) : undefined,
      visualMode: config.visualMode,
      generatedAt: new Date().toISOString(),
    }),
    writeJson(path.join(config.runDir, "render", "coverage-report.json"), state.coverage_assessment),
  ]);
}

async function durableMoodleRawText(runDir: string, rawText: string): Promise<string> {
  if (rawText.trim()) return rawText;
  const evidencePackage = await readOptional(path.join(runDir, "evidence-package.json"));
  if (!evidencePackage?.trim()) return "";
  return `# Moodle evidence package\n\n${evidencePackage.trim()}\n`;
}

async function existingPdfPath(outputPath: string): Promise<string | undefined> {
  const pdfPath = typstPdfPath(outputPath);
  return existingFilePath(pdfPath);
}

async function existingFilePath(filePath: string): Promise<string | undefined> {
  const fileStat = await stat(filePath).catch(() => null);
  return fileStat?.isFile() && fileStat.size > 0 ? filePath : undefined;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateContainedRegularFile(
  root: string,
  relativePath: string,
  required: boolean,
): Promise<string | null> {
  const candidate = path.join(root, relativePath);
  const candidateStats = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!candidateStats) {
    if (required) {
      throw new Error(`Recovery source is missing required file: ${relativePath}`);
    }
    return null;
  }
  if (!candidateStats.isFile()) {
    throw new Error(`Recovery source path is not a regular file: ${relativePath}`);
  }
  const resolved = await realpath(candidate);
  if (!isContainedPath(root, resolved)) {
    throw new Error(`Recovery source file escapes its run directory: ${relativePath}`);
  }
  return resolved;
}

async function validateContainedDirectoryTree(
  root: string,
  relativePath: string,
  required: boolean,
  jsonOnly = false,
): Promise<string | null> {
  const candidate = path.join(root, relativePath);
  const candidateStats = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!candidateStats) {
    if (required) {
      throw new Error(`Recovery source is missing required directory: ${relativePath}`);
    }
    return null;
  }
  if (!candidateStats.isDirectory()) {
    throw new Error(`Recovery source path is not a real directory: ${relativePath}`);
  }
  const resolvedDirectory = await realpath(candidate);
  if (!isContainedPath(root, resolvedDirectory)) {
    throw new Error(`Recovery source directory escapes its run directory: ${relativePath}`);
  }
  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const childRelative = path.join(relativePath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Recovery source contains a symbolic link: ${childRelative}`);
    }
    if (entry.isDirectory()) {
      if (jsonOnly) {
        throw new Error(`Recovery JSON directory contains a nested directory: ${childRelative}`);
      }
      await validateContainedDirectoryTree(root, childRelative, true, false);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Recovery source contains an unsupported path: ${childRelative}`);
    }
    if (jsonOnly && !entry.name.endsWith(".json")) {
      throw new Error(`Recovery JSON directory contains a non-JSON file: ${childRelative}`);
    }
    await validateContainedRegularFile(root, childRelative, true);
  }
  return resolvedDirectory;
}

async function validateExtractionRecoverySource(sourceRunDir: string): Promise<string> {
  const lexicalStats = await lstat(sourceRunDir);
  if (!lexicalStats.isDirectory()) {
    throw new Error(`Extraction recovery source must be a real directory: ${sourceRunDir}`);
  }
  const root = await realpath(sourceRunDir);
  const requiredFiles = [
    "run-summary.md",
    "error.log",
    "moodle_raw.txt",
    "source-map.json",
    "evidence-package.json",
    "coverage-report.json",
    REQUEST_CONTRACT_FILE,
    REQUEST_CONTRACT_INTEGRITY_FILE,
  ];
  const optionalFiles = [
    "extracted-data.json",
    "source_coverage.json",
    "state.json",
    "learning-architecture.json",
    "resource-catalog.json",
    "resource-plan.json",
    "visual-candidates.json",
    "visual-retrieval-plan.json",
    "visual-page-index.json",
    PENDING_EXTRACTION_REPAIRS_FILE,
  ];
  await Promise.all([
    ...requiredFiles.map((relativePath) => validateContainedRegularFile(root, relativePath, true)),
    ...optionalFiles.map((relativePath) => validateContainedRegularFile(root, relativePath, false)),
    validateContainedDirectoryTree(root, "chapter-handoffs", false, true),
    validateContainedDirectoryTree(root, "assets/visuals", false),
  ]);
  return root;
}

async function validateRenderSource(sourceRunDir: string | undefined): Promise<string> {
  if (!sourceRunDir) {
    throw new Error("Render stage requires --source-run-dir.");
  }
  const lexicalStats = await lstat(sourceRunDir);
  if (!lexicalStats.isDirectory()) {
    throw new Error(`Render source must be a real directory: ${sourceRunDir}`);
  }
  const root = await realpath(sourceRunDir);
  const requiredFiles = [
    "run-summary.md",
    "error.log",
    "moodle_raw.txt",
    "extracted-data.json",
    REQUEST_CONTRACT_FILE,
    REQUEST_CONTRACT_INTEGRITY_FILE,
  ];
  const optionalFiles = [
    "source_coverage.json",
    "source-map.json",
    "evidence-package.json",
    "coverage-report.json",
    "study-model.json",
    "review-report.json",
  ];
  await Promise.all([
    ...requiredFiles.map((relativePath) => validateContainedRegularFile(root, relativePath, true)),
    ...optionalFiles.map((relativePath) => validateContainedRegularFile(root, relativePath, false)),
    validateContainedDirectoryTree(root, "assets/visuals", false),
  ]);
  return root;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function persistFinalExtractionArtifact(
  runDir: string,
  extractedData: AgentState["extracted_data"],
): Promise<void> {
  const extractionDir = path.join(runDir, "extraction");
  await mkdir(extractionDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(runDir, "extracted-data.json"), extractedData),
    writeJson(path.join(extractionDir, "extracted-data.json"), extractedData),
  ]);
}

async function loadSourceCoverage(sourceRunDir: string | undefined): Promise<SourceCoverage> {
  if (!sourceRunDir) {
    throw new Error("Render stage requires --source-run-dir.");
  }
  const root = await realpath(sourceRunDir);
  const coveragePath = await validateContainedRegularFile(root, "source_coverage.json", true);
  if (!coveragePath) {
    throw new Error(`Source coverage is missing from ${sourceRunDir}`);
  }
  return JSON.parse(await readFile(coveragePath, "utf8")) as SourceCoverage;
}

export async function loadExtractionReviewState(config: MoodleRuntimeConfig): Promise<AgentState> {
  const configuredSourceRunDir = config.resumeExtractionRunDir;
  if (!configuredSourceRunDir) {
    throw new Error("Extraction review recovery requires --resume-extraction-run-dir.");
  }
  const sourceRunDir = await validateExtractionRecoverySource(configuredSourceRunDir);
  const verifiedRequestContract = await loadVerifiedRequestContract(
    sourceRunDir,
    "extraction recovery",
  );
  const [
    summary,
    errorLog,
    rawText,
    extractedText,
    manifestText,
    evidenceText,
    coverageText,
    architectureText,
    catalogText,
  ] = await Promise.all([
    readFile(path.join(sourceRunDir, "run-summary.md"), "utf8"),
    readFile(path.join(sourceRunDir, "error.log"), "utf8"),
    readFile(path.join(sourceRunDir, "moodle_raw.txt"), "utf8"),
    readOptional(path.join(sourceRunDir, "extracted-data.json")),
    readFile(path.join(sourceRunDir, "source-map.json"), "utf8"),
    readFile(path.join(sourceRunDir, "evidence-package.json"), "utf8"),
    readFile(path.join(sourceRunDir, "coverage-report.json"), "utf8"),
    readOptional(path.join(sourceRunDir, "learning-architecture.json")),
    readOptional(path.join(sourceRunDir, "resource-plan.json")),
  ]);
  const semanticDownstreamReviewFailure = /^(?:Student-first review failed:|Semantic quality review failed:)/
    .test(errorLog.trim());
  const persistedChapterHandoffs = await readdir(path.join(sourceRunDir, "chapter-handoffs"))
    .catch(() => []);
  const recoverableAnalyzerFailure = /^Analyzer failed:/.test(errorLog.trim()) &&
    persistedChapterHandoffs.some((name) => name.endsWith(".json"));
  const qualityReviewerExecutionFailure = /^Quality reviewer failed:/
    .test(errorLog.trim());
  const downstreamReviewFailure = semanticDownstreamReviewFailure || qualityReviewerExecutionFailure;
  const persistedManifest = ResourceManifestSchema.parse(JSON.parse(manifestText));
  const evidencePackage = EvidencePackageSchema.parse(JSON.parse(evidenceText));
  const manifestRepair = repairResourceManifestCourseScope(
    persistedManifest,
    evidencePackage.records.map((record) => record.resourceId),
  );
  const recoveredCoverage = assessExamNavigatorCoverage(
    config,
    manifestRepair.manifest,
    evidencePackage,
  );
  const coverageGateFailure = /^Student-first coverage blocked publication:/.test(errorLog.trim());
  const recoverableCoverageFailure = coverageGateFailure && recoveredCoverage.status !== "blocked";
  const timedOutDuringAnalysis =
    /^Study Buddy run timed out after \d+ms(?: without pipeline progress)?\.$/.test(errorLog.trim());
  const checkpointedDuringAnalysis = /^Extraction checkpoint required:/.test(errorLog.trim());
  const capacityCheckpointedDuringAnalysis =
    /^Extraction capacity checkpoint required:/.test(errorLog.trim()) ||
    /content_analyzer model call timed out after/.test(errorLog);
  const interruptedDuringAnalysis =
    timedOutDuringAnalysis ||
    checkpointedDuringAnalysis ||
    capacityCheckpointedDuringAnalysis ||
    recoverableAnalyzerFailure ||
    recoverableCoverageFailure;
  const terminal = /^Run status:\s*(?:failed|timeout|partial|success)$/m.test(summary);
  const interruptedAfterReview = /^Run status:\s*running$/m.test(summary) && downstreamReviewFailure;
  if (!terminal && !interruptedAfterReview) {
    throw new Error(`Extraction recovery source has no recoverable terminal/review state: ${sourceRunDir}`);
  }
  if (
    errorLog.trim() &&
    !downstreamReviewFailure &&
    !interruptedDuringAnalysis
  ) {
    throw new Error(
      `Extraction recovery is allowed only after a downstream review failure, timeout, or runtime checkpoint: ${sourceRunDir}`,
    );
  }
  const extractedData = extractedText
    ? await hydrateExtractedVisualAssets(
        sourceRunDir,
        reconcileRequestedCourseIdentity(
          config,
          validateExtractedData(JSON.parse(extractedText)),
          rawText,
        ),
        config.visualCropMode,
      )
    : {};
  const recoveredLanguage = extractedText
    ? validateExtractedData(extractedData).language
    : null;
  if (recoveredLanguage && recoveredLanguage !== config.outputLanguage) {
    throw new Error(
      `Extraction recovery language mismatch: handoff is ${recoveredLanguage}, request resolves to ${config.outputLanguage}. Start a new extraction for the requested artifact language.`,
    );
  }
  if (!extractedText) {
    if (!interruptedDuringAnalysis) {
      throw new Error(`Extraction interruption has no validated chapter handoff to resume: ${sourceRunDir}`);
    }
    if (!persistedChapterHandoffs.some((name) => name.endsWith(".json"))) {
      await config.diagnostics?.log(
        "info",
        "analyzer",
        "Recovery starts before the first complete chapter; validated topic-fragment cache remains reusable.",
      );
    }
  }
  await copyExtractionRecoveryCheckpoints(sourceRunDir, config.runDir);
  await persistVerifiedRequestContract(
    config.runDir,
    verifiedRequestContract.contract,
    "extraction recovery target",
  );
  if (recoverableCoverageFailure) {
    await Promise.all([
      writeJson(path.join(config.runDir, "source-map.json"), manifestRepair.manifest),
      writeJson(path.join(config.runDir, "coverage-report.json"), recoveredCoverage),
      writeJson(path.join(config.runDir, "coverage-recovery.json"), {
        status: "repaired",
        method: "persisted-extraction-course-scope-reconciliation",
        sourceRunDir,
        repairedResourceIds: manifestRepair.repairedResourceIds,
        acquiredResources: recoveredCoverage.acquiredResources,
        usableEvidenceRecords: recoveredCoverage.usableEvidenceRecords,
        performedNetworkAccess: false,
        performedModelCall: false,
      }),
    ]);
    await config.diagnostics?.log(
      "info",
      "analyzer",
      `Recovered a false coverage block from persisted extraction evidence; ${recoveredCoverage.acquiredResources} acquired resource(s) remain available and no source crawl was repeated.`,
    );
  }
  const learningArchitecture = architectureText
    ? boundLearningArchitecture(
      reconcileLearningArchitectureWithCatalog(
        parseLearningArchitectureModelJson(architectureText),
        catalogText
          ? (JSON.parse(catalogText) as { entries?: CatalogEntry[] }).entries ?? []
          : [],
      ),
      MAX_LEARNING_MODULES,
    )
    : undefined;
  const pendingRepairs = await readPendingExtractionRepairs(config.runDir);
  const currentModuleTitles = new Set(
    (learningArchitecture?.modules ?? []).map((module) => module.title.toLocaleLowerCase("de")),
  );
  const relevantPendingRepairs = pendingRepairs
    ? {
      ...pendingRepairs,
      pendingChapterTitles: pendingRepairs.pendingChapterTitles.filter((title) =>
        currentModuleTitles.has(title.toLocaleLowerCase("de"))
      ),
    }
    : null;
  const mustFinishPendingRepairs = Boolean(relevantPendingRepairs?.pendingChapterTitles.length);
  const mustRepairDownstreamReview = mustFinishPendingRepairs || semanticDownstreamReviewFailure;
  return {
    ...initialAgentState,
    moodle_raw_text: rawText,
    // An extracted-data snapshot predating a semantic repair is intentionally
    // hidden from START. This forces the analyzer to consume the persisted
    // pending chapter list before the reviewer is allowed to pass the run.
    extracted_data: mustRepairDownstreamReview ? {} : extractedData,
    error_log: mustFinishPendingRepairs && relevantPendingRepairs
      ? pendingExtractionRepairError(relevantPendingRepairs)
      : semanticDownstreamReviewFailure
        ? errorLog.trim()
      : recoverableAnalyzerFailure
        ? errorLog.trim()
      : capacityCheckpointedDuringAnalysis && !extractedText
        ? errorLog.trim()
        : null,
    retry_count: mustFinishPendingRepairs && relevantPendingRepairs
      ? Math.min(MAX_RETRIES - 1, relevantPendingRepairs.retryCount)
      : semanticDownstreamReviewFailure
        ? 1
      : recoverableAnalyzerFailure
        ? MAX_RETRIES - 1
      : capacityCheckpointedDuringAnalysis
        ? 1
        : 0,
    resource_manifest: manifestRepair.manifest,
    evidence_package: evidencePackage,
    coverage_assessment: recoverableCoverageFailure
      ? recoveredCoverage
      : CoverageAssessmentSchema.parse(JSON.parse(coverageText)),
    source_architect_decision: {
      round: 0,
      status: "sufficient",
      coverageSummary: recoverableCoverageFailure
        ? "Recovered a false persisted coverage block and resumed analysis without crawling sources."
        : extractedText
        ? mustFinishPendingRepairs
          ? "Resumed persisted semantic chapter repairs before review without crawling sources."
          : "Reused persisted extraction architecture for review recovery."
        : "Resumed persisted chapter handoffs after analyzer interruption without crawling sources.",
      requestedUrls: [],
      remainingAvailable: 0,
      reasons: ["Extraction recovery does not crawl or acquire sources."],
      ...(learningArchitecture ? { learningArchitecture } : {}),
    },
    request_contract: verifiedRequestContract.contract,
    request_contract_hash: verifiedRequestContract.contractHash,
  };
}

async function copyExtractionRecoveryCheckpoints(
  sourceRunDir: string,
  targetRunDir: string,
): Promise<void> {
  const relativePaths = [
    "chapter-handoffs",
    "source-map.json",
    "evidence-package.json",
    "coverage-report.json",
    "assets/visuals",
    "visual-candidates.json",
    "visual-retrieval-plan.json",
    "visual-page-index.json",
    "learning-architecture.json",
    "resource-catalog.json",
    "resource-plan.json",
    REQUEST_CONTRACT_FILE,
    REQUEST_CONTRACT_INTEGRITY_FILE,
    PENDING_EXTRACTION_REPAIRS_FILE,
  ];
  for (const relativePath of relativePaths) {
    await cp(
      path.join(sourceRunDir, relativePath),
      path.join(targetRunDir, relativePath),
      { recursive: true, force: false, errorOnExist: false },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function loadRenderState(config: MoodleRuntimeConfig): Promise<AgentState> {
  const sourceRunDir = await validateRenderSource(config.sourceRunDir);
  const [
    summary,
    errorLog,
    rawText,
    extractedText,
    manifestText,
    evidenceText,
    coverageText,
    modelText,
    reviewText,
  ] = await Promise.all([
    readFile(path.join(sourceRunDir, "run-summary.md"), "utf8"),
    readFile(path.join(sourceRunDir, "error.log"), "utf8"),
    readFile(path.join(sourceRunDir, "moodle_raw.txt"), "utf8"),
    readFile(path.join(sourceRunDir, "extracted-data.json"), "utf8"),
    readOptional(path.join(sourceRunDir, "source-map.json")),
    readOptional(path.join(sourceRunDir, "evidence-package.json")),
    readOptional(path.join(sourceRunDir, "coverage-report.json")),
    readOptional(path.join(sourceRunDir, "study-model.json")),
    readOptional(path.join(sourceRunDir, "review-report.json")),
  ]);
  if (!/^Run status:\s*(?:success|partial)$/m.test(summary) || errorLog.trim()) {
    throw new Error(`Render source is not a successful extraction run: ${sourceRunDir}`);
  }
  const verifiedRequestContract = await loadVerifiedRequestContract(
    sourceRunDir,
    "official render",
  );
  await persistVerifiedRequestContract(
    config.runDir,
    verifiedRequestContract.contract,
    "official render target",
  );
  const extractedData = await hydrateExtractedVisualAssets(
    sourceRunDir,
    validateExtractedData(JSON.parse(extractedText)),
    config.visualCropMode,
  );
  if (extractedData.language !== config.outputLanguage) {
    throw new Error(
      `Render language mismatch: extraction handoff is ${extractedData.language}, render request resolves to ${config.outputLanguage}. Re-run extraction with the requested artifact language.`,
    );
  }
  const resourceManifest = manifestText
    ? ResourceManifestSchema.parse(JSON.parse(manifestText))
    : await buildResourceManifest(sourceRunDir, rawText);
  const evidencePackage = evidenceText
    ? EvidencePackageSchema.parse(JSON.parse(evidenceText))
    : await buildEvidencePackage(sourceRunDir, rawText, resourceManifest);
  const coverageAssessment = coverageText
    ? CoverageAssessmentSchema.parse(JSON.parse(coverageText))
    : assessExamNavigatorCoverage(config, resourceManifest, evidencePackage);
  if (modelText) StudyModelSchema.parse(JSON.parse(modelText));
  if (reviewText) ReviewReportSchema.parse(JSON.parse(reviewText));
  const studyModel = buildStudyModel(
    config,
    extractedData,
    resourceManifest,
    coverageAssessment,
  );
  const reviewReport = await reviewStudyModel(
    studyModel,
    coverageAssessment,
    resourceManifest,
    evidencePackage,
  );
  if (coverageAssessment.status === "blocked" || !reviewReport.ok) {
    throw new Error(`Render source is blocked by student-first review: ${sourceRunDir}`);
  }
  return {
    ...initialAgentState,
    moodle_raw_text: rawText,
    extracted_data: extractedData,
    resource_manifest: resourceManifest,
    evidence_package: evidencePackage,
    coverage_assessment: coverageAssessment,
    study_model: studyModel,
    review_report: reviewReport,
    request_contract: verifiedRequestContract.contract,
    request_contract_hash: verifiedRequestContract.contractHash,
  };
}

async function readOptional(filePath: string): Promise<string | null> {
  return readFile(filePath, "utf8").catch(() => null);
}

async function withRuntimeGuard<T>(
  config: MoodleRuntimeConfig,
  abortController: AbortController,
  run: () => Promise<T>,
): Promise<T> {
  const telemetryStartedAt = Date.parse(config.executionTelemetry?.getSnapshot().startedAt ?? "");
  const startedAt = Number.isFinite(telemetryStartedAt) ? telemetryStartedAt : Date.now();
  let heartbeat: NodeJS.Timeout | null = null;
  let guard: NodeJS.Timeout | null = null;
  try {
    heartbeat = setInterval(() => {
      const now = Date.now();
      const pausedMs = config.executionTelemetry?.getRuntimeBudgetPausedMs(now) ?? 0;
      const elapsedSeconds = Math.round(Math.max(0, now - startedAt - pausedMs) / 1000);
      const idleSeconds = config.diagnostics
        ? Math.round((now - config.diagnostics.lastActivityAt) / 1000)
        : elapsedSeconds;
      void config.diagnostics?.log(
        "info",
        "diagnostic",
        config.executionTelemetry?.runtimeBudgetPaused
          ? `Heartbeat: run queued; execution budget is paused (${elapsedSeconds}s active).`
          : `Heartbeat: run still active, ${elapsedSeconds}s elapsed, ${idleSeconds}s idle.`,
      );
    }, 15_000);
    guard = setInterval(() => {
      const now = Date.now();
      if (config.executionTelemetry?.runtimeBudgetPaused) return;
      const elapsedMs = Math.max(
        0,
        now - startedAt - (config.executionTelemetry?.getRuntimeBudgetPausedMs(now) ?? 0),
      );
      const idleMs = config.diagnostics
        ? now - config.diagnostics.lastActivityAt
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
