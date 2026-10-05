import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { executeDirectQuiz } from "../directQuiz.js";
import { canonicalDirectQuizPage } from "../directQuizCapture.js";
import { extractQuizPage, fillVisibleQuestion, verifyQuestionAnswers } from "../interactive/nodes/quizReviewNode.js";
import type { AgentBrowserClient } from "../interactive/agentBrowserClient.js";

async function multiPageFixture(
  run: (
    env: NodeJS.ProcessEnv,
    control: {
      discard: boolean;
      skipLast: boolean;
      mediaVersion: number;
      addAfterSave: boolean;
      inline: boolean;
      cloze: boolean;
      sharedPrice: number;
      navigationOpen: boolean;
      invalidNavigation: boolean;
      idlessCard: boolean;
      hideHistory: boolean;
      starts: number;
      saves: number;
      finals: number;
      values: Map<string, string>;
    },
  ) => Promise<void>,
  descriptionPage = false,
) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "direct-quiz-multipage-"));
  const control = {
    discard: false,
    skipLast: false,
    mediaVersion: 1,
    addAfterSave: false,
    inline: false,
    cloze: false,
    sharedPrice: 7,
    navigationOpen: false,
    invalidNavigation: false,
    idlessCard: false,
    hideHistory: false,
    starts: 0,
    saves: 0,
    finals: 0,
    values: new Map<string, string>(),
  };
  const groups = descriptionPage ? [[], [1, 2], [3, 4], [5]] : [[1, 2], [3, 4], [5]];
  const lastPage = groups.length - 1;
  const input = (slot: number) =>
    `<input id="answer-${slot}" name="answer${slot}" type="text" value="${control.values.get(`answer${slot}`) ?? ""}">`;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture");
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/original.svg") {
      response.setHeader("content-type", "image/svg+xml");
      response.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><text x="30" y="50">original ${control.mediaVersion}</text></svg>`,
      );
    } else if (url.pathname.endsWith("/startattempt.php")) {
      control.starts++;
      response.writeHead(303, { location: "/mod/quiz/attempt.php?attempt=123&page=0" });
      response.end();
    } else if (url.pathname.endsWith("/view.php")) {
      response.end(
        `<title>Five original questions</title><p>Attempts allowed: 2</p>${control.starts ? (control.hideHistory ? "<button>Continue attempt</button>" : control.idlessCard ? '<div class="card"><h3>Attempt 1</h3><dl><dt>Status</dt><dd>In progress</dd></dl></div><form method="post" action="/mod/quiz/startattempt.php"><input name="cmid" type="hidden" value="7"><button>Continue attempt</button></form>' : '<table><tr><th>Attempt</th></tr><tr><td>1</td><td><a href="/mod/quiz/attempt.php?attempt=123&page=0">Continue attempt</a></td></tr></table>') : '<p>No attempts yet</p><form method="post" action="/mod/quiz/startattempt.php"><input name="cmid" type="hidden" value="7"><button>Attempt quiz</button></form>'}`,
      );
    } else if (url.pathname.endsWith("/processattempt.php")) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const form = new URLSearchParams(body);
      control.saves++;
      if (form.get("finishattempt") === "1") control.finals++;
      if (!control.discard)
        for (const [key, value] of form)
          if (key.startsWith("answer")) control.values.set(key, value);
      const next = Number(form.get("nextpage"));
      response.writeHead(303, {
        location:
          next < 0 || (control.skipLast && next === 2)
            ? "/mod/quiz/summary.php?attempt=123"
            : `/mod/quiz/attempt.php?attempt=123&page=${next}`,
      });
      response.end();
    } else if (url.pathname.endsWith("/attempt.php")) {
      const number = Number(url.searchParams.get("page") ?? 0);
      const questions = [...(groups[number] ?? [])];
      if (control.addAfterSave && control.saves > 0 && number === 0) questions.push(6);
      response.end(
        `<title>Five original questions</title>${control.navigationOpen ? '<div id="theme_boost-drawers-courseindex"><div class="courseindex">Course navigation list</div></div><aside class="drawer">Other courses</aside><aside data-region="drawer">Activities</aside><nav role="navigation">Course topics</nav><div role="navigation">Breadcrumb navigation</div>' : ""}<p>Shared stem: price ${control.sharedPrice}; add each number to itself.</p><div id="mod_quiz_navblock">${descriptionPage ? '<a class="qnbutton" id="quiznavbutton99" data-quiz-page="0" href="/mod/quiz/attempt.php?attempt=123&amp;page=0"><span class="accesshide">Information </span>i</a>' : ""}${control.invalidNavigation ? '<a class="qnbutton" data-quiz-page="0">Unknown</a>' : ""}${groups.flatMap((group, page) => group.map((slot) => `<a class="qnbutton" id="quiznavbutton${slot}" data-quiz-page="${page}" href="/mod/quiz/attempt.php?attempt=123&page=${page}#question-${slot}"><span class="accesshide">Question </span>${slot}<span class="accesshide"> Not yet answered</span></a>`)).join("")}</div><form method="post" action="/mod/quiz/processattempt.php"><input type="hidden" name="attempt" value="123"><input type="hidden" name="finishattempt" value="0"><input type="hidden" name="nextpage" value="${number === lastPage ? -1 : number + 1}">${descriptionPage && number === 0 ? '<div class="que description" id="question-123-99"><div class="qtext">Shared original diagram: all questions use this geometry.<img src="/original.svg" width="160"></div></div>' : ""}${questions.map((slot) => control.cloze ? `<div class="que multianswer deferredfeedback ${control.saves ? "complete" : "notyetanswered"}" id="question-123-${slot}"><div class="info"><h3>Question <span class="qno">${slot}</span></h3><div class="state">${control.saves ? "Answer saved" : "Not yet answered"}</div></div><div class="content"><div class="formulation"><input type="hidden" name="sequencecheck" value="${control.saves + 1}"><p>What is ${slot} + ${slot}?${input(slot)}</p></div></div></div>` : `<div class="que shortanswer" id="question-123-${slot}"><div class="info">Question ${slot}</div><div class="qtext">What is ${slot} + ${slot}?${slot === 3 ? '<img src="/original.svg" width="160">' : ""}${control.inline ? input(slot) : ""}</div>${control.inline ? "" : input(slot)}</div>`).join("")}<button>${number === lastPage ? "Finish attempt..." : "Next page"}</button></form>`,
      );
    } else if (url.pathname.endsWith("/summary.php"))
      response.end(
        "<title>Summary</title><h1>Attempt summary</h1><button>Submit all and finish</button>",
      );
    else response.end("<h1>Authenticated local dashboard</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env = {
    STUDY_BUDDY_BROKER_EXECUTION: "1",
    STUDY_BUDDY_WORKSPACE: workspace,
    STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "multi-owner",
    STUDY_BUDDY_WORKSPACE_KIND: "project",
    STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT: path.join(workspace, "ledger"),
    MOODLE_BASE_URL: base,
    MOODLE_DASHBOARD_URL: `${base}/my/`,
    MOODLE_USERNAME: "local-multipage-account",
    MOODLE_QUIZ_ACCESS_MODE: "quiz-assist",
  };
  try {
    await run(env, control);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
}

async function suppliedAnswers(result: Record<string, unknown>) {
  return Promise.all(
    (result.packets as Array<{ packetPath: string }>).map(async (item) => {
      const packet = JSON.parse(await readFile(item.packetPath, "utf8"));
      return {
        question_id: packet.question.question_id,
        confidence: 0.99,
        citations: [item.packetPath],
        control_answers: [
          {
            control_id: packet.question.controls[0].control_id,
            answer: String(packet.question.question_index * 2),
            selected: false,
          },
        ],
      };
    }),
  );
}

describe("whole-attempt capture and durable server receipts", () => {
  it("keeps saved receipts when course navigation closes but invalidates a changed shared task stem", async () => {
    await multiPageFixture(async (env, control) => {
      control.navigationOpen = true;
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` }, env,
      );
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env);
      for (const page of [0, 1, 2]) {
        const current = await executeDirectQuiz({ op: "read", runDir: started.runDir, page }, env);
        expect(await executeDirectQuiz({
          op: "fill", runDir: started.runDir, packetDigest: current.packetDigest,
          answers: await suppliedAnswers(current),
        }, env)).toMatchObject({ persisted: true });
      }
      control.navigationOpen = false;
      expect(await executeDirectQuiz({ op: "complete", runDir: started.runDir }, env))
        .toMatchObject({ ok: true, progress: { total: 5, verified: 5, complete: true } });
      control.navigationOpen = true;
      expect(await executeDirectQuiz({ op: "complete", runDir: started.runDir }, env))
        .toMatchObject({ ok: true, progress: { total: 5, verified: 5, complete: true } });
      control.sharedPrice++;
      expect(await executeDirectQuiz({ op: "complete", runDir: started.runDir }, env))
        .toMatchObject({ ok: false, progress: { verified: 0, complete: false } });
      expect(control).toMatchObject({ starts: 1, saves: 3, finals: 0 });
    });
  }, 120_000);
  it("recovers a durably received first ID after post-start native metadata was initially unreadable", async () => {
    await multiPageFixture(async (env, control) => {
      control.idlessCard = true;
      control.hideHistory = true;
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` },
        env,
      );
      await expect(
        executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env),
      ).rejects.toThrow("exact active first attempt");
      expect(control.starts).toBe(1);
      control.hideHistory = false;
      const recovered = await executeDirectQuiz({ op: "recover", runDir: inspected.runDir }, env);
      expect(new URL(recovered.attemptUrl as string).searchParams.get("attempt")).toBe("123");
      expect(recovered).toMatchObject({ ok: true, progress: { total: 5, captured: 2 } });
      expect(control).toMatchObject({ starts: 1, saves: 0, finals: 0 });
    });
  }, 120_000);
  it("binds and recovers its actual first redirect when a Moodle-style active card has no attempt ID", async () => {
    await multiPageFixture(async (env, control) => {
      control.idlessCard = true;
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` },
        env,
      );
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      expect(started).toMatchObject({
        ok: true,
        status: "active",
        progress: { total: 5, captured: 2 },
      });
      const status = await executeDirectQuiz({ op: "status", runDir: started.runDir }, env);
      expect(status.metadata).toMatchObject({
        hasActiveAttempt: true,
        attemptsUsed: 1,
        activeAttemptId: null,
        activeAttemptNumber: null,
      });
      expect(status).toMatchObject({ firstAttemptBound: true });
      const recovered = await executeDirectQuiz({ op: "recover", runDir: started.runDir }, env);
      expect(new URL(recovered.attemptUrl as string).searchParams.get("attempt")).toBe("123");
      expect(recovered).toMatchObject({ ok: true, progress: { captured: 2 } });
      expect(control).toMatchObject({ starts: 1, saves: 0, finals: 0 });
    });
  }, 120_000);
  it("collects a native information-only page and supplies its original image and text to every answer packet", async () => {
    await multiPageFixture(async (env, control) => {
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` },
        env,
      );
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      expect(started).toMatchObject({
        packets: [],
        progress: { total: 5, captured: 0, complete: false },
      });
      expect(control.saves).toBe(0);
      const collected = await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env);
      expect(collected.progress).toMatchObject({
        total: 5,
        captured: 5,
        captureComplete: true,
        verified: 0,
        complete: false,
      });
      expect(new URL(collected.attemptUrl as string).searchParams.get("page")).toBe("0");
      for (const item of collected.packets as Array<{ packetPath: string }>) {
        const packet = JSON.parse(await readFile(item.packetPath, "utf8"));
        expect(packet.attempt_contexts[0]).toMatchObject({ descriptionSlots: ["99"], errors: [] });
        expect(packet.attempt_contexts[0].text).toContain("Shared original diagram");
        expect(packet.attempt_contexts[0].image_paths.length).toBeGreaterThan(0);
        expect(packet.image_paths).toContain(packet.attempt_contexts[0].image_paths[0]);
        expect(packet.image_paths[0]).not.toMatch(/question\.png$/);
        expect(packet.media_complete).toBe(true);
      }
      control.invalidNavigation = true;
      expect(await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env)).toMatchObject(
        { ok: false, progress: { total: null, complete: false } },
      );
      control.invalidNavigation = false;
      for (const page of [1, 2, 3]) {
        const current = await executeDirectQuiz({ op: "read", runDir: started.runDir, page }, env);
        expect(
          await executeDirectQuiz(
            {
              op: "fill",
              runDir: started.runDir,
              packetDigest: current.packetDigest,
              answers: await suppliedAnswers(current),
            },
            env,
          ),
        ).toMatchObject({ persisted: true });
      }
      expect(
        await executeDirectQuiz({ op: "complete", runDir: started.runDir }, env),
      ).toMatchObject({ ok: true, progress: { total: 5, verified: 5, complete: true } });
      control.mediaVersion++;
      expect(
        await executeDirectQuiz({ op: "complete", runDir: started.runDir }, env),
      ).toMatchObject({ ok: false, progress: { verified: 0, complete: false } });
      expect(control).toMatchObject({ starts: 1, saves: 3, finals: 0 });
    }, true);
  }, 120_000);
  it("normalizes inline Cloze response HTML and binds the actual shared stem", async () => {
    await multiPageFixture(async (env, control) => {
      control.inline = true;
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` },
        env,
      );
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      const answers = await suppliedAnswers(started);
      const saved = await executeDirectQuiz(
        { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers },
        env,
      );
      expect(saved).toMatchObject({ ok: true, persisted: true, progress: { verified: 2 } });
      expect(control.values.get("answer1")).toBe("2");
      const current = await executeDirectQuiz({ op: "read", runDir: started.runDir }, env);
      control.sharedPrice = 8;
      await expect(
        executeDirectQuiz(
          { op: "fill", runDir: started.runDir, packetDigest: current.packetDigest, answers },
          env,
        ),
      ).rejects.toThrow("stale");
      expect(control.saves).toBe(1);
      expect(
        await executeDirectQuiz({ op: "complete", runDir: started.runDir }, env),
      ).toMatchObject({ ok: false, progress: { verified: 0, complete: false } });
      expect(control).toMatchObject({ starts: 1, finals: 0 });
    });
  }, 120_000);
  it("collects all five originals with GETs, retains shared context, detects lost saves/skipped final page and completes only all verified questions", async () => {
    await multiPageFixture(async (env, control) => {
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` },
        env,
      );
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      expect(started.progress).toMatchObject({
        total: 5,
        captured: 2,
        verified: 0,
        captureComplete: false,
        complete: false,
      });
      const collected = await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env);
      expect(collected.progress).toMatchObject({
        total: 5,
        captured: 5,
        captureComplete: true,
        verified: 0,
        complete: false,
      });
      expect(new URL(collected.attemptUrl as string).searchParams.get("page")).toBe("0");
      expect(control).toMatchObject({ starts: 1, saves: 0, finals: 0 });
      const packets = collected.packets as Array<{ question_id: string; packetPath: string }>;
      expect(new Set(packets.map((item) => item.question_id)).size).toBe(5);
      const imagePacket = JSON.parse(
        await readFile(
          packets.find((item) => item.question_id === "question-123-3")!.packetPath,
          "utf8",
        ),
      );
      expect(imagePacket.shared_page_context).toContain("Shared stem");
      expect(imagePacket.media_evidence.images[0]).toMatchObject({ width: 1600, height: 1000 });
      expect(imagePacket.image_paths[0]).not.toMatch(/question\.png$/);
      const reread = await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env);
      expect((reread.packets as typeof packets).map((item) => item.packetPath)).toEqual(
        packets.map((item) => item.packetPath),
      );
      for (let page = 0; page < 2; page++) {
        const current = await executeDirectQuiz({ op: "read", runDir: started.runDir, page }, env);
        const answers = await suppliedAnswers(current);
        if (page === 1) {
          control.discard = true;
          const failed = await executeDirectQuiz(
            { op: "fill", runDir: started.runDir, packetDigest: current.packetDigest, answers },
            env,
          );
          expect(failed).toMatchObject({ ok: false, persisted: false });
          expect(failed.progress).toMatchObject({ verified: 2, complete: false });
          await expect(
            executeDirectQuiz({ op: "next", runDir: started.runDir }, env),
          ).rejects.toThrow("verified");
          control.discard = false;
          control.skipLast = true;
        }
        const fresh = await executeDirectQuiz({ op: "read", runDir: started.runDir, page }, env);
        expect(
          await executeDirectQuiz(
            { op: "fill", runDir: started.runDir, packetDigest: fresh.packetDigest, answers },
            env,
          ),
        ).toMatchObject({ persisted: true });
        await executeDirectQuiz({ op: "recover", runDir: started.runDir }, env);
        const next = await executeDirectQuiz({ op: "next", runDir: started.runDir }, env);
        if (page === 1)
          expect(next).toMatchObject({
            status: "summary",
            progress: {
              total: 5,
              captured: 5,
              verified: 4,
              complete: false,
              unresolved: ["not-verified:question-123-5"],
            },
          });
      }
      // A fresh operation/client restores the same durable receipts, then saves the omitted original page.
      control.skipLast = false;
      const last = await executeDirectQuiz({ op: "read", runDir: started.runDir, page: 2 }, env);
      expect(
        await executeDirectQuiz(
          {
            op: "fill",
            runDir: started.runDir,
            packetDigest: last.packetDigest,
            answers: await suppliedAnswers(last),
          },
          env,
        ),
      ).toMatchObject({ persisted: true, progress: { verified: 5, complete: true } });
      expect(await executeDirectQuiz({ op: "next", runDir: started.runDir }, env)).toMatchObject({
        status: "summary",
        progress: { complete: true },
      });
      expect(control).toMatchObject({ starts: 1, finals: 0 });
      expect([...control.values.values()]).toEqual(["2", "4", "6", "8", "10"]);
    });
  }, 120_000);

  it("binds same-URL original image bytes and rejects added questions after saving", async () => {
    await multiPageFixture(async (env, control) => {
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` },
        env,
      );
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env);
      const page = await executeDirectQuiz({ op: "read", runDir: started.runDir, page: 1 }, env);
      const answers = await suppliedAnswers(page);
      control.mediaVersion = 2;
      await expect(
        executeDirectQuiz(
          { op: "fill", runDir: started.runDir, packetDigest: page.packetDigest, answers },
          env,
        ),
      ).rejects.toThrow("stale");
      expect(control.saves).toBe(0);
      control.addAfterSave = true;
      const first = await executeDirectQuiz({ op: "read", runDir: started.runDir, page: 0 }, env);
      const changed = await executeDirectQuiz(
        {
          op: "fill",
          runDir: started.runDir,
          packetDigest: first.packetDigest,
          answers: await suppliedAnswers(first),
        },
        env,
      );
      expect(changed).toMatchObject({
        ok: false,
        persisted: false,
        checks: [
          { mismatches: ["question-set-changed-after-reload"] },
          { mismatches: ["question-set-changed-after-reload"] },
        ],
        progress: { verified: 0, complete: false },
      });
      expect(control).toMatchObject({ starts: 1, finals: 0 });
    });
  }, 120_000);
});

