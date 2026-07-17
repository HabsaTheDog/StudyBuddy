import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { WebLayoutRuntimeConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const SOURCE_DIR_NAME = "source";
const BUILD_DIR_NAME = ".build";
const IMAGE_REFERENCE_PATTERN = /\b(?:src|poster)\s*=\s*(["'])([^"']+)\1|url\(\s*(["']?)([^"')]+)\3\s*\)/gi;
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".jfif", ".webp", ".gif", ".svg",
  ".avif", ".bmp", ".tif", ".tiff", ".heic", ".heif",
]);
const BROWSER_SAFE_IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif",
]);

export interface WebLayoutMediaAsset {
  id: string;
  originalReference: string;
  sourcePath: string;
  relativePath: string;
  mimeType: string;
  originalBytes: number;
  optimizedBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  estimatedDecodedBytes: number;
  convertedToWebp: boolean;
}

export interface WebLayoutArtifactReport {
  sourceBundlePath: string;
  mediaManifestPath: string;
  buildPath: string;
  artifactBytes: number;
  embeddedAssetBytes: number;
  base64PayloadBytes: number;
  estimatedDecodedImageBytes: number;
  maxArtifactBytes: number;
  sizeClass: "normal" | "large" | "very-large";
  warnings: string[];
  assets: WebLayoutMediaAsset[];
}

export interface PreparedWebLayoutArtifact {
  report: WebLayoutArtifactReport;
  validationHtml: string;
}

interface SourceAsset {
  reference: string;
  sourcePath: string;
  mimeType: string;
  bytes: number;
}

export async function prepareWebLayoutArtifact(
  generatedHtml: string,
  config: WebLayoutRuntimeConfig,
): Promise<PreparedWebLayoutArtifact> {
  const sourceDir = path.join(config.runDir, SOURCE_DIR_NAME);
  const sourceAssetsDir = path.join(sourceDir, "assets");
  const buildDir = path.join(config.runDir, BUILD_DIR_NAME);
  const buildPath = path.join(buildDir, "document.html");
  await rm(sourceAssetsDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(sourceAssetsDir, { recursive: true }),
    mkdir(buildDir, { recursive: true }),
  ]);

  const references = [...new Set(collectImageReferences(generatedHtml))];
  const assets: WebLayoutMediaAsset[] = [];
  let readableHtml = generatedHtml;
  for (const reference of references) {
    const source = await resolveSourceAsset(reference, config, buildDir);
    if (!source) continue;
    const optimized = await optimizeSourceAsset(source, sourceAssetsDir, config);
    assets.push(optimized);
    readableHtml = replaceAllLiteral(readableHtml, reference, optimized.relativePath);
  }
  readableHtml = addLazyImageHints(readableHtml);

  const sourceBundle = splitEditableSource(readableHtml);
  await Promise.all([
    writeFile(path.join(sourceDir, "index.html"), sourceBundle.html, "utf8"),
    writeFile(path.join(sourceDir, "styles.css"), sourceBundle.css, "utf8"),
    writeFile(path.join(sourceDir, "app.js"), sourceBundle.js, "utf8"),
  ]);

  const bundle = await bundleWebLayoutSource({
    sourceDir,
    outputPath: buildPath,
    maxArtifactBytes: config.maxArtifactBytes,
  });
  const embeddedAssetBytes = assets.reduce((sum, asset) => sum + asset.optimizedBytes, 0);
  const estimatedDecodedImageBytes = assets.reduce(
    (sum, asset) => sum + asset.estimatedDecodedBytes,
    0,
  );
  const warnings = sizeWarnings(bundle.artifactBytes, estimatedDecodedImageBytes);
  const mediaManifestPath = path.join(config.runDir, "media-manifest.json");
  const report: WebLayoutArtifactReport = {
    sourceBundlePath: sourceDir,
    mediaManifestPath,
    buildPath,
    artifactBytes: bundle.artifactBytes,
    embeddedAssetBytes,
    base64PayloadBytes: bundle.base64PayloadBytes,
    estimatedDecodedImageBytes,
    maxArtifactBytes: config.maxArtifactBytes,
    sizeClass: sizeClass(bundle.artifactBytes),
    warnings,
    assets,
  };
  await writeFile(mediaManifestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    report,
    validationHtml: createValidationProjection(readableHtml),
  };
}

