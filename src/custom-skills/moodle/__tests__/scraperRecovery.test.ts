import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

const mocks = vi.hoisted(() => {
  const client = {
    open: vi.fn(),
    snapshot: vi.fn(),
    getUrl: vi.fn(),
    evalText: vi.fn(),
    fill: vi.fn(),
    click: vi.fn(),
    press: vi.fn(),
    wait: vi.fn(),
    download: vi.fn(),
    close: vi.fn(),
  };
  return {
    client,
    launch: vi.fn(),
    looksLikeAgentBrowserLoginPage: vi.fn(),
  };
});

vi.mock("../agentBrowserClient.js", () => ({
  createAgentBrowserClient: () => mocks.client,
}));

vi.mock("../browserAuth.js", () => ({
  dismissCommonOverlays: vi.fn(),
  ensureAgentBrowserLoggedIn: vi.fn(),
  ensureLoggedIn: vi.fn(),
  isAuthFailure: (message: string) => /login|auth/i.test(message),
  looksLikeAgentBrowserLoginPage: mocks.looksLikeAgentBrowserLoginPage,
  looksLikeLoginPage: vi.fn().mockResolvedValue(false),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: mocks.launch,
  },
}));

import { createScraperNode } from "../nodes/scraperNode.js";

const courseUrl = "https://moodle.example/course/view.php?id=32280";
const courseSnapshot = {
  origin: courseUrl,
  refs: {},
  snapshot: "- heading \"Maschinenelemente 1\"\n- text \"Toleranzen und Passungen\"",
};

