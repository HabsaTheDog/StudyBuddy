import {
  DEFAULT_QUIZ_SAFETY_POLICY,
  enforceQuizSafetyPolicy,
  type QuizSafetyAction,
} from "./quizSafetyPolicy.js";
import type { QuizAccessMode, QuizSafetyPolicy } from "./types.js";

/**
 * The two actions available to automatic Study Builder quiz evidence acquisition.
 * They deliberately name completed-attempt reviews so a generic quiz-page or
 * active-attempt read cannot be mistaken for an authorized evidence action.
 */
export type StudyBuilderQuizEvidenceReadAction =
  | "open_completed_attempt_review"
  | "read_completed_attempt_review";

export type StudyBuilderQuizEvidenceRequestedAction =
  | StudyBuilderQuizEvidenceReadAction
  | QuizSafetyAction;

export type StudyBuilderQuizEvidenceDecision =
  | {
      status: "allowed";
      action: StudyBuilderQuizEvidenceRequestedAction;
      policyAction: "open_quiz_page" | "read_questions";
      reason: "effective-policy-allows";
    }
  | {
      status: "blocked";
      action: StudyBuilderQuizEvidenceRequestedAction;
      policyAction: QuizSafetyAction | null;
      reason: string;
      neededPermission: string;
    };

/**
 * This entry intentionally has no URL, attempt ID, question text, answer,
 * feedback, credential, or arbitrary error field.
 */
export interface StudyBuilderQuizEvidenceAuditEntry {
  readonly version: 1;
  readonly lane: "study-builder-quiz-evidence";
  readonly sequence: number;
  readonly occurredAt: string;
  readonly accessMode: QuizAccessMode;
  readonly action: StudyBuilderQuizEvidenceRequestedAction;
  readonly policyAction: QuizSafetyAction | null;
  readonly decision: "allowed" | "blocked";
  readonly reason: string;
}

export interface CompletedAttemptReviewReference {
  readonly completionState: "completed";
  readonly reviewUrl: string;
}

export interface OpenedAttemptReview<OpenedReview> {
  readonly completionState: "completed" | "active" | "unknown";
  readonly handle: OpenedReview;
}

/**
 * The acquisition port has no start, continue, fill, change, save, next, or
 * submit operation. Implementations should reuse an already-discovered review
 * reference; this adapter performs no discovery or second crawl.
 */
export interface CompletedAttemptReviewReader<OpenedReview, Evidence> {
  openCompletedAttemptReview(
    reference: CompletedAttemptReviewReference,
  ): Promise<OpenedAttemptReview<OpenedReview>>;
  readVisibleCompletedAttemptReview(openedReview: OpenedReview): Promise<Evidence>;
}

export type CompletedAttemptReviewReadResult<Evidence> =
  | {
      status: "read";
      evidence: Evidence;
    }
  | {
      status: "blocked";
      decision: Extract<StudyBuilderQuizEvidenceDecision, { status: "blocked" }>;
    };

export interface StudyBuilderQuizEvidenceCapability<Evidence> {
  readonly evaluate: (
    action: StudyBuilderQuizEvidenceRequestedAction,
  ) => StudyBuilderQuizEvidenceDecision;
  readonly readCompletedAttemptReview: (
    reference: CompletedAttemptReviewReference,
  ) => Promise<CompletedAttemptReviewReadResult<Evidence>>;
  readonly getAuditEntries: () => readonly StudyBuilderQuizEvidenceAuditEntry[];
}

export interface StudyBuilderQuizEvidenceCapabilityOptions<OpenedReview, Evidence> {
  policy?: QuizSafetyPolicy | undefined;
  reader: CompletedAttemptReviewReader<OpenedReview, Evidence>;
  now?: (() => Date) | undefined;
  audit?: ((entry: StudyBuilderQuizEvidenceAuditEntry) => void) | undefined;
}

const READ_ACTION_POLICY_MAP = {
  open_completed_attempt_review: "open_quiz_page",
  read_completed_attempt_review: "read_questions",
} as const satisfies Record<StudyBuilderQuizEvidenceReadAction, QuizSafetyAction>;

const READ_ONLY_LANE_REASON = "study-builder-quiz-evidence-read-only";
const READ_ONLY_LANE_PERMISSION = "separate_explicit_quiz_assist";

/**
 * Derives a decision from the existing effective QuizSafetyPolicy while
 * enforcing the narrower, immutable Study Builder evidence lane.
 */
export function decideStudyBuilderQuizEvidenceAction(
  policy: QuizSafetyPolicy | undefined,
  action: StudyBuilderQuizEvidenceRequestedAction,
): StudyBuilderQuizEvidenceDecision {
  if (!isStudyBuilderReadAction(action)) {
    return {
      status: "blocked",
      action,
      policyAction: action,
      reason: READ_ONLY_LANE_REASON,
      neededPermission: READ_ONLY_LANE_PERMISSION,
    };
  }

  const policyAction = READ_ACTION_POLICY_MAP[action];
  const policyDecision = enforceQuizSafetyPolicy(policy, policyAction);
  if (policyDecision.status !== "allowed") {
    return {
      status: "blocked",
      action,
      policyAction,
      reason: policyDecision.reason,
      neededPermission: policyDecision.neededPermission,
    };
  }
  return {
    status: "allowed",
    action,
    policyAction,
    reason: "effective-policy-allows",
  };
}

