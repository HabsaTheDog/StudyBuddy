import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { DEFAULT_QUIZ_SAFETY_POLICY } from "../quizSafetyPolicy.js";
import { initialAgentState, type JsonObject, type LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { createQuizAttemptWorkflowNode, type QuizAttemptDependencies } from "../nodes/quizAttemptWorkflow.js";
import type { AnswerSpec, QuizPageExtraction, QuizPageNavigationResult, QuizQuestion } from "../nodes/quizReviewNode.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); directories.length = 0; });

async function scenario(count: number, options: {
  maxPages?: number; discardSave?: boolean; wrongAttemptAfterNext?: boolean; resumedPage?: number;
  abortSignal?: AbortSignal; solve?: (question: QuizQuestion) => Promise<AnswerSpec>;
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "sb-quiz-attempt-")); directories.push(directory);
  const events: string[] = [];
  const saved = new Map<number, string>();
  const drafts = new Map<number, string>();
  const urlFor = (index: number) => `https://moodle.example/mod/quiz/attempt.php?attempt=42&page=${index}`;
  let url = urlFor(options.resumedPage ?? 0);
  const currentIndex = () => Number(new URL(url).searchParams.get("page") ?? 0);
  const question = (index: number): QuizQuestion => ({
    question_id: `question-42-${index + 1}`, question_index: index + 1,
    question_type: "shortanswer", prompt: `Compute ${index + 1} + 1`, options: [],
    controls: [{ control_id: `answer-${index + 1}`, type: "text", value: drafts.get(index) ?? saved.get(index) ?? "" }],
    visible_context: `Question ${index + 1} of ${count}`,
  });
  const page = (index: number): QuizPageExtraction => ({ title: "Quiz", url: urlFor(index), body_text: `Page ${index + 1} of ${count}`, questions: [question(index)] });
  const answer = (item: QuizQuestion): AnswerSpec => ({
    question_id: item.question_id, confidence: 0.99, citations: ["Visible question"], risk_flags: [],
    control_answers: [{ control_id: `answer-${item.question_index}`, answer: String(item.question_index + 1), selected: false }],
  });
  const browser = {
    open: vi.fn(async (target: string) => { url = target; drafts.clear(); events.push(`open:${currentIndex()}`); return { stdout: "", stderr: "" }; }),
    getUrl: vi.fn(async () => url),
    evalJson: vi.fn(async () => true),
    captureQuestionEvidence: vi.fn(async (id: string) => { events.push(`capture:${id}`); return { images: [], errors: [] }; }),
  } as unknown as AgentBrowserClient;
  const deps: QuizAttemptDependencies = {
    agentBrowser: browser, codex: { run: async () => "{}" },
    extract: vi.fn(async () => page(currentIndex())),
    next: vi.fn(async (): Promise<QuizPageNavigationResult> => {
      events.push(`next:${currentIndex()}`);
      if (!options.discardSave) for (const [index, value] of drafts) saved.set(index, value);
      drafts.clear();
      if (options.wrongAttemptAfterNext) { url = urlFor(0).replace("attempt=42", "attempt=99"); return { clicked: true, kind: "next_page" }; }
      if (currentIndex() + 1 >= count) { url = "https://moodle.example/mod/quiz/summary.php?attempt=42"; return { clicked: true, kind: "attempt_summary" }; }
      url = urlFor(currentIndex() + 1); return { clicked: true, kind: "next_page" };
    }),
    solve: vi.fn(async (_codex, packet) => {
      const item = packet.question as unknown as QuizQuestion;
      events.push(`solve:${item.question_id}`);
      return options.solve ? options.solve(item) : answer(item);
    }),
    fill: vi.fn(async (_browser, item, result) => {
      events.push(`fill:${item.question_id}`);
      if ((result.confidence ?? 0) < 0.85) return { filled: false, reason: "confidence-below-threshold" };
      drafts.set(item.question_index - 1, result.control_answers![0]!.answer);
      return { filled: true, reason: "filled-control-plan" };
    }),
  };
  const config = {
    runDir: directory, prompt: "Solve this quiz", originalUserPrompt: "Solve this quiz", outputLanguage: "en",
    autoAnswer: true, maxPages: options.maxPages ?? count + 1, quizSolverConcurrency: 8,
    abortSignal: options.abortSignal,
    quizSafetyPolicy: { ...DEFAULT_QUIZ_SAFETY_POLICY, accessMode: "quiz-assist",
      allowSuggestingAnswers: true, allowFillingAnswers: true, allowSavingMovingNext: true,
      askBeforeFillingAnswers: false },
  } as MoodleRuntimeConfig;
  const state = { ...initialAgentState, extracted_data: { quiz_workflow: { kind: "quiz_workflow", done: false,
    page: page(options.resumedPage ?? 0), target_url: "https://moodle.example/mod/quiz/view.php?id=7" } } } as unknown as LangGraphAgentState;
  return { browser, deps, config, state, directory, events, saved, answer,
    run: () => createQuizAttemptWorkflowNode(config, deps)(state),
  };
}

