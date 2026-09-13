import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeModelTasks } from "./model-task-metrics.mjs";

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