export function createStudyBuilderQuizEvidenceCapability<OpenedReview, Evidence>(
  options: StudyBuilderQuizEvidenceCapabilityOptions<OpenedReview, Evidence>,
): StudyBuilderQuizEvidenceCapability<Evidence> {
  const effectivePolicy = options.policy ?? DEFAULT_QUIZ_SAFETY_POLICY;
  const now = options.now ?? (() => new Date());
  const auditEntries: StudyBuilderQuizEvidenceAuditEntry[] = [];

  const evaluate = (
    action: StudyBuilderQuizEvidenceRequestedAction,
  ): StudyBuilderQuizEvidenceDecision => {
    const decision = decideStudyBuilderQuizEvidenceAction(effectivePolicy, action);
    const entry = Object.freeze({
      version: 1 as const,
      lane: "study-builder-quiz-evidence" as const,
      sequence: auditEntries.length + 1,
      occurredAt: now().toISOString(),
      accessMode: effectivePolicy.accessMode,
      action,
      policyAction: decision.policyAction,
      decision: decision.status,
      reason: decision.reason,
    });
    auditEntries.push(entry);
    options.audit?.(entry);
    return decision;
  };

  const readCompletedAttemptReview = async (
    reference: CompletedAttemptReviewReference,
  ): Promise<CompletedAttemptReviewReadResult<Evidence>> => {
    const referenceDecision = validateCompletedAttemptReviewReference(reference);
    if (referenceDecision) {
      const decision = recordBlockedDecision(
        "open_completed_attempt_review",
        "open_quiz_page",
        referenceDecision,
        effectivePolicy,
        now,
        auditEntries,
        options.audit,
      );
      return { status: "blocked", decision };
    }

    const openDecision = evaluate("open_completed_attempt_review");
    if (openDecision.status === "blocked") {
      return { status: "blocked", decision: openDecision };
    }
    const openedReview = await options.reader.openCompletedAttemptReview(reference);
    if (openedReview.completionState !== "completed") {
      const decision = recordBlockedDecision(
        "read_completed_attempt_review",
        "read_questions",
        "opened-review-is-not-completed",
        effectivePolicy,
        now,
        auditEntries,
        options.audit,
      );
      return { status: "blocked", decision };
    }

    const readDecision = evaluate("read_completed_attempt_review");
    if (readDecision.status === "blocked") {
      return { status: "blocked", decision: readDecision };
    }
    const evidence =
      await options.reader.readVisibleCompletedAttemptReview(openedReview.handle);
    return { status: "read", evidence };
  };

  return Object.freeze({
    evaluate,
    readCompletedAttemptReview,
    getAuditEntries: () =>
      Object.freeze(auditEntries.map((entry) => Object.freeze({ ...entry }))),
  });
}

function isStudyBuilderReadAction(
  action: StudyBuilderQuizEvidenceRequestedAction,
): action is StudyBuilderQuizEvidenceReadAction {
  return (
    action === "open_completed_attempt_review" ||
    action === "read_completed_attempt_review"
  );
}

function validateCompletedAttemptReviewReference(
  reference: CompletedAttemptReviewReference,
): string | null {
  if (reference.completionState !== "completed") {
    return "attempt-is-not-completed";
  }
  try {
    const url = new URL(reference.reviewUrl);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.pathname.endsWith("/mod/quiz/review.php") ||
      !url.searchParams.get("attempt")
    ) {
      return "invalid-completed-attempt-review-reference";
    }
  } catch {
    return "invalid-completed-attempt-review-reference";
  }
  return null;
}

function recordBlockedDecision(
  action: StudyBuilderQuizEvidenceReadAction,
  policyAction: "open_quiz_page" | "read_questions",
  reason: string,
  policy: QuizSafetyPolicy,
  now: () => Date,
  entries: StudyBuilderQuizEvidenceAuditEntry[],
  audit: ((entry: StudyBuilderQuizEvidenceAuditEntry) => void) | undefined,
): Extract<StudyBuilderQuizEvidenceDecision, { status: "blocked" }> {
  const decision = {
    status: "blocked" as const,
    action,
    policyAction,
    reason,
    neededPermission: "valid_completed_attempt_review",
  };
  const entry = Object.freeze({
    version: 1 as const,
    lane: "study-builder-quiz-evidence" as const,
    sequence: entries.length + 1,
    occurredAt: now().toISOString(),
    accessMode: policy.accessMode,
    action: decision.action,
    policyAction: decision.policyAction,
    decision: decision.status,
    reason: decision.reason,
  });
  entries.push(entry);
  audit?.(entry);
  return decision;
}
