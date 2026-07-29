import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyOfflineSecurityPolicy } from "../htmlShell.js";
import { InteractiveEvalCorpusSchema } from "../evals/corpus.js";
import { evaluateInteractiveRun } from "../evals/evaluate.js";
import { renderStandardStudyGuide } from "../standardStudyGuideRenderer.js";
import type { StudyGuideContent } from "../studyGuideContent.js";
import { validateSingleFileHtml } from "../validation.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("interactive benchmark replay", () => {
  it("separates quality from efficiency and combines extraction with web metrics", async () => {
    const workflowDir = await mkdtemp(path.join(os.tmpdir(), "interactive-eval-"));
    tempDirs.push(workflowDir);
    const extractionDir = path.join(workflowDir, "extraction");
    const webDir = path.join(workflowDir, "web-layout");
    await Promise.all([mkdir(extractionDir), mkdir(webDir)]);
    const content = testContent();
    const html = applyOfflineSecurityPolicy(renderStandardStudyGuide(content, "en"))
      .replace('src="assets/logo.png"', 'src="data:image/png;base64,iVBORw0KGgo="');
    expect(validateSingleFileHtml(html, "study-guide").issues).toEqual([]);
    await Promise.all([
      writeFile(path.join(webDir, "document.html"), html, "utf8"),
      writeFile(path.join(webDir, "run-summary.md"), "Run status: success\n", "utf8"),
      writeFile(path.join(webDir, "validation-report.json"), JSON.stringify({ ok: true }), "utf8"),
      writeFile(path.join(webDir, "quality-review.json"), JSON.stringify({ ok: true, findings: [] }), "utf8"),
      writeFile(path.join(webDir, "study-guide-content.json"), JSON.stringify(content), "utf8"),
      writeFile(path.join(extractionDir, "run-metrics.json"), JSON.stringify(metrics(1_000, 700, 600)), "utf8"),
      writeFile(path.join(webDir, "run-metrics.json"), JSON.stringify(metrics(500, 400, 300)), "utf8"),
    ]);
    const evalCase = InteractiveEvalCorpusSchema.parse({
      schemaVersion: 1,
      id: "test",
      version: "1",
      cases: [{
        id: "literature",
        revision: 1,
        prompt: "Build the guide",
        language: "en",
        expected: {
          requiredLanguage: "en",
          minTopics: 4,
          minExercises: 12,
          minApplications: 3,
          minWorkedExamples: 4,
          minSources: 1,
          maxFormulas: 0,
          maxFreshInputTokens: 150,
          minCacheHitRate: 0.5,
        },
      }],
    }).cases[0];

    const result = await evaluateInteractiveRun(workflowDir, evalCase);

    expect(result.checks.filter((check) => check.category === "reliability" && !check.passed)).toEqual([]);
    expect(result.reliabilityPassed).toBe(true);
    expect(result.qualityPassed).toBe(true);
    expect(result.efficiencyPassed).toBe(false);
    expect(result.structure).toMatchObject({
      topics: 4,
      exercises: 12,
      applicationExercises: 4,
      workedExamples: 4,
    });
    expect(result.efficiency).toMatchObject({
      wallMs: 1_500,
      inputTokens: 1_100,
      cachedInputTokens: 900,
      freshInputTokens: 200,
      modelCalls: 2,
    });
    expect(result.checks.find((check) => check.id === "fresh-input-tokens")).toMatchObject({
      category: "efficiency",
      passed: false,
    });
  });
});

function testContent(): StudyGuideContent {
  const source = {
    label: "Course reader",
    sourceTask: "Unit evidence",
    provenance: "source" as const,
  };
  return {
    courseTitle: "World Literature",
    courseCode: "HUM",
    scopeNote: "Covers the supplied units and their representative applications.",
    topics: Array.from({ length: 4 }, (_, topicIndex) => ({
      id: `topic-${topicIndex + 1}`,
      title: `Course unit ${topicIndex + 1}`,
      learningGoals: [`Apply the central idea from unit ${topicIndex + 1}.`],
      theory: {
        summary: `This unit develops a source-grounded interpretive concept and shows how precise observations support a defensible conclusion in a new context. ${"Evidence matters. ".repeat(3)}`,
        keyIdeas: ["Separate observation from interpretation.", "Support conclusions with concrete evidence."],
        formulas: [],
      },
      workedExamples: [{
        title: `Worked interpretation ${topicIndex + 1}`,
        prompt: "How does the example connect evidence to an interpretation?",
        steps: ["Identify the concrete observation.", "Explain the inference supported by it."],
        answer: "The interpretation follows from an explicit feature of the source.",
        source,
      }],
      exercises: Array.from({ length: 3 }, (_, exerciseIndex) => {
        const index = topicIndex * 3 + exerciseIndex + 1;
        if (exerciseIndex === 2) {
          return {
            id: `application-${index}`,
            type: "application" as const,
            prompt: `Develop a source-based interpretation for passage ${index}.`,
            instructions: ["Identify one concrete observation.", "Explain the interpretation it supports."],
            sampleAnswer: "The repeated contrast makes the narrator's judgment appear deliberately uncertain.",
            selfCheck: ["The response names an observation.", "The interpretation follows from that observation."],
            source,
          };
        }
        return {
          id: `selection-${index}`,
          type: "cross" as const,
          prompt: `Which interpretation is best supported by the evidence in example ${index}?`,
          selectionMode: "single" as const,
          options: [
            { text: "The interpretation that cites a concrete textual feature.", correct: true, feedback: "Correct." },
            { text: "The interpretation based only on preference.", correct: false, feedback: "Preference is not evidence." },
            { text: "The interpretation that ignores the passage.", correct: false, feedback: "It must remain source-grounded." },
          ],
          explanation: "A defensible interpretation connects its claim to a concrete source observation.",
          source,
        };
      }),
      retrieval: [{ prompt: "What supports an interpretation?", answer: "A concrete observation from the source." }],
    })),
    sources: [{ id: "reader", label: "Course reader", url: "", coverage: "All four course units" }],
  };
}

function metrics(wallMs: number, inputTokens: number, cachedInputTokens: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    policyVersion: "test",
    profile: "balanced",
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    wallMs,
    configuredDownloadConcurrency: 1,
    totals: {
      inputTokens,
      cachedInputTokens,
      freshInputTokens: inputTokens - cachedInputTokens,
      outputTokens: 100,
      reasoningOutputTokens: 0,
      modelCalls: 1,
      modelDurationMs: wallMs,
      modelQueueWaitMs: 0,
      retries: 0,
      toolCalls: 0,
      leafToolPolicyViolations: 0
    },
    phases: [],
    modelCalls: [],
    resources: {
      discovered: 0,
      selected: 0,
      started: 0,
      completed: 0,
      failed: 0,
      timedOut: 0,
      canceled: 0,
      bytes: 0
    }
  };
}
