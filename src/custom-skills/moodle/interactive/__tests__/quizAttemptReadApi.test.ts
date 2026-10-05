import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { readFirstQuizAttemptIdentity } from "../quizAttemptReadApi.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});
const target = {
  targetUrl: "https://portal.example/campus/mod/quiz/view.php?id=92",
  courseId: 7,
  username: "user-canary",
  password: "password-canary",
};
const token = "private-token-canary";
const methods = ["mod_quiz_get_quizzes_by_courses", "mod_quiz_get_user_quiz_attempts"];
const goodAttempt = {
  id: 31,
  quiz: 9,
  userid: 42,
  attempt: 1,
  preview: 0,
  state: "inprogress",
  currentpage: 0,
};

async function fixture(
  options: {
    legacy?: boolean;
    response?: (stage: string) => unknown;
    handle?: (stage: string, response: ServerResponse) => boolean;
  } = {},
) {
  const calls: Array<{
    path: string;
    method: string;
    params: URLSearchParams;
    redirect: RequestRedirect | undefined;
  }> = [];
  let unexpected = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    for await (const part of request) body += part;
    const params = new URLSearchParams(body);
    const path = request.url ?? "";
    const stage =
      path === "/campus/login/token.php" ? "token" : (params.get("wsfunction") ?? "unknown");
    calls.push({ path, method: request.method ?? "", params, redirect: "error" });
    const available = options.legacy ? [methods[0], "mod_quiz_get_user_attempts"] : methods;
    const values: Record<string, unknown> = {
      token: { token, privatetoken: "private-other-canary" },
      core_webservice_get_site_info: { userid: 42, functions: available.map((name) => ({ name })) },
      mod_quiz_get_quizzes_by_courses: {
        quizzes: [{ id: 9, course: 7, coursemodule: 92 }],
        warnings: [],
      },
      mod_quiz_get_user_quiz_attempts: { attempts: [goodAttempt], warnings: [] },
      mod_quiz_get_user_attempts: { attempts: [goodAttempt], warnings: [] },
    };
    if (options.handle?.(stage, response)) return;
    if (
      !(stage in values) ||
      request.method !== "POST" ||
      !["/campus/login/token.php", "/campus/webservice/rest/server.php"].includes(path)
    )
      unexpected++;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(options.response?.(stage) ?? values[stage] ?? { error: "unexpected" }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  disposals.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Only this explicit test dependency maps the strictly HTTPS production target to loopback.
  const fetch: typeof globalThis.fetch = (input, init) => {
    expect(init?.redirect).toBe("error");
    return globalThis.fetch(new URL(new URL(String(input)).pathname, local), init);
  };
  return { calls, fetch, unexpected: () => unexpected };
}

describe("read-only first quiz identity API", () => {
  it.each([false, true])(
    "resolves the exact own first attempt through real HTTP, legacy=%s, without a mutation endpoint",
    async (legacy) => {
      const f = await fixture({ legacy });
      const result = await readFirstQuizAttemptIdentity(target, { fetch: f.fetch });
      expect(result).toEqual({
        ok: true,
        identityEvidence: {
          source: "moodle-mobile-read-api",
          courseId: 7,
          courseModuleId: 92,
          quizId: 9,
          userId: 42,
          attemptId: "31",
          attemptNumber: 1,
          state: "inprogress",
          preview: false,
        },
      });
      expect(f.calls).toHaveLength(4);
      expect(f.unexpected()).toBe(0);
      expect(f.calls[0]!.params.get("service")).toBe("moodle_mobile_app");
      expect(f.calls[0]!.params.get("password")).toBe(target.password);
      expect(
        f.calls.slice(1).every((c) => c.params.get("wstoken") === token && c.method === "POST"),
      ).toBe(true);
      expect(f.calls[2]!.params.get("courseids[0]")).toBe("7");
      expect(f.calls[3]!.params.get("userid")).toBe("0");
      expect(f.calls[3]!.params.get("status")).toBe("unfinished");
      expect(f.calls[3]!.params.get("includepreviews")).toBe("0");
      expect(JSON.stringify(result)).not.toMatch(/canary|password|privatetoken|wstoken/);
    },
  );

  it.each(["enablewsdescription", "servicenotavailable"])(
    "stops at disabled service %s without exposing error text/token",
    async (errorcode) => {
      const f = await fixture({
        response: (stage) =>
          stage === "token"
            ? { errorcode, error: "service-disabled password-canary", token }
            : undefined,
      });
      const result = await readFirstQuizAttemptIdentity(target, { fetch: f.fetch });
      expect(result).toEqual({ ok: false, error: "mobile-service-disabled" });
      expect(f.calls).toHaveLength(1);
    },
  );

  it("stops at an authentication error even if the payload also contains a token", async () => {
    const f = await fixture({
      response: (stage) =>
        stage === "token"
          ? { errorcode: "invalidlogin", message: target.password, token }
          : undefined,
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "mobile-authentication-unavailable",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("refuses a malformed token before REST calls", async () => {
    const f = await fixture({
      response: (stage) => (stage === "token" ? { token: { secret: token } } : undefined),
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "mobile-authentication-unavailable",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("does not follow an authentication redirect or retry", async () => {
    const f = await fixture({
      handle: (stage, response) => {
        if (stage !== "token") return false;
        response.writeHead(302, { location: "/outside-secret" });
        response.end();
        return true;
      },
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "read-api-transport-error",
    });
    expect(f.calls).toHaveLength(1);
  });

  it.each(
    [
      [{ ...goodAttempt, attempt: 2 }],
      [{ ...goodAttempt, userid: 99 }],
      [{ ...goodAttempt, quiz: 88 }],
      [{ ...goodAttempt, state: "overdue" }],
      [{ ...goodAttempt, preview: 1 }],
      [{ ...goodAttempt, id: 0 }],
      [goodAttempt, { ...goodAttempt, id: 32 }],
      [goodAttempt, goodAttempt],
      [],
    ].map((attempts) => ({ attempts })),
  )(
    "does not manufacture identity from invalid/conflicting attempts $attempts",
    async ({ attempts }) => {
      const f = await fixture({
        response: (stage) =>
          stage.startsWith("mod_quiz_get_user_") ? { attempts, warnings: [] } : undefined,
      });
      expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
        ok: false,
        error: "first-attempt-identity-unconfirmed",
      });
      expect(f.calls).toHaveLength(4);
      expect(f.unexpected()).toBe(0);
    },
  );

  it("refuses unavailable read methods rather than falling back to a start API", async () => {
    const f = await fixture({
      response: (stage) =>
        stage === "core_webservice_get_site_info"
          ? { userid: 42, functions: [{ name: "mod_quiz_start_attempt" }] }
          : undefined,
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "read-api-method-unavailable",
    });
    expect(f.calls).toHaveLength(2);
  });

  it("requires exact course-module resolution and refuses duplicates", async () => {
    const f = await fixture({
      response: (stage) =>
        stage === methods[0]
          ? {
              quizzes: [
                { id: 9, course: 7, coursemodule: 92 },
                { id: 10, course: 7, coursemodule: 92 },
              ],
            }
          : undefined,
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "read-api-quiz-unconfirmed",
    });
    expect(f.calls).toHaveLength(3);
  });

  it("requires the authenticated current user even when the single attempt looks valid", async () => {
    const f = await fixture({
      response: (stage) =>
        stage === "core_webservice_get_site_info"
          ? { functions: methods.map((name) => ({ name })) }
          : undefined,
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "first-attempt-identity-unconfirmed",
    });
    expect(f.calls).toHaveLength(2);
  });

  it("redacts REST errors and never proceeds after a service failure", async () => {
    const f = await fixture({
      response: (stage) =>
        stage === methods[0]
          ? { exception: "failure", message: token, errorcode: "accessdenied" }
          : undefined,
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "read-api-service-unavailable",
    });
    expect(f.calls).toHaveLength(3);
  });

  it("bounds a streamed oversized response and keeps its secrets out of output", async () => {
    const f = await fixture({
      handle: (stage, response) => {
        if (stage !== "token") return false;
        response.writeHead(200, { "content-type": "application/json" });
        response.end('"' + token.repeat(100000) + '"');
        return true;
      },
    });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch })).toEqual({
      ok: false,
      error: "read-api-response-too-large",
    });
    expect(f.calls).toHaveLength(1);
  });

  it("bounds a stalled response without retries", async () => {
    const f = await fixture({ handle: () => true });
    expect(await readFirstQuizAttemptIdentity(target, { fetch: f.fetch, timeoutMs: 100 })).toEqual({
      ok: false,
      error: "read-api-timeout",
    });
    expect(f.calls).toHaveLength(1);
  });

  it.each([
    "http://portal.example/mod/quiz/view.php?id=92",
    "https://user:secret@portal.example/mod/quiz/view.php?id=92",
    "https://portal.example/mod/quiz/startattempt.php?id=92",
    "https://portal.example/mod/quiz/view.php?id=92&attempt=31",
  ])("refuses untrusted target before authentication %s", async (targetUrl) => {
    const f = await fixture();
    expect(
      await readFirstQuizAttemptIdentity({ ...target, targetUrl }, { fetch: f.fetch }),
    ).toEqual({ ok: false, error: "read-api-target-invalid" });
    expect(f.calls).toHaveLength(0);
  });
});
