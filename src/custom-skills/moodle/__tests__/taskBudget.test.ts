import { describe, expect, it } from "vitest";
import { resolveTaskBudget } from "../taskBudget.js";
import type { StudyBuddyIntentDecision } from "../taskIntent.js";

function decision(intent: StudyBuddyIntentDecision["intent"]): StudyBuddyIntentDecision {
  return {
    intent,
    wantsPdf: false,
    wantsTypstDocument: false,
    wantsQuickAnswer: intent === "quick_answer" || intent === "schedule_answer",
    wantsQuizAssistance: intent === "quiz_assist",
    needsMoodle: true,
    needsCis: intent === "schedule_answer",
    needsCalendar: intent === "schedule_answer",
    needsCourseMaterial: false,
    needsDownloadedFiles: false,
    reason: "test",
  };
}

describe("task budgets", () => {
  it("gives read-only quiz discovery enough breadth for enrolled courses", () => {
    expect(resolveTaskBudget({ ...decision("quiz_assist"), wantsQuizDiscovery: true })).toMatchObject({
      maxMoodlePages: 24,
      maxMoodleDepth: 2,
      maxDownloadedFiles: 0,
    });
  });

  it("keeps schedule lookups small and model-free", () => {
    expect(resolveTaskBudget(decision("schedule_answer"))).toEqual({
      maxMoodlePages: 4,
      maxMoodleDepth: 1,
      maxCisPages: 3,
      maxDownloadedFiles: 1,
      maxModelInputChars: 12_000,
      allowModel: false,
    });
  });

  it("preserves broader retrieval only for artifact extraction", () => {
    const budget = resolveTaskBudget(decision("study_pdf"));
    expect(budget.maxMoodlePages).toBe(8);
    expect(budget.maxDownloadedFiles).toBe(24);
    expect(budget.allowModel).toBe(true);
  });

  it("allows a compact model pass when a schedule request also asks for learning material", () => {
    const intent = decision("schedule_answer");
    intent.needsCourseMaterial = true;
    const budget = resolveTaskBudget(intent);
    expect(budget.allowModel).toBe(true);
    expect(budget.maxModelInputChars).toBe(24_000);
    expect(budget.maxDownloadedFiles).toBe(1);
  });
});
