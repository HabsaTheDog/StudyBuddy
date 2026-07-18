import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveStudyBuddyWorkspaceDataPaths,
  resolveStudyBuddyWorkspacePath,
  safePathSegment,
} from "./workspaceData.js";

export interface PublishedDeliverable {
  sourcePath: string;
  publishedPath: string;
  bytes: number;
  sha256: string;
}

export async function publishStudyBuddyDeliverables(input: {
  prompt: string;
  runDir: string;
  sourcePaths: Array<string | undefined>;
  deliverTo?: string;
}): Promise<PublishedDeliverable[]> {
  const workspace = resolveStudyBuddyWorkspaceDataPaths();
  const sources = [...new Set(input.sourcePaths.filter((value): value is string => Boolean(value)))]
    .map((value) => path.resolve(value));
  if (sources.length === 0) return [];

  for (const sourcePath of sources) {
    ensureInside(workspace.dataRoot, sourcePath, "Canonical deliverable");
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size === 0) {
      throw new Error(`Cannot publish an empty or non-file deliverable: ${sourcePath}`);
    }
  }

  const requestedDestination = input.deliverTo
    ? resolveStudyBuddyWorkspacePath(input.deliverTo, workspace.workspaceRoot)
    : undefined;
  if (requestedDestination) {
    ensureOutside(workspace.dataRoot, requestedDestination, "Published deliverable");
    if (sources.length > 1 && path.extname(requestedDestination)) {
      throw new Error("--deliver-to must be a directory when publishing multiple files.");
    }
  }

  const baseName = inferDeliverableBaseName(input.prompt);
  const published: PublishedDeliverable[] = [];
  for (const sourcePath of sources) {
    const extension = path.extname(sourcePath).toLowerCase();
    const desiredPath = requestedDestination
      ? sources.length === 1 && path.extname(requestedDestination)
        ? requestedDestination
        : path.join(requestedDestination, `${baseName}${extension}`)
      : path.join(workspace.workspaceRoot, `${baseName}${extension}`);
    const sourceHash = await sha256(sourcePath);
    const targetPath = await collisionSafePath(desiredPath, sourceHash);
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (!await sameFileHash(targetPath, sourceHash)) {
      const temporaryPath = `${targetPath}.study-buddy-${randomUUID()}.tmp`;
      await copyFile(sourcePath, temporaryPath);
      if (await sha256(temporaryPath) !== sourceHash) {
        throw new Error(`Published deliverable verification failed: ${targetPath}`);
      }
      await rename(temporaryPath, targetPath);
    }
    const targetStat = await stat(targetPath);
    published.push({
      sourcePath,
      publishedPath: targetPath,
      bytes: targetStat.size,
      sha256: sourceHash,
    });
  }

  await writeFile(
    path.join(input.runDir, "deliverables.json"),
    `${JSON.stringify({ schemaVersion: 1, deliverables: published }, null, 2)}\n`,
    "utf8",
  );
  return published;
}

export function inferDeliverableBaseName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .match(/[a-z0-9äöüß_-]{3,}/gi);
  return safePathSegment((words ?? ["study-buddy-result"]).slice(0, 6).join("-"));
}

async function collisionSafePath(desiredPath: string, sourceHash: string): Promise<string> {
  if (!await exists(desiredPath) || await sameFileHash(desiredPath, sourceHash)) return desiredPath;
  const extension = path.extname(desiredPath);
  const stem = desiredPath.slice(0, desiredPath.length - extension.length);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!await exists(candidate) || await sameFileHash(candidate, sourceHash)) return candidate;
  }
  throw new Error(`Could not choose a collision-free deliverable path for: ${desiredPath}`);
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function sameFileHash(filePath: string, expectedHash: string): Promise<boolean> {
  return await exists(filePath) && await sha256(filePath) === expectedHash;
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true, () => false);
}

function ensureInside(parent: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside study-buddy-data: ${candidate}`);
  }
}

function ensureOutside(parent: string, candidate: string, label: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error(`${label} must be outside study-buddy-data: ${candidate}`);
  }
}
