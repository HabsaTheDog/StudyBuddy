import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { assertReadableDownloadedFile } from "./fileTextExtraction.js";

export const VISUAL_RETRIEVAL_PLAN_FILE = "visual-retrieval-plan.json";
export const VISUAL_PAGE_INDEX_FILE = "visual-page-index.json";

export const VisualRetrievalRequestSchema = z.object({
  resourceId: z.string().min(1),
  pages: z.array(z.number().int().positive()).default([]),
  purpose: z.enum(["cover", "chapter_overview", "worked_example", "table", "formula_reference", "diagram", "context"]),
  priority: z.enum(["high", "medium", "low"]),
  placementHint: z.string().min(1),
  reason: z.string().min(1),
});

export const VisualRetrievalPlanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  strategy: z.string().min(1),
  requests: z.array(VisualRetrievalRequestSchema).default([]),
});

export type VisualRetrievalPlan = z.infer<typeof VisualRetrievalPlanSchema>;

export interface VisualPageIndexEntry {
  resourceId: string;
  title: string;
  sourcePath: string;
  sourceUrl: string | null;
  sectionPath: string[];
  pageCount: number;
  pages: Array<{
    page: number;
    hint: string;
    signals: string[];
  }>;
}

export interface VisualPageIndex {
  schemaVersion: "1.0";
  generatedAt: string;
  entries: VisualPageIndexEntry[];
  warnings: string[];
}

export const visualRetrievalPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["1.0"] },
    strategy: { type: "string" },
    requests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          resourceId: { type: "string" },
          pages: { type: "array", items: { type: "number" } },
          purpose: {
            type: "string",
            enum: ["cover", "chapter_overview", "worked_example", "table", "formula_reference", "diagram", "context"],
          },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          placementHint: { type: "string" },
          reason: { type: "string" },
        },
        required: ["resourceId", "pages", "purpose", "priority", "placementHint", "reason"],
      },
    },
  },
  required: ["schemaVersion", "strategy", "requests"],
} as const;

export async function buildVisualPageIndex(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
): Promise<VisualPageIndex> {
  const warnings: string[] = [];
  const entries: VisualPageIndexEntry[] = [];
  const resources = state.resource_manifest.resources
    .filter((resource) => resource.localPath)
    .filter((resource) => path.extname(resource.localPath!).toLowerCase() === ".pdf");

  for (const resource of resources) {
    const pdfPath = resource.localPath!;
    const validPdf = await assertReadableDownloadedFile(pdfPath).then(
      () => true,
      (error) => {
        warnings.push(`Skipped visual indexing for ${pdfPath}: ${errorMessage(error)}`);
        return false;
      },
    );
    if (!validPdf) {
      continue;
    }
    const pages = await readPdfPages(pdfPath).catch((error) => {
      warnings.push(`Could not read PDF page text for ${pdfPath}: ${errorMessage(error)}`);
      return [];
    });
    const fallbackPageCount = pages.length || await pdfPageCount(pdfPath).catch(() => 1);
    entries.push({
      resourceId: resource.id,
      title: resource.title,
      sourcePath: pdfPath,
      sourceUrl: resource.originUrl,
      sectionPath: resource.sectionPath,
      pageCount: fallbackPageCount,
      pages: pages.length > 0
        ? pages.map((text, index) => pageIndexEntry(index + 1, text))
        : Array.from({ length: fallbackPageCount }, (_, index) => ({
            page: index + 1,
            hint: "Kein extrahierbarer Seitentext verfügbar.",
            signals: [],
          })),
    });
  }

  const index: VisualPageIndex = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    entries,
    warnings,
  };
  await writeFile(
    path.join(config.runDir, VISUAL_PAGE_INDEX_FILE),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
  return index;
}

export async function writeVisualRetrievalPlan(
  runDir: string,
  plan: VisualRetrievalPlan,
): Promise<void> {
  await writeFile(
    path.join(runDir, VISUAL_RETRIEVAL_PLAN_FILE),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );
}

export async function readVisualRetrievalPlan(runDir: string): Promise<VisualRetrievalPlan | null> {
  const planPath = path.join(runDir, VISUAL_RETRIEVAL_PLAN_FILE);
  const text = await readFile(planPath, "utf8").catch(() => null);
  return text ? VisualRetrievalPlanSchema.parse(JSON.parse(text)) : null;
}

