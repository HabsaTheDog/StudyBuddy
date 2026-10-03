import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink, lstat } from "node:fs/promises";
import { z } from "zod";
import {
  directDocumentContext,
  checkPath,
  containedPath,
  readOwnedFile,
  writeOwnedFile,
} from "./directDocumentPaths.js";
import { createPlaywrightBrowserClient } from "./interactive/playwrightBrowserClient.js";
import { createBrowserLoginConfig, ensureAgentBrowserLoggedIn } from "./interactive/browserAuth.js";
import { createQuizSafetyPolicy } from "./interactive/config.js";
import {
  enforceQuizSafetyPolicy,
  extractQuizMetadata,
  type QuizMetadata,
} from "./interactive/quizSafetyPolicy.js";
import {
  buildPendingQuizPermissionRequest,
  loadApprovedQuizPermission,
  assertApprovedQuizTarget,
  claimApprovedQuizPermission,
} from "./interactive/quizPermissions.js";
import { inspectQuizNavigation } from "./interactive/nodes/quizAttemptWorkflow.js";
import {
  extractQuizPage,
  buildQuestionPacket,
  fillVisibleQuestion,
  verifyQuestionAnswers,
  clickSafeNextPage,
  clickSafeStartOrContinue,
  type QuizPageExtraction,
  type AnswerSpec,
} from "./interactive/nodes/quizReviewNode.js";
import type { AgentBrowserClient } from "./interactive/agentBrowserClient.js";
import type { MoodleRuntimeConfig, QuizSafetyPolicy } from "./interactive/types.js";
import { quizDateGate } from "./interactive/quizTargetDate.js";
import {
  reserveFirstQuizAttempt,
  bindFirstQuizAttempt,
  loadFirstQuizAttemptBinding,
  assertSameQuizAttempt,
  consumeFirstQuizStartRequest,
  reconcileFirstQuizAttempt,
  type QuizAttemptGuardConfig,
} from "./interactive/quizAttemptGuard.js";
import { createFirstQuizAttemptRequestGuard } from "./interactive/quizAttemptRequestGuard.js";

const Answer = z
  .object({
    question_id: z.string().min(1),
    confidence: z.number().min(0).max(1),
    citations: z.array(z.string()),
    rationale: z.string().optional(),
    risk_flags: z.array(z.string()).max(0).optional(),
    control_answers: z
      .array(
        z
          .object({ control_id: z.string().min(1), answer: z.string(), selected: z.boolean() })
          .strict(),
      )
      .min(1),
  })
  .strict();
const Request = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("inspect"), url: z.string().url(), prompt: z.string().optional() })
    .strict(),
  z
    .object({
      op: z.literal("start"),
      runDir: z.string(),
      permissionRequestPath: z.string().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("read"),
      runDir: z.string(),
      page: z.number().int().nonnegative().optional(),
      permissionRequestPath: z.string().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("fill"),
      runDir: z.string(),
      answers: z.array(Answer).min(1),
      packetDigest: z.string().min(1),
      permissionRequestPath: z.string().optional(),
    })
    .strict(),
  ...(["next", "recover"] as const).map((op) =>
    z
      .object({
        op: z.literal(op),
        runDir: z.string(),
        permissionRequestPath: z.string().optional(),
      })
      .strict(),
  ),
  z.object({ op: z.literal("status"), runDir: z.string() }).strict(),
]);
type RequestType = z.infer<typeof Request>;
const State = z
  .object({
    version: z.literal(1),
    ownerThreadId: z.string(),
    workspace: z.string(),
    runDir: z.string(),
    targetUrl: z.string(),
    prompt: z.string(),
    status: z.enum(["inspected", "active", "summary", "manual_action_required"]),
    metadata: z.custom<QuizMetadata>(),
    attemptUrl: z.string().optional(),
    packetDigest: z.string().optional(),
    page: z.custom<QuizPageExtraction>().optional(),
    navigation: z.enum(["single-page", "free", "unknown"]).optional(),
    verifiedPageUrl: z.string().optional(),
    nextUrl: z.string().optional(),
    permissionRequestPath: z.string().optional(),
    approvedRequestId: z.string().optional(),
    answers: z.array(Answer).optional(),
  })
  .strict();