function workflow(state: Partial<LangGraphAgentState>): JsonObject { return (state.extracted_data as JsonObject).quiz_workflow as JsonObject; }

describe("capture-first quiz attempt orchestration", () => {
  it("captures ten pages before any model call, runs eight independent solvers and verifies every saved answer", async () => {
    let active = 0;
    let peak = 0;
    const fixture = await scenario(10);
    fixture.deps.solve = vi.fn(async (_codex, packet) => {
      expect(fixture.events.filter((event) => event.startsWith("capture:"))).toHaveLength(10);
      expect(new URL(await fixture.browser.getUrl()).pathname).toMatch(/\/summary\.php$/);
      active++; peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return fixture.answer(packet.question as unknown as QuizQuestion);
    });
    const result = workflow(await fixture.run());
    expect(peak).toBe(8);
    expect(result).toMatchObject({ capture_complete: true, captured_pages: 10, captured_questions: 10,
      stop_reason: "attempt-summary-reached", final_submit_clicked: false,
      metrics: { verified_answers: 10, peak_parallel_solvers: 8 } });
    expect(fixture.saved.size).toBe(10);
    expect(await readFile(path.join(fixture.directory, "quiz-metrics.json"), "utf8")).toContain('"verified_answers": 10');
  });

  it("isolates low confidence and solver exceptions while filling all other pages", async () => {
    const fixture = await scenario(4);
    fixture.deps.solve = vi.fn(async (_codex, packet) => {
      const item = packet.question as unknown as QuizQuestion;
      if (item.question_index === 2) return { ...fixture.answer(item), confidence: 0.2 };
      if (item.question_index === 3) throw new Error("solver unavailable");
      return fixture.answer(item);
    });
    const result = workflow(await fixture.run());
    expect(result).toMatchObject({ captured_questions: 4, capture_complete: true, stop_reason: "questions-unresolved",
      metrics: { verified_answers: 2, unresolved_questions: 2 } });
    expect(fixture.saved).toEqual(new Map([[0, "2"], [3, "5"]]));
    expect(result.fill_results).toEqual(expect.arrayContaining([
      expect.objectContaining({ question_id: "question-42-2", persisted: false, reason: "confidence-below-threshold" }),
      expect.objectContaining({ question_id: "question-42-3", persisted: false, reason: "solver unavailable" }),
    ]));
  });

  it("does not call a successful next-page click persisted when the server discards the answer", async () => {
    const fixture = await scenario(2, { discardSave: true });
    const result = workflow(await fixture.run());
    expect(result).toMatchObject({ capture_complete: true, stop_reason: "questions-unresolved", metrics: { verified_answers: 0 } });
    expect(result.fill_results).toEqual([
      expect.objectContaining({ filled: true, persisted: false, verified_after_reload: false, reason: "answer-not-persisted" }),
      expect.objectContaining({ filled: true, persisted: false, verified_after_reload: false, reason: "answer-not-persisted" }),
    ]);
  });

  it("labels page-capped capture incomplete without inventing unseen question coverage", async () => {
    const fixture = await scenario(10, { maxPages: 2 });
    const result = workflow(await fixture.run());
    expect(result).toMatchObject({ captured_pages: 2, captured_questions: 2, capture_complete: false, stop_reason: "questions-unresolved" });
    expect(result.issues).toContain("capture-page-limit-reached");
    expect(fixture.browser.captureQuestionEvidence).toHaveBeenCalledTimes(2);
  });

  it("rejects a different attempt before any capture, model or fill operation", async () => {
    const fixture = await scenario(2);
    const first = ((fixture.state.extracted_data as JsonObject).quiz_workflow as JsonObject).page as JsonObject;
    first.url = "https://moodle.example/mod/quiz/view.php?id=7";
    const result = workflow(await fixture.run());
    expect(result.issues).toContain("quiz-attempt-context-changed");
    expect(fixture.browser.captureQuestionEvidence).not.toHaveBeenCalled();
    expect(fixture.deps.solve).not.toHaveBeenCalled();
    expect(fixture.deps.fill).not.toHaveBeenCalled();
  });

  it("halts writes when navigation unexpectedly changes the attempt identity", async () => {
    const fixture = await scenario(2, { wrongAttemptAfterNext: true });
    const result = workflow(await fixture.run());
    expect(result.issues).toContain("quiz-attempt-context-changed");
    expect(fixture.deps.fill).not.toHaveBeenCalled();
    expect(fixture.saved.size).toBe(0);
  });

  it("recognizes a real final summary even when the number of pages equals the configured cap", async () => {
    const fixture = await scenario(2, { maxPages: 2 });
    const result = workflow(await fixture.run());
    expect(result).toMatchObject({ capture_complete: true, captured_pages: 2, stop_reason: "attempt-summary-reached" });
  });

  it("does not claim a resumed attempt tail complete when admission did not normalize its first page", async () => {
    const fixture = await scenario(4, { resumedPage: 2 });
    const result = workflow(await fixture.run());
    expect(result).toMatchObject({ capture_complete: false, captured_pages: 2, captured_questions: 2, stop_reason: "questions-unresolved", metrics: { verified_answers: 2 } });
    expect(result.issues).toContain("attempt-prefix-not-captured");
  });

  it("does not queue model calls or browser writes after an already aborted request", async () => {
    const controller = new AbortController(); controller.abort(new Error("quiz-run-cancelled"));
    const fixture = await scenario(3, { abortSignal: controller.signal });
    await fixture.run().catch((error) => { expect(error.message).toBe("quiz-run-cancelled"); });
    expect(fixture.deps.solve).not.toHaveBeenCalled();
    expect(fixture.deps.fill).not.toHaveBeenCalled();
    expect(fixture.browser.open).not.toHaveBeenCalled();
    expect(fixture.deps.next).not.toHaveBeenCalled();
  });

  it("does not save or navigate when cancellation arrives during a fill operation", async () => {
    const controller = new AbortController();
    const fixture = await scenario(3, { abortSignal: controller.signal });
    const fill = fixture.deps.fill!;
    fixture.deps.fill = vi.fn(async (browser, question, answer, policy) => {
      const result = await fill(browser, question, answer, policy);
      controller.abort(new Error("quiz-run-cancelled"));
      return result;
    });
    await expect(fixture.run()).rejects.toThrow("quiz-run-cancelled");
    expect(fixture.deps.fill).toHaveBeenCalledTimes(1);
    expect(fixture.saved.size).toBe(0);
    // Three capture transitions happened before cancellation, no save transition afterward.
    expect(fixture.deps.next).toHaveBeenCalledTimes(3);
  });
});
