import { open, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "./codexClient.js";
import { runBoundedProcess, type BoundedProcessResult } from "../shared/boundedProcess.js";

export type PdfPostRenderFindingSeverity = "error" | "warning";
export type PdfPostRenderFindingGate = "structure" | "geometry" | "readability" | "visual";

export interface PdfPostRenderFinding {
  page: number | null;
  gate: PdfPostRenderFindingGate;
  severity: PdfPostRenderFindingSeverity;
  code: string;
  message: string;
  repairTarget: "formatter";
}

export interface PdfPostRenderPageReport {
  page: number;
  widthPoints: number | null;
  heightPoints: number | null;
  wordCount: number;
  medianWordHeightPoints: number | null;
  duplicateWordBoxes: number;
  rasterPath: string | null;
  rasterWidthPixels: number | null;
  rasterHeightPixels: number | null;
  estimatedInkRatio: number | null;
}

export interface PdfPostRenderReview {
  schemaVersion: 1;
  ok: boolean;
  generatedAt: string;
  pdfFile: string;
  pageCount: number;
  modelReview: "passed" | "failed" | "unavailable" | "not_configured";
  modelReviewedPages: number[];
  findings: PdfPostRenderFinding[];
  pages: PdfPostRenderPageReport[];
}

export interface PdfPostRenderReviewInput {
  pdfPath: string;
  runDir: string;
  signal?: AbortSignal;
  codex?: CodexClient;
  processRunner?: typeof runBoundedProcess;
}

interface PdfWordBox {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface PdfTextPage {
  page: number;
  width: number;
  height: number;
  words: PdfWordBox[];
}

interface ModelVisualReview {
  ok: boolean;
  findings: Array<{
    page: number;
    severity: PdfPostRenderFindingSeverity;
    code: string;
    message: string;
    repairTarget: "formatter";
  }>;
}

const modelVisualReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "findings"],
  properties: {
    ok: { type: "boolean" },
    findings: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "severity", "code", "message", "repairTarget"],
        properties: {
          page: { type: "integer", minimum: 1 },
          severity: { type: "string", enum: ["error", "warning"] },
          code: { type: "string" },
          message: { type: "string" },
          repairTarget: { type: "string", enum: ["formatter"] },
        },
      },
    },
  },
} as const;

const MAX_MODEL_REVIEW_PAGES = 24;
const PAGES_PER_CONTACT_SHEET = 4;

/**
 * Review the exact PDF emitted by the official Typst compiler. This gate is
 * deliberately subject-agnostic: it checks file/page integrity, gross page
 * geometry and visible rendering defects, never content coverage or pedagogy.
 */
