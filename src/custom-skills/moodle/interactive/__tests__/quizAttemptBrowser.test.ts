import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import { createQuizAttemptWorkflowNode } from "../nodes/quizAttemptWorkflow.js";
import { extractQuizPage } from "../nodes/quizReviewNode.js";
import { initialAgentState, type JsonObject } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { DEFAULT_QUIZ_SAFETY_POLICY } from "../quizSafetyPolicy.js";

describe("capture → parallel solve → verified fill in a real browser", () => {
  it("captures all ten pages before model work, isolates an uncertain question and detects a discarded server save", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "sb-quiz-attempt-browser-"));
    const saved = new Map<number, string>();
    const visited = new Set<number>();
    let submissions = 0;
    let active = 0;
    let peak = 0;
    const chunk = (type: string, data: Buffer) => {
      const payload = Buffer.concat([Buffer.from(type), data]);
      const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
      return Buffer.concat([length, payload, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1600); header.writeUInt32BE(1000, 4); header[8] = 8; header[9] = 2;
    const originalImage = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.alloc((1600 * 3 + 1) * 1000))), chunk("IEND", Buffer.alloc(0))]);
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://fixture");
      if (url.pathname === "/original.png") {
        if (!request.headers.cookie?.includes("quiz=evidence")) { response.writeHead(401); response.end(); return; }
        response.writeHead(200, { "content-type": "image/png" }); response.end(originalImage); return;
      }
      response.setHeader("set-cookie", "quiz=evidence; Path=/; HttpOnly; SameSite=Lax");
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (url.pathname.endsWith("/save")) {
        let body = "";
        for await (const chunk of request) body += chunk;
        const form = new URLSearchParams(body);
        const index = Number(form.get("page"));
        if (index !== 6) saved.set(index, form.get("answer") ?? "");
        response.writeHead(303, { location: index < 9 ? `/mod/quiz/attempt.php?attempt=1&page=${index + 1}` : "/mod/quiz/summary.php?attempt=1" });
        response.end();
      } else if (url.pathname.endsWith("/summary.php")) {
        response.end('<a href="/submit">Submit all and finish</a>');
      } else if (url.pathname === "/submit") { submissions++; response.end("Submitted"); }
      else {
        const index = Number(url.searchParams.get("page") ?? 0);
        visited.add(index);
        response.end(`<div class="qn_buttons">${Array.from({ length: 10 }, (_, i) => `<a class="qnbutton" href="/mod/quiz/attempt.php?attempt=1&page=${i}">${i + 1}</a>`).join("")}</div>
          <form method="post" action="/mod/quiz/save"><input type="hidden" name="page" value="${index}">
          <div class="que shortanswer" id="question-${index + 1}"><div class="qtext">What is ${index + 1} + 1?</div>
          ${index === 0 ? '<img width="160" src="/original.png">' : ""}
          <input type="text" name="answer" id="answer-${index + 1}" value="${saved.get(index) ?? ""}"></div>
          <button type="submit">${index < 9 ? "Next page" : "Finish attempt..."}</button></form>`);
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = { runDir, baseUrl, headless: true, prompt: "Bearbeite den Quiz", originalUserPrompt: "Bearbeite den Quiz", outputLanguage: "de", maxPages: 10, autoAnswer: true, quizSolverConcurrency: 8,
      quizSafetyPolicy: { ...DEFAULT_QUIZ_SAFETY_POLICY, allowSuggestingAnswers: true, allowFillingAnswers: true, allowSavingMovingNext: true, allowChangingExistingAnswers: true, askBeforeFillingAnswers: false, askBeforeChangingExistingAnswers: false },
    } as MoodleRuntimeConfig;
    const client = createPlaywrightBrowserClient(config);
    try {
      await client.open(`${baseUrl}/mod/quiz/attempt.php?attempt=1&page=0`);
      const page = await extractQuizPage(client);
      const node = createQuizAttemptWorkflowNode(config, { agentBrowser: client, codex: { run: async () => "{}" }, solve: async (_codex, packet) => {
        expect(visited.size).toBe(10);
        expect(await readdir(path.join(runDir, "subagent-packets"))).toHaveLength(10);
        active++;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 30));
        active--;
        const q = packet.question as { question_id: string };
        const number = Number(q.question_id.replace("question-", ""));
        expect((packet.image_paths as string[])[0]).toContain("question.png");
        if (number === 1) {
          expect(packet.image_paths, JSON.stringify(packet.media_evidence)).toHaveLength(2);
          expect(await readFile((packet.image_paths as string[])[1]!)).toEqual(originalImage);
        }
        return { confidence: number === 2 ? 0 : 0.99, citations: ["visible arithmetic"], control_answers: [{ control_id: `answer-${number}`, answer: String(number + 1), selected: false }] };
      } });
      const result = await node({ ...initialAgentState, extracted_data: { quiz_workflow: JSON.parse(JSON.stringify({ target_url: `${baseUrl}/mod/quiz/view.php?id=1`, done: false, page, fill_results: [] })) } });
      const workflow = (result.extracted_data as JsonObject).quiz_workflow as JsonObject;
      expect(workflow).toMatchObject({ done: true, capture_complete: true, captured_questions: 10, stop_reason: "questions-unresolved", final_submit_clicked: false });
      expect(peak).toBe(8);
      const firstResult = (workflow.fill_results as JsonObject[]).find(item => item.question_id === "question-1");
      expect(firstResult, JSON.stringify(firstResult)).toMatchObject({ persisted: true });
      expect(workflow.metrics).toMatchObject({ verified_answers: 8, unresolved_questions: 2, captured_pages: 10 });
      expect(saved.get(1)).toBe("");
      expect(saved.get(9)).toBe("11");
      expect(submissions).toBe(0);
      const results = workflow.fill_results as JsonObject[];
      expect(results.find(item => item.question_id === "question-7")).toMatchObject({ filled: true, persisted: false, reason: "answer-not-persisted" });
      expect(JSON.parse(await readFile(path.join(runDir, "quiz-metrics.json"), "utf8"))).toMatchObject({ verified_answers: 8, peak_parallel_solvers: 8 });
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(runDir, { recursive: true, force: true });
    }
  }, 30_000);
});
