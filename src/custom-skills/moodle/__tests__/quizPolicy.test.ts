import { describe, expect, it } from "vitest";
import {
  assertQuizPolicyAllows,
  createQuizPolicy,
  detectQuizRestrictions,
  QuizPolicyViolation,
} from "../quizPolicy.js";

describe("quiz safety policy", () => {
  it("uses conservative defaults for risky quiz automation", () => {
    const policy = createQuizPolicy({ env: {} });

    expect(policy).toMatchObject({
      requestedAutoAnswer: false,
      settingAutoAnswer: false,
      requireManualReview: true,
      blockFinalSubmit: true,
      draftOnly: true,
      allowAttemptOpen: false,
      allowTimedQuiz: false,
      allowLimitedAttemptQuiz: false,
      allowQuestionRead: true,
      allowAnswerFill: false,
      allowAnswerChange: false,
      allowSaveOrMovePage: false,
      allowFinalSubmit: false,
    });
    expect(() => assertQuizPolicyAllows(policy, "open_attempt")).toThrow(QuizPolicyViolation);
    expect(() => assertQuizPolicyAllows(policy, "fill_answers")).toThrow(QuizPolicyViolation);
    expect(() => assertQuizPolicyAllows(policy, "save_or_move_page")).toThrow(QuizPolicyViolation);
    expect(() => assertQuizPolicyAllows(policy, "final_submit")).toThrow("manual-only");
  });

  it("reads UI-created quiz safety env fields without allowing final submission", () => {
    const policy = createQuizPolicy({
      env: {
        MOODLE_QUIZ_AUTO_ANSWER: "true",
        MOODLE_QUIZ_REQUIRE_MANUAL_REVIEW: "false",
        MOODLE_QUIZ_BLOCK_FINAL_SUBMIT: "false",
        MOODLE_QUIZ_DRAFT_ONLY: "false",
      },
    });

    expect(policy.requestedAutoAnswer).toBe(true);
    expect(policy.requireManualReview).toBe(false);
    expect(policy.blockFinalSubmit).toBe(false);
    expect(policy.draftOnly).toBe(false);
    expect(policy.allowAttemptOpen).toBe(true);
    expect(policy.allowAnswerFill).toBe(true);
    expect(() => assertQuizPolicyAllows(policy, "open_attempt")).not.toThrow();
    expect(() => assertQuizPolicyAllows(policy, "fill_answers")).not.toThrow();
    expect(() => assertQuizPolicyAllows(policy, "final_submit")).toThrow("manual-only");
  });

  it("blocks disabled question reads and riskier quiz actions", () => {
    const policy = createQuizPolicy({
      requestedAutoAnswer: true,
      env: {
        MOODLE_QUIZ_AUTO_ANSWER: "true",
        MOODLE_QUIZ_READ_QUESTIONS: "false",
        MOODLE_QUIZ_ALLOW_TIMED: "false",
        MOODLE_QUIZ_ALLOW_LIMITED_ATTEMPTS: "false",
      },
    });
    const restrictions = detectQuizRestrictions({
      url: "https://moodle.technikum-wien.at/mod/quiz/view.php?id=42",
      text: "Time limit: 30 mins\nAttempts allowed: 1",
    });

    expect(restrictions.timed).toBe(true);
    expect(restrictions.limitedAttempts).toBe(true);
    expect(() => assertQuizPolicyAllows(policy, "read_questions")).toThrow(QuizPolicyViolation);
    expect(() => assertQuizPolicyAllows(policy, "open_timed_quiz", restrictions)).toThrow(QuizPolicyViolation);
    expect(() => assertQuizPolicyAllows(policy, "open_limited_attempt_quiz", restrictions)).toThrow(
      QuizPolicyViolation,
    );
    expect(() => assertQuizPolicyAllows(policy, "change_existing_answers")).toThrow(QuizPolicyViolation);
  });
});
