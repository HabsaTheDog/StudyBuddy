import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { END, START, StateGraph } from "@langchain/langgraph";
import { createBrowserClient } from "./browserClient.js";
import { createCodexClient, type CodexClient } from "./codexClient.js";
import { createRuntimeConfig } from "./config.js";
import {
  AgentStateAnnotation,
  initialAgentState,
  type AgentState,
  type LangGraphAgentState,
  type JsonObject,
} from "./state.js";
import type {
  MoodleGraphInput,
  MoodleGraphResult,
  MoodleRuntimeConfig,
  MoodleWorkflowStatus,
} from "./types.js";
import type { AgentBrowserClient } from "./agentBrowserClient.js";
import { redactSensitiveValues, sanitizeModelVisibleUrl } from "./browserSecurity.js";
import { createAssignmentWorkflowNode } from "./nodes/assignmentWorkflowNode.js";
import {
  createQuizPageNode,
  createQuizTargetNode,
  isQuizWorkflowDone,
} from "./nodes/quizWorkflowNodes.js";
import { isAssignmentSubmissionPrompt, isQuizPrompt } from "./quizIntent.js";
import { createQuizAttemptWorkflowNode } from "./nodes/quizAttemptWorkflow.js";
import { assertApprovedQuizTarget } from "./quizPermissions.js";

export interface InteractiveGraphDependencies {
  onStep?: (state: AgentState) => Promise<void>;
  codex?: CodexClient;
  browser?: AgentBrowserClient;
  assignmentWorkflowNode?: ReturnType<typeof createAssignmentWorkflowNode>;
  quizTargetNode?: ReturnType<typeof createQuizTargetNode>;
  quizPageNode?: ReturnType<typeof createQuizPageNode>;
  quizAttemptNode?: ReturnType<typeof createQuizAttemptWorkflowNode>;
  quizAttemptFactory?: typeof createQuizAttemptWorkflowNode;
  quizBrowserFactory?: (config: MoodleRuntimeConfig) => AgentBrowserClient;
  /** Original, unexpanded permission policy for isolated batch children. */
  quizInput?: MoodleGraphInput;
}

export async function runInteractiveMoodleGraph(
  input: MoodleGraphInput,
  dependencies: InteractiveGraphDependencies = {},
): Promise<MoodleGraphResult> {
  const config = createRuntimeConfig(input);
  const browser = dependencies.browser ?? createBrowserClient(config);
  let state: AgentState = initialAgentState;
  try {
    state = (await buildInteractiveMoodleGraph(config, {
      ...dependencies,
      quizInput: input,
      browser,
      onStep: async (current) => {
        state = current;
        await persistInteractionProgress(config, current, "running");
        await dependencies.onStep?.(current);
      },
    }).invoke(initialAgentState, {
      recursionLimit: Math.max(64, config.maxPages * 8),
    })) as AgentState;
  } catch (error) {
    state = {
      ...state,
      error_log: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (!config.keepBrowserOpen) {
      await browser.close().catch(() => undefined);
    }
  }

  state = sanitizeGraphState(state, config);
  const workflowStatus = deriveWorkflowStatus(state);
  const ok = workflowStatus === "completed" || workflowStatus === "permission_required";
  const quizUrl = extractQuizResultUrl(state, config);
  await persistRunDiagnostics(config, state, { ok, workflowStatus });
  await persistInteractionProgress(config, state, workflowStatus);
  return {
    ok,
    workflowStatus,
    coverageComplete: state.source_coverage.moodle.status === "success" &&
      !Number(((state.extracted_data as JsonObject).quiz_workflow as JsonObject | undefined)?.missing_quiz_count),
    runDir: config.runDir,
    state,
    sourceCoverage: state.source_coverage,
    permissionRequestPath: extractPermissionRequestPath(config, state),
    permissionRequestPaths: extractPermissionRequestPaths(config, state),
    quizUrls: extractQuizResultUrls(state, config),
    ...(quizUrl ? { quizUrl } : {}),
    ...(!ok || state.error_log
      ? { error: state.error_log || workflowFailureMessage(workflowStatus) }
      : {}),
  };
}

export function extractQuizResultUrl(
  state: AgentState,
  config?: Pick<MoodleRuntimeConfig, "moodleUrl">,
): string | undefined {
  const data = state.extracted_data as Record<string, unknown>;
  const workflow = data.quiz_workflow as Record<string, unknown> | undefined;
  const reviewTarget = data.kind === "quiz_review" ? data.target_url : undefined;
  const candidates = [
    workflow?.target_url,
    reviewTarget,
    ...state.source_coverage.moodle.urls,
    config?.moodleUrl,
  ];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      /^https?:\/\/[^\s]+\/mod\/quiz\//i.test(candidate),
  );
}

