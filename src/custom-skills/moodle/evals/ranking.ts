import type { EvalRunResult } from "./evaluate.js";

export interface RankedEvalProfile {
  caseId: string;
  profile: string;
  passed: boolean;
  passRate: number;
  reliabilityPassRate: number;
  efficiencyPassRate: number;
  qualityScore: number;
  wallMs: number;
  freshInputTokens: number;
  totalTokens: number;
  cacheHitRate: number;
  consistencyRate: number;
  trials: number;
  rank: number;
  recommended: boolean;
}

export function rankEvalProfiles(
  entries: ReadonlyArray<{ caseId: string; result: EvalRunResult }>,
): RankedEvalProfile[] {
  const grouped = new Map<string, EvalRunResult[]>();
  for (const entry of entries) {
    const key = `${entry.caseId}\u0000${entry.result.profile}`;
    const group = grouped.get(key) ?? [];
    group.push(entry.result);
    grouped.set(key, group);
  }
  const candidates = [...grouped.entries()].map(([key, results]) => {
    const [caseId, profile] = key.split("\u0000");
    const passRate = mean(results.map((result) => Number(result.passed)));
    return {
      caseId,
      profile,
      passed: passRate === 1,
      passRate,
      reliabilityPassRate: mean(results.map((result) => Number(result.reliabilityPassed))),
      efficiencyPassRate: mean(results.map((result) => Number(result.efficiencyPassed))),
      qualityScore: mean(results.map((result) => result.score)),
      wallMs: median(results.map((result) => result.wallMs)),
      freshInputTokens: median(results.map((result) => result.tokens.fresh)),
      totalTokens: median(results.map((result) => result.tokens.billableProxy)),
      cacheHitRate: median(results.map((result) => result.tokens.cacheHitRate)),
      consistencyRate: modalShare(results.map((result) => result.content.structureFingerprint)),
      trials: results.length,
    };
  });
  const byCase = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = byCase.get(candidate.caseId) ?? [];
    group.push(candidate);
    byCase.set(candidate.caseId, group);
  }
  return [...byCase.values()].flatMap((cases) => {
    cases.sort(
      (left, right) =>
        Number(right.passed) - Number(left.passed) ||
        right.passRate - left.passRate ||
        right.consistencyRate - left.consistencyRate ||
        right.qualityScore - left.qualityScore ||
        left.wallMs - right.wallMs ||
        left.totalTokens - right.totalTokens ||
        left.profile.localeCompare(right.profile),
    );
    return cases.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      recommended: index === 0 && entry.passed,
    }));
  });
}

function modalShare(values: string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Math.max(...counts.values()) / values.length;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
