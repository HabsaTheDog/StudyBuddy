import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initialAgentState } from "../state.js";
import { ExecutionTelemetry, type ModelCallMetric } from "../executionTelemetry.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateAdaptiveRuntimeBudget,
  projectAdaptiveRuntime,
  applyAdaptiveExtractionBudget,
  prepareAdaptiveQualityReviewBudget,
  updateAdaptiveQualityReviewProgress,
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

let runtimeDir: string | undefined;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (runtimeDir) await rm(runtimeDir, { recursive: true, force: true }); });

async function reviewConfig(ownerLimit?: number) {
  runtimeDir = await mkdtemp(path.join(os.tmpdir(), "review-runtime-"));
  const config = moodleTestConfig({ runDir: runtimeDir, stage: "extract", maxRuntimeMs: ownerLimit ?? 840000,
    maxRuntimeSource: ownerLimit === undefined ? "default" : "explicit", maxRuntimeLimitMs: ownerLimit, codexModel: "gpt-6.1-sol", codexReasoningEffort: "medium" });
  config.executionTelemetry = new ExecutionTelemetry({ runDir: runtimeDir, policyVersion: "test", profile: config.executionProfile, configuredDownloadConcurrency: 1 });
  await applyAdaptiveExtractionBudget(config, initialAgentState, 5);
  const snapshot = config.executionTelemetry.getSnapshot();
  vi.spyOn(config.executionTelemetry, "getSnapshot").mockImplementation(() => ({ ...snapshot,
    startedAt: new Date(Date.now() - 15 * 60000).toISOString(),
    modelCalls: [{ task: "quality_reviewer", operation: "content_review", model: "gpt-6.1-sol", reasoningEffort: "medium", status: "completed", durationMs: 30000 } as ModelCallMetric],
  }));
  return config;
}

describe("complete-review adaptive runtime", () => {
  it("sizes actual fourteen-packet work into existing large24/38 tier", async () => {
    const config = await reviewConfig();
    await prepareAdaptiveQualityReviewBudget(config, 14);
    expect(config.maxRuntimeMs).toBe(24 * 60000);
    const budget = JSON.parse(await readFile(path.join(config.runDir, "adaptive-budget.json"), "utf8"));
    expect(budget).toMatchObject({ tier: "large", totalWorkflowBudgetMs: 38 * 60000, reviewPacketCount: 14 });
  });
  it("extends measured packet progress only inside the existing finite ceiling", async () => {
    const config = await reviewConfig();
    await prepareAdaptiveQualityReviewBudget(config, 14);
    const original = config.executionTelemetry!.getSnapshot();
    vi.mocked(config.executionTelemetry!.getSnapshot).mockReturnValue({ ...original, startedAt: new Date(Date.now() - 29 * 60000).toISOString() });
    await updateAdaptiveQualityReviewProgress(config, 1, 14);
    expect(config.maxRuntimeMs).toBeGreaterThan(29 * 60000);
    expect(config.maxRuntimeMs).toBeLessThanOrEqual(36 * 60000);
  });
  it.each([840000, 123000])("never relaxes explicit owner limit %i", async ownerLimit => {
    const config = await reviewConfig(ownerLimit);
    await prepareAdaptiveQualityReviewBudget(config, 14);
    await updateAdaptiveQualityReviewProgress(config, 1, 14);
    expect(config.maxRuntimeMs).toBeLessThanOrEqual(ownerLimit);
  });
  it("retains absolute owner deadline and render reserve", async () => {
    const config = await reviewConfig();
    vi.stubEnv("STUDY_BUDDY_WORKFLOW_DEADLINE_MS", String(Date.now() + 5 * 60000));
    await prepareAdaptiveQualityReviewBudget(config, 14);
    expect(config.maxRuntimeMs).toBeLessThanOrEqual(18 * 60000);
  });
  it("admits a measured repair round before the previous tier deadline expires", async () => {
    const config = await reviewConfig();
    await prepareAdaptiveQualityReviewBudget(config, 14);
    const snapshot = config.executionTelemetry!.getSnapshot();
    vi.mocked(config.executionTelemetry!.getSnapshot).mockReturnValue({ ...snapshot, startedAt: new Date(Date.now() - 23.9 * 60000).toISOString() });
    await prepareAdaptiveQualityReviewBudget(config, 14, 2);
    expect(config.maxRuntimeMs).toBeGreaterThan(31 * 60000);
    expect(config.maxRuntimeMs).toBeLessThanOrEqual(36 * 60000);
  });
  it("preserves large tier across an actual subsequent analyzer repair", async () => {
    const config = await reviewConfig();
    await prepareAdaptiveQualityReviewBudget(config, 14);
    await applyAdaptiveExtractionBudget(config, initialAgentState, 5);
    expect(config.maxRuntimeMs).toBe(24 * 60000);
    const budget = JSON.parse(await readFile(path.join(config.runDir, "adaptive-budget.json"), "utf8"));
    expect(budget).toMatchObject({ tier: "large", totalWorkflowBudgetMs: 38 * 60000 });
  });
  it("keeps missing duration history finite without allocating every retry timeout", async () => {
    const config = await reviewConfig();
    const snapshot = config.executionTelemetry!.getSnapshot();
    vi.mocked(config.executionTelemetry!.getSnapshot).mockReturnValue({ ...snapshot, modelCalls: [] });
    await prepareAdaptiveQualityReviewBudget(config, 14);
    expect(config.maxRuntimeMs).toBe(24 * 60000);
    expect(config.workflowDeadlineMs! - Date.parse(snapshot.startedAt)).toBe(38 * 60000);
  });
  it("uses active time rather than queued wall time", async () => {
    const config = await reviewConfig();
    vi.spyOn(config.executionTelemetry!, "getRuntimeBudgetPausedMs").mockReturnValue(10 * 60000);
    await prepareAdaptiveQualityReviewBudget(config, 14);
    expect(config.maxRuntimeMs).toBe(18 * 60000);
  });
});
