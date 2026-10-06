import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const fields = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens"];
const empty = () => Object.fromEntries(fields.map((field) => [field, 0]));
const valid = (value) => Number.isFinite(value) && value >= 0;

// Provider snapshots are cumulative PER NATIVE THREAD, not per-notification
// increments. Retaining native IDs also prevents conflating child and parent.
export function providerTurnUsage(provider) {
  if (
    !provider ||
    provider.scopeSemantics !== "exclusive" ||
    !provider.delegationComplete ||
    !Array.isArray(provider.threads) ||
    !provider.threads.length
  ) {
    return {
      complete: false,
      knownTokens: empty(),
      reason: "Missing exclusive coordinator/delegate coverage or turn boundary snapshots.",
    };
  }
  const ids = new Set();
  const knownTokens = empty();
  for (const thread of provider.threads) {
    if (!thread.id || ids.has(thread.id) || !["coordinator", "delegate"].includes(thread.role))
      throw new Error("Provider thread IDs and scopes must be unique and explicit.");
    ids.add(thread.id);
    if (thread.fresh && thread.before)
      throw new Error("A fresh thread cannot also have a prior usage snapshot.");
    for (const field of fields) {
      const key = `total${field[0].toUpperCase()}${field.slice(1)}`;
      const before = thread.fresh ? 0 : thread.before?.[key];
      const after = thread.after?.[key];
      if (!valid(before) || !valid(after) || after < before)
        return {
          complete: false,
          knownTokens: empty(),
          reason: "Provider counters missing or reset across the requested turn.",
        };
      if (thread.after.providerThreadId && thread.after.providerThreadId !== thread.id)
        throw new Error("Provider snapshot belongs to another native thread.");
      knownTokens[field] += after - before;
    }
  }
  if (provider.threads.filter((thread) => thread.role === "coordinator").length !== 1)
    throw new Error("Declare exactly one coordinator and all exclusive native delegates.");
  return { complete: true, knownTokens, nativeThreads: ids.size };
}

export function accountRun({
  calls,
  probes = [],
  provider,
  wallMs,
  workflowCoverageComplete = false,
}) {
  const knownTokens = empty();
  const seen = new Set();
  const logical = new Set();
  let unknownUsageCalls = 0;
  let dispatches = 0;
  let transportRetries = 0;
  let semanticRetryDispatches = 0;
  let modelDurationMs = 0;
  let queueWaitMs = 0;
  for (const call of calls) {
    if (call.id && seen.has(call.id)) continue;
    if (call.id) seen.add(call.id);
    dispatches += 1;
    logical.add(call.logicalCallId ?? call.id ?? Symbol());
    transportRetries += Number((call.transportAttempt ?? 1) > 1);
    semanticRetryDispatches += Number(call.attempt > 1);
    modelDurationMs += call.durationMs ?? 0;
    queueWaitMs += call.queueWaitMs ?? 0;
    const known = call.usageAvailable === true && fields.every((field) => valid(call[field]));
    if (!known) unknownUsageCalls += 1;
    for (const field of fields) if (valid(call[field])) knownTokens[field] += call[field];
  }
  let probeCalls = 0;
  let unknownProbeUsage = 0;
  let probeDurationMs = 0;
  for (const probe of probes) {
    if (probe.status === "cached") continue;
    probeCalls += 1;
    probeDurationMs += probe.durationMs ?? 0;
    const values = [
      probe.usage?.input_tokens,
      probe.usage?.cached_input_tokens,
      probe.usage?.output_tokens,
      probe.usage?.reasoning_output_tokens,
    ];
    if (!probe.usageAvailable || !values.every(valid)) unknownProbeUsage += 1;
    fields.forEach((field, index) => {
      if (valid(values[index])) knownTokens[field] += values[index];
    });
  }
  const native = providerTurnUsage(provider);
  for (const field of fields) knownTokens[field] += native.knownTokens[field];
  return {
    complete:
      workflowCoverageComplete &&
      unknownUsageCalls === 0 &&
      unknownProbeUsage === 0 &&
      native.complete,
    workflowCoverageComplete,
    knownTokens: {
      ...knownTokens,
      freshInputTokens: Math.max(0, knownTokens.inputTokens - knownTokens.cachedInputTokens),
    },
    unknownUsageCalls,
    unknownProbeUsage,
    native,
    workflowDispatches: dispatches,
    logicalWorkflowCalls: logical.size,
    transportRetries,
    semanticRetryDispatches,
    probeCalls,
    modelDurationMs,
    probeDurationMs,
    queueWaitMs,
    wallMs: valid(provider?.wallMs) ? provider.wallMs : (wallMs ?? null),
    wallScope: valid(provider?.wallMs) ? "whole-turn" : "workflow-only",
  };
}

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
export async function readRunAccounting(runDir) {
  const provider = await optionalJson(path.join(runDir, "provider-turn-usage.json"));
  const declared = Array.isArray(provider?.workflowRunDirs) ? provider.workflowRunDirs : [];
  const runDirs = [
    ...new Set([
      path.resolve(runDir),
      ...declared.map((directory) => path.resolve(runDir, directory)),
    ]),
  ];
  const calls = [];
  const probes = [];
  let wallMs;
  for (const directory of runDirs) {
    const metrics = await optionalJson(path.join(directory, "run-metrics.json"));
    let interactive = [];
    try {
      interactive = (await readFile(path.join(directory, "run-model-calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!metrics && !interactive.length) throw new Error(`No workflow metrics in ${directory}`);
    calls.push(...(metrics?.modelCalls ?? []), ...interactive);
    const runtime = await optionalJson(path.join(directory, "codex-runtime.json"));
    probes.push(...(runtime?.modelProbes ?? []));
    if (directory === path.resolve(runDir)) wallMs = metrics?.wallMs;
  }
  const workflowCoverageComplete =
    provider?.workflowCoverageComplete === true &&
    declared.length > 0 &&
    declared.some((directory) => path.resolve(runDir, directory) === path.resolve(runDir));
  return accountRun({ calls, probes, provider, wallMs, workflowCoverageComplete });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2])
    throw new Error("Usage: node scripts/study-buddy-run-accounting.mjs <run-dir>");
  console.log(JSON.stringify(await readRunAccounting(process.argv[2]), null, 2));
}
