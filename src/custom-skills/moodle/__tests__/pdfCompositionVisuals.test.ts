import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { runBoundedProcess } from "../../shared/boundedProcess.js";
import { RunDiagnostics } from "../runDiagnostics.js";
import { copyRenderVisualAssets, discoverVisualCandidates, hydrateExtractedVisualAssets, readVisualManifest, type VisualCandidate } from "../visualAssets.js";
import { moodleExtractedData, moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

async function command(binary: string, args: string[]) {
  const result = await runBoundedProcess(binary, args, { timeoutMs: 30_000 });
  expect(result.code, result.stderr).toBe(0);
  return result;
}

// A real PDF image object without an optional graphics-tool dependency.
function redRasterPng(width: number, height: number): Buffer {
  const chunk = (type: string, content: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), content]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) pixels[row * (width * 3 + 1) + 1 + column * 3] = 255;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

const hasMagick = await runBoundedProcess("magick", ["-version"], { timeoutMs: 5_000 }).then(result => result.code === 0, () => false);

function candidate(runDir: string, overrides: Partial<VisualCandidate> = {}): VisualCandidate {
  return { id: "composite", kind: "moodle_pdf_page", title: "Source page", relative_path: "assets/visuals/composite.png",
    mime_type: "image/png", width_px: 1200, height_px: 800, source_id: "source", source_path: path.join(runDir, "sources", "source.pdf"),
    source_url: "https://example.edu/source.pdf", source_page: 1, confidence: .9, caption_hint: "Source context", relevance_reason: "Requested source", generation_prompt: null,
    ...overrides };
}

async function overlayFixture(runDir: string) {
  const sourceDir = path.join(runDir, "sources");
  await mkdir(sourceDir, { recursive: true });
  const rawPath = path.join(sourceDir, "old.png");
  await writeFile(rawPath, redRasterPng(1200, 800));
  const typstPath = path.join(sourceDir, "source.typ");
  await writeFile(typstPath, `#set page(width: 600pt, height: 400pt, margin: 0pt)
#place(top + left, image("old.png", width: 600pt, height: 400pt))
#place(top + left, dx: 60pt, dy: 160pt, rect(width: 480pt, height: 90pt, fill: white, stroke: none)[CORRECTED SOURCE])
#place(top + left, dx: 60pt, dy: 385pt, rect(width: 480pt, height: 10pt, fill: blue, stroke: none))
`);
  const pdfPath = path.join(sourceDir, "source.pdf");
  await command("typst", ["compile", typstPath, pdfPath]);
  const composedPath = path.join(sourceDir, "reference.png");
  await command("pdftoppm", ["-png", "-singlefile", "-f", "1", "-l", "1", "-r", "144", pdfPath, composedPath.slice(0, -4)]);
  return { pdfPath, rawPath, composedPath };
}

