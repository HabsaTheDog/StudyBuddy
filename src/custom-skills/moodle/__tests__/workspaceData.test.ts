import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureStudyBuddyWorkspaceData,
  resolveStudyBuddyWorkspaceDataPaths,
} from "../../shared/workspaceData.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("Study Buddy workspace data paths", () => {
  it("separates regular project runs by stable thread id", async () => {
    const workspace = await temporaryDirectory("study-buddy-project-");
    const paths = ensureStudyBuddyWorkspaceData(resolveStudyBuddyWorkspaceDataPaths({
      STUDY_BUDDY_WORKSPACE: workspace,
      STUDY_BUDDY_THREAD_ID: "thread-123",
    }));

    expect(paths.runsRoot).toBe(
      path.join(workspace, "study-buddy-data", "threads", "thread-123", "runs"),
    );
    expect(await readFile(path.join(paths.threadRoot, "thread.json"), "utf8"))
      .toContain('"threadId": "thread-123"');
    expect(await readFile(path.join(paths.dataRoot, "README.md"), "utf8"))
      .toContain("Finished files created for you");
  });

  it("stores Quick Chat runs directly below the data folder", async () => {
    const temporaryRoot = await temporaryDirectory("study-buddy-t3-home-");
    const quickChatsRoot = path.join(temporaryRoot, "quick-chats");
    const workspace = path.join(quickChatsRoot, "thread-quick");
    const paths = ensureStudyBuddyWorkspaceData(resolveStudyBuddyWorkspaceDataPaths({
      STUDY_BUDDY_WORKSPACE: workspace,
      STUDY_BUDDY_THREAD_ID: "thread-quick",
    }));

    expect(paths.runsRoot).toBe(path.join(workspace, "study-buddy-data", "runs"));
    expect(paths.threadRoot).toBe(paths.dataRoot);
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
