import type { AgentBrowserClient } from "./agentBrowserClient.js";
import type { QuizSafetyPolicy } from "./types.js";
import type { AnswerSpec, QuizQuestion } from "./nodes/quizReviewNode.js";

export type QuizSafetyAction =
  | "open_quiz_page"
  | "start_or_continue_attempt"
  | "read_questions"
  | "suggest_answers"
  | "fill_answers"
  | "change_existing_answers"
  | "save_or_next_page"
  | "final_submit";

export type QuizAvailabilityStatus =
  | "open"
  | "closed"
  | "not_yet_open"
  | "attempts_exhausted"
  | "unavailable"
  | "unknown";

export type QuizEffectiveTimeSource = "quiz_time_limit" | "deadline" | "unlimited";

export interface QuizIdentityEvidence {
  currentAttemptId: string | null;
  history: Array<{ ordinal: number; attemptId: string | null; source: "history-row" | "history-card" }>;
  continuation: Array<{ attemptId: string; path: string; source: "continue-link" | "continue-form" }>;
}

export interface QuizMetadata {
  timeLimitMinutes: number | null;
  effectiveTimeLimitMinutes: number | null;
  effectiveTimeLimitSource: QuizEffectiveTimeSource;
  timeLimitUnlimited: boolean;
  attemptsAllowed: number | null;
  attemptsUsed: number | null;
  attemptsLeft: number | null;
  attemptsUnlimited: boolean;
  hasActiveAttempt: boolean;
  activeAttemptId?: string | null;
  activeAttemptNumber?: number | null;
  identityEvidence?: QuizIdentityEvidence;
  canStartNewAttempt: boolean;
  availabilityStatus: QuizAvailabilityStatus;
  opensAt: string | null;
  closesAt: string | null;
  availabilityEvidence: string[];
  appearsTimed: boolean;
  appearsLimitedAttempt: boolean;
}

interface QuizMetadataProbe extends Partial<QuizMetadata> {
  bodyText?: string;
  attemptRowCount?: number;
  hasStartControl?: boolean;
  hasContinueControl?: boolean;
}

export type QuizPolicyDecision =
  | {
      status: "allowed";
      action: QuizSafetyAction;
      reason?: string;
      neededPermission?: string;
    }
  | {
      status: "blocked" | "permission_required";
      action: QuizSafetyAction;
      reason: string;
      neededPermission: string;
    };

export const DEFAULT_QUIZ_SAFETY_POLICY: QuizSafetyPolicy = {
  allowOpeningQuizPages: true,
  allowStartingOrContinuingAttempts: false,
  minimumTimeLimitMinutes: 10,
  minimumAttemptsLeft: 2,
  allowReadingQuestions: true,
  allowSuggestingAnswers: false,
  allowFillingAnswers: false,
  allowChangingExistingAnswers: false,
  allowSavingMovingNext: false,
  askBeforeStartingOrContinuingAttempts: true,
  askBeforeTimedQuizzes: true,
  askBeforeLimitedAttemptQuizzes: true,
  askBeforeFillingAnswers: true,
  askBeforeChangingExistingAnswers: true,
  fillConfidenceThreshold: 0.85,
  finalSubmissionBlocked: true,
  accessMode: "review-only",
};

