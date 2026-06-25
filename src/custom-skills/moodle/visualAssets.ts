import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ExtractedData } from "./schemas.js";
import { safeFileName, type SourceCoverage } from "./runDiagnostics.js";
import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { ensureInside } from "./validation.js";

export interface VisualCandidate {
  id: string;
  kind: "moodle_pdf_image" | "moodle_pdf_page" | "moodle_page_screenshot" | "cis_page_screenshot";
  title: string;
  relative_path: string;
  mime_type: "image/png" | "image/jpeg" | "image/svg+xml";
  width_px: number | null;
  height_px: number | null;
  source_id: string | null;
  source_url: string | null;
  source_path: string | null;
  source_page: number | null;
  confidence: number;
  caption_hint: string;
  relevance_reason: string;
  generation_prompt: null;
}

export interface VisualManifest {
  tooling: {
    pdfinfo: boolean;
    pdftoppm: boolean;
    pdfimages: boolean;
    magick: boolean;
  };
  candidates: VisualCandidate[];
  warnings: string[];
}

const VISUALS_DIR = "assets/visuals";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);

export async function discoverVisualCandidates(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
): Promise<VisualManifest> {
  const tooling = await findVisualTooling();
  const warnings: string[] = [];
  const candidates: VisualCandidate[] = [];
  const coverage = config.diagnostics?.getCoverage();
  const artifacts = visualSourceArtifacts(coverage);
  const visualDir = path.join(config.runDir, VISUALS_DIR);
  await mkdir(visualDir, { recursive: true });

  if (!tooling.magick) {
    warnings.push("ImageMagick 'magick' was not found; visual dimensions will be unavailable.");
  }
  if (!tooling.pdftoppm) {
    warnings.push("Poppler 'pdftoppm' was not found; PDF page visual extraction is unavailable.");
  }

  for (const artifact of artifacts) {
    const artifactStat = await stat(artifact.path).catch(() => null);
    if (!artifactStat?.isFile()) {
      continue;
    }
    const extension = path.extname(artifact.path).toLowerCase();
    if (extension === ".pdf") {
      if (!tooling.pdftoppm) {
        continue;
      }
      const rendered = await renderPdfPages({
        config,
        pdfPath: artifact.path,
        sourceName: artifact.sourceName,
        sourceUrl: artifact.sourceUrl,
        visualDir,
        startIndex: candidates.length,
        maxPages: Math.max(1, Math.min(2, config.maxVisualAssets * 2)),
        hasMagick: tooling.magick,
      }).catch((error) => {
        warnings.push(`PDF visual extraction failed for ${artifact.path}: ${errorMessage(error)}`);
        return [];
      });
      candidates.push(...rendered);
      continue;
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      const copied = await copyImageArtifact({
        config,
        imagePath: artifact.path,
        sourceName: artifact.sourceName,
        sourceUrl: artifact.sourceUrl,
        visualDir,
        index: candidates.length,
        hasMagick: tooling.magick,
      }).catch((error) => {
        warnings.push(`Image visual extraction failed for ${artifact.path}: ${errorMessage(error)}`);
        return null;
      });
      if (copied) {
        candidates.push(copied);
      }
    }
  }

  const selected = candidates
    .map((candidate) => ({
      ...candidate,
      confidence: scoreVisualCandidate(config.prompt, state.moodle_raw_text, candidate),
      relevance_reason: relevanceReason(config.prompt, candidate),
    }))
    .filter((candidate) => candidate.confidence >= config.visualMinConfidence)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, Math.max(config.maxVisualAssets * 2, config.maxVisualAssets));

  const manifest = { tooling, candidates: selected, warnings };
  await writeFile(path.join(config.runDir, "visual-candidates.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function formatVisualCandidatesForAnalyzer(manifest: VisualManifest): string {
  const lines = [
    "[Visual candidates]",
    `Tooling: pdfinfo=${manifest.tooling.pdfinfo}, pdftoppm=${manifest.tooling.pdftoppm}, pdfimages=${manifest.tooling.pdfimages}, magick=${manifest.tooling.magick}`,
  ];
  for (const warning of manifest.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  for (const candidate of manifest.candidates) {
    lines.push(
      [
        `Asset: ${candidate.id}`,
        `Kind: ${candidate.kind}`,
        `Title: ${candidate.title}`,
        `Path: ${candidate.relative_path}`,
        `Source: ${candidate.source_path ?? candidate.source_url ?? "unknown"}`,
        candidate.source_page ? `Page: ${candidate.source_page}` : "",
        `Confidence: ${candidate.confidence.toFixed(2)}`,
        `Caption hint: ${candidate.caption_hint}`,
        `Reason: ${candidate.relevance_reason}`,
      ].filter(Boolean).join("\n"),
    );
  }
  return lines.join("\n");
}

export async function readVisualManifest(runDir: string): Promise<VisualManifest | null> {
  const manifestPath = path.join(runDir, "visual-candidates.json");
  const text = await readFile(manifestPath, "utf8").catch(() => null);
  return text ? JSON.parse(text) as VisualManifest : null;
}

export async function copyRenderVisualAssets(
  sourceRunDir: string,
  renderRunDir: string,
  data: ExtractedData,
): Promise<void> {
  const referenced = new Set(
    data.visual_assets
      .map((asset) => asset.relative_path)
      .filter((value): value is string => Boolean(value)),
  );
  for (const relativePath of referenced) {
    assertVisualRelativePath(relativePath);
    const sourcePath = ensureInside(sourceRunDir, path.join(sourceRunDir, relativePath));
    const targetPath = ensureInside(renderRunDir, path.join(renderRunDir, relativePath));
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Referenced visual asset is missing from extraction run: ${relativePath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

export function assertVisualRelativePath(relativePath: string): void {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (
    normalized !== relativePath.replace(/\\/g, "/") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    !normalized.startsWith(`${VISUALS_DIR}/`)
  ) {
    throw new Error(`Visual asset path must stay inside ${VISUALS_DIR}: ${relativePath}`);
  }
}

async function findVisualTooling(): Promise<VisualManifest["tooling"]> {
  const [pdfinfo, pdftoppm, pdfimages, magick] = await Promise.all([
    findExecutable("pdfinfo"),
    findExecutable("pdftoppm"),
    findExecutable("pdfimages"),
    findExecutable("magick"),
  ]);
  return {
    pdfinfo: Boolean(pdfinfo),
    pdftoppm: Boolean(pdftoppm),
    pdfimages: Boolean(pdfimages),
    magick: Boolean(magick),
  };
}

function visualSourceArtifacts(coverage: SourceCoverage | undefined): Array<{
  path: string;
  sourceName: "moodle" | "cis";
  sourceUrl: string | null;
}> {
  if (!coverage) {
    return [];
  }
  return [
    ...coverage.moodle.artifacts.map((artifact) => ({
      path: artifact,
      sourceName: "moodle" as const,
      sourceUrl: coverage.moodle.urls[0] ?? coverage.moodle.lastUrl ?? null,
    })),
    ...coverage.cis.artifacts.map((artifact) => ({
      path: artifact,
      sourceName: "cis" as const,
      sourceUrl: coverage.cis.urls[0] ?? coverage.cis.lastUrl ?? null,
    })),
  ];
}

async function renderPdfPages(input: {
  config: MoodleRuntimeConfig;
  pdfPath: string;
  sourceName: "moodle" | "cis";
  sourceUrl: string | null;
  visualDir: string;
  startIndex: number;
  maxPages: number;
  hasMagick: boolean;
}): Promise<VisualCandidate[]> {
  const pageCount = Math.min(await pdfPageCount(input.pdfPath).catch(() => input.maxPages), input.maxPages);
  const baseName = safeFileName(path.basename(input.pdfPath, ".pdf"));
  const outPrefix = path.join(input.visualDir, `${safeFileName(`${input.startIndex + 1}-${baseName}`)}-page`);
  const result = await runCommand("pdftoppm", [
    "-png",
    "-f",
    "1",
    "-l",
    String(pageCount),
    "-r",
    "144",
    input.pdfPath,
    outPrefix,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdftoppm exited with code ${result.code}`);
  }
  const files = (await readdir(input.visualDir))
    .filter((file) => file.startsWith(path.basename(outPrefix)) && file.endsWith(".png"))
    .sort();
  const candidates: VisualCandidate[] = [];
  for (const [offset, file] of files.entries()) {
    const absolutePath = path.join(input.visualDir, file);
    const dimensions = input.hasMagick ? await imageDimensions(absolutePath).catch(() => null) : null;
    const relativePath = path.posix.join(VISUALS_DIR, file);
    candidates.push({
      id: `fig-${String(input.startIndex + offset + 1).padStart(3, "0")}`,
      kind: input.sourceName === "moodle" ? "moodle_pdf_page" : "cis_page_screenshot",
      title: `${path.basename(input.pdfPath)} Seite ${offset + 1}`,
      relative_path: relativePath,
      mime_type: "image/png",
      width_px: dimensions?.width ?? null,
      height_px: dimensions?.height ?? null,
      source_id: null,
      source_url: input.sourceUrl,
      source_path: input.pdfPath,
      source_page: offset + 1,
      confidence: 0,
      caption_hint: `${input.sourceName.toUpperCase()}-PDF ${path.basename(input.pdfPath)}, Seite ${offset + 1}`,
      relevance_reason: "",
      generation_prompt: null,
    });
  }
  return candidates;
}

async function copyImageArtifact(input: {
  config: MoodleRuntimeConfig;
  imagePath: string;
  sourceName: "moodle" | "cis";
  sourceUrl: string | null;
  visualDir: string;
  index: number;
  hasMagick: boolean;
}): Promise<VisualCandidate> {
  const extension = path.extname(input.imagePath).toLowerCase();
  const targetFile = `${safeFileName(`${input.index + 1}-${path.basename(input.imagePath)}`)}`;
  const targetPath = path.join(input.visualDir, targetFile);
  await copyFile(input.imagePath, targetPath);
  const dimensions = input.hasMagick ? await imageDimensions(targetPath).catch(() => null) : null;
  return {
    id: `fig-${String(input.index + 1).padStart(3, "0")}`,
    kind: input.sourceName === "moodle" ? "moodle_pdf_image" : "cis_page_screenshot",
    title: path.basename(input.imagePath),
    relative_path: path.posix.join(VISUALS_DIR, targetFile),
    mime_type: extension === ".svg" ? "image/svg+xml" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png",
    width_px: dimensions?.width ?? null,
    height_px: dimensions?.height ?? null,
    source_id: null,
    source_url: input.sourceUrl,
    source_path: input.imagePath,
    source_page: null,
    confidence: 0,
    caption_hint: `${input.sourceName.toUpperCase()}-Bild ${path.basename(input.imagePath)}`,
    relevance_reason: "",
    generation_prompt: null,
  };
}

function scoreVisualCandidate(prompt: string, sourceText: string, candidate: VisualCandidate): number {
  const visualTopicBoost = /\b(?:schaltung|circuit|diagramm|diagram|block|signal|mess|labor|aufbau|wandler|motor|regel|flow|prozess|mechanik|dynamik|elektro|spannung|strom|kennlinie|plot|graph)\b/i
    .test(`${prompt}\n${sourceText}`)
    ? 0.25
    : 0;
  const tokenOverlap = promptTokens(prompt)
    .filter((token) => `${candidate.title}\n${candidate.source_path ?? ""}\n${candidate.caption_hint}`.toLowerCase().includes(token))
    .length;
  const pageBoost = candidate.kind === "moodle_pdf_page" ? 0.2 : 0.15;
  return Math.min(1, 0.45 + visualTopicBoost + pageBoost + Math.min(tokenOverlap * 0.08, 0.2));
}

function relevanceReason(prompt: string, candidate: VisualCandidate): string {
  const topic = /\b(?:schaltung|circuit|elektro|spannung|strom|wandler)\b/i.test(prompt)
    ? "Technisches Thema mit hoher Visualisierungswahrscheinlichkeit."
    : "Quellenbild aus dem heruntergeladenen Kursmaterial.";
  return `${topic} Kandidat stammt aus ${candidate.source_path ?? candidate.source_url ?? "einer Kursquelle"}.`;
}

function promptTokens(prompt: string): string[] {
  return [...new Set(prompt.toLowerCase().match(/[a-z0-9äöüß]{4,}/gi) ?? [])]
    .filter((token) => !new Set(["eine", "einen", "einer", "erstelle", "moodle", "dokument", "pdf", "folien"]).has(token));
}

async function pdfPageCount(pdfPath: string): Promise<number> {
  const result = await runCommand("pdfinfo", [pdfPath]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdfinfo exited with code ${result.code}`);
  }
  const pages = /^Pages:\s*(\d+)/im.exec(result.stdout)?.[1];
  return pages ? Number(pages) : 1;
}

async function imageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const result = await runCommand("magick", ["identify", "-format", "%w %h", imagePath]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `magick identify exited with code ${result.code}`);
  }
  const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Could not parse image dimensions for ${imagePath}.`);
  }
  return { width, height };
}

async function findExecutable(name: string): Promise<string | null> {
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(entry, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return null;
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
