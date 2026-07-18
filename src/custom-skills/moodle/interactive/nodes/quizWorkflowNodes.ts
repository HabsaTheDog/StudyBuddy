import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { createBrowserClient } from "../browserClient.js";
import { createBrowserLoginConfig, ensureAgentBrowserLoggedIn } from "../browserAuth.js";
import type { CodexClient } from "../codexClient.js";
import { extractQuizUrl, promptWantsQuizAttempt } from "../quizIntent.js";
import {
  enforceQuizSafetyPolicy,
  extractQuizMetadata,
  type QuizMetadata,
  type QuizPolicyDecision,
} from "../quizSafetyPolicy.js";
import type { JsonObject, LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import {
  buildPendingQuizPermissionRequest,
  claimApprovedQuizPermission,
  persistPendingQuizPermission,
} from "../quizPermissions.js";
import {
  buildQuestionPacket,
  buildQuizReviewReport,
  clickSafeNextPage,
  clickSafeStartOrContinue,
  detectQuizRisks,
  discoverQuizTarget,
  extractQuizPage,
  fillVisibleQuestion,
  formatQuizRawText,
  generateAnswerSpec,
  markPageFillPersistence,
  persistQuizArtifacts,
  policyDecisionResult,
  type AnswerSpec,
  type QuizPageExtraction,
  type QuizQuestion,
} from "./quizReviewNode.js";

interface QuizWorkflowState {
  kind: "quiz_workflow";
  target_url: string | null;
  page_number: number;
  started: boolean;
  done: boolean;
  stop_reason?: string | undefined;
  page?: QuizPageExtraction | undefined;
  metadata?: QuizMetadata | undefined;
  answers?: AnswerSpec[] | undefined;
  fill_results: Array<Record<string, unknown>>;
  risks: string[];
  start_result?: Record<string, unknown> | undefined;
  permission_claimed?: boolean | undefined;
  final_submit_clicked: false;
  pending_permission?: JsonObject | undefined;
}

export interface QuizWorkflowNodeDependencies {
  agentBrowser?: AgentBrowserClient;
  codex?: CodexClient;
}

export function createQuizTargetNode(
  config: MoodleRuntimeConfig,
  dependencies: QuizWorkflowNodeDependencies = {},
) {
  return async function quizTargetNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const client = dependencies.agentBrowser ?? createBrowserClient(config);
    await ensureAgentBrowserLoggedIn(
      client,
      createBrowserLoginConfig({
        serviceName: "Moodle",
        targetUrl: config.moodleUrl || config.dashboardUrl,
        username: config.username,
        password: config.password,
        allowedOrigins: config.moodleLoginAllowedOrigins,
      }),
    );
    const targetUrl = extractQuizUrl(config.prompt) ?? (await discoverQuizTarget(config, client));
    const workflow: QuizWorkflowState = {
      kind: "quiz_workflow",
      target_url: targetUrl,
      page_number: 1,
      started: false,
      done: !targetUrl,
      stop_reason: targetUrl ? undefined : "no-quiz-target",
      fill_results: [],
      risks: [],
      final_submit_clicked: false,
    };
    const finalDocument = targetUrl
      ? state.final_document
      : [
          "= Moodle Quiz Review",
          "",
          `Prompt: ${config.prompt}`,
          "",
          "No matching Moodle quiz target was found in the inspected 2.0 crawl.",
          "",
          "Final submit clicked: false",
          "",
        ].join("\n");
    if (!targetUrl) {
      await persistQuizArtifacts(config, {
        report: finalDocument,
        questions: [],
        candidates: [],
        targetUrl: null,
        finalSubmitClicked: false,
      });
    }
    return {
      extracted_data: putWorkflow(state, workflow),
      final_document: finalDocument,
      source_coverage: targetUrl
        ? state.source_coverage
        : {
            ...state.source_coverage,
            moodle: {
              status: "empty",
              detail: "No Moodle quiz target was found for the prompt.",
              urls: [config.moodleUrl],
              pages: 1,
            },
          },
      error_log: null,
    };
  };
}