const QUIZ_METADATA_EXTRACTION_JS = String.raw`
(() => {
  const marker = "QUIZ_METADATA_EXTRACTION";
  void marker;
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const bodyText = normalize(document.body ? document.body.innerText || document.body.textContent : "");
  const controlDetails = [...document.querySelectorAll("button, a, input[type='submit'], input[type='button']")]
    .map(element => ({
      element,
      text: normalize(element.innerText || element.value || element.getAttribute("aria-label") || element.textContent),
      href: element.getAttribute("href") || "",
      formAction: element.form?.action || element.closest("form")?.action || "",
      name: element.getAttribute("name") || "",
      disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true"
    }))
    .filter(control => !control.disabled);
  const pageUrl = new URL(location.href);
  const quizPath = pageUrl.pathname.slice(0, pageUrl.pathname.lastIndexOf("/"));
  const cmid = /\/view\.php$/.test(pageUrl.pathname) ? pageUrl.searchParams.get("id") : pageUrl.searchParams.get("cmid");
  const attemptIdentity = (raw, form = null) => {
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== pageUrl.origin || url.username || url.password ||
          !["attempt.php", "review.php", "summary.php"].some(file => url.pathname === quizPath + "/" + file)) return null;
      const targetIds = url.searchParams.getAll("cmid");
      if (cmid && targetIds.some(id => id !== cmid)) return null;
      const ids = [...url.searchParams.getAll("attempt"), ...url.searchParams.getAll("attemptid")];
      if (form) for (const field of form.querySelectorAll("input[type='hidden'][name='attempt'], input[type='hidden'][name='attemptid']")) ids.push(field.value);
      if (!ids.length || ids.some(id => !/^\d+$/.test(id) || id !== ids[0])) return null;
      return {attemptId: ids[0], pathname: url.pathname, path: url.pathname + "?attempt=" + ids[0]};
    } catch { return null; }
  };
  const continuation = [];
  const continuationElements = new Map();
  for (const control of controlDetails) {
    const identity = control.href ? attemptIdentity(control.href) : null;
    if (identity && identity.pathname.endsWith("/attempt.php")) {
      continuation.push({attemptId: identity.attemptId, path: identity.path, source: "continue-link"});
      continuationElements.set(control.element, identity.attemptId);
    }
  }
  for (const form of document.querySelectorAll("form")) {
    if (!controlDetails.some(control => form.contains(control.element) && /versuch fortsetzen|continue attempt/i.test(control.text))) continue;
    const identity = attemptIdentity(form.action, form);
    if (identity && identity.pathname.endsWith("/attempt.php")) {
      continuation.push({attemptId: identity.attemptId, path: identity.path, source: "continue-form"});
      continuationElements.set(form, identity.attemptId);
    }
  }
  const history = [];
  const activeRecords = [];
  const rows = [...document.querySelectorAll("table tbody tr, .quizattempt, .attempt-row")];
  const cards = [...document.querySelectorAll(".card")].filter(card => card.querySelector("dl, table.quizreviewsummary") &&
    !card.closest(".que, [id^='question-']"));
  for (const record of [...rows, ...cards]) {
    if (record.closest(".que, [id^='question-']") || record.closest("table.quizreviewsummary")) continue;
    const card = cards.includes(record);
    const text = normalize(record.innerText || record.textContent);
    const headings = card ? [...record.querySelectorAll("h2,h3,h4,h5,h6,[role='heading'],caption")].map(h => normalize(h.textContent)) : [];
    const headingNumbers = headings.map(t => /^(?:versuch|attempt|zusammenfassung von versuch|summary of attempt)\s+(\d+)$/i.exec(t)?.[1]).filter(Boolean);
    const firstCell = normalize(record.querySelector("td")?.textContent);
    const number = card ? Number(headingNumbers[0] || "") : Number(/(?:versuch|attempt)\s*(\d+)/i.exec(text)?.[1] || (/^\d+$/.test(firstCell) ? firstCell : ""));
    if (!Number.isSafeInteger(number) || number <= 0 || card && headingNumbers.some(n => Number(n) !== number)) continue;
    const identities = [...record.querySelectorAll("a[href]")].map(a => attemptIdentity(a.getAttribute("href"))).filter(Boolean);
    const continuationIds = [...continuationElements].filter(([element]) => record.contains(element)).map(([, id]) => id);
    const ids = [...new Set([...identities.map(i => i.attemptId), ...continuationIds])];
    const attemptId = ids.length === 1 ? ids[0] : null;
    history.push({ordinal: number, attemptId, source: card ? "history-card" : "history-row"});
    const statusTerms = [...record.querySelectorAll("dt, table.quizreviewsummary th[scope='row']")].filter(dt => /^(?:status|state)$/i.test(normalize(dt.textContent)));
    const inProgress = statusTerms.some(dt => /^(?:in bearbeitung|in progress)$/i.test(normalize(dt.nextElementSibling?.textContent)));
    if (continuationIds.length || inProgress) activeRecords.push({ordinal: number, attemptId});
  }
  const current = /\/attempt\.php$/.test(pageUrl.pathname) ? attemptIdentity(pageUrl.href) : null;
  const activeIds = [...new Set([...(current ? [current.attemptId] : []), ...continuation.map(c => c.attemptId)])];
  const activeAttemptId = activeIds.length === 1 ? activeIds[0] : null;
  const matchingRecords = activeAttemptId ? history.filter(record => record.attemptId === activeAttemptId) : [];
  const ordinals = [...new Set(matchingRecords.map(record => record.ordinal))];
  const activeAttemptNumber = ordinals.length === 1 ? ordinals[0] : null;
  const hasContinueControl = Boolean(current && document.querySelector(".que, [id^='question-']")) ||
    continuation.length > 0 || activeRecords.length > 0 || controlDetails.some(control => /versuch fortsetzen|continue attempt|attempt in progress/i.test(control.text));
  const hasStartControl = controlDetails.some(control =>
    /test versuchen|test wiederholen|versuch beginnen|versuch wiederholen|attempt quiz|start attempt|re-attempt quiz|attempt again|repeat attempt/i.test(control.text) ||
    /\/mod\/quiz\/startattempt\.php/i.test(control.href + " " + control.formAction) || control.name.toLowerCase() === "startattempt");
  const firstStartControl = controlDetails.some(control => /^(?:test versuchen|attempt quiz)$/i.test(control.text));
  const repeatControl = controlDetails.some(control => /test wiederholen|versuch wiederholen|re-attempt quiz|attempt again|repeat attempt/i.test(control.text));
  const noAttemptEvidence = !hasContinueControl && !repeatControl && history.length === 0 &&
    (/(?:no attempts yet|no previous attempts|noch keine versuche|bisher keine versuche)/i.test(bodyText) || firstStartControl);
  const attemptsUsed = history.length ? Math.max(...history.map(record => record.ordinal)) : (noAttemptEvidence ? 0 : null);
  const identityEvidence = {currentAttemptId: current?.attemptId || null, history: history.slice(0,32), continuation: continuation.slice(0,32)};
  const dateValue = kind => {
    const label = kind === "open"
      ? /(?:^|\s)(?:geöffnet|geoeffnet|öffnet|oeffnet|opens?)(?=\s|:)/i
      : /(?:^|\s)(?:geschlossen|schließt|schliesst|closed|closes?)(?=\s|:)/i;
    for (const element of document.querySelectorAll("time[datetime], [data-timestamp]")) {
      let context = "";
      let ancestor = element;
      for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const candidate = normalize(ancestor.innerText || ancestor.textContent);
        if (candidate.length <= 500 && label.test(candidate)) {
          context = candidate;
          break;
        }
      }
      if (!context) continue;
      const datetime = element.getAttribute("datetime");
      const timestamp = Number(element.getAttribute("data-timestamp"));
      if (datetime) return datetime;
      if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString();
    }
    return null;
  };
  return JSON.stringify({
    bodyText,
    attemptsUsed,
    activeAttemptId,
    activeAttemptNumber,
    attemptRowCount: history.length || null,
    identityEvidence,
    hasStartControl,
    hasContinueControl,
    opensAt: dateValue("open"),
    closesAt: dateValue("close")
  });
})()
`;

