import { describe, expect, it } from "vitest";
import {
  ResourceManifestSchema,
  StudyModelSchema,
  type CoverageAssessment,
  type StudyModel,
} from "../examNavigatorContracts.js";
import { reviewStudyModel } from "../studentFirstReview.js";

const coverage: CoverageAssessment = {
  status: "complete",
  detail: "All selected evidence is available.",
  criticalMissing: [],
  omittedTopics: [],
  retryActions: [],
  discoveredResources: 1,
  acquiredResources: 1,
  failedResources: 0,
  usableEvidenceRecords: 1,
};

const manifest = ResourceManifestSchema.parse({
  schemaVersion: "1.0",
  courseUrl: "https://learn.university.example/course/view.php?id=204",
  generatedAt: "2026-07-28T00:00:00.000Z",
  resources: [],
});

describe("discipline-aware student value review", () => {
  it("accepts a deep conceptual chapter without forcing an artificial worked calculation", async () => {
    const model = studyModel("conceptual", []);

    const review = await reviewStudyModel(model, coverage, manifest);

    expect(review.ok).toBe(true);
    expect(review.findings.map((finding) => finding.code)).not.toContain("chapter-example-missing");
  });

  it("does not invent an application requirement for a procedural chapter", async () => {
    const model = studyModel("procedural", []);

    const review = await reviewStudyModel(model, coverage, manifest);

    expect(review.ok).toBe(true);
    expect(review.findings.map((finding) => finding.code)).not.toContain("chapter-example-missing");
  });

  it("accepts a source-grounded case analysis as the application for a case-based chapter", async () => {
    const model = studyModel("case_based", [{
      id: "case-1",
      chapterId: "chapter-1",
      origin: "source",
      learningGoal: "Compare two interpretations using textual and historical evidence.",
      prompt: "Which interpretation is better supported by the passage and its historical context?",
      steps: [
        "Identify the competing claims.",
        "Collect passage-level evidence for each claim.",
        "Weigh the evidence and state the strongest counterargument.",
      ],
      result: "Interpretation B is better supported, with one explicit limitation.",
      sourceIds: ["source-1"],
    }]);

    const review = await reviewStudyModel(model, coverage, manifest);

    expect(review.ok).toBe(true);
    expect(review.findings.map((finding) => finding.code)).not.toContain("chapter-example-missing");
  });
});

function studyModel(
  contentMode: StudyModel["courseChapters"][number]["contentMode"],
  workedExamples: StudyModel["workedExamples"],
): StudyModel {
  const paragraph = [
    "The chapter explains how narrative voice shapes access to events, how form guides interpretation,",
    "and how historical context changes the plausible meaning of a passage.",
    "It distinguishes observation from interpretation, compares competing claims,",
    "shows how evidence can support more than one reading, and identifies the limits of each conclusion.",
  ].join(" ");
  return StudyModelSchema.parse({
    schemaVersion: "1.0",
    profile: "study_guide",
    language: "en",
    title: "World Literature – Study Guide",
    courseTitle: "HUM-204 World Literature",
    courseUrl: "https://learn.university.example/course/view.php?id=204",
    publicationStatus: "complete",
    scopeNote: "Complete course unit.",
    courseChapters: [{
      id: "chapter-1",
      title: "Modernism and Colonial Narratives",
      subject: "Modernism and Colonial Narratives",
      order: 0,
      priority: "essential",
      contentMode,
      learningObjectives: ["Interpret narrative voice using passage-level evidence."],
      assessmentSignals: ["Comparative essay and source analysis."],
      status: "covered",
      topicIds: ["topic-1"],
      resourceIds: ["source-1"],
    }],
    topics: [{
      id: "topic-1",
      chapterId: "chapter-1",
      title: "Narrative voice and historical context",
      summary: Array.from({ length: 6 }, () => paragraph).join(" "),
      priority: "essential",
      scopeStatus: "confirmed",
      learningGoals: [
        "Distinguish textual observation from interpretation.",
        "Compare competing interpretations and justify a conclusion.",
      ],
      sourceIds: ["source-1"],
    }],
    formulas: [],
    workedExamples,
    figures: [],
    checklist: ["I can justify an interpretation with textual and historical evidence."],
    practiceItems: [],
    sources: [{
      id: "source-1",
      title: "Modernism Reader",
      originUrl: "https://learn.university.example/mod/resource/view.php?id=8",
      localPath: null,
      previewPath: null,
      kind: "pdf",
    }],
    warnings: [],
  });
}
