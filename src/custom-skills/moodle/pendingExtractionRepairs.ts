import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const PENDING_EXTRACTION_REPAIRS_FILE = "pending-extraction-repairs.json";

export interface PendingExtractionRepairs {
  schemaVersion: 1;
  reviewError: string;
  pendingChapterTitles: string[];
  completedChapterTitles: string[];
  retryCount: number;
  updatedAt: string;
}

export async function persistPendingExtractionRepairs(
  runDir: string,
  reviewError: string,
  retryCount: number,
): Promise<PendingExtractionRepairs | null> {
  const pendingChapterTitles = extractChapterTitles(reviewError);
  if (pendingChapterTitles.length === 0) {
    await clearPendingExtractionRepairs(runDir);
    return null;
  }
  const existing = await readPendingExtractionRepairs(runDir);
  const record: PendingExtractionRepairs = {
    schemaVersion: 1,
    reviewError,
    pendingChapterTitles,
    completedChapterTitles: (existing?.completedChapterTitles ?? [])
      .filter((title) => !pendingChapterTitles.includes(title)),
    retryCount: Math.max(0, Math.floor(retryCount)),
    updatedAt: new Date().toISOString(),
  };
  await writeRecord(runDir, record);
  return record;
}

export async function readPendingExtractionRepairs(
  runDir: string,
): Promise<PendingExtractionRepairs | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(runDir, PENDING_EXTRACTION_REPAIRS_FILE), "utf8"),
    ) as Partial<PendingExtractionRepairs>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.reviewError !== "string" ||
      !Array.isArray(parsed.pendingChapterTitles) ||
      !parsed.pendingChapterTitles.every((title) => typeof title === "string") ||
      !Array.isArray(parsed.completedChapterTitles) ||
      !parsed.completedChapterTitles.every((title) => typeof title === "string") ||
      typeof parsed.retryCount !== "number" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return parsed as PendingExtractionRepairs;
  } catch {
    return null;
  }
}

export async function markExtractionRepairComplete(
  runDir: string,
  chapterTitle: string,
): Promise<void> {
  const existing = await readPendingExtractionRepairs(runDir);
  if (!existing || !existing.pendingChapterTitles.includes(chapterTitle)) return;
  const pendingChapterTitles = existing.pendingChapterTitles.filter(
    (title) => title !== chapterTitle,
  );
  const completedChapterTitles = [...new Set([
    ...existing.completedChapterTitles,
    chapterTitle,
  ])];
  await writeRecord(runDir, {
    ...existing,
    pendingChapterTitles,
    completedChapterTitles,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearPendingExtractionRepairs(runDir: string): Promise<void> {
  await unlink(path.join(runDir, PENDING_EXTRACTION_REPAIRS_FILE)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}

export function pendingExtractionRepairError(record: PendingExtractionRepairs): string {
  const pending = new Set(record.pendingChapterTitles);
  const findings = record.reviewError
    .split("\n")
    .filter((line) => {
      const title = /\[chapter:\s*([^\]]+)\]/i.exec(line)?.[1]?.trim();
      return title ? pending.has(title) : false;
    });
  return findings.length > 0
    ? `Semantic quality review failed:\n${findings.join("\n")}`
    : record.reviewError;
}

function extractChapterTitles(reviewError: string): string[] {
  return [...new Set([...reviewError.matchAll(/\[chapter:\s*([^\]]+)\]/gi)]
    .map((match) => match[1]?.trim())
    .filter((title): title is string => Boolean(title)))];
}

async function writeRecord(runDir: string, record: PendingExtractionRepairs): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const targetPath = path.join(runDir, PENDING_EXTRACTION_REPAIRS_FILE);
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporaryPath, targetPath);
}