function extractQuizResultUrls(state: AgentState, config: MoodleRuntimeConfig): string[] {
  const workflow = (state.extracted_data as JsonObject).quiz_workflow as JsonObject | undefined;
  if (Array.isArray(workflow?.target_urls)) return workflow.target_urls.filter((url): url is string => typeof url === "string");
  const single = extractQuizResultUrl(state, config);
  return single ? [single] : [];
}

export function buildInteractiveMoodleGraph(
  config: MoodleRuntimeConfig,
  dependencies: InteractiveGraphDependencies = {},
) {
  const requestPrompt = requestContextPrompt(config);
  if (!isQuizPrompt(requestPrompt) && !isAssignmentSubmissionPrompt(requestPrompt)) {
    throw new Error("The interactive Moodle graph only accepts quiz or assignment actions.");
  }
  const browser = dependencies.browser ?? createBrowserClient(config);
  const codex = dependencies.codex ?? createCodexClient(config);

  const track = (node: (state: LangGraphAgentState) => Promise<Partial<LangGraphAgentState>>) =>
    async (state: LangGraphAgentState) => {
      await dependencies.onStep?.(state);
      const update = await node(state);
      await dependencies.onStep?.({ ...state, ...update });
      return update;
    };
  return new StateGraph(AgentStateAnnotation)
    .addNode("router", async () => ({}))
    .addNode("assignmentWorkflow", track(dependencies.assignmentWorkflowNode ??
      createAssignmentWorkflowNode(config, { agentBrowser: browser })))
    .addNode("quizTarget", track(dependencies.quizTargetNode ??
      createQuizTargetNode(config, { agentBrowser: browser, codex })))
    .addNode("quizAttempt", track(async state => {
      const workflow = (state.extracted_data as JsonObject).quiz_workflow as JsonObject;
      const targets = Array.isArray(workflow.target_urls)
        ? workflow.target_urls.filter((url): url is string => typeof url === "string") : [];
      if (targets.length > 1) return runQuizBatch(config, state, targets, dependencies);
      const admitted = { ...state, ...await (dependencies.quizPageNode ?? createQuizPageNode(config, { agentBrowser: browser }))(state) };
      await dependencies.onStep?.(admitted);
      if (isQuizWorkflowDone(admitted)) return admitted;
      const node = dependencies.quizAttemptNode ?? (dependencies.quizAttemptFactory ?? createQuizAttemptWorkflowNode)(config, {
        agentBrowser: browser, codex, onStep: dependencies.onStep,
      });
      return { ...admitted, ...await node(admitted) };
    }))
    .addEdge(START, "router")
    .addConditionalEdges("router", () => routeInitial(config), {
      assignmentWorkflow: "assignmentWorkflow",
      quizTarget: "quizTarget",
    })
    .addEdge("assignmentWorkflow", END)
    .addConditionalEdges("quizTarget", routeAfterQuizStep, {
      quizAttempt: "quizAttempt",
      end: END,
    })
    .addEdge("quizAttempt", END)
    .compile();
}

function routeInitial(config: MoodleRuntimeConfig): "assignmentWorkflow" | "quizTarget" {
  return isAssignmentSubmissionPrompt(requestContextPrompt(config))
    ? "assignmentWorkflow"
    : "quizTarget";
}

