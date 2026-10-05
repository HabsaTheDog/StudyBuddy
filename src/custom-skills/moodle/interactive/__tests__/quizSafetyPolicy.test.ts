import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { MoodleRuntimeConfig } from "../types.js";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import {
  enforceQuizSafetyPolicy,
  extractQuizMetadata,
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
      timeLimitUnlimited: true,
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

  it("continues an already approved active attempt near its deadline", () => {
    const approved = policy({ allowStartingOrContinuingAttempts: true, askBeforeStartingOrContinuingAttempts: false,
      askBeforeTimedQuizzes: false, askBeforeLimitedAttemptQuizzes: false });
    const active = metadata({ hasActiveAttempt: true, availabilityStatus: "open", timeLimitMinutes: 5, appearsTimed: true });
    expect(enforceQuizSafetyPolicy(approved, "start_or_continue_attempt", { metadata: active }).status).toBe("allowed");
    expect(enforceQuizSafetyPolicy(approved, "start_or_continue_attempt", { metadata: { ...active, hasActiveAttempt: false } }))
      .toMatchObject({ status: "blocked", reason: "timed-quiz-below-minimum-time-limit" });
    expect(enforceQuizSafetyPolicy({ ...approved, askBeforeTimedQuizzes: true }, "start_or_continue_attempt", { metadata: active }).status).not.toBe("allowed");
    expect(enforceQuizSafetyPolicy(approved, "start_or_continue_attempt", { metadata: { ...active, availabilityStatus: "closed" } }))
      .toMatchObject({ status: "blocked", reason: "quiz-closed" });
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
    expect(decision.reason).toBe("first-attempt-only-history-not-zero");
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

  it("allows continuing an open attempt without requiring unused new attempts", () => {
    const current = metadata({ hasActiveAttempt: true, attemptsAllowed: 2, attemptsUsed: 1,
      attemptsLeft: 1, activeAttemptId:"321", activeAttemptNumber:1, appearsLimitedAttempt: true, availabilityStatus: "open" });
    const allowed = policy({ allowStartingOrContinuingAttempts: true, askBeforeLimitedAttemptQuizzes: false });
    expect(enforceQuizSafetyPolicy(allowed, "start_or_continue_attempt", { metadata: current }).status).toBe("allowed");
    expect(enforceQuizSafetyPolicy({ ...allowed, askBeforeStartingOrContinuingAttempts: true }, "start_or_continue_attempt", { metadata: current }).status).toBe("permission_required");
    expect(enforceQuizSafetyPolicy(allowed, "start_or_continue_attempt", { metadata: { ...current, hasActiveAttempt: false } }).status).toBe("blocked");
    expect(enforceQuizSafetyPolicy(allowed, "start_or_continue_attempt", { metadata: { ...current, attemptsUsed:2, activeAttemptNumber:2 } }).status).toBe("blocked");
  });

  it("requires known zero history for limited first starts, even if a caller disables first-only", () => {
    const allowed = policy({allowStartingOrContinuingAttempts:true,firstAttemptOnly:false});
    const fresh = metadata({attemptsAllowed:2,attemptsUsed:0,attemptsLeft:2});
    expect(enforceQuizSafetyPolicy(allowed,"start_or_continue_attempt",{metadata:fresh}).status).toBe("allowed");
    for (const attemptsUsed of [null,1,2]) expect(enforceQuizSafetyPolicy(allowed,"start_or_continue_attempt",{metadata:{...fresh,attemptsUsed}}).status).toBe("blocked");
    expect(enforceQuizSafetyPolicy(allowed,"start_or_continue_attempt",{metadata:{...fresh,attemptsUsed:1,attemptsUnlimited:true}}).status).toBe("blocked");
  });
  it("keeps unlimited legacy practice unless first-only is explicitly required", () => {
    const allowed = policy({allowStartingOrContinuingAttempts:true});
    const practice = metadata({attemptsUsed:3,attemptsUnlimited:true});
    expect(enforceQuizSafetyPolicy(allowed,"start_or_continue_attempt",{metadata:practice}).status).toBe("allowed");
    expect(enforceQuizSafetyPolicy({...allowed,firstAttemptOnly:true},"start_or_continue_attempt",{metadata:practice}).status).toBe("blocked");
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


async function metadataFromNativeHtml(html: (base: string) => string) {
  let base = "";
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html(base));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createPlaywrightBrowserClient({baseUrl: base, headless: true} as MoodleRuntimeConfig);
  try {
    await client.open(`${base}/mod/quiz/view.php?id=7`);
    return await extractQuizMetadata(client);
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
const nativeAttemptCard = (ordinal: number, continuation = "", status = "In Bearbeitung") =>
  `<section class="card"><h3>Versuch ${ordinal}</h3><h4>Zusammenfassung von Versuch ${ordinal}</h4>
  <dl><dt>Status</dt><dd>${status}</dd><dt>Begonnen</dt><dd>4. Oktober 2026</dd></dl>${continuation}</section>`;

describe("native quiz identity evidence", () => {
  it("counts a modern card once and leaves its identity unconfirmed without a real attempt ID", async () => {
    const result = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 Ihre Versuche
      ${nativeAttemptCard(1)}<form action="startattempt.php" method="post"><input type="hidden" name="cmid" value="7">
      <button>Versuch fortsetzen</button></form>`);
    expect(result).toMatchObject({attemptsUsed: 1, attemptsLeft: 1, hasActiveAttempt: true,
      activeAttemptId: null, activeAttemptNumber: null,
      identityEvidence: {history: [{ordinal: 1, attemptId: null, source: "history-card"}]}});
    expect(enforceQuizSafetyPolicy(policy({allowStartingOrContinuingAttempts: true}),
      "start_or_continue_attempt", {metadata: result})).toMatchObject({status: "blocked", reason: "first-attempt-only-active-identity-unconfirmed"});
  });
  it("reads the public Moodle 5 card/table template without interpreting grade cells as attempt ordinals", async () => {
    const result = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 <h3>Ihre Versuche</h3>
      <ul class="list-unstyled row"><li><div class="card h-100"><div class="card-header"><h4 class="card-title">Versuch 1</h4></div>
      <table class="generaltable generalbox quizreviewsummary"><caption class="visually-hidden">Zusammenfassung von Versuch 1</caption><tbody>
      <tr><th scope="row">Status</th><td>In Bearbeitung</td></tr><tr><th scope="row">Begonnen</th><td>Sonntag, 4. Oktober 2026</td></tr>
      <tr><th scope="row">Bewertung</th><td>100</td></tr></tbody></table><div class="card-body"></div></div></li></ul>
      <form action="startattempt.php" method="post"><input type="hidden" name="cmid" value="7"><button>Versuch fortsetzen</button></form>`);
    expect(result).toMatchObject({attemptsUsed: 1, attemptsLeft: 1, hasActiveAttempt: true,
      activeAttemptId: null, activeAttemptNumber: null,
      identityEvidence: {history: [{ordinal: 1, attemptId: null, source: "history-card"}]}});
    expect(result.identityEvidence?.history).toHaveLength(1);
    expect(enforceQuizSafetyPolicy(policy({allowStartingOrContinuingAttempts: true}),
      "start_or_continue_attempt", {metadata: result}).status).toBe("blocked");
  });
  it("binds ordinal evidence in a Moodle 5 table card only to its real matching attempt link", async () => {
    const result = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 <div class="card"><h4 class="card-title">Attempt 2</h4>
      <table class="quizreviewsummary"><caption>Summary of attempt 2</caption><tbody><tr><th scope="row">State</th><td>In progress</td></tr></tbody></table>
      <div class="card-body"><a href="attempt.php?attempt=322&cmid=7">Continue attempt</a></div></div>`);
    expect(result).toMatchObject({attemptsUsed: 2, activeAttemptId: "322", activeAttemptNumber: 2,
      identityEvidence: {history: [{ordinal: 2, attemptId: "322", source: "history-card"}]}});
    expect(enforceQuizSafetyPolicy(policy({allowStartingOrContinuingAttempts: true}),
      "start_or_continue_attempt", {metadata: result}).status).toBe("blocked");
  });
  it("associates a relative continuation link with its actual native first card, without disclosing tokens", async () => {
    const result = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 Ihre Versuche ${nativeAttemptCard(1,
      '<a href="attempt.php?attempt=321&cmid=7&sesskey=fixture-secret">Versuch fortsetzen</a>')}`);
    expect(result).toMatchObject({attemptsUsed: 1, activeAttemptId: "321", activeAttemptNumber: 1,
      identityEvidence: {continuation: [{attemptId: "321", path: "/mod/quiz/attempt.php?attempt=321", source: "continue-link"}]}});
    expect(JSON.stringify(result.identityEvidence)).not.toContain("fixture-secret");
  });
  it("reads exact continuation form identity fields but does not expose unrelated form inputs", async () => {
    const result = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 Ihre Versuche ${nativeAttemptCard(1,
      '<form action="./attempt.php"><input type="hidden" name="attempt" value="321"><input type="hidden" name="sesskey" value="fixture-secret"><input name="password" value="fixture-password"><button>Versuch fortsetzen</button></form>')}`);
    expect(result).toMatchObject({activeAttemptId: "321", activeAttemptNumber: 1,
      identityEvidence: {continuation: [{attemptId: "321", source: "continue-form"}]}});
    expect(JSON.stringify(result.identityEvidence)).not.toMatch(/sesskey|password|fixture-secret|fixture-password/);
  });
  it("never assigns ordinal one to a second card or to conflicting active continuation IDs", async () => {
    const second = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 Ihre Versuche
      ${nativeAttemptCard(1, '<a href="review.php?attempt=321">Review</a>', "Beendet")}
      ${nativeAttemptCard(2, '<a href="attempt.php?attempt=322">Versuch fortsetzen</a>')}`);
    expect(second).toMatchObject({attemptsUsed: 2, activeAttemptId: "322", activeAttemptNumber: 2});
    expect(enforceQuizSafetyPolicy(policy({allowStartingOrContinuingAttempts: true}),
      "start_or_continue_attempt", {metadata: second}).status).toBe("blocked");
    const conflicting = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 Ihre Versuche
      ${nativeAttemptCard(1, '<a href="attempt.php?attempt=321">Versuch fortsetzen</a>')}
      ${nativeAttemptCard(2, '<a href="attempt.php?attempt=322">Versuch fortsetzen</a>')}`);
    expect(conflicting).toMatchObject({attemptsUsed: 2, activeAttemptId: null, activeAttemptNumber: null});
  });
  it("bounds and whitelists diagnostic evidence instead of reflecting raw metadata", () => {
    const identityEvidence = {
      currentAttemptId: "321",
      history: Array.from({length: 80}, (_, index) => ({ordinal: index + 1, attemptId: "321", source: "history-card" as const, password: "fixture-secret"})),
      continuation: [
        {attemptId: "321", path: "/mod/quiz/attempt.php?attempt=321", source: "continue-link" as const, sesskey: "fixture-secret"},
        {attemptId: "321", path: "/mod/quiz/attempt.php?attempt=321&sesskey=fixture-secret", source: "continue-form" as const},
      ],
      cookies: "fixture-secret",
    };
    const result = normalizeQuizMetadata({identityEvidence});
    expect(result.identityEvidence?.history).toHaveLength(32);
    expect(result.identityEvidence?.continuation).toEqual([{attemptId: "321", path: "/mod/quiz/attempt.php?attempt=321", source: "continue-link"}]);
    expect(JSON.stringify(result.identityEvidence)).not.toMatch(/fixture-secret|password|cookies|sesskey/);
    expect(result.activeAttemptId).toBeNull(); // Diagnostic evidence never manufactures normalized proof fields.
  });
  it("rejects foreign continuation URLs, conflicting query IDs and arbitrary identity attributes", async () => {
    const result = await metadataFromNativeHtml(() => `Erlaubte Versuche: 2 Ihre Versuche ${nativeAttemptCard(1,
      '<a href="https://foreign.example/mod/quiz/attempt.php?attempt=321">Versuch fortsetzen</a><a href="attempt.php?attempt=321&cmid=8">Versuch fortsetzen</a><a href="attempt.php?attempt=321&attempt=322">Versuch fortsetzen</a><div data-attempt-id="321" data-attempt-number="1"></div>')}`);
    expect(result).toMatchObject({activeAttemptId: null, activeAttemptNumber: null,
      identityEvidence: {continuation: []}});
  });
});