export async function reviewRenderedPdf(
  input: PdfPostRenderReviewInput,
): Promise<PdfPostRenderReview> {
  const run = input.processRunner ?? runBoundedProcess;
  const reviewDir = path.join(input.runDir, "pdf-review");
  const pageDir = path.join(reviewDir, "pages");
  const sheetDir = path.join(reviewDir, "sheets");
  // A formatter repair may compile a different page count in the same run.
  // Never mix old raster pages or contact sheets into the new review.
  await rm(reviewDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(pageDir, { recursive: true }),
    mkdir(sheetDir, { recursive: true }),
  ]);

  const findings: PdfPostRenderFinding[] = [];
  const fileCheck = await inspectPdfFile(input.pdfPath);
  if (!fileCheck.ok) findings.push(finding(null, "structure", "error", fileCheck.code, fileCheck.message));

  const infoResult = await safeProcess(run, "pdfinfo", [input.pdfPath], input.signal);
  const pageCount = infoResult.code === 0 ? parsePdfPageCount(infoResult.stdout) : 0;
  if (infoResult.code !== 0) {
    findings.push(finding(null, "structure", "error", "pdfinfo-failed", processFailure("pdfinfo", infoResult)));
  } else if (pageCount < 1) {
    findings.push(finding(null, "structure", "error", "pdf-page-count-invalid", "The compiled PDF reports no readable pages."));
  }

  const textResult = pageCount > 0
    ? await safeProcess(run, "pdftotext", ["-bbox-layout", input.pdfPath, "-"], input.signal, 16 * 1024 * 1024)
    : failedProcess("Skipped because the PDF has no readable page count.");
  const textPages = textResult.code === 0 ? parsePdfTextPages(textResult.stdout) : [];
  if (pageCount > 0 && textResult.code !== 0) {
    findings.push(finding(null, "readability", "warning", "pdf-text-inspection-unavailable", processFailure("pdftotext", textResult)));
  }

  const rasterResult = pageCount > 0
    ? await safeProcess(run, "pdftoppm", ["-r", "110", "-png", input.pdfPath, path.join(pageDir, "page")], input.signal, 4 * 1024 * 1024)
    : failedProcess("Skipped because the PDF has no readable page count.");
  let rasterPaths = rasterResult.code === 0 ? await numberedRasterPaths(pageDir) : [];
  if (pageCount > 0 && rasterResult.code !== 0) {
    findings.push(finding(null, "visual", "error", "pdf-page-render-failed", processFailure("pdftoppm", rasterResult)));
  } else if (pageCount > 0 && rasterPaths.length !== pageCount) {
    findings.push(finding(
      null,
      "visual",
      "error",
      "pdf-page-render-incomplete",
      `Rendered ${rasterPaths.length} of ${pageCount} PDF pages.`,
    ));
  }
  rasterPaths = rasterPaths.slice(0, pageCount || rasterPaths.length);

  const pages: PdfPostRenderPageReport[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = index + 1;
    const textPage = textPages.find((entry) => entry.page === page);
    const rasterPath = rasterPaths[index] ?? null;
    const raster = rasterPath
      ? await inspectRaster(run, rasterPath, input.signal)
      : null;
    const duplicateWordBoxes = textPage ? countDuplicateWordBoxes(textPage.words) : 0;
    const medianWordHeightPoints = textPage
      ? median(textPage.words.map((word) => word.yMax - word.yMin).filter((height) => height > 0))
      : null;
    const report: PdfPostRenderPageReport = {
      page,
      widthPoints: textPage?.width ?? null,
      heightPoints: textPage?.height ?? null,
      wordCount: textPage?.words.length ?? 0,
      medianWordHeightPoints,
      duplicateWordBoxes,
      rasterPath: rasterPath ? path.relative(input.runDir, rasterPath) : null,
      rasterWidthPixels: raster?.width ?? null,
      rasterHeightPixels: raster?.height ?? null,
      estimatedInkRatio: raster?.inkRatio ?? null,
    };
    pages.push(report);

    if (textPage) findings.push(...geometryFindings(textPage));
    if (medianWordHeightPoints !== null && medianWordHeightPoints < 4.5) {
      findings.push(finding(
        page,
        "readability",
        "warning",
        "very-small-typography",
        `Median visible word height is only ${medianWordHeightPoints.toFixed(2)} pt; inspect this page for unreadably small type.`,
      ));
    }
    if (duplicateWordBoxes >= 3) {
      findings.push(finding(
        page,
        "geometry",
        "warning",
        "duplicate-text-boxes",
        `${duplicateWordBoxes} duplicate word boxes may indicate overprinted or overlapping text.`,
      ));
    }
    if (raster && raster.inkRatio !== null && raster.inkRatio < 0.0002) {
      findings.push(finding(page, "visual", "error", "blank-page", "The rendered page is visually blank."));
    }
  }

  let modelReview: PdfPostRenderReview["modelReview"] = input.codex ? "passed" : "not_configured";
  let modelReviewedPages: number[] = [];
  if (!input.codex) {
    findings.push(finding(
      null,
      "visual",
      "warning",
      "visual-model-not-configured",
      "Deterministic PDF checks ran, but no image-capable reviewer was provided; no model visual approval is claimed.",
    ));
  } else if (rasterPaths.length > 0) {
    try {
      let modelBlocking = false;
      const selectedPages = selectModelReviewPages(pageCount, findings);
      const sheets = await createContactSheets(run, rasterPaths, selectedPages, sheetDir, input.signal);
      if (sheets.length === 0) {
        throw new Error("No contact sheet could be produced from the rendered PDF pages.");
      }
      for (let index = 0; index < sheets.length; index += 2) {
        const pair = sheets.slice(index, index + 2);
        const allowedPages = pair.flatMap((entry) => entry.pages);
        const response = await input.codex.run(
          buildModelReviewPrompt(allowedPages),
          {
            task: "quality_reviewer",
            attempt: 1,
            outputSchema: modelVisualReviewSchema,
            localImages: pair.map((entry) => entry.path),
          },
        );
        const parsed = parseModelVisualReview(response, new Set(allowedPages));
        modelBlocking ||= parsed.findings.some((entry) => entry.severity === "error");
        modelReviewedPages.push(...allowedPages);
        findings.push(...parsed.findings.map((entry) => finding(
          entry.page,
          "visual",
          entry.severity,
          entry.code,
          entry.message,
        )));
      }
      modelReviewedPages = [...new Set(modelReviewedPages)].sort((left, right) => left - right);
      modelReview = modelBlocking ? "failed" : "passed";
    } catch (error) {
      modelReview = "unavailable";
      findings.push(finding(
        null,
        "visual",
        "warning",
        "visual-model-review-unavailable",
        `The image reviewer did not complete; deterministic PDF checks remain valid: ${errorMessage(error)}`,
      ));
    }
  } else {
    modelReview = "unavailable";
    findings.push(finding(
      null,
      "visual",
      "warning",
      "visual-model-input-unavailable",
      "The image reviewer received no rendered PDF page and therefore did not approve the artifact visually.",
    ));
  }

  return {
    schemaVersion: 1,
    ok: !findings.some((entry) => entry.severity === "error"),
    generatedAt: new Date().toISOString(),
    pdfFile: path.basename(input.pdfPath),
    pageCount,
    modelReview,
    modelReviewedPages,
    findings: deduplicateFindings(findings),
    pages,
  };
}

