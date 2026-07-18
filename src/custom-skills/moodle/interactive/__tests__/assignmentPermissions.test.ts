import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertApprovedAssignmentTarget,
  assertAssignmentFilesUnchanged,
  buildPendingAssignmentPermissionRequest,
  loadApprovedAssignmentPermission,
  persistPendingAssignmentPermission,
} from "../assignmentPermissions.js";
import type { MoodleRuntimeConfig } from "../types.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("assignment permission grants", () => {
  it("binds approval to one assignment and the exact uploaded bytes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "assignment-permission-"));
    const filePath = path.join(tempDir, "solution.pdf");
    await writeFile(filePath, "version one", "utf8");
    const targetUrl = "https://moodle.example/mod/assign/view.php?id=42";
    const request = await buildPendingAssignmentPermissionRequest({
      targetUrl,
      assignmentTitle: "Lab 1",
      files: [filePath],
      now: new Date("2026-07-17T12:00:00.000Z"),
    });
    expect(request.declarationAcceptance).toBe("manual-only");
    expect(request.finalQuizSubmission).toBe("denied");
    const requestPath = await persistPendingAssignmentPermission(
      { runDir: tempDir } as MoodleRuntimeConfig,
      request,
    );
    const grant = await loadApprovedAssignmentPermission(
      requestPath,
      new Date("2026-07-17T12:01:00.000Z"),
    );
    expect(() => assertApprovedAssignmentTarget(grant, targetUrl)).not.toThrow();
    expect(() =>
      assertApprovedAssignmentTarget(grant, "https://moodle.example/mod/assign/view.php?id=99"),
    ).toThrow(/does not match/);
    await expect(
      loadApprovedAssignmentPermission(requestPath, new Date("2026-07-17T12:02:00.000Z")),
    ).rejects.toThrow(/already been used/);
    await writeFile(filePath, "changed after grant load", "utf8");
    await expect(assertAssignmentFilesUnchanged(grant.files)).rejects.toThrow(
      /changed after approval/,
    );
  });

  it("invalidates approval when an upload changes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "assignment-permission-"));
    const filePath = path.join(tempDir, "solution.pdf");
    await writeFile(filePath, "approved bytes", "utf8");
    const request = await buildPendingAssignmentPermissionRequest({
      targetUrl: "https://moodle.example/mod/assign/view.php?id=42",
      files: [filePath],
    });
    const requestPath = await persistPendingAssignmentPermission(
      { runDir: tempDir } as MoodleRuntimeConfig,
      request,
    );
    await writeFile(filePath, "changed bytes", "utf8");
    await expect(loadApprovedAssignmentPermission(requestPath)).rejects.toThrow(
      /changed after approval/,
    );
  });
});
