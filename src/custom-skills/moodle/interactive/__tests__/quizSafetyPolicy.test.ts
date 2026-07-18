import { describe, expect, it } from "vitest";
import {
  enforceQuizSafetyPolicy,
  normalizeQuizMetadata,
  type QuizMetadata,
} from "../quizSafetyPolicy.js";
import type { QuizQuestion } from "../nodes/quizReviewNode.js";
import type { QuizSafetyPolicy } from "../types.js";

describe("quizSafetyPolicy", () => {
  it("derives the closed ET2 quiz state and remaining attempts from Moodle page facts", () => {
    const result = normalizeQuizMetadata(
      {
        bodyText:
          "Test zu 8. Einheit Geschlossen: Freitag, 17. April 2026, 06:46 Erlaubte Versuche: 3 Zeitbegrenzung: 2 Stunden Ihre Versuche Versuch 1 Status Beendet",
        hasStartControl: false,
        hasContinueControl: false,
      },
      { now: new Date("2026-07-17T12:00:00.000Z") },
    );

    expect(result).toMatchObject({
      timeLimitMinutes: 120,
      effectiveTimeLimitMinutes: 0,
      effectiveTimeLimitSource: "deadline",
      timeLimitUnlimited: false,
      attemptsAllowed: 3,
      attemptsUsed: 1,
      attemptsLeft: 2,
      attemptsUnlimited: false,
      hasActiveAttempt: false,
      canStartNewAttempt: false,
      availabilityStatus: "closed",
    });
    expect(result.closesAt).not.toBeNull();
    expect(result.availabilityEvidence).toContain("close-time-text");
    expect(result.availabilityEvidence).toContain("close-time-passed");
  });

  it("does not mistake an attempt's Abgeschlossen timestamp for the quiz deadline", () => {
    const result = normalizeQuizMetadata(
      {
        bodyText:
          "1. Selbstcheck Ihre Versuche Versuch 1 Abgeschlossen: Freitag, 17. Juli 2026, 22:26 Test wiederholen",
        attemptRowCount: 1,
        hasStartControl: true,
      },
      { now: new Date("2026-07-17T22:28:00.000Z") },
    );

    expect(result).toMatchObject({
      closesAt: null,
      effectiveTimeLimitMinutes: null,
      timeLimitUnlimited: true,
      availabilityStatus: "open",
      canStartNewAttempt: true,
    });
    expect(result.availabilityEvidence).not.toContain("close-time-passed");
  });

  it("does not classify attempt history alone as a closed quiz", () => {
    const result = normalizeQuizMetadata(
      {
        bodyText:
          "Ihre Versuche Versuch 1 Abgeschlossen: Freitag, 17. Juli 2026, 22:26 Überprüfung nicht erlaubt",
        attemptRowCount: 1,
      },
      { now: new Date("2026-07-17T22:28:00.000Z") },
    );

    expect(result.closesAt).toBeNull();
    expect(result.availabilityStatus).toBe("unknown");
  });

  it("treats a quiz without a timer or deadline as unlimited", () => {
    const result = normalizeQuizMetadata({ bodyText: "Test versuchen", hasStartControl: true });

    expect(result).toMatchObject({
      timeLimitMinutes: null,
      effectiveTimeLimitMinutes: null,
      effectiveTimeLimitSource: "unlimited",
      timeLimitUnlimited: true,
      appearsTimed: false,
    });
  });

  it("treats Moodle's zero timer value as no configured limit", () => {
    const result = normalizeQuizMetadata({ timeLimitMinutes: 0, hasStartControl: true });

    expect(result).toMatchObject({
      timeLimitMinutes: null,
      effectiveTimeLimitMinutes: null,
      timeLimitUnlimited: true,
    });
  });

  it("uses the closing deadline when an otherwise untimed quiz has one", () => {
    const result = normalizeQuizMetadata(
      {
        closesAt: "2026-07-17T12:30:00.000Z",
        hasStartControl: true,
      },
      { now: new Date("2026-07-17T12:00:00.000Z") },
    );

    expect(result).toMatchObject({
      timeLimitMinutes: null,
      effectiveTimeLimitMinutes: 30,
      effectiveTimeLimitSource: "deadline",
      timeLimitUnlimited: false,
      appearsTimed: true,
    });
  });

  it("treats an elapsed deadline as authoritative even if a stale start control is present", () => {
    const result = normalizeQuizMetadata(
      {
        closesAt: "2026-07-17T11:59:00.000Z",
        hasStartControl: true,
      },
      { now: new Date("2026-07-17T12:00:00.000Z") },
    );

    expect(result).toMatchObject({
      availabilityStatus: "closed",
      canStartNewAttempt: false,
      effectiveTimeLimitMinutes: 0,
    });
  });

  it("uses the deadline when it is shorter than the configured quiz timer", () => {
    const result = normalizeQuizMetadata(
      {
        timeLimitMinutes: 60,
        closesAt: "2026-07-17T12:30:00.000Z",
        hasStartControl: true,
      },
      { now: new Date("2026-07-17T12:00:00.000Z") },
    );

    expect(result).toMatchObject({
      effectiveTimeLimitMinutes: 30,
      effectiveTimeLimitSource: "deadline",
    });
  });

  it("keeps the configured quiz timer when it is shorter than the deadline", () => {
    const result = normalizeQuizMetadata(
      {
        timeLimitMinutes: 20,
        closesAt: "2026-07-17T12:30:00.000Z",
        hasStartControl: true,
      },
      { now: new Date("2026-07-17T12:00:00.000Z") },
    );

    expect(result).toMatchObject({
      effectiveTimeLimitMinutes: 20,
      effectiveTimeLimitSource: "quiz_time_limit",
    });
  });

  it("treats a missing numeric attempt limit as unlimited", () => {
    const result = normalizeQuizMetadata({
      bodyText: "Zeitbegrenzung: 120 Minuten Test versuchen",
      hasStartControl: true,
    });

    expect(result).toMatchObject({
      attemptsAllowed: null,
      attemptsLeft: null,
      attemptsUnlimited: true,
      appearsLimitedAttempt: false,
    });
  });

  it("blocks a closed quiz before asking for attempt permission", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({
        allowStartingOrContinuingAttempts: true,
        askBeforeStartingOrContinuingAttempts: true,
      }),
      "start_or_continue_attempt",
      { metadata: metadata({ availabilityStatus: "closed", canStartNewAttempt: false }) },
    );

    expect(decision).toMatchObject({ status: "blocked", reason: "quiz-closed" });
  });

  it("fails closed when Moodle exposes no authoritative availability signal", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowStartingOrContinuingAttempts: true }),
      "start_or_continue_attempt",
      { metadata: normalizeQuizMetadata({}) },
    );

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "quiz-availability-unknown",
    });
  });

  it("blocks timed quizzes below the minimum time limit", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowStartingOrContinuingAttempts: true }),
      "start_or_continue_attempt",
      {
        metadata: metadata({ timeLimitMinutes: 5, appearsTimed: true }),
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("timed-quiz-below-minimum-time-limit");
  });

  it("applies the minimum-time policy to the shorter deadline window", () => {
    const result = normalizeQuizMetadata(
      {
        timeLimitMinutes: 60,
        closesAt: "2026-07-17T12:05:00.000Z",
        hasStartControl: true,
      },
      { now: new Date("2026-07-17T12:00:00.000Z") },
    );
    const decision = enforceQuizSafetyPolicy(
      policy({ allowStartingOrContinuingAttempts: true }),
      "start_or_continue_attempt",
      { metadata: result },
    );

    expect(decision).toMatchObject({
      status: "blocked",
      reason: "timed-quiz-below-minimum-time-limit",
    });
  });

  it("blocks limited-attempt quizzes below the minimum attempts left", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowStartingOrContinuingAttempts: true }),
      "start_or_continue_attempt",
      {
        metadata: metadata({
          attemptsAllowed: 2,
          attemptsUsed: 1,
          attemptsLeft: 1,
          appearsLimitedAttempt: true,
        }),
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("limited-attempt-quiz-below-minimum-attempts-left");
  });

  it("requires permission for an ordinary untimed attempt in ask-before mode", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({
        allowStartingOrContinuingAttempts: true,
        askBeforeStartingOrContinuingAttempts: true,
      }),
      "start_or_continue_attempt",
      { metadata: metadata({}) },
    );

    expect(decision.status).toBe("permission_required");
    expect(decision.reason).toBe("quiz-attempt-needs-confirmation");
  });

  it("prevents filling when filling is disabled", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowFillingAnswers: false }),
      "fill_answers",
      {
        question: question(),
        answer: answer(0.99),
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("filling-answers-disabled");
  });

  it("prevents filling answers below the confidence threshold", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowFillingAnswers: true }),
      "fill_answers",
      {
        question: question(),
        answer: answer(0.6),
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("answer-confidence-below-threshold");
  });

  it("does not overwrite existing answers unless changing is allowed", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowFillingAnswers: true }),
      "fill_answers",
      {
        question: question([{ type: "radio", checked: true, value: "4" }]),
        answer: answer(0.99),
      },
    );

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("changing-existing-answers-disabled");
  });

  it("does not treat the static value of an unchecked choice as an existing answer", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ allowFillingAnswers: true }),
      "fill_answers",
      {
        question: question([
          { type: "radio", checked: false, value: "1" },
          { type: "radio", checked: false, value: "1" },
        ]),
        answer: answer(0.99),
      },
    );

    expect(decision.status).toBe("allowed");
  });

  it("blocks save or next page unless allowed", () => {
    const decision = enforceQuizSafetyPolicy(policy(), "save_or_next_page");

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("save-next-disabled");
  });

  it("keeps final submit blocked regardless of settings", () => {
    const decision = enforceQuizSafetyPolicy(
      policy({ finalSubmissionBlocked: true }),
      "final_submit",
    );

    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("final-submission-manual-only");
  });
});

