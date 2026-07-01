import { describe, expect, it } from "vitest";
import { planSources, planSourcesForPrompt } from "../sourcePlanner.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

describe("sourcePlanner", () => {
  it("routes Moodle material and PDF prompts to Moodle only", () => {
    const plan = planSourcesForPrompt("Erstelle einen Lernzettel aus den PDF-Folien", {
      hasCisUrls: true,
    });
    expect(plan.targets).toEqual(["moodle"]);
    expect(plan.needsFiles).toBe(true);
  });

  it("routes schedule, room, and exam prompts to CIS only", () => {
    const plan = planSourcesForPrompt("Wo ist morgen die Prüfung und in welchem Raum?", {
      hasCisUrls: true,
    });
    expect(plan.targets).toEqual(["cis"]);
    expect(plan.needsCurrentScheduleData).toBe(true);
  });

  it("uses calendar as the primary source for schedule questions", () => {
    const plan = planSourcesForPrompt("Wann ist die MEL1 Prüfung?", {
      hasCisUrls: true,
      hasCalendarUrl: true,
    });
    expect(plan.targets).toEqual(["calendar"]);
  });

  it("routes attendance directly to CIS even when calendar is configured", () => {
    const plan = planSourcesForPrompt("Wie ist die Anwesenheit bei MEL1 geregelt?", {
      hasCisUrls: true,
      hasCalendarUrl: true,
    });
    expect(plan.targets).toEqual(["cis"]);
  });

  it("routes mixed preparation prompts to both sources", () => {
    const plan = planSourcesForPrompt("Bereite mich mit den Unterlagen auf die Prüfung morgen vor", {
      hasCisUrls: true,
    });
    expect(plan.targets).toEqual(["moodle", "cis"]);
  });

  it("uses conservative routing for ambiguous prompts", () => {
    const plan = planSourcesForPrompt("Was ist wichtig?", { hasCisUrls: true });
    expect(plan.targets).toEqual(["moodle", "cis"]);
    expect(plan.confidence).toBe("low");
  });

  it("honors explicit source-mode overrides", () => {
    const plan = planSourcesForPrompt("PDF Folien morgen", {
      sourceMode: "cis",
      hasCisUrls: true,
    });
    expect(plan.targets).toEqual(["cis"]);
    expect(plan.allowFollowUpCrawl).toBe(false);
  });

  it("routes schedule answer with course material to Moodle and CIS without file/PDF needs", () => {
    const prompt = "Finde die naechste MEL Prüfung. Nenne nur den Termin und prüfungsrelevante Lernunterlagen aus Moodle.";
    const plan = planSources(moodleTestConfig({
      prompt,
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: true,
        hasCisUrls: true,
      }),
    }));

    expect(plan.targets).toEqual(["moodle", "cis"]);
    expect(plan.needsFiles).toBe(false);
    expect(plan.needsCourseMaterial).toBe(true);
  });

  it("keeps explicit course overview PDF prompts on the document path", () => {
    const prompt = "Erstelle eine Kursübersicht für MEL als PDF";
    const plan = planSources(moodleTestConfig({
      prompt,
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: true,
        hasCisUrls: true,
      }),
    }));

    expect(plan.targets).toEqual(["moodle"]);
    expect(plan.needsFiles).toBe(true);
  });
});
