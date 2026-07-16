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
    score: 1,
    wallMs: 10_000,
    modelDurationMs: 8_000,
    tokens: { input: 100, cached: 0, output: 20, reasoning: 5 },
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
