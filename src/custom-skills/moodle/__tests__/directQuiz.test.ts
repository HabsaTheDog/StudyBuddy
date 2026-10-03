import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeDirectQuiz, type DirectQuizDependencies } from "../directQuiz.js";
import { normalizeQuizMetadata } from "../interactive/quizSafetyPolicy.js";
import type { AgentBrowserClient } from "../interactive/agentBrowserClient.js";
import type { QuizPageExtraction } from "../interactive/nodes/quizReviewNode.js";

const target = "https://university.example/mod/quiz/view.php?id=7";
const attempt = "https://university.example/mod/quiz/attempt.php?attempt=123&page=0";
const summary = "https://university.example/mod/quiz/summary.php?attempt=123";
let workspace: string, env: NodeJS.ProcessEnv;
let currentUrl: string, domValue: string, serverValue: string, active: boolean;
let metadata: ReturnType<typeof normalizeQuizMetadata>;
let deps: DirectQuizDependencies;
let requests: Array<{ url: string; method: string }>;
let guard: (request: {
  url: string;
  method: string;
  postData: string | null;
  redirectedFrom?: { url: string; method: string };
}) => void | Promise<void>;
let operations: { starts: number; fills: number; saves: number; closes: number };
const answer = {
  question_id: "question-1-1",
  confidence: 0.95,
  citations: ["Visible question: 2+2"],
  control_answers: [{ control_id: "answer-1", answer: "4", selected: false }],
};
function page(): QuizPageExtraction {
  return {
    title: "Actual quiz",
    url: currentUrl,
    body_text: "Time remaining changes",
    questions: currentUrl.includes("/attempt.php")
      ? [
          {
            question_id: "question-1-1",
            question_index: 1,
            question_type: "shortanswer",
            prompt: "2+2?",
            options: [],
            visible_context: "Actual question",
            controls: [
              {
                control_id: "answer-1",
                id: "answer-1",
                tag: "input",
                type: "text",
                value: domValue,
                disabled: false,
              },
            ],
            response_model: { support: "native", kind: "text" } as any,
          },
        ]
      : [],
  };
}
beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "direct-quiz-test-"));
  env = {
    STUDY_BUDDY_BROKER_EXECUTION: "1",
    STUDY_BUDDY_WORKSPACE: workspace,
    STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "owner-a",
    STUDY_BUDDY_WORKSPACE_KIND: "project",
    MOODLE_BASE_URL: "https://university.example",
    MOODLE_USERNAME: "account",
    MOODLE_PASSWORD: "secret",
    MOODLE_QUIZ_ACCESS_MODE: "quiz-assist",
    STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT: path.join(workspace, "ledger"),
  };
  currentUrl = target;
  domValue = "";
  serverValue = "";
  active = false;
  requests = [];
  metadata = normalizeQuizMetadata({
    availabilityStatus: "open",
    attemptsUsed: 0,
    attemptsAllowed: 3,
    canStartNewAttempt: true,
  });
  operations = { starts: 0, fills: 0, saves: 0, closes: 0 };
  const client = {
    setQuizRequestGuard: (value: typeof guard) => {
      guard = value;
    },
    secureLogin: async () => {},
    open: async (url: string) => {
      await guard({ url, method: "GET", postData: null });
      requests.push({ url, method: "GET" });
      currentUrl = url;
      domValue = serverValue;
      return { stdout: "", stderr: "" };
    },
    getUrl: async () => currentUrl,
    getTitle: async () => "Actual native quiz",
    close: async () => {
      operations.closes++;
      return { stdout: "", stderr: "" };
    },
  } as unknown as AgentBrowserClient;
  deps = {
    browser: () => client,
    metadata: async () => ({
      ...metadata,
      ...(active
        ? {
            hasActiveAttempt: true,
            attemptsUsed: 1,
            activeAttemptNumber: 1,
            activeAttemptId: "123",
            canStartNewAttempt: false,
          }
        : {}),
    }),
    extract: async () => structuredClone(page()),
    navigation: async () => "single-page",
    start: async () => {
      operations.starts++;
      const url = "https://university.example/mod/quiz/startattempt.php";
      await guard({ url, method: "POST", postData: "cmid=7&sesskey=token" });
      await guard({
        url: attempt,
        method: "GET",
        postData: null,
        redirectedFrom: { url, method: "POST" },
      });
      currentUrl = attempt;
      active = true;
      return { clicked: true, started: true };
    },
    fill: async () => {
      operations.fills++;
      domValue = "4";
      return { filled: true };
    },
    next: async () => {
      operations.saves++;
      serverValue = domValue;
      currentUrl = summary;
      return { clicked: true, kind: "attempt_summary" };
    },
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workspace, { recursive: true, force: true });
});
async function start() {
  const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  return executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps);
}
describe("direct deterministic quiz owner tools", () => {
  it("inspects metadata without starting, solving, or capturing an attempt", async () => {
    const result = await executeDirectQuiz(
      { op: "inspect", url: target, prompt: "Inspect exact quiz" },
      env,
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      title: "Actual native quiz",
      untrusted: true,
      metadata: { attemptsUsed: 0 },
    });
    expect(operations).toEqual({ starts: 0, fills: 0, saves: 0, closes: 1 });
    expect(requests).toEqual([{ url: target, method: "GET" }]);
  });
  it("starts only the first attempt and exposes packets; fills provided native answers, saves and verifies after fresh reload", async () => {
    const started = await start();
    expect(started).toMatchObject({
      ok: true,
      attemptUrl: attempt,
      packets: [{ question_id: "question-1-1" }],
    });
    const packet = JSON.parse(await readFile((started.packets as any[])[0].packetPath, "utf8"));
    expect(packet.question.prompt).toBe("2+2?");
    const filled = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(filled).toMatchObject({
      ok: true,
      persisted: true,
      checks: [{ verified: true }],
      finalSubmitClicked: false,
    });
    expect(operations).toMatchObject({ starts: 1, fills: 1, saves: 1 });
    const next = await executeDirectQuiz({ op: "next", runDir: started.runDir }, env, deps);
    expect(next).toMatchObject({ ok: true, status: "summary", attemptUrl: summary });
    expect(operations.starts).toBe(1);
  });
  it("resumes exact bound attempt after a new invocation without ever clicking start again", async () => {
    const first = await start();
    const recovered = await executeDirectQuiz({ op: "recover", runDir: first.runDir }, env, deps);
    expect(recovered.attemptUrl).toBe(attempt);
    expect(operations.starts).toBe(1);
    await executeDirectQuiz({ op: "start", runDir: first.runDir }, env, deps);
    expect(operations.starts).toBe(1);
  });
  it("rejects a replacement start after lost first response; reservation survives failure", async () => {
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    deps.start = async () => {
      operations.starts++;
      throw Error("connection lost");
    };
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("connection lost");
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("already reserved");
    expect(operations.starts).toBe(1);
  });
  it("recovers a positively identified active first attempt after losing its start response without a second POST", async () => {
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    const realStart = deps.start!;
    deps.start = async (client, options) => {
      await realStart(client, options);
      throw Error("response lost");
    };
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("response lost");
    expect(
      (await executeDirectQuiz({ op: "recover", runDir: inspected.runDir }, env, deps)).ok,
    ).toBe(true);
    expect(operations.starts).toBe(1);
  });
  it("requires actual overview ordinal and rejects a concurrent external second-attempt identity", async () => {
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    const meta = deps.metadata!;
    deps.metadata = async (client) => ({
      ...(await meta(client)),
      ...(active ? { attemptsUsed: 2, activeAttemptNumber: 2, activeAttemptId: "123" } : {}),
    });
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("exact active first attempt");
    await expect(
      executeDirectQuiz({ op: "recover", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("active-identity-unconfirmed");
    expect(operations.starts).toBe(1);
  });
  it("recovers a dead process lock, while active and initializing locks remain blocked", async () => {
    const started = await start(),
      file = path.join(started.runDir as string, ".operation-lock");
    await writeFile(file, JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() }));
    await expect(
      executeDirectQuiz({ op: "recover", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("Another operation");
    await writeFile(file, "");
    await expect(
      executeDirectQuiz({ op: "recover", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("Another operation");
    const dead = await promisify(execFile)(process.execPath, [
      "-e",
      "process.stdout.write(String(process.pid))",
    ]);
    await writeFile(
      file,
      JSON.stringify({ version: 1, pid: Number(dead.stdout), token: randomUUID() }),
    );
    expect((await executeDirectQuiz({ op: "recover", runDir: started.runDir }, env, deps)).ok).toBe(
      true,
    );
    expect(operations.starts).toBe(1);
  });
  it("requires broker approval rather than accepting a pending request path as self-approval", async () => {
    env.MOODLE_QUIZ_ACCESS_MODE = "ask-before-attempt";
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    expect(inspected.permissionRequestPath).toBeTruthy();
    await expect(
      executeDirectQuiz(
        {
          op: "start",
          runDir: inspected.runDir,
          permissionRequestPath: inspected.permissionRequestPath,
        },
        env,
        deps,
      ),
    ).rejects.toThrow("broker has not approved");
    const pending = JSON.parse(await readFile(inspected.permissionRequestPath as string, "utf8"));
    env.STUDY_BUDDY_QUIZ_APPROVED_REQUEST_IDS = JSON.stringify([pending.requestId]);
    const started = await executeDirectQuiz(
      {
        op: "start",
        runDir: inspected.runDir,
        permissionRequestPath: inspected.permissionRequestPath,
      },
      env,
      deps,
    );
    expect(started.ok).toBe(true);
    await expect(
      executeDirectQuiz({ op: "read", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("permission_required");
    expect(
      (
        await executeDirectQuiz(
          {
            op: "read",
            runDir: started.runDir,
            permissionRequestPath: inspected.permissionRequestPath,
          },
          env,
          deps,
        )
      ).ok,
    ).toBe(true);
  });
  it("never broadens Review Only with an approved request", async () => {
    env.MOODLE_QUIZ_ACCESS_MODE = "ask-before-attempt";
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    const pending = JSON.parse(await readFile(inspected.permissionRequestPath as string, "utf8"));
    env.STUDY_BUDDY_QUIZ_APPROVED_REQUEST_IDS = JSON.stringify([pending.requestId]);
    env.MOODLE_QUIZ_ACCESS_MODE = "review-only";
    await expect(
      executeDirectQuiz(
        {
          op: "start",
          runDir: inspected.runDir,
          permissionRequestPath: inspected.permissionRequestPath,
        },
        env,
        deps,
      ),
    ).rejects.toThrow("Review-only");
    expect(operations.starts).toBe(0);
  });
  it.each([
    "https://other.example/mod/quiz/view.php?id=7",
    target + "&sesskey=x",
    "https://university.example/mod/quiz/startattempt.php",
    attempt,
  ])("rejects unsafe inspect target %s before browser launch", async (url) => {
    const browser = vi.fn(deps.browser);
    deps.browser = browser;
    await expect(executeDirectQuiz({ op: "inspect", url }, env, deps)).rejects.toThrow();
    expect(browser).not.toHaveBeenCalled();
  });
  it("rejects stale packet and incomplete controls before mutating the page", async () => {
    const started = await start();
    await expect(
      executeDirectQuiz(
        { op: "fill", runDir: started.runDir, packetDigest: "stale", answers: [answer] },
        env,
        deps,
      ),
    ).rejects.toThrow("stale");
    await expect(
      executeDirectQuiz(
        {
          op: "fill",
          runDir: started.runDir,
          packetDigest: started.packetDigest,
          answers: [
            {
              ...answer,
              control_answers: [{ ...answer.control_answers[0], control_id: "foreign" }],
            },
          ],
        },
        env,
        deps,
      ),
    ).rejects.toThrow("exact current");
    expect(operations.fills).toBe(0);
  });
  it("does not claim persistence when saved responses disappear after reload", async () => {
    const started = await start();
    deps.next = async () => {
      operations.saves++;
      currentUrl = summary;
      return { clicked: true, kind: "attempt_summary" };
    };
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({ ok: false, persisted: false });
    await expect(
      executeDirectQuiz({ op: "next", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("verified after");
  });
  it("never advances unknown/sequential navigation with empty or unverified answers", async () => {
    deps.navigation = async () => "unknown";
    const started = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: "manual_action_required" });
    expect(operations.fills).toBe(0);
    expect(operations.saves).toBe(0);
    await expect(
      executeDirectQuiz({ op: "next", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("verified after");
    await expect(
      executeDirectQuiz({ op: "read", runDir: started.runDir, page: 1 }, env, deps),
    ).rejects.toThrow("arbitrary page");
  });
  it("rejects absent broker, foreign owner, run path escape and state symlink", async () => {
    await expect(
      executeDirectQuiz(
        { op: "inspect", url: target },
        { ...env, STUDY_BUDDY_BROKER_EXECUTION: "0" },
        deps,
      ),
    ).rejects.toThrow("broker");
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    await expect(
      executeDirectQuiz(
        { op: "status", runDir: inspected.runDir },
        { ...env, STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "foreign" },
        deps,
      ),
    ).rejects.toThrow();
    await expect(executeDirectQuiz({ op: "status", runDir: workspace }, env, deps)).rejects.toThrow(
      "outside",
    );
    const file = path.join(inspected.runDir as string, "direct-quiz.json"),
      sentinel = path.join(workspace, "external.json");
    await writeFile(sentinel, "private-sentinel");
    await rm(file);
    await symlink(sentinel, file);
    await expect(
      executeDirectQuiz({ op: "status", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("symlinks");
    expect(await readFile(sentinel, "utf8")).toBe("private-sentinel");
  });
  it("rejects injected policy/browser/eval fields and final-submit operations", async () => {
    for (const input of [
      { op: "inspect", url: target, policy: { allowStartingOrContinuingAttempts: true } },
      { op: "eval", script: "anything" },
      { op: "submit", runDir: workspace },
    ])
      await expect(executeDirectQuiz(input, env, deps)).rejects.toThrow();
    expect(operations.starts).toBe(0);
  });
});