function policy(overrides: Partial<QuizSafetyPolicy> = {}): QuizSafetyPolicy {
  return {
    accessMode: "review-only",
    allowOpeningQuizPages: true,
    allowStartingOrContinuingAttempts: false,
    minimumTimeLimitMinutes: 10,
    minimumAttemptsLeft: 2,
    allowReadingQuestions: true,
    allowSuggestingAnswers: false,
    allowFillingAnswers: false,
    allowChangingExistingAnswers: false,
    allowSavingMovingNext: false,
    askBeforeStartingOrContinuingAttempts: false,
    askBeforeTimedQuizzes: false,
    askBeforeLimitedAttemptQuizzes: false,
    askBeforeFillingAnswers: false,
    askBeforeChangingExistingAnswers: false,
    fillConfidenceThreshold: 0.85,
    ...overrides,
    finalSubmissionBlocked: true,
  };
}

function metadata(overrides: Partial<QuizMetadata>): QuizMetadata {
  return normalizeQuizMetadata({
    availabilityStatus: "open",
    canStartNewAttempt: true,
    ...overrides,
  });
}

function question(controls: Array<Record<string, unknown>> = []): QuizQuestion {
  return {
    question_id: "question-1",
    question_index: 1,
    question_type: "multichoice",
    prompt: "Was ist 2+2?",
    options: ["3", "4"],
    controls,
    visible_context: "Frage 1 Was ist 2+2?",
  };
}

function answer(confidence: number) {
  return {
    question_id: "question-1",
    question_index: 1,
    answer: "4",
    answers: [],
    confidence,
    citations: ["visible option 4"],
    rationale: "2+2=4.",
    risk_flags: [],
  };
}