export function compactVisualPageIndexForPrompt(index: VisualPageIndex, maxCharacters = 95_000): unknown {
  const compactEntries = index.entries.map((entry) => ({
    resourceId: entry.resourceId,
    title: entry.title,
    sectionPath: entry.sectionPath,
    pageCount: entry.pageCount,
    pages: entry.pages.map((page) => ({
      page: page.page,
      signals: page.signals,
      hint: page.hint.slice(0, 260),
    })),
  }));
  let serialized = JSON.stringify({ ...index, entries: compactEntries }, null, 2);
  if (serialized.length <= maxCharacters) {
    return JSON.parse(serialized);
  }
  const reducedEntries = compactEntries.map((entry) => ({
    ...entry,
    pages: entry.pages.map((page) => ({
      page: page.page,
      signals: page.signals,
      hint: page.hint.slice(0, 120),
    })),
  }));
  serialized = JSON.stringify({ ...index, entries: reducedEntries }, null, 2);
  if (serialized.length <= maxCharacters) {
    return JSON.parse(serialized);
  }
  const budgetPerEntry = Math.max(12, Math.floor(260 / Math.max(1, reducedEntries.length)));
  return {
    ...index,
    entries: reducedEntries.map((entry) => ({
      ...entry,
      pages: preservePageCoverage(entry.pages, budgetPerEntry),
    })),
    warnings: [
      ...index.warnings,
      "Visual page index was compacted for planner context; full index is persisted on disk.",
    ],
  };
}

export function plannedPagesByResource(plan: VisualRetrievalPlan | null): Map<string, number[]> {
  const pagesByResource = new Map<string, Set<number>>();
  for (const request of plan?.requests ?? []) {
    const target = pagesByResource.get(request.resourceId) ?? new Set<number>();
    for (const page of request.pages) {
      target.add(page);
    }
    pagesByResource.set(request.resourceId, target);
  }
  return new Map([...pagesByResource.entries()].map(([resourceId, pages]) => [
    resourceId,
    [...pages].sort((left, right) => left - right),
  ]));
}

function preservePageCoverage<T extends { page: number; signals: string[] }>(pages: T[], limit: number): T[] {
  const selected = new Map<number, T>();
  const add = (page: T | undefined) => {
    if (page && selected.size < limit) selected.set(page.page, page);
  };
  add(pages[0]);
  add(pages.at(-1));
  for (const page of pages.filter((page) => page.signals.length > 0)) add(page);
  for (const page of pages.slice(Math.floor(pages.length * 0.66))) add(page);
  for (const page of pages) add(page);
  return [...selected.values()].sort((left, right) => left.page - right.page);
}

function pageIndexEntry(page: number, text: string): VisualPageIndexEntry["pages"][number] {
  const normalized = text.replace(/\s+/g, " ").trim();
  return {
    page,
    hint: normalized.slice(0, 520) || "PDF-Seite ohne extrahierbaren Text.",
    signals: visualSignals(normalized),
  };
}

function visualSignals(text: string): string[] {
  const lower = text.toLocaleLowerCase("de");
  const signals: string[] = [];
  if (/\b(?:beispiel|aufgabe|übung|uebung|exercise|example)\w*/.test(lower)) signals.push("worked_example");
  if (/\b(?:lösung|loesung|musterlösung|musterloesung|solution|answer)\w*/.test(lower)) signals.push("solution");
  if (/\b(?:tabelle|table|tab\.)\w*/.test(lower) || /(?:toleranzgrad|grundtoleranz|maßtoleranz:\s*größe|TB\s*\d+\s*[-–]\s*\d+)/i.test(text)) signals.push("table");
  if (/\b(?:abbildung|diagramm|schema|zeichnung|skizze|plot|kennlinie)\w*/.test(lower) || /(?:grundabmaß|maßtoleranz:\s*lage)/i.test(text)) signals.push("diagram_or_figure");
  if (/(?:=|≤|≥|√|∑|π|N\/mm|mm²|MPa|mPa)/.test(text)) signals.push("formula_or_math");
  if (/\b(?:logo|firma|unternehmen|company|hersteller)\w*/.test(lower)) signals.push("context_logo");
  return signals;
}

async function readPdfPages(pdfPath: string): Promise<string[]> {
  const result = await runCommand("pdftotext", ["-layout", pdfPath, "-"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdftotext exited with code ${result.code}`);
  }
  const pages = result.stdout.split("\f");
  if (pages.at(-1)?.trim() === "") pages.pop();
  return pages;
}

async function pdfPageCount(pdfPath: string): Promise<number> {
  const result = await runCommand("pdfinfo", [pdfPath]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdfinfo exited with code ${result.code}`);
  }
  const pages = /^Pages:\s*(\d+)/im.exec(result.stdout)?.[1];
  return pages ? Number(pages) : 1;
}

function runCommand(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
