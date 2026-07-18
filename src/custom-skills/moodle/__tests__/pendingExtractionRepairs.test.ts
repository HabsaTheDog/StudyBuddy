import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingExtractionRepairs,
  markExtractionRepairComplete,
  pendingExtractionRepairError,
  persistPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("pending extraction repairs", () => {
  it("persists exact chapter repairs and narrows recovery to unfinished chapters", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-pending-repairs-"));
    await persistPendingExtractionRepairs(
      runDir,
      "Semantic quality review failed:\n" +
      "- [chapter: Matrices] Repair the determinant.\n" +
      "- [chapter: Gradients] Repair the Hessian.",
      2,
    );

    await markExtractionRepairComplete(runDir, "Matrices");
    const pending = await readPendingExtractionRepairs(runDir);
    expect(pending).toMatchObject({
      pendingChapterTitles: ["Gradients"],
      completedChapterTitles: ["Matrices"],
      retryCount: 2,
    });
    expect(pendingExtractionRepairError(pending!)).toContain("[chapter: Gradients]");
    expect(pendingExtractionRepairError(pending!)).not.toContain("[chapter: Matrices]");
  });

  it("clears completed review state", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-clear-repairs-"));
    await persistPendingExtractionRepairs(
      runDir,
      "Semantic quality review failed:\n- [chapter: Dynamics] Repair units.",
      1,
    );
    await clearPendingExtractionRepairs(runDir);
    await expect(readPendingExtractionRepairs(runDir)).resolves.toBeNull();
  });
});
