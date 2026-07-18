// @effect-diagnostics globalTimers:off
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserLoginConfig } from "../browserAuth.js";
import {
  clickSafeNextPage,
  extractQuizPage,
  fillVisibleQuestion,
} from "../nodes/quizReviewNode.js";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import type { MoodleRuntimeConfig, QuizSafetyPolicy } from "../types.js";

const USERNAME = "broker-test-user";
const PASSWORD = "broker-test-password-canary";

let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

describe("Playwright credential broker", () => {
  it("parses JSON strings returned by Moodle DOM extraction scripts", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end("<title>Self-check</title><main>Question page</main>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = createPlaywrightBrowserClient(runtimeConfig(origin));

    await client.open(`${origin}/quiz`);
    const result = await client.evalJson<{ title: string; questions: unknown[] }>(
      `JSON.stringify({ title: document.title, questions: [] })`,
    );

    expect(result).toEqual({ title: "Self-check", questions: [] });
    await client.close();
  });

  it("fills a Moodle choice when the answer string is prefixed with its control id", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(
        '<div id="question-1"><label><input type="checkbox" id="q1:1_choice0" checked>Correct</label>' +
          '<label><input type="checkbox" id="q1:1_choice1">Incorrect</label></div>' +
          '<input type="submit" value="Nächste Seite">',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = createPlaywrightBrowserClient(runtimeConfig(origin));
    await client.open(`${origin}/quiz`);

    const result = await fillVisibleQuestion(
      client,
      {
        question_id: "question-1",
        question_index: 1,
        question_type: "multichoice",
        prompt: "Pick one",
        options: ["Correct", "Incorrect"],
        controls: [],
        visible_context: "Pick one Correct Incorrect",
      },
      {
        answer: "q1:1_choice1",
        answers: ["Correct"],
        confidence: 0.99,
        citations: ["Visible option"],
        risk_flags: [],
      },
      allowFillPolicy(),
    );

    expect(result).toMatchObject({ filled: true, reason: "filled-choice" });
    await expect(
      client.evalJson<{ first: boolean; second: boolean }>(
        `JSON.stringify({ first: document.getElementById("q1:1_choice0").checked, second: document.getElementById("q1:1_choice1").checked })`,
      ),
    ).resolves.toEqual({ first: false, second: true });
    expect(Object.values((await client.snapshot({ interactive: true })).refs)).toContainEqual({
      role: "button",
      name: "Nächste Seite",
    });
    await client.close();
  });

  it("extracts and fills every dropdown in a multi-control Moodle Cloze question", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`
        <div class="que multianswer" id="question-2">
          <div class="qtext">Eine Spannungsquelle hat u(t) = û · sin(ωt + φu).</div>
          <p>û ist
            <select id="q2-sub0" name="q2-sub0">
              <option value="">Bitte wählen</option>
              <option value="peak">die Spitzenamplitude oder Scheitelwert</option>
              <option value="rms">der Effektivwert</option>
            </select>
            und die Einheit ist
            <select id="q2-sub1" name="q2-sub1">
              <option value="">Bitte wählen</option>
              <option value="volt">V</option>
              <option value="ampere">A</option>
            </select>
          </p>
          <p>ω ist
            <select id="q2-sub2" name="q2-sub2">
              <option value="">Bitte wählen</option>
              <option value="angular">die Kreisfrequenz</option>
              <option value="phase">der Phasenwinkel</option>
            </select>
          </p>
        </div>
      `);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = createPlaywrightBrowserClient(runtimeConfig(origin));
    await client.open(`${origin}/quiz`);

    const page = await extractQuizPage(client);
    expect(page.questions[0]?.controls).toMatchObject([
      {
        control_id: "q2-sub0",
        options: [
          { value: "", text: "Bitte wählen" },
          { value: "peak", text: "die Spitzenamplitude oder Scheitelwert" },
          { value: "rms", text: "der Effektivwert" },
        ],
      },
      { control_id: "q2-sub1" },
      { control_id: "q2-sub2" },
    ]);

    const result = await fillVisibleQuestion(
      client,
      page.questions[0]!,
      {
        confidence: 0.99,
        citations: ["Visible formula and dropdown options"],
        risk_flags: [],
        control_answers: [
          {
            control_id: "q2-sub0",
            answer: "die Spitzenamplitude oder Scheitelwert",
            selected: false,
          },
          { control_id: "q2-sub1", answer: "V", selected: false },
          { control_id: "q2-sub2", answer: "die Kreisfrequenz", selected: false },
        ],
      },
      allowFillPolicy(),
    );

    expect(result).toMatchObject({
      filled: true,
      reason: "filled-control-plan",
      control: { count: 3, types: { select: 3 } },
    });
    await expect(
      client.evalJson<string[]>(
        `JSON.stringify(["q2-sub0", "q2-sub1", "q2-sub2"].map(id => document.getElementById(id).value))`,
      ),
    ).resolves.toEqual(["peak", "volt", "angular"]);
    await client.close();
  });

  it("fills all correct options in a multiple-response question from an explicit control plan", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`
        <div class="que multichoice" id="question-3">
          <div class="qtext">Welche Gleichspannung erzeugt dieselbe Wärmewirkung?</div>
          <label><input type="checkbox" id="q3-choice0">û V</label>
          <label><input type="checkbox" id="q3-choice1">û/√2 V</label>
          <label><input type="checkbox" id="q3-choice2">gleich dem Effektivwert</label>
          <label><input type="checkbox" id="q3-choice3">û/2 V</label>
        </div>
      `);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = createPlaywrightBrowserClient(runtimeConfig(origin));
    await client.open(`${origin}/quiz`);
    const page = await extractQuizPage(client);

    const result = await fillVisibleQuestion(
      client,
      page.questions[0]!,
      {
        confidence: 0.99,
        citations: ["Visible RMS relation"],
        risk_flags: [],
        control_answers: [
          { control_id: "q3-choice0", answer: "û V", selected: false },
          { control_id: "q3-choice1", answer: "û/√2 V", selected: true },
          { control_id: "q3-choice2", answer: "gleich dem Effektivwert", selected: true },
          { control_id: "q3-choice3", answer: "û/2 V", selected: false },
        ],
      },
      allowFillPolicy(),
    );

    expect(result).toMatchObject({
      filled: true,
      reason: "filled-control-plan",
      control: { count: 4, types: { choice: 4 } },
    });
    await expect(
      client.evalJson<boolean[]>(
        `JSON.stringify([0, 1, 2, 3].map(index => document.getElementById("q3-choice" + index).checked))`,
      ),
    ).resolves.toEqual([false, true, true, false]);
    await client.close();
  });

  it("persists the last page through Moodle's attempt-summary action without final submission", async () => {
    let resolvePostedBody!: (value: URLSearchParams) => void;
    const postedBody = new Promise<URLSearchParams>((resolve) => {
      resolvePostedBody = resolve;
    });
    const server = createServer((request, response) => {
      if (request.method === "POST") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          resolvePostedBody(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
          response.statusCode = 302;
          response.setHeader("location", "/mod/quiz/summary.php?attempt=1");
          response.end();
        });
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url?.startsWith("/mod/quiz/summary.php")) {
        response.end("<title>Zusammenfassung</title><main>Versuchsübersicht</main>");
        return;
      }
      response.end(`
        <form method="post" action="/mod/quiz/processattempt.php">
          <div class="que multichoice" id="question-13">
            <div class="qtext">Was ist die Impedanz eines Kondensators C?</div>
            <label><input type="checkbox" id="q13-choice0" name="q13:answer" value="0">1/(jωC)</label>
            <label><input type="checkbox" id="q13-choice1" name="q13:answer" value="1">jωC</label>
            <label><input type="checkbox" id="q13-choice2" name="q13:answer" value="2">C</label>
            <label><input type="checkbox" id="q13-choice3" name="q13:answer" value="3">-j/(ωC)</label>
            <label><input type="checkbox" id="q13-choice4" name="q13:answer" value="4">ω</label>
          </div>
          <input type="hidden" name="attempt" value="1">
          <input type="submit" name="next" value="Versuch abschließen ...">
          <input type="submit" name="finishattempt" value="Alles abgeben und beenden">
        </form>
      `);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = createPlaywrightBrowserClient(runtimeConfig(origin));
    await client.open(`${origin}/mod/quiz/attempt.php?attempt=1&page=12`);
    const page = await extractQuizPage(client);

    await fillVisibleQuestion(
      client,
      page.questions[0]!,
      {
        confidence: 0.99,
        citations: ["Visible capacitor impedance options"],
        risk_flags: [],
        control_answers: [
          { control_id: "q13-choice0", answer: "1/(jωC)", selected: true },
          { control_id: "q13-choice1", answer: "jωC", selected: false },
          { control_id: "q13-choice2", answer: "C", selected: false },
          { control_id: "q13-choice3", answer: "-j/(ωC)", selected: true },
          { control_id: "q13-choice4", answer: "ω", selected: false },
        ],
      },
      allowFillPolicy(),
    );
    await expect(clickSafeNextPage(client)).resolves.toMatchObject({
      clicked: true,
      kind: "attempt_summary",
    });

    const body = await postedBody;
    expect(body.getAll("q13:answer")).toEqual(["0", "3"]);
    expect(body.get("next")).toBe("Versuch abschließen ...");
    expect(body.has("finishattempt")).toBe(false);
    await expect(client.getUrl()).resolves.toContain("/mod/quiz/summary.php");
    await client.close();
  });

  it("leaves a multi-control question untouched when the control plan is incomplete", async () => {
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`
        <div class="que multianswer" id="question-4">
          <select id="q4-sub0"><option value="">Bitte wählen</option><option value="a">A</option></select>
          <select id="q4-sub1"><option value="">Bitte wählen</option><option value="b">B</option></select>
        </div>
      `);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = createPlaywrightBrowserClient(runtimeConfig(origin));
    await client.open(`${origin}/quiz`);
    const page = await extractQuizPage(client);

    const result = await fillVisibleQuestion(
      client,
      page.questions[0]!,
      {
        confidence: 0.99,
        citations: ["Visible options"],
        risk_flags: [],
        control_answers: [{ control_id: "q4-sub0", answer: "A", selected: false }],
      },
      allowFillPolicy(),
    );

    expect(result).toMatchObject({ filled: false, reason: "control-plan-incomplete" });
    await expect(
      client.evalJson<string[]>(
        `JSON.stringify(["q4-sub0", "q4-sub1"].map(id => document.getElementById(id).value))`,
      ),
    ).resolves.toEqual(["", ""]);
    await client.close();
  });

  it("locks extraction during login and redacts credential echoes from later snapshots", async () => {
    let submitted!: () => void;
    const submittedPromise = new Promise<void>((resolve) => {
      submitted = resolve;
    });
    let pendingResponse: ServerResponse | undefined;

    const server = createServer((request, response) => {
      if (request.method === "POST" && request.url === "/login") {
        pendingResponse = response;
        request.once("end", submitted);
        request.resume();
        return;
      }
      if (request.url === "/home" && request.headers.cookie === "session=ok") {
        response.setHeader("content-type", "text/html");
        response.end(
          `<main><a href="/course">Course</a><p>hostile echo ${PASSWORD}</p>` +
            `<input type="password" value="${PASSWORD}" aria-label="Visible secret" /></main>`,
        );
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(
        '<form action="/login" method="post"><label>User<input name="username" /></label>' +
          '<label>Password<input name="password" type="password" /></label>' +
          '<button type="submit">Log in</button></form>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeServer = async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const client = createPlaywrightBrowserClient(runtimeConfig(origin));
    const loginPromise = client.secureLogin?.(
      createBrowserLoginConfig({
        serviceName: "Test University",
        targetUrl: `${origin}/home`,
        username: USERNAME,
        password: PASSWORD,
      }),
    );
    await submittedPromise;
    await expect(client.snapshot()).rejects.toThrow("authentication is locked");

    pendingResponse?.writeHead(302, { location: "/home", "set-cookie": "session=ok" });
    pendingResponse?.end();
    await loginPromise;

    const snapshot = await client.snapshot({ interactive: false, urls: true });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain("Course");
    expect(Object.values(snapshot.refs)).toContainEqual(
      expect.objectContaining({ role: "link", href: `${origin}/course` }),
    );
    expect(snapshot.snapshot).toContain(`url=${origin}/course`);
    expect(serialized).toContain("credential-field");
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("••");
    expect(client.authenticationState).toBe("authenticated");
    await client.close();
  });
});

function runtimeConfig(origin: string): MoodleRuntimeConfig {
  return {
    prompt: "test",
    originalUserPrompt: "test",
    outputLanguage: "en",
    outputLanguageReason: "prompt_language",
    moodleUrl: `${origin}/home`,
    outputPath: "/tmp/document.typ",
    runDir: "/tmp",
    maxDepth: 0,
    maxPages: 1,
    maxCisPages: 1,
    allowFileDownloads: false,
    baseUrl: origin,
    dashboardUrl: `${origin}/home`,
    username: USERNAME,
    password: PASSWORD,
    cisUrls: [],
    cisBaseUrl: origin,
    cisDashboardUrl: origin,
    headless: true,
    browserBackend: "playwright",
    browserAllowedDomains: ["127.0.0.1"],
  };
}

function allowFillPolicy(): QuizSafetyPolicy {
  return {
    accessMode: "quiz-assist",
    allowOpeningQuizPages: true,
    allowStartingOrContinuingAttempts: true,
    minimumTimeLimitMinutes: 0,
    minimumAttemptsLeft: 0,
    allowReadingQuestions: true,
    allowSuggestingAnswers: true,
    allowFillingAnswers: true,
    allowChangingExistingAnswers: true,
    allowSavingMovingNext: true,
    askBeforeStartingOrContinuingAttempts: false,
    askBeforeTimedQuizzes: false,
    askBeforeLimitedAttemptQuizzes: false,
    askBeforeFillingAnswers: false,
    askBeforeChangingExistingAnswers: false,
    fillConfidenceThreshold: 0.85,
    finalSubmissionBlocked: true,
  };
}
