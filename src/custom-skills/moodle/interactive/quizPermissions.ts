// @effect-diagnostics nodeBuiltinImport:off
import { randomUUID } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { QuizMetadata, QuizPolicyDecision } from "./quizSafetyPolicy.js";
import type { ApprovedQuizPermission, MoodleRuntimeConfig } from "./types.js";

export const QUIZ_PERMISSION_REQUEST_FILE = "quiz-permission-request.json";
const DEFAULT_PERMISSION_TTL_MS = 30 * 60_000;

export interface PendingQuizPermissionRequest {
  version: 1;
  requestId: string;
  owner: "study-buddy";
  action: "execute_quiz_attempt";
  scope: "exact_quiz_attempt";
  status: "pending";
  targetUrl: string;
  quizTitle: string;
  reason: string;
  neededPermission: string;
  requestedAt: string;
  expiresAt: string;
  metadata: QuizMetadata | null;
  capabilities: readonly [
    "start_or_continue_attempt",
    "read_questions",
    "suggest_answers",
    "fill_answers",
    "change_existing_answers",
    "save_or_next_page",
  ];
  finalQuizSubmission: "denied";
}

export function buildPendingQuizPermissionRequest(input: {
  targetUrl: string;
  quizTitle?: string | undefined;
  decision: QuizPolicyDecision;
  metadata?: QuizMetadata | undefined;
  now?: Date | undefined;
}): PendingQuizPermissionRequest {
  if (input.decision.status !== "permission_required") {
    throw new Error("Only permission-required quiz decisions can create approval requests.");
  }
  const now = input.now ?? new Date();
  return {
    version: 1,
    requestId: randomUUID(),
    owner: "study-buddy",
    action: "execute_quiz_attempt",
    scope: "exact_quiz_attempt",
    status: "pending",
    targetUrl: input.targetUrl,
    quizTitle: input.quizTitle?.trim() || "Moodle quiz",
    reason: input.decision.reason,
    neededPermission: input.decision.neededPermission,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEFAULT_PERMISSION_TTL_MS).toISOString(),
    metadata: input.metadata ?? null,
    capabilities: [
      "start_or_continue_attempt",
      "read_questions",
      "suggest_answers",
      "fill_answers",
      "change_existing_answers",
      "save_or_next_page",
    ],
    finalQuizSubmission: "denied",
  };
}

export async function persistPendingQuizPermission(
  config: MoodleRuntimeConfig,
  request: PendingQuizPermissionRequest,
): Promise<string> {
  const filePath = path.join(config.runDir, QUIZ_PERMISSION_REQUEST_FILE);
  await writeFile(filePath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return filePath;
}

export async function loadApprovedQuizPermission(
  requestPath: string,
  now = new Date(),
): Promise<ApprovedQuizPermission> {
  const resolvedRequestPath = path.resolve(requestPath);
  const parsed = JSON.parse(
    await readFile(resolvedRequestPath, "utf8"),
  ) as Partial<PendingQuizPermissionRequest>;
  if (
    parsed.version !== 1 ||
    parsed.owner !== "study-buddy" ||
    parsed.action !== "execute_quiz_attempt" ||
    parsed.scope !== "exact_quiz_attempt" ||
    parsed.status !== "pending" ||
    typeof parsed.requestId !== "string" ||
    typeof parsed.targetUrl !== "string" ||
    typeof parsed.expiresAt !== "string"
  ) {
    throw new Error("Invalid Study Buddy quiz permission request.");
  }
  const expiresAt = new Date(parsed.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error("The Study Buddy quiz permission request expired. Inspect the quiz again.");
  }
  return {
    requestId: parsed.requestId,
    requestPath: resolvedRequestPath,
    targetUrl: parsed.targetUrl,
    action: "execute_quiz_attempt",
    scope: "exact_quiz_attempt",
    approvedAt: now.toISOString(),
    expiresAt: parsed.expiresAt,
  };
}

export async function claimApprovedQuizPermission(
  permission: ApprovedQuizPermission,
  now = new Date(),
): Promise<void> {
  const expiresAt = new Date(permission.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error("The Study Buddy quiz permission request expired. Inspect the quiz again.");
  }
  const claimPath = `${path.resolve(permission.requestPath)}.consumed`;
  let claim;
  try {
    claim = await open(claimPath, "wx");
    await claim.writeFile(
      `${JSON.stringify({
        version: 1,
        requestId: permission.requestId,
        firstClaimedAt: now.toISOString(),
        scope: "exact_quiz_attempt",
      })}\n`,
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // A quiz approval covers the whole attempt, not one process invocation. Page limits,
      // transient browser failures, or coordinator leases may require a continuation run.
      // The cooperative local-consent request remains exact-target and expiry checked.
      // This is a UX guardrail, not a security boundary against a process with full machine access.
      return;
    }
    throw error;
  } finally {
    await claim?.close();
  }
}

export function assertApprovedQuizTarget(
  permission: ApprovedQuizPermission,
  targetUrl: string,
): void {
  if (normalizeQuizTarget(permission.targetUrl) !== normalizeQuizTarget(targetUrl)) {
    throw new Error("The approved quiz permission does not match the requested Moodle quiz.");
  }
}

function normalizeQuizTarget(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.delete("page");
  return url.toString();
}
