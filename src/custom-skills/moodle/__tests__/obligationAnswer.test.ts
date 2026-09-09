import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAnswerWriterNode } from "../nodes/answerWriterNode.js";
import { ObligationCoverageTracker } from "../obligationCoverage.js";
import { initialAgentState } from "../state.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;
afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("obligation answer integrity", () => {
  it("keeps an incomplete crawl visibly partial and cites direct activity evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "obligation-answer-"));
    const prompt = "Was muss ich nächste Woche alles erledigen?";
    const config = moodleTestConfig({
      runDir,
      prompt,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
        hasCalendarUrl: false,
      }),
    });
    const tracker = new ObligationCoverageTracker(config);
    tracker.discover([
      "https://moodle.example/course/view.php?id=1",
      "https://moodle.example/mod/assign/view.php?id=2",
    ]);
    tracker.markSuccess("https://moodle.example/course/view.php?id=1");
    await tracker.persist();

    await createAnswerWriterNode(config)({
      ...initialAgentState,
      extracted_data: {
        sources: [{ id: "assignment-2", title: "Homework", kind: "assignment", url: "https://moodle.example/mod/assign/view.php?id=2", path: null, page: null }],
        sections: [{ heading: "Course – Homework", summary: "Upload the worksheet by Friday.", key_concepts: [], source_ids: ["assignment-2"] }],
      },
    });

    const artifact = JSON.parse(await readFile(path.join(runDir, "answer.json"), "utf8"));
    expect(artifact.status).toBe("partial");
    expect(artifact.confidence).toBe("low");
    expect(artifact.answer).toContain("https://moodle.example/mod/assign/view.php?id=2");
    expect(artifact.answer).toContain("kein vollständiges Ergebnis");
  });

  it("keeps audited courses without obligations visible through source-grounded warnings", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "obligation-answer-"));
    const prompt = "Was muss ich nächste Woche alles erledigen?";
    const config = moodleTestConfig({
      runDir,
      prompt,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
        hasCalendarUrl: false,
      }),
    });
    const tracker = new ObligationCoverageTracker(config);
    tracker.discover(["https://moodle.example/course/view.php?id=1"]);
    tracker.markSuccess("https://moodle.example/course/view.php?id=1");
    await tracker.persist();

    await createAnswerWriterNode(config)({
      ...initialAgentState,
      extracted_data: {
        sources: [{
          id: "kinetics-course",
          title: "Kurs: Höhere Kinetik",
          kind: "moodle_page",
          url: "https://moodle.example/course/view.php?id=1",
          path: null,
          page: null,
        }],
        sections: [],
        warnings: ["Höhere Kinetik: Die auditierten Seiten weisen keine konkrete Aufgabe für diese Woche aus."],
      },
    });

    const artifact = JSON.parse(await readFile(path.join(runDir, "answer.json"), "utf8"));
    expect(artifact.status).toBe("partial");
    expect(artifact.answer).toContain("Höhere Kinetik");
    expect(artifact.answer).toContain("https://moodle.example/course/view.php?id=1");
  });

  it("does not attach an unrelated activity merely because a warning uses generic obligation words", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "obligation-answer-"));
    const prompt = "Was muss ich nächste Woche alles erledigen?";
    const config = moodleTestConfig({
      runDir,
      prompt,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
        hasCalendarUrl: false,
      }),
    });

    await createAnswerWriterNode(config)({
      ...initialAgentState,
      extracted_data: {
        sources: [{
          id: "other-assignment",
          title: "Abgabe 1 vor der nächsten Präsenzeinheit",
          kind: "assignment",
          url: "https://moodle.example/mod/assign/view.php?id=99",
          path: null,
          page: null,
        }],
        sections: [],
        warnings: ["Höhere Kinetik: Keine konkrete Aufgabe oder Vorbereitung für die nächste Präsenz."],
      },
    });

    const artifact = JSON.parse(await readFile(path.join(runDir, "answer.json"), "utf8"));
    expect(artifact.answer).toContain("Höhere Kinetik");
    expect(artifact.answer).not.toContain("https://moodle.example/mod/assign/view.php?id=99");
  });
});
