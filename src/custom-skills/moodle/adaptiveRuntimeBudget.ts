import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";

export type AdaptiveWorkloadTier = "small" | "normal" | "large";

export interface AdaptiveRuntimeBudget {
  schemaVersion: 1;
  tier: AdaptiveWorkloadTier;
  moduleCount: number;
  evidenceRecordCount: number;
  evidenceCharacters: number;
  visualCandidateCount: number;
  formulaSignalCount: number;
  estimatedAnalyzerCalls: number;
  runRuntimeMs: number;
  totalWorkflowBudgetMs: number;
  renderReserveMs: number;
  reason: string;
}

interface ActiveAdaptiveBudget {
  budget: AdaptiveRuntimeBudget;
  analyzerStartedMs: number;
  compact: boolean;
  extended: boolean;
  completedModules: number;
  totalModules: number;
  projectedCompletionMs: number | null;
}

const ACTIVE_BUDGETS = new WeakMap<MoodleRuntimeConfig, ActiveAdaptiveBudget>();

const DEFAULT_EXTRACTION_RUNTIME_MS = 14 * 60_000;
const RENDER_RESERVE_MS = 2 * 60_000;
const TIER_BUDGETS: Record<AdaptiveWorkloadTier, {
  runRuntimeMs: number;
  totalWorkflowBudgetMs: number;
}> = {
  small: { runRuntimeMs: 12 * 60_000, totalWorkflowBudgetMs: 15 * 60_000 },
  normal: { runRuntimeMs: 18 * 60_000, totalWorkflowBudgetMs: 26 * 60_000 },
  large: { runRuntimeMs: 24 * 60_000, totalWorkflowBudgetMs: 38 * 60_000 },
};

export function estimateAdaptiveRuntimeBudget(input: {
  moduleCount: number;
  evidenceRecordCount: number;
  evidenceCharacters: number;
  visualCandidateCount: number;
  formulaSignalCount: number;
}): AdaptiveRuntimeBudget {
  const tier: AdaptiveWorkloadTier =
    input.moduleCount <= 4 &&
      input.evidenceRecordCount <= 180 &&
      input.evidenceCharacters <= 180_000 &&
      input.visualCandidateCount <= 30
      ? "small"
      : input.moduleCount <= 6 &&
          input.evidenceRecordCount <= 900 &&
          input.evidenceCharacters <= 700_000 &&
          input.visualCandidateCount <= 100
        ? "normal"
        : "large";
  const selected = TIER_BUDGETS[tier];
  return {
    schemaVersion: 1,
    tier,
    ...input,
    // The analyzer is constrained to one bounded model turn per module on the
    // normal path. Planner/reviewer calls are covered by the tier fixed cost.
    estimatedAnalyzerCalls: input.moduleCount,
    runRuntimeMs: selected.runRuntimeMs,
    totalWorkflowBudgetMs: selected.totalWorkflowBudgetMs,
    renderReserveMs: RENDER_RESERVE_MS,
    reason: tier === "small"
      ? "Compact course evidence and at most four learning modules."
      : tier === "normal"
        ? "Moderate course architecture with bounded evidence volume."
        : "Large evidence corpus, high visual density, or more complex course architecture.",
  };
}

export async function applyAdaptiveExtractionBudget(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  moduleCount: number,
): Promise<AdaptiveRuntimeBudget> {
  const evidenceCharacters = state.evidence_package.records.reduce(
    (sum, record) => sum + JSON.stringify(record).length,
    0,
  );
  const joinedEvidence = state.evidence_package.records.map((record) => record.content).join("\n");
  const formulaSignalCount = joinedEvidence.match(/[=∑∫√]|\\(?:frac|sum|int|sqrt|text|quad)\b/g)?.length ?? 0;
  const visualCandidateCount = await readVisualCandidateCount(config.runDir);
  const budget = estimateAdaptiveRuntimeBudget({
    moduleCount,
    evidenceRecordCount: state.evidence_package.records.length,
    evidenceCharacters,
    visualCandidateCount,
    formulaSignalCount,
  });

  const workflowDeadline = Number(process.env.STUDY_BUDDY_WORKFLOW_DEADLINE_MS);
  const workflowRemainingMs = Number.isFinite(workflowDeadline)
    ? Math.max(0, workflowDeadline - Date.now() - budget.renderReserveMs)
    : Number.POSITIVE_INFINITY;
  const selectedRunRuntimeMs = Math.max(
    3 * 60_000,
    Math.min(budget.runRuntimeMs, workflowRemainingMs),
  );
  // Preserve explicit short diagnostic/test budgets. The ordinary 14-minute
  // extraction default is the signal that adaptive sizing owns the deadline.
  if (config.maxRuntimeMs === DEFAULT_EXTRACTION_RUNTIME_MS || config.maxRuntimeMs > selectedRunRuntimeMs) {
    config.maxRuntimeMs = selectedRunRuntimeMs;
  }
  ACTIVE_BUDGETS.set(config, {
    budget,
    analyzerStartedMs: Date.now(),
    compact: false,
    extended: false,
    completedModules: 0,
    totalModules: moduleCount,
    projectedCompletionMs: null,
  });

  await writeFile(
    path.join(config.runDir, "adaptive-budget.json"),
    `${JSON.stringify({ ...budget, selectedRunRuntimeMs: config.maxRuntimeMs }, null, 2)}\n`,
    "utf8",
  );
  await config.diagnostics?.log(
    "info",
    "analyzer",
    `Adaptive runtime budget: ${budget.tier} workload, ${Math.round(config.maxRuntimeMs / 60_000)} minute extraction window.`,
    { ...budget, selectedRunRuntimeMs: config.maxRuntimeMs },
  );
  return budget;
}

