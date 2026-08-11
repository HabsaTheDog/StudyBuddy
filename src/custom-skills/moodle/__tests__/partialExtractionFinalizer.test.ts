import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      error_log: analyzerWithhold("Drallsatz", "Chapter fragment repair produced no result."),
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
    expect((result.extracted_data as { sections: Array<{ heading: string }> }).sections)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ heading: "Punktkinematik" }),
        expect.objectContaining({ heading: "Drallsatz" }),
      ]));
    expect((result.extracted_data as { warnings: string[] }).warnings.join(" "))
      .toContain("nicht vollständig abgedeckt");
    expect((result.extracted_data as { formulas: Array<{ name: string }> }).formulas)
      .toEqual([{ name: "Punktkinematik", typst: "v = dot(x)", variables: [], units: [], context: "Ableitung", source_ids: ["source-safe"] }]);
    expect((result.extracted_data as { worked_examples: Array<{ learning_goal: string }> }).worked_examples)
      .toEqual([]);
    await expect(readFile(path.join(runDir, "partial-finalization.json"), "utf8"))
      .resolves.toContain("Rejected Drallsatz relation");
    expect(canFinalizePartialExtraction({
      ...state,
      extracted_data: result.extracted_data ?? {},
    })).toBe(false);
  });

  it("finalizes different weak chapters once each without repeating either chapter", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-partial-sequence-"));
    tempDirs.push(runDir);
    const vectorState = {
      ...initialAgentState,
      retry_count: 3,
      error_log: analyzerWithhold(
        "Vektorkinematik",
        "Chapter analyzer returned no publishable local content.",
      ),
      extracted_data: extractedData(),
    };
    const first = await createPartialExtractionFinalizerNode({ runDir } as MoodleRuntimeConfig)(
      vectorState,
    );
    const pointState = {
      ...vectorState,
      error_log: semanticWithhold(
        "Punktkinematik",
        "Das Kapitel enthält ungeprüfte lokale Details.",
      ),
      extracted_data: first.extracted_data ?? {},
      study_model: {
        ...initialAgentState.study_model,
        courseChapters: [{
          id: "punktkinematik",
          title: "Punktkinematik",
          subject: "Punktkinematik",
          order: 0,
          priority: "essential" as const,
          contentMode: "quantitative" as const,
          learningObjectives: ["Punktkinematik anwenden"],
          assessmentSignals: [],
          status: "covered" as const,
          topicIds: ["topic-punktkinematik"],
          resourceIds: ["source-safe"],
        }],
      },
    };

    expect(canFinalizePartialExtraction(pointState)).toBe(true);
    const second = await createPartialExtractionFinalizerNode({ runDir } as MoodleRuntimeConfig)(
      pointState,
    );
    expect(canFinalizePartialExtraction({
      ...pointState,
      extracted_data: second.extracted_data ?? {},
    })).toBe(false);
    expect((second.extracted_data as { warnings: string[] }).warnings.join(" "))
      .toContain("Kapitel Vektorkinematik ist nicht vollständig abgedeckt");
    expect((second.extracted_data as { warnings: string[] }).warnings.join(" "))
      .toContain("Kapitel Punktkinematik ist nicht vollständig abgedeckt");
    await expect(readFile(path.join(runDir, "partial-finalization.json"), "utf8"))
      .resolves.toMatch(/"Vektorkinematik"[\s\S]*"Punktkinematik"/);
  });

  it("does not downgrade contradictions or source-integrity failures", () => {
    expect(canFinalizePartialExtraction({
      ...initialAgentState,
      retry_count: 3,
      error_log: "Analyzer failed: worked example has a mathematical contradiction and invalid citation for Drallsatz.",
      extracted_data: extractedData(),
    })).toBe(false);
  });

  it("does not withhold content to evade an explicit must requirement", () => {
    expect(canFinalizePartialExtraction({
      ...initialAgentState,
      retry_count: 3,
      error_log:
        "Semantic quality review failed:\n" +
        "- [chapter: Drallsatz] [requirement: original-request] [owner: content] " +
        "[repair: content_analyzer] The explicit requirement is still unmet.",
      extracted_data: extractedData(),
    })).toBe(false);
  });

  it("downgrades the localized DYN2 derivation and method gaps after bounded repairs", () => {
    expect(canFinalizePartialExtraction({
      ...initialAgentState,
      retry_count: 3,
      error_log:
        "Semantic quality review failed:\n" +
        "- [chapter: Schwingungen] [owner: content] [repair: content_analyzer] Nicht freigegebene lokale Details.\n" +
        "- [chapter: Massengeometrie] [owner: content] [repair: content_analyzer] Nicht freigegebene lokale Details.",
      extracted_data: extractedData(),
    })).toBe(true);
  });

  it("identifies an exhausted analyzer chapter before the study model exists", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-partial-analyzer-"));
    tempDirs.push(runDir);
    const state = {
      ...initialAgentState,
      retry_count: 3,
      error_log: analyzerWithhold(
        "Vektorkinematik",
        "Chapter analyzer returned no publishable local content.",
      ),
      extracted_data: extractedData(),
    };

    expect(canFinalizePartialExtraction(state)).toBe(true);
    const result = await createPartialExtractionFinalizerNode({ runDir } as MoodleRuntimeConfig)(state);

    expect(result.error_log).toBeNull();
    expect((result.extracted_data as { warnings: string[] }).warnings.join(" "))
      .toContain("Kapitel Vektorkinematik ist nicht vollständig abgedeckt");
    await expect(readFile(path.join(runDir, "partial-finalization.json"), "utf8"))
      .resolves.toContain('"Vektorkinematik"');
  });

  it("keeps an analyzer-stage course chapter visible as a sourced limitation", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-partial-placeholder-"));
    tempDirs.push(runDir);
    const sourceUrl = "https://moodle.example/point.pdf";
    const state = {
      ...initialAgentState,
      retry_count: 3,
      error_log: analyzerWithhold(
        "Punktkinematik",
        "Chapter fragment repair produced no result.",
      ),
      extracted_data: extractedData(),
      source_architect_decision: {
        ...initialAgentState.source_architect_decision,
        learningArchitecture: {
          schemaVersion: 1 as const,
          modules: [{
            id: "point",
            title: "Punktkinematik",
            priority: "essential" as const,
            contentMode: "quantitative" as const,
            learningObjectives: ["Geschwindigkeit und Beschleunigung bestimmen."],
            assessmentSignals: ["Rechenaufgabe"],
            resourceUrls: [sourceUrl],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      },
      resource_manifest: {
        ...initialAgentState.resource_manifest,
        resources: [{
          id: "point-source",
          parentId: null,
          originUrl: sourceUrl,
          resolvedUrl: sourceUrl,
          canonicalUrl: sourceUrl,
          localPath: "/tmp/point.pdf",
          previewPath: "/tmp/point.pdf",
          title: "Punktkinematik",
          sectionPath: ["Punktkinematik"],
          activityType: "file",
          status: "acquired" as const,
          checksum: null,
          verifiedAt: null,
          examRelevance: "confirmed" as const,
          failureReason: null,
          failureKind: null,
          recommendedAction: null,
        }],
      },
    };

    const result = await createPartialExtractionFinalizerNode({ runDir } as MoodleRuntimeConfig)(state);
    const data = result.extracted_data as ReturnType<typeof extractedData>;
    expect(data.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        heading: "Punktkinematik",
        source_ids: ["point-source"],
      }),
    ]));
    expect(data.learning_modules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Punktkinematik",
        resource_ids: ["point-source"],
      }),
    ]));
    expect(data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "point-source", kind: "pdf" }),
    ]));
  });

  it("does not downgrade a chapter merely because a generic template expected more learning depth", async () => {
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
    expect(result.study_model).toBeUndefined();
    expect(result.extracted_data).toBeUndefined();
    await expect(readFile(path.join(runDir, "partial-finalization.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
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
    }, {
      heading: "Punktkinematik",
      summary: "Validierte Einführung in die Punktkinematik.",
      key_concepts: ["Geschwindigkeit"],
      source_ids: ["source-safe"],
    }],
    formulas: [{
      name: "Rejected Drallsatz relation",
      typst: "L = I omega",
      variables: [],
      units: [],
      context: "Rejected repair",
      source_ids: ["source-1"],
    }, {
      name: "Punktkinematik",
      typst: "v = dot(x)",
      variables: [],
      units: [],
      context: "Ableitung",
      source_ids: ["source-safe"],
    }],
    worked_examples: [{
      origin: "derived",
      learning_goal: "Rejected Drallsatz example",
      prompt: "Compute L.",
      steps: ["Choose relation.", "Insert values.", "Compute.", "Check units."],
      result: "Rejected result with enough detail.",
      source_ids: ["source-1"],
    }],
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

function analyzerWithhold(chapter: string, message: string): string {
  return `Analyzer failed: [chapter: ${chapter}] [owner: content] [repair: content_analyzer] ` +
    `[fallback: withhold_affected_content] ${message}`;
}

function semanticWithhold(chapter: string, message: string): string {
  return `Semantic quality review failed:\n- [chapter: ${chapter}] [owner: content] ` +
    `[repair: content_analyzer] ${message}`;
}
