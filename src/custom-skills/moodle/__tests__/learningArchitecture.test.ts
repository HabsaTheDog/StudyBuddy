import { describe, expect, it } from "vitest";
import {
  buildDeterministicLearningArchitecture,
  parseLearningArchitectureModelJson,
  validateLearningArchitectureModelJson,
  type LearningArchitectureCatalogEntry,
  type LearningArchitectureDocumentBrief,
} from "../learningArchitecture.js";

describe("domain-neutral learning architecture", () => {
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
    const url = "https://moodle.example/forecasting.pdf";
    const architecture = buildDeterministicLearningArchitecture({
      briefs: [brief(
        "Worked solutions - Forecasting",
        "Forecasting",
        "Calculate a forecast and interpret the worked solution.",
        null,
        "worked_example",
      )],
      catalog: [{ ...catalog("Worked solutions - Forecasting", "Forecasting", url), role: "worked_example" }],
    });

    expect(architecture.modules[0].resourceUrls).toEqual([url]);
    expect(architecture.modules[0].assessmentSignals).toContain("Practiced in worked examples or solutions.");
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
