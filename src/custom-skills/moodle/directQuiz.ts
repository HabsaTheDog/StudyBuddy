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
  proveFirstQuizAttemptIdentity,
  loadFirstQuizStartRedirect,
  recordFirstQuizStartRedirect,
  type QuizAttemptGuardConfig,
} from "./interactive/quizAttemptGuard.js";
import { createFirstQuizAttemptRequestGuard } from "./interactive/quizAttemptRequestGuard.js";
import { readFirstQuizAttemptIdentity } from "./interactive/quizAttemptReadApi.js";
import {
  canonicalDirectQuizPage,
  inspectDirectQuizInventory,
  pageNumber,
  questionSlot,
} from "./directQuizCapture.js";

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
  ...(["next", "recover", "collect", "complete"] as const).map((op) =>
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
    inventory: z
      .object({
        confirmed: z.boolean(),
        questions: z.array(
          z.object({
            key: z.string(),
            slot: z.string().nullable(),
            number: z.number().int().positive(),
            page: z.number().int().nonnegative(),
          }),
        ),
        pages: z.array(z.number().int().nonnegative()),
        contextSlots: z
          .array(z.object({ slot: z.string(), page: z.number().int().nonnegative() }))
          .optional(),
      })
      .optional(),
    capturedPages: z
      .record(
        z.string(),
        z.object({
          url: z.string(),
          packetDigest: z.string(),
          page: z.custom<QuizPageExtraction>().optional(),
          questions: z.array(
            z.object({
              id: z.string(),
              slot: z.string().nullable(),
              number: z.number(),
              identity: z.string(),
              packetPath: z.string(),
              mediaIdentity: z.string(),
              mediaErrors: z.array(z.string()),
              image_paths: z.array(z.string()),
              own_image_paths: z.array(z.string()).optional(),
            }),
          ),
        }),
      )
      .default({}),
    saveReceipts: z
      .record(
        z.string(),
        z.object({
          url: z.string(),
          verifiedAt: z.string(),
          packetDigest: z.string(),
          contextDigest: z.string().optional(),
          questions: z.array(z.object({ id: z.string(), identity: z.string(), answer: Answer })),
        }),
      )
      .default({}),
    contexts: z
      .record(
        z.string(),
        z.object({
          url: z.string(),
          text: z.string(),
          image_paths: z.array(z.string()),
          mediaIdentities: z.array(z.string()),
          errors: z.array(z.string()),
          descriptionSlots: z.array(z.string()),
        }),
      )
      .default({}),
  })
  .strict();
