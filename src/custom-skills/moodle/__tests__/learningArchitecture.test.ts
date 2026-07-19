import { describe, expect, it } from "vitest";
import {
  boundLearningArchitecture,
  buildDeterministicLearningArchitecture,
  parseLearningArchitectureModelJson,
  validateLearningArchitectureModelJson,
  type LearningArchitectureCatalogEntry,
  type LearningArchitectureDocumentBrief,
} from "../learningArchitecture.js";

describe("domain-neutral learning architecture", () => {
  it("compacts large architectures without dropping objectives or resources", () => {
    const modules = Array.from({ length: 10 }, (_, index) => ({
      id: `module-${index + 1}`,
      title: `Topic ${index + 1}`,
      priority: index < 2 ? "essential" as const : "important" as const,
      contentMode: index % 2 ? "conceptual" as const : "quantitative" as const,
      learningObjectives: [`Objective ${index + 1}`],
      assessmentSignals: [`Signal ${index + 1}`],
      resourceUrls: [`https://moodle.example/topic-${index + 1}.pdf`],
    }));
    const compacted = boundLearningArchitecture({
      schemaVersion: 1,
      modules,
      supportResources: [],
      excludedResourceUrls: [],
    });

    expect(compacted.modules).toHaveLength(6);
    expect(compacted.modules.flatMap((module) => module.learningObjectives)).toHaveLength(10);
    expect(compacted.modules.flatMap((module) => module.resourceUrls)).toHaveLength(10);
    expect(compacted.modules[0].priority).toBe("essential");
  });
  it.each([
    {
      domain: "technical",
      title: "Lecture 03 - Fatigue Design",
      topic: "Fatigue Design",
      summary: "Explain the principle, calculate safety factors, and interpret a worked solution.",
      expectedMode: "mixed",
    },
    {
      domain: "mathematics",
      title: "Unit 04 - Differential Equations",
      topic: "Differential Equations",
      summary: "Solve equations, calculate initial values, and check the solution.",
      expectedMode: "quantitative",
    },
    {
      domain: "medicine",
      title: "Seminar - Acute Chest Pain",
      topic: "Acute Chest Pain",
      summary: "Use a patient vignette to analyze a case and justify the next decision.",
      expectedMode: "case_based",
    },
    {
      domain: "business",
      title: "Workshop - Market Entry",
      topic: "Market Entry",
      summary: "Analyze a case study, compare alternatives, and justify a decision.",
      expectedMode: "mixed",
    },
  ])("creates a meaningful $domain module without subject-specific routing", (fixture) => {
    const url = `https://moodle.example/resource/${encodeURIComponent(fixture.domain)}.pdf`;
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [brief(fixture.title, fixture.topic, fixture.summary, url)],
      catalog: [catalog(fixture.title, fixture.topic, url)],
    });

    expect(architecture.modules).toHaveLength(1);
    expect(architecture.modules[0]).toMatchObject({
      title: fixture.topic,
      priority: "essential",
      contentMode: fixture.expectedMode,
      resourceUrls: [url],
    });
    expect(architecture.modules[0].learningObjectives.length).toBeGreaterThanOrEqual(2);
  });

  it("does not turn organizational containers or generic session names into modules", () => {
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [],
      catalog: [
        catalog("General course information", null, "https://moodle.example/general"),
        catalog("Präsenz 15", null, "https://moodle.example/session-15"),
        catalog("Overview", null, "https://moodle.example/overview"),
        catalog("Announcements forum", null, "https://moodle.example/forum"),
        catalog("Lecture 07 - Risk Classification", null, "https://moodle.example/risk.pdf"),
      ],
    });

    expect(architecture.modules.map((module) => module.title)).toEqual(["Risk Classification"]);
    expect(architecture.excludedResourceUrls).toEqual(expect.arrayContaining([
      "https://moodle.example/general",
      "https://moodle.example/session-15",
      "https://moodle.example/overview",
      "https://moodle.example/forum",
    ]));
  });

  it("keeps formula and reference documents as support instead of chapter explosions", () => {
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [
        brief("Formula collection", null, "Equations and symbols for all units.", "https://moodle.example/formulas.pdf", "formula"),
        brief("Clinical reference handbook", null, "Lookup thresholds and classifications.", "https://moodle.example/handbook.pdf", "external_reference"),
        brief("Lecture 02 - Evidence Evaluation", "Evidence Evaluation", "Explain and compare evidence quality.", "https://moodle.example/evidence.pdf"),
      ],
      catalog: [],
    });

    expect(architecture.modules.map((module) => module.title)).toEqual(["Evidence Evaluation"]);
    expect(architecture.supportResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Formula collection", purpose: "formula_reference" }),
      expect.objectContaining({ title: "Clinical reference handbook", purpose: "general_reference" }),
    ]));
  });

  it("merges a document brief with its catalog URL and assessment evidence", () => {
    const lectureUrl = "https://moodle.example/forecasting-lecture.pdf";
    const url = "https://moodle.example/forecasting.pdf";
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [
        brief("Lecture - Forecasting", "Forecasting", "Explain and calculate a forecast.", lectureUrl),
        brief(
          "Worked solutions - Forecasting",
          "Forecasting",
          "Calculate a forecast and interpret the worked solution.",
          null,
          "worked_example",
        ),
      ],
      catalog: [
        catalog("Lecture - Forecasting", "Forecasting", lectureUrl),
        { ...catalog("Worked solutions - Forecasting", "Forecasting", url), role: "worked_example" },
      ],
    });

    expect(architecture.modules).toHaveLength(1);
    expect(architecture.modules[0].resourceUrls).toEqual([lectureUrl, url]);
    expect(architecture.modules[0].assessmentSignals).toContain("Practiced in worked examples or solutions.");
  });

  it("attaches MAES-style generic activities by summary topic instead of making activity chapters", () => {
    const lectureUrl = "https://moodle.example/differentiation.pdf";
    const minitestUrl = "https://moodle.example/minitest-2.pdf";
    const worksheetUrl = "https://moodle.example/worksheet-2.pdf";
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [
        brief(
          "Ernst Example: Skriptum „Differential Calculus“",
          null,
          "Explain derivatives and calculate rates of change.",
          lectureUrl,
          "overview",
        ),
        brief(
          "Minitest 2 - Solutions file",
          null,
          "Selection metadata. Minitest: Foundations of Differential Calculus 1. Multiple Choice: calculate the derivative.",
          minitestUrl,
          "worked_example",
        ),
        brief(
          "Worksheet 2",
          null,
          "Worksheet: Differential Calculus 1. Question: solve and interpret the result.",
          worksheetUrl,
          "worked_example",
        ),
      ],
      catalog: [],
    });

    expect(architecture.modules.map((module) => module.title)).toEqual(["Differential Calculus"]);
    expect(architecture.modules[0].resourceUrls).toEqual([
      lectureUrl,
      minitestUrl,
      worksheetUrl,
    ]);
    expect(architecture.modules[0].assessmentSignals).toContain("Practiced in worked examples or solutions.");
  });

  it("rejects unmatched activities, raw Moodle links, learning tips, and generic course shells", () => {
    const urls = {
      test: "https://moodle.example/minitest.pdf",
      link: "https://moodle.example/raw-link",
      tips: "https://moodle.example/tips.pdf",
      shell: "https://moodle.example/course-shell.pdf",
    };
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [brief(
        "Minitest 4 - Lösungen Datei",
        null,
        "Minitest: Unrepresented Topic. Single Choice: choose an answer.",
        urls.test,
        "worked_example",
      )],
      catalog: [
        { ...catalog("- link [ref=e435, url=https://moodle.example/file]", null, urls.link), role: "supplementary" },
        { ...catalog("Some tips for learning", null, urls.tips), role: "supplementary" },
        { ...catalog("Ada Example: „Applied Methods 2“", null, urls.shell), role: "supplementary" },
      ],
    });

    expect(architecture.modules).toEqual([]);
    expect(architecture.excludedResourceUrls).toEqual(expect.arrayContaining(Object.values(urls)));
  });

  it("cleans authors and document wrappers while preserving meaningful catalog-only units", () => {
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [],
      catalog: [
        { ...catalog("Ernst Example: Skriptum „Boundary Value Problems“", null, "https://moodle.example/boundary.pdf"), role: "overview" },
        { ...catalog("Studienbrief 20 „Decision Models“", null, "https://moodle.example/decision.pdf"), role: "supplementary" },
        catalog("Lecture 07 - Risk Classification", null, "https://moodle.example/risk.pdf"),
      ],
    });

    expect(architecture.modules).toHaveLength(3);
    expect(architecture.modules.map((module) => module.title)).toEqual(expect.arrayContaining([
      "Boundary Value Problems",
      "Risk Classification",
      "Decision Models",
    ]));
  });

  it("validates model JSON strictly and rejects incomplete modules", () => {
    const valid = JSON.stringify({
      schemaVersion: 1,
      modules: [{
        id: "decision-analysis",
        title: "Decision Analysis",
        priority: "important",
        contentMode: "case_based",
        learningObjectives: ["Analyze a representative decision."],
        assessmentSignals: [],
        resourceUrls: ["https://moodle.example/decision.pdf"],
      }],
      supportResources: [],
      excludedResourceUrls: [],
    });

    expect(parseLearningArchitectureModelJson(`\`\`\`json\n${valid}\n\`\`\``).modules[0].id)
      .toBe("decision-analysis");
    const invalid = validateLearningArchitectureModelJson({
      schemaVersion: 1,
      modules: [{ id: "missing-fields", title: "Missing fields" }],
      supportResources: [],
      excludedResourceUrls: [],
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error).toContain("priority");
  });
});

function brief(
  title: string,
  topic: string | null,
  summary: string,
  resourceUrl: string | null,
  role = "primary_lecture",
): LearningArchitectureDocumentBrief {
  return { title, topic, summary, resourceUrl, role };
}

function catalog(
  label: string,
  topic: string | null,
  href: string,
): LearningArchitectureCatalogEntry {
  return { href, label, topic, role: "primary_lecture", priority: 700 };
}