export function adaptiveEvidenceSliceLimit(
  config: MoodleRuntimeConfig,
  requested: number,
): number {
  return ACTIVE_BUDGETS.get(config)?.compact ? Math.min(2, requested) : requested;
}

export async function updateAdaptiveRuntimeProgress(
  config: MoodleRuntimeConfig,
  completedModules: number,
  totalModules: number,
): Promise<void> {
  const active = ACTIVE_BUDGETS.get(config);
  if (!active || completedModules < 1) return;
  const runStartedMs = Date.parse(config.executionTelemetry?.getSnapshot().startedAt ?? "");
  const now = Date.now();
  const runElapsedMs = Number.isFinite(runStartedMs) ? now - runStartedMs : 0;
  const analysisElapsedMs = now - active.analyzerStartedMs;
  const workflowDeadline = Number(process.env.STUDY_BUDDY_WORKFLOW_DEADLINE_MS);
  const workflowBudgetAvailableToThisRun = Number.isFinite(workflowDeadline) && Number.isFinite(runStartedMs)
    ? Math.max(config.maxRuntimeMs, workflowDeadline - runStartedMs)
    : active.budget.totalWorkflowBudgetMs;
  const projection = projectAdaptiveRuntime({
    runElapsedMs,
    analysisElapsedMs,
    completedModules,
    totalModules,
    currentRuntimeMs: config.maxRuntimeMs,
    totalWorkflowBudgetMs: Math.min(
      active.budget.totalWorkflowBudgetMs,
      workflowBudgetAvailableToThisRun,
    ),
    renderReserveMs: active.budget.renderReserveMs,
    alreadyExtended: active.extended,
  });
  if (projection.recommendedRuntimeMs > config.maxRuntimeMs) {
    config.maxRuntimeMs = projection.recommendedRuntimeMs;
    active.extended = true;
    await config.diagnostics?.log(
      "info",
      "analyzer",
      `Adaptive budget extended after measured progress to ${Math.round(config.maxRuntimeMs / 60_000)} minutes.`,
      projection,
    );
  }
  if (projection.shouldCompact && !active.compact) {
    active.compact = true;
    await config.diagnostics?.log(
      "warn",
      "analyzer",
      "Projected completion exceeds the adaptive window; remaining chapters switch to compact evidence batching.",
      projection,
    );
  }
  active.completedModules = completedModules;
  active.totalModules = totalModules;
  active.projectedCompletionMs = projection.projectedCompletionMs;
  await persistBudget(config, active.budget, {
    selectedRunRuntimeMs: config.maxRuntimeMs,
    completedModules,
    totalModules,
    projectedCompletionMs: projection.projectedCompletionMs,
    mode: active.compact ? "compact" : "full",
    extended: active.extended,
  });
}

export function projectAdaptiveRuntime(input: {
  runElapsedMs: number;
  analysisElapsedMs: number;
  completedModules: number;
  totalModules: number;
  currentRuntimeMs: number;
  totalWorkflowBudgetMs: number;
  renderReserveMs: number;
  alreadyExtended: boolean;
}): {
  projectedCompletionMs: number;
  recommendedRuntimeMs: number;
  shouldCompact: boolean;
} {
  const remainingModules = Math.max(0, input.totalModules - input.completedModules);
  const meanModuleMs = input.analysisElapsedMs / Math.max(1, input.completedModules);
  const projectedCompletionMs = Math.round(
    input.runElapsedMs + meanModuleMs * remainingModules + 90_000,
  );
  const extensionCeiling = Math.max(
    input.currentRuntimeMs,
    input.totalWorkflowBudgetMs - input.renderReserveMs - 3 * 60_000,
  );
  const recommendedRuntimeMs =
    !input.alreadyExtended && projectedCompletionMs > input.currentRuntimeMs - 60_000
      ? Math.min(extensionCeiling, input.currentRuntimeMs + 6 * 60_000)
      : input.currentRuntimeMs;
  return {
    projectedCompletionMs,
    recommendedRuntimeMs,
    shouldCompact: projectedCompletionMs > recommendedRuntimeMs - 60_000,
  };
}

async function readVisualCandidateCount(runDir: string): Promise<number> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(runDir, "visual-candidates.json"), "utf8"),
    ) as { candidates?: unknown[] } | unknown[];
    return Array.isArray(parsed) ? parsed.length : parsed.candidates?.length ?? 0;
  } catch {
    return 0;
  }
}

async function persistBudget(
  config: MoodleRuntimeConfig,
  budget: AdaptiveRuntimeBudget,
  progress: Record<string, unknown>,
): Promise<void> {
  await writeFile(
    path.join(config.runDir, "adaptive-budget.json"),
    `${JSON.stringify({ ...budget, ...progress }, null, 2)}\n`,
    "utf8",
  );
}
