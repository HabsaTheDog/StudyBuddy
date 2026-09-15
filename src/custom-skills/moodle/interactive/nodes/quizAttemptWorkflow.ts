import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import type { CodexClient } from "../codexClient.js";
import type { AgentState, JsonObject, LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { enforceQuizSafetyPolicy } from "../quizSafetyPolicy.js";
import { redactSensitiveValues } from "../browserSecurity.js";
import {
  buildQuestionPacket, buildQuizReviewReport, clickSafeNextPage,
  extractQuizPage, fillVisibleQuestion, formatQuizRawText, generateAnswerSpec,
  persistQuizArtifacts, verifyQuestionAnswers,
  type AnswerSpec, type QuizPageExtraction, type QuizQuestion,
} from "./quizReviewNode.js";

export interface QuizAttemptDependencies {
  agentBrowser: AgentBrowserClient;
  codex: CodexClient;
  onStep?: (state: AgentState) => Promise<void>;
  // Narrow seams for deterministic navigation, persistence and concurrency tests.
  extract?: typeof extractQuizPage;
  next?: typeof clickSafeNextPage;
  solve?: typeof generateAnswerSpec;
  fill?: typeof fillVisibleQuestion;
}

interface CapturedQuestion {
  question: QuizQuestion;
  packet: Record<string, unknown>;
  directory: string;
  answer?: AnswerSpec;
  error?: string;
}
interface CapturedPage { page: QuizPageExtraction; questions: CapturedQuestion[] }

/** The browser is serial; independent model threads are not. No model waits during capture. */
export function createQuizAttemptWorkflowNode(config: MoodleRuntimeConfig, deps: QuizAttemptDependencies) {
  return async (state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> => {
    const data = state.extracted_data as JsonObject;
    const workflow = data.quiz_workflow as JsonObject | undefined;
    if (!workflow || workflow.done || !workflow.page) return {};
    const client = deps.agentBrowser;
    const extract = deps.extract ?? extractQuizPage;
    const next = deps.next ?? clickSafeNextPage;
    const solve = deps.solve ?? generateAnswerSpec;
    const fill = deps.fill ?? fillVisibleQuestion;
    const first = workflow.page as unknown as QuizPageExtraction;
    const pages: CapturedPage[] = [];
    const results: Array<Record<string, unknown>> = [];
    const issues: string[] = [];
    const startedAt = Date.now();
    let capturedAll = false;
    let endUrl: string | undefined;
    let completedSolvers = 0;
    let activeSolvers = 0;
    let peakSolvers = 0;
    let phase = "capture";
    let contextLost = false;
    const safeError = (error: unknown) => redactSensitiveValues(
      error instanceof Error ? error.message : String(error),
      [config.username, config.password, config.cisPassword],
    );
    const update = (): AgentState => ({ ...state,
      extracted_data: { ...data, quiz_workflow: JSON.parse(JSON.stringify({ ...workflow,
        phase, page_number: pages.length, captured_pages: pages.length,
        captured_questions: pages.reduce((sum, page) => sum + page.questions.length, 0),
        capture_complete: capturedAll, completed_solver_tasks: completedSolvers,
        answer_specs: pages.reduce((sum, page) => sum + page.questions.filter((item) => item.answer).length, 0),
        peak_parallel_solvers: peakSolvers, fill_results: results, issues,
      })) as JsonObject },
    });
    let progress = Promise.resolve();
    const checkpoint = () => {
      progress = progress.then(async () => { await deps.onStep?.(update()); });
      return progress;
    };
    const assertNotAborted = () => { config.abortSignal?.throwIfAborted(); };
    const assertSameAttempt = (url: string) => {
      const expected = new URL(first.url);
      const actual = new URL(url);
      if (actual.origin !== expected.origin || !/\/mod\/quiz\/(?:attempt|summary)\.php$/.test(actual.pathname)
        || !expected.searchParams.get("attempt")
        || actual.searchParams.get("attempt") !== expected.searchParams.get("attempt")) {
        throw new Error("quiz-attempt-context-changed");
      }
    };
    const suggestion = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "suggest_answers");
    const navigation = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "save_or_next_page");
    const canSolve = Boolean(config.autoAnswer) && suggestion.status === "allowed";
    let page = first;
    try {
      assertSameAttempt(first.url);
      assertSameAttempt(await client.getUrl());
      // A sequential exam must not be advanced with empty answers: going back may be forbidden.
      // Standard free-navigation Moodle quizzes expose actual attempt links in their nav block.
      const revisitable = await client.evalJson<boolean>(`JSON.stringify(Array.from(document.querySelectorAll('.qnbutton[href], #mod_quiz_navblock a[href]')).some(a => { try { const u = new URL(a.getAttribute('href'), location.href); return u.pathname.endsWith('/mod/quiz/attempt.php') && u.searchParams.get('attempt') === new URL(location.href).searchParams.get('attempt'); } catch { return false; } }))`);
      for (let index = 0; index < Math.max(1, config.maxPages); index++) {
        assertNotAborted();
        assertSameAttempt(page.url);
        assertSameAttempt(await client.getUrl());
        if (!page.questions.length) throw new Error("capture-page-has-no-questions");
        if (pages.some((entry) => entry.page.questions.some((q) => page.questions.some((other) => other.question_id === q.question_id)))) {
          throw new Error("capture-navigation-did-not-advance");
        }
        const captured: CapturedPage = { page, questions: [] };
        pages.push(captured);
        for (const question of page.questions) {
          assertNotAborted();
          const directory = path.join(config.runDir, "subagent-packets", `page-${String(index + 1).padStart(3, "0")}`, `question-${String(captured.questions.length + 1).padStart(3, "0")}`);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const packet: Record<string, unknown> = { ...buildQuestionPacket({ page, question, pageNumber: index + 1 }), output_language: config.outputLanguage };
          const item: CapturedQuestion = { question, packet, directory };
          captured.questions.push(item);
          try {
            if (client.captureQuestionEvidence) {
              const evidence = await client.captureQuestionEvidence(question.question_id, directory);
              packet.image_paths = [evidence.screenshotPath, ...evidence.images.filter((image) => /^image\/(png|jpeg|webp)$/.test(image.mimeType)).map((image) => image.path)].filter(Boolean);
              packet.media_evidence = evidence;
            } else if (client.captureQuestionImage) {
              const screenshot = path.join(directory, "question.png");
              await client.captureQuestionImage(question.question_id, screenshot);
              packet.image_paths = [screenshot];
              packet.media_evidence = { images: [], errors: ["original-download-unavailable-for-browser-backend"] };
            } else {
              packet.media_evidence = { images: [], errors: ["question-screenshot-unavailable-for-browser-backend"] };
            }
          } catch (error) { assertNotAborted(); packet.media_evidence = { images: [], errors: [safeError(error)] }; }
          await writeFile(path.join(directory, "packet.json"), JSON.stringify(packet, null, 2), { mode: 0o600 });
        }
        await checkpoint();
        if (navigation.status !== "allowed") { issues.push(navigation.reason); break; }
        if (!revisitable) { issues.push("non-revisitable-or-unknown-navigation: capture-first requires free question navigation"); break; }
        assertNotAborted();
        assertSameAttempt(await client.getUrl());
        const move = await next(client);
        if (!move.clicked) { issues.push("capture-no-safe-next-page"); break; }
        const actualUrl = await client.getUrl();
        assertSameAttempt(actualUrl);
        if (move.kind === "attempt_summary") {
          if (!new URL(actualUrl).pathname.endsWith("/summary.php")) throw new Error("capture-summary-navigation-not-confirmed");
          capturedAll = Number(new URL(first.url).searchParams.get("page") ?? 0) === 0;
          if (!capturedAll) issues.push("attempt-prefix-not-captured");
          endUrl = actualUrl;
          break;
        }
        if (index + 1 >= Math.max(1, config.maxPages)) { issues.push("capture-page-limit-reached"); break; }
        page = await extract(client);
      }
    } catch (error) {
      assertNotAborted();
      const message = safeError(error);
      contextLost = message.includes("quiz-attempt-context-changed");
      issues.push(message);
    }
    const captureMs = Date.now() - startedAt;
    const questions = pages.flatMap((entry) => entry.questions);
    phase = "solve";
    await checkpoint();
    const solveStarted = Date.now();
    // Every question is queued together, with bounded workers to respect provider capacity.
    if (canSolve && !contextLost) {
      await mapQuizConcurrent(questions, config.quizSolverConcurrency ?? 8, async (item) => {
        assertNotAborted();
        activeSolvers++;
        try {
          peakSolvers = Math.max(peakSolvers, activeSolvers);
          const answer = await solve(deps.codex, item.packet);
          if (answer.question_id && answer.question_id !== item.question.question_id) throw new Error("solver-question-id-mismatch");
          item.answer = { ...answer, question_id: item.question.question_id, question_index: item.question.question_index };
          await writeFile(path.join(item.directory, "answer-spec.json"), JSON.stringify(item.answer, null, 2), { mode: 0o600 });
        } catch (error) { assertNotAborted(); item.error = safeError(error); }
        finally { activeSolvers--; completedSolvers++; await checkpoint(); }
      });
    } else { issues.push(config.autoAnswer ? (suggestion.reason ?? "solver-unavailable") : "auto-answer-disabled"); }
    const solveMs = Date.now() - solveStarted;
    phase = "fill_and_verify";
    await checkpoint();
    const fillStarted = Date.now();
    // A partial capture is still useful. Independent answer failures never discard the other pages.
    for (const [index, captured] of pages.entries()) {
      assertNotAborted();
      if (contextLost) break;
      const pageResults: Array<{ item: CapturedQuestion; result: Record<string, unknown> }> = [];
      try {
        assertNotAborted();
        await client.open(captured.page.url);
        assertSameAttempt(await client.getUrl());
        const fresh = await extract(client);
        for (const item of captured.questions) {
          assertNotAborted();
          const current = fresh.questions.find((q) => q.question_id === item.question.question_id);
          let result: Record<string, unknown> = { filled: false, reason: item.error ?? "no-answer-spec" };
          if (current && item.answer && canSolve && !issues.some((issue) => issue.startsWith("non-revisitable"))) {
            try { result = await fill(client, current, item.answer, config.quizSafetyPolicy); }
            catch (error) { assertNotAborted(); result = { filled: false, reason: safeError(error) }; }
          } else if (!current) { result.reason = "question-missing-on-revisit"; }
          result = { ...result, question_id: item.question.question_id, question_index: item.question.question_index, page_number: index + 1, persisted: false };
          results.push(result);
          pageResults.push({ item, result });
        }
        const changed = pageResults.some(({ result }) => result.filled === true);
        // Never advance a sequential/unknown quiz after the capture guard failed.
        if (issues.some((issue) => issue.startsWith("non-revisitable"))) {
          if (changed) issues.push("answer-persistence-unverified: navigation unavailable");
        } else if (pageResults.some(({ result }) => result.filled === true || result.already_answered === true)) {
          if (changed) {
            assertNotAborted();
            assertSameAttempt(await client.getUrl());
            if (navigation.status !== "allowed") throw new Error("save-navigation-not-permitted");
            const saved = await next(client);
            if (!saved.clicked) throw new Error("save-navigation-failed");
            assertSameAttempt(await client.getUrl());
          }
          assertNotAborted();
          await client.open(captured.page.url);
          assertSameAttempt(await client.getUrl());
          const reloaded = await extract(client);
          for (const { item, result } of pageResults) {
            if (!item.answer || !(result.filled === true || result.already_answered === true)) continue;
            const current = reloaded.questions.find((q) => q.question_id === item.question.question_id);
            const check = current ? verifyQuestionAnswers(current, item.answer) : { verified: false, mismatches: ["question-missing-after-reload"] };
            result.persisted = check.verified;
            result.verified_after_reload = check.verified;
            if (!check.verified) { result.reason = "answer-not-persisted"; result.mismatches = check.mismatches; }
          }
        }
      } catch (error) {
        assertNotAborted();
        if (safeError(error).includes("quiz-attempt-context-changed")) contextLost = true;
        issues.push(`page-${index + 1}: ${safeError(error)}`);
        for (const item of captured.questions) {
          if (!pageResults.some((entry) => entry.item === item)) results.push({ question_id: item.question.question_id, page_number: index + 1, filled: false, persisted: false, reason: safeError(error) });
        }
      }
      await checkpoint();
    }
    if (endUrl && !contextLost && !config.abortSignal?.aborted) await client.open(endUrl).catch((error) => issues.push(safeError(error)));
    phase = "done";
    const verified = results.filter((result) => result.persisted === true).length;
    const stopReason = capturedAll && !contextLost && verified === questions.length && questions.length > 0
      ? "attempt-summary-reached" : "questions-unresolved";
    const finalState = update();
    const finalWorkflow = (finalState.extracted_data as JsonObject).quiz_workflow as JsonObject;
    finalWorkflow.done = true;
    finalWorkflow.stop_reason = stopReason;
    finalWorkflow.final_submit_clicked = false;
    finalWorkflow.metrics = { captured_pages: pages.length, captured_questions: questions.length, verified_answers: verified,
      newly_filled: results.filter((result) => result.filled === true && result.persisted === true).length,
      already_answered: results.filter((result) => result.already_answered === true && result.persisted === true).length,
      unresolved_questions: questions.length - verified, peak_parallel_solvers: peakSolvers,
      capture_ms: captureMs, solve_ms: solveMs, fill_verify_ms: Date.now() - fillStarted, duration_ms: Date.now() - startedAt };
    const report = buildQuizReviewReport({ page: { ...first, questions: questions.map((item) => item.question) },
      target: String(workflow.target_url), startResult: (workflow.start_result ?? {}) as Record<string, unknown>,
      risks: issues, fillResults: results,
    }) + `\n\nCapture complete: ${capturedAll}\nVerified answers after reload: ${verified}/${questions.length}\n`;
    await persistQuizArtifacts(config, { report, questions: questions.map((item) => item.question), candidates: [], targetUrl: String(workflow.target_url), finalSubmitClicked: false, fillResults: results, risks: issues });
    await writeFile(path.join(config.runDir, "quiz-metrics.json"), JSON.stringify(finalWorkflow.metrics, null, 2), { mode: 0o600 });
    return { ...finalState, final_document: report, moodle_raw_text: pages.map(({ page }) => formatQuizRawText(page)).join("\n\n"),
      source_coverage: { ...state.source_coverage, moodle: { status: capturedAll ? "success" : "failed",
        detail: `${pages.length} page(s), ${questions.length} question(s) captured; ${verified} answers verified after reload. Capture complete: ${capturedAll}.`,
        urls: pages.map(({ page }) => page.url), pages: pages.length } }, error_log: null };
  };
}

export async function mapQuizConcurrent<T>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const limit = Number.isFinite(concurrency) ? Math.max(1, Math.min(32, Math.floor(concurrency))) : 8;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; await work(items[index]!, index); }
  }));
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}
