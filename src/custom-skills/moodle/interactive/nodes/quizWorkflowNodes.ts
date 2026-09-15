import { quizDateGate } from "../quizTargetDate.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { createBrowserClient } from "../browserClient.js";
import { createBrowserLoginConfig, ensureAgentBrowserLoggedIn } from "../browserAuth.js";
import type { CodexClient } from "../codexClient.js";
import { extractQuizUrls, promptWantsQuizAttempt } from "../quizIntent.js";
import { requestedQuizCount, resolveQuizTargets } from "../quizTargets.js";
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
  assertApprovedQuizTarget,
  claimApprovedQuizPermission,
  persistPendingQuizPermission,
} from "../quizPermissions.js";
import {
  appendQuizLinkToReport,
  buildQuizReviewReport,
  clickSafeStartOrContinue,
  detectQuizRisks,
  extractQuizPage,
  formatQuizRawText,
  persistQuizArtifacts,
  policyDecisionResult,
  type QuizPageExtraction,
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
    const targetUrls = await resolveQuizTargets(config, client, dependencies.codex);
    const targetUrl = targetUrls[0] ?? null;
    const requestedCount = extractQuizUrls(config.prompt).length || requestedQuizCount(config.prompt);
    const missingCount = requestedCount === null ? null : Math.max(0, requestedCount - targetUrls.length);
    const workflow: QuizWorkflowState & {
      target_urls: string[];
      requested_quiz_count: number | null;
      missing_quiz_count: number | null;
    } = {
      kind: "quiz_workflow",
      target_url: targetUrl,
      target_urls: targetUrls,
      requested_quiz_count: requestedCount,
      missing_quiz_count: missingCount,
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
          `Prompt: ${config.originalUserPrompt}`,
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
      metadata = await extractQuizMetadata(client);
      const openedPage: QuizPageExtraction = {
        title: await client.getTitle(),
        url: await client.getUrl(),
        body_text: "",
        questions: [],
      };
      workflow.page = openedPage;
      const dateGate = quizDateGate(config, metadata);
      if (dateGate) return await stopQuizWorkflowForPolicy(config, state, workflow, dateGate, metadata);
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
    if (config.approvedQuizPermission && !permissionClaimed && beforeStart.questions.length > 0 &&
        promptWantsQuizAttempt(config.prompt)) {
      assertApprovedQuizTarget(config.approvedQuizPermission, workflow.target_url);
      await claimApprovedQuizPermission(config.approvedQuizPermission);
      permissionClaimed = true;
    }
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
      const dateGate = quizDateGate(config, metadata);
      if (dateGate) return await stopQuizWorkflowForPolicy(config, state, workflow, dateGate, metadata);
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
        assertApprovedQuizTarget(config.approvedQuizPermission, workflow.target_url);
        await claimApprovedQuizPermission(config.approvedQuizPermission);
        permissionClaimed = true;
      }
      startResult = await clickSafeStartOrContinue(client, { continueOnly: metadata.hasActiveAttempt });
    }
    // Both direct attempt links and Moodle's resume control can open a later
    // page. Rewind only when a real question-navigation anchor permits it.
    if (workflow.page_number === 1 && promptWantsQuizAttempt(config.prompt) && metadata?.hasActiveAttempt &&
        (beforeStart.questions.length > 0 || startResult.started)) {
      const attemptUrl = new URL(await client.getUrl());
      if (/\/mod\/quiz\/attempt\.php$/.test(attemptUrl.pathname) && Number(attemptUrl.searchParams.get("page") ?? 0) > 0) {
        const firstPageUrl = await client.evalJson<string | null>(`(() => {
          const marker = "QUIZ_FIRST_PAGE_URL"; void marker;
          const current = new URL(location.href);
          const first = Array.from(document.querySelectorAll('.qnbutton[href], #mod_quiz_navblock a[href]')).map(a => {
            try { return new URL(a.getAttribute('href'), location.href); } catch { return null; }
          }).find(url => url && url.origin === current.origin && url.pathname === current.pathname &&
            url.searchParams.get('attempt') === current.searchParams.get('attempt') && Number(url.searchParams.get('page') ?? 0) === 0);
          return JSON.stringify(first?.toString() ?? null);
        })()`);
        if (typeof firstPageUrl === "string") await client.open(firstPageUrl);
      }
    }
    const page = await extractQuizPage(client);
    const risks = [...new Set([...workflow.risks, ...detectQuizRisks(page.body_text)])];
    const nextWorkflow: QuizWorkflowState = {
      ...workflow,
      started: workflow.started || Boolean(startResult.started) || page.questions.length > 0,
      start_result: startResult,
      permission_claimed: permissionClaimed,
      page,
      metadata,
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
    ? appendQuizLinkToReport(
        `${report}\n\n== Native approval required\n\nPermission request: ${permissionRequestPath}\n`,
        target,
      )
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