type QuizState = z.infer<typeof State>;
export interface DirectQuizDependencies {
  browser?: (config: MoodleRuntimeConfig) => AgentBrowserClient;
  extract?: typeof extractQuizPage;
  metadata?: typeof extractQuizMetadata;
  navigation?: typeof inspectQuizNavigation;
  start?: typeof clickSafeStartOrContinue;
  fill?: typeof fillVisibleQuestion;
  next?: typeof clickSafeNextPage;
}
export interface DirectQuizResult {
  ok: boolean;
  kind: "direct_quiz";
  status: string;
  [key: string]: unknown;
}

/** Only fixed operations are exposed. Question content is untrusted data; no model is called here. */
export async function executeDirectQuiz(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
  deps: DirectQuizDependencies = {},
): Promise<DirectQuizResult> {
  const request = Request.parse(input);
  if (env.STUDY_BUDDY_BROKER_EXECUTION !== "1")
    throw Error("Direct quiz operations require the Study Buddy broker.");
  const context = await directDocumentContext(env);
  const root = path.join(context.threadRoot, "direct-quizzes");
  await checkPath(context.workspace, root, true);
  let state: QuizState;
  if (request.op === "inspect") {
    const targetUrl = quizTarget(request.url, env);
    const runDir = path.join(root, randomUUID());
    await mkdir(runDir, { mode: 0o700 });
    state = {
      version: 1,
      ownerThreadId: context.ownerThreadId,
      workspace: context.workspace,
      runDir,
      targetUrl,
      prompt: request.prompt ?? "Inspect this quiz",
      status: "inspected",
      metadata: null as unknown as QuizMetadata,
    };
  } else {
    const runDir = containedPath(root, request.runDir);
    if (path.dirname(runDir) !== root) throw Error("Expected one direct quiz run directory.");
    state = State.parse(
      JSON.parse(
        (await readOwnedFile(context.workspace, path.join(runDir, "direct-quiz.json"))).toString(),
      ),
    );
    if (
      state.ownerThreadId !== context.ownerThreadId ||
      state.workspace !== context.workspace ||
      state.runDir !== runDir
    )
      throw Error("Quiz belongs to a different broker-owned thread.");
    quizTarget(state.targetUrl, env);
  }
  const lock = path.join(state.runDir, ".operation-lock");
  const lease = await acquireOperationLease(state.workspace, lock);
  let client: AgentBrowserClient | undefined;
  try {
    const policy = await effectivePolicy(state, request, env);
    const config = browserConfig(state, policy, env);
    const guard = guardConfig(state, env);
    client = (deps.browser ?? createPlaywrightBrowserClient)(config);
    if (!client.setQuizRequestGuard)
      throw Error("Quiz tools require the guarded Playwright backend.");
    client.setQuizRequestGuard(
      createFirstQuizAttemptRequestGuard({
        targetUrl: state.targetUrl,
        loadBinding: () => loadFirstQuizAttemptBinding(guard),
        debitStartBeforeForward: () => consumeFirstQuizStartRequest(guard),
      }),
    );
    allowed(policy, "open_quiz_page");
    await ensureAgentBrowserLoggedIn(
      client,
      createBrowserLoginConfig({
        serviceName: "Moodle",
        targetUrl: config.dashboardUrl,
        username: config.username,
        password: config.password,
        allowedOrigins: config.moodleLoginAllowedOrigins,
      }),
    );
    await client.open(state.targetUrl);
    assertTarget(await client.getUrl(), state.targetUrl);
    state.metadata = await (deps.metadata ?? extractQuizMetadata)(client);
    const extract = deps.extract ?? extractQuizPage;
    if (request.op === "inspect") {
      const decision =
        quizDateGate(config, state.metadata) ??
        enforceQuizSafetyPolicy(policy, "start_or_continue_attempt", { metadata: state.metadata });
      if (decision.status === "permission_required") {
        const pending = buildPendingQuizPermissionRequest({
          targetUrl: state.targetUrl,
          quizTitle: await client.getTitle(),
          decision,
          metadata: state.metadata,
        });
        state.permissionRequestPath = path.join(state.runDir, "quiz-permission-request.json");
        await writeOwnedFile(
          context.workspace,
          state.permissionRequestPath,
          JSON.stringify(pending),
        );
      }
      await save(state);
      return out(state, true, {
        decision,
        permissionRequestPath: state.permissionRequestPath,
        untrusted: true,
        title: await client.getTitle(),
        metadata: state.metadata,
        instructions:
          "For a positively identified active first attempt, use recover, never start. Otherwise use start only with permitted first-attempt access. Delegate returned question packets to native subagents. Never submit the final attempt.",
      });
    }
    let binding = await loadFirstQuizAttemptBinding(guard);
    if (request.op === "status") {
      await save(state);
      return out(state, true, {
        metadata: state.metadata,
        firstAttemptBound: !!binding,
        finalSubmitClicked: false,
      });
    }
    if (request.op === "start") {
      const date = quizDateGate(config, state.metadata);
      if (date) throw Error(date.reason);
      allowed(policy, "start_or_continue_attempt", { metadata: state.metadata });
      if (binding) {
        if (!state.attemptUrl)
          throw Error(
            "First attempt is already bound; recover its exact stored URL, never start again.",
          );
        assertSameQuizAttempt(binding, state.attemptUrl);
        await client.open(state.attemptUrl);
      } else {
        // Durable reservation is written before the only start click; failures never permit another start.
        await reserveFirstQuizAttempt(guard, state.metadata);
        const started = await (deps.start ?? clickSafeStartOrContinue)(client, {
          continueOnly: false,
        });
        if (!started.clicked) throw Error("No safe first-attempt start control was found.");
        const page = await extract(client);
        const attempt = new URL(page.url).searchParams.get("attempt");
        if (!attempt || !page.questions.length)
          throw Error("The first attempt did not expose a verifiable attempt URL and questions.");
        // Reservation proves no previous attempt existed; the new ID is bound once.
        await client.open(state.targetUrl);
        assertTarget(await client.getUrl(), state.targetUrl);
        const nativeProof = await (deps.metadata ?? extractQuizMetadata)(client);
        if (
          nativeProof.activeAttemptId !== attempt ||
          nativeProof.activeAttemptNumber !== 1 ||
          nativeProof.attemptsUsed !== 1 ||
          !nativeProof.hasActiveAttempt
        )
          throw Error("The native quiz overview does not confirm this exact active first attempt.");
        const newBinding = await bindFirstQuizAttempt(guard, {
          attemptId: attempt,
          attemptNumber: nativeProof.activeAttemptNumber,
        });
        assertSameQuizAttempt(newBinding, page.url);
        state.metadata = nativeProof;
        await client.open(page.url);
        assertSameQuizAttempt(newBinding, await client.getUrl());
        state.attemptUrl = page.url;
        state.status = "active";
        await save(state);
      }
      state.status = "active";
      return await capture(state, client, deps, policy);
    }
    if (request.op === "recover" && !binding) {
      allowed(policy, "start_or_continue_attempt", { metadata: state.metadata });
      binding = await reconcileFirstQuizAttempt(guard, state.metadata);
      state.attemptUrl = new URL(
        `/mod/quiz/attempt.php?attempt=${binding.attemptId}`,
        state.targetUrl,
      ).href;
    }
    if (request.op === "recover" && binding && !state.attemptUrl)
      state.attemptUrl = new URL(
        `/mod/quiz/attempt.php?attempt=${binding.attemptId}`,
        state.targetUrl,
      ).href;
    if (!binding || !state.attemptUrl)
      throw Error("No exact first attempt is bound. Recovery never starts a new attempt.");
    assertSameQuizAttempt(binding, state.attemptUrl);
    allowed(policy, "start_or_continue_attempt", { metadata: state.metadata });
    if (request.op === "recover") {
      await client.open(state.attemptUrl);
      assertSameQuizAttempt(binding, await client.getUrl());
      return await capture(state, client, deps, policy);
    }
    let pageUrl = state.attemptUrl;
    if (request.op === "read" && request.page !== undefined) {
      if (
        state.navigation !== "free" &&
        request.page !== Number(new URL(pageUrl).searchParams.get("page") ?? 0)
      )
        throw Error("This attempt does not permit arbitrary page revisits.");
      const url = new URL(pageUrl);
      url.searchParams.set("page", String(request.page));
      pageUrl = url.toString();
    }
    assertSameQuizAttempt(binding, pageUrl);
    await client.open(pageUrl);
    assertSameQuizAttempt(binding, await client.getUrl());
    allowed(policy, "read_questions");
    const page = await extract(client);
    assertSameQuizAttempt(binding, page.url);
    if (request.op === "read") {
      state.attemptUrl = page.url;
      return await capture(state, client, deps, policy);
    }
    if (request.op === "next") {
      allowed(policy, "save_or_next_page");
      if (
        state.verifiedPageUrl !== page.url ||
        !state.answers ||
        !page.questions.length ||
        page.questions.some((question) => {
          const answer = state.answers!.find(
            (answer) => answer.question_id === question.question_id,
          );
          return !answer || !verifyQuestionAnswers(question, answer).verified;
        })
      )
        throw Error(
          "Next requires every current question to be verified after a server save/reload.",
        );
      if (!state.nextUrl) throw Error("No verified safe next URL is available.");
      assertSameQuizAttempt(binding, state.nextUrl);
      await client.open(state.nextUrl);
      assertSameQuizAttempt(binding, await client.getUrl());
      state.attemptUrl = await client.getUrl();
      state.verifiedPageUrl = undefined;
      state.answers = undefined;
      return await capture(state, client, deps, policy);
    }
    if (request.op !== "fill") throw Error("Unsupported quiz operation.");
    allowed(policy, "suggest_answers");
    allowed(policy, "save_or_next_page");
    if (
      !state.page ||
      state.packetDigest !== request.packetDigest ||
      digest(page) !== request.packetDigest
    )
      throw Error("Question packet is stale. Read current questions before filling.");
    if (state.navigation === "unknown")
      return out(state, false, {
        status: "manual_action_required",
        error:
          "Non-revisitable or unknown navigation requires manual supervised saving; no answers were changed.",
      });
    const ids = request.answers.map((answer) => answer.question_id);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== page.questions.length ||
      page.questions.some((question) => !ids.includes(question.question_id))
    )
      throw Error(
        "Supply exactly one answer for every current question; partial pages are never advanced.",
      );
    for (const question of page.questions) {
      const answer = request.answers.find((answer) => answer.question_id === question.question_id)!;
      allowed(policy, "fill_answers", { question, answer });
      if (
        question.response_model?.support === "adapter_required" ||
        question.response_model?.support === "no_response"
      )
        return out(state, false, {
          status: "manual_action_required",
          question_id: question.question_id,
          response_model: question.response_model,
          error: "Question requires a supervised unsupported-control handoff; no page was changed.",
          finalSubmitClicked: false,
        });
      validateControls(question.controls, answer);
    }
    const fillResults = [];
    for (const question of page.questions) {
      assertSameQuizAttempt(binding, await client.getUrl());
      const answer = request.answers.find((answer) => answer.question_id === question.question_id)!;
      fillResults.push(await (deps.fill ?? fillVisibleQuestion)(client, question, answer, policy));
    }
    const dom = await extract(client);
    if (
      dom.questions.some(
        (question) =>
          !verifyQuestionAnswers(
            question,
            request.answers.find((answer) => answer.question_id === question.question_id)!,
          ).verified,
      )
    )
      throw Error("DOM answer verification failed; safe-next was not clicked.");
    const move = await (deps.next ?? clickSafeNextPage)(client);
    if (!move.clicked) throw Error("No safe save/next control; answers are not claimed persisted.");
    const savedUrl = await client.getUrl();
    assertSameQuizAttempt(binding, savedUrl);
    await client.open(page.url);
    assertSameQuizAttempt(binding, await client.getUrl());
    const persisted = await extract(client);
    const checks = page.questions.map((question) => {
      const fresh = persisted.questions.find((item) => item.question_id === question.question_id);
      return {
        question_id: question.question_id,
        ...(fresh
          ? verifyQuestionAnswers(
              fresh,
              request.answers.find((answer) => answer.question_id === question.question_id)!,
            )
          : { verified: false, mismatches: ["question-missing-after-reload"] }),
      };
    });
    state.attemptUrl = page.url;
    state.verifiedPageUrl = checks.every((check) => check.verified) ? page.url : undefined;
    state.nextUrl = savedUrl;
    state.answers = request.answers;
    state.page = persisted;
    state.packetDigest = digest(persisted);
    await save(state);
    return out(
      state,
      checks.every((check) => check.verified),
      {
        filled: fillResults,
        checks,
        persisted: checks.every((check) => check.verified),
        finalSubmitClicked: false,
      },
    );
  } finally {
    await client?.close().catch(() => {});
    await lease.release();
  }
}