describe("direct quiz tools through real guarded Playwright", () => {
  it("starts one first attempt, delegates actual packets, saves supplied mathematics, reload-verifies and recovers exactly that ID", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "direct-quiz-browser-"));
    let starts = 0,
      saves = 0,
      finals = 0,
      completed = false;
    const values = new Map<string, string>();
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://fixture");
      requests.push(`${request.method} ${url.pathname}`);
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (url.pathname.endsWith("/startattempt.php")) {
        starts++;
        expect(request.method).toBe("POST");
        let body = "";
        for await (const chunk of request) body += chunk;
        expect(new URLSearchParams(body).get("cmid")).toBe("7");
        response.writeHead(303, { location: "/mod/quiz/attempt.php?attempt=123&page=0" });
        response.end();
      } else if (url.pathname.endsWith("/processattempt.php")) {
        saves++;
        let body = "";
        for await (const chunk of request) body += chunk;
        const form = new URLSearchParams(body);
        if (form.get("finishattempt") === "1") finals++;
        expect(form.get("attempt")).toBe("123");
        values.set("answer1", form.get("answer1") ?? "");
        values.set("answer2", form.get("answer2") ?? "");
        response.writeHead(303, { location: "/mod/quiz/summary.php?attempt=123" });
        response.end();
      } else if (url.pathname.endsWith("/view.php"))
        response.end(
          `<title>Original exact test</title><h1>Original exact test</h1><p>Attempts allowed: 2</p>${completed ? '<table><tr><th>Attempt</th></tr><tr><td>1</td><td><a href="/mod/quiz/review.php?attempt=123">Review</a></td></tr></table><form method="post" action="/mod/quiz/startattempt.php"><input name="cmid" value="7" type="hidden"><button>Re-attempt quiz</button></form>' : starts ? '<table><tr><th>Attempt</th></tr><tr><td>1</td><td><a href="/mod/quiz/attempt.php?attempt=123&page=0">Continue attempt</a></td></tr></table>' : '<p>No attempts yet</p><form method="post" action="/mod/quiz/startattempt.php"><input type="hidden" name="cmid" value="7"><input type="hidden" name="sesskey" value="fixture"><button name="startattempt" type="submit">Attempt quiz</button></form>'}`,
        );
      else if (url.pathname.endsWith("/attempt.php"))
        response.end(`<title>Original exact test</title><div id="mod_quiz_navblock"><a class="qnbutton" data-quiz-page="0">1</a><a class="qnbutton" data-quiz-page="0">2</a></div>
        <form id="responseform" method="post" action="/mod/quiz/processattempt.php"><input type="hidden" name="attempt" value="123"><input type="hidden" name="finishattempt" value="0"><input type="hidden" name="nextpage" value="-1">
        <div class="que shortanswer" id="question-123-1"><div class="qtext">What is 2 + 2?</div><input type="text" id="answer-1" name="answer1" value="${values.get("answer1") ?? ""}"></div>
        <div class="que shortanswer" id="question-123-2"><div class="qtext">What is 3 times 7?</div><input type="text" id="answer-2" name="answer2" value="${values.get("answer2") ?? ""}"></div>
        <button type="submit">Finish attempt...</button></form>`);
      else if (url.pathname.endsWith("/summary.php"))
        response.end(
          '<title>Attempt summary</title><h1>First attempt summary</h1><form method="post" action="/mod/quiz/processattempt.php"><input name="attempt" value="123" type="hidden"><input name="finishattempt" value="1" type="hidden"><button>Submit all and finish</button></form>',
        );
      else response.end("<h1>Logged-in fixture dashboard</h1>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const env: NodeJS.ProcessEnv = {
      STUDY_BUDDY_BROKER_EXECUTION: "1",
      STUDY_BUDDY_WORKSPACE: workspace,
      STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "real-owner",
      STUDY_BUDDY_WORKSPACE_KIND: "project",
      STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT: path.join(workspace, "ledger"),
      MOODLE_BASE_URL: base,
      MOODLE_DASHBOARD_URL: base + "/my/",
      MOODLE_USERNAME: "real-fixture-account",
      MOODLE_QUIZ_ACCESS_MODE: "quiz-assist",
    };
    try {
      const inspected = await executeDirectQuiz(
        { op: "inspect", url: base + "/mod/quiz/view.php?id=7" },
        env,
      );
      expect(inspected.metadata).toMatchObject({ attemptsUsed: 0, canStartNewAttempt: true });
      expect(starts).toBe(0);
      const started = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
      expect(starts).toBe(1);
      expect(started.navigation).toBe("single-page");
      const read = await executeDirectQuiz({ op: "read", runDir: started.runDir }, env);
      expect((read.packets as any[]).length).toBe(2);
      const packets = await Promise.all(
        (read.packets as any[]).map(async (item) =>
          JSON.parse(await readFile(item.packetPath, "utf8")),
        ),
      );
      expect(packets.map((packet) => packet.question.prompt)).toEqual([
        "What is 2 + 2?",
        "What is 3 times 7?",
      ]);
      expect(packets.every((packet) => packet.media_evidence.screenshotPath)).toBe(true);
      const answers = packets.map((packet, index) => ({
        question_id: packet.question.question_id,
        confidence: 0.99,
        citations: [packet.question.prompt],
        control_answers: [
          {
            control_id: packet.question.controls[0].control_id,
            answer: index === 0 ? "4" : "21",
            selected: false,
          },
        ],
      }));
      const filled = await executeDirectQuiz(
        { op: "fill", runDir: started.runDir, packetDigest: read.packetDigest, answers },
        env,
      );
      expect(filled).toMatchObject({
        ok: true,
        persisted: true,
        checks: [{ verified: true }, { verified: true }],
        finalSubmitClicked: false,
      });
      expect([...values.values()]).toEqual(["4", "21"]);
      expect(saves).toBe(1);
      expect(finals).toBe(0);
      const recovered = await executeDirectQuiz({ op: "recover", runDir: started.runDir }, env);
      expect(new URL(recovered.attemptUrl as string).searchParams.get("attempt")).toBe("123");
      const finish = await executeDirectQuiz({ op: "next", runDir: started.runDir }, env);
      expect(finish.status).toBe("summary");
      expect(finals).toBe(0);
      await executeDirectQuiz({ op: "start", runDir: started.runDir }, env);
      expect(starts).toBe(1);
      expect(finals).toBe(0);
      completed = true;
      const secondRun = await executeDirectQuiz(
        { op: "inspect", url: base + "/mod/quiz/view.php?id=7" },
        env,
      );
      expect(secondRun.metadata).toMatchObject({
        attemptsAllowed: 2,
        attemptsUsed: 1,
        hasActiveAttempt: false,
      });
      await expect(
        executeDirectQuiz({ op: "start", runDir: secondRun.runDir }, env),
      ).rejects.toThrow("first-attempt-only-history-not-zero");
      expect(
        requests.filter((request) => request === "POST /mod/quiz/startattempt.php"),
      ).toHaveLength(1);
      expect(
        requests.filter((request) => request === "POST /mod/quiz/processattempt.php"),
      ).toHaveLength(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(workspace, { recursive: true, force: true });
    }
  }, 60_000);
});


