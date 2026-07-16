import type { EvalRunResult } from "./evaluate.js";

export interface RankedEvalProfile {
  caseId: string;
  profile: string;
  passed: boolean;
  qualityScore: number;
  wallMs: number;
  totalTokens: number;
  rank: number;
  recommended: boolean;
}

export function rankEvalProfiles(
  entries: ReadonlyArray<{ caseId: string; result: EvalRunResult }>,
): RankedEvalProfile[] {
  const grouped = new Map<string, Array<{ caseId: string; result: EvalRunResult }>>();
  for (const entry of entries) {
    const group = grouped.get(entry.caseId) ?? [];
    group.push(entry);
    grouped.set(entry.caseId, group);
  }
  return [...grouped.entries()].flatMap(([caseId, cases]) => {
    const candidates = cases.map(({ result }) => ({
        caseId,
        profile: result.profile,
        passed: result.passed,
        qualityScore: result.score,
        wallMs: result.wallMs,
        totalTokens:
          result.tokens.input +
          result.tokens.cached +
          result.tokens.output +
          result.tokens.reasoning,
      }));
    candidates.sort(
      (left, right) =>
        Number(right.passed) - Number(left.passed) ||
        right.qualityScore - left.qualityScore ||
        left.wallMs - right.wallMs ||
        left.totalTokens - right.totalTokens ||
        left.profile.localeCompare(right.profile),
    );
    return candidates.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      recommended: index === 0 && entry.passed,
    }));
  });
}
