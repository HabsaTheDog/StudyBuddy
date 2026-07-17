import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileExtractionResult } from "./fileTextExtraction.js";

const queues = new Map<string, Promise<void>>();
type ExtractionReportEntry = Omit<FileExtractionResult, "text">;

export function recordExtractionResult(runDir: string, result: FileExtractionResult): Promise<void> {
  const filePath = path.join(runDir, "extraction-report.json");
  const previous = queues.get(filePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    const existing = await readFile(filePath, "utf8")
      .then((text) => JSON.parse(text) as { schemaVersion: 1; generatedAt: string; resources: Array<ExtractionReportEntry & { text?: string }> })
      .catch(() => ({ schemaVersion: 1 as const, generatedAt: new Date().toISOString(), resources: [] }));
    const resources: ExtractionReportEntry[] = existing.resources
      .filter((entry) => entry.filePath !== result.filePath)
      .map(({ text: _text, ...entry }) => entry);
    const { text: _text, ...reportEntry } = result;
    resources.push(reportEntry);
    const report = {
      schemaVersion: 1 as const,
      generatedAt: new Date().toISOString(),
      resources,
    };
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  });
  queues.set(filePath, next.catch(() => undefined));
  return next;
}
