// @effect-diagnostics nodeBuiltinImport:off
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ApprovedAssignmentPermission,
  AssignmentFileGrant,
  MoodleRuntimeConfig,
} from "./types.js";

export const ASSIGNMENT_PERMISSION_REQUEST_FILE = "assignment-permission-request.json";
const DEFAULT_PERMISSION_TTL_MS = 30 * 60_000;

export interface PendingAssignmentPermissionRequest {
  version: 1;
  requestId: string;
  owner: "study-buddy";
  action: "submit_assignment";
  scope: "exact_assignment_submission";
  status: "pending";
  targetUrl: string;
  assignmentTitle: string;
  requestedAt: string;
  expiresAt: string;
  files: AssignmentFileGrant[];
  capabilities: readonly ["upload_files", "save_draft", "final_assignment_submit"];
  finalQuizSubmission: "denied";
  declarationAcceptance: "manual-only";
}

export async function buildPendingAssignmentPermissionRequest(input: {
  targetUrl: string;
  assignmentTitle?: string | undefined;
  files: string[];
  now?: Date | undefined;
}): Promise<PendingAssignmentPermissionRequest> {
  const now = input.now ?? new Date();
  return {
    version: 1,
    requestId: randomUUID(),
    owner: "study-buddy",
    action: "submit_assignment",
    scope: "exact_assignment_submission",
    status: "pending",
    targetUrl: input.targetUrl,
    assignmentTitle: input.assignmentTitle?.trim() || "Moodle assignment",
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEFAULT_PERMISSION_TTL_MS).toISOString(),
    files: await fingerprintAssignmentFiles(input.files),
    capabilities: ["upload_files", "save_draft", "final_assignment_submit"],
    finalQuizSubmission: "denied",
    declarationAcceptance: "manual-only",
  };
}

export async function persistPendingAssignmentPermission(
  config: MoodleRuntimeConfig,
  request: PendingAssignmentPermissionRequest,
): Promise<string> {
  const filePath = path.join(config.runDir, ASSIGNMENT_PERMISSION_REQUEST_FILE);
  await writeFile(filePath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return filePath;
}

export async function loadApprovedAssignmentPermission(
  requestPath: string,
  now = new Date(),
): Promise<ApprovedAssignmentPermission> {
  const resolvedPath = path.resolve(requestPath);
  const parsed = JSON.parse(
    await readFile(resolvedPath, "utf8"),
  ) as Partial<PendingAssignmentPermissionRequest>;
  if (
    parsed.version !== 1 ||
    parsed.owner !== "study-buddy" ||
    parsed.action !== "submit_assignment" ||
    parsed.scope !== "exact_assignment_submission" ||
    parsed.status !== "pending" ||
    typeof parsed.requestId !== "string" ||
    typeof parsed.targetUrl !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("Invalid Study Buddy assignment permission request.");
  }
  const expiresAt = new Date(parsed.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error("The Study Buddy assignment permission request expired. Inspect it again.");
  }
  const files = validateFileGrants(parsed.files);
  await assertAssignmentFilesUnchanged(files);
  await claimPermissionOnce(resolvedPath);
  return {
    requestId: parsed.requestId,
    targetUrl: parsed.targetUrl,
    action: "submit_assignment",
    scope: "exact_assignment_submission",
    approvedAt: now.toISOString(),
    expiresAt: parsed.expiresAt,
    files,
  };
}

export function assertApprovedAssignmentTarget(
  permission: ApprovedAssignmentPermission,
  targetUrl: string,
): void {
  if (normalizeAssignmentTarget(permission.targetUrl) !== normalizeAssignmentTarget(targetUrl)) {
    throw new Error("The approved permission does not match the requested Moodle assignment.");
  }
}

export async function fingerprintAssignmentFiles(files: string[]): Promise<AssignmentFileGrant[]> {
  return await Promise.all(
    [...new Set(files.map((file) => path.resolve(file)))].map(async (filePath) => {
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error(`Assignment upload is not a file: ${filePath}`);
      const bytes = await readFile(filePath);
      return {
        path: filePath,
        size: details.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
}

export async function assertAssignmentFilesUnchanged(files: AssignmentFileGrant[]): Promise<void> {
  const current = await fingerprintAssignmentFiles(files.map((file) => file.path));
  for (const expected of files) {
    const actual = current.find((file) => file.path === expected.path);
    if (!actual || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`Assignment file changed after approval was requested: ${expected.path}`);
    }
  }
}

async function claimPermissionOnce(requestPath: string): Promise<void> {
  const claimPath = `${requestPath}.consumed`;
  let claim;
  try {
    claim = await open(claimPath, "wx");
    await claim.writeFile(`${new Date().toISOString()}\n`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("This assignment permission has already been used.", { cause: error });
    }
    throw error;
  } finally {
    await claim?.close();
  }
}

function validateFileGrants(value: unknown[]): AssignmentFileGrant[] {
  return value.map((entry) => {
    const grant = entry as Partial<AssignmentFileGrant>;
    if (
      typeof grant.path !== "string" ||
      typeof grant.size !== "number" ||
      typeof grant.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(grant.sha256)
    ) {
      throw new Error("Invalid assignment file grant in permission request.");
    }
    return { path: path.resolve(grant.path), size: grant.size, sha256: grant.sha256 };
  });
}

function normalizeAssignmentTarget(value: string): string {
  const url = new URL(value);
  url.hash = "";
  const assignmentId = url.searchParams.get("id");
  url.search = "";
  if (assignmentId) url.searchParams.set("id", assignmentId);
  return url.toString();
}
