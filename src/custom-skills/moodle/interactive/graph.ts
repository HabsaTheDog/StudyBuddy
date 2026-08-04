import { mkdir, writeFile } from "node:fs/promises";
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
  createQuizFillNode,
  createQuizPageNode,
  createQuizSolverNode,
  createQuizTargetNode,
  isQuizWorkflowDone,
} from "./nodes/quizWorkflowNodes.js";
import { isAssignmentSubmissionPrompt, isQuizPrompt } from "./quizIntent.js";

export interface InteractiveGraphDependencies {
  codex?: CodexClient;
  browser?: AgentBrowserClient;
  assignmentWorkflowNode?: ReturnType<typeof createAssignmentWorkflowNode>;
  quizTargetNode?: ReturnType<typeof createQuizTargetNode>;
  quizPageNode?: ReturnType<typeof createQuizPageNode>;
  quizSolverNode?: ReturnType<typeof createQuizSolverNode>;
  quizFillNode?: ReturnType<typeof createQuizFillNode>;
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
      browser,
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
  await persistRunDiagnostics(config, state);
  return {
    ok,
    workflowStatus,
    coverageComplete: state.source_coverage.moodle.status === "success",
    runDir: config.runDir,
    state,
    sourceCoverage: state.source_coverage,
    permissionRequestPath: extractPermissionRequestPath(config, state),
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

  return new StateGraph(AgentStateAnnotation)
    .addNode("router", async () => ({}))
    .addNode(
      "assignmentWorkflow",
      dependencies.assignmentWorkflowNode ??
        createAssignmentWorkflowNode(config, { agentBrowser: browser }),
    )
    .addNode(
      "quizTarget",
      dependencies.quizTargetNode ?? createQuizTargetNode(config, { agentBrowser: browser }),
    )
    .addNode(
      "quizPage",
      dependencies.quizPageNode ?? createQuizPageNode(config, { agentBrowser: browser }),
    )
    .addNode("quizSolver", dependencies.quizSolverNode ?? createQuizSolverNode(config, { codex }))
    .addNode(
      "quizFill",
      dependencies.quizFillNode ?? createQuizFillNode(config, { agentBrowser: browser }),
    )
    .addEdge(START, "router")
    .addConditionalEdges("router", () => routeInitial(config), {
      assignmentWorkflow: "assignmentWorkflow",
      quizTarget: "quizTarget",
    })
    .addEdge("assignmentWorkflow", END)
    .addConditionalEdges("quizTarget", routeAfterQuizStep, {
      quizPage: "quizPage",
      end: END,
    })
    .addEdge("quizPage", "quizSolver")
    .addEdge("quizSolver", "quizFill")
    .addConditionalEdges("quizFill", routeAfterQuizStep, {
      quizPage: "quizPage",
      end: END,
    })
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

function routeAfterQuizStep(state: LangGraphAgentState): "quizPage" | "end" {
  return isQuizWorkflowDone(state) ? "end" : "quizPage";
}

export function deriveWorkflowStatus(state: AgentState): MoodleWorkflowStatus {
  if (state.error_log) return "failed";
  const data = state.extracted_data as Record<string, unknown>;
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
    const reason = String(quiz.stop_reason ?? "");
    if (reason === "no-quiz-target") return "target_not_found";
    if (
      reason &&
      reason !== "no-safe-next-page" &&
      reason !== "max-pages-reached" &&
      reason !== "attempt-summary-reached"
    ) {
      return "blocked";
    }
    return quiz.done === true ? "completed" : "failed";
  }
  return "failed";
}

function extractPermissionRequestPath(
  config: MoodleRuntimeConfig,
  state: AgentState,
): string | undefined {
  const data = state.extracted_data as Record<string, unknown>;
  const assignment = data.assignment_workflow as Record<string, unknown> | undefined;
  if (typeof assignment?.permission_request_path === "string") {
    return assignment.permission_request_path;
  }
  const quiz = data.quiz_workflow as Record<string, unknown> | undefined;
  return quiz?.pending_permission
    ? path.join(config.runDir, "quiz-permission-request.json")
    : undefined;
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
  ]);
}
