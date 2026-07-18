import { describe, expect, it } from "vitest";
import {
  createAnalysisCallLedger,
  resolveAnalysisBudget,
  selectAnalysisSlices,
  type AnalysisSliceCandidate,
} from "../analysisBudget.js";

describe("generic analysis budgets", () => {
  it("exposes finite limits for every execution profile", () => {
    for (const profile of ["auto", "fast", "balanced", "quality", "custom"] as const) {
      const limits = resolveAnalysisBudget(profile);
      expect(limits.maxGlobalModelCalls).toBeGreaterThan(0);
      expect(limits.maxModelCallsPerModule).toBeGreaterThan(0);
      expect(limits.maxSlicesPerResource).toBeGreaterThan(0);
      expect(limits.maxSelectedSlices).toBeLessThanOrEqual(limits.maxGlobalModelCalls);
    }
    expect(resolveAnalysisBudget("fast").maxSelectedSlices).toBeLessThan(
      resolveAnalysisBudget("quality").maxSelectedSlices,
    );
  });

  it("enforces global and per-module call limits", () => {
    const ledger = createAnalysisCallLedger({
      maxGlobalModelCalls: 5,
      maxModelCallsPerModule: 2,
      maxSlicesPerResource: 2,
      maxSelectedSlices: 5,
    });

    expect(ledger.tryReserve("module-a")).toBe(true);
    expect(ledger.tryReserve("module-a")).toBe(true);
    expect(ledger.tryReserve("module-a")).toBe(false);
    expect(ledger.tryReserve("module-b")).toBe(true);
    expect(ledger.tryReserve("module-b")).toBe(true);
    expect(ledger.tryReserve("module-c")).toBe(true);
    expect(ledger.tryReserve("module-c")).toBe(false);
    expect(ledger.totalCalls).toBe(5);
    expect(ledger.remainingGlobalCalls()).toBe(0);
  });

  it("reduces the 342-slice regression catalog to a balanced, diverse evidence set", () => {
    const candidates = regressionCatalog(342);
    const limits = resolveAnalysisBudget("balanced");
    const result = selectAnalysisSlices({
      candidates,
      relevanceTerms: ["priority", "assessment", "decision"],
      profile: "balanced",
    });

    expect(result.candidateCount).toBe(342);
    expect(result.selected).toHaveLength(limits.maxSelectedSlices);
    expect(result.selected.length).toBeLessThanOrEqual(24);
    expect(result.omittedCount).toBe(342 - result.selected.length);
    expect(Math.max(...Object.values(result.countsByModule))).toBeLessThanOrEqual(
      limits.maxModelCallsPerModule,
    );
    expect(Math.max(...Object.values(result.countsByResource))).toBeLessThanOrEqual(
      limits.maxSlicesPerResource,
    );

    const ids = new Set(result.selected.map((candidate) => candidate.id));
    expect(ids).toContain("slice-0");
    expect(ids).toContain("slice-170");
    expect(ids).toContain("slice-341");
    expect(ids).toContain("relevant-practice");
    expect(ids).toContain("relevant-reference");
    expect(new Set(result.selected.map((candidate) => candidate.moduleId)).size).toBeGreaterThan(3);
    expect(new Set(result.selected.map((candidate) => candidate.sourceRole)).size).toBeGreaterThan(3);
  });

  it("is deterministic and never exceeds custom hard limits", () => {
    const candidates = regressionCatalog(80);
    const limits = {
      maxGlobalModelCalls: 7,
      maxModelCallsPerModule: 2,
      maxSlicesPerResource: 1,
      maxSelectedSlices: 20,
    };
    const select = () => selectAnalysisSlices({
      candidates,
      relevanceTerms: ["priority"],
      profile: "custom" as const,
      limits,
    });
    const first = select();
    const second = select();

    expect(first.selected.map(({ id }) => id)).toEqual(second.selected.map(({ id }) => id));
    expect(first.selected.length).toBeLessThanOrEqual(7);
    expect(Math.max(...Object.values(first.countsByModule))).toBeLessThanOrEqual(2);
    expect(Math.max(...Object.values(first.countsByResource))).toBeLessThanOrEqual(1);
  });

  it("reserves primary, paired practice, and declared dependency evidence before relevance fill", () => {
    const candidates: AnalysisSliceCandidate[] = [
      { id: "primary", resourceId: "lecture", moduleId: "m", sourceRole: "primary_lecture", content: "theory", ordinal: 0, reservation: "primary" },
      { id: "practice", resourceId: "task+solution", moduleId: "m", sourceRole: "worked_example", content: "task and solution", ordinal: 1, reservation: "practice" },
      { id: "table", resourceId: "lookup-table", moduleId: "m", sourceRole: "external_reference", content: "lookup", ordinal: 2, reservation: "dependency" },
      ...Array.from({ length: 20 }, (_, index): AnalysisSliceCandidate => ({
        id: `noise-${index}`,
        resourceId: `noise-${index}`,
        moduleId: "m",
        sourceRole: "supplementary",
        content: "priority assessment decision priority assessment decision",
        ordinal: index + 3,
      })),
    ];
    const result = selectAnalysisSlices({
      candidates,
      relevanceTerms: ["priority", "assessment", "decision"],
      profile: "custom",
      limits: {
        maxGlobalModelCalls: 3,
        maxModelCallsPerModule: 3,
        maxSlicesPerResource: 1,
        maxSelectedSlices: 3,
      },
    });

    expect(result.selected.map(({ id }) => id)).toEqual(["primary", "practice", "table"]);
  });
});

function regressionCatalog(count: number): AnalysisSliceCandidate[] {
  const roles = [
    "overview",
    "primary_lecture",
    "supplementary",
    "administrative",
  ];
  const candidates = Array.from({ length: count }, (_, index): AnalysisSliceCandidate => ({
    id: `slice-${index}`,
    resourceId: `resource-${Math.floor(index / 19)}`,
    moduleId: `module-${Math.floor(index / 57)}`,
    sourceRole: roles[index % roles.length],
    title: `Section ${index + 1}`,
    content: `General course evidence fragment ${index + 1}`,
    ordinal: index,
    totalSlices: count,
  }));

  // Stable global position representatives.
  if (candidates[170]) candidates[170] = { ...candidates[170], id: "slice-170" };
  // Highly relevant generic practice and reference evidence must survive even
  // though they appear inside a very large catalog.
  const practiceIndex = count > 247 ? 95 : Math.floor(count * 0.28);
  const referenceIndex = count > 247 ? 247 : Math.floor(count * 0.72);
  candidates[practiceIndex] = {
    ...candidates[practiceIndex],
    id: "relevant-practice",
    sourceRole: "worked_example",
    title: "Assessment practice",
    content: "Worked decision sequence for the priority assessment objective.",
  };
  candidates[referenceIndex] = {
    ...candidates[referenceIndex],
    id: "relevant-reference",
    sourceRole: "external_reference",
    title: "Priority decision reference",
    content: "Authoritative lookup evidence for the assessment objective.",
  };
  return candidates;
}
