import test from "node:test";
import assert from "node:assert/strict";
import { accountRun, providerTurnUsage } from "./study-buddy-run-accounting.mjs";
import { compareArchitectureSamples } from "./compare-study-buddy-architectures.mjs";
const usage = {
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 10,
  reasoningOutputTokens: 4,
};
const total = Object.fromEntries(
  Object.entries(usage).map(([key, value]) => [
    `total${key[0].toUpperCase()}${key.slice(1)}`,
    value,
  ]),
);
const provider = {
  scopeSemantics: "exclusive",
  delegationComplete: true,
  wallMs: 300,
  threads: [
    { id: "parent", role: "coordinator", fresh: true, after: total },
    {
      id: "child",
      role: "delegate",
      before: total,
      after: Object.fromEntries(Object.entries(total).map(([key, value]) => [key, value * 2])),
    },
  ],
};
test("accounts for coordinator and delegate deltas without adding cumulative snapshots", () => {
  const result = providerTurnUsage(provider);
  assert.equal(result.complete, true);
  assert.equal(result.knownTokens.inputTokens, 200);
  assert.equal(providerTurnUsage({ ...provider, delegationComplete: false }).complete, false);
  assert.throws(
    () => providerTurnUsage({ ...provider, threads: [provider.threads[0], provider.threads[0]] }),
    /unique/,
  );
});
test("counts fallback as one logical call and retains unknown failed-call usage", () => {
  const calls = [
    {
      id: "a",
      logicalCallId: "logical",
      transportAttempt: 1,
      usageAvailable: false,
      attempt: 1,
      durationMs: 5,
    },
    {
      id: "b",
      logicalCallId: "logical",
      transportAttempt: 2,
      usageAvailable: true,
      attempt: 1,
      durationMs: 20,
      ...usage,
    },
  ];
  const result = accountRun({ calls: [...calls, calls[1]], provider });
  assert.equal(result.workflowDispatches, 2);
  assert.equal(result.logicalWorkflowCalls, 1);
  assert.equal(result.transportRetries, 1);
  assert.equal(result.unknownUsageCalls, 1);
  assert.equal(result.complete, false);
  assert.equal(result.knownTokens.inputTokens, 300);
});
test("blocks mismatched inputs and incomplete accounting from performance claims", () => {
  const accounting = accountRun({
    calls: [{ id: "a", attempt: 1, usageAvailable: true, ...usage }],
    provider,
    workflowCoverageComplete: true,
  });
  const sample = {
    caseId: "same",
    surface: "desktop-dev",
    inputHash: "same",
    settingsHash: "same",
    cacheCondition: "cold",
    revision: "sha",
    accounting,
    gates: Object.fromEntries(
      [
        "sourceIntegrity",
        "quizPermissions",
        "coverage",
        "correctness",
        "publication",
        "artifactValidation",
      ].map((gate) => [gate, true]),
    ),
  };
  assert.equal(compareArchitectureSamples(sample, sample).result, "measured-pair");
  assert.equal(compareArchitectureSamples({ ...sample, surface: "deterministic-workflow" }, { ...sample, surface: "deterministic-workflow" }).improvement, null);
  assert.equal(
    compareArchitectureSamples(sample, { ...sample, settingsHash: "other" }).result,
    "reject",
  );
  assert.equal(
    compareArchitectureSamples(sample, {
      ...sample,
      accounting: { ...accounting, complete: false },
    }).improvement,
    null,
  );
  assert.equal(accountRun({ calls: [], probes: [{ status: "failed" }] }).complete, false);
});