function requestContextPrompt(config: MoodleRuntimeConfig): string {
  return config.originalUserPrompt === config.prompt
    ? config.prompt
    : `${config.originalUserPrompt}\n${config.prompt}`;
}

function routeAfterQuizStep(state: LangGraphAgentState): "quizAttempt" | "end" {
  return isQuizWorkflowDone(state) ? "end" : "quizAttempt";
}

async function runQuizBatch(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  targets: string[],
  dependencies: InteractiveGraphDependencies,
): Promise<Partial<LangGraphAgentState>> {
  const original = dependencies.quizInput ?? {
    ...config,
    // A runtime grant has already widened this policy for exactly one target.
    // Recover the default policy for siblings when no raw input was provided.
    quizSafetyPolicy: config.approvedQuizPermission ? undefined : config.quizSafetyPolicy,
  };
  const results = await Promise.all(targets.map(async (target, index) => {
    const runDir = path.join(config.runDir, "quizzes", `quiz-${index + 1}`);
    // Retain a diagnostic context even when configuration or client creation fails.
    let childConfig: MoodleRuntimeConfig = { ...config, runDir, moodleUrl: target };
    let browser: AgentBrowserClient | undefined;
    let childState: AgentState = structuredClone(initialAgentState);
    const track = async (current: AgentState) => {
      childState = current;
      await persistInteractionProgress(childConfig, current, "running");
    };
    try {
      const grant = [...(original.approvedQuizPermissions ?? []), ...(original.approvedQuizPermission ? [original.approvedQuizPermission] : [])]
        .find(permission => { try { assertApprovedQuizTarget(permission, target); return true; } catch { return false; } });
      childConfig = createRuntimeConfig({
        ...original,
        prompt: `Bearbeite das Quiz ${target}`,
        originalUserPrompt: config.originalUserPrompt,
        moodleUrl: target,
        runDir,
        outputPath: undefined,
        approvedQuizPermission: grant,
        approvedQuizPermissions: undefined,
      });
      // agent-browser's session-name is persisted separately from --session;
      // both must be unique even when an environment override names one session.
      const session = `study-buddy-quiz-${randomUUID()}`;
      childConfig.browserSession = session;
      childConfig.browserSessionName = session;
      browser = (dependencies.quizBrowserFactory ?? createBrowserClient)(childConfig);
      const codex = dependencies.codex ?? createCodexClient(childConfig);
      const targetNode = createQuizTargetNode(childConfig, { agentBrowser: browser, codex });
      childState = { ...childState, ...await targetNode(childState) };
      await track(childState);
      if (!isQuizWorkflowDone(childState)) {
        childState = { ...childState, ...await (dependencies.quizPageNode ?? createQuizPageNode(childConfig, { agentBrowser: browser }))(childState) };
        await track(childState);
      }
      if (!isQuizWorkflowDone(childState)) {
        const attempt = (dependencies.quizAttemptFactory ?? createQuizAttemptWorkflowNode)(childConfig, { agentBrowser: browser, codex, onStep: track });
        childState = { ...childState, ...await attempt(childState) };
      }
    } catch (error) {
      childState = { ...childState, error_log: error instanceof Error ? error.message : String(error) };
    } finally {
      if (browser && !childConfig.keepBrowserOpen) {
        try { await browser.close(); } catch { /* Keep the recorded workflow result. */ }
      }
    }
    childState = sanitizeGraphState(childState, childConfig);
    let workflowStatus = deriveWorkflowStatus(childState);
    const ok = workflowStatus === "completed" || workflowStatus === "permission_required";
    try {
      await persistRunDiagnostics(childConfig, childState, { ok, workflowStatus });
      await persistInteractionProgress(childConfig, childState, workflowStatus);
    } catch (error) {
      childState = sanitizeGraphState({ ...childState, error_log: [childState.error_log,
        `Child diagnostics failed: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join("\n") }, childConfig);
      workflowStatus = "failed";
    }
    return { targetUrl: target, runDir: childConfig.runDir, workflowStatus,
      permissionRequestPath: extractPermissionRequestPath(childConfig, childState) ?? null, state: childState };
  }));
  const workflow = (state.extracted_data as JsonObject).quiz_workflow as JsonObject;
  const permissionPaths = results.map(result => result.permissionRequestPath).filter((value): value is string => Boolean(value));
  const fillResults = results.flatMap(result => {
    const quiz = (result.state.extracted_data as JsonObject).quiz_workflow as JsonObject | undefined;
    return Array.isArray(quiz?.fill_results) ? quiz.fill_results : [];
  });
  const report = ["= Moodle Quiz Batch", "", ...results.flatMap((result, index) => [
    `== Quiz ${index + 1}: ${result.workflowStatus}`, result.targetUrl,
    result.state.final_document || result.state.error_log || "No question report available.", "",
  ]), `Missing requested quizzes: ${workflow.missing_quiz_count ?? 0}`, "Final submit clicked: false", ""].join("\n");
  const batch = {
    kind: "quiz_batch", done: true, missing_quiz_count: workflow.missing_quiz_count ?? 0,
    permission_request_paths: permissionPaths,
    results: results.map(({ state: childState, ...result }) => ({ ...result,
      error: childState.error_log,
      quiz_workflow: (childState.extracted_data as JsonObject).quiz_workflow ?? null,
    })),
  } as JsonObject;
  const aggregate: Partial<LangGraphAgentState> = {
    extracted_data: { ...(state.extracted_data as JsonObject), quiz_batch: batch,
      quiz_workflow: { ...workflow, done: true, fill_results: fillResults, final_submit_clicked: false } },
    moodle_raw_text: results.map(result => result.state.moodle_raw_text).join("\n\n"),
    final_document: report,
    error_log: results.map(result => result.state.error_log).filter(Boolean).join("\n") || null,
    source_coverage: { ...state.source_coverage, moodle: {
      status: !Number(workflow.missing_quiz_count) && results.every(result => result.state.source_coverage.moodle.status === "success") ? "success" : "empty",
      detail: results.map(result => `${result.targetUrl}: ${result.workflowStatus}`).join("; "),
      urls: [...new Set(results.flatMap(result => [result.targetUrl, ...result.state.source_coverage.moodle.urls]))],
      pages: results.reduce((sum, result) => sum + result.state.source_coverage.moodle.pages, 0),
    } },
  };
  // Publish the completed child states before aggregate I/O can fail.
  await dependencies.onStep?.({ ...state, ...aggregate });
  await writeFile(path.join(config.runDir, "quiz-review.typ"), report, { mode: 0o600 });
  await writeFile(path.join(config.runDir, "quiz-review.json"), JSON.stringify(batch, null, 2) + "\n", { mode: 0o600 });
  return aggregate;
}

export function deriveWorkflowStatus(state: AgentState): MoodleWorkflowStatus {
  if (state.error_log) return "failed";
  const data = state.extracted_data as Record<string, unknown>;
  const batch = data.quiz_batch as Record<string, unknown> | undefined;
  if (batch) {
    const results = Array.isArray(batch.results) ? batch.results as Array<Record<string, unknown>> : [];
    if (results.some(result => result.workflowStatus === "failed")) return "failed";
    if (Number(batch.missing_quiz_count) > 0 || results.some(result => ["blocked", "target_not_found", "manual_action_required"].includes(String(result.workflowStatus)))) return "blocked";
    if (results.some(result => result.workflowStatus === "permission_required")) return "permission_required";
    return results.length && results.every(result => result.workflowStatus === "completed") ? "completed" : "failed";
  }
  const assignment = data.assignment_workflow as Record<string, unknown> | undefined;
  if (assignment) {
    const status = String(assignment.status ?? "failed");
    if (status === "submitted") return "completed";
    if (status === "permission_required") return "permission_required";
    if (status === "manual_action_required") return "manual_action_required";
    if (status === "blocked") return "blocked";
    return "failed";
  }
  const quiz = data.quiz_workflow as Record<string, unknown> | undefined;
  if (quiz) {
    if (quiz.pending_permission) return "permission_required";
    if (Number(quiz.missing_quiz_count) > 0) return "blocked";
    const reason = String(quiz.stop_reason ?? "");
    if (reason === "no-quiz-target") return "target_not_found";
    if (reason === "questions-unresolved") return "manual_action_required";
    if (reason && reason !== "attempt-summary-reached") return "blocked";
    return quiz.done === true && reason === "attempt-summary-reached" ? "completed" : "failed";
  }
  return "failed";
}

function extractPermissionRequestPath(
  config: MoodleRuntimeConfig,
  state: AgentState,
): string | undefined {
  const data = state.extracted_data as Record<string, unknown>;
  const batch = data.quiz_batch as Record<string, unknown> | undefined;
  if (Array.isArray(batch?.permission_request_paths)) return batch.permission_request_paths.find((value): value is string => typeof value === "string");
  const assignment = data.assignment_workflow as Record<string, unknown> | undefined;
  if (typeof assignment?.permission_request_path === "string") {
    return assignment.permission_request_path;
  }
  const quiz = data.quiz_workflow as Record<string, unknown> | undefined;
  return quiz?.pending_permission
    ? path.join(config.runDir, "quiz-permission-request.json")
    : undefined;
}

function extractPermissionRequestPaths(config: MoodleRuntimeConfig, state: AgentState): string[] {
  const batch = (state.extracted_data as JsonObject).quiz_batch as JsonObject | undefined;
  if (Array.isArray(batch?.permission_request_paths)) return batch.permission_request_paths.filter((value): value is string => typeof value === "string");
  const single = extractPermissionRequestPath(config, state);
  return single ? [single] : [];
}

function workflowFailureMessage(status: MoodleWorkflowStatus): string {
  if (status === "target_not_found") return "No matching Moodle quiz target was found.";
  if (status === "blocked") return "The Moodle workflow was blocked before completion.";
  if (status === "manual_action_required") return "The Moodle workflow requires manual action.";
  return "Moodle interaction failed.";
}

function sanitizeGraphState(state: AgentState, config: MoodleRuntimeConfig): AgentState {
  const secrets = [
    config.username,
    config.password,
    config.cisUsername,
    config.cisPassword,
    config.calendarUrl,
  ];
  const sanitizeJson = <T>(value: T): T =>
    JSON.parse(redactSensitiveValues(JSON.stringify(value), secrets)) as T;
  return {
    ...state,
    moodle_raw_text: redactSensitiveValues(state.moodle_raw_text, secrets),
    extracted_data: sanitizeJson(state.extracted_data),
    final_document: redactSensitiveValues(state.final_document, secrets),
    error_log: state.error_log
      ? redactSensitiveValues(state.error_log, secrets)
      : state.error_log,
    source_coverage: sanitizeJson(state.source_coverage),
  };
}

async function persistRunDiagnostics(
  config: MoodleRuntimeConfig,
  state: AgentState,
  result: { ok: boolean; workflowStatus: MoodleWorkflowStatus },
): Promise<void> {
  await mkdir(config.runDir, { recursive: true, mode: 0o700 });
  const privateWrite = (filePath: string, value: string) =>
    writeFile(filePath, value, { encoding: "utf8", mode: 0o600 });
  const secrets = [
    config.username,
    config.password,
    config.cisUsername,
    config.cisPassword,
    config.calendarUrl,
  ];
  const interactionKind = (state.extracted_data as Record<string, unknown>).assignment_workflow
    ? "assignment"
    : "quiz";
  const requiredArtifacts = interactionKind === "assignment"
    ? ["assignment-report.md", "assignment-report.json"]
    : ["quiz-review.typ", "quiz-review.json"];
  if (result.workflowStatus === "permission_required") {
    requiredArtifacts.push(...extractPermissionRequestPaths(config, state).map(file => path.relative(config.runDir, file)));
  }
  const interactionResult = {
    schemaVersion: 1,
    ok: result.ok,
    workflowStatus: result.workflowStatus,
    kind: interactionKind,
    requiredArtifacts,
    permissionRequestPaths: extractPermissionRequestPaths(config, state).map(file => path.relative(config.runDir, file)),
  };
  const summary = [
    "# Study Buddy Interaction Summary",
    "",
    `Route: interactive_${interactionKind}`,
    `Run status: ${result.ok ? "success" : "failed"}`,
    `Workflow status: ${result.workflowStatus}`,
    "",
    "## Required artifacts",
    ...requiredArtifacts.map((artifact) => `- ${artifact}`),
    "",
  ].join("\n");
  await Promise.all([
    privateWrite(
      path.join(config.runDir, "interaction-config.json"),
      `${JSON.stringify({
        prompt: redactSensitiveValues(config.prompt, secrets),
        originalUserPrompt: redactSensitiveValues(config.originalUserPrompt, secrets),
        outputLanguage: config.outputLanguage,
        outputLanguageReason: config.outputLanguageReason,
        moodleUrl: sanitizeModelVisibleUrl(config.moodleUrl, secrets),
        runDir: config.runDir,
        maxPages: config.maxPages,
        quizSolverConcurrency: config.quizSolverConcurrency,
        executionProfile: config.executionProfile,
        quizSolverModelPolicy: config.quizSolverModelPolicy,
        browserBackend: config.browserBackend,
        hasUsername: Boolean(config.username),
        hasPassword: Boolean(config.password),
        quizAccessMode: config.quizSafetyPolicy?.accessMode,
      }, null, 2)}\n`,
    ),
    privateWrite(path.join(config.runDir, "moodle_raw.txt"), state.moodle_raw_text),
    privateWrite(path.join(config.runDir, "interaction-state.json"), `${JSON.stringify({
      ...state,
      moodle_raw_text: state.moodle_raw_text ? "[see moodle_raw.txt]" : "",
      final_document: state.final_document ? "[see interaction report]" : "",
    }, null, 2)}\n`),
    privateWrite(
      path.join(config.runDir, "source_coverage.json"),
      `${JSON.stringify(state.source_coverage, null, 2)}\n`,
    ),
    privateWrite(path.join(config.runDir, "error.log"), state.error_log ?? ""),
    atomicPrivateWrite(
      path.join(config.runDir, "interaction-result.json"),
      `${JSON.stringify(interactionResult, null, 2)}\n`,
    ),
    atomicPrivateWrite(path.join(config.runDir, "run-summary.md"), summary),
  ]);
}

async function atomicPrivateWrite(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function persistInteractionProgress(
  config: MoodleRuntimeConfig,
  state: AgentState,
  status: string,
): Promise<void> {
  await mkdir(config.runDir, { recursive: true, mode: 0o700 });
  const quiz = (state.extracted_data as Record<string, unknown>).quiz_workflow as
    Record<string, unknown> | undefined;
  const results = Array.isArray(quiz?.fill_results) ? quiz.fill_results : [];
  await atomicPrivateWrite(path.join(config.runDir, "interaction-progress.json"), `${JSON.stringify({
    schemaVersion: 1,
    status,
    updatedAt: new Date().toISOString(),
    pageNumber: quiz?.page_number ?? null,
    phase: quiz?.phase ?? null,
    capturedQuestions: quiz?.captured_questions ?? 0,
    captureComplete: quiz?.capture_complete === true,
    completedSolverTasks: quiz?.completed_solver_tasks ?? 0,
    peakParallelSolvers: quiz?.peak_parallel_solvers ?? 0,
    savedAnswers: results.filter((result) => result.filled === true && result.persisted === true).length,
    alreadyAnswered: results.filter((result) => result.already_answered === true && result.persisted === true).length,
    verifiedAnswers: results.filter((result) => result.persisted === true).length,
    finalSubmitClicked: false,
  }, null, 2)}\n`);
}
