import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionTelemetry } from "../executionTelemetry.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("ExecutionTelemetry", () => {
  it("pauses execution-budget accounting while a configured queue is waiting", () => {
    const telemetry = new ExecutionTelemetry({
      runDir: "/tmp/study-buddy-budget-pause-test",
      policyVersion: "test-policy",
      profile: "balanced",
      configuredDownloadConcurrency: 3,
    });
    const resume = telemetry.pauseRuntimeBudget(1_000);
    expect(telemetry.runtimeBudgetPaused).toBe(true);
    expect(telemetry.getRuntimeBudgetPausedMs(1_750)).toBe(750);
    resume(2_000);
    expect(telemetry.runtimeBudgetPaused).toBe(false);
    expect(telemetry.getRuntimeBudgetPausedMs(5_000)).toBe(1_000);
  });

  it("persists phase spans and aggregate model usage without prompt content", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-metrics-"));
    const telemetry = new ExecutionTelemetry({
      runDir,
      policyVersion: "test-policy",
      profile: "fast",
      configuredDownloadConcurrency: 3,
    });
    await telemetry.init();
    await telemetry.transitionPhase("planning_sources", "2026-07-14T00:00:00.000Z");
    await telemetry.transitionPhase("analyzing", "2026-07-14T00:00:01.000Z");
    await telemetry.recordModelCall({
      id: "analyzer-1",
      task: "content_analyzer",
      attempt: 1,
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      startedAt: "2026-07-14T00:00:01.000Z",
      completedAt: "2026-07-14T00:00:03.000Z",
      durationMs: 2_000,
      queueWaitMs: 750,
      requestCharacters: 12_000,
      schemaCharacters: 2_000,
      status: "completed",
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 5,
    });
    await telemetry.complete("success");

    const metricsText = await readFile(telemetry.metricsPath, "utf8");
    const metrics = JSON.parse(metricsText);
    expect(metrics).toMatchObject({
      status: "success",
      policyVersion: "test-policy",
      totals: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        modelCalls: 1,
        modelDurationMs: 2_000,
        modelQueueWaitMs: 750,
      },
    });
    expect(metrics.phases[0]).toMatchObject({ phase: "planning_sources", durationMs: 1_000 });
    expect(metricsText).not.toContain("prompt");
    await expect(stat(telemetry.spansPath)).resolves.toMatchObject({ size: expect.any(Number) });
  });
});