export async function extractQuizMetadata(client: AgentBrowserClient): Promise<QuizMetadata> {
  const metadata = await client.evalJson<QuizMetadataProbe>(QUIZ_METADATA_EXTRACTION_JS);
  return normalizeQuizMetadata(metadata);
}

export function normalizeQuizMetadata(
  value: QuizMetadataProbe = {},
  options: { now?: Date } = {},
): QuizMetadata {
  const bodyText = normalizeText(value.bodyText);
  const attemptsAllowed =
    finiteOrNull(value.attemptsAllowed) ??
    numberAfter(bodyText, [
      /attempts allowed\s*:?\s*(\d+)/i,
      /allowed attempts\s*:?\s*(\d+)/i,
      /erlaubte versuche\s*:?\s*(\d+)/i,
      /versuche erlaubt\s*:?\s*(\d+)/i,
    ]);
  const attemptsUsed =
    finiteOrNull(value.attemptsUsed) ??
    numberAfter(bodyText, [
      /attempts used\s*:?\s*(\d+)/i,
      /used attempts\s*:?\s*(\d+)/i,
      /versuche verwendet\s*:?\s*(\d+)/i,
      /verwendete versuche\s*:?\s*(\d+)/i,
      /bisherige versuche\s*:?\s*(\d+)/i,
    ]) ??
    countNumberedAttempts(bodyText) ??
    finiteOrNull(value.attemptRowCount);
  const explicitAttemptsLeft =
    finiteOrNull(value.attemptsLeft) ??
    numberAfter(bodyText, [
      /attempts left\s*:?\s*(\d+)/i,
      /remaining attempts\s*:?\s*(\d+)/i,
      /verbleibende versuche\s*:?\s*(\d+)/i,
      /versuche übrig\s*:?\s*(\d+)/i,
      /versuche uebrig\s*:?\s*(\d+)/i,
    ]);
  const attemptsLeft =
    explicitAttemptsLeft ??
    (attemptsAllowed !== null && attemptsUsed !== null
      ? Math.max(0, attemptsAllowed - attemptsUsed)
      : null);
  const attemptsUnlimited =
    value.attemptsUnlimited === true ||
    /(?:unlimited attempts|attempts allowed\s*:?\s*unlimited|unbegrenzte versuche|beliebig viele versuche|erlaubte versuche\s*:?\s*unbegrenzt)/i.test(
      bodyText,
    ) ||
    (attemptsAllowed === null && explicitAttemptsLeft === null);
  const timeLimitMinutes =
    positiveOrNull(value.timeLimitMinutes) ?? positiveOrNull(parseTimeLimitMinutes(bodyText));
  const hasActiveAttempt =
    value.hasActiveAttempt === true ||
    value.hasContinueControl === true ||
    /continue attempt|attempt in progress|versuch fortsetzen|laufender versuch/i.test(bodyText);
  const now = options.now ?? new Date();
  const probedOpensAt = isoOrNull(value.opensAt);
  const probedClosesAt = isoOrNull(value.closesAt);
  const opensAt = probedOpensAt ?? parseQuizDateFromText(bodyText, "open");
  const closesAt = probedClosesAt ?? parseQuizDateFromText(bodyText, "close");
  const effectiveTime = deriveEffectiveTimeLimit(timeLimitMinutes, closesAt, now);
  const availabilityEvidence: string[] = [];
  if (opensAt) availabilityEvidence.push(probedOpensAt ? "open-time-dom" : "open-time-text");
  if (closesAt) availabilityEvidence.push(probedClosesAt ? "close-time-dom" : "close-time-text");
  const availabilityStatus = inferAvailabilityStatus({
    explicit: value.availabilityStatus,
    bodyText,
    attemptsLeft,
    hasActiveAttempt,
    hasStartControl: value.hasStartControl === true,
    opensAt,
    closesAt,
    now,
    evidence: availabilityEvidence,
  });
  const canStartNewAttempt =
    value.canStartNewAttempt === true ||
    (availabilityStatus === "open" && value.hasStartControl === true && attemptsLeft !== 0);
  return {
    timeLimitMinutes,
    effectiveTimeLimitMinutes: effectiveTime.minutes,
    effectiveTimeLimitSource: effectiveTime.source,
    timeLimitUnlimited: timeLimitMinutes === null,
    attemptsAllowed,
    attemptsUsed,
    attemptsLeft,
    attemptsUnlimited,
    hasActiveAttempt,
    activeAttemptId: typeof value.activeAttemptId === "string" && /^\d+$/.test(value.activeAttemptId) ? value.activeAttemptId : null,
    activeAttemptNumber: finiteOrNull(value.activeAttemptNumber),
    ...(value.identityEvidence ? {identityEvidence: sanitizeQuizIdentityEvidence(value.identityEvidence)} : {}),
    canStartNewAttempt,
    availabilityStatus,
    opensAt,
    closesAt,
    availabilityEvidence,
    appearsTimed: value.appearsTimed === true || effectiveTime.minutes !== null,
    appearsLimitedAttempt:
      !attemptsUnlimited &&
      (value.appearsLimitedAttempt === true || attemptsAllowed !== null || attemptsLeft !== null),
  };
}

