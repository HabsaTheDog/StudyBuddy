import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";
import type { StudyBuddyIntentDecision } from "../taskIntent.js";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  ensureLoggedIn: vi.fn(),
  dismissCommonOverlays: vi.fn(),
  extractReadableFileText: vi.fn().mockResolvedValue("Exam information"),
}));

vi.mock("playwright", () => ({
  chromium: { launch: mocks.launch },
}));

vi.mock("../browserAuth.js", () => ({
  ensureLoggedIn: mocks.ensureLoggedIn,
  dismissCommonOverlays: mocks.dismissCommonOverlays,
  isAuthFailure: () => false,
  looksLikeLoginPage: vi.fn().mockResolvedValue(false),
}));

vi.mock("../fileTextExtraction.js", () => ({
  extractReadableFileText: mocks.extractReadableFileText,
}));

import { createCisScraperNode } from "../nodes/cisScraperNode.js";

describe("CIS scraper task bounds", () => {
  let runDir: string;
  let goto: ReturnType<typeof vi.fn>;
  let requestGet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-cis-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("opens direct LV schedule pages first and applies the schedule CIS page budget", async () => {
    installBrowser([]);
    const config = moodleTestConfig({
      prompt: "When is the next exam?",
      runDir,
      maxCisPages: 8,
      cisBaseUrl: "https://cis.example",
      cisDashboardUrl: "https://cis.example/cis.php/Cis4",
      cisUrls: ["https://cis.example/cis.php/GenericDashboard"],
      intentDecision: decision("schedule_answer"),
    });

    await createCisScraperNode(config)(moodleTestState());

    expect(mocks.ensureLoggedIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetUrl: "https://cis.example/cis.php/Cis/MyLvPlan" }),
    );
    expect(goto.mock.calls.map(([url]) => url)).toEqual([
      "https://cis.example/cis.php/Cis/MyLvPlan",
      "https://cis.example/cis.php/Cis/MyLv",
      "https://cis.example/cis.php/GenericDashboard",
    ]);
  });

  it("downloads at most one schedule-relevant document and ignores arbitrary files", async () => {
    installBrowser([
      { href: "https://cis.example/files/lecture-notes.pdf", label: "Lecture notes" },
      { href: "https://cis.example/files/pruefungsinformation.pdf", label: "Prüfungsinformation" },
      { href: "https://cis.example/files/termine.pdf", label: "Weitere Termine" },
    ]);
    const config = moodleTestConfig({
      prompt: "Check the exam date",
      runDir,
      maxCisPages: 8,
      allowFileDownloads: true,
      cisBaseUrl: "https://cis.example",
      cisUrls: ["https://cis.example/cis.php/GenericDashboard"],
      intentDecision: decision("schedule_answer"),
    });

    await createCisScraperNode(config)(moodleTestState());

    expect(requestGet).toHaveBeenCalledOnce();
    expect(requestGet).toHaveBeenCalledWith(
      "https://cis.example/files/pruefungsinformation.pdf",
    );
  });

  it("preserves configured-first seed ordering and page limits for non-schedule work", async () => {
    installBrowser([]);
    const config = moodleTestConfig({
      prompt: "Summarize course information",
      runDir,
      maxCisPages: 4,
      cisBaseUrl: "https://cis.example",
      cisUrls: ["https://cis.example/cis.php/GenericDashboard"],
      intentDecision: decision("quick_answer"),
    });

    await createCisScraperNode(config)(moodleTestState());

    expect(mocks.ensureLoggedIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetUrl: "https://cis.example/cis.php" }),
    );
    expect(goto.mock.calls.map(([url]) => url)).toEqual([
      "https://cis.example/cis.php/GenericDashboard",
      "https://cis.example/cis.php/Cis/MyLvPlan",
      "https://cis.example/cis.php/Cis/MyLv",
      "https://cis.example/cis.php/Cis4",
    ]);
  });

  function installBrowser(links: Array<{ href: string; label: string }>) {
    let currentUrl = "https://cis.example/cis.php";
    goto = vi.fn(async (url: string) => {
      currentUrl = url;
    });
    requestGet = vi.fn().mockResolvedValue({
      ok: () => true,
      body: () => Promise.resolve(Buffer.from("PDF")),
    });
    const page = {
      goto,
      title: vi.fn().mockResolvedValue("CIS"),
      url: vi.fn(() => currentUrl),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn((selector: string) => selector === "body"
        ? { innerText: vi.fn().mockResolvedValue("Exam schedule for the requested course") }
        : { evaluateAll: vi.fn().mockResolvedValue(links) }),
      context: vi.fn(() => ({ request: { get: requestGet } })),
    };
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      request: { get: requestGet },
    };
    mocks.launch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    });
  }
});

function decision(intent: StudyBuddyIntentDecision["intent"]): StudyBuddyIntentDecision {
  return {
    intent,
    wantsPdf: false,
    wantsTypstDocument: false,
    wantsQuickAnswer: intent === "schedule_answer" || intent === "quick_answer",
    wantsQuizAssistance: false,
    needsMoodle: false,
    needsCis: true,
    needsCalendar: false,
    needsCourseMaterial: false,
    needsDownloadedFiles: false,
    reason: "test",
  };
}
