import type { StudyBuddyExecutionProfile } from "./modelPolicy.js";

/**
 * Hard limits for the expensive analysis phase. `maxSelectedSlices` is kept
 * below the global call limit so orchestration and repair calls still have a
 * small allowance when every selected slice requires a model call.
 */
export interface AnalysisBudgetLimits {
  maxGlobalModelCalls: number;
  maxModelCallsPerModule: number;
  maxSlicesPerResource: number;
  maxSelectedSlices: number;
}

export interface AnalysisSliceCandidate {
  id: string;
  resourceId: string;
  moduleId: string;
  sourceRole: string;
  title?: string;
  content: string;
  tags?: string[];
  /** Zero-based position inside the resource. */
  ordinal: number;
  /** Total number of slices in the resource, when known. */
  totalSlices?: number;
  /** Optional relevance supplied by an embedding or an earlier model pass. */
  semanticScore?: number;
  /** Structural reservation decided by the learning architecture. */
  reservation?: "primary" | "practice" | "dependency";
}

export interface AnalysisSliceSelection<T extends AnalysisSliceCandidate> {
  selected: T[];
  candidateCount: number;
  omittedCount: number;
  effectiveLimit: number;
  countsByModule: Record<string, number>;
  countsByResource: Record<string, number>;
}

export interface AnalysisCallLedger {
  readonly limits: AnalysisBudgetLimits;
  readonly totalCalls: number;
  readonly callsByModule: Readonly<Record<string, number>>;
  tryReserve(moduleId: string): boolean;
  remainingGlobalCalls(): number;
  remainingModuleCalls(moduleId: string): number;
}

const PROFILE_LIMITS: Readonly<Record<StudyBuddyExecutionProfile, AnalysisBudgetLimits>> = {
  auto: {
    maxGlobalModelCalls: 36,
    maxModelCallsPerModule: 6,
    maxSlicesPerResource: 3,
    maxSelectedSlices: 24,
  },
  fast: {
    maxGlobalModelCalls: 18,
    maxModelCallsPerModule: 4,
    maxSlicesPerResource: 2,
    maxSelectedSlices: 12,
  },
  balanced: {
    maxGlobalModelCalls: 36,
    maxModelCallsPerModule: 6,
    maxSlicesPerResource: 3,
    maxSelectedSlices: 24,
  },
  quality: {
    maxGlobalModelCalls: 64,
    maxModelCallsPerModule: 10,
    maxSlicesPerResource: 5,
    maxSelectedSlices: 40,
  },
  custom: {
    maxGlobalModelCalls: 36,
    maxModelCallsPerModule: 6,
    maxSlicesPerResource: 3,
    maxSelectedSlices: 24,
  },
};

const POSITION_TARGETS = [0, 0.5, 1] as const;
const PRACTICE_ROLES = new Set(["worked_example", "sample_exam", "exercise", "solution"]);
const REFERENCE_ROLES = new Set(["formula", "external_reference", "reference", "table"]);

export function resolveAnalysisBudget(
  profile: StudyBuddyExecutionProfile,
): AnalysisBudgetLimits {
  return { ...PROFILE_LIMITS[profile] };
}

/**
 * Provides an atomic-looking, synchronous gate for callers dispatching model
 * work concurrently. A call is accepted only while both its module and the
 * whole run remain within budget.
 */
export function createAnalysisCallLedger(limits: AnalysisBudgetLimits): AnalysisCallLedger {
  const budget = Object.freeze({ ...limits });
  let totalCalls = 0;
  const callsByModule: Record<string, number> = {};

  return {
    limits: budget,
    get totalCalls() {
      return totalCalls;
    },
    get callsByModule() {
      return { ...callsByModule };
    },
    tryReserve(moduleId: string) {
      const moduleCalls = callsByModule[moduleId] ?? 0;
      if (
        totalCalls >= budget.maxGlobalModelCalls ||
        moduleCalls >= budget.maxModelCallsPerModule
      ) {
        return false;
      }
      totalCalls += 1;
      callsByModule[moduleId] = moduleCalls + 1;
      return true;
    },
    remainingGlobalCalls() {
      return Math.max(0, budget.maxGlobalModelCalls - totalCalls);
    },
    remainingModuleCalls(moduleId: string) {
      return Math.max(
        0,
        budget.maxModelCallsPerModule - (callsByModule[moduleId] ?? 0),
      );
    },
  };
}

/**
 * Reduces an arbitrarily large fragment catalog to a deterministic, bounded,
 * diverse evidence set. Selection combines query relevance with structural
 * coverage; it does not infer subject-specific importance from hard-coded
 * discipline vocabulary.
 */
