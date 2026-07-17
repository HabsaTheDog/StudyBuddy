import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAnswerGraph } from "../graph.js";
import { RunDiagnostics } from "../runDiagnostics.js";
import { initialAgentState } from "../state.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("calendar graph routing", () => {
  it("answers a complete pure schedule question without Moodle, CIS, or analyzer", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "calendar-answer-"));
    const prompt = "Wann und in welchem Raum ist die MEL1 Prüfung?";
    const diagnostics = new RunDiagnostics({
      runDir,
      secrets: ["https://calendar.example/private-token"],
    });
    await diagnostics.init();
    const config = moodleTestConfig({
      prompt,
      runDir,
      outputPath: path.join(runDir, "document.typ"),
      calendarUrl: "https://calendar.example/private-token",
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
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
    let analyzerCalls = 0;
    const graph = buildAnswerGraph(config, {
      calendarNode: async () => {
        config.calendarSelection = {
          status: "success",
          complete: true,
          missingFields: [],
          needsCisFallback: false,
          detail: "Selected one relevant calendar event.",
          events: [{
            source: "calendar_event",
            uid: "mel-exam",
            title: "MEL1 Prüfung",
            start: "2026-07-01T07:00:00.000Z",
            end: "2026-07-01T08:30:00.000Z",
            location: "A1.01",
            allDay: false,
            recurring: false,
          }],
        };
        await diagnostics.markSuccess("calendar", {
          detail: config.calendarSelection.detail,
          urls: [],
          pages: 1,
        });
        return {
          moodle_raw_text: "[Calendar event]\nTitle: MEL1 Prüfung\nStart: 2026-07-01T07:00:00.000Z\nLocation: A1.01",
          error_log: null,
        };
      },
      scraperNode: async () => {
        throw new Error("Moodle must not run");
      },
      cisScraperNode: async () => {
        throw new Error("CIS must not run");
      },
      codex: {
        async run() {
          analyzerCalls += 1;
          throw new Error("Analyzer must not run");
        },
      },
    });

    const result = await graph.invoke(initialAgentState);
    const answerJson = await readFile(path.join(runDir, "answer.json"), "utf8");

    expect(result.error_log).toBeNull();
    expect(analyzerCalls).toBe(0);
    expect(answerJson).toContain('"kind": "calendar_event"');
    expect(answerJson).toContain('"status": "answered"');
    expect(answerJson).toContain('"confidence": "high"');
    expect(answerJson).toContain('"missing": []');
    expect(answerJson).not.toContain("private-token");
  });

  it("answers an empty-calendar schedule lookup from bounded Moodle/CIS evidence without an analyzer", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "calendar-answer-"));
    const prompt = "Find the next TEZEI exam date, time, and room.";
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      prompt,
      runDir,
      calendarUrl: "https://calendar.example/private-token",
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
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
    let analyzerCalls = 0;
    const graph = buildAnswerGraph(config, {
      calendarNode: async () => {
        config.calendarSelection = {
          status: "empty",
          complete: false,
          missingFields: [],
          needsCisFallback: true,
          detail: "No matching event.",
          events: [],
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
        await diagnostics.markSuccess("moodle", {
          detail: "Target course page opened.",
          urls: ["https://moodle.example/course/view.php?id=32838"],
          pages: 1,
        });
        return {
          moodle_raw_text: "[Moodle page]\nTitle: Grundlagen des technischen Zeichnens\nPrüfungstermin 02.09.2026 08:00 Uhr\nRaum HS_A3.13",
          error_log: null,
        };
      },
      cisScraperNode: async () => {
        await diagnostics.markSuccess("cis", {
          detail: "No target exam in CIS.",
          urls: ["https://cis.example/cis.php/Cis/MyLv"],
          pages: 1,
          partial: true,
        });
        return { moodle_raw_text: "[CIS page]\nTitle: MyLv\nNo TEZEI exam listed", error_log: null };
      },
      codex: {
        async run() {
          analyzerCalls += 1;
          throw new Error("Analyzer must not run for a schedule lookup");
        },
      },
    });

    const result = await graph.invoke(initialAgentState);
    const answer = await readFile(path.join(runDir, "answer.md"), "utf8");

    expect(result.error_log).toBeNull();
    expect(analyzerCalls).toBe(0);
    expect(answer).toContain("02.09.2026");
    expect(answer).toContain("HS_A3.13");
  });
});