export async function bundleWebLayoutSource(input: {
  sourceDir: string;
  outputPath: string;
  maxArtifactBytes: number;
}): Promise<{ artifactBytes: number; base64PayloadBytes: number }> {
  const [indexHtml, css, js] = await Promise.all([
    readFile(path.join(input.sourceDir, "index.html"), "utf8"),
    readFile(path.join(input.sourceDir, "styles.css"), "utf8").catch(() => ""),
    readFile(path.join(input.sourceDir, "app.js"), "utf8").catch(() => ""),
  ]);
  let template = inlineEditableSource(indexHtml, css, js);
  const localReferences = collectImageReferences(template)
    .filter(isLocalImageReference);
  const uniqueReferences = [...new Set(localReferences)];
  const replacements: Array<{
    marker: string;
    filePath: string;
    prefix: string;
    base64Bytes: number;
    occurrences: number;
  }> = [];
  for (const [index, reference] of uniqueReferences.entries()) {
    const filePath = ensureInside(input.sourceDir, path.resolve(input.sourceDir, stripQuery(reference)));
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new Error(`Source bundle references a missing image asset: ${reference}`);
    }
    const marker = `__STUDY_BUDDY_ASSET_${index}__`;
    const occurrences = countOccurrences(template, reference);
    template = replaceAllLiteral(template, reference, marker);
    replacements.push({
      marker,
      filePath,
      prefix: `data:${mimeTypeForPath(filePath)};base64,`,
      base64Bytes: base64Length(fileStat.size),
      occurrences,
    });
  }

  const templateBytes = Buffer.byteLength(template);
  const base64PayloadBytes = replacements.reduce(
    (sum, item) => sum + item.base64Bytes * item.occurrences,
    0,
  );
  const artifactBytes = replacements.reduce(
    (sum, item) => sum + (Buffer.byteLength(item.prefix) + item.base64Bytes - Buffer.byteLength(item.marker)) * item.occurrences,
    templateBytes,
  );
  if (artifactBytes > input.maxArtifactBytes) {
    throw new Error(
      `Single-file artifact would be ${formatBytes(artifactBytes)}, exceeding the configured ${formatBytes(input.maxArtifactBytes)} limit. ` +
      "Reduce or link non-essential media; Study Buddy will never emit a document above the configured limit.",
    );
  }

  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const temporaryPath = `${input.outputPath}.tmp`;
  await rm(temporaryPath, { force: true });
  const output = createWriteStream(temporaryPath, { flags: "wx" });
  try {
    const markerPattern = /__STUDY_BUDDY_ASSET_(\d+)__/g;
    let offset = 0;
    for (const match of template.matchAll(markerPattern)) {
      await writeChunk(output, template.slice(offset, match.index));
      const replacement = replacements[Number(match[1])];
      if (!replacement) throw new Error(`Unknown bundle asset marker: ${match[0]}`);
      await writeChunk(output, replacement.prefix);
      await writeFileAsBase64(output, replacement.filePath);
      offset = (match.index ?? 0) + match[0].length;
    }
    await writeChunk(output, template.slice(offset));
    await endStream(output);
    await rename(temporaryPath, input.outputPath);
  } catch (error) {
    output.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { artifactBytes, base64PayloadBytes };
}

async function resolveSourceAsset(
  reference: string,
  config: WebLayoutRuntimeConfig,
  buildDir: string,
): Promise<SourceAsset | null> {
  if (/^data:image\//i.test(reference)) {
    const parsed = parseImageDataUri(reference);
    const extension = extensionForMime(parsed.mimeType);
    const hash = createHash("sha256").update(parsed.buffer).digest("hex").slice(0, 12);
    const sourcePath = path.join(buildDir, `inline-${hash}${extension}`);
    await writeFile(sourcePath, parsed.buffer);
    return { reference, sourcePath, mimeType: parsed.mimeType, bytes: parsed.buffer.length };
  }
  if (!isLocalImageReference(reference)) return null;

  const cleanReference = stripQuery(reference);
  const explicitAssets = new Map<string, string>();
  for (const assetPath of config.assetFiles) {
    explicitAssets.set(path.basename(assetPath), assetPath);
    explicitAssets.set(`assets/${path.basename(assetPath)}`, assetPath);
    explicitAssets.set(path.resolve(assetPath), assetPath);
  }
  const candidates = [
    explicitAssets.get(cleanReference),
    explicitAssets.get(path.basename(cleanReference)),
    path.isAbsolute(cleanReference) ? cleanReference : undefined,
    config.sourceRunDir ? path.resolve(config.sourceRunDir, cleanReference) : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!isAllowedSourcePath(candidate, config)) continue;
    const fileStat = await stat(candidate).catch(() => null);
    if (fileStat?.isFile()) {
      return {
        reference,
        sourcePath: candidate,
        mimeType: mimeTypeForPath(candidate),
        bytes: fileStat.size,
      };
    }
  }
  throw new Error(
    `Generated source references an image that is not an approved local asset: ${reference}. ` +
    "Use a visual_assets.relative_path from the Moodle handoff or pass the file with --asset.",
  );
}