async function capture(
  state: QuizState,
  client: AgentBrowserClient,
  deps: DirectQuizDependencies,
  policy: QuizSafetyPolicy,
): Promise<DirectQuizResult> {
  allowed(policy, "read_questions");
  const page = await (deps.extract ?? extractQuizPage)(client);
  const previous = new URL(state.attemptUrl ?? "");
  const actual = new URL(page.url);
  if (
    actual.origin !== previous.origin ||
    actual.searchParams.get("attempt") !== previous.searchParams.get("attempt") ||
    !/\/mod\/quiz\/(?:attempt|summary)\.php$/.test(actual.pathname)
  )
    throw Error("Captured page left the bound quiz attempt.");
  state.page = page;
  state.attemptUrl = page.url;
  state.packetDigest = digest(page);
  state.navigation = await (deps.navigation ?? inspectQuizNavigation)(
    client,
    page.questions.length,
  );
  state.status = new URL(page.url).pathname.endsWith("/summary.php") ? "summary" : "active";
  const packets = [];
  for (const question of page.questions) {
    const directory = path.join(state.runDir, "packets", randomUUID());
    await checkPath(state.workspace, directory, true);
    const packet = buildQuestionPacket({
      page,
      question,
      pageNumber: Number(new URL(page.url).searchParams.get("page") ?? 0) + 1,
    });
    if (client.captureQuestionEvidence) {
      try {
        packet.media_evidence = await client.captureQuestionEvidence(
          question.question_id,
          directory,
        );
      } catch {
        packet.media_evidence = { images: [], errors: ["question-media-capture-failed"] };
      }
    }
    const packetPath = path.join(directory, "packet.json");
    await writeOwnedFile(state.workspace, packetPath, JSON.stringify(packet));
    packets.push({
      question_id: question.question_id,
      packetPath,
      media_evidence: packet.media_evidence,
      response_model: question.response_model,
    });
  }
  await save(state);
  return out(state, true, {
    untrusted: true,
    page,
    packets,
    packetDigest: state.packetDigest,
    navigation: state.navigation,
    finalSubmitClicked: false,
  });
}

