import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertApprovedQuizTarget,
  buildPendingQuizPermissionRequest,
  claimApprovedQuizPermission,
  loadApprovedQuizPermission,
  persistPendingQuizPermission,
} from "../quizPermissions.js";
import type { MoodleRuntimeConfig } from "../types.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("quiz permission grants", () => {
  it("creates an exact, expiring grant that never permits final quiz submission", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "quiz-permission-"));
    const request = buildPendingQuizPermissionRequest({
      targetUrl: "https://moodle.example/mod/quiz/view.php?id=7",
      quizTitle: "Minitest",
      decision: {
        status: "permission_required",
        action: "start_or_continue_attempt",
        reason: "quiz-attempt-needs-confirmation",
        neededPermission: "confirm_quiz_attempt",
      },
      now: new Date("2026-07-17T12:00:00.000Z"),
    });
    expect(request.finalQuizSubmission).toBe("denied");
    const requestPath = await persistPendingQuizPermission(
      { runDir: tempDir } as MoodleRuntimeConfig,
      request,
    );
    const grant = await loadApprovedQuizPermission(
      requestPath,
      new Date("2026-07-17T12:01:00.000Z"),
    );
    expect(() => assertApprovedQuizTarget(grant, request.targetUrl)).not.toThrow();
    expect(() =>
      assertApprovedQuizTarget(grant, "https://moodle.example/mod/quiz/view.php?id=8"),
    ).toThrow(/does not match/);
    await expect(
      loadApprovedQuizPermission(requestPath, new Date("2026-07-17T12:02:00.000Z")),
    ).resolves.toMatchObject({ requestId: request.requestId });
    await claimApprovedQuizPermission(grant, new Date("2026-07-17T12:02:00.000Z"));
    await expect(
      claimApprovedQuizPermission(grant, new Date("2026-07-17T12:03:00.000Z")),
    ).resolves.toBeUndefined();
    await expect(
      claimApprovedQuizPermission(grant, new Date("2026-07-17T12:31:00.000Z")),
    ).rejects.toThrow(/expired/);
  });

  it("rejects expired requests", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "quiz-permission-"));
    const request = buildPendingQuizPermissionRequest({
      targetUrl: "https://moodle.example/mod/quiz/view.php?id=7",
      decision: {
        status: "permission_required",
        action: "start_or_continue_attempt",
        reason: "quiz-attempt-needs-confirmation",
        neededPermission: "confirm_quiz_attempt",
      },
      now: new Date("2026-07-17T12:00:00.000Z"),
    });
    const requestPath = await persistPendingQuizPermission(
      { runDir: tempDir } as MoodleRuntimeConfig,
      request,
    );
    await expect(
      loadApprovedQuizPermission(requestPath, new Date("2026-07-17T13:00:00.000Z")),
    ).rejects.toThrow(/expired/);
  });
});
