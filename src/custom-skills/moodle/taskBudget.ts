import type { StudyBuddyIntentDecision } from "./taskIntent.js";

export interface TaskBudget {
  maxMoodlePages: number;
  maxMoodleDepth: number;
  maxCisPages: number;
  maxDownloadedFiles: number;
  maxModelInputChars: number;
  allowModel: boolean;
}

const DEFAULT_BUDGET: TaskBudget = {
  maxMoodlePages: 4,
  maxMoodleDepth: 1,
  maxCisPages: 3,
  maxDownloadedFiles: 1,
  maxModelInputChars: 24_000,
  allowModel: true,
};

export function resolveTaskBudget(intent: StudyBuddyIntentDecision | undefined): TaskBudget {
  if (!intent) return DEFAULT_BUDGET;

  switch (intent.intent) {
    case "schedule_answer":
      if (intent.needsCourseMaterial) {
        return {
          maxMoodlePages: 4,
          maxMoodleDepth: 1,
          maxCisPages: 3,
          maxDownloadedFiles: 1,
          maxModelInputChars: 24_000,
          allowModel: true,
        };
      }
      return {
        maxMoodlePages: 4,
        maxMoodleDepth: 1,
        maxCisPages: 3,
        maxDownloadedFiles: 1,
        maxModelInputChars: 12_000,
        allowModel: false,
      };
    case "quick_answer":
      return DEFAULT_BUDGET;
    case "quiz_assist":
      if (intent.wantsQuizDiscovery) {
        return {
          maxMoodlePages: 24,
          maxMoodleDepth: 2,
          maxCisPages: 0,
          maxDownloadedFiles: 0,
          maxModelInputChars: 96_000,
          allowModel: true,
        };
      }
      return {
        maxMoodlePages: 8,
        maxMoodleDepth: 2,
        maxCisPages: 0,
        maxDownloadedFiles: 0,
        maxModelInputChars: 48_000,
        allowModel: true,
      };
    case "diagnostic":
      return {
        maxMoodlePages: 3,
        maxMoodleDepth: 1,
        maxCisPages: 3,
        maxDownloadedFiles: 0,
        maxModelInputChars: 0,
        allowModel: false,
      };
    case "render":
      return {
        maxMoodlePages: 0,
        maxMoodleDepth: 0,
        maxCisPages: 0,
        maxDownloadedFiles: 0,
        maxModelInputChars: 96_000,
        allowModel: true,
      };
    case "document":
    case "study_pdf":
    case "extraction":
      return {
        maxMoodlePages: 8,
        maxMoodleDepth: 2,
        maxCisPages: 4,
        maxDownloadedFiles: 24,
        maxModelInputChars: 150_000,
        allowModel: true,
      };
  }
}