export async function persistPdfPostRenderReview(
  runDir: string,
  review: PdfPostRenderReview,
): Promise<string> {
  const reviewPath = path.join(runDir, "pdf-post-render-review.json");
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  return reviewPath;
}

export function pdfPostRenderRepairMessage(review: PdfPostRenderReview): string {
  const blocking = review.findings.filter((entry) => entry.severity === "error");
  return [
    "PDF post-render review failed; repair target: formatter.",
    ...blocking.map((entry) =>
      `- ${entry.page ? `[page ${entry.page}] ` : ""}${entry.code}: ${entry.message}`
    ),
  ].join("\n");
}

async function inspectPdfFile(pdfPath: string): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string }
> {
  const details = await stat(pdfPath).catch(() => null);
  if (!details?.isFile() || details.size === 0) {
    return { ok: false, code: "pdf-file-empty", message: "The compiled PDF is missing or empty." };
  }
  const handle = await open(pdfPath, "r");
  try {
    const header = Buffer.alloc(Math.min(8, details.size));
    await handle.read(header, 0, header.length, 0);
    if (!header.toString("latin1").startsWith("%PDF-")) {
      return { ok: false, code: "pdf-signature-invalid", message: "The compiled file has no PDF signature." };
    }
    const tailLength = Math.min(4096, details.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, details.size - tailLength);
    if (!/%%EOF\s*$/s.test(tail.toString("latin1"))) {
      return { ok: false, code: "pdf-eof-missing", message: "The compiled PDF has no terminal EOF marker and may be truncated." };
    }
    return { ok: true };
  } finally {
    await handle.close();
  }
}

function parsePdfPageCount(output: string): number {
  const value = /^Pages:\s+(\d+)\s*$/mi.exec(output)?.[1];
  return value ? Number(value) : 0;
}

export function parsePdfTextPages(xml: string): PdfTextPage[] {
  const pages: PdfTextPage[] = [];
  const pagePattern = /<page\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/gi;
  let match: RegExpExecArray | null;
  while ((match = pagePattern.exec(xml))) {
    const words: PdfWordBox[] = [];
    const wordPattern = /<word\b[^>]*\bxMin="([\d.-]+)"[^>]*\byMin="([\d.-]+)"[^>]*\bxMax="([\d.-]+)"[^>]*\byMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gi;
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = wordPattern.exec(match[3]))) {
      words.push({
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
        text: decodeXml(wordMatch[5].replace(/<[^>]+>/g, "")),
      });
    }
    pages.push({
      page: pages.length + 1,
      width: Number(match[1]),
      height: Number(match[2]),
      words,
    });
  }
  return pages;
}

