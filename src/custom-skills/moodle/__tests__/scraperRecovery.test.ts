import { mkdtemp, rm } from "node:fs/promises";
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