export function selectAnalysisSlices<T extends AnalysisSliceCandidate>(input: {
  candidates: readonly T[];
  relevanceTerms: readonly string[];
  profile: StudyBuddyExecutionProfile;
  limits?: AnalysisBudgetLimits;
}): AnalysisSliceSelection<T> {
  const limits = input.limits ?? resolveAnalysisBudget(input.profile);
  const effectiveLimit = Math.max(
    0,
    Math.min(limits.maxSelectedSlices, limits.maxGlobalModelCalls),
  );
  const unique = deduplicateCandidates(input.candidates);
  const terms = [...new Set(input.relevanceTerms.flatMap(tokenize).filter(Boolean))];
  const originalIndex = new Map(unique.map((candidate, index) => [candidate.id, index]));
  const relevance = new Map(
    unique.map((candidate) => [candidate.id, relevanceScore(candidate, terms)]),
  );
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const moduleCounts = new Map<string, number>();
  const resourceCounts = new Map<string, number>();

  const canAdd = (candidate: T): boolean =>
    selected.length < effectiveLimit &&
    !selectedIds.has(candidate.id) &&
    (moduleCounts.get(candidate.moduleId) ?? 0) < limits.maxModelCallsPerModule &&
    (resourceCounts.get(candidate.resourceId) ?? 0) < limits.maxSlicesPerResource;
  const add = (candidate: T | undefined): void => {
    if (!candidate || !canAdd(candidate)) return;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    moduleCounts.set(candidate.moduleId, (moduleCounts.get(candidate.moduleId) ?? 0) + 1);
    resourceCounts.set(candidate.resourceId, (resourceCounts.get(candidate.resourceId) ?? 0) + 1);
  };

  const bestRelevant = (predicate: (candidate: T) => boolean): T | undefined =>
    [...unique]
      .filter((candidate) => predicate(candidate) && canAdd(candidate))
      .sort((left, right) => compareByRelevance(left, right, relevance, originalIndex))[0];

  // Fill structural reservations before general relevance. A module must not
  // lose primary theory, representative practice, or a declared dependency
  // merely because another source repeats more query terms.
  add(bestRelevant((candidate) => candidate.reservation === "primary"));
  add(bestRelevant((candidate) => candidate.reservation === "practice"));
  for (const resourceId of [...new Set(unique
    .filter((candidate) => candidate.reservation === "dependency")
    .map((candidate) => candidate.resourceId))]) {
    add(bestRelevant((candidate) =>
      candidate.reservation === "dependency" && candidate.resourceId === resourceId
    ));
  }

  // Domain-neutral fallback for legacy evidence without reservations.
  add(bestRelevant((candidate) => PRACTICE_ROLES.has(candidate.sourceRole)));
  add(bestRelevant((candidate) => REFERENCE_ROLES.has(candidate.sourceRole)));

  // Preserve broad document shape. These are global representatives; the
  // per-resource cap prevents one long source from consuming the whole budget.
  for (const target of POSITION_TARGETS) {
    const anchor = [...unique]
      .filter(canAdd)
      .sort((left, right) => {
        const distance = Math.abs(relativePosition(left) - target) -
          Math.abs(relativePosition(right) - target);
        return distance || compareByRelevance(left, right, relevance, originalIndex);
      })[0];
    add(anchor);
  }

  // Give every module a chance before filling remaining slots by marginal
  // value. This works for technical, medical, economic, or other course shapes.
  for (const moduleId of [...new Set(unique.map((candidate) => candidate.moduleId))]) {
    add(bestRelevant((candidate) => candidate.moduleId === moduleId));
  }

  while (selected.length < effectiveLimit) {
    const roles = new Set(selected.map((candidate) => candidate.sourceRole));
    const positions = new Set(selected.map(positionBucket));
    const next = [...unique]
      .filter(canAdd)
      .map((candidate) => ({
        candidate,
        score:
          (relevance.get(candidate.id) ?? 0) * 10 +
          (moduleCounts.has(candidate.moduleId) ? 0 : 3) +
          (resourceCounts.has(candidate.resourceId) ? 0 : 2) +
          (roles.has(candidate.sourceRole) ? 0 : 1.5) +
          (positions.has(positionBucket(candidate)) ? 0 : 1),
      }))
      .sort((left, right) =>
        right.score - left.score ||
        (originalIndex.get(left.candidate.id) ?? 0) -
          (originalIndex.get(right.candidate.id) ?? 0)
      )[0]?.candidate;
    if (!next) break;
    add(next);
  }

  // Return source order so downstream prompts retain a coherent reading flow.
  selected.sort((left, right) =>
    (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
  );

  return {
    selected,
    candidateCount: unique.length,
    omittedCount: unique.length - selected.length,
    effectiveLimit,
    countsByModule: Object.fromEntries(moduleCounts),
    countsByResource: Object.fromEntries(resourceCounts),
  };
}

function deduplicateCandidates<T extends AnalysisSliceCandidate>(candidates: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const candidate of candidates) {
    if (!candidate.id || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    unique.push(candidate);
  }
  return unique;
}

function compareByRelevance<T extends AnalysisSliceCandidate>(
  left: T,
  right: T,
  relevance: ReadonlyMap<string, number>,
  originalIndex: ReadonlyMap<string, number>,
): number {
  return (relevance.get(right.id) ?? 0) - (relevance.get(left.id) ?? 0) ||
    (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
}

function relevanceScore(candidate: AnalysisSliceCandidate, terms: readonly string[]): number {
  const supplied = clamp(candidate.semanticScore ?? 0, 0, 1);
  if (terms.length === 0) return supplied;
  const title = new Set(tokenize(candidate.title ?? ""));
  const tags = new Set((candidate.tags ?? []).flatMap(tokenize));
  const content = new Set(tokenize(candidate.content));
  let matches = 0;
  for (const term of terms) {
    if (title.has(term)) matches += 2;
    if (tags.has(term)) matches += 1.5;
    if (content.has(term)) matches += 1;
  }
  return supplied + matches / Math.max(1, terms.length);
}

function tokenize(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("und")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}

function relativePosition(candidate: AnalysisSliceCandidate): number {
  if (candidate.totalSlices && candidate.totalSlices > 1) {
    return clamp(candidate.ordinal / (candidate.totalSlices - 1), 0, 1);
  }
  return candidate.ordinal <= 0 ? 0 : 0.5;
}

function positionBucket(candidate: AnalysisSliceCandidate): "first" | "middle" | "last" {
  const position = relativePosition(candidate);
  if (position <= 1 / 3) return "first";
  if (position >= 2 / 3) return "last";
  return "middle";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
