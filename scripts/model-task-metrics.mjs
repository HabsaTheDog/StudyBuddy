import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function summarizeModelTasks(calls) {
  const groups = new Map();
  for (const call of calls) {
    const task = call.operation ?? call.task;
    const key = JSON.stringify([task, call.model, call.reasoningEffort]);
    const row = groups.get(key) ?? {
      task, model: call.model, reasoningEffort: call.reasoningEffort,
      calls: 0, retries: 0, failures: 0, durationMs: 0,
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, policySources: [],
    };
    row.calls++;
    row.retries += Number(call.attempt > 1);
    row.failures += Number(call.status !== "completed");
    for (const metric of ["durationMs", "inputTokens", "cachedInputTokens", "outputTokens"]) row[metric] += call[metric] ?? 0;
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