function quizTarget(value: string, env: NodeJS.ProcessEnv): string {
  const configured = env.MOODLE_BASE_URL || env.MOODLE_DASHBOARD_URL || env.STUDY_BUDDY_MOODLE_URL;
  if (!configured) throw Error("No Moodle source is configured.");
  const url = new URL(value);
  const base = new URL(configured);
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.pathname !== "/mod/quiz/view.php" ||
    !/^\d+$/.test(url.searchParams.get("id") ?? "") ||
    [...url.searchParams.keys()].some((key) => key !== "id")
  )
    throw Error("Inspect requires one exact configured-origin Moodle quiz view URL.");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw Error("Quiz source requires HTTPS.");
  url.hash = "";
  return url.toString();
}
function assertTarget(actual: string, target: string) {
  if (new URL(actual).href !== new URL(target).href)
    throw Error("Quiz target changed during navigation.");
}
function guardConfig(state: QuizState, env: NodeJS.ProcessEnv): QuizAttemptGuardConfig {
  const ledgerRoot = env.STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT;
  const account = env.MOODLE_USERNAME;
  if (!ledgerRoot || !path.isAbsolute(ledgerRoot) || !account)
    throw Error(
      "Quiz tools require a broker-owned global first-attempt ledger and account identity.",
    );
  // Match the legacy guard's account key so separate adapters cannot reserve independent attempts.
  return {
    ledgerRoot,
    targetUrl: state.targetUrl,
    accountKey: createHash("sha256").update(account).digest("hex"),
  };
}
function browserConfig(
  state: QuizState,
  policy: QuizSafetyPolicy,
  env: NodeJS.ProcessEnv,
): MoodleRuntimeConfig {
  // Only browser/policy functions consume this config. No createRuntimeConfig/.env loading or model factory is used.
  return {
    moodleUrl: state.targetUrl,
    baseUrl: new URL(state.targetUrl).origin,
    dashboardUrl: env.MOODLE_DASHBOARD_URL || new URL("/my/", state.targetUrl).href,
    username: env.MOODLE_USERNAME,
    password: env.MOODLE_PASSWORD,
    storageState: env.MOODLE_STORAGE_STATE,
    moodleLoginAllowedOrigins: (env.MOODLE_LOGIN_ALLOWED_ORIGINS ?? "")
      .split(/[\s,]+/)
      .filter(Boolean),
    headless: true,
    browserAllowedDomains: [new URL(state.targetUrl).hostname],
    runDir: state.runDir,
    quizSafetyPolicy: policy,
    prompt: state.prompt,
    originalUserPrompt: state.prompt,
  } as MoodleRuntimeConfig;
}
async function effectivePolicy(
  state: QuizState,
  request: RequestType,
  env: NodeJS.ProcessEnv,
): Promise<QuizSafetyPolicy> {
  let policy = createQuizSafetyPolicy({ firstAttemptOnly: true }, env);
  const permissionPath =
    "permissionRequestPath" in request ? request.permissionRequestPath : undefined;
  if (permissionPath) {
    const approvedIds = z
      .array(z.string())
      .parse(JSON.parse(env.STUDY_BUDDY_QUIZ_APPROVED_REQUEST_IDS ?? "[]"));
    if (!approvedIds.length) throw Error("The broker has not approved this quiz request.");
    if (!path.isAbsolute(permissionPath))
      throw Error("Quiz approval requires a broker-staged absolute request path.");
    // The broker stages and authenticates the request payload. Do not follow an agent-created symlink or expose parse contents.
    await readOwnedFile(path.dirname(permissionPath), permissionPath);
    let permission;
    try {
      permission = await loadApprovedQuizPermission(permissionPath);
    } catch {
      throw Error("Invalid or expired broker quiz approval.");
    }
    if (!approvedIds.includes(permission.requestId))
      throw Error("The broker has not approved this quiz request.");
    assertApprovedQuizTarget(permission, state.targetUrl);
    await claimApprovedQuizPermission(permission);
    // Approval cannot turn Review Only into an execution mode.
    if (policy.accessMode === "review-only")
      throw Error("Review-only access does not permit attempt execution.");
    policy = {
      ...policy,
      askBeforeStartingOrContinuingAttempts: false,
      askBeforeTimedQuizzes: false,
      askBeforeLimitedAttemptQuizzes: false,
      askBeforeFillingAnswers: false,
      askBeforeChangingExistingAnswers: false,
    };
  }
  return policy;
}
function allowed(
  policy: QuizSafetyPolicy,
  action: Parameters<typeof enforceQuizSafetyPolicy>[1],
  context?: Parameters<typeof enforceQuizSafetyPolicy>[2],
) {
  const decision = enforceQuizSafetyPolicy(policy, action, context);
  if (decision.status !== "allowed") throw Error(`${decision.status}: ${decision.reason}`);
}
function validateControls(controls: Array<Record<string, unknown>>, answer: AnswerSpec) {
  const editable = controls.filter(
    (control) =>
      !control.disabled &&
      !control.readonly &&
      !control.readOnly &&
      !["hidden", "submit", "button"].includes(String(control.type ?? control.tag).toLowerCase()),
  );
  const planned = answer.control_answers ?? [];
  const ids = planned.map((control) => control.control_id);
  if (
    ids.length !== editable.length ||
    new Set(ids).size !== ids.length ||
    editable.some((control) => !ids.includes(String(control.control_id)))
  )
    throw Error("Answer must bind every exact current editable control once.");
}
function digest(page: QuizPageExtraction) {
  // A timer/status banner may change between reads. Bind the actual question and response controls, not unrelated live page chrome.
  const questions = page.questions.map((question) => ({
    id: question.question_id,
    index: question.question_index,
    type: question.question_type,
    prompt: question.prompt,
    latex: question.prompt_latex,
    options: question.options,
    controls: question.controls.map(({ raw_html: _rawHtml, ...control }) => control),
    response_model: question.response_model,
  }));
  return createHash("sha256")
    .update(JSON.stringify({ url: page.url, questions }))
    .digest("hex");
}
async function save(state: QuizState) {
  await writeOwnedFile(
    state.workspace,
    path.join(state.runDir, "direct-quiz.json"),
    JSON.stringify(state),
  );
}
function out(state: QuizState, ok: boolean, extra: Record<string, unknown> = {}): DirectQuizResult {
  return {
    ok,
    kind: "direct_quiz",
    status: state.status,
    runDir: state.runDir,
    targetUrl: state.targetUrl,
    attemptUrl: state.attemptUrl,
    ...extra,
  };
}

