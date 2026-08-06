import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canFinalizePartialExtraction,
  createPartialExtractionFinalizerNode,
} from "../nodes/partialExtractionFinalizerNode.js";
import { createReviewNode } from "../nodes/reviewNode.js";
import { initialAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("partial extraction finalizer", () => {
  it("keeps validated content and discloses one exhausted local application gap", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-partial-finalizer-"));
    tempDirs.push(runDir);
    const state = {
      ...initialAgentState,
      retry_count: 3,
      error_log: "Analyzer failed: Chapter fragment repair produced no result for Drallsatz.",
      extracted_data: extractedData(),
      study_model: {
        ...initialAgentState.study_model,
        language: "de" as const,
        courseChapters: [{
          id: "drallsatz",
          title: "Drallsatz",
          subject: "Drallsatz",
          order: 0,
          priority: "essential" as const,
          contentMode: "quantitative" as const,
          learningObjectives: ["Drallsatz anwenden"],
          assessmentSignals: [],
          status: "covered" as const,
          topicIds: ["topic-drallsatz"],
          resourceIds: ["source-1"],
        }],
      },
    };

    expect(canFinalizePartialExtraction(state)).toBe(true);
    const result = await createPartialExtractionFinalizerNode({ runDir } as MoodleRuntimeConfig)(state);
    expect(result.error_log).toBeNull();
    expect(result.extracted_data).toMatchObject({
      sections: [{ heading: "Drallsatz" }],
    });
    expect((result.extracted_data as { warnings: string[] }).warnings.join(" "))
      .toContain("nicht vollständig abgedeckt");
  });

  it("does not downgrade contradictions or source-integrity failures", () => {
    expect(canFinalizePartialExtraction({
      ...initialAgentState,
      retry_count: 3,
      error_log: "Analyzer failed: worked example has a mathematical contradiction and invalid citation for Drallsatz.",
      extracted_data: extractedData(),
    })).toBe(false);
  });

  it("publishes a transparent partial chapter after the third shallow-content review", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-partial-review-"));
    tempDirs.push(runDir);
    const chapter = {
      id: "drallsatz",
      title: "Drallsatz",
      subject: "Drallsatz",
      order: 0,
      priority: "essential" as const,
      contentMode: "quantitative" as const,
      learningObjectives: ["Drallsatz anwenden"],
      assessmentSignals: [],
      status: "covered" as const,
      topicIds: ["topic-drallsatz"],
      resourceIds: ["source-1"],
    };
    const result = await createReviewNode({ runDir } as MoodleRuntimeConfig)({
      ...initialAgentState,
      retry_count: 2,
      extracted_data: extractedData(),
      coverage_assessment: {
        ...initialAgentState.coverage_assessment,
        status: "complete",
        detail: "Course evidence acquired.",
      },
      study_model: {
        ...initialAgentState.study_model,
        publicationStatus: "complete",
        courseChapters: [chapter],
        topics: [{
          id: "topic-drallsatz",
          chapterId: "drallsatz",
          title: "Drallsatz",
          summary: "Der Drehimpuls wird aus den belegten Größen bestimmt und über die Momentenbilanz eingeordnet.",
          priority: "essential",
          scopeStatus: "confirmed",
          learningGoals: ["Die Momentenbilanz fachlich einordnen."],
          sourceIds: ["source-1"],
        }],
        sources: [{
          id: "source-1",
          title: "Skript",
          originUrl: "https://moodle.example/script.pdf",
          localPath: null,
          previewPath: null,
          kind: "pdf",
        }],
      },
    });

    expect(result.error_log).toBeNull();
    expect(result.review_report?.ok).toBe(true);
    expect(result.study_model?.publicationStatus).toBe("partial");
    expect(result.study_model?.courseChapters[0]?.status).toBe("partial");
    expect((result.extracted_data as { warnings: string[] }).warnings.join(" "))
      .toContain("nicht vollständig abgedeckt");
  });
});

function extractedData() {
  return {
    document_title: "DYN2 Study Guide",
    language: "de",
    course: { title: "DYN2", url: "https://moodle.example/course" },
    sources: [{
      id: "source-1",
      title: "Skript",
      kind: "pdf",
      url: "https://moodle.example/script.pdf",
      path: null,
      page: 1,
    }],
    sections: [{
      heading: "Drallsatz",
      summary: "Validierte Einführung in den Drallsatz.",
      key_concepts: ["Drehimpuls"],
      source_ids: ["source-1"],
    }],
    formulas: [],
    worked_examples: [],
    quiz_style_questions: [],
    visual_assets: [],
    figures: [],
    learning_modules: [{
      id: "drallsatz",
      title: "Drallsatz",
      priority: "essential",
      content_mode: "quantitative",
      learning_objectives: ["Drallsatz anwenden"],
      assessment_signals: [],
      resource_ids: ["source-1"],
    }],
    warnings: [],
  };
}