/** Only known identity fields cross the model-visible metadata boundary. */
function sanitizeQuizIdentityEvidence(value: QuizIdentityEvidence): QuizIdentityEvidence {
  const id = (v: unknown) => typeof v === "string" && /^\d{1,20}$/.test(v) ? v : null;
  const history = Array.isArray(value.history) ? value.history.slice(0, 32).flatMap(record => {
    if (!record || !Number.isSafeInteger(record.ordinal) || record.ordinal < 1 ||
        !["history-row", "history-card"].includes(record.source)) return [];
    return [{ordinal: record.ordinal, attemptId: id(record.attemptId), source: record.source}];
  }) : [];
  const continuation = Array.isArray(value.continuation) ? value.continuation.slice(0, 32).flatMap(record => {
    const attemptId = id(record?.attemptId);
    if (!attemptId || !["continue-link", "continue-form"].includes(record.source) ||
        typeof record.path !== "string" || !/^\/(?:[a-zA-Z0-9_-]+\/)*mod\/quiz\/attempt\.php\?attempt=\d{1,20}$/.test(record.path) ||
        !record.path.endsWith("?attempt=" + attemptId)) return [];
    return [{attemptId, path: record.path, source: record.source}];
  }) : [];
  return {currentAttemptId: id(value.currentAttemptId), history, continuation};
}

