import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveStudyBuddyWorkspaceDataPaths } from "../shared/workspaceData.js";

export interface DirectDocumentContext {
  workspace: string;
  ownerThreadId: string;
  threadRoot: string;
  root: string;
  environment: NodeJS.ProcessEnv;
}

export async function directDocumentContext(environment: NodeJS.ProcessEnv): Promise<DirectDocumentContext> {
  const selected = environment.STUDY_BUDDY_WORKSPACE;
  const ownerThreadId = environment.STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID;
  if (!selected || !path.isAbsolute(selected) || !ownerThreadId?.trim()) {
    throw new Error("Direct documents require a broker-owned absolute workspace and stable owner thread.");
  }
  const workspace = await realpath(selected);
  const paths = resolveStudyBuddyWorkspaceDataPaths({
    ...environment, STUDY_BUDDY_WORKSPACE: workspace, STUDY_BUDDY_THREAD_ID: ownerThreadId,
  });
  return { workspace, ownerThreadId, threadRoot: paths.threadRoot,
    root: path.join(paths.threadRoot, "direct-documents"), environment };
}

export function containedPath(root: string, target: string): string {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Direct document path is outside the owning workspace.");
  }
  return resolved;
}

export async function checkPath(root: string, target: string, createDirectories = false): Promise<string> {
  const resolved = containedPath(root, target);
  const segments = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!entry && createDirectories) {
      await mkdir(current, { mode: 0o700 });
      entry = await lstat(current);
    }
    if (!entry) throw new Error("Direct document path does not exist.");
    if (entry.isSymbolicLink()) throw new Error("Direct document paths must not contain symlinks.");
  }
  if (await realpath(resolved) !== resolved) throw new Error("Direct document path changed during resolution.");
  return resolved;
}

export async function readOwnedFile(root: string, target: string): Promise<Buffer> {
  await checkPath(root, target);
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || entry.nlink !== 1) throw new Error("Direct document input must be a regular file without hardlinks.");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function writeOwnedFile(root: string, target: string, content: string | Uint8Array): Promise<void> {
  containedPath(root, target);
  await checkPath(root, path.dirname(target), true);
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) {
    throw new Error("Direct document output must be a regular file, never a symlink.");
  }
  const temporary = path.join(path.dirname(target), `.write-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content); }
  finally { await handle.close(); }
  try { await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
