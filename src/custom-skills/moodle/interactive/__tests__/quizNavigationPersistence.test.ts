import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import { extractQuizMetadata } from "../quizSafetyPolicy.js";
import {
  buildQuestionPacket, clickSafeNextPage, clickSafeStartOrContinue,
  extractQuizPage, fillVisibleQuestion, verifyQuestionAnswers,
} from "../nodes/quizReviewNode.js";
import type { MoodleRuntimeConfig } from "../types.js";

async function fixture(run: (client: ReturnType<typeof createPlaywrightBrowserClient>, origin: string, saved: { value: string; discard: boolean; submitted: number }) => Promise<void>) {
  const saved = { value: "", discard: false, submitted: 0 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/save") {
      let body = "";
      for await (const chunk of request) body += chunk;
      if (!saved.discard) saved.value = new URLSearchParams(body).get("answer") ?? "";
      response.writeHead(303, { location: "/summary" });
      response.end();
    } else if (url.pathname === "/submit") {
      saved.submitted++;
      response.end("Submitted");
    } else if (url.pathname === "/summary") {
      response.end('<a href="/submit">Submit all and finish</a>');
    } else if (url.pathname.endsWith("attempt.php")) {
      response.end(`<form method="post" action="/save"><div class="que shortanswer" id="question-1">
        <div class="qtext">Find the positive x: <mjx-container><mjx-math>RENDERED_DUPLICATE</mjx-math>
        <mjx-assistive-mml><math><semantics><annotation encoding="application/x-tex">x^2=4</annotation></semantics></math></mjx-assistive-mml>
        </mjx-container></div><input type="text" id="answer" name="answer" value="${saved.value}">
        </div><button type="submit">Finish attempt...</button></form>`);
    } else {
      response.end(`<button onclick="document.querySelector('dialog').showModal()">Test versuchen</button>
        <dialog>Zeitbegrenzung: 30 Minuten
          <button onclick="location.href='/mod/quiz/attempt.php?attempt=1'">Versuch beginnen</button>
          <button onclick="location.href='/submit'">Submit all and finish</button>
        </dialog>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createPlaywrightBrowserClient({ headless: true, baseUrl: origin } as MoodleRuntimeConfig);
  try { await run(client, origin, saved); }
  finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe("quiz navigation and persisted response evidence", () => {
  it("handles the real timed-start dialog and strips duplicate rendered MathJax from solver text", async () => {
    await fixture(async (client, origin, saved) => {
      await client.open(`${origin}/mod/quiz/view.php?id=1`);
      expect(await clickSafeStartOrContinue(client)).toMatchObject({ clicked: true, started: true });
      expect(await extractQuizMetadata(client)).toMatchObject({ hasActiveAttempt: true, availabilityStatus: "open" });
      const page = await extractQuizPage(client);
      const packet = buildQuestionPacket({ page, question: page.questions[0], pageNumber: 1 });
      expect(JSON.stringify(packet)).toContain("x^2=4");
      expect(JSON.stringify(packet)).not.toMatch(/RENDERED_DUPLICATE|mjx-container|prompt_html|raw_html/);
      expect(saved.submitted).toBe(0);
    });
  });

  it.each([false, true])("checks a fresh response after saving (server discards save: %s)", async discard => {
    await fixture(async (client, origin, saved) => {
      saved.discard = discard;
      const attemptUrl = `${origin}/mod/quiz/attempt.php?attempt=1`;
      await client.open(attemptUrl);
      const answer = { confidence: 0.99, citations: ["x^2=4"], control_answers: [{ control_id: "answer", answer: "2", selected: false }] };
      const page = await extractQuizPage(client);
      expect(await fillVisibleQuestion(client, page.questions[0], answer)).toMatchObject({ filled: true });
      expect(verifyQuestionAnswers((await extractQuizPage(client)).questions[0], answer).verified).toBe(true);
      expect(await clickSafeNextPage(client)).toMatchObject({ clicked: true, kind: "attempt_summary" });
      await client.open(attemptUrl);
      const reloaded = (await extractQuizPage(client)).questions[0];
      expect(verifyQuestionAnswers(reloaded, answer).verified).toBe(!discard);
      if (!discard) expect(await fillVisibleQuestion(client, reloaded, answer)).toMatchObject({ filled: false, already_answered: true });
      expect(saved.submitted).toBe(0);
    });
  });
});