function isAllowedSourcePath(candidate: string, config: WebLayoutRuntimeConfig): boolean {
  const resolved = path.resolve(candidate);
  if (config.assetFiles.some((asset) => path.resolve(asset) === resolved)) return true;
  return config.sourceRunDir ? isInside(path.resolve(config.sourceRunDir), resolved) : false;
}

async function optimizeSourceAsset(
  source: SourceAsset,
  outputDir: string,
  config: WebLayoutRuntimeConfig,
): Promise<WebLayoutMediaAsset> {
  const sourceBuffer = await readFile(source.sourcePath);
  const hash = createHash("sha256").update(sourceBuffer).digest("hex").slice(0, 12);
  const originalExtension = path.extname(source.sourcePath).toLowerCase() || extensionForMime(source.mimeType);
  const safeBase = safeFileName(path.basename(source.sourcePath, originalExtension));
  const originalOutput = path.join(outputDir, `${safeBase}-${hash}${originalExtension}`);
  await copyFile(source.sourcePath, originalOutput);

  let selectedPath = originalOutput;
  let selectedMime = source.mimeType;
  let convertedToWebp = false;
  const canConvert = source.mimeType !== "image/svg+xml" && await hasImageMagick();
  if (canConvert) {
    const webpPath = path.join(outputDir, `${safeBase}-${hash}.webp`);
    const args = [
      source.sourcePath,
      "-auto-orient",
      "-strip",
      "-resize",
      `${config.maxImageWidth}x>`,
      ...(source.mimeType === "image/png"
        ? ["-define", "webp:lossless=true"]
        : ["-quality", String(config.webpQuality), "-define", "webp:method=4"]),
      webpPath,
    ];
    await execFileAsync("magick", args, { maxBuffer: 4 * 1024 * 1024 }).catch(() => null);
    const [webpStat, originalStat] = await Promise.all([
      stat(webpPath).catch(() => null),
      stat(originalOutput),
    ]);
    if (
      webpStat?.isFile() &&
      (webpStat.size < originalStat.size * 0.98 || !BROWSER_SAFE_IMAGE_MIMES.has(source.mimeType))
    ) {
      selectedPath = webpPath;
      selectedMime = "image/webp";
      convertedToWebp = true;
      await rm(originalOutput, { force: true });
    } else {
      await rm(webpPath, { force: true });
    }
  }
  if (!BROWSER_SAFE_IMAGE_MIMES.has(selectedMime)) {
    throw new Error(
      `Image ${source.sourcePath} uses ${source.mimeType}, which requires ImageMagick WebP conversion for offline browser use.`,
    );
  }
  const selectedStat = await stat(selectedPath);
  const dimensions = await imageDimensions(selectedPath).catch(() => null);
  const relativePath = path.posix.join("assets", path.basename(selectedPath));
  return {
    id: `media-${hash}`,
    originalReference: source.reference,
    sourcePath: source.sourcePath,
    relativePath,
    mimeType: selectedMime,
    originalBytes: source.bytes,
    optimizedBytes: selectedStat.size,
    widthPx: dimensions?.width ?? null,
    heightPx: dimensions?.height ?? null,
    estimatedDecodedBytes: dimensions ? dimensions.width * dimensions.height * 4 : 0,
    convertedToWebp,
  };
}

let imageMagickAvailable: boolean | undefined;
async function hasImageMagick(): Promise<boolean> {
  if (imageMagickAvailable !== undefined) return imageMagickAvailable;
  imageMagickAvailable = await execFileAsync("magick", ["-version"], { maxBuffer: 1024 * 1024 })
    .then(() => true)
    .catch(() => false);
  return imageMagickAvailable;
}

async function imageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  if (!await hasImageMagick()) throw new Error("ImageMagick unavailable");
  const { stdout } = await execFileAsync(
    "magick",
    ["identify", "-format", "%w %h", filePath],
    { maxBuffer: 1024 * 1024 },
  );
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("Invalid image dimensions");
  return { width, height };
}

function splitEditableSource(html: string): { html: string; css: string; js: string } {
  const styles: string[] = [];
  let styleInserted = false;
  let sourceHtml = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, content: string) => {
    styles.push(content.trim());
    if (styleInserted) return "";
    styleInserted = true;
    return '<link rel="stylesheet" href="styles.css">';
  });
  const scripts: string[] = [];
  let scriptInserted = false;
  sourceHtml = sourceHtml.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attributes: string, content: string) => {
    if (/\bsrc\s*=|\btype\s*=\s*["'](?:application\/(?:json|ld\+json)|text\/plain)/i.test(attributes)) {
      return match;
    }
    scripts.push(content.trim());
    if (scriptInserted) return "";
    scriptInserted = true;
    return '<script src="app.js"></script>';
  });
  return {
    html: `${sourceHtml.trim()}\n`,
    css: styles.length ? `${styles.join("\n\n")}\n` : "",
    js: scripts.length ? `${scripts.join("\n\n")}\n` : "",
  };
}

