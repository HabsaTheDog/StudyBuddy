import { describe, expect, it } from "vitest";
import { planSourcesForPrompt } from "../sourcePlanner.js";

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
});
