import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireRunLease } from "../../shared/runLease.js";

describe("run lease", () => {
  it("rejects a second active process and releases idempotently", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-lease-"));
    const release = await acquireRunLease(directory);

    await expect(acquireRunLease(directory)).rejects.toThrow(/already active/);
    await release();
    await release();

    const releaseAgain = await acquireRunLease(directory);
    await releaseAgain();
  });

  it("allows nested acquisition in the same process and holds the file until the last release", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-lease-nested-"));
    const lockPath = path.join(directory, ".study-buddy-active-run.json");
    const releaseOuter = await acquireRunLease(directory);
    const releaseInner = await acquireRunLease(directory, { reentrant: true });

    await releaseOuter();
    expect(JSON.parse(await readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await releaseInner();
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims a stale lease", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-lease-stale-"));
    const lockPath = path.join(directory, ".study-buddy-active-run.json");
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 2_147_483_647, startedAt: "2026-01-01T00:00:00.000Z", command: "stale" }),
      "utf8",
    );

    const release = await acquireRunLease(directory);
    expect(JSON.parse(await readFile(lockPath, "utf8")).pid).toBe(process.pid);
    await release();
  });

  it("is a no-op when no shared target exists", async () => {
    const release = await acquireRunLease(undefined);
    await expect(release()).resolves.toBeUndefined();
  });
});