export function createQuizPageNode(
  config: MoodleRuntimeConfig,
  dependencies: QuizWorkflowNodeDependencies = {},
) {
  return async function quizPageNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const workflow = getWorkflow(state);
    if (!workflow.target_url || workflow.done) {
      return {};
    }
    const client = dependencies.agentBrowser ?? createBrowserClient(config);
    let metadata = workflow.metadata;
    if (workflow.page_number === 1) {
      const openDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "open_quiz_page");
      if (openDecision.status !== "allowed") {
        return await stopQuizWorkflowForPolicy(config, state, workflow, openDecision);
      }
      await client.open(workflow.target_url);
      await client.wait(2_500);
      metadata = await extractQuizMetadata(client);
      const openedPage: QuizPageExtraction = {
        title: await client.getTitle(),
        url: await client.getUrl(),
        body_text: "",
        questions: [],
      };
      workflow.page = openedPage;
      const wantsAttempt = promptWantsQuizAttempt(config.prompt);
      if (wantsAttempt) {
        const startDecision = enforceQuizSafetyPolicy(
          config.quizSafetyPolicy,
          "start_or_continue_attempt",
          { metadata },
        );
        if (startDecision.status !== "allowed") {
          return await stopQuizWorkflowForPolicy(
            config,
            state,
            { ...workflow, page: openedPage },
            startDecision,
            metadata,
          );
        }
      }
    }

    const readDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "read_questions");
    if (readDecision.status !== "allowed") {
      return await stopQuizWorkflowForPolicy(config, state, workflow, readDecision, metadata);
    }

    const beforeStart = await extractQuizPage(client);
    let permissionClaimed = workflow.permission_claimed === true;
    let startResult = workflow.start_result ?? {
      clicked: false,
      reason: "already-started-or-not-requested",
    };
    if (
      !workflow.started &&
      promptWantsQuizAttempt(config.prompt) &&
      beforeStart.questions.length === 0
    ) {
      metadata = await extractQuizMetadata(client);
      const liveStartDecision = enforceQuizSafetyPolicy(
        config.quizSafetyPolicy,
        "start_or_continue_attempt",
        { metadata },
      );
      if (liveStartDecision.status !== "allowed") {
        return await stopQuizWorkflowForPolicy(
          config,
          state,
          { ...workflow, page: beforeStart },
          liveStartDecision,
          metadata,
        );
      }
      if (config.approvedQuizPermission && !permissionClaimed) {
        await claimApprovedQuizPermission(config.approvedQuizPermission);
        permissionClaimed = true;
      }
      startResult = await clickSafeStartOrContinue(client);
      if (startResult.clicked) {
        await client.wait(1_500);
      }
    }
    const page = await extractQuizPage(client);
    const risks = [...new Set([...workflow.risks, ...detectQuizRisks(page.body_text)])];
    const nextWorkflow: QuizWorkflowState = {
      ...workflow,
      started: workflow.started || Boolean(startResult.clicked) || page.questions.length > 0,
      start_result: startResult,
      permission_claimed: permissionClaimed,
      page,
      metadata,
      answers: [],
      risks,
      done: page.questions.length === 0,
      stop_reason: page.questions.length === 0 ? "no-visible-questions" : workflow.stop_reason,
    };
    if (nextWorkflow.done) {
      const report = buildQuizReviewReport({
        page,
        target: workflow.target_url,
        startResult,
        metadata,
        risks,
        fillResults: workflow.fill_results,
      });
      await persistQuizArtifacts(config, {
        report,
        questions: page.questions,
        candidates: [],
        targetUrl: page.url || workflow.target_url,
        finalSubmitClicked: false,
        startResult,
        metadata,
        risks,
        fillResults: workflow.fill_results,
      });
      return {
        final_document: report,
        moodle_raw_text: formatQuizRawText(page),
        extracted_data: putWorkflow(state, nextWorkflow),
        error_log: null,
      };
    }
    return {
      moodle_raw_text: formatQuizRawText(page),
      extracted_data: putWorkflow(state, nextWorkflow),
      source_coverage: {
        ...state.source_coverage,
        moodle: {
          status: "success",
          detail: `Extracted Moodle quiz page ${workflow.page_number} with ${page.questions.length} question(s).`,
          urls: [page.url || workflow.target_url],
          pages: workflow.page_number,
        },
      },
      error_log: null,
    };
  };
}

