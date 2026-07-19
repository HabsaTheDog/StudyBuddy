import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishStudyBuddyDeliverables } from "../../shared/deliverables.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("Study Buddy deliverable publishing", () => {
  it("keeps the canonical file internal and publishes a verified clean copy", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-publish-"));
    temporaryDirectories.push(workspace);
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", workspace);
    const runDir = path.join(workspace, "study-buddy-data", "runs", "notes", "run-1");
    const canonical = path.join(runDir, "document.pdf");
    await mkdir(runDir, { recursive: true });
    await writeFile(canonical, "validated-pdf", "utf8");

    const published = await publishStudyBuddyDeliverables({
      prompt: "Create DYN2 notes",
      runDir,
      sourcePaths: [canonical],
    });

    expect(published[0].publishedPath).toBe(
      path.join(workspace, "study-buddy-deliverables", "create-dyn2-notes.pdf"),
    );
    await expect(readFile(published[0].publishedPath, "utf8")).resolves.toBe("validated-pdf");
    await expect(readFile(canonical, "utf8")).resolves.toBe("validated-pdf");
    await expect(readFile(path.join(runDir, "deliverables.json"), "utf8"))
      .resolves.toContain("create-dyn2-notes.pdf");
  });

  it("does not silently overwrite a different deliverable from another thread", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-collision-"));
    temporaryDirectories.push(workspace);
    vi.stubEnv("STUDY_BUDDY_WORKSPACE", workspace);
    const firstRun = path.join(workspace, "study-buddy-data", "threads", "one", "runs", "run");
    const secondRun = path.join(workspace, "study-buddy-data", "threads", "two", "runs", "run");
    await Promise.all([mkdir(firstRun, { recursive: true }), mkdir(secondRun, { recursive: true })]);
    const first = path.join(firstRun, "document.pdf");
    const second = path.join(secondRun, "document.pdf");
    await writeFile(first, "first", "utf8");
    await writeFile(second, "second", "utf8");

    const firstPublished = await publishStudyBuddyDeliverables({
      prompt: "Create notes",
      runDir: firstRun,
      sourcePaths: [first],
    });
    const secondPublished = await publishStudyBuddyDeliverables({
      prompt: "Create notes",
      runDir: secondRun,
      sourcePaths: [second],
    });

    expect(firstPublished[0].publishedPath).toBe(
      path.join(workspace, "study-buddy-deliverables", "create-notes.pdf"),
    );
    expect(secondPublished[0].publishedPath).toBe(
      path.join(workspace, "study-buddy-deliverables", "create-notes-2.pdf"),
    );
  });
});
