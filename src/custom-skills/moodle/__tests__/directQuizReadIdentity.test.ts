import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { executeDirectQuiz, type DirectQuizDependencies } from "../directQuiz.js";
import type { AgentBrowserClient } from "../interactive/agentBrowserClient.js";
import { readFirstQuizAttemptIdentity } from "../interactive/quizAttemptReadApi.js";
import { normalizeQuizMetadata } from "../interactive/quizSafetyPolicy.js";

const target = "https://university.example/mod/quiz/view.php?id=7";
let workspace: string;
let env: NodeJS.ProcessEnv;
let deps: DirectQuizDependencies;
let requests: string[];
let lookup: Mock<typeof readFirstQuizAttemptIdentity>;
let course: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "direct-read-identity-"));
  env = {
    STUDY_BUDDY_BROKER_EXECUTION: "1", STUDY_BUDDY_WORKSPACE: workspace,
    STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "read-owner", STUDY_BUDDY_WORKSPACE_KIND: "project",
    MOODLE_BASE_URL: "https://university.example", MOODLE_USERNAME: "dummy-user",
    MOODLE_PASSWORD: "private-dummy-password", MOODLE_QUIZ_ACCESS_MODE: "quiz-assist",
    STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT: path.join(workspace, "ledger"),
  };
  requests = [];
  course = vi.fn().mockResolvedValue(42);
  lookup = vi.fn<typeof readFirstQuizAttemptIdentity>().mockResolvedValue({ ok: true, identityEvidence: {
    source: "moodle-mobile-read-api", courseId: 42, courseModuleId: 7, quizId: 9,
    userId: 11, attemptId: "123", attemptNumber: 1, state: "inprogress", preview: false,
  } });
  const browser = {
    setQuizRequestGuard: vi.fn(), secureLogin: vi.fn().mockResolvedValue(undefined),
    open: async (url: string) => { requests.push(url); return { stdout: "", stderr: "" }; },
    getUrl: async () => target, getTitle: async () => "Existing first quiz",
    evalJson: course, close: async () => ({ stdout: "", stderr: "" }),
  } as unknown as AgentBrowserClient;
  deps = {
    browser: () => browser, readIdentity: lookup,
    metadata: async () => ({ ...normalizeQuizMetadata({
      attemptsUsed: 1, attemptsAllowed: 2, hasActiveAttempt: true, availabilityStatus: "open",
    }), activeAttemptId: null, activeAttemptNumber: null,
      identityEvidence: { currentAttemptId: null, history: [{ ordinal: 1, attemptId: null, source: "history-card" }], continuation: [] },
    }),
  };
});
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

it("status resolves a native ID-less first card without starting or binding an attempt", async () => {
  const initial = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  expect(lookup).toHaveBeenCalledTimes(1);
  const result = await executeDirectQuiz({ op: "status", runDir: initial.runDir }, env, deps);
  expect(result.metadata).toMatchObject({ activeAttemptId: "123", activeAttemptNumber: 1 });
  expect(result.identityLookup).toMatchObject({ status: "verified" });
  expect(result.firstAttemptBound).toBe(false);
  expect(requests).toEqual([target, target]);
  const proof = await readFile(path.join(String(initial.runDir), "first-attempt-read-identity.json"), "utf8");
  expect(proof).toContain('"attemptId":"123"');
  expect(JSON.stringify(result) + proof).not.toContain("private-dummy-password");
});

it("inspection identifies the existing first before creating its approval request", async () => {
  env.MOODLE_QUIZ_ACCESS_MODE = "ask-before-attempt";
  const result = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  expect(result.metadata).toMatchObject({ activeAttemptId: "123", activeAttemptNumber: 1 });
  expect(result.decision).toMatchObject({ status: "permission_required", reason: "quiz-attempt-needs-confirmation" });
  expect(result.identityLookup).toMatchObject({ status: "verified" });
  const pending = JSON.parse(await readFile(String(result.permissionRequestPath), "utf8"));
  expect(pending).toBeTruthy();
  expect(requests).toEqual([target]);
  expect(JSON.stringify(result) + JSON.stringify(pending)).not.toContain("private-dummy-password");
});

it("reports a disabled service clearly while retaining the unknown identity", async () => {
  lookup.mockResolvedValue({ ok: false, error: "mobile-service-disabled" });
  const initial = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  const result = await executeDirectQuiz({ op: "status", runDir: initial.runDir }, env, deps);
  expect(result.metadata).toMatchObject({ activeAttemptId: null, activeAttemptNumber: null });
  expect(result.identityLookup).toMatchObject({ reason: "mobile-service-disabled" });
  expect(result.firstAttemptBound).toBe(false);
  expect(requests).toEqual([target, target]);
});

it("does not authenticate the API without a consistent native course identity", async () => {
  course.mockResolvedValue(null);
  const initial = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  const result = await executeDirectQuiz({ op: "status", runDir: initial.runDir }, env, deps);
  expect(lookup).not.toHaveBeenCalled();
  expect(result.identityLookup).toMatchObject({ reason: "native-course-identity-unavailable" });
});

it("does not query an ambiguous first history card", async () => {
  const original = deps.metadata!;
  deps.metadata = async (client) => { const metadata = await original(client); return {
    ...metadata, identityEvidence: { currentAttemptId: null, continuation: [], history: [
      { ordinal: 1, attemptId: null, source: "history-card" as const },
      { ordinal: 2, attemptId: null, source: "history-card" as const },
    ] },
  }; };
  const initial = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  const result = await executeDirectQuiz({ op: "status", runDir: initial.runDir }, env, deps);
  expect(lookup).not.toHaveBeenCalled();
  expect(result.firstAttemptBound).toBe(false);
});