function inlineEditableSource(indexHtml: string, css: string, js: string): string {
  return indexHtml
    .replace(/<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']styles\.css["'])[^>]*>/i, `<style>\n${css}</style>`)
    .replace(/<script\b(?=[^>]*\bsrc=["']app\.js["'])[^>]*>\s*<\/script>/i, `<script>\n${js}</script>`);
}

function createValidationProjection(html: string): string {
  let projection = html;
  for (const reference of collectImageReferences(html).filter(isLocalImageReference)) {
    projection = replaceAllLiteral(projection, reference, "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
  }
  return projection;
}

function collectImageReferences(html: string): string[] {
  const references: string[] = [];
  for (const match of html.matchAll(IMAGE_REFERENCE_PATTERN)) {
    const value = (match[2] ?? match[4] ?? "").trim();
    if (!value || value.startsWith("#")) continue;
    if (/^data:/i.test(value) && !/^data:image\//i.test(value)) continue;
    if (/^https?:/i.test(value) || /^\/\//.test(value) || /^data:image\//i.test(value) || isImagePath(value)) {
      references.push(value);
    }
  }
  return references;
}

function isLocalImageReference(value: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value) && isImagePath(value);
}

function isImagePath(value: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(stripQuery(value)).toLowerCase());
}

function addLazyImageHints(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (tag, attributes: string) => {
    let updated = attributes;
    if (!/\bloading\s*=/i.test(updated)) updated += ' loading="lazy"';
    if (!/\bdecoding\s*=/i.test(updated)) updated += ' decoding="async"';
    return `<img${updated}>`;
  });
}

function parseImageDataUri(value: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) throw new Error("Only Base64 image data URIs can be extracted into the editable source bundle.");
  return { mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

function sizeWarnings(artifactBytes: number, decodedBytes: number): string[] {
  const warnings: string[] = [];
  if (artifactBytes >= 100_000_000) {
    warnings.push(`Large offline artifact (${formatBytes(artifactBytes)}); validate transfer and opening on representative phones.`);
  }
  if (artifactBytes >= 250_000_000) {
    warnings.push("Very large single-file artifact; mobile browser memory limits may prevent opening on some devices.");
  }
  if (decodedBytes >= 500_000_000) {
    warnings.push(`Estimated decoded raster memory is ${formatBytes(decodedBytes)}; images are lazy-loaded to limit concurrent decoding.`);
  }
  return warnings;
}

function sizeClass(bytes: number): WebLayoutArtifactReport["sizeClass"] {
  return bytes >= 250_000_000 ? "very-large" : bytes >= 100_000_000 ? "large" : "normal";
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(stripQuery(filePath)).toLowerCase();
  const values: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".jfif": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".heic": "image/heic",
    ".heif": "image/heif",
  };
  const mimeType = values[extension];
  if (!mimeType) throw new Error(`Unsupported image extension: ${extension || filePath}`);
  return mimeType;
}

function extensionForMime(mimeType: string): string {
  const values: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };
  const extension = values[mimeType];
  if (!extension) throw new Error(`Unsupported image MIME type: ${mimeType}`);
  return extension;
}

function ensureInside(root: string, target: string): string {
  if (!isInside(path.resolve(root), path.resolve(target))) {
    throw new Error(`Asset path escapes the source bundle: ${target}`);
  }
  return target;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stripQuery(value: string): string {
  return value.split(/[?#]/, 1)[0];
}

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function countOccurrences(value: string, search: string): number {
  return search ? value.split(search).length - 1 : 0;
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "image";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

async function writeFileAsBase64(output: ReturnType<typeof createWriteStream>, filePath: string): Promise<void> {
  let remainder = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    const buffer = remainder.length ? Buffer.concat([remainder, chunk as Buffer]) : chunk as Buffer;
    const completeLength = buffer.length - (buffer.length % 3);
    if (completeLength > 0) {
      await writeChunk(output, buffer.subarray(0, completeLength).toString("base64"));
    }
    remainder = Buffer.from(buffer.subarray(completeLength));
  }
  if (remainder.length) await writeChunk(output, remainder.toString("base64"));
}

async function writeChunk(output: ReturnType<typeof createWriteStream>, value: string): Promise<void> {
  if (!value) return;
  if (output.write(value)) return;
  await new Promise<void>((resolve, reject) => {
    output.once("drain", resolve);
    output.once("error", reject);
  });
}

async function endStream(output: ReturnType<typeof createWriteStream>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
    output.end();
  });
}
