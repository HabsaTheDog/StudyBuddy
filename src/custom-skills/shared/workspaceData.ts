import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const STUDY_BUDDY_DATA_DIRECTORY = "study-buddy-data";
export const STUDY_BUDDY_DELIVERABLES_DIRECTORY = "study-buddy-deliverables";

export type StudyBuddyWorkspaceKind = "project" | "quick-chat";

export interface StudyBuddyWorkspaceDataPaths {
  workspaceRoot: string;
  workspaceKind: StudyBuddyWorkspaceKind;
  threadId?: string;
  dataRoot: string;
  threadRoot: string;
  runsRoot: string;
  cacheRoot: string;
  locksRoot: string;
}

const STANDARD_README = `# Study Buddy Data

This folder is managed by Study Buddy. It contains internal run data such as
Moodle and CIS source captures, agent handoffs, validation reports, logs,
caches, and recovery state.

Finished files created for you, such as PDFs, HTML pages, CSV files, or other
requested deliverables, are saved outside this folder in the surrounding
project or Quick Chat workspace's \`${STUDY_BUDDY_DELIVERABLES_DIRECTORY}/\`
directory.

## Structure

- In a project, \`threads/\` separates the internal history of each chat thread.
- In a Quick Chat, \`runs/\` contains the history for that Quick Chat directly.
- \`cache/\` and \`locks/\` are managed automatically by Study Buddy.

You normally do not need to edit anything here. Deleting this folder does not
delete finished files stored elsewhere, but it removes Study Buddy's local run
history, debugging information, and ability to resume earlier workflows.
`;

export function resolveStudyBuddyWorkspaceRoot(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return path.resolve(environment.STUDY_BUDDY_WORKSPACE || environment.T3CODE_CWD || cwd);
}

export function resolveStudyBuddyWorkspacePath(value: string, workspaceRoot: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

export function resolveStudyBuddyWorkspaceDataPaths(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): StudyBuddyWorkspaceDataPaths {
  const workspaceRoot = resolveStudyBuddyWorkspaceRoot(environment, cwd);
  const threadId = trimmed(environment.STUDY_BUDDY_THREAD_ID);
  const workspaceKind = resolveWorkspaceKind(environment, workspaceRoot, threadId);
  const dataRoot = path.join(workspaceRoot, STUDY_BUDDY_DATA_DIRECTORY);
  const threadRoot = workspaceKind === "project" && threadId
    ? path.join(dataRoot, "threads", safePathSegment(threadId))
    : dataRoot;

  return {
    workspaceRoot,
    workspaceKind,
    threadId,
    dataRoot,
    threadRoot,
    runsRoot: path.join(threadRoot, "runs"),
    cacheRoot: path.join(dataRoot, "cache"),
    locksRoot: path.join(threadRoot, "locks"),
  };
}

export function ensureStudyBuddyWorkspaceData(
  paths: StudyBuddyWorkspaceDataPaths,
): StudyBuddyWorkspaceDataPaths {
  for (const directory of [
    paths.dataRoot,
    paths.threadRoot,
    paths.runsRoot,
    paths.cacheRoot,
    paths.locksRoot,
  ]) {
    ensurePrivateDirectorySync(directory);
  }
  writeIfMissing(path.join(paths.dataRoot, "README.md"), STANDARD_README);
  writeIfMissing(path.join(paths.dataRoot, ".gitignore"), "*\n");
  writeJsonIfMissing(path.join(paths.dataRoot, "workspace.json"), {
    schemaVersion: 1,
    kind: "study-buddy-data",
    workspaceRoot: paths.workspaceRoot,
    createdAt: new Date().toISOString(),
  });
  if (paths.threadId) {
    writeJsonIfMissing(path.join(paths.threadRoot, "thread.json"), {
      schemaVersion: 1,
      threadId: paths.threadId,
      workspaceKind: paths.workspaceKind,
      createdAt: new Date().toISOString(),
    });
  }
  return paths;
}

export function ensurePrivateDirectorySync(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(directory, 0o700);
}

export function safePathSegment(value: string): string {
  const segment = value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return !segment || segment === "." || segment === ".." ? "default" : segment;
}

function resolveWorkspaceKind(
  environment: NodeJS.ProcessEnv,
  workspaceRoot: string,
  threadId: string | undefined,
): StudyBuddyWorkspaceKind {
  const explicit = trimmed(environment.STUDY_BUDDY_WORKSPACE_KIND)?.toLowerCase();
  if (explicit === "quick-chat") return "quick-chat";
  if (explicit === "project" || explicit === "regular") return "project";

  const looksLikeQuickChat = Boolean(
    threadId &&
    path.basename(path.dirname(workspaceRoot)) === "quick-chats" &&
    path.basename(workspaceRoot) === threadId,
  );
  return looksLikeQuickChat ? "quick-chat" : "project";
}

function writeIfMissing(filePath: string, contents: string): void {
  try {
    writeFileSync(filePath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (process.platform !== "win32") chmodSync(filePath, 0o600);
}

function writeJsonIfMissing(filePath: string, value: unknown): void {
  writeIfMissing(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}
