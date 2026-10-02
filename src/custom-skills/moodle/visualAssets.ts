import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { sanitizeUnicode } from "./codexClient.js";
import type { ExtractedData } from "./schemas.js";
import { safeFileName, type SourceCoverage } from "./runDiagnostics.js";
import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import type { VisualCropMode } from "./types.js";
import { ensureInside } from "./validation.js";
import { canonicalizeResourceUrl, isResourceFailureStatus } from "./resourceAcquisition.js";
import { plannedPagesByResource, readVisualRetrievalPlan } from "./visualPlanner.js";
import { runBoundedProcess } from "../shared/boundedProcess.js";

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
  compositionVersion?: string;
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
export const VISUAL_SOURCE_COMPOSITION_VERSION = "2026-10-02.1-rendered-page-composition";
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
  const visualRequiredIds = visualRequiredResourceIds(state);
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
      // Raw PDF image objects omit text/vector overlays, clipping and masks.
      // Only the rendered page composition is publishable source evidence.
      const rendered = await renderRelevantPdfPages({
        config,
        pdfPath: visualPath,
        resourceId: artifact.resourceId,
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
        resourceId: artifact.resourceId,
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
      confidence: visualRequiredIds.has(candidate.source_id ?? "")
        ? Math.max(
            config.visualMinConfidence,
            scoreVisualCandidate(config.prompt, state.moodle_raw_text, candidate),
          )
        : scoreVisualCandidate(config.prompt, state.moodle_raw_text, candidate),
      relevance_reason: visualRequiredIds.has(candidate.source_id ?? "")
        ? "Selected source has a sparse native text layer; retain its bounded page visual for evidence analysis."
        : candidate.relevance_reason || relevanceReason(config.prompt, candidate),
    }))
    .filter((candidate) => candidate.confidence >= config.visualMinConfidence)
    .sort((left, right) => right.confidence - left.confidence);
  const diverseSelection = selectDiverseCandidates(
    selected,
    Math.max(visualBudget.candidateLimit, plannedPageCount * 2),
  );

  const manifest = {
    compositionVersion: VISUAL_SOURCE_COMPOSITION_VERSION,
    tooling,
    candidates: diverseSelection,
    warnings: [
      ...warnings,
      ...(visualRequiredIds.size > 0
        ? [`Retained bounded page visuals for ${visualRequiredIds.size} selected source(s) with sparse native text.`]
        : []),
      `Visual budget: ${visualBudget.mode}, candidateLimit=${Math.max(visualBudget.candidateLimit, plannedPageCount * 2)}, estimatedPdfPages=${visualBudget.estimatedPdfPages}, plannedPages=${plannedPageCount}. Final figure count is decided by usefulness, not by this candidate budget.`,
    ],
  };
  await writeFile(
    path.join(config.runDir, "visual-candidates.json"),
    `${JSON.stringify(
      manifest,
      (_key, value) => typeof value === "string" ? sanitizeUnicode(value) : value,
      2,
    )}\n`,
    "utf8",
  );
  return manifest;
}

export function visualRequiredResourceIds(
  state: Pick<LangGraphAgentState, "resource_manifest">,
): Set<string> {
  return new Set(state.resource_manifest.resources
    .filter((resource) =>
      resource.selection?.selected === true &&
      (resource.extraction?.status === "partial" || resource.extraction?.status === "unusable") &&
      resource.localPath?.toLocaleLowerCase("en").endsWith(".pdf")
    )
    .map((resource) => resource.id));
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
  if (!text) return null;
  const manifest = JSON.parse(text) as VisualManifest;
  return { ...manifest, candidates: manifest.candidates.filter(candidate => !isUncomposedPdfRaster(candidate)) };
}

