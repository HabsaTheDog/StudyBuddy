import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ExtractedData } from "./schemas.js";
import { safeFileName, type SourceCoverage } from "./runDiagnostics.js";
import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { ensureInside } from "./validation.js";
import { plannedPagesByResource, readVisualRetrievalPlan } from "./visualPlanner.js";

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
    pdftotext: boolean;
    pdftoppm: boolean;
    pdfimages: boolean;
    magick: boolean;
  };
  candidates: VisualCandidate[];
  warnings: string[];
}

const VISUALS_DIR = "assets/visuals";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);

interface VisualSourceArtifact {
  resourceId: string | null;
  path: string;
  sourceName: "moodle" | "cis";
  sourceUrl: string | null;
  sectionPath: string[];
}

interface VisualBudget {
  mode: "auto" | "manual";
  candidateLimit: number;
  sourceArtifactLimit: number;
  embeddedImagesPerPdf: number;
  pageCropsPerPdf: number;
  estimatedPdfPages: number;
}

interface RasterTrimResult {
  changed: boolean;
  before: { width: number; height: number };
  after: { width: number; height: number };
  contentAreaRatio: number;
  contentTooSmall: boolean;
}

export async function discoverVisualCandidates(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
): Promise<VisualManifest> {
  const tooling = await findVisualTooling();
  const warnings: string[] = [];
  const candidates: VisualCandidate[] = [];
  const coverage = config.diagnostics?.getCoverage();
  const discoveredArtifacts = visualSourceArtifacts(coverage, state);
  const visualPlan = await readVisualRetrievalPlan(config.runDir);
  const plannedPages = plannedPagesByResource(visualPlan);
  const plannedPageCount = [...plannedPages.values()].reduce((sum, pages) => sum + pages.length, 0);
  const visualBudget = await estimateVisualBudget(config, state, discoveredArtifacts, tooling);
  const artifacts = selectVisualSourceArtifacts(
    discoveredArtifacts,
    visualBudget.sourceArtifactLimit,
    new Set(plannedPages.keys()),
  );
  const visualDir = path.join(config.runDir, VISUALS_DIR);
  await mkdir(visualDir, { recursive: true });

  if (!tooling.magick) {
    warnings.push("ImageMagick 'magick' was not found; visual dimensions will be unavailable.");
  }
  if (!tooling.pdftoppm) {
    warnings.push("Poppler 'pdftoppm' was not found; PDF page visual extraction is unavailable.");
  }
  if (!tooling.pdfimages) {
    warnings.push("Poppler 'pdfimages' was not found; embedded PDF image extraction is unavailable.");
  }

  for (const artifact of artifacts) {
    const visualPath = await resolveVisualArtifactPath(artifact.path);
    const artifactStat = await stat(visualPath).catch(() => null);
    if (!artifactStat?.isFile()) {
      continue;
    }
    const extension = path.extname(visualPath).toLowerCase();
    if (extension === ".pdf") {
      if (!await isPdfFile(visualPath)) {
        warnings.push(`Skipped visual extraction for ${visualPath}: file extension is .pdf but content is not a PDF. The download is likely an HTML login or error page.`);
        continue;
      }
      if (!tooling.pdftoppm) {
        continue;
      }
      const artifactPlannedPages = artifact.resourceId ? plannedPages.get(artifact.resourceId) ?? [] : [];
      const extracted = tooling.pdfimages
        ? await extractEmbeddedPdfImages({
            pdfPath: visualPath,
            sourceName: artifact.sourceName,
            sourceUrl: artifact.sourceUrl,
            visualDir,
            startIndex: candidates.length,
            maxImages: Math.min(80, Math.max(visualBudget.embeddedImagesPerPdf, artifactPlannedPages.length * 2)),
            plannedPages: artifactPlannedPages,
            hasMagick: tooling.magick,
          }).catch((error) => {
            warnings.push(`Embedded PDF image extraction failed for ${visualPath}: ${errorMessage(error)}`);
            return [];
          })
        : [];
      candidates.push(...extracted);
      const rendered = await renderRelevantPdfPages({
        config,
        pdfPath: visualPath,
        sourceName: artifact.sourceName,
        sourceUrl: artifact.sourceUrl,
        visualDir,
        startIndex: candidates.length,
        maxPages: Math.min(80, Math.max(visualBudget.pageCropsPerPdf, artifactPlannedPages.length)),
        plannedPages: artifactPlannedPages,
        hasMagick: tooling.magick,
        hasPdfText: tooling.pdftotext,
      }).catch((error) => {
        warnings.push(`PDF page visual extraction failed for ${visualPath}: ${errorMessage(error)}`);
        return [];
      });
      candidates.push(...rendered);
      continue;
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      const copied = await copyImageArtifact({
        config,
        imagePath: visualPath,
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
      relevance_reason: candidate.relevance_reason || relevanceReason(config.prompt, candidate),
    }))
    .filter((candidate) => candidate.confidence >= config.visualMinConfidence)
    .sort((left, right) => right.confidence - left.confidence);
  const diverseSelection = selectDiverseCandidates(
    selected,
    Math.max(visualBudget.candidateLimit, plannedPageCount * 2),
  );

  const manifest = {
    tooling,
    candidates: diverseSelection,
    warnings: [
      ...warnings,
      `Visual budget: ${visualBudget.mode}, candidateLimit=${Math.max(visualBudget.candidateLimit, plannedPageCount * 2)}, estimatedPdfPages=${visualBudget.estimatedPdfPages}, plannedPages=${plannedPageCount}. Final figure count is decided by usefulness, not by this candidate budget.`,
    ],
  };
  await writeFile(path.join(config.runDir, "visual-candidates.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function formatVisualCandidatesForAnalyzer(manifest: VisualManifest): string {
  const lines = [
    "[Visual candidates]",
    `Tooling: pdfinfo=${manifest.tooling.pdfinfo}, pdftotext=${manifest.tooling.pdftotext}, pdftoppm=${manifest.tooling.pdftoppm}, pdfimages=${manifest.tooling.pdfimages}, magick=${manifest.tooling.magick}`,
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
  const referenced = new Map(
    data.visual_assets
      .filter((asset): asset is typeof asset & { relative_path: string } => Boolean(asset.relative_path))
      .map((asset) => [asset.relative_path, asset]),
  );
  const canCrop = Boolean(await findExecutable("magick"));
  for (const [relativePath, asset] of referenced) {
    assertVisualRelativePath(relativePath);
    const sourcePath = ensureInside(sourceRunDir, path.join(sourceRunDir, relativePath));
    const targetPath = ensureInside(renderRunDir, path.join(renderRunDir, relativePath));
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Referenced visual asset is missing from extraction run: ${relativePath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    if (
      canCrop &&
      asset.kind === "moodle_pdf_page" &&
      /\.(?:png|jpe?g)$/i.test(targetPath)
    ) {
      await trimRasterWhitespace(targetPath).catch(() => false);
    }
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
  const [pdfinfo, pdftotext, pdftoppm, pdfimages, magick] = await Promise.all([
    findExecutable("pdfinfo"),
    findExecutable("pdftotext"),
    findExecutable("pdftoppm"),
    findExecutable("pdfimages"),
    findExecutable("magick"),
  ]);
  return {
    pdfinfo: Boolean(pdfinfo),
    pdftotext: Boolean(pdftotext),
    pdftoppm: Boolean(pdftoppm),
    pdfimages: Boolean(pdfimages),
    magick: Boolean(magick),
  };
}

function visualSourceArtifacts(
  coverage: SourceCoverage | undefined,
  state: LangGraphAgentState,
): VisualSourceArtifact[] {
  if (!coverage) {
    return [];
  }
  const resourcesByPath = new Map(
    state.resource_manifest.resources
      .filter((resource) => resource.localPath)
      .map((resource) => [path.resolve(resource.localPath!), resource]),
  );
  return [
    ...coverage.moodle.artifacts.map((artifact) => {
      const resource = resourcesByPath.get(path.resolve(artifact));
      return {
        path: artifact,
        resourceId: resource?.id ?? null,
        sourceName: "moodle" as const,
        sourceUrl: resource?.originUrl ?? coverage.moodle.urls[0] ?? coverage.moodle.lastUrl ?? null,
        sectionPath: resource?.sectionPath ?? [],
      };
    }),
    ...coverage.cis.artifacts.map((artifact) => {
      const resource = resourcesByPath.get(path.resolve(artifact));
      return {
        path: artifact,
        resourceId: resource?.id ?? null,
        sourceName: "cis" as const,
        sourceUrl: resource?.originUrl ?? coverage.cis.urls[0] ?? coverage.cis.lastUrl ?? null,
        sectionPath: resource?.sectionPath ?? [],
      };
    }),
  ];
}

async function estimateVisualBudget(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  artifacts: VisualSourceArtifact[],
  tooling: VisualManifest["tooling"],
): Promise<VisualBudget> {
  if (config.maxVisualAssets > 0) {
    const limit = config.maxVisualAssets;
    return {
      mode: "manual",
      candidateLimit: limit,
      sourceArtifactLimit: Math.max(10, limit * 3),
      embeddedImagesPerPdf: Math.max(2, Math.min(12, Math.ceil(limit / 3))),
      pageCropsPerPdf: Math.max(1, Math.min(8, Math.ceil(limit / 5))),
      estimatedPdfPages: 0,
    };
  }

  const eligibleArtifacts = artifacts.filter((artifact) => {
    const extension = path.extname(artifact.path).toLowerCase();
    return extension === ".pdf" || IMAGE_EXTENSIONS.has(extension) || OFFICE_EXTENSIONS.has(extension);
  });
  const pdfArtifacts = eligibleArtifacts.filter((artifact) =>
    path.extname(artifact.path).toLowerCase() === ".pdf"
  );
  const estimatedPdfPages = tooling.pdfinfo
    ? await estimatePdfPages(pdfArtifacts.map((artifact) => artifact.path), 800)
    : pdfArtifacts.length * 16;
  const chapters = Math.max(1, new Set(
    artifacts
      .map((artifact) => artifact.sectionPath[0]?.trim())
      .filter(Boolean),
  ).size);
  const exerciseRecords = state.evidence_package.records.filter((record) =>
    record.kind === "exercise" || record.kind === "solution"
  ).length;
  const visualEvidenceRecords = state.evidence_package.records.filter((record) =>
    record.kind === "figure" || record.kind === "table" || record.kind === "formula"
  ).length;
  const base = baseVisualBudget(config);
  const candidateLimit = clampInteger(
    Math.ceil(
      base +
      chapters * 10 +
      estimatedPdfPages * 0.9 +
      exerciseRecords * 2 +
      visualEvidenceRecords * 1.25,
    ),
    18,
    180,
  );
  const averagePdfPages = pdfArtifacts.length > 0 ? estimatedPdfPages / pdfArtifacts.length : 0;
  return {
    mode: "auto",
    candidateLimit,
    sourceArtifactLimit: clampInteger(Math.ceil(candidateLimit / 2), 10, 80),
    embeddedImagesPerPdf: clampInteger(Math.ceil(4 + averagePdfPages / 7), 4, 18),
    pageCropsPerPdf: clampInteger(Math.ceil(3 + averagePdfPages / 10), 3, 12),
    estimatedPdfPages,
  };
}

function baseVisualBudget(config: MoodleRuntimeConfig): number {
  const prompt = config.prompt.toLocaleLowerCase("de");
  if (/\b(?:laborbericht|laborprotokoll|protokoll|lab report|versuchsbericht)\b/.test(prompt)) {
    return 42;
  }
  return {
    study_guide: 28,
    exam_navigator: 24,
    interactive_learning: 34,
    practice_pack: 30,
    source_audit: 14,
  }[config.artifactIntent.profile];
}

async function estimatePdfPages(pdfPaths: string[], hardLimit: number): Promise<number> {
  let total = 0;
  for (const pdfPath of pdfPaths) {
    total += await pdfPageCount(pdfPath).catch(() => 12);
    if (total >= hardLimit) {
      return hardLimit;
    }
  }
  return total;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectVisualSourceArtifacts(
  artifacts: VisualSourceArtifact[],
  limit: number,
  plannedResourceIds: Set<string> = new Set(),
): VisualSourceArtifact[] {
  const eligible = artifacts
    .filter((artifact) => {
      const extension = path.extname(artifact.path).toLowerCase();
      return extension === ".pdf" || IMAGE_EXTENSIONS.has(extension) || OFFICE_EXTENSIONS.has(extension);
    })
    .sort((left, right) =>
      artifactPriority(left.path) - artifactPriority(right.path) ||
      left.path.localeCompare(right.path, "de")
    );
  const groups = new Map<string, VisualSourceArtifact[]>();
  for (const artifact of eligible) {
    const key = artifact.sectionPath[0]?.toLocaleLowerCase("de") || path.dirname(artifact.path);
    groups.set(key, [...(groups.get(key) ?? []), artifact]);
  }
  const selected: VisualSourceArtifact[] = [];
  const selectedKeys = new Set<string>();
  for (const artifact of eligible) {
    if (!artifact.resourceId || !plannedResourceIds.has(artifact.resourceId)) continue;
    selected.push(artifact);
    selectedKeys.add(artifact.path);
    if (selected.length >= limit) return selected;
  }
  const queues = [...groups.values()];
  while (selected.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && !selectedKeys.has(next.path)) {
        selected.push(next);
        selectedKeys.add(next.path);
      }
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function artifactPriority(filePath: string): number {
  const name = path.basename(filePath);
  if (/\b(?:foliensatz|skript|slides?|unterlagen)\b/i.test(name)) return 0;
  if (/\b(?:angabe|aufgabe|worksheet)\b/i.test(name)) return 1;
  if (/\b(?:lösung|loesung|solution)\b/i.test(name)) return 2;
  return 3;
}

async function resolveVisualArtifactPath(filePath: string): Promise<string> {
  if (!OFFICE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return filePath;
  }
  const convertedPdf = filePath.replace(/\.[^.]+$/, ".pdf");
  const convertedStat = await stat(convertedPdf).catch(() => null);
  return convertedStat?.isFile() ? convertedPdf : filePath;
}

async function extractEmbeddedPdfImages(input: {
  pdfPath: string;
  sourceName: "moodle" | "cis";
  sourceUrl: string | null;
  visualDir: string;
  startIndex: number;
  maxImages: number;
  plannedPages: number[];
  hasMagick: boolean;
}): Promise<VisualCandidate[]> {
  const baseName = safeFileName(path.basename(input.pdfPath, ".pdf"));
  const prefix = path.join(
    input.visualDir,
    safeFileName(`${input.startIndex + 1}-${baseName}-embedded`),
  );
  const result = await runCommand("pdfimages", [
    "-png",
    "-j",
    "-p",
    "-print-filenames",
    input.pdfPath,
    prefix,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdfimages exited with code ${result.code}`);
  }
  const files = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const ranked: Array<{
    filePath: string;
    width: number | null;
    height: number | null;
    size: number;
    page: number | null;
  }> = [];
  for (const filePath of files) {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) continue;
    const raster = await prepareRasterCandidate(filePath, input.hasMagick, {
      dropMostlyEmpty: true,
    });
    if (!raster.usable) {
      await rm(filePath, { force: true });
      continue;
    }
    const width = raster.width;
    const height = raster.height;
    if (
      width &&
      height &&
      (
        width < 300 ||
        height < 180 ||
        width * height < 110_000 ||
        width / height > 6 ||
        height / width > 6
      )
    ) {
      await rm(filePath, { force: true });
      continue;
    }
    if (!width && !height && fileStat.size < 15_000) {
      await rm(filePath, { force: true });
      continue;
    }
    const fileName = path.basename(filePath);
    const page = /-(\d+)-\d+\.[^.]+$/i.exec(fileName)?.[1];
    ranked.push({
      filePath,
      width,
      height,
      size: fileStat.size,
      page: page ? Number(page) : null,
    });
  }
  const planned = new Set(input.plannedPages);
  return ranked
    .sort((left, right) =>
      Number(planned.has(right.page ?? -1)) - Number(planned.has(left.page ?? -1)) ||
      ((right.width ?? 0) * (right.height ?? 0) || right.size) -
      ((left.width ?? 0) * (left.height ?? 0) || left.size)
    )
    .slice(0, input.maxImages)
    .map((image, offset) => {
      const fileName = path.basename(image.filePath);
      const extension = path.extname(fileName).toLowerCase();
      return {
        id: `fig-${String(input.startIndex + offset + 1).padStart(3, "0")}`,
        kind: input.sourceName === "moodle" ? "moodle_pdf_image" : "cis_page_screenshot",
        title: `${path.basename(input.pdfPath)} – eingebettete Abbildung`,
        relative_path: path.posix.join(VISUALS_DIR, fileName),
        mime_type: extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png",
        width_px: image.width,
        height_px: image.height,
        source_id: null,
        source_url: input.sourceUrl,
        source_path: input.pdfPath,
        source_page: image.page,
        confidence: 0.82,
        caption_hint: `Eingebettete Originalabbildung aus ${path.basename(input.pdfPath)}${image.page ? `, Seite ${image.page}` : ""}.`,
        relevance_reason: "Direkt aus einer Moodle-Kursdatei extrahierte technische Abbildung.",
        generation_prompt: null,
      };
    });
}

async function renderRelevantPdfPages(input: {
  config: MoodleRuntimeConfig;
  pdfPath: string;
  sourceName: "moodle" | "cis";
  sourceUrl: string | null;
  visualDir: string;
  startIndex: number;
  maxPages: number;
  plannedPages: number[];
  hasMagick: boolean;
  hasPdfText: boolean;
}): Promise<VisualCandidate[]> {
  const pageCount = await pdfPageCount(input.pdfPath).catch(() => 1);
  const pages = input.hasPdfText
    ? await readPdfPages(input.pdfPath).catch(() => [])
    : [];
  const rankedPages = selectPdfPagesForRendering(
    rankPdfPages(
      pages.length > 0
        ? pages
        : Array.from({ length: pageCount }, () => ""),
      input.config.prompt,
    ),
    Math.max(1, input.maxPages),
    pageCount,
    input.plannedPages,
  );
  const baseName = safeFileName(path.basename(input.pdfPath, ".pdf"));
  const planned = new Set(input.plannedPages);
  const candidates: VisualCandidate[] = [];
  for (const [offset, rankedPage] of rankedPages.entries()) {
    const file = `${safeFileName(`${input.startIndex + offset + 1}-${baseName}`)}-page-${rankedPage.page}.png`;
    const outPrefix = path.join(input.visualDir, file.replace(/\.png$/i, ""));
    const result = await runCommand("pdftoppm", [
      "-png",
      "-singlefile",
      "-f",
      String(rankedPage.page),
      "-l",
      String(rankedPage.page),
      "-r",
      "144",
      input.pdfPath,
      outPrefix,
    ]);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || `pdftoppm exited with code ${result.code}`);
    }
    const absolutePath = path.join(input.visualDir, file);
    if (input.hasMagick) {
      await trimRasterWhitespace(absolutePath).catch(() => false);
    }
    const dimensions = input.hasMagick ? await imageDimensions(absolutePath).catch(() => null) : null;
    const relativePath = path.posix.join(VISUALS_DIR, file);
    const plannerHit = planned.has(rankedPage.page);
    candidates.push({
      id: `fig-${String(input.startIndex + offset + 1).padStart(3, "0")}`,
      kind: input.sourceName === "moodle" ? "moodle_pdf_page" : "cis_page_screenshot",
      title: `${path.basename(input.pdfPath)} Seite ${rankedPage.page}`,
      relative_path: relativePath,
      mime_type: "image/png",
      width_px: dimensions?.width ?? null,
      height_px: dimensions?.height ?? null,
      source_id: null,
      source_url: input.sourceUrl,
      source_path: input.pdfPath,
      source_page: rankedPage.page,
      confidence: plannerHit ? Math.min(0.82, rankedPage.score + 0.08) : Math.min(0.72, rankedPage.score),
      caption_hint: `${plannerHit ? "Visual-Planner-Treffer. " : ""}${input.sourceName.toUpperCase()}-PDF ${path.basename(input.pdfPath)}, Seite ${rankedPage.page}: ${rankedPage.hint}`,
      relevance_reason: plannerHit
        ? "Vom Visual Planner angeforderte PDF-Seite; als Vollseiten-Screenshot nur verwenden, wenn kein besserer Diagramm- oder Tabellen-Ausschnitt existiert."
        : "Vollseiten-Screenshot aus einer PDF-Quelle; nachrangig gegen direkt extrahierte Abbildungen.",
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
}): Promise<VisualCandidate | null> {
  const extension = path.extname(input.imagePath).toLowerCase();
  const targetFile = `${safeFileName(`${input.index + 1}-${path.basename(input.imagePath)}`)}`;
  const targetPath = path.join(input.visualDir, targetFile);
  await copyFile(input.imagePath, targetPath);
  const raster = extension === ".svg"
    ? { usable: true, width: null, height: null }
    : await prepareRasterCandidate(targetPath, input.hasMagick, { dropMostlyEmpty: true });
  if (!raster.usable) {
    await rm(targetPath, { force: true });
    return null;
  }
  return {
    id: `fig-${String(input.index + 1).padStart(3, "0")}`,
    kind: input.sourceName === "moodle" ? "moodle_pdf_image" : "cis_page_screenshot",
    title: path.basename(input.imagePath),
    relative_path: path.posix.join(VISUALS_DIR, targetFile),
    mime_type: extension === ".svg" ? "image/svg+xml" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png",
    width_px: raster.width,
    height_px: raster.height,
    source_id: null,
    source_url: input.sourceUrl,
    source_path: input.imagePath,
    source_page: null,
    confidence: 0.78,
    caption_hint: `${input.sourceName.toUpperCase()}-Bild ${path.basename(input.imagePath)}`,
    relevance_reason: "",
    generation_prompt: null,
  };
}

function scoreVisualCandidate(prompt: string, sourceText: string, candidate: VisualCandidate): number {
  const visualTopicBoost = /\b(?:schaltung|circuit|diagramm|diagram|block|signal|mess|labor|aufbau|wandler|motor|regel|flow|prozess|mechanik|dynamik|elektro|spannung|strom|kennlinie|plot|graph)\b/i
    .test(`${prompt}\n${sourceText}`)
    ? 0.15
    : 0;
  const tokenOverlap = promptTokens(prompt)
    .filter((token) => `${candidate.title}\n${candidate.source_path ?? ""}\n${candidate.caption_hint}`.toLowerCase().includes(token))
    .length;
  const kindBoost = candidate.kind === "moodle_pdf_image"
    ? 0.14
    : candidate.kind === "moodle_pdf_page"
      ? -0.06
      : 0.04;
  return Math.min(
    1,
    0.24 +
      candidate.confidence * 0.48 +
      visualTopicBoost +
      kindBoost +
      Math.min(tokenOverlap * 0.05, 0.15),
  );
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

async function readPdfPages(pdfPath: string): Promise<string[]> {
  const result = await runCommand("pdftotext", ["-layout", pdfPath, "-"]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdftotext exited with code ${result.code}`);
  }
  const pages = result.stdout.split("\f");
  if (pages.at(-1)?.trim() === "") pages.pop();
  return pages;
}

function rankPdfPages(
  pages: string[],
  prompt: string,
): Array<{ page: number; score: number; hint: string }> {
  const promptWords = promptTokens(prompt);
  return pages
    .map((pageText, index) => {
      const normalized = pageText.replace(/\s+/g, " ").trim();
      const lower = normalized.toLocaleLowerCase("de");
      const visualTerms = lower.match(
        /\b(?:abbildung|diagramm|tabelle|kennlinie|schema|zeichnung|schnitt|aufbau|anordnung|passung|niet|löt|loet|hertz|viskos|schmier|formel)\w*/g,
      )?.length ?? 0;
      const practiceSignals = lower.match(
        /\b(?:beispiel|aufgabe|übung|uebung|lösung|loesung|musterlösung|musterloesung|example|exercise|solution|answer)\w*/g,
      )?.length ?? 0;
      const mathSignals = pageText.match(/(?:=|≤|≥|√|∑|π|N\/mm|mm²|MPa|mPa)/g)?.length ?? 0;
      const overlap = promptWords.filter((token) => lower.includes(token)).length;
      let score =
        0.38 +
        Math.min(visualTerms * 0.035, 0.2) +
        Math.min(mathSignals * 0.018, 0.14) +
        Math.min(overlap * 0.03, 0.12);
      if (practiceSignals > 0 && visualTerms === 0) score -= Math.min(practiceSignals * 0.06, 0.18);
      if (practiceSignals > 0 && normalized.length > 900) score -= 0.08;
      if (normalized.length < 80) score -= 0.12;
      if (index === 0 && visualTerms === 0 && mathSignals === 0) score -= 0.05;
      return {
        page: index + 1,
        score: Math.max(0.25, Math.min(0.95, score)),
        hint: normalized.slice(0, 180) || "PDF-Seite ohne extrahierbaren Text",
      };
    })
    .sort((left, right) => right.score - left.score || left.page - right.page);
}

function selectPdfPagesForRendering(
  rankedPages: Array<{ page: number; score: number; hint: string }>,
  limit: number,
  pageCount: number,
  plannedPages: number[] = [],
): Array<{ page: number; score: number; hint: string }> {
  const selected = new Map<number, { page: number; score: number; hint: string }>();
  const add = (page: { page: number; score: number; hint: string } | undefined) => {
    if (!page || selected.size >= limit || selected.has(page.page)) return;
    selected.set(page.page, page);
  };
  const rankedByPage = new Map(rankedPages.map((page) => [page.page, page]));

  for (const pageNumber of plannedPages) {
    const page = rankedByPage.get(pageNumber);
    add(page);
  }

  const tailReserve = pageCount >= 12 && limit >= 4
    ? Math.max(1, Math.min(3, Math.floor(limit * 0.25)))
    : 0;
  const tailStart = Math.max(1, Math.floor(pageCount * 0.66));
  const tailPages = rankedPages.filter((page) => page.page >= tailStart);
  for (const page of tailPages.slice(0, tailReserve)) {
    add(page);
  }

  for (const page of rankedPages) {
    add(page);
  }

  return [...selected.values()].sort((left, right) => left.page - right.page);
}

function selectDiverseCandidates(
  candidates: VisualCandidate[],
  limit: number,
): VisualCandidate[] {
  const selected: VisualCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedSources = new Set<string>();
  for (const candidate of candidates) {
    const source = candidate.source_path ?? candidate.source_url ?? candidate.id;
    if (selectedSources.has(source)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    selectedSources.add(source);
    if (selected.length >= limit) return selected;
  }
  for (const candidate of candidates) {
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
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

async function prepareRasterCandidate(
  imagePath: string,
  hasMagick: boolean,
  options: { dropMostlyEmpty: boolean },
): Promise<{ usable: boolean; width: number | null; height: number | null }> {
  const fileStat = await stat(imagePath).catch(() => null);
  if (!fileStat?.isFile()) return { usable: false, width: null, height: null };
  if (!hasMagick) {
    return { usable: fileStat.size >= 15_000, width: null, height: null };
  }

  const trim = await trimRasterWhitespace(imagePath).catch(() => null);
  const dimensions = trim?.changed ? trim.after : await imageDimensions(imagePath).catch(() => null);
  if (!dimensions) return { usable: fileStat.size >= 15_000, width: null, height: null };

  const sparseLargeRaster =
    fileStat.size < 55_000 &&
    trim &&
    trim.before.width * trim.before.height >= 900_000 &&
    trim.contentAreaRatio < 0.18;
  if (options.dropMostlyEmpty && trim && (trim.contentTooSmall || sparseLargeRaster)) {
    return { usable: false, width: dimensions.width, height: dimensions.height };
  }

  return { usable: true, width: dimensions.width, height: dimensions.height };
}

async function trimRasterWhitespace(imagePath: string): Promise<RasterTrimResult> {
  const before = await imageDimensions(imagePath);
  const extension = path.extname(imagePath);
  const temporaryPath = `${imagePath.slice(0, -extension.length)}.trimmed${extension}`;
  const result = await runCommand("magick", [
    imagePath,
    "-fuzz",
    "4%",
    "-trim",
    "+repage",
    "-bordercolor",
    "white",
    "-border",
    "20x20",
    temporaryPath,
  ]);
  if (result.code !== 0) {
    await rm(temporaryPath, { force: true });
    throw new Error(result.stderr || result.stdout || "ImageMagick whitespace trim failed.");
  }
  const after = await imageDimensions(temporaryPath);
  const beforeArea = before.width * before.height;
  const afterArea = after.width * after.height;
  const contentAreaRatio = beforeArea > 0 ? afterArea / beforeArea : 1;
  const contentTooSmall = after.width < 180 || after.height < 120 || afterArea < 24_000;
  const noUsefulTrim = afterArea >= beforeArea * 0.96;
  if (contentTooSmall || noUsefulTrim) {
    await rm(temporaryPath, { force: true });
    return {
      changed: false,
      before,
      after,
      contentAreaRatio,
      contentTooSmall,
    };
  }
  await rename(temporaryPath, imagePath);
  return {
    changed: true,
    before,
    after,
    contentAreaRatio,
    contentTooSmall: false,
  };
}

async function isPdfFile(filePath: string): Promise<boolean> {
  const buffer = await readFile(filePath).catch(() => null);
  return Boolean(buffer && buffer.subarray(0, 5).toString("latin1") === "%PDF-");
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
