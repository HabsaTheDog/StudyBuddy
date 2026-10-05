import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  consumeFirstQuizStartRequest,
  loadFirstQuizAttemptBinding,
  reserveFirstQuizAttempt,
} from "../quizAttemptGuard.js";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import {
  assertNoFinalQuizSubmission,
  createFirstQuizAttemptRequestGuard,
  createReadOnlyQuizRequestGuard,
  QuizRequestBlockedError,
} from "../quizAttemptRequestGuard.js";
import type { QuizMetadata } from "../quizSafetyPolicy.js";
import type { MoodleRuntimeConfig } from "../types.js";

const origin = "https://moodle.example";
const request = (postData: string | null, url = `${origin}/mod/quiz/processattempt.php`) => ({
  url,
  method: "POST",
  postData,
});

describe("quiz HTTP action admission", () => {
  it.each(["GET", "HEAD"])(
    "admits only configured-prefix static quiz JavaScript (%s)",
    async (method) => {
      const targetUrl = `${origin}/campus/mod/quiz/view.php?id=7`;
      const input = {
        url: `${origin}/campus/lib/javascript.php/1750000000/mod/quiz/yui/module.min.js`,
        method,
        postData: null,
      };
      const readOnly = createReadOnlyQuizRequestGuard(targetUrl);
      const first = createFirstQuizAttemptRequestGuard({
        targetUrl,
        loadBinding: async () => null,
        debitStartBeforeForward: async () => {
          throw Error("must not start");
        },
      });
      expect(() => readOnly(input)).not.toThrow();
      await expect(first(input)).resolves.toBeUndefined();
    },
  );

  it.each([
    { path: "/campus/lib/javascript.php/175/mod/quiz/module.js", method: "POST", body: null },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/module.js",
      method: "GET",
      body: "attempt=31",
    },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/module.js?attempt=31",
      method: "GET",
      body: null,
    },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/module.js?unknown=1",
      method: "GET",
      body: null,
    },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/module.js?finishattempt=1",
      method: "GET",
      body: null,
    },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/module.js#fragment",
      method: "GET",
      body: null,
    },
    { path: "/lib/javascript.php/175/mod/quiz/module.js", method: "GET", body: null },
    { path: "/campus/lib/javascript.php/invalid/mod/quiz/module.js", method: "GET", body: null },
    { path: "/campus/lib/javascript.php/175/mod/quiz/startattempt.php", method: "GET", body: null },
    { path: "/campus/lib/other.php/175/mod/quiz/module.js", method: "GET", body: null },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/../quiz/module.js",
      method: "GET",
      body: null,
    },
    {
      path: "/campus/lib/javascript.php/175/mod/quiz/%2e%2e/quiz/module.js",
      method: "GET",
      body: null,
    },
    { path: "/campus/lib/javascript.php/175/mod/quiz/yui%2fmodule.js", method: "GET", body: null },
  ])(
    "does not extend loader admission to unsafe request $path/$method",
    async ({ path, method, body }) => {
      const targetUrl = `${origin}/campus/mod/quiz/view.php?id=7`;
      const input = { url: origin + path, method, postData: body };
      const first = createFirstQuizAttemptRequestGuard({
        targetUrl,
        loadBinding: async () => ({ attemptId: "31" }),
        debitStartBeforeForward: async () => {
          throw Error("must not start");
        },
      });
      expect(() => createReadOnlyQuizRequestGuard(targetUrl)(input)).toThrow(
        "Quiz request blocked",
      );
      await expect(first(input)).rejects.toThrow("Quiz request blocked");
    },
  );

  it("does not admit a foreign-origin static loader", async () => {
    const targetUrl = `${origin}/mod/quiz/view.php?id=7`;
    const input = {
      url: "https://foreign.example/lib/javascript.php/175/mod/quiz/module.js",
      method: "GET",
      postData: null,
    };
    expect(() => createReadOnlyQuizRequestGuard(targetUrl)(input)).toThrow();
    await expect(
      createFirstQuizAttemptRequestGuard({
        targetUrl,
        loadBinding: async () => ({ attemptId: "31" }),
        debitStartBeforeForward: async () => {},
      })(input),
    ).rejects.toThrow();
  });
  it("reports fixed request categories without leaking URL, query or body secrets", () => {
    const error = new QuizRequestBlockedError({
      url: "https://secret-account.example/lib/ajax/service.php?sesskey=private-session",
      method: "POST",
      postData: "password=private-password",
    });
    expect(error.message).toBe("Quiz request blocked by attempt safety guard. (POST service)");
    expect(error.message).not.toMatch(/private|secret-account|sesskey|password/);
    expect(
      new QuizRequestBlockedError({ url: "invalid-private-url", method: "PRIVATE", postData: null })
        .message,
    ).toContain("OTHER other");
  });
  it("persists only an actual verified response identity before allowing provisional reads", async () => {
    const events: string[] = [];
    const guard = createFirstQuizAttemptRequestGuard({
      targetUrl: `${origin}/mod/quiz/view.php?id=7`,
      loadBinding: async () => null,
      debitStartBeforeForward: async () => {
        events.push("debit");
      },
      recordStartRedirect: async (proof) => {
        events.push(
          `receipt:${proof.status}:${new URL(proof.attemptUrl).searchParams.get("attempt")}`,
        );
      },
    });
    const start = request("cmid=7", `${origin}/mod/quiz/startattempt.php`);
    await guard(start);
    const page = {
      url: `${origin}/mod/quiz/attempt.php?attempt=31`,
      method: "GET",
      postData: null,
      redirectedFrom: { url: start.url, method: "POST" },
    };
    await expect(guard(page)).rejects.toThrow();
    expect(events).toEqual(["debit"]);
    await guard({ ...page, redirectedFrom: { ...page.redirectedFrom, status: 303 } });
    expect(events).toEqual(["debit", "receipt:303:31"]);
    await guard({ url: page.url, method: "GET", postData: null });
    await expect(guard(request("attempt=31&finishattempt=0"))).rejects.toThrow();
    await expect(guard(start)).rejects.toThrow();
  });
  it.each([
    request("attempt=1&finishattempt=1"),
    request("attempt=1&finishattempt=false"),
    request(null, `${origin}/mod/quiz/processattempt.php?finishattempt=false`),
    request("attempt=1&finishattempt=%200%20"),
    request(
      '--fixture\r\nContent-Disposition: form-data; name="finishattempt"\r\n\r\nfalse\r\n--fixture--\r\n',
    ),
    request("finishattempt%5B0%5D=0&attempt=1"),
    request('{"attempt":1,"finishattempt":"false"}'),
    request('{"attempt":1,"finishattempt":[false]}'),
    request("finishattempt=0&finishattempt=1&attempt=1"),
    request("finishattempt%5B0%5D=1&attempt=1"),
    request('{"attempt":1,"finishattempt":true}'),
    request(
      '[{"methodname":"mod_quiz_save_attempt","args":{"attemptid":1,"finishattempt":1}}]',
      `${origin}/lib/ajax/service.php`,
    ),
    request(
      '--fixture\r\nContent-Disposition: form-data; name="finishattempt"\r\n\r\n1\r\n--fixture--\r\n',
    ),
    request(null, `${origin}/mod/quiz/processattempt.php?finishattempt=1`),
    { url: `${origin}/mod/quiz/submit.php`, method: "GET", postData: null },
    request("attempt=1", `${origin}/mod/quiz/summary.php`),
    request('{"attempt":1,"finishattempt":'),
  ])("rejects final submission independently of labels/body encoding: %j", (input) => {
    expect(() => assertNoFinalQuizSubmission(input)).toThrow("Quiz request blocked");
  });

  it("preserves non-final saves and unrelated login/assignment requests", () => {
    expect(() =>
      assertNoFinalQuizSubmission(request("attempt=1&finishattempt=0&nextpage=-1")),
    ).not.toThrow();
    expect(() =>
      assertNoFinalQuizSubmission(request('{"attempt":1,"finishattempt":false}')),
    ).not.toThrow();
    expect(() =>
      assertNoFinalQuizSubmission(request("password=fixture", `${origin}/login/index.php`)),
    ).not.toThrow();
    expect(() =>
      assertNoFinalQuizSubmission(
        request("--file arbitrary binary", `${origin}/mod/assign/upload.php`),
      ),
    ).not.toThrow();
  });

  it("admits only the reserved target start and its read-only provisional redirect", async () => {
    let debits = 0;
    let binding: { attemptId: string } | null = null;
    const guard = createFirstQuizAttemptRequestGuard({
      targetUrl: `${origin}/mod/quiz/view.php?id=7`,
      loadBinding: async () => binding,
      debitStartBeforeForward: async () => {
        debits++;
      },
    });
    const start = request("cmid=7&sesskey=fixture", `${origin}/mod/quiz/startattempt.php`);
    await guard(start);
    expect(debits).toBe(1);
    await expect(guard(start)).rejects.toThrow("Quiz request blocked");
    const page = {
      url: `${origin}/mod/quiz/attempt.php?attempt=31`,
      method: "GET",
      postData: null,
    };
    await expect(guard(page)).rejects.toThrow("Quiz request blocked");
    await guard({ ...page, redirectedFrom: { url: start.url, method: "POST" } });
    await expect(guard(request("attempt=31&finishattempt=0"))).rejects.toThrow(
      "Quiz request blocked",
    );
    binding = { attemptId: "31" };
    await guard(request("attempt=31&finishattempt=0"));
    await expect(guard(request("attempt=32&finishattempt=0"))).rejects.toThrow(
      "Quiz request blocked",
    );
    await expect(
      guard(request("attempt=31", `${origin}/mod/quiz/processattempt.php?attempt=32`)),
    ).rejects.toThrow("Quiz request blocked");
    await expect(
      guard({ ...page, url: "https://foreign.example/mod/quiz/attempt.php?attempt=31" }),
    ).rejects.toThrow("Quiz request blocked");
  });

  it("never debits a foreign cmid or unbound direct attempt", async () => {
    let debits = 0;
    const guard = createFirstQuizAttemptRequestGuard({
      targetUrl: `${origin}/mod/quiz/view.php?id=7`,
      loadBinding: async () => null,
      debitStartBeforeForward: async () => {
        debits++;
      },
    });
    await expect(guard(request("cmid=8", `${origin}/mod/quiz/startattempt.php`))).rejects.toThrow();
    await expect(
      guard({ url: `${origin}/mod/quiz/attempt.php?attempt=1`, method: "GET", postData: null }),
    ).rejects.toThrow();
    expect(debits).toBe(0);
  });
});