function geometryFindings(page: PdfTextPage): PdfPostRenderFinding[] {
  const findings: PdfPostRenderFinding[] = [];
  const outside = page.words.filter((word) =>
    word.xMin < -0.5 || word.yMin < -0.5 || word.xMax > page.width + 0.5 || word.yMax > page.height + 0.5
  );
  if (outside.length > 0) {
    findings.push(finding(
      page.page,
      "geometry",
      "error",
      "text-outside-page",
      `${outside.length} text box(es) extend outside the PDF page boundary.`,
    ));
  }
  const edgeTouching = page.words.filter((word) =>
    word.xMin >= -0.5 && word.yMin >= -0.5 && word.xMax <= page.width + 0.5 && word.yMax <= page.height + 0.5 &&
    (word.xMin < 1 || word.yMin < 1 || page.width - word.xMax < 1 || page.height - word.yMax < 1)
  );
  if (edgeTouching.length >= 2) {
    findings.push(finding(
      page.page,
      "geometry",
      "warning",
      "text-at-page-edge",
      `${edgeTouching.length} text boxes touch the page edge and may be clipped.`,
    ));
  }
  return findings;
}

function countDuplicateWordBoxes(words: PdfWordBox[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const word of words) {
    const key = [word.xMin, word.yMin, word.xMax, word.yMax]
      .map((value) => value.toFixed(1))
      .join(":");
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

async function inspectRaster(
  run: typeof runBoundedProcess,
  rasterPath: string,
  signal?: AbortSignal,
): Promise<{ width: number; height: number; inkRatio: number | null } | null> {
  const result = await safeProcess(
    run,
    "magick",
    [rasterPath, "-colorspace", "Gray", "-threshold", "98%", "-format", "%w %h %[fx:1-mean]", "info:"],
    signal,
  );
  if (result.code !== 0) return null;
  const match = /^(\d+)\s+(\d+)\s+([\d.eE+-]+)\s*$/.exec(result.stdout.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]), inkRatio: Number(match[3]) };
}

async function numberedRasterPaths(directory: string): Promise<string[]> {
  const names = (await readdir(directory))
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .sort((left, right) => rasterNumber(left) - rasterNumber(right));
  return names.map((name) => path.join(directory, name));
}

