import { describe, expect, it } from "vitest";
import {
  deriveStudyGuideRequirements,
  handoffSourceRegistry,
  isMaes2PracticeCorpus,
} from "../studyGuideProfile.js";

function handoff(courseTitle: string, sections: string[], sources: unknown[] = []): string {
  return `## Extracted data\n\n${JSON.stringify({ course: { title: courseTitle }, sections: sections.map((heading) => ({ heading, summary: "x".repeat(120) })), sources, formulas: [] })}\n\n`;
}

describe("adaptive study-guide profile", () => {
  it("keeps the established MAES2 quality floor only for the actual MAES2 corpus", () => {
    const source = handoff("MAES2 – Mathematik für Engineering Science 2", Array.from({ length: 11 }, (_, index) => `THEMA ${index + 1}: Kapitel ${index + 1}`)) +
      "## Full extracted practice corpus\n### Practice source: Minitest-1.extracted.txt\n1. Single Choice: Test\n";
    const profile = deriveStudyGuideRequirements(source);

    expect(isMaes2PracticeCorpus(source)).toBe(true);
    expect(profile).toMatchObject({ courseCode: "MAES2", topicTarget: 11, exerciseTarget: 40, selectionTarget: 20, calculationTarget: 18 });
  });

  it("does not force calculations into a sparse case-based course", () => {
    const source = handoff("MED – Medizinische Grundlagen", ["Anamnese", "Diagnostik", "Therapie", "Prävention", "Kommunikation", "Fallbeispiele"]) +
      "Patient Fallbeispiel Diagnose Therapie Entscheidungssituation ".repeat(8);
    const profile = deriveStudyGuideRequirements(source);

    expect(isMaes2PracticeCorpus(source)).toBe(false);
    expect(profile.archetype).toBe("case-based");
    expect(profile.topicTarget).toBe(6);
    expect(profile.exerciseTarget).toBe(12);
    expect(profile.calculationTarget).toBe(0);
    expect(profile.applicationTarget).toBeGreaterThan(0);
    expect(profile.derivedPracticeMinimum).toBe(12);
  });

  it("recognizes a quantitative course without borrowing MAES2 chapters", () => {
    const source = handoff("DYN2 – Anwendungen der Dynamik", ["Kinematik", "Kinetik", "Impuls", "Drall", "Schwingungen"]) +
      "Kraft Moment Gleichung berechne bestimme = ".repeat(20);
    const profile = deriveStudyGuideRequirements(source);

    expect(profile.archetype).toBe("quantitative");
    expect(profile.sectionTitles).toEqual(["Kinematik", "Kinetik", "Impuls", "Drall", "Schwingungen"]);
    expect(profile.calculationTarget).toBeGreaterThan(0);
    expect(isMaes2PracticeCorpus(source)).toBe(false);
  });

  it("uses declared Moodle learning modes for an unseen procedural language course", () => {
    const source = `## Extracted data\n\n${JSON.stringify({
      course: { title: "LANG-210 Academic English" },
      sections: [
        { heading: "Peer review", summary: "Review and revise a draft." },
        { heading: "Oral presentation", summary: "Plan and deliver a short presentation." },
        { heading: "Argument structure", summary: "Build a coherent argument." },
        { heading: "Editing workflow", summary: "Apply an editing checklist." },
      ],
      learning_modules: [
        { title: "Peer review", content_mode: "procedural" },
        { title: "Oral presentation", content_mode: "procedural" },
      ],
      sources: [],
      formulas: [],
    })}`;

    const profile = deriveStudyGuideRequirements(source);

    expect(profile).toMatchObject({
      courseCode: "LANG",
      courseTitle: "LANG-210 Academic English",
      archetype: "procedural",
      calculationTarget: 0,
    });
    expect(profile.applicationTarget).toBeGreaterThan(profile.selectionTarget);
  });

  it("keeps source links from arbitrary standard Moodle installations", () => {
    const source = handoff("HUM-204 World Literature", ["Modernism"], [{
      id: "reader",
      title: "Modernism Reader",
      url: "https://portal.example.edu/learning/moodle/mod/resource/view.php?id=8",
    }]);

    expect(handoffSourceRegistry(source)).toEqual([{
      id: "reader",
      label: "Modernism Reader",
      url: "https://portal.example.edu/learning/moodle/mod/resource/view.php?id=8",
    }]);
  });
});
