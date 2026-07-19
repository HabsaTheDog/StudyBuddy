import { describe, expect, it } from "vitest";
import {
  estimateAdaptiveRuntimeBudget,
  projectAdaptiveRuntime,
} from "../adaptiveRuntimeBudget.js";

describe("adaptive runtime budget", () => {
  it("keeps compact courses inside the fast target", () => {
    const budget = estimateAdaptiveRuntimeBudget({
      moduleCount: 4,
      evidenceRecordCount: 120,
      evidenceCharacters: 90_000,
      visualCandidateCount: 12,
      formulaSignalCount: 20,
    });
    expect(budget).toMatchObject({ tier: "small", runRuntimeMs: 12 * 60_000 });
    expect(budget.totalWorkflowBudgetMs).toBe(15 * 60_000);
  });

  it("grants a moderate course a larger but bounded workflow window", () => {
    const budget = estimateAdaptiveRuntimeBudget({
      moduleCount: 6,
      evidenceRecordCount: 500,
      evidenceCharacters: 500_000,
      visualCandidateCount: 70,
      formulaSignalCount: 100,
    });
    expect(budget).toMatchObject({ tier: "normal", runRuntimeMs: 18 * 60_000 });
    expect(budget.totalWorkflowBudgetMs).toBe(26 * 60_000);
  });

  it("caps large courses below forty minutes across recoveries and render", () => {
    const budget = estimateAdaptiveRuntimeBudget({
      moduleCount: 6,
      evidenceRecordCount: 3_500,
      evidenceCharacters: 2_000_000,
      visualCandidateCount: 140,
      formulaSignalCount: 900,
    });
    expect(budget).toMatchObject({ tier: "large", runRuntimeMs: 24 * 60_000 });
    expect(budget.totalWorkflowBudgetMs).toBe(38 * 60_000);
  });

  it("extends once for measured progress, then requests compact batching", () => {
    const projection = projectAdaptiveRuntime({
      runElapsedMs: 10 * 60_000,
      analysisElapsedMs: 3 * 60_000,
      completedModules: 1,
      totalModules: 6,
      currentRuntimeMs: 18 * 60_000,
      totalWorkflowBudgetMs: 26 * 60_000,
      renderReserveMs: 2 * 60_000,
      alreadyExtended: false,
    });
    expect(projection.recommendedRuntimeMs).toBe(21 * 60_000);
    expect(projection.shouldCompact).toBe(true);
  });
});
