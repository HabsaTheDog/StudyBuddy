export type QuizPolicyAction =
  | "open_attempt"
  | "open_timed_quiz"
  | "open_limited_attempt_quiz"
  | "read_questions"
  | "fill_answers"
  | "change_existing_answers"
  | "save_or_move_page"
  | "final_submit";

export interface QuizPolicy {
  requestedAutoAnswer: boolean;
  settingAutoAnswer: boolean;
  requireManualReview: boolean;
  blockFinalSubmit: boolean;
  draftOnly: boolean;
  allowAttemptOpen: boolean;
  allowTimedQuiz: boolean;
  allowLimitedAttemptQuiz: boolean;
  allowQuestionRead: boolean;
  allowAnswerFill: boolean;
  allowAnswerChange: boolean;
  allowSaveOrMovePage: boolean;
  allowFinalSubmit: false;
}

export interface QuizContext {
  url?: string;
  title?: string;
  timed?: boolean;
  limitedAttempts?: boolean;
  reason?: string;
}

export class QuizPolicyViolation extends Error {
  readonly action: QuizPolicyAction;
  readonly context: QuizContext;

  constructor(action: QuizPolicyAction, message: string, context: QuizContext = {}) {
    super(message);
    this.name = "QuizPolicyViolation";
    this.action = action;
    this.context = context;
  }
}

export function createQuizPolicy(input: {
  requestedAutoAnswer?: boolean;
  env?: NodeJS.ProcessEnv;
} = {}): QuizPolicy {
  const env = input.env ?? process.env;
  const settingAutoAnswer = parseBoolean(env.MOODLE_QUIZ_AUTO_ANSWER, false);
  const requestedAutoAnswer = input.requestedAutoAnswer ?? settingAutoAnswer;
  const requireManualReview = parseBoolean(env.MOODLE_QUIZ_REQUIRE_MANUAL_REVIEW, true);
  const blockFinalSubmit = parseBoolean(env.MOODLE_QUIZ_BLOCK_FINAL_SUBMIT, true);
  const draftOnly = parseBoolean(env.MOODLE_QUIZ_DRAFT_ONLY, true);
  const allowAnswerFill = requestedAutoAnswer && settingAutoAnswer;

  return {
    requestedAutoAnswer,
    settingAutoAnswer,
    requireManualReview,
    blockFinalSubmit,
    draftOnly,
    allowAttemptOpen: parseBoolean(env.MOODLE_QUIZ_OPEN_ATTEMPTS, allowAnswerFill),
    allowTimedQuiz: parseBoolean(env.MOODLE_QUIZ_ALLOW_TIMED, false),
    allowLimitedAttemptQuiz: parseBoolean(env.MOODLE_QUIZ_ALLOW_LIMITED_ATTEMPTS, false),
    allowQuestionRead: parseBoolean(env.MOODLE_QUIZ_READ_QUESTIONS, true),
    allowAnswerFill,
    allowAnswerChange: parseBoolean(env.MOODLE_QUIZ_ALLOW_CHANGE_EXISTING_ANSWERS, false),
    allowSaveOrMovePage: parseBoolean(env.MOODLE_QUIZ_ALLOW_PAGE_SAVE_OR_MOVE, false),
    allowFinalSubmit: false,
  };
}

export function assertQuizPolicyAllows(
  policy: QuizPolicy,
  action: QuizPolicyAction,
  context: QuizContext = {},
): void {
  const allowed = isQuizPolicyActionAllowed(policy, action);
  if (allowed) {
    return;
  }
  throw new QuizPolicyViolation(action, quizPolicyBlockedMessage(action, context), context);
}

export function quizPolicyBlockedMessage(action: QuizPolicyAction, context: QuizContext = {}): string {
  const target = context.title || context.url;
  const suffix = target ? ` (${target})` : "";
  switch (action) {
    case "open_attempt":
      return `Quiz safety policy blocked opening a Moodle quiz attempt${suffix}.`;
    case "open_timed_quiz":
      return `Quiz safety policy blocked automation for a timed Moodle quiz${suffix}.`;
    case "open_limited_attempt_quiz":
      return `Quiz safety policy blocked automation for a limited-attempt Moodle quiz${suffix}.`;
    case "read_questions":
      return `Quiz safety policy blocked reading Moodle quiz questions${suffix}.`;
    case "fill_answers":
      return `Quiz safety policy blocked filling Moodle quiz answers${suffix}.`;
    case "change_existing_answers":
      return `Quiz safety policy blocked changing existing Moodle quiz answers${suffix}.`;
    case "save_or_move_page":
      return `Quiz safety policy blocked saving or moving Moodle quiz pages${suffix}.`;
    case "final_submit":
      return `Quiz safety policy blocked final Moodle quiz submission${suffix}; final submission is manual-only.`;
  }
}

export function isMoodleQuizAttemptUrl(url: string): boolean {
  const parsed = safeUrl(url);
  return parsed?.pathname === "/mod/quiz/attempt.php";
}

export function isMoodleQuizFinalSubmitUrl(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed || parsed.pathname !== "/mod/quiz/processattempt.php") {
    return false;
  }
  return parsed.searchParams.has("finishattempt") || parsed.searchParams.has("timeup");
}

export function isMoodleQuizSaveOrMoveUrl(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  return parsed.pathname === "/mod/quiz/processattempt.php" || parsed.pathname === "/mod/quiz/summary.php";
}

export function detectQuizRestrictions(input: { url: string; text: string }): QuizContext {
  const parsed = safeUrl(input.url);
  if (!parsed?.pathname.startsWith("/mod/quiz/")) {
    return { url: input.url };
  }
  const text = input.text.toLowerCase();
  return {
    url: input.url,
    timed: /\b(time limit|zeitbegrenzung|zeitlimit|verbleibende zeit|remaining time)\b/i.test(text),
    limitedAttempts: detectsLimitedAttempts(text),
  };
}

function isQuizPolicyActionAllowed(policy: QuizPolicy, action: QuizPolicyAction): boolean {
  switch (action) {
    case "open_attempt":
      return policy.allowAttemptOpen;
    case "open_timed_quiz":
      return policy.allowTimedQuiz;
    case "open_limited_attempt_quiz":
      return policy.allowLimitedAttemptQuiz;
    case "read_questions":
      return policy.allowQuestionRead;
    case "fill_answers":
      return policy.allowAnswerFill;
    case "change_existing_answers":
      return policy.allowAnswerChange;
    case "save_or_move_page":
      return policy.allowSaveOrMovePage;
    case "final_submit":
      return false;
  }
}

function detectsLimitedAttempts(text: string): boolean {
  if (/\b(unlimited attempts|unbegrenzte versuche|beliebig viele versuche)\b/i.test(text)) {
    return false;
  }
  return (
    /\battempts?\s+allowed\s*[:\-]?\s*[1-9]\d*/i.test(text) ||
    /\berlaubte\s+versuche\s*[:\-]?\s*[1-9]\d*/i.test(text) ||
    /\b[1-9]\d*\s+(?:attempts?\s+allowed|versuche?\s+erlaubt)\b/i.test(text) ||
    /\b(?:last|final)\s+attempt\b/i.test(text) ||
    /\bletzter\s+versuch\b/i.test(text)
  );
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
