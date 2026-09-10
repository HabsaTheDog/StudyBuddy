import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";
import { createSourceOrchestratorNode, createSourcePlannerNode } from "../sourceOrchestrator.js";
import { initialAgentState } from "../state.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("sourceOrchestrator", () => {
  it("finishes the calendar read before starting an exhaustive Moodle obligation audit", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const prompt = "Was muss ich nächste Woche in allen Kursen erledigen?";
    const config = moodleTestConfig({
      runDir,
      prompt,
      calendarUrl: "https://calendar.example/private-token",
      diagnostics,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: true,
        hasCisUrls: true,
        hasCalendarUrl: true,
      }),
    });
    await createSourcePlannerNode(config)();
    const order: string[] = [];
    await createSourceOrchestratorNode(config, {
      calendarNode: async () => {
        order.push("calendar:start");
        config.calendarSelection = {
          status: "success",
          events: [{
            source: "calendar_event",
            uid: "robotics",
            title: "Robotics Lab",
            start: "2026-09-07T08:00:00.000Z",
            end: "2026-09-07T10:00:00.000Z",
            allDay: false,
            recurring: false,
          }],
          complete: true,
          missingFields: [],
          needsCisFallback: false,
          detail: "Calendar complete.",
          requestedRange: {
            start: "2026-09-06T22:00:00.000Z",
            end: "2026-09-13T21:59:59.999Z",
          },
        };
        order.push("calendar:end");
        return { moodle_raw_text: "CALENDAR", error_log: null };
      },
      scraperNode: async () => {
        order.push("moodle:start");
        expect(config.obligationCourseHints).toContain("Robotics Lab");
        await diagnostics.markSuccess("moodle", { detail: "Moodle ok.", urls: [config.moodleUrl], pages: 1 });
        return { moodle_raw_text: "MOODLE", error_log: null };
      },
    })(initialAgentState);

    expect(order).toEqual(["calendar:start", "calendar:end", "moodle:start"]);
  });

  it("runs Moodle and CIS concurrently when both are needed", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Bereite mich mit dem Kursmaterial auf die Prüfung morgen vor",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLvPlan"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    const starts: Record<string, number> = {};
    const orchestrator = createSourceOrchestratorNode(config, {
      scraperNode: async () => {
        starts.moodle = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await diagnostics.markSuccess("moodle", {
          detail: "Moodle ok.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return { moodle_raw_text: "MOODLE_TEXT", error_log: null };
      },
      cisScraperNode: async () => {
        starts.cis = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await diagnostics.markSuccess("cis", {
          detail: "CIS ok.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_TEXT", error_log: null };
      },
    });

    const result = await orchestrator(initialAgentState);

    expect(Math.abs(starts.moodle - starts.cis)).toBeLessThan(25);
    expect(result.moodle_raw_text).toContain("MOODLE_TEXT");
    expect(result.moodle_raw_text).toContain("CIS_TEXT");
  });

  it("does not erase successful CIS text when Moodle fails", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Bereite mich mit den Unterlagen auf die Prüfung morgen vor",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLvPlan"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    const result = await createSourceOrchestratorNode(config, {
      scraperNode: async () => {
        throw new Error("Moodle unavailable");
      },
      cisScraperNode: async () => {
        await diagnostics.markSuccess("cis", {
          detail: "CIS ok.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_TEXT", error_log: null };
      },
    })(initialAgentState);

    expect(result.moodle_raw_text).toContain("CIS_TEXT");
    expect(result.moodle_raw_text).toContain("Moodle crawl failed");
  });

  it("writes progress with the planned source coverage", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Wo ist morgen der Raum?",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLvPlan"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    await createSourceOrchestratorNode(config, {
      cisScraperNode: async () => {
        await diagnostics.markSuccess("cis", {
          detail: "CIS ok.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_TEXT", error_log: null };
      },
    })(initialAgentState);

    const progress = JSON.parse(await readFile(path.join(runDir, "run-progress.json"), "utf8"));
    expect(progress.sourcePlan.targets).toEqual(["cis"]);
    expect(progress.publicSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "moodle", status: "skipped" }),
      expect.objectContaining({ id: "cis", status: "done" }),
    ]));
  });

  it("loads CIS when calendar has no matching event", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      prompt: "Wann ist die MEL1 Prüfung?",
      calendarUrl: "https://calendar.example/private-token",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLv"],
      includeCis: true,
      diagnostics,
    });
    await createSourcePlannerNode(config)();
    let cisCalls = 0;
    let moodleCalls = 0;
    const result = await createSourceOrchestratorNode(config, {
      calendarNode: async () => {
        config.calendarSelection = {
          status: "empty",
          events: [],
          complete: false,
          missingFields: [],
          needsCisFallback: true,
          detail: "No matching event.",
        };
        await diagnostics.markSuccess("calendar", {
          detail: "No matching event.",
          urls: [],
          pages: 0,
          partial: true,
        });
        return { moodle_raw_text: "", error_log: null };
      },
      scraperNode: async () => {
        moodleCalls += 1;
        await diagnostics.markSuccess("moodle", {
          detail: "No exam on the bounded course page.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return { moodle_raw_text: "MOODLE_NO_EXAM", error_log: null };
      },
      cisScraperNode: async () => {
        cisCalls += 1;
        await diagnostics.markSuccess("cis", {
          detail: "MEL detail opened.",
          urls: config.cisUrls,
          pages: 1,
        });
        return { moodle_raw_text: "CIS_MEL_EXAM", error_log: null };
      },
    })(initialAgentState);

    expect(cisCalls).toBe(1);
    expect(moodleCalls).toBe(1);
    expect(result.moodle_raw_text).toContain("CIS_MEL_EXAM");
    expect(result.moodle_raw_text).toContain("MOODLE_NO_EXAM");
  });

  it("runs bounded Moodle and CIS fallbacks concurrently after an empty calendar", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "source-orchestrator-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const prompt = "Wann ist die TEZEI Prüfung?";
    const config = moodleTestConfig({
      runDir,
      prompt,
      calendarUrl: "https://calendar.example/private-token",
      cisUrls: ["https://cis.example/cis.php/Cis/MyLv"],
      includeCis: true,
      diagnostics,
      intentDecision: {
        intent: "schedule_answer",
        wantsPdf: false,
        wantsTypstDocument: false,
        wantsQuickAnswer: true,
        wantsQuizAssistance: false,
        needsMoodle: false,
        needsCis: true,
        needsCalendar: true,
        needsCourseMaterial: false,
        needsDownloadedFiles: false,
        reason: "test",
      },
    });
    await createSourcePlannerNode(config)();
    const starts: Record<string, number> = {};
    await createSourceOrchestratorNode(config, {
      calendarNode: async () => {
        config.calendarSelection = {
          status: "empty",
          events: [],
          complete: false,
          missingFields: [],
          needsCisFallback: true,
          detail: "No matching event.",
        };
        await diagnostics.markSuccess("calendar", {
          detail: "No matching event.",
          urls: [],
          pages: 0,
          partial: true,
        });
        return { moodle_raw_text: "", error_log: null };
      },
      scraperNode: async () => {
        starts.moodle = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { moodle_raw_text: "MOODLE", error_log: null };
      },
      cisScraperNode: async () => {
        starts.cis = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { moodle_raw_text: "CIS", error_log: null };
      },
    })(initialAgentState);

    expect(Math.abs(starts.moodle - starts.cis)).toBeLessThan(25);
  });
});