type QuizState = z.infer<typeof State>;
export interface DirectQuizDependencies {
  readIdentity?: typeof readFirstQuizAttemptIdentity;
  browser?: (config: MoodleRuntimeConfig) => AgentBrowserClient;
  extract?: typeof extractQuizPage;
  metadata?: typeof extractQuizMetadata;
  navigation?: typeof inspectQuizNavigation;
  inventory?: typeof inspectDirectQuizInventory;
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
      capturedPages: {},
      saveReceipts: {},
      contexts: {},
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
        recordStartRedirect: (proof) => recordFirstQuizStartRedirect(guard, proof),
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
    let binding = await loadFirstQuizAttemptBinding(guard);
    // Native Moodle5 active cards deliberately omit attempt IDs. Query only the
    // authenticated user's read API; never click Continue to discover identity.
    let identityLookup: { source: string; status: string; reason?: string } | undefined;
    const needsReadIdentity =
      (!binding && ["inspect", "status", "recover"].includes(request.op)) ||
      (Boolean(binding) && !(await loadFirstQuizStartRedirect(guard)));
    if (
      needsReadIdentity &&
      state.metadata.hasActiveAttempt &&
      state.metadata.attemptsUsed === 1 &&
      !state.metadata.activeAttemptId &&
      state.metadata.identityEvidence?.history.length === 1 &&
      state.metadata.identityEvidence.history[0]?.ordinal === 1
    ) {
      try {
        const courseId = await client.evalJson<number | null>(`(() => {
          const ids = [globalThis.M?.cfg?.courseId,
            ...[...document.body.classList].flatMap(value => /^course-(\\d+)$/.exec(value)?.[1] || [])]
            .map(Number).filter(value => Number.isSafeInteger(value) && value > 0);
          return ids.length && new Set(ids).size === 1 ? ids[0] : null;
        })()`);
        if (!Number.isSafeInteger(courseId) || !courseId || courseId < 1) {
          identityLookup = {
            source: "moodle-mobile-read-api",
            status: "unavailable",
            reason: "native-course-identity-unavailable",
          };
        } else if (!config.username || !config.password) {
          identityLookup = {
            source: "moodle-mobile-read-api",
            status: "unavailable",
            reason: "source-credentials-unavailable",
          };
        } else {
          const proof = await (deps.readIdentity ?? readFirstQuizAttemptIdentity)({
            targetUrl: state.targetUrl,
            courseId,
            username: config.username,
            password: config.password,
          });
          if (proof.ok) {
            state.metadata = {
              ...state.metadata,
              activeAttemptId: proof.identityEvidence.attemptId,
              activeAttemptNumber: 1,
            };
            identityLookup = { source: "moodle-mobile-read-api", status: "verified" };
            await writeOwnedFile(
              context.workspace,
              path.join(state.runDir, "first-attempt-read-identity.json"),
              JSON.stringify({
                targetUrl: state.targetUrl,
                verifiedAt: new Date().toISOString(),
                identityEvidence: proof.identityEvidence,
              }),
            );
          } else {
            identityLookup = {
              source: "moodle-mobile-read-api",
              status: "unavailable",
              reason: proof.error,
            };
          }
        }
      } catch {
        identityLookup = {
          source: "moodle-mobile-read-api",
          status: "unavailable",
          reason: "identity-lookup-failed",
        };
      }
    }
    const extract = async (client: AgentBrowserClient) =>
      canonicalDirectQuizPage(client, await (deps.extract ?? extractQuizPage)(client));
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
        ...(identityLookup ? { identityLookup } : {}),
        instructions:
          "For a positively identified active first attempt, use recover, never start. Otherwise use start only with permitted first-attempt access. Delegate returned question packets to native subagents. Never submit the final attempt.",
      });
    }
    if (request.op === "status") {
      await save(state);
      return out(state, true, {
        metadata: state.metadata,
        firstAttemptBound: !!binding,
        ...(identityLookup ? { identityLookup } : {}),
        finalSubmitClicked: false,
      });
    }
    if (binding && state.metadata.hasActiveAttempt && state.metadata.attemptsUsed === 1) {
      state.metadata = await proveFirstQuizAttemptIdentity(guard, state.metadata);
      if (state.metadata.activeAttemptId !== binding.attemptId)
        throw Error("The native quiz overview conflicts with the bound first attempt.");
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
        const readableInventory = page.questions.length
          ? null
          : await inspectDirectQuizInventory(client, page, "unknown");
        if (
          !attempt ||
          (!page.questions.length &&
            !(readableInventory?.confirmed && readableInventory.questions.length))
        )
          throw Error("The first attempt did not expose a verifiable attempt URL and questions.");
        // Reservation proves no previous attempt existed; the new ID is bound once.
        await client.open(state.targetUrl);
        assertTarget(await client.getUrl(), state.targetUrl);
        const nativeProof = await proveFirstQuizAttemptIdentity(
          guard,
          await (deps.metadata ?? extractQuizMetadata)(client),
        ).catch(() => {
          throw Error("The native quiz overview does not confirm this exact active first attempt.");
        });
        const receipt = await loadFirstQuizStartRedirect(guard);
        if (nativeProof.activeAttemptId !== attempt || !receipt || receipt.attemptId !== attempt)
          throw Error("The native quiz overview does not confirm this exact active first attempt.");
        const newBinding = await bindFirstQuizAttempt(guard, {
          attemptId: attempt,
          attemptNumber: 1,
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
      if (state.metadata.hasActiveAttempt && state.metadata.attemptsUsed === 1)
        state.metadata = await proveFirstQuizAttemptIdentity(guard, state.metadata);
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
    if (request.op === "collect" || request.op === "complete") {
      const restoreUrl = state.attemptUrl;
      await client.open(restoreUrl);
      assertSameQuizAttempt(binding, await client.getUrl());
      const first = await capture(state, client, deps, policy);
      if (state.navigation === "unknown")
        return out(state, false, {
          ...first,
          ok: false,
          status: "manual_action_required",
          error:
            "Only the current page can be collected on non-revisitable or unknown navigation. Solve and verify it before any safe advance.",
        });
      if (!state.inventory?.confirmed)
        return out(state, false, {
          ...first,
          ok: false,
          error: "Native question inventory is unknown; full capture cannot be claimed.",
        });
      if (
        state.navigation !== "free" &&
        state.inventory.pages.some((number) => number !== pageNumber(restoreUrl))
      )
        return out(state, false, {
          status: "manual_action_required",
          error: "Native navigation does not confirm revisitable access to all known pages.",
          finalSubmitClicked: false,
        });
      const expected = JSON.stringify(state.inventory);
      try {
        for (const number of state.inventory.pages) {
          const url = new URL(restoreUrl);
          url.pathname = url.pathname.replace(/\/summary\.php$/, "/attempt.php");
          url.searchParams.set("page", String(number));
          assertSameQuizAttempt(binding, url.href);
          if (
            number !== pageNumber(restoreUrl) ||
            new URL(restoreUrl).pathname.endsWith("/summary.php")
          ) {
            await client.open(url.href);
            assertSameQuizAttempt(binding, await client.getUrl());
            await capture(state, client, deps, policy);
            if (JSON.stringify(state.inventory) !== expected)
              throw Error(
                "Native question inventory changed during collection; refresh before solving.",
              );
          }
        }
      } finally {
        await client.open(restoreUrl);
        assertSameQuizAttempt(binding, await client.getUrl());
        await capture(state, client, deps, policy);
      }
      await bindCollectedContexts(state);
      await save(state);
      const result = out(state, true, {
        untrusted: true,
        packets: Object.values(state.capturedPages).flatMap((entry) =>
          entry.questions.map((question) => ({
            question_id: question.id,
            packetPath: question.packetPath,
            image_paths: question.image_paths,
            page: pageNumber(entry.url),
            packetDigest: entry.packetDigest,
          })),
        ),
        packetDigest: state.packetDigest,
        navigation: state.navigation,
        shared_context: Object.values(state.contexts),
        finalSubmitClicked: false,
      });
      if (request.op === "complete" && !(result.progress as { complete: boolean }).complete)
        result.ok = false;
      return result;
    }
    let pageUrl = state.attemptUrl;
    if (request.op === "read" && request.page !== undefined) {
      if (
        state.navigation !== "free" &&
        request.page !== Number(new URL(pageUrl).searchParams.get("page") ?? 0)
      )
        throw Error("This attempt does not permit arbitrary page revisits.");
      if (state.inventory?.confirmed && !state.inventory.pages.includes(request.page))
        throw Error("Requested page is absent from the native quiz inventory.");
      const url = new URL(pageUrl);
      url.pathname = url.pathname.replace(/\/summary\.php$/, "/attempt.php");
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
        !state.page ||
        !sameQuestionSet(state.page, page) ||
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
    const freshMedia = await mediaIdentities(state, client, page);
    if (
      freshMedia.incomplete.length ||
      Object.values(state.contexts).some((context) => context.errors.length)
    )
      return out(state, false, {
        status: "manual_action_required",
        blocked_questions: freshMedia.incomplete,
        media_diagnostics: freshMedia.diagnostics,
        error: "Original question media is incomplete; no answers were changed or saved.",
        finalSubmitClicked: false,
      });
    if (
      !state.page ||
      state.packetDigest !== request.packetDigest ||
      digest(page, freshMedia.identities, contextDigest(state)) !== request.packetDigest
    ) {
      await writeOwnedFile(state.workspace, path.join(state.runDir, `stale-verification-${Date.now()}.json`), JSON.stringify({
        request_matches_state: state.packetDigest === request.packetDigest,
        diagnostics: state.page ? domVerificationDiagnostics(state.page, page, request.answers, []) : null,
        questions: page.questions.map(question => ({
          question_id: question.question_id,
          before_controls: state.page?.questions.find(item => item.question_id === question.question_id)
            ? questionIdentityFields(state.page.questions.find(item => item.question_id === question.question_id)!).controls : null,
          after_controls: questionIdentityFields(question).controls,
          media_matches: state.capturedPages[String(pageNumber(page.url))]?.questions.find(item => item.id === question.question_id)?.mediaIdentity === freshMedia.identities[question.question_id],
        })),
      }));
      throw Error("Question packet is stale. Read current questions before filling.");
    }
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
    const diagnostics = domVerificationDiagnostics(page, dom, request.answers, fillResults);
    if (
      !diagnostics.same_question_set ||
      diagnostics.questions.some((question) => !question.answers_verified)
    ) {
      // Keep the already redacted, canonical formulation locally for diagnosis;
      // omit raw controls, hidden transport fields and browser/session state.
      const diagnosticEvidencePath = path.join(state.runDir, `dom-verification-${Date.now()}.json`);
      await writeOwnedFile(state.workspace, diagnosticEvidencePath, JSON.stringify({
        questions: page.questions.map(question => ({
          question_index: question.question_index,
          before_html: question.prompt_html,
          after_html: dom.questions.find(item => item.question_id === question.question_id)?.prompt_html,
          before_controls: questionIdentityFields(question).controls,
          after_controls: dom.questions.find(item => item.question_id === question.question_id)
            ? questionIdentityFields(dom.questions.find(item => item.question_id === question.question_id)!).controls : undefined,
        })),
      }));
      return out(state, false, {
        status: "dom_verification_failed",
        error: "DOM answer verification failed; safe-next was not clicked.",
        safeNextClicked: false,
        finalSubmitClicked: false,
        diagnostics,
        diagnosticEvidencePath,
      });
    }
    const move = await (deps.next ?? clickSafeNextPage)(client);
    if (!move.clicked) throw Error("No safe save/next control; answers are not claimed persisted.");
    const savedUrl = await client.getUrl();
    assertSameQuizAttempt(binding, savedUrl);
    await client.open(page.url);
    assertSameQuizAttempt(binding, await client.getUrl());
    const persisted = await extract(client);
    const sameSet = sameQuestionSet(page, persisted);
    const checks = page.questions.map((question) => {
      const fresh = persisted.questions.find((item) => item.question_id === question.question_id);
      return {
        question_id: question.question_id,
        ...(fresh
          ? sameSet
            ? verifyQuestionAnswers(
                fresh,
                request.answers.find((answer) => answer.question_id === question.question_id)!,
              )
            : { verified: false, mismatches: ["question-set-changed-after-reload"] }
          : { verified: false, mismatches: ["question-missing-after-reload"] }),
      };
    });
    state.attemptUrl = page.url;
    state.verifiedPageUrl = checks.every((check) => check.verified) ? page.url : undefined;
    state.nextUrl = savedUrl;
    state.answers = request.answers;
    state.page = persisted;
    const result = await capture(state, client, deps, policy);
    for (const check of checks) {
      if (
        state.capturedPages[String(pageNumber(page.url))]?.questions.find(
          (question) => question.id === check.question_id,
        )?.mediaIdentity !== freshMedia.identities[check.question_id]
      ) {
        check.verified = false;
        check.mismatches.push("original-media-changed-after-reload");
      }
    }
    state.verifiedPageUrl = checks.every((check) => check.verified) ? page.url : undefined;
    if (checks.every((check) => check.verified)) {
      state.saveReceipts[String(pageNumber(page.url))] = {
        url: page.url,
        verifiedAt: new Date().toISOString(),
        packetDigest: state.packetDigest!,
        contextDigest: contextDigest(state),
        questions: state.capturedPages[String(pageNumber(page.url))]!.questions.map((question) => ({
          id: question.id,
          identity: question.identity,
          answer: request.answers.find((answer) => answer.question_id === question.id)!,
        })),
      };
    } else delete state.saveReceipts[String(pageNumber(page.url))];
    await save(state);
    return out(
      state,
      checks.every((check) => check.verified),
      {
        filled: fillResults,
        checks,
        persisted: checks.every((check) => check.verified),
        finalSubmitClicked: false,
        packetDigest: result.packetDigest,
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
  const page = await canonicalDirectQuizPage(
    client,
    await (deps.extract ?? extractQuizPage)(client),
  );
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
  state.status = new URL(page.url).pathname.endsWith("/summary.php") ? "summary" : "active";
  if (state.status === "summary") {
    await save(state);
    return out(state, true, { untrusted: true, page, packets: [], finalSubmitClicked: false });
  }
  state.navigation = await (deps.navigation ?? inspectQuizNavigation)(
    client,
    page.questions.length,
  );
  state.inventory = await (deps.inventory ?? inspectDirectQuizInventory)(
    client,
    page,
    state.navigation,
  );
  const context = {
    url: page.url,
    text: page.body_text,
    image_paths: [] as string[],
    mediaIdentities: [] as string[],
    errors: [] as string[],
    descriptionSlots: [] as string[],
  };
  for (const description of page.descriptions ?? []) {
    const directory = path.join(
      state.runDir,
      "contexts",
      createHash("sha256").update(description.question_id).digest("hex"),
    );
    await checkPath(state.workspace, directory, true);
    let evidence;
    try {
      evidence = await client.captureQuestionEvidence?.(description.question_id, directory);
    } catch {
      evidence = { images: [], errors: ["description-media-capture-failed"] };
    }
    context.mediaIdentities.push(evidenceIdentity(evidence));
    context.image_paths.push(
      ...(evidence?.images ?? []).map((image) => image.viewPath ?? image.path),
      ...(evidence?.screenshotPath ? [evidence.screenshotPath] : []),
    );
    context.errors.push(...(evidence?.errors ?? ["description-media-backend-unavailable"]));
    if (evidence?.complete === false) context.errors.push("description-original-media-incomplete");
    const slot = questionSlot(description);
    if (slot) context.descriptionSlots.push(slot);
  }
  state.contexts[String(pageNumber(page.url))] = context;
  const packets = [];
  const captured: QuizState["capturedPages"][string]["questions"] = [];
  const identities: Record<string, string> = {};
  for (const question of page.questions) {
    const identity = questionIdentity(question);
    const contextIdentity = createHash("sha256").update(page.body_text).digest("hex");
    const directory = path.join(
      state.runDir,
      "packets",
      createHash("sha256").update(question.question_id).digest("hex"),
      `${identity}-${contextIdentity}`,
    );
    await checkPath(state.workspace, directory, true);
    const packet = buildQuestionPacket({
      page,
      question,
      pageNumber: Number(new URL(page.url).searchParams.get("page") ?? 0) + 1,
    });
    packet.visible_context = question.visible_context;
    packet.shared_page_context = page.body_text;
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
    const evidence = packet.media_evidence as
      | import("./interactive/quizMedia.js").QuizQuestionEvidence
      | undefined;
    const image_paths = [
      ...(evidence?.images ?? []).map(
        (image) => (image as { viewPath?: string }).viewPath ?? image.path,
      ),
      evidence?.screenshotPath,
    ].filter((value): value is string => !!value);
    const mediaIdentity = evidenceIdentity(evidence);
    identities[question.question_id] = mediaIdentity;
    packet.image_paths = image_paths;
    packet.media_complete = evidence
      ? ((evidence as { complete?: boolean }).complete ?? !evidence.errors.length)
      : false;
    packet.page_url = page.url;
    const packetPath = path.join(directory, `packet-${mediaIdentity}.json`);
    await writeOwnedFile(state.workspace, packetPath, JSON.stringify(packet));
    packets.push({
      question_id: question.question_id,
      packetPath,
      media_evidence: packet.media_evidence,
      response_model: question.response_model,
      image_paths,
      media_complete: packet.media_complete,
    });
    const mediaErrors = [...(evidence?.errors ?? ["question-media-backend-unavailable"])];
    if (evidence && (evidence as { complete?: boolean }).complete === false)
      mediaErrors.push("original-media-incomplete");
    captured.push({
      id: question.question_id,
      slot: questionSlot(question),
      number: question.question_index,
      identity: `${identity}:${mediaIdentity}:${contextIdentity}`,
      packetPath,
      mediaIdentity,
      mediaErrors,
      image_paths,
      own_image_paths: image_paths,
    });
  }
  state.packetDigest = digest(page, identities, contextDigest(state));
  const number = String(pageNumber(page.url));
  state.capturedPages[number] = {
    url: page.url,
    packetDigest: state.packetDigest,
    page,
    questions: captured,
  };
  const receipt = state.saveReceipts[number];
  if (
    receipt &&
    (receipt.contextDigest !== contextDigest(state) ||
      receipt.questions.length !== page.questions.length ||
      page.questions.some((question) => {
        const item = receipt.questions.find((item) => item.id === question.question_id);
        return (
          !item ||
          item.identity !== captured.find((item) => item.id === question.question_id)?.identity ||
          !verifyQuestionAnswers(question, item.answer).verified
        );
      }))
  )
    delete state.saveReceipts[number];
  await bindCollectedContexts(state);
  await save(state);
  return out(state, true, {
    untrusted: true,
    page,
    packets: packets.map((packet) => {
      const record = captured.find((question) => question.id === packet.question_id)!;
      return { ...packet, packetPath: record.packetPath, image_paths: record.image_paths };
    }),
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
function questionIdentityFields(question: QuizPageExtraction["questions"][number]) {
  const controls = question.controls.map(
    ({ value, checked: _checked, raw_html: _html, options, bounds, ...control }) => ({
      ...control,
      // Explicit public drop geometry defines the task. Layout measurements
      // can change during image loading or responsive rendering.
      bounds: control.type === "dragdrop" && control.target_geometry ? undefined : bounds,
      value: ["radio", "checkbox"].includes(String(control.type)) ? value : undefined,
      options: Array.isArray(options)
        ? options.map(({ selected: _selected, ...option }) => {
            if (String(control.type) !== "dragdrop") return option;
            // A draggable moves from its home to the selected target. Its
            // current position is response state; target geometry stays bound.
            const { bounds: _responsePosition, ...choice } = option;
            return choice;
          })
        : options,
    }),
  );
  return { ...question, controls };
}
function questionIdentity(question: QuizPageExtraction["questions"][number]) {
  return createHash("sha256")
    .update(JSON.stringify(questionIdentityFields(question)))
    .digest("hex");
}

/** Values and HTML stay private: diagnostics describe which existing invariant failed. */
function domVerificationDiagnostics(
  before: QuizPageExtraction,
  after: QuizPageExtraction,
  answers: AnswerSpec[],
  fillResults: Array<Record<string, unknown>>,
) {
  const knownFields = [
    "question_id",
    "question_index",
    "question_type",
    "prompt",
    "prompt_latex",
    "prompt_html",
    "options",
    "controls",
    "visible_context",
    "question_classes",
    "interaction_hints",
    "response_model",
  ] as const;
  const knownFillReasons = new Set([
    "answer-already-matches",
    "question-not-found",
    "control-plan-incomplete",
    "control-not-editable",
    "select-option-not-found",
    "text-answer-empty",
    "unsupported-control-type",
    "radio-selection-invalid",
    "control-plan-invalid",
    "filled-control-plan",
    "filled-text",
    "filled-choice",
    "filled-select",
    "no-compatible-control-or-option-match",
    "question-has-no-response",
    "question-adapter-required",
    "changing-existing-answers-disabled",
    "dragdrop-question-missing",
    "dragdrop-incomplete-plan",
    "dragdrop-unknown-choice",
    "dragdrop-choice-reused",
    "dragdrop-clear-not-confirmed",
    "dragdrop-ui-did-not-settle",
    "dragdrop-placement-not-confirmed",
    "dragdrop-final-state-mismatch",
    "filled-dragdrop-keyboard-plan",
  ]);
  return {
    same_question_set: sameQuestionSet(before, after),
    expected_question_count: before.questions.length,
    observed_question_count: after.questions.length,
    observed_ids_unique:
      new Set(after.questions.map((question) => question.question_id)).size ===
      after.questions.length,
    questions: before.questions.map((question) => {
      const fresh = after.questions.find((item) => item.question_id === question.question_id);
      const identityMatches = !!fresh && questionIdentity(question) === questionIdentity(fresh);
      const priorFields = questionIdentityFields(question);
      const freshFields = fresh ? questionIdentityFields(fresh) : null;
      const changedFields: string[] = freshFields
        ? knownFields.filter(
            (key) => JSON.stringify(priorFields[key]) !== JSON.stringify(freshFields[key]),
          )
        : [];
      if (fresh && !identityMatches && !changedFields.length) changedFields.push("other-fields");
      const answer = answers.find((item) => item.question_id === question.question_id);
      const check =
        fresh && answer
          ? verifyQuestionAnswers(fresh, answer)
          : {
              verified: false,
              mismatches: [fresh ? "answer-plan-missing" : "question-missing-after-fill"],
            };
      const codes = new Set<string>();
      const controlIndices = new Set<number>();
      for (const mismatch of check.mismatches) {
        if (
          [
            "complete-control-plan-required",
            "control-id-missing",
            "answer-plan-missing",
            "question-missing-after-fill",
          ].includes(mismatch)
        )
          codes.add(mismatch);
        else if (mismatch.startsWith("invalid-radio-selection:"))
          codes.add("invalid-radio-selection");
        else {
          codes.add("control-response-mismatch");
          const index =
            fresh?.controls.findIndex(
              (control) => String(control.control_id ?? control.id ?? "") === mismatch,
            ) ?? -1;
          if (index >= 0) controlIndices.add(index);
        }
      }
      return {
        question_index: question.question_index,
        present: !!fresh,
        identity_matches: identityMatches,
        changed_fields: changedFields,
        answers_verified: check.verified,
        mismatch_codes: [...codes],
        control_indices: [...controlIndices],
      };
    }),
    fill_results: fillResults.map((result, index) => ({
      question_index: before.questions[index]?.question_index,
      filled: result.filled === true,
      already_answered: result.already_answered === true,
      changed: typeof result.changed === "boolean" ? result.changed : null,
      reason:
        typeof result.reason === "string"
          ? knownFillReasons.has(result.reason)
            ? result.reason
            : "unrecognized-fill-reason"
          : null,
    })),
  };
}
function sameQuestionSet(before: QuizPageExtraction, after: QuizPageExtraction) {
  return (
    before.questions.length === after.questions.length &&
    new Set(after.questions.map((question) => question.question_id)).size ===
      after.questions.length &&
    before.questions.every((question) =>
      after.questions.some(
        (other) =>
          other.question_id === question.question_id &&
          questionIdentity(other) === questionIdentity(question),
      ),
    )
  );
}
function evidenceIdentity(
  evidence: import("./interactive/quizMedia.js").QuizQuestionEvidence | undefined,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        images: (evidence?.images ?? []).map((image) => ({ url: image.url, sha256: image.sha256 }))
          .sort((a, b) => a.url.localeCompare(b.url) || a.sha256.localeCompare(b.sha256)),
        errors: evidence?.errors ?? ["question-media-backend-unavailable"],
      }),
    )
    .digest("hex");
}
async function mediaIdentities(
  state: QuizState,
  client: AgentBrowserClient,
  page: QuizPageExtraction,
) {
  const identities: Record<string, string> = {};
  const incomplete: string[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const question of page.questions) {
    let evidence;
    for (let attempt = 0; attempt < 3; attempt++) {
      const directory = path.join(state.runDir, "media-checks", randomUUID());
      await checkPath(state.workspace, directory, true);
      try {
        evidence = await client.captureQuestionEvidence?.(question.question_id, directory);
      } catch {
        evidence = { images: [], errors: ["question-media-capture-failed"] };
      }
      const transient = evidence?.errors.length && evidence.errors.every(code =>
        ["question-render-readiness-timeout", "question-render-readiness-failed", "question-image-discovery-failed", "question-screenshot-failed", "question-render-restore-failed"].includes(code) ||
        /^image-[0-9]+:(?:image-download-failed|image-http-(?:408|425|429|500|502|503|504))$/.test(code));
      if (!transient) break;
      await writeOwnedFile(state.workspace, path.join(directory, "capture-check.json"), JSON.stringify({
        question_id: question.question_id, attempt: attempt + 1,
        errors: evidence!.errors, retrying: attempt < 2,
      }));
    }
    identities[question.question_id] = evidenceIdentity(evidence);
    if (
      !evidence ||
      evidence.errors.length ||
      (evidence as { complete?: boolean }).complete === false
    )
    {
      incomplete.push(question.question_id);
      const staticCodes = new Set(["question-media-capture-failed", "question-render-readiness-timeout", "question-render-readiness-failed", "question-image-discovery-failed", "question-screenshot-failed", "question-render-restore-failed"]);
      diagnostics.push({ question_id: question.question_id,
        errors: evidence?.errors.map(code => staticCodes.has(code) ? code : "original-image-capture-failed") ?? ["question-media-backend-unavailable"],
        complete: evidence?.complete === true,
        expected_images: evidence?.expectedImageCount,
        captured_images: evidence?.capturedImageCount,
        readiness: evidence?.readinessDiagnostics ? {
          incompleteImages: Number.isSafeInteger(evidence.readinessDiagnostics.incompleteImages) ? evidence.readinessDiagnostics.incompleteImages : undefined,
          incompletePlaceholders: Number.isSafeInteger(evidence.readinessDiagnostics.incompletePlaceholders) ? evidence.readinessDiagnostics.incompletePlaceholders : undefined,
          fontsLoading: evidence.readinessDiagnostics.fontsLoading === true,
          mathJaxHub: evidence.readinessDiagnostics.mathJaxHub === true,
          questionMath: evidence.readinessDiagnostics.questionMath === true,
        } : undefined,
      });
    }
  }
  return { identities, incomplete, diagnostics };
}
function digest(page: QuizPageExtraction, media: Record<string, string>, sharedContext: string) {
  // A timer/status banner may change between reads. Bind the actual question and response controls, not unrelated live page chrome.
  const questions = page.questions.map((question) => ({
    id: question.question_id,
    index: question.question_index,
    type: question.question_type,
    prompt: question.prompt,
    html: question.prompt_html,
    visible_context: question.visible_context,
    latex: question.prompt_latex,
    options: question.options,
    controls: questionIdentityFields(question).controls,
    // Share task normalization with post-fill verification, while separately
    // binding the current responses to prevent overwriting a changed answer.
    responses: question.controls.map(({ value, checked, options }) => ({
      value, checked,
      selected: Array.isArray(options)
        ? options.map(({ value, selected }) => ({ value, selected })) : undefined,
    })),
    response_model: question.response_model,
  }));
  return createHash("sha256")
    .update(
      JSON.stringify({
        url: page.url,
        questions,
        media,
        shared_page_context: page.body_text,
        sharedContext,
      }),
    )
    .digest("hex");
}
function contextDigest(state: QuizState) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(state.contexts)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([number, context]) => ({
            number,
            url: context.url,
            text: context.text,
            mediaIdentities: context.mediaIdentities,
            errors: context.errors,
          })),
      ),
    )
    .digest("hex");
}
async function bindCollectedContexts(state: QuizState) {
  const contextIdentity = contextDigest(state);
  for (const [number, entry] of Object.entries(state.capturedPages)) {
    if (!entry.page) continue;
    entry.packetDigest = digest(
      entry.page,
      Object.fromEntries(entry.questions.map((question) => [question.id, question.mediaIdentity])),
      contextIdentity,
    );
    for (const question of entry.questions) {
      const packet = JSON.parse(
        (await readOwnedFile(state.workspace, question.packetPath)).toString(),
      );
      packet.attempt_contexts = Object.values(state.contexts);
      packet.image_paths = [
        ...new Set([
          ...(question.own_image_paths ?? question.image_paths),
          ...Object.values(state.contexts).flatMap((context) => context.image_paths),
        ]),
      ].sort(
        (a, b) =>
          Number(/(?:^|[\\/])question\.png$/.test(a)) - Number(/(?:^|[\\/])question\.png$/.test(b)),
      );
      packet.media_complete =
        question.mediaErrors.length === 0 &&
        Object.values(state.contexts).every((context) => context.errors.length === 0);
      const packetPath = path.join(
        path.dirname(question.packetPath),
        `packet-${question.mediaIdentity}-${contextIdentity}.json`,
      );
      await writeOwnedFile(state.workspace, packetPath, JSON.stringify(packet));
      question.packetPath = packetPath;
      question.image_paths = packet.image_paths;
    }
    if (state.saveReceipts[number]?.contextDigest !== contextIdentity)
      delete state.saveReceipts[number];
  }
  if (state.page && !new URL(state.page.url).pathname.endsWith("/summary.php"))
    state.packetDigest = state.capturedPages[String(pageNumber(state.page.url))]?.packetDigest;
}
async function save(state: QuizState) {
  await writeOwnedFile(
    state.workspace,
    path.join(state.runDir, "direct-quiz.json"),
    JSON.stringify(state),
  );
}
function out(state: QuizState, ok: boolean, extra: Record<string, unknown> = {}): DirectQuizResult {
  const captured = Object.values(state.capturedPages).flatMap((page) => page.questions);
  const verified = Object.values(state.saveReceipts).flatMap((receipt) => receipt.questions);
  const inventory = state.inventory;
  const unresolved: string[] = [];
  const captureUnresolved: string[] = [];
  if (!inventory?.confirmed) captureUnresolved.push("native-question-inventory-unknown");
  for (const expected of inventory?.contextSlots ?? []) {
    if (!state.contexts[String(expected.page)]?.descriptionSlots.includes(expected.slot))
      captureUnresolved.push(`context-not-captured:${expected.slot}`);
  }
  for (const context of Object.values(state.contexts))
    if (context.errors.length)
      captureUnresolved.push(`context-media-unresolved:${pageNumber(context.url)}`);
  for (const expected of inventory?.questions ?? []) {
    const found = state.capturedPages[String(expected.page)]?.questions.find((question) =>
      expected.slot ? question.slot === expected.slot : question.number === expected.number,
    );
    if (!found) captureUnresolved.push(`not-captured:${expected.key}`);
    else {
      if (found.mediaErrors.length) captureUnresolved.push(`media-unresolved:${found.id}`);
      if (
        !state.saveReceipts[String(expected.page)]?.questions.some(
          (question) => question.id === found.id && question.identity === found.identity,
        )
      )
        unresolved.push(`not-verified:${found.id}`);
    }
  }
  for (const page of Object.values(state.capturedPages))
    for (const found of page.questions) {
      if (
        !inventory?.questions.some(
          (expected) =>
            expected.page === pageNumber(page.url) &&
            (expected.slot ? found.slot === expected.slot : found.number === expected.number),
        )
      )
        captureUnresolved.push(`outside-inventory:${found.id}`);
    }
  unresolved.unshift(...captureUnresolved);
  return {
    ok,
    kind: "direct_quiz",
    status: state.status,
    runDir: state.runDir,
    targetUrl: state.targetUrl,
    attemptUrl: state.attemptUrl,
    inventory,
    progress: {
      total: inventory?.confirmed ? inventory.questions.length : null,
      captured: new Set(captured.map((question) => question.id)).size,
      verified: new Set(verified.map((question) => question.id)).size,
      captureComplete:
        !!inventory?.confirmed && inventory.questions.length > 0 && captureUnresolved.length === 0,
      unresolved,
      complete: !!inventory?.confirmed && inventory.questions.length > 0 && unresolved.length === 0,
    },
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