export function createQuizSolverNode(
  config: MoodleRuntimeConfig,
  dependencies: QuizWorkflowNodeDependencies = {},
) {
  return async function quizSolverNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const workflow = getWorkflow(state);
    if (workflow.done || !workflow.page?.questions.length) {
      return {};
    }
    if (!config.autoAnswer || !dependencies.codex) {
      return {
        extracted_data: putWorkflow(state, {
          ...workflow,
          answers: [],
          fill_results: [
            ...workflow.fill_results,
            {
              page_number: workflow.page_number,
              action: "solver",
              filled: false,
              reason: config.autoAnswer ? "codex-client-unavailable" : "auto-answer-disabled",
            },
          ],
        }),
      };
    }
    const pageDir = path.join(
      config.runDir,
      "subagent-packets",
      `page-${String(workflow.page_number).padStart(3, "0")}`,
    );
    await mkdir(pageDir, { recursive: true });
    const answers: AnswerSpec[] = [];
    for (const question of workflow.page.questions) {
      const suggestionDecision = enforceQuizSafetyPolicy(
        config.quizSafetyPolicy,
        "suggest_answers",
      );
      if (suggestionDecision.status !== "allowed") {
        return await stopQuizWorkflowForPolicy(
          config,
          state,
          {
            ...workflow,
            fill_results: [
              ...workflow.fill_results,
              {
                ...policyDecisionResult(suggestionDecision, workflow.page_number),
                question_id: question.question_id,
                question_index: question.question_index,
              },
            ],
          },
          suggestionDecision,
          workflow.metadata,
        );
      }
      const packet = buildQuestionPacket({
        page: workflow.page,
        question,
        pageNumber: workflow.page_number,
      });
      const questionDir = path.join(
        pageDir,
        `question-${String(question.question_index).padStart(3, "0")}`,
      );
      await mkdir(questionDir, { recursive: true });
      await writeFile(
        path.join(questionDir, "packet.json"),
        `${JSON.stringify(packet, null, 2)}\n`,
        "utf8",
      );
      const answer = await generateAnswerSpec(dependencies.codex, packet);
      answers.push(answer);
      await writeFile(
        path.join(questionDir, "answer-spec.json"),
        `${JSON.stringify(answer, null, 2)}\n`,
        "utf8",
      );
    }
    return {
      extracted_data: putWorkflow(state, { ...workflow, answers }),
      error_log: null,
    };
  };
}

export function createQuizFillNode(
  config: MoodleRuntimeConfig,
  dependencies: QuizWorkflowNodeDependencies = {},
) {
  return async function quizFillNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const workflow = getWorkflow(state);
    if (workflow.done || !workflow.page || !workflow.target_url) {
      return {};
    }
    const client = dependencies.agentBrowser ?? createBrowserClient(config);
    const pageResults: Array<Record<string, unknown>> = [];
    const answers = workflow.answers ?? [];
    for (const question of workflow.page.questions) {
      const answer = matchAnswer(question, answers);
      if (!answer) {
        pageResults.push({
          page_number: workflow.page_number,
          question_id: question.question_id,
          question_index: question.question_index,
          filled: false,
          reason: "no-answer-spec",
        });
        continue;
      }
      pageResults.push({
        page_number: workflow.page_number,
        ...(await fillVisibleQuestion(client, question, answer, config.quizSafetyPolicy)),
      });
      const lastResult = pageResults[pageResults.length - 1];
      if (lastResult?.action === "policy" && lastResult.status !== "allowed") {
        const decision = resultToPolicyDecision(lastResult);
        return await stopQuizWorkflowForPolicy(
          config,
          state,
          {
            ...workflow,
            fill_results: [...workflow.fill_results, ...pageResults],
          },
          decision,
          workflow.metadata,
        );
      }
    }

    const nextDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "save_or_next_page");
    if (nextDecision.status !== "allowed") {
      return await stopQuizWorkflowForPolicy(
        config,
        state,
        {
          ...workflow,
          fill_results: [...workflow.fill_results, ...markPageFillPersistence(pageResults, false)],
        },
        nextDecision,
        workflow.metadata,
      );
    }
    const navigation = await clickSafeNextPage(client);
    const persistedPageResults = markPageFillPersistence(pageResults, navigation.clicked);
    const allResults = [...workflow.fill_results, ...persistedPageResults];
    allResults.push({ page_number: workflow.page_number, action: "navigation", ...navigation });

    const reachedPageLimit = workflow.page_number >= Math.max(1, config.maxPages);
    const reachedAttemptSummary = navigation.kind === "attempt_summary";
    const hasUnpersistedAnswers = persistedPageResults.some(
      (result) => result.reason === "answer-not-persisted",
    );
    const done = !navigation.clicked || reachedPageLimit || reachedAttemptSummary;
    const nextWorkflow: QuizWorkflowState = {
      ...workflow,
      fill_results: allResults,
      page_number:
        navigation.clicked && !reachedAttemptSummary
          ? workflow.page_number + 1
          : workflow.page_number,
      done,
      stop_reason: reachedAttemptSummary
        ? "attempt-summary-reached"
        : reachedPageLimit
          ? "max-pages-reached"
          : hasUnpersistedAnswers
            ? "answers-not-persisted"
            : navigation.clicked
              ? undefined
              : String(navigation.reason ?? "no-safe-next-page"),
    };

    if (!done) {
      await client.wait(2_500);
      return {
        extracted_data: putWorkflow(state, nextWorkflow),
        error_log: null,
      };
    }

    const currentPage = workflow.page;
    const finalPage = await extractQuizPage(client).catch(() => currentPage);
    const report = buildQuizReviewReport({
      page: finalPage,
      target: workflow.target_url,
      startResult: workflow.start_result ?? {},
      metadata: workflow.metadata,
      risks: workflow.risks,
      fillResults: allResults,
    });
    await persistQuizArtifacts(config, {
      report,
      questions: finalPage.questions,
      candidates: [],
      targetUrl: finalPage.url || workflow.target_url,
      finalSubmitClicked: false,
      metadata: workflow.metadata,
      risks: workflow.risks,
      fillResults: allResults,
      ...(workflow.start_result ? { startResult: workflow.start_result } : {}),
    });
    return {
      final_document: report,
      moodle_raw_text: formatQuizRawText(finalPage),
      extracted_data: putWorkflow(state, nextWorkflow),
      source_coverage: {
        ...state.source_coverage,
        moodle: {
          status: "success",
          detail: `Completed safe quiz fill workflow across ${workflow.page_number} page(s).`,
          urls: [finalPage.url || workflow.target_url],
          pages: workflow.page_number,
        },
      },
      error_log: null,
    };
  };
}

