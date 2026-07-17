import { describe, expect, it } from "vitest";
import { extractScheduleEvidence } from "../scheduleEvidence.js";

describe("schedule evidence extraction", () => {
  it("extracts a complete targeted Moodle exam without an LLM", () => {
    const evidence = extractScheduleEvidence(
      "Find the next TEZEI exam date, time, and room.",
      [
        "[Moodle page]",
        "Title: Grundlagen des technischen Zeichnens",
        "URL: https://moodle.example/course/view.php?id=32838",
        "Prüfungstermin",
        "02.09.2026, 08:00–09:30 Uhr",
        "Raum HS_A3.13",
      ].join("\n"),
      new Date("2026-07-16T12:00:00+02:00"),
    );

    expect(evidence.complete).toBe(true);
    expect(evidence.answer).toContain("02.09.2026");
    expect(evidence.answer).toContain("HS_A3.13");
  });

  it("ignores unrelated exam dates from a generic CIS page", () => {
    const evidence = extractScheduleEvidence(
      "Wann ist die TEZEI Prüfung und in welchem Raum?",
      [
        "[CIS page]",
        "Title: Meine Lehrveranstaltungen",
        "DYN2 Prüfung 01.09.2026 08:00 Uhr Raum A1.01",
        "MEL1 Prüfung 02.09.2026 08:00 Uhr Raum A1.02",
      ].join("\n"),
      new Date("2026-07-16T12:00:00+02:00"),
    );

    expect(evidence.answer).toBe("");
    expect(evidence.complete).toBe(false);
  });

  it("reports a partial result when the requested room is missing", () => {
    const evidence = extractScheduleEvidence(
      "Wann und in welchem Raum ist die TEZEI Prüfung?",
      "[CIS page]\nTitle: TEZEI\nTEZEI Prüfung 02.09.2026 um 08:00 Uhr",
      new Date("2026-07-16T12:00:00+02:00"),
    );

    expect(evidence.answer).toContain("02.09.2026");
    expect(evidence.missing).toEqual(["Raum"]);
  });

  it("does not mistake a dotted date for a time", () => {
    const evidence = extractScheduleEvidence(
      "Wann ist die TEZEI Prüfung?",
      "[Moodle page]\nTitle: TEZEI\nTEZEI Prüfung am 02.09.2026",
      new Date("2026-07-16T12:00:00+02:00"),
    );

    expect(evidence.answer).toContain("02.09.2026");
    expect(evidence.missing).toContain("Uhrzeit");
  });
});