function isUncomposedPdfRaster(asset: { kind: string; source_path: string | null; source_page?: number | null; relative_path: string | null }): boolean {
  // A direct image's actual source path outranks a coincidental legacy-like name.
  if (IMAGE_EXTENSIONS.has(path.extname(asset.source_path ?? "").toLowerCase())) return false;
  const fromPdf = (asset.source_page != null && Number.isInteger(asset.source_page) && asset.source_page > 0) ||
    path.extname(asset.source_path ?? "").toLowerCase() === ".pdf";
  return /-embedded-page-(?:\d+-)+\d+\./i.test(asset.relative_path ?? "") || (fromPdf && asset.kind === "moodle_pdf_image");
}

export async function hydrateExtractedVisualAssets(
  sourceRunDir: string,
  data: ExtractedData,
  cropMode: VisualCropMode = "auto",
): Promise<ExtractedData> {
  const manifest = await readVisualManifest(sourceRunDir);
  const warnings = [...data.warnings];
  const hydrated = {
    ...data,
    visual_assets: await Promise.all(data.visual_assets.map(async (asset) => {
      const legacyPdfRaster = isUncomposedPdfRaster(asset);
      if (asset.relative_path && !legacyPdfRaster) {
        const existingPath = ensureInside(sourceRunDir, path.join(sourceRunDir, asset.relative_path));
        const existing = await stat(existingPath).catch(() => null);
        if (existing?.isFile()) return asset;
      }
      if (
        cropMode !== "original" &&
        (asset.kind === "typst_diagram" || asset.kind === "placeholder_prompt")
      ) {
        return { ...asset, relative_path: null, mime_type: null };
      }
      const match = bestVisualCandidate(asset, manifest?.candidates ?? [], cropMode, legacyPdfRaster);
      if (!match) {
        if (legacyPdfRaster) warnings.push(`Visual ${asset.id} omitted: the embedded PDF raster has no matching source/page composition.`);
        return { ...asset, relative_path: null, mime_type: null };
      }
      return {
        ...asset,
        kind: match.kind,
        relative_path: match.relative_path,
        mime_type: match.mime_type,
        width_px: match.width_px,
        height_px: match.height_px,
        source_url: match.source_url ?? asset.source_url,
        source_path: match.source_path ?? asset.source_path,
        source_page: match.source_page ?? asset.source_page,
      };
    })),
  };
  // Hydration is intentionally lossless: it resolves only visuals already
  // selected by the request/evidence planning and content-review lanes. It
  // must not silently invent additional media because an example happens to
  // contain a subject keyword.
  return { ...hydrated, warnings: [...new Set(warnings)] };
}

function bestVisualCandidate(
  asset: ExtractedData["visual_assets"][number],
  candidates: VisualCandidate[],
  cropMode: VisualCropMode,
  requireExactPage = false,
): VisualCandidate | null {
  const assetFile = asset.source_path ? path.resolve(asset.source_path) : null;
  const titleTokens = visualMatchTokens(`${asset.title} ${asset.caption_hint}`);
  const ranked = candidates
    .map((candidate) => {
      const candidateFile = candidate.source_path
        ? path.resolve(candidate.source_path)
        : null;
      const sameFile = Boolean(assetFile && candidateFile && assetFile === candidateFile);
      const sameUrl = Boolean(asset.source_url && candidate.source_url === asset.source_url);
      const samePage = Boolean(asset.source_page && candidate.source_page === asset.source_page);
      const pageMismatch = Boolean(
        asset.source_page &&
        candidate.source_page &&
        asset.source_page !== candidate.source_page
      );
      const tokenOverlap = titleTokens.filter((token) =>
        `${candidate.title} ${candidate.caption_hint}`.toLocaleLowerCase("de").includes(token)
      ).length;
      const kindScore = visualCandidateKindScore(candidate, cropMode);
      return {
        candidate,
        eligible: !isUncomposedPdfRaster(candidate) && (sameFile || sameUrl) && !pageMismatch &&
          (!requireExactPage || (asset.source_page != null && samePage)),
        score: (sameFile ? 8 : 0) + (sameUrl ? 4 : 0) + (samePage ? 6 : 0) + kindScore + Math.min(tokenOverlap, 4),
      };
    })
    .filter((entry) => entry.eligible)
    .sort((left, right) => right.score - left.score || right.candidate.confidence - left.candidate.confidence);
  const best = ranked[0];
  return best && best.score >= 8 ? best.candidate : null;
}

