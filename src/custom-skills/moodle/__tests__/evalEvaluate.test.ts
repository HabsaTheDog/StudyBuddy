import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvalCorpusSchema } from "../evals/corpus.js";
import { evaluateWorkflow } from "../evals/evaluate.js";
import { studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("evaluateWorkflow", () => {
  it("separates reliability from efficiency and counts cached input only once", async () => {
    const workflowDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-eval-"));
    const extractionDir = path.join(workflowDir, "extraction");
    const renderDir = path.join(workflowDir, "render");
    await mkdir(extractionDir);
    await mkdir(renderDir);
    await Promise.all([
      writeFile(path.join(extractionDir, "run-summary.md"), "Run status: success\n", "utf8"),
      writeFile(path.join(renderDir, "run-summary.md"), "Run status: success\n", "utf8"),
      writeFile(path.join(extractionDir, "error.log"), "", "utf8"),
      writeFile(path.join(renderDir, "error.log"), "", "utf8"),
      writeFile(
        path.join(extractionDir, "quality-review.json"),
        JSON.stringify({ ok: true, blocking_findings: [] }),
        "utf8",
      ),
      writeFile(path.join(renderDir, "document.typ"), studyBuddyTypstDocument(), "utf8"),
      writeFile(path.join(renderDir, "document.pdf"), "pdf", "utf8"),
      writeFile(
        path.join(renderDir, "study-model.json"),
        JSON.stringify({
          language: "en",
          courseTitle: "DYN2",
          courseChapters: [{
            id: "c1",
            title: "Derivative",
            contentMode: "conceptual",
            status: "covered",
            resourceIds: ["s1"],
          }],
          topics: [{ id: "t1", chapterId: "c1", title: "Derivative", sourceIds: ["s1"] }],
          formulas: [{ id: "f1", chapterId: "c1", name: "Derivative", sourceIds: ["s1"] }],
          workedExamples: [{ id: "e1", chapterId: "c1", prompt: "Derivative", sourceIds: ["s1"] }],
          sources: [{ id: "s1", title: "Lecture" }],
        }),
        "utf8",
      ),
      writeFile(path.join(extractionDir, "run-metrics.json"), JSON.stringify(metrics()), "utf8"),
      writeFile(path.join(renderDir, "run-metrics.json"), JSON.stringify(metrics({
        wallMs: 100,
        totals: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          modelCalls: 0,
          modelDurationMs: 0,
          modelQueueWaitMs: 0,
          retries: 0,
        },
        modelCalls: [],
      })), "utf8"),
    ]);
    const evalCase = EvalCorpusSchema.parse({
      schemaVersion: 1,
      id: "test",
      version: "1",
      cases: [{
        id: "case",
        revision: 1,
        prompt: "Create a guide",
        expected: {
          minTopics: 1,
          minFormulas: 1,
          minWorkedExamples: 1,
          maxWorkedExamples: 1,
          minSources: 1,
          maxFormulas: 1,
          requiredCourseLabel: "DYN2",
          requiredLanguage: "en",
          requiredContentModes: ["conceptual"],
          requiredTerms: ["derivative"],
          maxFreshInputTokens: 150,
          maxModelCalls: 1,
        },
      }],
    }).cases[0];

    const result = await evaluateWorkflow(workflowDir, "balanced", evalCase);

    expect(result.reliabilityPassed).toBe(true);
    expect(result.efficiencyPassed).toBe(false);
    expect(result.tokens).toMatchObject({
      input: 1_000,
      cached: 800,
      fresh: 200,
      output: 100,
      billableProxy: 300,
    });
    expect(result.checks.find((check) => check.id === "fresh-input-tokens")).toMatchObject({
      category: "efficiency",
      passed: false,
    });
  });
});

function metrics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    policyVersion: "test",
    profile: "balanced",
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    wallMs: 1_000,
    configuredDownloadConcurrency: 1,
    totals: {
      inputTokens: 1_000,
      cachedInputTokens: 800,
      outputTokens: 100,
      reasoningOutputTokens: 20,
      modelCalls: 1,
      modelDurationMs: 500,
      modelQueueWaitMs: 0,
      retries: 0,
    },
    phases: [],
    modelCalls: [{
      id: "content_analyzer-1",
      task: "content_analyzer",
      attempt: 1,
      model: "test",
      reasoningEffort: "medium",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.500Z",
      durationMs: 500,
      requestCharacters: 2_000,
      schemaCharacters: 500,
      status: "completed",
      inputTokens: 1_000,
      cachedInputTokens: 800,
      outputTokens: 100,
      reasoningOutputTokens: 20
    }],
    resources: {
      discovered: 2,
      selected: 1,
      started: 1,
      completed: 1,
      failed: 0,
      timedOut: 0,
      canceled: 0,
      bytes: 100,
    },
    ...overrides,
  };
}
