import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import { createQuizAttemptWorkflowNode, inspectQuizNavigation } from "../nodes/quizAttemptWorkflow.js";
import { extractQuizPage } from "../nodes/quizReviewNode.js";
import { initialAgentState, type JsonObject } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { DEFAULT_QUIZ_SAFETY_POLICY } from "../quizSafetyPolicy.js";

describe("same-page Moodle question navigation without hrefs", () => {
  it("distinguishes a complete page from disabled later pages, missing buttons and foreign attempt links", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "sb-quiz-navigation-"));
    const server = createServer((request, response) => {
      const mode = new URL(request.url!, "http://fixture").searchParams.get("mode");
      response.setHeader("content-type", "text/html");
      const current = '<a class="qnbutton" data-quiz-page="0">1</a><a class="qnbutton" data-quiz-page="0">2</a>';
      const variants: Record<string, string> = {
        single: current,
        sequential: `${current}<span class="qnbutton" data-quiz-page="1">3</span>`,
        currentLink: '<a class="qnbutton" href="/mod/quiz/attempt.php?attempt=1&page=0">1</a><span class="qnbutton" data-quiz-page="1">2</span>',
        missing: '<a class="qnbutton" data-quiz-page="0">1</a>',
        free: '<a class="qnbutton" href="/mod/quiz/attempt.php?attempt=1&page=1">3</a>',
        foreign: '<a class="qnbutton" href="https://untrusted.example/mod/quiz/attempt.php?attempt=1&page=1">3</a>',
        wrongAttempt: '<a class="qnbutton" href="/mod/quiz/attempt.php?attempt=99&page=1">3</a>',
        unknown: '<a class="qnbutton">1</a><a class="qnbutton">2</a>',
      };
      response.end(variants[mode!] ?? "");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = createPlaywrightBrowserClient({ runDir, baseUrl, headless: true } as MoodleRuntimeConfig);
    try {
      for (const [mode, expected] of Object.entries({ single: "single-page", sequential: "unknown", currentLink: "unknown", missing: "unknown", free: "free", foreign: "unknown", wrongAttempt: "unknown", unknown: "unknown" })) {
        await client.open(`${baseUrl}/mod/quiz/attempt.php?attempt=1&mode=${mode}`);
        expect(await inspectQuizNavigation(client, 2), mode).toBe(expected);
      }
    } finally {
      await client.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it.each([{ discard: false, prefilled: false }, { discard: true, prefilled: false }, { discard: false, prefilled: true }])("saves all four answers before leaving the page: %j", async ({ discard, prefilled }) => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "sb-quiz-single-page-"));
    const saved = new Map<number, string>();
    if (prefilled) for (let i = 1; i <= 4; i++) saved.set(i, String(i + 1));
    let saves = 0;
    let finalSubmissions = 0;
    let active = 0;
    let peak = 0;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://fixture");
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (url.pathname === "/save") {
        saves++;
        let body = "";
        for await (const chunk of request) body += chunk;
        const form = new URLSearchParams(body);
        if (!discard) for (let i = 1; i <= 4; i++) saved.set(i, form.get(`answer${i}`) ?? "");
        response.writeHead(303, { location: "/mod/quiz/summary.php?attempt=1" });
        response.end();
      } else if (url.pathname === "/submit") { finalSubmissions++; response.end("Submitted"); }
      else if (url.pathname.endsWith("/summary.php")) response.end('<a href="/submit">Submit all and finish</a>');
      else response.end(`<div id="mod_quiz_navblock"><div class="qn_buttons">${Array.from({ length: 4 }, (_, n) => `<a class="qnbutton thispage" id="quiznavbutton${n + 1}" data-quiz-page="0">Question ${n + 1} This page</a>`).join("")}</div></div>
        <form id="responseform" method="post" action="/save"><input type="hidden" name="slots" value="1,2,3,4"><input type="hidden" name="nextpage" value="-1">
        ${Array.from({ length: 4 }, (_, n) => `<div class="que shortanswer" id="question-1-${n + 1}"><div class="qtext">What is ${n + 1} + 1?</div><input type="text" name="answer${n + 1}" id="answer-${n + 1}" value="${saved.get(n + 1) ?? ""}"></div>`).join("")}
        <button type="submit">Finish attempt...</button></form>`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = { runDir, baseUrl, headless: true, prompt: "Solve this self-check", originalUserPrompt: "Solve this self-check", outputLanguage: "en", maxPages: 10, autoAnswer: true, quizSolverConcurrency: 8,
      quizSafetyPolicy: { ...DEFAULT_QUIZ_SAFETY_POLICY, allowSuggestingAnswers: true, allowFillingAnswers: true, allowSavingMovingNext: true, askBeforeFillingAnswers: false },
    } as MoodleRuntimeConfig;
    const client = createPlaywrightBrowserClient(config);
    try {
      await client.open(`${baseUrl}/mod/quiz/attempt.php?attempt=1`);
      const page = await extractQuizPage(client);
      const node = createQuizAttemptWorkflowNode(config, { agentBrowser: client, codex: { run: async () => "{}" }, solve: async (_codex, packet) => {
        // A single-page attempt must not be saved empty just to prove navigation.
        expect(saves).toBe(0);
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 30));
        active--;
        const question = packet.question as { question_id: string };
        const n = Number(question.question_id.split("-").at(-1));
        return { confidence: 0.99, citations: ["Visible arithmetic"], control_answers: [{ control_id: `answer-${n}`, answer: String(n + 1), selected: false }] };
      } });
      const result = await node({ ...initialAgentState, extracted_data: { quiz_workflow: JSON.parse(JSON.stringify({ target_url: `${baseUrl}/mod/quiz/view.php?id=1`, done: false, page })) } });
      const workflow = (result.extracted_data as JsonObject).quiz_workflow as JsonObject;
      expect(workflow.metrics).toMatchObject({ captured_questions: 4, verified_answers: discard ? 0 : 4, unresolved_questions: discard ? 4 : 0 });
      expect(workflow.capture_complete).toBe(true);
      expect(workflow.stop_reason).toBe(discard ? "questions-unresolved" : "attempt-summary-reached");
      expect(new URL(await client.getUrl()).pathname).toBe("/mod/quiz/summary.php");
      expect(peak).toBe(4);
      expect(saves).toBe(1);
      expect(finalSubmissions).toBe(0);
      if (discard) expect(workflow.fill_results).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ filled: true, persisted: false, reason: "answer-not-persisted" })));
      else expect([...saved.values()]).toEqual(["2", "3", "4", "5"]);
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});