async function acquireOperationLease(
  workspace: string,
  file: string,
): Promise<{ release: () => Promise<void> }> {
  const message =
    "Another operation is active for this quiz; do not run browser tools concurrently.";
  const create = async () => {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() }));
      await handle.sync();
    } catch (error) {
      await handle.close();
      throw error;
    }
    const owned = await handle.stat();
    return {
      release: async () => {
        await handle.close();
        const current = await lstat(file).catch(() => null);
        if (current?.ino === owned.ino && current.dev === owned.dev) await unlink(file);
      },
    };
  };
  try {
    return await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const previous = await lstat(file);
  let stale;
  try {
    stale = z
      .object({ version: z.literal(1), pid: z.number().int().positive(), token: z.string().uuid() })
      .strict()
      .parse(JSON.parse((await readOwnedFile(workspace, file)).toString()));
  } catch {
    throw Error(message);
  } // Empty/initializing/malformed locks are never considered dead.
  try {
    process.kill(stale.pid, 0);
    throw Error(message);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  // Serialize reclaimers for this exact generation; no losing reclaimer may unlink a replacement live lease.
  const reclaimFile = `${file}.reclaim-${stale.token}`;
  const reclaim = await open(reclaimFile, "wx", 0o600).catch(() => {
    throw Error("Quiz lock recovery is already in progress.");
  });
  try {
    const current = await lstat(file);
    if (current.ino !== previous.ino || current.dev !== previous.dev) throw Error(message);
    await unlink(file);
    return await create();
  } finally {
    await reclaim.close();
    await unlink(reclaimFile);
  }
}