function visualCandidateKindScore(
  candidate: VisualCandidate,
  cropMode: VisualCropMode,
): number {
  const page = candidate.kind === "moodle_pdf_page";
  if (cropMode === "original" || cropMode === "context") return page ? 14 : 0;
  return page ? 10 : 0;
}

function visualMatchTokens(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase("de").match(/[a-z0-9äöüß]{4,}/gi) ?? [])]
    .filter((token) => !/^(?:abbildung|beispiel|seite|quelle|visualisierung)$/.test(token));
}

export async function copyRenderVisualAssets(
  sourceRunDir: string,
  renderRunDir: string,
  data: ExtractedData,
  cropMode: VisualCropMode = "auto",
): Promise<void> {
  const referenced = new Map(
    data.visual_assets
      .filter((asset): asset is typeof asset & { relative_path: string } => Boolean(asset.relative_path))
      .map((asset) => [asset.relative_path, asset]),
  );
  const canCrop = Boolean(await findExecutable("magick"));
  const resolutionLog: Array<Record<string, unknown>> = [];
  for (const [relativePath, asset] of referenced) {
    if (isUncomposedPdfRaster(asset)) throw new Error(`Visual ${asset.id} requires a matching rendered PDF page composition before copying.`);
    assertVisualRelativePath(relativePath);
    const sourcePath = ensureInside(sourceRunDir, path.join(sourceRunDir, relativePath));
    const targetPath = ensureInside(renderRunDir, path.join(renderRunDir, relativePath));
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Referenced visual asset is missing from extraction run: ${relativePath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    const before = canCrop && /\.(?:png|jpe?g)$/i.test(targetPath)
      ? await imageDimensions(targetPath).catch(() => null)
      : null;
    let cropApplied = false;
    if (
      canCrop &&
      (asset.kind === "moodle_pdf_page" || (asset.kind === "cis_page_screenshot" && asset.source_page != null)) &&
      cropMode !== "original" &&
      /\.(?:png|jpe?g)$/i.test(targetPath)
    ) {
      cropApplied = await trimRasterWhitespace(targetPath, true).then(result => result.changed).catch(() => false);
    }
    const after = canCrop && /\.(?:png|jpe?g)$/i.test(targetPath)
      ? await imageDimensions(targetPath).catch(() => null)
      : null;
    if (after) {
      asset.width_px = after.width;
      asset.height_px = after.height;
    }
    resolutionLog.push({
      asset_id: asset.id,
      strategy: cropMode,
      selected_kind: asset.kind,
      relative_path: relativePath,
      source_page: asset.source_page,
      crop_applied: cropApplied,
      dimensions_before: before,
      dimensions_after: after,
    });
  }
  await writeFile(
    path.join(renderRunDir, "visual-resolution.json"),
    `${JSON.stringify({ strategy: cropMode, assets: resolutionLog }, null, 2)}\n`,
    "utf8",
  );
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

export function visualSourceArtifacts(
  coverage: SourceCoverage | undefined,
  state: LangGraphAgentState,
): VisualSourceArtifact[] {
  const resourcesByPath = new Map(
    state.resource_manifest.resources
      .filter((resource) => resource.localPath)
      .map((resource) => [path.resolve(resource.localPath!), resource]),
  );
  const excluded = new Set((state.source_architect_decision.learningArchitecture?.excludedResourceUrls ?? []).map(canonicalizeResourceUrl));
  const assigned = new Set([
    ...(state.source_architect_decision.learningArchitecture?.modules.flatMap(module => module.resourceUrls) ?? []),
    ...(state.source_architect_decision.learningArchitecture?.supportResources.flatMap(support => support.resourceUrls) ?? []),
  ].map(canonicalizeResourceUrl));
  const pendingIds = new Set((state.source_architect_decision.pendingReads ?? []).map(read => read.resourceId));
  const artifacts: VisualSourceArtifact[] = [
    ...(coverage?.moodle.artifacts ?? []).map((artifact) => {
      const resource = resourcesByPath.get(path.resolve(artifact));
      return {
        path: artifact,
        resourceId: resource?.id ?? null,
        sourceName: "moodle" as const,
        sourceUrl: resource?.originUrl ?? coverage?.moodle.urls[0] ?? coverage?.moodle.lastUrl ?? null,
        sectionPath: resource?.sectionPath ?? [],
      };
    }),
    ...(coverage?.cis.artifacts ?? []).map((artifact) => {
      const resource = resourcesByPath.get(path.resolve(artifact));
      return {
        path: artifact,
        resourceId: resource?.id ?? null,
        sourceName: "cis" as const,
        sourceUrl: resource?.originUrl ?? coverage?.cis.urls[0] ?? coverage?.cis.lastUrl ?? null,
        sectionPath: resource?.sectionPath ?? [],
      };
    }),
    ...state.resource_manifest.resources.filter(resource => resource.localPath && pendingIds.has(resource.id) &&
      assigned.has(canonicalizeResourceUrl(resource.originUrl))).map(resource => ({
        path: resource.localPath!, resourceId: resource.id, sourceName: "moodle" as const,
        sourceUrl: resource.originUrl, sectionPath: resource.sectionPath,
      })),
  ];
  const seen = new Set<string>();
  return artifacts.filter(artifact => {
    const resource = resourcesByPath.get(path.resolve(artifact.path));
    if (resource && (resource.selection?.selected === false || resource.status === "skipped" ||
      isResourceFailureStatus(resource.status) || excluded.has(canonicalizeResourceUrl(resource.originUrl)))) return false;
    const key = path.resolve(artifact.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

async function renderRelevantPdfPages(input: {
  config: MoodleRuntimeConfig;
  pdfPath: string;
  resourceId: string | null;
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
      await trimRasterWhitespace(absolutePath, true).catch(() => false);
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
      source_id: input.resourceId,
      source_url: input.sourceUrl,
      source_path: input.pdfPath,
      source_page: rankedPage.page,
      confidence: plannerHit ? Math.min(0.82, rankedPage.score + 0.08) : Math.min(0.72, rankedPage.score),
      caption_hint: `${plannerHit ? "Visual-Planner-Treffer. " : ""}${input.sourceName.toUpperCase()}-PDF ${path.basename(input.pdfPath)}, Seite ${rankedPage.page}: ${rankedPage.hint}`,
      relevance_reason: plannerHit
        ? "Vom Visual Planner angeforderte, vollständig gerenderte PDF-Seitenkomposition mit Text-/Vektor-Overlays."
        : "Vollständig gerenderte PDF-Seitenkomposition; bewahrt Text-/Vektor-Overlays, Masken und Clipping.",
      generation_prompt: null,
    });
  }
  return candidates;
}

async function copyImageArtifact(input: {
  config: MoodleRuntimeConfig;
  imagePath: string;
  resourceId: string | null;
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
    source_id: input.resourceId,
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

async function trimRasterWhitespace(imagePath: string, preserveComposition = false): Promise<RasterTrimResult> {
  const before = await imageDimensions(imagePath);
  const extension = path.extname(imagePath);
  const temporaryPath = `${imagePath.slice(0, -extension.length)}.trimmed${extension}`;
  const result = await runCommand("magick", [
    imagePath,
    ...(preserveComposition ? ["-bordercolor", "white", "-border", "1x1"] : []),
    "-fuzz",
    preserveComposition ? "0%" : "4%",
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
  return runBoundedProcess(command, args);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