describe("composition-preserving PDF visuals", () => {
  it("publishes the rendered composition rather than its underlying raster XObject", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-pdf-composition-"));
    try {
      const { pdfPath, rawPath, composedPath } = await overlayFixture(runDir);
      // Prove the fixture actually has the hazardous separately extractable image.
      const extracted = path.join(runDir, "xobject");
      await command("pdfimages", ["-png", pdfPath, extracted]);
      expect((await command("pdfimages", ["-list", pdfPath])).stdout).toMatch(/image\s+1200\s+800/);
      expect((await readFile(`${extracted}-000.png`)).length).toBeGreaterThan(0);
      await writeFile(path.join(runDir, "visual-retrieval-plan.json"), JSON.stringify({ schemaVersion: "1.0", strategy: "Inspect selected source page",
        requests: [{ resourceId: "source", pages: [1], purpose: "diagram", priority: "high", placementHint: "Source method", reason: "Selected source diagram" }] }));
      const state = moodleTestState();
      state.resource_manifest.resources = [{ ...candidate(runDir), id: "source", activityType: "resource", originUrl: "https://example.edu/source.pdf", localPath: pdfPath,
        parentId: null, sectionPath: [], resolvedUrl: null, previewPath: null, checksum: null, verifiedAt: null, examRelevance: "confirmed", failureReason: null, status: "acquired" }];
      const diagnostics = new RunDiagnostics({ runDir });
      await diagnostics.init();
      await diagnostics.updateCoverage("moodle", { status: "success", detail: "Downloaded selected source PDF.", urls: ["https://example.edu/source.pdf"], pages: 1, artifacts: [pdfPath] });
      const manifest = await discoverVisualCandidates(moodleTestConfig({ runDir, diagnostics, visualMinConfidence: 0, prompt: "Explain the selected source diagram." }), state);
      expect(manifest.candidates.map(c => c.kind)).toEqual(["moodle_pdf_page"]);
      expect((await readFile(path.join(runDir, manifest.candidates[0].relative_path))).equals(await readFile(composedPath))).toBe(true);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  for (const mode of ["auto", "focused", "context", "original"] as const) it.skipIf(mode !== "original" && !hasMagick)(`keeps overlays at the page edge intact in ${mode} mode`, async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-pdf-edge-"));
    try {
      const { composedPath } = await overlayFixture(runDir);
      const asset = candidate(runDir);
      await mkdir(path.join(runDir, "assets/visuals"), { recursive: true });
      await writeFile(path.join(runDir, asset.relative_path), await readFile(composedPath));
      const renderDir = path.join(runDir, "render");
      await copyRenderVisualAssets(runDir, renderDir, moodleExtractedData({ visual_assets: [asset] }), mode);
      expect((await readFile(path.join(renderDir, asset.relative_path))).equals(await readFile(composedPath))).toBe(true);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("rebinds an existing legacy raw PDF path only to the identical source and explicit page", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-pdf-legacy-"));
    try {
      await mkdir(path.join(runDir, "assets/visuals"), { recursive: true });
      const raw = candidate(runDir, { id: "legacy", kind: "moodle_pdf_image", relative_path: "assets/visuals/old-embedded-page-1-000.png" });
      await writeFile(path.join(runDir, raw.relative_path), "legacy existing raster");
      const composed = candidate(runDir);
      await writeFile(path.join(runDir, composed.relative_path), "actual page composition");
      const foreign = candidate(runDir, { id: "foreign", source_id: "foreign", source_url: "https://foreign.edu/source.pdf", source_path: "/foreign/source.pdf", relative_path: "assets/visuals/foreign.png" });
      const unknownPage = candidate(runDir, { id: "unknown-page", source_page: null });
      const wrongPage = candidate(runDir, { id: "wrong-page", source_page: 2 });
      const writeManifest = (candidates: VisualCandidate[]) => writeFile(path.join(runDir, "visual-candidates.json"), JSON.stringify({ tooling: {}, warnings: [], candidates }));
      await writeManifest([raw, foreign, unknownPage, wrongPage, composed]);
      const data = moodleExtractedData({ visual_assets: [raw] });
      const hydrated = await hydrateExtractedVisualAssets(runDir, data, "focused");
      expect(hydrated.visual_assets[0]).toMatchObject({ id: "legacy", kind: "moodle_pdf_page", source_page: 1, relative_path: composed.relative_path });
      expect((await readVisualManifest(runDir))!.candidates.map(c => c.id)).not.toContain("legacy");
      await writeManifest([raw, foreign, unknownPage, wrongPage]);
      const unresolved = await hydrateExtractedVisualAssets(runDir, data);
      expect(unresolved.visual_assets[0].relative_path).toBeNull();
      expect(unresolved.warnings.join(" ")).toContain("legacy");
      await expect(copyRenderVisualAssets(runDir, path.join(runDir, "unsafe-render"), data)).rejects.toThrow(/composition/i);
      const missingProvenance = moodleExtractedData({ visual_assets: [{ ...raw, source_path: null, source_page: null, source_url: null }] });
      expect((await hydrateExtractedVisualAssets(runDir, missingProvenance)).visual_assets[0].relative_path).toBeNull();
      await expect(copyRenderVisualAssets(runDir, path.join(runDir, "unknown-render"), missingProvenance)).rejects.toThrow(/composition/i);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("keeps standalone image files available and rejects legacy CIS raw PDF objects", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-standalone-visual-"));
    try {
      const standalone = candidate(runDir, { id: "image", kind: "moodle_pdf_image", source_path: "/sources/image.png", source_page: null });
      const cisRaw = candidate(runDir, { id: "cis-raw", kind: "cis_page_screenshot", relative_path: "assets/visuals/source-embedded-page-1-001-000.png" });
      const legacyStandalone = { ...standalone, id: "legacy-image", source_page: undefined };
      const namedStandalone = { ...standalone, id: "named-image", source_path: "/sources/foo-embedded-page-1-001.jpg", relative_path: "assets/visuals/foo-embedded-page-1-001.jpg" };
      const cisPage = candidate(runDir, { id: "cis-page", kind: "cis_page_screenshot" });
      await writeFile(path.join(runDir, "visual-candidates.json"), JSON.stringify({ tooling: {}, warnings: [], candidates: [standalone, legacyStandalone, namedStandalone, cisRaw, cisPage] }));
      expect((await readVisualManifest(runDir))!.candidates.map(c => c.id)).toEqual(["image", "legacy-image", "named-image", "cis-page"]);
      await mkdir(path.join(runDir, "assets/visuals"), { recursive: true });
      await writeFile(path.join(runDir, namedStandalone.relative_path), "direct image bytes");
      const direct = moodleExtractedData({ visual_assets: [namedStandalone] });
      expect((await hydrateExtractedVisualAssets(runDir, direct)).visual_assets[0].relative_path).toBe(namedStandalone.relative_path);
      await copyRenderVisualAssets(runDir, path.join(runDir, "direct-render"), direct);
      expect(await readFile(path.join(runDir, "direct-render", namedStandalone.relative_path), "utf8")).toBe("direct image bytes");
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });
});
