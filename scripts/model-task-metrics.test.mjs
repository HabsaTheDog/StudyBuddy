import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeModelTasks } from "./model-task-metrics.mjs";

test("reports semantic repair work separately from additional attempts", () => {
  const [row] = summarizeModelTasks([
    { task: "content_repair", operation: "question_repair", model: "test", attempt: 1, status: "completed", reasoningOutputTokens: 12, queueWaitMs: 20 },
    { task: "content_repair", operation: "question_repair", model: "test", attempt: 2, status: "completed", reasoningOutputTokens: 8, queueWaitMs: 5 },
  ]);
  assert.equal(row.repairCalls, 2);
  assert.equal(row.retries, 1);
  assert.equal(row.reasoningOutputTokens, 20);
  assert.equal(row.queueWaitMs, 25);
});

test("separates light and hard tasks sharing a role and preserves retry/failure totals", () => {
  const common = { task: "content_analyzer", model: "gpt-test", reasoningEffort: "low", attempt: 1, status: "completed", inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, durationMs: 40 };
  const result = summarizeModelTasks([
    { ...common, operation: "content_extraction" },
    { ...common, operation: "solution_generation", durationMs: 200 },
    { ...common, operation: "solution_generation", attempt: 2, status: "failed" },
    common,
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].task, "solution_generation");
  assert.equal(result[0].calls, 2);
  assert.equal(result[0].retries, 1);
  assert.equal(result[0].failures, 1);
  assert.equal(result[0].inputTokens, 200);
  assert.equal(result[0].durationMs, 240);
});