function rasterNumber(name: string): number {
  return Number(/(\d+)(?=\.png$)/i.exec(name)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function selectModelReviewPages(pageCount: number, findings: PdfPostRenderFinding[]): number[] {
  if (pageCount <= MAX_MODEL_REVIEW_PAGES) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const risky = findings.flatMap((entry) => entry.page ? [entry.page] : []);
  const selected = new Set<number>([1, pageCount, ...risky]);
  for (let index = 0; selected.size < MAX_MODEL_REVIEW_PAGES && index < MAX_MODEL_REVIEW_PAGES; index += 1) {
    selected.add(1 + Math.round(index * (pageCount - 1) / (MAX_MODEL_REVIEW_PAGES - 1)));
  }
  return [...selected]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right)
    .slice(0, MAX_MODEL_REVIEW_PAGES);
}

async function createContactSheets(
  run: typeof runBoundedProcess,
  rasterPaths: string[],
  pages: number[],
  sheetDir: string,
  signal?: AbortSignal,
): Promise<Array<{ path: string; pages: number[] }>> {
  const sheets: Array<{ path: string; pages: number[] }> = [];
  for (let index = 0; index < pages.length; index += PAGES_PER_CONTACT_SHEET) {
    const sheetPages = pages.slice(index, index + PAGES_PER_CONTACT_SHEET);
    const sheetPath = path.join(sheetDir, `sheet-${String(sheets.length + 1).padStart(2, "0")}.png`);
    const args = ["montage"];
    for (const page of sheetPages) {
      const rasterPath = rasterPaths[page - 1];
      if (!rasterPath) continue;
      args.push("-label", `Page ${page}`, rasterPath);
    }
    args.push("-tile", "2x2", "-geometry", "620x880+12+28", "-background", "white", sheetPath);
    const result = await safeProcess(run, "magick", args, signal, 2 * 1024 * 1024);
    if (result.code !== 0) {
      // Codex accepts at most two local images. If montage is unavailable,
      // preserve honest coverage by reviewing at most the first two real pages
      // of this batch instead of pretending a sheet exists.
      for (const page of sheetPages.slice(0, 2)) {
        const rasterPath = rasterPaths[page - 1];
        if (rasterPath) sheets.push({ path: rasterPath, pages: [page] });
      }
      continue;
    }
    sheets.push({ path: sheetPath, pages: sheetPages });
  }
  return sheets;
}

function buildModelReviewPrompt(pages: number[]): string {
  return [
    "Review the attached contact sheet(s) of the exact compiled PDF pages.",
    `Visible page labels in this batch: ${pages.join(", ")}.`,
    "This is a subject-agnostic render gate. Do not evaluate factual content, course coverage, examples, question counts, pedagogy, writing style, or whether optional sections exist.",
    "Report only concrete visible production defects: clipped/cut-off content, overlapping text or blocks, broken glyphs/formulas, unreadably small body text, distorted/cropped images, blank or corrupt pages, or gross layout breakage.",
    "Use the visible page label for every finding. A deliberate full-bleed background, page break, or ordinary whitespace is not a defect.",
    "Set severity=error only when the delivered page is materially unreadable or broken; use warning for a localized concern that remains usable.",
    "Every repairTarget must be formatter. Return JSON only.",
  ].join("\n");
}

function parseModelVisualReview(value: string, allowedPages: Set<number>): ModelVisualReview {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.ok !== "boolean" || !Array.isArray(parsed.findings)) {
    throw new Error("Visual reviewer response is missing ok or findings.");
  }
  const findings: ModelVisualReview["findings"] = parsed.findings.map(
    (entry): ModelVisualReview["findings"][number] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Visual reviewer finding must be an object.");
      }
      const record = entry as Record<string, unknown>;
      const severity = record.severity;
      if (
        typeof record.page !== "number" || !Number.isInteger(record.page) || !allowedPages.has(record.page) ||
        (severity !== "error" && severity !== "warning") ||
        typeof record.code !== "string" || !record.code.trim() ||
        typeof record.message !== "string" || !record.message.trim() ||
        record.repairTarget !== "formatter"
      ) {
        throw new Error("Visual reviewer returned an invalid or out-of-batch page finding.");
      }
      return {
        page: record.page,
        severity,
        code: record.code.trim(),
        message: record.message.trim(),
        repairTarget: "formatter" as const,
      };
    },
  );
  if (!parsed.ok && !findings.some((entry) => entry.severity === "error")) {
    throw new Error("Visual reviewer set ok=false without a blocking page-local finding.");
  }
  return { ok: parsed.ok, findings };
}

function finding(
  page: number | null,
  gate: PdfPostRenderFindingGate,
  severity: PdfPostRenderFindingSeverity,
  code: string,
  message: string,
): PdfPostRenderFinding {
  return { page, gate, severity, code, message, repairTarget: "formatter" };
}

function deduplicateFindings(findings: PdfPostRenderFinding[]): PdfPostRenderFinding[] {
  const seen = new Set<string>();
  return findings.filter((entry) => {
    const key = `${entry.page ?? "document"}:${entry.gate}:${entry.severity}:${entry.code}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

async function safeProcess(
  run: typeof runBoundedProcess,
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
  maxOutputBytes = 1024 * 1024,
): Promise<BoundedProcessResult> {
  try {
    return await run(command, args, { signal, timeoutMs: 90_000, maxOutputBytes });
  } catch (error) {
    return failedProcess(errorMessage(error));
  }
}

function failedProcess(message: string): BoundedProcessResult {
  return { code: null, stdout: "", stderr: message };
}

function processFailure(command: string, result: BoundedProcessResult): string {
  const detail = (result.stderr || result.stdout).trim();
  return `${command} could not inspect the compiled PDF${detail ? `: ${detail}` : "."}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
