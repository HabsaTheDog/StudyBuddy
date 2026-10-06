import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function summarizeModelTasks(calls) {
  const groups = new Map();
  const logicalGroups = new Map();
  for (const call of calls) {
    const task = call.operation ?? call.task;
    const key = JSON.stringify([task, call.model, call.reasoningEffort]);
    const row = groups.get(key) ?? {
      task, model: call.model, reasoningEffort: call.reasoningEffort,
      logicalCalls: 0, transportRetries: 0, unknownUsageCalls: 0, freshInputTokens: 0,
      calls: 0, retries: 0, repairCalls: 0, failures: 0, durationMs: 0,
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, queueWaitMs: 0, policySources: [],
    };
    row.calls++;
    const logical = logicalGroups.get(key) ?? new Set();
    logical.add(call.logicalCallId ?? call.id ?? Symbol()); logicalGroups.set(key, logical);
    row.logicalCalls = logical.size;
    row.transportRetries += Number((call.transportAttempt ?? 1) > 1);
    row.unknownUsageCalls += Number(call.usageAvailable !== true);
    row.freshInputTokens += call.freshInputTokens ?? Math.max(0, (call.inputTokens ?? 0) - (call.cachedInputTokens ?? 0));
    row.retries += Number(call.attempt > 1);
    row.repairCalls += Number(call.task?.endsWith("_repair") || call.operation?.endsWith("_repair") || false);
    row.failures += Number(call.status !== "completed");
    for (const metric of ["durationMs", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "queueWaitMs"]) row[metric] += call[metric] ?? 0;
    if (call.policySource && !row.policySources.includes(call.policySource)) row.policySources.push(call.policySource);
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.durationMs - a.durationMs);
}

async function main(runDirs) {
  if (!runDirs.length) throw new Error("Usage: node scripts/model-task-metrics.mjs <run-directory> [...run-directories]");
  const calls = [];
  for (const runDir of runDirs) {
    let found = false;
    for (const file of ["run-metrics.json", "run-model-calls.jsonl"]) {
      let text;
      try { text = await readFile(path.join(runDir, file), "utf8"); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      found = true;
      calls.push(...(file.endsWith(".jsonl") ? text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : JSON.parse(text).modelCalls));
    }
    if (!found) throw new Error(`No model-call metrics found in ${runDir}`);
  }
  console.log(JSON.stringify({ runs: runDirs.length, tasks: summarizeModelTasks(calls) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
