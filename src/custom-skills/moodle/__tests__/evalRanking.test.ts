import { describe, expect, it } from "vitest";
import type { EvalRunResult } from "../evals/evaluate.js";
import { rankEvalProfiles } from "../evals/ranking.js";

function result(
  profile: string,
  input: Partial<Pick<EvalRunResult, "passed" | "score" | "wallMs">> = {},
): EvalRunResult {
  return {
    workflowDir: `/tmp/${profile}`,
    profile,
    passed: true,
    reliabilityPassed: true,
    efficiencyPassed: true,
    score: 1,
    efficiencyScore: 1,
    wallMs: 10_000,
    modelDurationMs: 8_000,
    tokens: { input: 100, cached: 0, fresh: 100, output: 20, reasoning: 5, billableProxy: 120, cacheHitRate: 0 },
    operations: {
      modelCalls: 2,
      retries: 0,
      toolCalls: 0,
      leafToolPolicyViolations: 0,
      maxInputAmplification: 1,
      amplificationObservedCalls: 2,
      selectedResources: 2,
      resourceAttempts: 2,
      promptBudgetViolations: 0,
    },
    content: {
      topics: 4,
      formulas: 2,
      workedExamples: 1,
      sources: 2,
      courseChapters: 2,
      coveredChapters: 2,
      officialTopicMappings: 0,
      officialTopicNumbers: [],
      practiceTopicMappings: 0,
      practiceTopicNumbers: [],
      chapterRoadmaps: 2,
      chaptersWithMultipleTopics: 1,
      chaptersWithWorkedExamples: 1,
      contentModes: ["mixed"],
      structureFingerprint: "stable",
    },
    tasks: [],
    checks: [],
    ...input,
  };
}

describe("rankEvalProfiles", () => {
  it("recommends the fastest passing profile only after quality gates pass", () => {
    const ranked = rankEvalProfiles([
      { caseId: "guide", result: result("fast", { passed: false, score: 0.9, wallMs: 3_000 }) },
      { caseId: "guide", result: result("balanced", { wallMs: 8_000 }) },
      { caseId: "guide", result: result("quality", { wallMs: 15_000 }) },
    ]);

    expect(ranked[0]).toMatchObject({ profile: "balanced", recommended: true, rank: 1 });
    expect(ranked.at(-1)).toMatchObject({ profile: "fast", recommended: false });
  });
});