export function enforceQuizSafetyPolicy(
  policy: QuizSafetyPolicy | undefined,
  action: QuizSafetyAction,
  context: {
    metadata?: QuizMetadata;
    question?: QuizQuestion;
    answer?: AnswerSpec;
  } = {},
): QuizPolicyDecision {
  const effectivePolicy = policy ?? DEFAULT_QUIZ_SAFETY_POLICY;
  switch (action) {
    case "open_quiz_page":
      return effectivePolicy.allowOpeningQuizPages
        ? allowed(action)
        : blocked(action, "opening-quiz-pages-disabled", "allow_opening_quiz_pages");
    case "start_or_continue_attempt":
      return enforceAttemptPolicy(effectivePolicy, context.metadata);
    case "read_questions":
      return effectivePolicy.allowReadingQuestions
        ? allowed(action)
        : blocked(action, "reading-questions-disabled", "allow_reading_questions");
    case "suggest_answers":
      return effectivePolicy.allowSuggestingAnswers
        ? allowed(action)
        : blocked(action, "answer-suggestions-disabled", "allow_suggesting_answers");
    case "fill_answers":
      return enforceFillPolicy(effectivePolicy, context.question, context.answer);
    case "change_existing_answers":
      return enforceChangeExistingPolicy(effectivePolicy);
    case "save_or_next_page":
      return effectivePolicy.allowSavingMovingNext
        ? allowed(action)
        : blocked(action, "save-next-disabled", "allow_save_or_next_page");
    case "final_submit":
      return blocked(action, "final-submission-manual-only", "manual_final_submission");
  }
}

export function requiresFirstQuizAttempt(policy: QuizSafetyPolicy | undefined, metadata: QuizMetadata | undefined): boolean {
  return policy?.firstAttemptOnly === true || Boolean(metadata && metadata.attemptsAllowed !== null && metadata.attemptsAllowed >= 2);
}