it("verifies a Moodle Cloze save when status classes and hidden sequence state change", async () => {
  await multiPageFixture(async (env, control) => {
    control.cloze = true;
    const inspected = await executeDirectQuiz({ op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` }, env);
    const current = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
    const result = await executeDirectQuiz({ op: "fill", runDir: inspected.runDir,
      packetDigest: current.packetDigest, answers: await suppliedAnswers(current) }, env);
    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(control.saves).toBe(1);
    expect(control.finals).toBe(0);
  });
}, 30000);


it("still rejects changed Cloze givens before saving", async () => {
  await multiPageFixture(async (env, control) => {
    control.cloze = true;
    const inspected = await executeDirectQuiz({ op: "inspect", url: `${env.MOODLE_BASE_URL}/mod/quiz/view.php?id=7` }, env);
    const current = await executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env);
    control.sharedPrice++;
    await expect(executeDirectQuiz({ op: "fill", runDir: inspected.runDir,
      packetDigest: current.packetDigest, answers: await suppliedAnswers(current) }, env)).rejects.toThrow("stale");
    expect(control.saves).toBe(0);
    expect(control.finals).toBe(0);
  });
}, 30000);

it("keeps Cloze source mathematics stable through MathJax v2 rendering and rejects changed source TeX", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(String.raw`<p>Shared given <span id="shared-math">\(c=2\)</span>.</p>
      <div class="que multianswer deferredfeedback" id="question-42-1">
      <div class="content"><div class="formulation"><span class="filter_mathjaxloader_equation"><p>Differentiate
      <span id="inline-math" class="nolink">\(f(x)=x^2+1\)</span>.
      <span id="display-math">\[f'(x)=2x\]</span>
      <span class="subquestion"><label for="answer-1">Choose the derivative</label>
        <select id="answer-1"><option value=""></option><option value="two-x">2x</option><option value="x">x</option></select>
      </span></p></span></div></div></div>`);
    const client = {
      evalJson: async <T,>(expression: string): Promise<T> => {
        const result = await page.evaluate(expression);
        return (typeof result === "string" ? JSON.parse(result) : result) as T;
      },
    } as AgentBrowserClient;
    const capture = async () => canonicalDirectQuizPage(client, await extractQuizPage(client));
    const before = await capture();
    await page.evaluate(() => {
      document.getElementById("answer-1")!.addEventListener("change", () => {
        document.getElementById("question-42-1")!.classList.add("answersaved");
        document.querySelector(".formulation p")!.id = "yui_3_18_1_1_1791200183558_267";
        document.querySelector(".subquestion")!.id = "yui_3_18_1_1_1791200183558_268";
        document.querySelector(".filter_mathjaxloader_equation")!.id = "yui_3_18_1_1_1791200183558_269";
        document.getElementById("answer-1")!.setAttribute("data-initial-value", "");
        for (const [id, tex, display] of [
          ["inline-math", "f(x)=x^2+1", false],
          ["display-math", "f'(x)=2x", true],
          ["shared-math", "c=2", false],
        ] as const) {
          const wrapper = document.getElementById(id)!;
          wrapper.replaceChildren();
          const preview = document.createElement("span");
          preview.className = "MathJax_Preview";
          preview.textContent = tex;
          preview.style.display = "none";
          const output = document.createElement("span");
          output.className = display ? "MathJax MathJax_Display" : "MathJax";
          output.setAttribute("role", "presentation");
          output.textContent = "typeset presentation";
          const source = document.createElement("script");
          source.type = display ? "math/tex; mode=display" : "math/tex";
          source.textContent = tex;
          wrapper.append(preview, output, source);
        }
      }, { once: true });
    });
    const answer = { confidence: 0.99, citations: ["visible local question"],
      control_answers: [{ control_id: "answer-1", answer: "two-x", selected: false }] };
    expect(await fillVisibleQuestion(client, before.questions[0], answer)).toMatchObject({ filled: true });
    const after = await capture();
    expect(verifyQuestionAnswers(after.questions[0], answer)).toMatchObject({ verified: true });
    expect(after.body_text).toEqual(before.body_text);
    expect(after.body_text).toContain("c=2");
    const identity = (question: typeof before.questions[number]) => ({
      ...question,
      controls: question.controls.map(({ value, checked: _checked, raw_html: _raw, options, ...control }) => ({
        ...control,
        value: ["radio", "checkbox"].includes(String(control.type)) ? value : undefined,
        options: Array.isArray(options) ? options.map(({ selected: _selected, ...option }) => option) : options,
      })),
    });
    expect(identity(after.questions[0])).toEqual(identity(before.questions[0]));
    expect(JSON.stringify(identity(after.questions[0]))).toContain("x^2+1");
    expect(after.questions[0].prompt_html).toContain('id="inline-math"');
    expect(after.questions[0].prompt_html).toContain('id="answer-1"');
    await page.evaluate(() => {
      document.querySelector('#inline-math script[type="math/tex"]')!.textContent = "f(x)=x^3+1";
    });
    const changed = await capture();
    expect(identity(changed.questions[0])).not.toEqual(identity(after.questions[0]));
    expect(JSON.stringify(identity(changed.questions[0]))).toContain("x^3+1");
  } finally { await browser.close(); }
}, 30_000);

it("binds public drag sources and targets while reusable response clones move", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // All traffic stays offline; source URLs are public task identifiers only.
    const fixtureUrl = "http://127.0.0.1:1/fixture";
    const html = `<style>
      .que {position:relative;width:600px;height:420px}
      .droparea {position:absolute;left:20px;top:70px;width:500px;height:240px}
      .dropzone,.draghome {position:absolute;width:80px;height:40px;box-sizing:border-box}
      .place1 {left:100px;top:50px}.place2 {left:260px;top:50px}
      .draghomes .choice1 {left:20px;top:350px}.draghomes .choice2 {left:140px;top:350px}
      </style><div class="que ddimageortext" id="question-42-2"><div class="formulation">
      <div class="qtext">Match each target to its source graphic.</div><div class="ddarea">
      <div class="droparea"><img class="dropbackground" src="http://127.0.0.1:1/background.png" alt="original diagram" width="500" height="240">
        <div class="dropzone place1 group1" tabindex="0" aria-label="First target">First target</div>
        <div class="dropzone place2 group1" tabindex="0" aria-label="Second target">Second target</div>
      </div><div class="draghomes">
        <img class="draghome choice1 group1 infinite" src="http://127.0.0.1:1/alpha.png" alt="Alpha">
        <img class="draghome choice2 group1" src="http://127.0.0.1:1/beta.png" alt="Beta">
      </div><input class="placeinput place1 group1" id="drop-answer-1" type="hidden" value="0">
      <input class="placeinput place2 group1" id="drop-answer-2" type="hidden" value="0">
      </div></div></div>`;
    await page.route("**/*", route => route.request().url() === fixtureUrl
      ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
    await page.goto(fixtureUrl);
    await page.evaluate(() => {
      document.addEventListener("keydown", event => {
        const drop = (event.target as Element).closest<HTMLElement>(".dropzone");
        if (!drop) return;
        const place = Array.from(drop.classList).find(name => /^place\d+$/.test(name))!;
        const input = document.querySelector<HTMLInputElement>(`input.${place}`)!;
        if (event.key === "Escape") {
          input.value = "0";
          document.querySelector(`.placed.in${place}`)?.remove();
          drop.style.visibility = "";
        } else if (event.key === "ArrowRight") {
          input.value = "1";
          const item = document.querySelector<HTMLImageElement>(".draghomes .choice1")!.cloneNode(true) as HTMLImageElement;
          item.classList.add("placed", `in${place}`);
          item.style.left = `${drop.offsetLeft}px`;
          item.style.top = `${drop.offsetTop}px`;
          document.querySelector(".droparea")!.append(item);
          drop.style.visibility = "hidden";
        }
      });
    });
    const client = {
      evalJson: async <T,>(expression: string): Promise<T> => {
        const result = await page.evaluate(expression);
        return (typeof result === "string" ? JSON.parse(result) : result) as T;
      },
    } as AgentBrowserClient;
    const capture = async () => canonicalDirectQuizPage(client, await extractQuizPage(client));
    const before = await capture();
    const answer = { confidence: 0.99, citations: ["visible local diagram"],
      control_answers: [1, 2].map(place => ({ control_id: `drop-answer-${place}`, answer: "1", selected: false })) };
    expect(await fillVisibleQuestion(client, before.questions[0], answer)).toMatchObject({ filled: true });
    const after = await capture();
    expect(verifyQuestionAnswers(after.questions[0], answer)).toMatchObject({ verified: true });
    const identity = (question: typeof before.questions[number]) => ({
      ...question,
      controls: question.controls.map(({ value: _value, checked: _checked, raw_html: _raw, options, ...control }) => ({
        ...control,
        options: Array.isArray(options) ? options.map(({ selected: _selected, bounds: _responsePosition, ...option }) => option) : options,
      })),
    });
    expect(identity(after.questions[0])).toEqual(identity(before.questions[0]));
    expect(after.questions[0].controls).toHaveLength(2);
    expect(after.questions[0].controls.every(control => (control.options as unknown[]).length === 2)).toBe(true);
    await page.evaluate(() => { document.querySelector<HTMLImageElement>(".draghomes .choice2")!.src = "http://127.0.0.1:1/changed-beta.png"; });
    const changedSource = await capture();
    expect(identity(changedSource.questions[0])).not.toEqual(identity(after.questions[0]));
    await page.evaluate(() => {
      document.querySelector<HTMLImageElement>(".draghomes .choice2")!.src = "http://127.0.0.1:1/beta.png";
      document.querySelector<HTMLElement>(".dropzone.place2")!.style.left = "310px";
    });
    const changedTarget = await capture();
    expect(identity(changedTarget.questions[0])).not.toEqual(identity(after.questions[0]));
  } finally { await browser.close(); }
}, 30_000);
