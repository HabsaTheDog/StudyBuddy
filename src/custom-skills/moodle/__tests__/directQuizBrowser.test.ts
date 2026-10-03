import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { executeDirectQuiz } from "../directQuiz.js";

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
