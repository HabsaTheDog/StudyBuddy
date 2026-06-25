import { describe, expect, it } from "vitest";
import { initialSourceCoverage } from "../runDiagnostics.js";
import { assessFollowUpCrawl } from "../sourceNeedAssessment.js";
import { planSourcesForPrompt } from "../sourcePlanner.js";

describe("sourceNeedAssessment", () => {
  it("starts a CIS follow-up when schedule facts are missing", () => {
    const plan = planSourcesForPrompt("Erstelle einen Lernzettel", { hasCisUrls: true });
    const assessment = assessFollowUpCrawl({
      prompt: "Erstelle einen Lernzettel und sag mir den Raum morgen",
      plan,
      coverage: {
        ...initialSourceCoverage,
        moodle: {
          ...initialSourceCoverage.moodle,
          status: "success",
          detail: "ok",
          pages: 1,
        },
      },
      rawText: "Moodle notes",
    });
    expect(assessment.targets).toEqual(["cis"]);
  });

  it("starts a Moodle follow-up when material evidence is missing", () => {
    const plan = planSourcesForPrompt("Wo ist morgen der Raum?", { hasCisUrls: true });
    const assessment = assessFollowUpCrawl({
      prompt: "Wo ist morgen der Raum und welche PDF-Unterlagen brauchen wir?",
      plan,
      coverage: {
        ...initialSourceCoverage,
        cis: {
          ...initialSourceCoverage.cis,
          status: "success",
          detail: "ok",
          pages: 1,
        },
      },
      rawText: "CIS schedule",
    });
    expect(assessment.targets).toEqual(["moodle"]);
  });

  it("does not start follow-up when disabled by an explicit override", () => {
    const plan = planSourcesForPrompt("PDF morgen", {
      sourceMode: "moodle",
      hasCisUrls: true,
    });
    const assessment = assessFollowUpCrawl({
      prompt: "PDF morgen",
      plan,
      coverage: initialSourceCoverage,
      rawText: "",
    });
    expect(assessment.targets).toEqual([]);
  });
});