async function browserFixture(
  run: (
    client: ReturnType<typeof createPlaywrightBrowserClient>,
    origin: string,
    counters: { starts: number; finals: number; saves: number; attemptReads: number },
  ) => Promise<void>,
  failAfterCreation = false,
  startRedirect = { status: 303, location: "/mod/quiz/attempt.php?attempt=31" },
) {
  const counters = { starts: 0, finals: 0, saves: 0, attemptReads: 0 };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    res.setHeader("content-type", "text/html");
    if (url.pathname === "/mod/quiz/submit.php") {
      counters.finals++;
      res.end("Final fixture");
      return;
    }
    if (url.pathname === "/media-page") {
      res.end(
        '<div class="que shortanswer" id="question-1"><div class="qtext">Fixture</div><img loading="lazy" style="display:none" src="/mod/quiz/submit.php"></div>',
      );
      return;
    }
    if (url.pathname === "/static-loader-page") {
      res.end(
        '<script src="/lib/javascript.php/1750000000/mod/quiz/module.js"></script><main>Static loader fixture</main><div id="question-1">Original question context</div>',
      );
      return;
    }
    if (url.pathname === "/lib/javascript.php/1750000000/mod/quiz/module.js") {
      res.setHeader("content-type", "application/javascript");
      res.end('document.documentElement.setAttribute("data-quiz-module-loaded","yes");');
      return;
    }
    if (url.pathname === "/automatic-start") {
      res.end(
        '<script>fetch("/mod/quiz/startattempt.php",{method:"POST",body:"cmid=7"}).catch(()=>{})</script><main>Metadata</main>',
      );
      return;
    }
    if (url.pathname.endsWith("/startattempt.php")) {
      counters.starts++;
      if (failAfterCreation) {
        res.writeHead(503);
        res.end("Ambiguous start outcome");
        return;
      }
      res.writeHead(startRedirect.status, { location: startRedirect.location });
      res.end();
      return;
    }
    if (url.pathname.endsWith("/attempt.php")) {
      counters.attemptReads++;
      res.end("<main>Original first attempt</main>");
      return;
    }
    if (url.pathname.endsWith("/processattempt.php")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (
        new URLSearchParams(body).get("finishattempt") === "1" ||
        body.includes('"finishattempt":1')
      )
        counters.finals++;
      else counters.saves++;
      res.end("Saved");
      return;
    }
    res.end(`<form method="post" action="/mod/quiz/startattempt.php"><input name="cmid" value="7"><button id="start">Start attempt</button></form>
      <form method="post" action="/mod/quiz/processattempt.php"><input name="attempt" value="31"><input type="hidden" name="finishattempt" value="1"><button id="disguised">Next page</button></form><main>Fixture</main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createPlaywrightBrowserClient({
    headless: true,
    baseUrl: base,
  } as MoodleRuntimeConfig);
  try {
    await run(client, base, counters);
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("real browser request gate", () => {
  it.each(["read-only", "bound-first"])(
    "loads actual HTTP Moodle JavaScript without sticky capture failure (%s)",
    async (kind) => {
      await browserFixture(async (client, base, counters) => {
        const targetUrl = `${base}/mod/quiz/view.php?id=7`;
        client.setQuizRequestGuard!(
          kind === "read-only"
            ? createReadOnlyQuizRequestGuard(targetUrl)
            : createFirstQuizAttemptRequestGuard({
                targetUrl,
                loadBinding: async () => ({ attemptId: "31" }),
                debitStartBeforeForward: async () => {
                  throw Error("must not start");
                },
              }),
        );
        const directory = await mkdtemp(path.join(os.tmpdir(), "quiz-static-loader-"));
        try {
          await client.open(`${base}/static-loader-page`);
          expect(
            await client.evalJson(
              'JSON.stringify(document.documentElement.getAttribute("data-quiz-module-loaded"))',
            ),
          ).toBe("yes");
          expect(await client.captureQuestionEvidence!("question-1", directory)).toMatchObject({
            complete: true,
            errors: [],
            images: [],
          });
          expect(await client.getText()).toContain("Original question context");
          expect(counters.starts).toBe(0);
          expect(counters.saves).toBe(0);
          expect(counters.finals).toBe(0);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    },
  );
  it.each([302, 303])(
    "admits the actual %s start redirect and later same-attempt reads before binding",
    async (status) => {
      await browserFixture(
        async (client, base, counters) => {
          const observations: Array<{ method: string; path: string; parent: string | null }> = [];
          let debit = 0;
          const guard = createFirstQuizAttemptRequestGuard({
            targetUrl: `${base}/mod/quiz/view.php?id=7`,
            loadBinding: async () => null,
            debitStartBeforeForward: async () => {
              if (debit++) throw new Error("second debit");
            },
          });
          client.setQuizRequestGuard!(async (request) => {
            observations.push({
              method: request.method,
              path: new URL(request.url).pathname,
              parent: request.redirectedFrom
                ? `${request.redirectedFrom.method} ${new URL(request.redirectedFrom.url).pathname}`
                : null,
            });
            await guard(request);
          });
          await client.open(`${base}/mod/quiz/view.php?id=7`);
          await client.click("#start");
          expect(observations).toContainEqual({
            method: "GET",
            path: "/mod/quiz/attempt.php",
            parent: "POST /mod/quiz/startattempt.php",
          });
          await client.open(`${base}/mod/quiz/attempt.php?attempt=31&page=1`);
          expect(await client.getText()).toContain("Original first attempt");
          expect(counters.attemptReads).toBe(2);
          expect(counters.starts).toBe(1);
          expect(debit).toBe(1);
          await expect(
            client.evalJson(
              `(async()=>{await fetch('/mod/quiz/processattempt.php',{method:'POST',body:'attempt=31&finishattempt=0'});return JSON.stringify(true);})()`,
            ),
          ).rejects.toThrow("Quiz request blocked");
          expect(counters.saves).toBe(0);
          expect(counters.finals).toBe(0);
        },
        false,
        { status, location: "/mod/quiz/attempt.php?attempt=31" },
      );
    },
  );

  it.each([
    { status: 301, location: "/mod/quiz/attempt.php?attempt=31" },
    { status: 307, location: "/mod/quiz/startattempt.php" },
    { status: 308, location: "/mod/quiz/startattempt.php" },
    { status: 303, location: "/mod/quiz/submit.php" },
    { status: 303, location: "http://127.0.0.1:9/not-a-quiz" },
    { status: 303, location: "/not-a-quiz" },
    { status: 303, location: "/mod/quiz/attempt.php?attempt=31&attempt=32" },
  ])("blocks unsafe start redirects before browser continuation: %j", async (redirect) => {
    await browserFixture(
      async (client, base, counters) => {
        let debit = 0;
        client.setQuizRequestGuard!(
          createFirstQuizAttemptRequestGuard({
            targetUrl: `${base}/mod/quiz/view.php?id=7`,
            loadBinding: async () => null,
            debitStartBeforeForward: async () => {
              if (debit++) throw new Error("second debit");
            },
          }),
        );
        await client.open(`${base}/mod/quiz/view.php?id=7`);
        await expect(client.click("#start")).rejects.toThrow("Quiz request blocked");
        expect(counters.starts).toBe(1);
        expect(debit).toBe(1);
        expect(counters.attemptReads).toBe(0);
        expect(counters.finals).toBe(0);
      },
      false,
      redirect,
    );
  });
  it("does not bypass request admission when authenticated APIRequestContext downloads a lazy question image", async () => {
    await browserFixture(async (client, base, counters) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "quiz-action-image-"));
      try {
        await client.open(`${base}/media-page`);
        await expect(client.captureQuestionEvidence!("question-1", directory)).rejects.toThrow(
          "Quiz request blocked",
        );
        expect(counters.finals).toBe(0);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });

  it("blocks an initial metadata page's automatic start before policy inspection", async () => {
    await browserFixture(async (client, base, counters) => {
      client.setQuizRequestGuard!(createReadOnlyQuizRequestGuard(`${base}/mod/quiz/view.php?id=7`));
      await client
        .open(`${base}/automatic-start`)
        .catch((error) => expect(String(error)).toContain("Quiz request blocked"));
      await client.wait(200).catch(() => undefined);
      await expect(client.getText()).rejects.toThrow("Quiz request blocked");
      expect(counters.starts).toBe(0);
    });
  });

  it("blocks a disguised final form before forwarding and exposes a sticky generic failure", async () => {
    await browserFixture(async (client, base, counters) => {
      await client.open(`${base}/mod/quiz/view.php?id=7`);
      await expect(client.click("#disguised")).rejects.toThrow("Quiz request blocked");
      await expect(client.getText()).rejects.toThrow("Quiz request blocked");
      expect(counters.finals).toBe(0);
    });
  });

  it.each(["json", "multipart", "urlencoded"])(
    "blocks final fetch/autosave (%s), even if page JS catches the network error",
    async (encoding) => {
      await browserFixture(async (client, base, counters) => {
        await client.open(`${base}/mod/quiz/view.php?id=7`);
        const payload =
          encoding === "json"
            ? `JSON.stringify({attempt:31,finishattempt:1})`
            : encoding === "multipart"
              ? `(()=>{const f=new FormData();f.set('attempt','31');f.set('finishattempt','1');return f;})()`
              : `'attempt=31&finishattempt=1'`;
        await expect(
          client.evalJson(
            `(async()=>{try{await fetch('/mod/quiz/processattempt.php',{method:'POST',body:${payload}});}catch{}return JSON.stringify({claimedSaved:true});})()`,
          ),
        ).rejects.toThrow("Quiz request blocked");
        expect(counters.finals).toBe(0);
      });
    },
  );

  it("uses the same gate for keyboard form submission", async () => {
    await browserFixture(async (client, base, counters) => {
      await client.open(`${base}/mod/quiz/view.php?id=7`);
      await client.evalJson(`document.querySelector('#disguised').focus();JSON.stringify(true)`);
      try {
        await client.press("Enter");
      } catch (error) {
        expect(String(error)).toContain("Quiz request blocked");
      }
      await client.wait(200).catch(() => undefined);
      await expect(client.getUrl()).rejects.toThrow("Quiz request blocked");
      expect(counters.finals).toBe(0);
    });
  });

  it("forwards one exact first start, allows its redirect, then bound saves only", async () => {
    await browserFixture(async (client, base, counters) => {
      let binding: { attemptId: string } | null = null;
      let debit = 0;
      client.setQuizRequestGuard!(
        createFirstQuizAttemptRequestGuard({
          targetUrl: `${base}/mod/quiz/view.php?id=7`,
          loadBinding: async () => binding,
          debitStartBeforeForward: async () => {
            if (debit++) throw new Error("private-account-canary");
          },
        }),
      );
      await client.open(`${base}/mod/quiz/view.php?id=7`);
      await client.click("#start");
      expect(counters.starts).toBe(1);
      expect(await client.getUrl()).toContain("attempt=31");
      binding = { attemptId: "31" };
      await client.evalJson(
        `(async()=>{await fetch('/mod/quiz/processattempt.php',{method:'POST',body:'attempt=31&finishattempt=0'});return JSON.stringify(true);})()`,
      );
      expect(counters.saves).toBe(1);
      await client.open(`${base}/mod/quiz/view.php?id=7`);
      await expect(client.click("#start")).rejects.toThrow("Quiz request blocked");
      expect(counters.starts).toBe(1);
    });
  });
});

describe("real browser with the persistent shared first-attempt debit", () => {
  const firstEvidence = {
    attemptsUsed: 0,
    hasActiveAttempt: false,
    canStartNewAttempt: true,
    availabilityStatus: "open",
  } as QuizMetadata;
  async function withLedger(
    base: string,
    run: (config: { ledgerRoot: string; targetUrl: string; accountKey: string }) => Promise<void>,
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-http-shared-ledger-"));
    try {
      await run({
        ledgerRoot: root,
        targetUrl: `${base}/mod/quiz/view.php?id=7`,
        accountKey: "broker-owned-fixture-account",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  it("allows exactly one POST across two concurrent browser workers sharing the account+quiz ledger", async () => {
    await browserFixture(async (first, base, counters) =>
      withLedger(base, async (ledger) => {
        await reserveFirstQuizAttempt(ledger, firstEvidence);
        const second = createPlaywrightBrowserClient({
          headless: true,
          baseUrl: base,
        } as MoodleRuntimeConfig);
        try {
          for (const client of [first, second])
            client.setQuizRequestGuard!(
              createFirstQuizAttemptRequestGuard({
                targetUrl: ledger.targetUrl,
                loadBinding: () => loadFirstQuizAttemptBinding(ledger),
                debitStartBeforeForward: () => consumeFirstQuizStartRequest(ledger),
              }),
            );
          await Promise.all([first, second].map((client) => client.open(ledger.targetUrl)));
          const results = await Promise.allSettled(
            [first, second].map((client) => client.click("#start")),
          );
          expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
          expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
          expect(counters.starts).toBe(1);
        } finally {
          await second.close();
        }
      }),
    );
  });

  it("does not resend a consumed start after a failed response and a fresh browser/guard instance", async () => {
    await browserFixture(
      async (first, base, counters) =>
        withLedger(base, async (ledger) => {
          await reserveFirstQuizAttempt(ledger, firstEvidence);
          const install = (client: typeof first) =>
            client.setQuizRequestGuard!(
              createFirstQuizAttemptRequestGuard({
                targetUrl: ledger.targetUrl,
                loadBinding: () => loadFirstQuizAttemptBinding(ledger),
                debitStartBeforeForward: () => consumeFirstQuizStartRequest(ledger),
              }),
            );
          install(first);
          await first.open(ledger.targetUrl);
          await first.click("#start");
          expect(counters.starts).toBe(1);
          const second = createPlaywrightBrowserClient({
            headless: true,
            baseUrl: base,
          } as MoodleRuntimeConfig);
          try {
            install(second);
            await second.open(ledger.targetUrl);
            await expect(second.click("#start")).rejects.toThrow("Quiz request blocked");
            expect(counters.starts).toBe(1);
          } finally {
            await second.close();
          }
        }),
      true,
    );
  });
});