export function isQuizWorkflowDone(state: LangGraphAgentState): boolean {
  return getWorkflow(state).done;
}

function getWorkflow(state: LangGraphAgentState): QuizWorkflowState {
  const data = state.extracted_data;
  const candidate =
    data && !Array.isArray(data) && typeof data === "object"
      ? (data as Record<string, unknown>).quiz_workflow
      : null;
  if (candidate && typeof candidate === "object") {
    return candidate as QuizWorkflowState;
  }
  return {
    kind: "quiz_workflow",
    target_url: null,
    page_number: 1,
    started: false,
    done: true,
    stop_reason: "missing-workflow-state",
    fill_results: [],
    risks: [],
    final_submit_clicked: false,
  };
}

function putWorkflow(state: LangGraphAgentState, workflow: QuizWorkflowState): JsonObject {
  const base =
    state.extracted_data && !Array.isArray(state.extracted_data) ? state.extracted_data : {};
  return JSON.parse(JSON.stringify({ ...base, quiz_workflow: workflow })) as JsonObject;
}

function matchAnswer(question: QuizQuestion, answers: AnswerSpec[]): AnswerSpec | null {
  return (
    answers.find((answer) => answer.question_id && answer.question_id === question.question_id) ??
    answers.find((answer) => Number(answer.question_index) === Number(question.question_index)) ??
    null
  );
}

async function stopQuizWorkflowForPolicy(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  workflow: QuizWorkflowState,
  decision: QuizPolicyDecision,
  metadata?: QuizMetadata,
): Promise<Partial<LangGraphAgentState>> {
  const target = workflow.target_url ?? config.moodleUrl;
  const page = workflow.page ?? {
    title: "Quiz Safety Stop",
    url: target,
    body_text: "",
    questions: [],
  };
  const fillResults = workflow.fill_results.length
    ? workflow.fill_results
    : [policyDecisionResult(decision, workflow.page_number)];
  const permissionRequest =
    decision.status === "permission_required"
      ? buildPendingQuizPermissionRequest({
          targetUrl: target,
          quizTitle: page.title,
          decision,
          metadata,
        })
      : null;
  const permissionRequestPath = permissionRequest
    ? await persistPendingQuizPermission(config, permissionRequest)
    : null;
  const report = buildQuizReviewReport({
    page,
    target,
    startResult: workflow.start_result ?? { clicked: false, reason: decision.reason },
    metadata,
    policyDecision: decision,
    risks: workflow.risks,
    fillResults,
  });
  const finalReport = permissionRequestPath
    ? `${report}\n\n== Native approval required\n\nPermission request: ${permissionRequestPath}\n`
    : report;
  await persistQuizArtifacts(config, {
    report: finalReport,
    questions: page.questions,
    candidates: [],
    targetUrl: page.url || target,
    finalSubmitClicked: false,
    startResult: workflow.start_result ?? { clicked: false, reason: decision.reason },
    metadata,
    policyDecision: decision,
    risks: workflow.risks,
    fillResults,
  });
  return {
    final_document: finalReport,
    moodle_raw_text: formatQuizRawText(page),
    extracted_data: putWorkflow(state, {
      ...workflow,
      metadata,
      done: true,
      stop_reason: decision.reason,
      final_submit_clicked: false,
      ...(permissionRequest
        ? {
            pending_permission: JSON.parse(JSON.stringify(permissionRequest)),
          }
        : {}),
    }),
    source_coverage: {
      ...state.source_coverage,
      moodle: {
        status: "empty",
        detail: `Quiz safety stopped ${decision.action}: ${decision.reason}.`,
        urls: [target],
        pages: workflow.page_number,
      },
    },
    error_log: null,
  };
}

function resultToPolicyDecision(result: Record<string, unknown>): QuizPolicyDecision {
  return {
    status: result.status === "permission_required" ? "permission_required" : "blocked",
    action: String(result.policy_action ?? "fill_answers") as QuizPolicyDecision["action"],
    reason: String(result.reason ?? "quiz-policy-blocked"),
    neededPermission: String(result.needed_permission ?? "quiz_policy_permission"),
  };
}
