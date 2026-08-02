import { describe, expect, it, vi } from "vitest";

import {
  createStudyBuilderQuizEvidenceCapability,
  decideStudyBuilderQuizEvidenceAction,
  type CompletedAttemptReviewReader,
  type StudyBuilderQuizEvidenceAuditEntry,
} from "../quizEvidencePolicy.js";
import type {
  QuizAccessMode,
  QuizSafetyPolicy,
} from "../types.js";

describe("Study Builder quiz evidence policy", () => {
  it.each([
    "review-only",
    "ask-before-attempt",
    "quiz-assist",
    "full-study-assist",
  ] satisfies QuizAccessMode[])(
    "keeps %s read-only while reading an authorized completed review",
    async (accessMode) => {
      const reader = readerStub();
      const capability = createStudyBuilderQuizEvidenceCapability({
        policy: policyFor(accessMode),
        reader,
        now: () => new Date("2026-07-29T12:00:00.000Z"),
      });

      await expect(
        capability.readCompletedAttemptReview({
          completionState: "completed",
          reviewUrl:
            "https://moodle.example/mod/quiz/review.php?attempt=42",
        }),
      ).resolves.toEqual({
        status: "read",
        evidence: { visibleQuestionCount: 3 },
      });
      expect(reader.openCompletedAttemptReview).toHaveBeenCalledOnce();
      expect(reader.readVisibleCompletedAttemptReview).toHaveBeenCalledOnce();

      for (const action of DISALLOWED_GENERIC_ACTIONS) {
        expect(capability.evaluate(action)).toMatchObject({
          status: "blocked",
          reason: "study-builder-quiz-evidence-read-only",
          neededPermission: "separate_explicit_quiz_assist",
        });
      }
    },
  );

  it("does not expose executable start, fill, save, or submit capabilities", () => {
    const capability = createStudyBuilderQuizEvidenceCapability({
      policy: policyFor("quiz-assist"),
      reader: readerStub(),
    });

    expect(Object.keys(capability).sort()).toEqual([
      "evaluate",
      "getAuditEntries",
      "readCompletedAttemptReview",
    ]);
    expect(capability).not.toHaveProperty("startAttempt");
    expect(capability).not.toHaveProperty("continueAttempt");
    expect(capability).not.toHaveProperty("fillAnswers");
    expect(capability).not.toHaveProperty("saveOrNextPage");
    expect(capability).not.toHaveProperty("finalSubmit");
  });

  it("blocks every escalation even when the effective Quiz Assist policy permits it", () => {
    const policy = policyFor("quiz-assist");

    for (const action of DISALLOWED_GENERIC_ACTIONS) {
      expect(decideStudyBuilderQuizEvidenceAction(policy, action)).toEqual({
        status: "blocked",
        action,
        policyAction: action,
        reason: "study-builder-quiz-evidence-read-only",
        neededPermission: "separate_explicit_quiz_assist",
      });
    }
  });

  it("makes final submission impossible even if the surrounding policy is maximally permissive", () => {
    const decision = decideStudyBuilderQuizEvidenceAction(
      policyFor("full-study-assist"),
      "final_submit",
    );

    expect(decision).toMatchObject({
      status: "blocked",
      action: "final_submit",
      reason: "study-builder-quiz-evidence-read-only",
    });
  });

  it("derives completed-review access from the effective policy and falls back without reading", async () => {
    const reader = readerStub();
    const capability = createStudyBuilderQuizEvidenceCapability({
      policy: {
        ...policyFor("review-only"),
        allowReadingQuestions: false,
      },
      reader,
    });

    const result = await capability.readCompletedAttemptReview({
      completionState: "completed",
      reviewUrl: "https://moodle.example/mod/quiz/review.php?attempt=42",
    });

    expect(result).toMatchObject({
      status: "blocked",
      decision: {
        action: "read_completed_attempt_review",
        reason: "reading-questions-disabled",
      },
    });
    expect(reader.openCompletedAttemptReview).toHaveBeenCalledOnce();
    expect(reader.readVisibleCompletedAttemptReview).not.toHaveBeenCalled();
  });

  it("rejects active-attempt and start-attempt URLs before invoking the reader", async () => {
    const reader = readerStub();
    const capability = createStudyBuilderQuizEvidenceCapability({
      policy: policyFor("quiz-assist"),
      reader,
    });

    await expect(
      capability.readCompletedAttemptReview({
        completionState: "completed",
        reviewUrl:
          "https://moodle.example/mod/quiz/attempt.php?attempt=42",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      decision: { reason: "invalid-completed-attempt-review-reference" },
    });
    expect(reader.openCompletedAttemptReview).not.toHaveBeenCalled();
    expect(reader.readVisibleCompletedAttemptReview).not.toHaveBeenCalled();
  });

  it("rechecks completion after opening and never reads an active or unknown review", async () => {
    const reader = readerStub();
    reader.openCompletedAttemptReview.mockResolvedValue({
      completionState: "active",
      handle: { handle: "completed-review" },
    });
    const capability = createStudyBuilderQuizEvidenceCapability({
      policy: policyFor("quiz-assist"),
      reader,
    });

    await expect(
      capability.readCompletedAttemptReview({
        completionState: "completed",
        reviewUrl:
          "https://moodle.example/mod/quiz/review.php?attempt=42",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      decision: {
        action: "read_completed_attempt_review",
        reason: "opened-review-is-not-completed",
      },
    });
    expect(reader.openCompletedAttemptReview).toHaveBeenCalledOnce();
    expect(reader.readVisibleCompletedAttemptReview).not.toHaveBeenCalled();
  });

  it("records ordered, content-free decision and action categories", async () => {
    const externalAudit: StudyBuilderQuizEvidenceAuditEntry[] = [];
    const capability = createStudyBuilderQuizEvidenceCapability({
      policy: policyFor("ask-before-attempt"),
      reader: readerStub(),
      now: () => new Date("2026-07-29T12:00:00.000Z"),
      audit: (entry) => externalAudit.push(entry),
    });

    await capability.readCompletedAttemptReview({
      completionState: "completed",
      reviewUrl:
        "https://student:secret@moodle.example/mod/quiz/review.php?attempt=private-42",
    });
    capability.evaluate("fill_answers");

    expect(capability.getAuditEntries()).toEqual([
      {
        version: 1,
        lane: "study-builder-quiz-evidence",
        sequence: 1,
        occurredAt: "2026-07-29T12:00:00.000Z",
        accessMode: "ask-before-attempt",
        action: "open_completed_attempt_review",
        policyAction: "open_quiz_page",
        decision: "allowed",
        reason: "effective-policy-allows",
      },
      {
        version: 1,
        lane: "study-builder-quiz-evidence",
        sequence: 2,
        occurredAt: "2026-07-29T12:00:00.000Z",
        accessMode: "ask-before-attempt",
        action: "read_completed_attempt_review",
        policyAction: "read_questions",
        decision: "allowed",
        reason: "effective-policy-allows",
      },
      {
        version: 1,
        lane: "study-builder-quiz-evidence",
        sequence: 3,
        occurredAt: "2026-07-29T12:00:00.000Z",
        accessMode: "ask-before-attempt",
        action: "fill_answers",
        policyAction: "fill_answers",
        decision: "blocked",
        reason: "study-builder-quiz-evidence-read-only",
      },
    ]);
    expect(externalAudit).toEqual(capability.getAuditEntries());
    expect(JSON.stringify(externalAudit)).not.toMatch(
      /student|secret|private-42|moodle\.example|reviewUrl|questionText|feedbackText/i,
    );
  });
});

const DISALLOWED_GENERIC_ACTIONS = [
  "open_quiz_page",
  "start_or_continue_attempt",
  "read_questions",
  "suggest_answers",
  "fill_answers",
  "change_existing_answers",
  "save_or_next_page",
  "final_submit",
] as const;

function readerStub(): CompletedAttemptReviewReader<
  { handle: "completed-review" },
  { visibleQuestionCount: number }
> & {
  openCompletedAttemptReview: ReturnType<typeof vi.fn>;
  readVisibleCompletedAttemptReview: ReturnType<typeof vi.fn>;
} {
  return {
    openCompletedAttemptReview: vi
      .fn()
      .mockResolvedValue({
        completionState: "completed",
        handle: { handle: "completed-review" },
      }),
    readVisibleCompletedAttemptReview: vi
      .fn()
      .mockResolvedValue({ visibleQuestionCount: 3 }),
  };
}

function policyFor(accessMode: QuizAccessMode): QuizSafetyPolicy {
  const broaderAssist =
    accessMode === "ask-before-attempt" ||
    accessMode === "quiz-assist" ||
    accessMode === "full-study-assist";
  const askBefore = accessMode === "ask-before-attempt";
  return {
    accessMode,
    allowOpeningQuizPages: true,
    allowStartingOrContinuingAttempts: broaderAssist,
    minimumTimeLimitMinutes: 10,
    minimumAttemptsLeft: 2,
    allowReadingQuestions: true,
    allowSuggestingAnswers: broaderAssist,
    allowFillingAnswers: broaderAssist,
    allowChangingExistingAnswers: broaderAssist,
    allowSavingMovingNext: broaderAssist,
    askBeforeStartingOrContinuingAttempts: askBefore,
    askBeforeTimedQuizzes: askBefore,
    askBeforeLimitedAttemptQuizzes: askBefore,
    askBeforeFillingAnswers: askBefore,
    askBeforeChangingExistingAnswers: askBefore,
    fillConfidenceThreshold: 0.85,
    finalSubmissionBlocked: true,
  };
}