describe("Moodle scraper timeout recovery", () => {
  let runDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-scraper-"));
    mocks.client.open.mockRejectedValue(new Error("Operation timed out"));
    mocks.client.getUrl.mockResolvedValue(courseUrl);
    mocks.client.evalText.mockResolvedValue("<html></html>");
    mocks.client.close.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.looksLikeAgentBrowserLoginPage.mockResolvedValue(false);
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("uses a Moodle snapshot that completed after agent-browser reported a timeout", async () => {
    mocks.client.snapshot.mockResolvedValue(courseSnapshot);
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        moodleUrl: courseUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
      }),
    )(moodleTestState());

    expect(result.moodle_raw_text).toContain("Maschinenelemente 1");
    expect(diagnostics.getCoverage().moodle).toMatchObject({
      status: "partial",
      pages: 1,
      urls: [courseUrl],
      failureKind: undefined,
    });
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("routes an already-discovered completed review through the read-only Study Builder adapter", async () => {
    const reviewUrl =
      "https://moodle.example/mod/quiz/review.php?attempt=42&cmid=7";
    mocks.client.open.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.client.getUrl.mockResolvedValue(reviewUrl);
    mocks.client.evalText.mockResolvedValue("Status: Beendet");
    mocks.client.snapshot.mockResolvedValue({
      origin: reviewUrl,
      refs: {},
      snapshot:
        '- heading "Review attempt" [ref=e1]\n- text "Question 1: Course-faithful evidence"',
    });
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        moodleUrl: reviewUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
        evidenceHandoffOnly: true,
        quizSafetyPolicy: {
          ...moodleTestConfig().quizSafetyPolicy,
          accessMode: "quiz-assist",
          allowStartingOrContinuingAttempts: true,
          allowSuggestingAnswers: true,
          allowFillingAnswers: true,
          allowChangingExistingAnswers: true,
          allowSavingMovingNext: true,
        },
      }),
    )(moodleTestState());

    expect(result.moodle_raw_text).toContain("Course-faithful evidence");
    expect(mocks.client.open).toHaveBeenCalledExactlyOnceWith(reviewUrl);
    expect(mocks.client.fill).not.toHaveBeenCalled();
    expect(mocks.client.click).not.toHaveBeenCalled();
    expect(mocks.client.press).not.toHaveBeenCalled();

    const audit = await readFile(
      path.join(runDir, "quiz-evidence-audit.json"),
      "utf8",
    );
    expect(audit).toContain('"open_completed_attempt_review"');
    expect(audit).toContain('"read_completed_attempt_review"');
    expect(audit).not.toContain(reviewUrl);
    expect(audit).not.toContain("Course-faithful evidence");
  });

  it("consumes a completed review discovered by the existing course crawl without a second crawl", async () => {
    const reviewUrl =
      "https://moodle.example/mod/quiz/review.php?attempt=42&cmid=7";
    mocks.client.open.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.client.getUrl.mockResolvedValue(reviewUrl);
    mocks.client.evalText.mockResolvedValue("State: Finished");
    mocks.client.snapshot
      .mockResolvedValueOnce({
        origin: courseUrl,
        refs: {
          "e-review": { role: "link", name: "Review attempt" },
        },
        snapshot: [
          '- heading "Maschinenelemente 1" [ref=e-course]',
          `- link "Review attempt" [ref=e-review, url=${reviewUrl}]`,
        ].join("\n"),
      })
      .mockResolvedValueOnce({
        origin: reviewUrl,
        refs: {},
        snapshot:
          '- heading "Review attempt" [ref=e1]\n- text "Completed question pattern"',
      });
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        prompt: "Create an interactive Study Guide",
        moodleUrl: courseUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
        maxDepth: 1,
        maxPages: 2,
        evidenceHandoffOnly: true,
      }),
    )(moodleTestState());

    expect(mocks.client.open.mock.calls.map(([url]) => url)).toEqual([
      courseUrl,
      reviewUrl,
    ]);
    expect(result.moodle_raw_text).toContain("Completed question pattern");
    expect(mocks.client.fill).not.toHaveBeenCalled();
    expect(mocks.client.click).not.toHaveBeenCalled();
    expect(mocks.client.press).not.toHaveBeenCalled();
  });

  it("does not read review contents when the opened attempt is still active", async () => {
    const reviewUrl =
      "https://moodle.example/mod/quiz/review.php?attempt=42&cmid=7";
    mocks.client.open.mockResolvedValue({ stdout: "", stderr: "" });
    mocks.client.getUrl.mockResolvedValue(reviewUrl);
    mocks.client.evalText.mockResolvedValue("State: In progress");
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        moodleUrl: reviewUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
        evidenceHandoffOnly: true,
      }),
    )(moodleTestState());

    expect(result.moodle_raw_text).toContain("opened-review-is-not-completed");
    expect(mocks.client.snapshot).not.toHaveBeenCalled();
    expect(mocks.client.fill).not.toHaveBeenCalled();
    expect(mocks.client.click).not.toHaveBeenCalled();
    expect(mocks.client.press).not.toHaveBeenCalled();
  });

  it("blocks direct attempt navigation even when the legacy global policy permits it", async () => {
    const attemptUrl =
      "https://moodle.example/mod/quiz/attempt.php?attempt=42&cmid=7";
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        moodleUrl: attemptUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
        evidenceHandoffOnly: true,
        quizPolicy: {
          ...moodleTestConfig().quizPolicy,
          allowAttemptOpen: true,
          allowQuestionRead: true,
          allowAnswerFill: true,
          allowAnswerChange: true,
          allowSaveOrMovePage: true,
        },
      }),
    )(moodleTestState());

    expect(result.moodle_raw_text).toContain(
      "completed-attempt reviews are read-only",
    );
    expect(mocks.client.open).not.toHaveBeenCalled();
    expect(mocks.client.fill).not.toHaveBeenCalled();
    expect(mocks.client.click).not.toHaveBeenCalled();
    expect(mocks.client.press).not.toHaveBeenCalled();
  });

  it("counts a successful Playwright fallback as a recovered Moodle page", async () => {
    mocks.client.snapshot.mockResolvedValue({
      ...courseSnapshot,
      origin: "https://moodle.example/my",
    });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue("Maschinenelemente 1"),
      url: vi.fn().mockReturnValue(courseUrl),
      locator: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue("Toleranzen und Passungen"),
      }),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue(page),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mocks.launch.mockResolvedValue(browser);
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        moodleUrl: courseUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
      }),
    )(moodleTestState());

    expect(result.moodle_raw_text).toContain("Toleranzen und Passungen");
    expect(diagnostics.getCoverage().moodle).toMatchObject({
      status: "partial",
      pages: 1,
      urls: [courseUrl],
      failureKind: undefined,
    });
    expect(mocks.launch).toHaveBeenCalledOnce();
  });

  it("reports a timeout when neither browser path recovers Moodle content", async () => {
    mocks.client.snapshot.mockResolvedValue({
      ...courseSnapshot,
      origin: "https://moodle.example/my",
    });
    mocks.launch.mockRejectedValue(new Error("Browser unavailable"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();

    const result = await createScraperNode(
      moodleTestConfig({
        browserBackend: "agent-browser",
        diagnostics,
        moodleUrl: courseUrl,
        dashboardUrl: "https://moodle.example/my",
        runDir,
      }),
    )(moodleTestState());

    expect(result.moodle_raw_text).toContain("Playwright diagnostic fallback failed");
    expect(diagnostics.getCoverage().moodle).toMatchObject({
      status: "timeout",
      pages: 0,
      failureKind: "timeout",
    });
  });
});