export function questionHasExistingAnswer(question: QuizQuestion): boolean {
  return question.controls.some((control) => {
    const type = String(control.type ?? control.tag ?? "").toLowerCase();
    if (type === "radio" || type === "checkbox") {
      return control.checked === true;
    }
    const value = control.value;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function enforceAttemptPolicy(
  policy: QuizSafetyPolicy,
  metadata: QuizMetadata | undefined,
): QuizPolicyDecision {
  const action: QuizSafetyAction = "start_or_continue_attempt";
  if (metadata?.availabilityStatus === "closed") {
    return blocked(action, "quiz-closed", "quiz_unavailable");
  }
  if (metadata?.availabilityStatus === "not_yet_open") {
    return blocked(action, "quiz-not-yet-open", "quiz_unavailable");
  }
  if (metadata?.availabilityStatus === "attempts_exhausted") {
    return blocked(action, "quiz-attempts-exhausted", "quiz_unavailable");
  }
  if (metadata?.availabilityStatus === "unavailable") {
    return blocked(action, "quiz-unavailable", "quiz_unavailable");
  }
  if (metadata?.availabilityStatus === "unknown" && !metadata.hasActiveAttempt) {
    return blocked(action, "quiz-availability-unknown", "inspect_quiz_availability");
  }
  if (!policy.allowStartingOrContinuingAttempts) {
    return blocked(
      action,
      "starting-or-continuing-attempts-disabled",
      "allow_start_or_continue_attempt",
    );
  }
  if (requiresFirstQuizAttempt(policy, metadata)) {
    if (!metadata?.hasActiveAttempt && metadata?.attemptsUsed !== 0) {
      return blocked(action, "first-attempt-only-history-not-zero", "first_quiz_attempt_only");
    }
    if (metadata?.hasActiveAttempt && (metadata.attemptsUsed !== 1 || metadata.activeAttemptNumber !== 1 || !metadata.activeAttemptId)) {
      return blocked(action, "first-attempt-only-active-identity-unconfirmed", "first_quiz_attempt_only");
    }
  }
  if (
    metadata?.appearsTimed &&
    metadata.effectiveTimeLimitMinutes !== null &&
    metadata.effectiveTimeLimitMinutes < policy.minimumTimeLimitMinutes &&
    !(metadata.hasActiveAttempt && !policy.askBeforeStartingOrContinuingAttempts &&
      !policy.askBeforeTimedQuizzes &&
      (!metadata.appearsLimitedAttempt || !policy.askBeforeLimitedAttemptQuizzes))
  ) {
    return blocked(action, "timed-quiz-below-minimum-time-limit", "allow_lower_time_limit");
  }
  if (
    metadata?.appearsLimitedAttempt &&
    !metadata.hasActiveAttempt &&
    metadata.attemptsLeft !== null &&
    metadata.attemptsLeft < policy.minimumAttemptsLeft
  ) {
    return blocked(
      action,
      "limited-attempt-quiz-below-minimum-attempts-left",
      "allow_lower_attempts_left",
    );
  }
  if (policy.askBeforeStartingOrContinuingAttempts) {
    return permissionRequired(action, "quiz-attempt-needs-confirmation", "confirm_quiz_attempt");
  }
  if (metadata?.appearsTimed && policy.askBeforeTimedQuizzes) {
    return permissionRequired(action, "timed-quiz-needs-confirmation", "confirm_timed_quiz");
  }
  if (metadata?.appearsLimitedAttempt && policy.askBeforeLimitedAttemptQuizzes) {
    return permissionRequired(
      action,
      "limited-attempt-quiz-needs-confirmation",
      "confirm_limited_attempt_quiz",
    );
  }
  return allowed(action);
}

function inferAvailabilityStatus(input: {
  explicit?: QuizAvailabilityStatus;
  bodyText: string;
  attemptsLeft: number | null;
  hasActiveAttempt: boolean;
  hasStartControl: boolean;
  opensAt: string | null;
  closesAt: string | null;
  now: Date;
  evidence: string[];
}): QuizAvailabilityStatus {
  if (isAvailabilityStatus(input.explicit)) {
    input.evidence.push("explicit-status");
    return input.explicit;
  }
  const now = input.now.getTime();
  const opensAt = input.opensAt ? new Date(input.opensAt).getTime() : Number.NaN;
  const closesAt = input.closesAt ? new Date(input.closesAt).getTime() : Number.NaN;
  if (input.attemptsLeft === 0 && !input.hasActiveAttempt) {
    input.evidence.push("attempts-left-zero");
    return "attempts_exhausted";
  }
  if (Number.isFinite(closesAt) && closesAt <= now) {
    input.evidence.push("close-time-passed");
    return "closed";
  }
  if (Number.isFinite(opensAt) && opensAt > now) {
    input.evidence.push("open-time-in-future");
    return "not_yet_open";
  }
  if (input.hasActiveAttempt) {
    input.evidence.push("active-attempt-control-or-text");
    return "open";
  }
  if (input.hasStartControl) {
    input.evidence.push("enabled-start-control");
    return "open";
  }
  if (
    /(?:dieser\s+(?:test|quiz)\s+(?:wurde\s+)?geschlossen|(?:test|quiz)\s+is\s+closed|no\s+longer\s+available)/i.test(
      input.bodyText,
    )
  ) {
    input.evidence.push("closed-state-text");
    return "closed";
  }
  if (
    /(?:noch nicht geöffnet|noch nicht geoeffnet|not yet open|opens?\s+(?:on|at)|geöffnet\s+ab|geoeffnet\s+ab)/i.test(
      input.bodyText,
    )
  ) {
    input.evidence.push("not-yet-open-text");
    return "not_yet_open";
  }
  if (
    /(?:not currently available|nicht verfügbar|nicht verfuegbar|not available anymore)/i.test(
      input.bodyText,
    )
  ) {
    input.evidence.push("unavailable-state-text");
    return "unavailable";
  }
  input.evidence.push("no-authoritative-availability-signal");
  return "unknown";
}

function parseTimeLimitMinutes(text: string): number | null {
  const minutes =
    /(?:time limit|zeitbegrenzung|zeitlimit)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:minutes?|mins?|minuten?|min\b)/i.exec(
      text,
    );
  if (minutes) return Number(minutes[1].replace(",", "."));
  const hours =
    /(?:time limit|zeitbegrenzung|zeitlimit)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:hours?|stunden?|std\.?)/i.exec(
      text,
    );
  return hours ? Number(hours[1].replace(",", ".")) * 60 : null;
}

function deriveEffectiveTimeLimit(
  configuredMinutes: number | null,
  closesAt: string | null,
  now: Date,
): { minutes: number | null; source: QuizEffectiveTimeSource } {
  const closesAtMs = closesAt ? new Date(closesAt).getTime() : Number.NaN;
  const deadlineMinutes = Number.isFinite(closesAtMs)
    ? Math.max(0, Math.floor((closesAtMs - now.getTime()) / 60_000))
    : null;

  if (configuredMinutes === null && deadlineMinutes === null) {
    return { minutes: null, source: "unlimited" };
  }
  if (
    deadlineMinutes !== null &&
    (configuredMinutes === null || deadlineMinutes < configuredMinutes)
  ) {
    return { minutes: deadlineMinutes, source: "deadline" };
  }
  return { minutes: configuredMinutes, source: "quiz_time_limit" };
}

function parseQuizDateFromText(text: string, kind: "open" | "close"): string | null {
  const label =
    kind === "open"
      ? "(?:^|\\s)(?:geöffnet|geoeffnet|öffnet|oeffnet|opens?)(?=\\s|:)"
      : "(?:^|\\s)(?:geschlossen|schließt|schliesst|closed|closes?)(?=\\s|:)";
  const numeric = new RegExp(
    `${label}\\s*:?\\s*(?:[\\p{L}.]+,?\\s+)?(\\d{1,2})[./](\\d{1,2})[./](\\d{4}),?\\s+(\\d{1,2})[:.](\\d{2})\\s*(am|pm)?`,
    "iu",
  ).exec(text);
  if (numeric) {
    return localDateToIso(
      numeric[3],
      String(Number(numeric[2]) - 1),
      numeric[1],
      hourWithMeridiem(numeric[4], numeric[6]),
      numeric[5],
    );
  }
  const dayFirst = new RegExp(
    `${label}\\s*:?\\s*(?:[\\p{L}.]+,?\\s+)?(\\d{1,2})[.\\s]+([\\p{L}.]+)\\s+(\\d{4}),?\\s+(\\d{1,2})[:.](\\d{2})\\s*(am|pm)?`,
    "iu",
  ).exec(text);
  if (dayFirst) {
    return localDateToIso(
      dayFirst[3],
      dayFirst[2],
      dayFirst[1],
      hourWithMeridiem(dayFirst[4], dayFirst[6]),
      dayFirst[5],
    );
  }
  const monthFirst = new RegExp(
    `${label}\\s*:?\\s*(?:[\\p{L}.]+,?\\s+)?([\\p{L}.]+)\\s+(\\d{1,2}),?\\s+(\\d{4}),?\\s+(\\d{1,2})[:.](\\d{2})\\s*(am|pm)?`,
    "iu",
  ).exec(text);
  if (!monthFirst) return null;
  return localDateToIso(
    monthFirst[3],
    monthFirst[1],
    monthFirst[2],
    hourWithMeridiem(monthFirst[4], monthFirst[6]),
    monthFirst[5],
  );
}

function hourWithMeridiem(hourText: string, meridiemText: string | undefined): number {
  let hour = Number(hourText);
  const meridiem = meridiemText?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour;
}

function localDateToIso(
  yearText: string,
  monthText: string,
  dayText: string,
  hourText: string | number,
  minuteText: string,
): string | null {
  const month = monthIndex(monthText);
  if (month === null) return null;
  const year = Number(yearText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const parsed = new Date(year, month, day, hour, minute);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }
  return parsed.toISOString();
}

function monthIndex(value: string): number | null {
  if (/^(?:[0-9]|1[01])$/.test(value)) return Number(value);
  const normalized = value.toLocaleLowerCase("de-AT").replace(/\.$/, "");
  const months: Record<string, number> = {
    januar: 0,
    jan: 0,
    january: 0,
    februar: 1,
    feb: 1,
    february: 1,
    märz: 2,
    maerz: 2,
    mar: 2,
    mär: 2,
    march: 2,
    april: 3,
    apr: 3,
    mai: 4,
    may: 4,
    juni: 5,
    jun: 5,
    june: 5,
    juli: 6,
    jul: 6,
    july: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    oktober: 9,
    okt: 9,
    oct: 9,
    october: 9,
    november: 10,
    nov: 10,
    dezember: 11,
    dez: 11,
    dec: 11,
    december: 11,
  };
  return months[normalized] ?? null;
}

function numberAfter(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

function countNumberedAttempts(text: string): number | null {
  const attemptNumbers = new Set(
    [...text.matchAll(/(?:^|\s)(?:versuch|attempt)\s+(\d+)(?=\s|$)/gi)].map((match) => match[1]),
  );
  return attemptNumbers.size > 0 ? attemptNumbers.size : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isAvailabilityStatus(value: unknown): value is QuizAvailabilityStatus {
  return (
    value === "open" ||
    value === "closed" ||
    value === "not_yet_open" ||
    value === "attempts_exhausted" ||
    value === "unavailable" ||
    value === "unknown"
  );
}

function enforceFillPolicy(
  policy: QuizSafetyPolicy,
  question: QuizQuestion | undefined,
  answer: AnswerSpec | undefined,
): QuizPolicyDecision {
  const action: QuizSafetyAction = "fill_answers";
  if (!policy.allowFillingAnswers) {
    return blocked(action, "filling-answers-disabled", "allow_filling_answers");
  }
  const confidence = Number(answer?.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < policy.fillConfidenceThreshold) {
    return blocked(action, "answer-confidence-below-threshold", "lower_fill_confidence_threshold");
  }
  if (question && questionHasExistingAnswer(question)) {
    const changeDecision = enforceChangeExistingPolicy(policy);
    if (changeDecision.status !== "allowed") {
      return changeDecision;
    }
  }
  if (policy.askBeforeFillingAnswers) {
    return permissionRequired(
      action,
      "filling-answers-needs-confirmation",
      "confirm_filling_answers",
    );
  }
  return allowed(action);
}

function enforceChangeExistingPolicy(policy: QuizSafetyPolicy): QuizPolicyDecision {
  const action: QuizSafetyAction = "change_existing_answers";
  if (!policy.allowChangingExistingAnswers) {
    return blocked(action, "changing-existing-answers-disabled", "allow_changing_existing_answers");
  }
  if (policy.askBeforeChangingExistingAnswers) {
    return permissionRequired(
      action,
      "changing-existing-answers-needs-confirmation",
      "confirm_changing_existing_answers",
    );
  }
  return allowed(action);
}

function allowed(action: QuizSafetyAction): QuizPolicyDecision {
  return { status: "allowed", action };
}

function blocked(
  action: QuizSafetyAction,
  reason: string,
  neededPermission: string,
): QuizPolicyDecision {
  return { status: "blocked", action, reason, neededPermission };
}

function permissionRequired(
  action: QuizSafetyAction,
  reason: string,
  neededPermission: string,
): QuizPolicyDecision {
  return { status: "permission_required", action, reason, neededPermission };
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveOrNull(value: unknown): number | null {
  const parsed = finiteOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}
