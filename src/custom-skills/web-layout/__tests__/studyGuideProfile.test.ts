import { describe, expect, it } from "vitest";
import {
  deriveStudyGuideRequirements,
  handoffSectionGroups,
  handoffSourceRegistry,
  isMaes2PracticeCorpus,
} from "../studyGuideProfile.js";

function handoff(courseTitle: string, sections: string[], sources: unknown[] = []): string {
  return `## Extracted data\n\n${JSON.stringify({ course: { title: courseTitle }, sections: sections.map((heading) => ({ heading, summary: "x".repeat(120) })), sources, formulas: [] })}\n\n`;
}

describe("adaptive study-guide profile", () => {
  it("uses evidence coverage instead of a course-code-specific MAES2 quota", () => {
    const source = handoff("MAES2 – Mathematik für Engineering Science 2", Array.from({ length: 11 }, (_, index) => `THEMA ${index + 1}: Kapitel ${index + 1}`)) +
      "## Full extracted practice corpus\n### Practice source: Minitest-1.extracted.txt\n1. Single Choice: Test\n";
    const profile = deriveStudyGuideRequirements(source);

    expect(isMaes2PracticeCorpus(source)).toBe(true);
    expect(profile.courseCode).toBe("MAES2");
    expect(profile.topicTarget).toBe(11);
    expect(profile.exerciseTarget).toBeGreaterThanOrEqual(12);
    expect(profile.exerciseTarget).not.toBe(40);
    expect(profile.rationale).toContain("objective coverage slots");
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

  it("does not turn Moodle URL parameters, dates, grades, or mixed language activities into calculations", () => {
    const source = `## Extracted data\n\n${JSON.stringify({
      course: { title: "BMR Business English" },
      sections: [
        { heading: "Business Forms", summary: "Presentation task worth 2% on 2026-04-13.", source_ids: ["course_page"] },
        { heading: "ELF Meetings", summary: "Speak for five minutes and summarise diplomatically.", source_ids: ["course_page"] },
        { heading: "Marketing", summary: "Analyse a company and its marketing mix.", source_ids: ["course_page"] },
        { heading: "CSR", summary: "Critique a stakeholder strategy orally.", source_ids: ["course_page"] },
      ],
      learning_modules: [
        { title: "Business Forms", content_mode: "mixed" },
        { title: "ELF Meetings", content_mode: "mixed" },
      ],
      sources: [{
        id: "course_page",
        title: "Moodle course page",
        url: "https://learn.example.edu/course/view.php?id=32514",
      }],
      formulas: [],
    })}`;
    const profile = deriveStudyGuideRequirements(
      `${source}\n${"https://learn.example.edu/mod/quiz/view.php?id=2206826 ".repeat(30)}` +
      "\nMay I interrupt you for a moment? ".repeat(20),
    );

    expect(profile.archetype).toBe("mixed");
    expect(profile.calculationTarget).toBe(0);
    expect(profile.applicationTarget).toBeGreaterThan(0);
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

  it("selects a mixed visual and terminology toolbox for an unseen biology course", () => {
    const source = `## Extracted data\n\n${JSON.stringify({
      course: { title: "BIO-101 Cell Biology" },
      sections: [
        { heading: "Cell membrane", summary: "Identify labelled membrane structures and explain transport mechanisms." },
        { heading: "Microscopy", summary: "Interpret microscope diagrams and distinguish organelles." },
        { heading: "Genetics", summary: "Apply inheritance concepts to short biological cases." },
        { heading: "Terminology", summary: "Define and use the scientific terminology from the course." },
      ],
      learning_modules: [
        { title: "Microscopy", content_mode: "visual" },
        { title: "Genetics", content_mode: "case-based" },
      ],
      sources: [],
      formulas: [],
    })}`;

    const profile = deriveStudyGuideRequirements(source);

    expect(profile.courseTitle).toBe("BIO-101 Cell Biology");
    expect(profile.calculationTarget).toBe(0);
    expect(profile.selectionTarget).toBeGreaterThan(0);
    expect(profile.applicationTarget).toBeGreaterThan(0);
    expect(profile.vocabularyTarget).toBeGreaterThan(0);
  });

  it("allocates a substantial per-module vocabulary deck when a course-wide vocabulary assessment is evidenced", () => {
    const source = `## Extracted data\n\n${JSON.stringify({
      course: { title: "BMR Business English" },
      sections: Array.from({ length: 6 }, (_, index) => ({
        heading: `Self-Study ${String.fromCharCode(65 + index)}`,
        summary: `Professional vocabulary and useful expressions for business topic ${index + 1}.`,
      })),
      learning_modules: Array.from({ length: 6 }, (_, index) => ({
        title: `Self-Study ${String.fromCharCode(65 + index)}`,
        content_mode: "mixed",
        assessment_signals: index === 5 ? ["Vocabulary test"] : [],
      })),
      sources: [],
      formulas: [],
    })}`;
    const profile = deriveStudyGuideRequirements(source);

    expect(profile.vocabularyAssessmentRequired).toBe(true);
    expect(profile.topicTarget).toBe(6);
    expect(profile.vocabularyTarget).toBeGreaterThanOrEqual(60);
    expect(profile.vocabularyTarget / profile.topicTarget).toBeGreaterThanOrEqual(10);
    expect(profile.exerciseTarget).toBeGreaterThanOrEqual(profile.vocabularyTarget + 18);
  });

  it("preserves official subtopics inside efficient grouped chapters", () => {
    const source = `## Extracted data\n\n${JSON.stringify({
      course: { title: "MAES2" },
      sections: [
        { heading: "Thema 2 – Grundlagen", source_ids: ["ch2_topics_res_a"] },
        { heading: "Thema 3 – Ableitungsregeln", source_ids: ["ch2_topics_res_a"] },
        { heading: "Thema 4 – Taylorreihen", source_ids: ["ch2_topics_res_a"] },
        { heading: "Thema 5 – Extremwerte", source_ids: ["ch2_topics_res_a"] },
      ],
    })}`;

    expect(handoffSectionGroups(source)).toEqual([{
      key: "chapter-2",
      title: "Themen 2–5",
      subtopics: [
        "Thema 2 – Grundlagen",
        "Thema 3 – Ableitungsregeln",
        "Thema 4 – Taylorreihen",
        "Thema 5 – Extremwerte",
      ],
    }]);
  });
});
