import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";
import { initialAgentState } from "../state.js";
import { ResourceManifestSchema } from "../examNavigatorContracts.js";
import { discoverVisualCandidates, hydrateExtractedVisualAssets } from "../visualAssets.js";
import { moodleExtractedData, moodleTestConfig } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("visual asset discovery", () => {
  it("turns Moodle image artifacts into managed visual candidates", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visuals-"));
    const sourcesDir = path.join(runDir, "sources");
    await mkdir(sourcesDir, { recursive: true });
    const sourceImage = path.join(sourcesDir, "schaltung.svg");
    await writeFile(
      sourceImage,
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="white"/><path d="M10 25 H90" stroke="black"/></svg>`,
      "utf8",
    );
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    await diagnostics.updateCoverage("moodle", {
      status: "success",
      detail: "Downloaded source image.",
      urls: ["https://moodle.example/course"],
      pages: 1,
      artifacts: [sourceImage],
    });

    const manifest = await discoverVisualCandidates(
      moodleTestConfig({
        runDir,
        diagnostics,
        prompt: "Erstelle ein Elektrotechnik Lern-PDF mit Schaltung und Messaufbau",
      }),
      {
        ...initialAgentState,
        moodle_raw_text: "Schaltung Messaufbau Spannung Strom",
        resource_manifest: ResourceManifestSchema.parse({
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [{
            id: "res-schaltung",
            parentId: null,
            sectionPath: ["Schaltungen"],
            activityType: "resource",
            title: "Schaltung",
            originUrl: "https://moodle.example/resource",
            resolvedUrl: null,
            localPath: sourceImage,
            previewPath: sourceImage,
            status: "acquired",
            checksum: null,
            verifiedAt: new Date().toISOString(),
            examRelevance: "unknown",
            failureReason: null,
          }],
        }),
      },
    );

    expect(manifest.candidates).toHaveLength(1);
    expect(manifest.candidates[0]).toMatchObject({
      kind: "moodle_pdf_image",
      relative_path: expect.stringMatching(/^assets\/visuals\//),
      source_id: "res-schaltung",
      confidence: expect.any(Number),
    });
    await expect(readFile(path.join(runDir, manifest.candidates[0].relative_path), "utf8")).resolves.toContain("<svg");
  });

  it("hydrates a selected analyzer figure from the persisted visual candidates", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-hydration-"));
    await writeFile(path.join(runDir, "visual-candidates.json"), JSON.stringify({
      tooling: { pdfinfo: true, pdftotext: true, pdftoppm: true, pdfimages: true, magick: true },
      warnings: [],
      candidates: [{
        id: "fig-002",
        kind: "moodle_pdf_page",
        title: "kleben.pdf Seite 2",
        relative_path: "assets/visuals/kleben-page-2.png",
        mime_type: "image/png",
        width_px: 1200,
        height_px: 900,
        source_id: "res-kleben",
        source_url: "https://moodle.example/resource",
        source_path: path.join(runDir, "sources", "kleben.pdf"),
        source_page: 2,
        confidence: 0.9,
        caption_hint: "Klebformen und Nachweisgleichungen",
        relevance_reason: "Source figure",
        generation_prompt: null,
      }],
    }), "utf8");
    const hydrated = await hydrateExtractedVisualAssets(runDir, moodleExtractedData({
      visual_assets: [{
        id: "selected-kleben",
        kind: "moodle_pdf_page",
        title: "Klebformen und Nachweisgleichungen",
        relative_path: null,
        mime_type: "image/png",
        width_px: null,
        height_px: null,
        source_id: "res-kleben",
        source_url: "https://moodle.example/resource",
        source_path: "/older/run/sources/kleben.pdf",
        source_page: 2,
        confidence: 0.9,
        caption_hint: "Klebformen und Nachweisgleichungen",
        relevance_reason: "Useful geometry",
        generation_prompt: null,
      }],
    }));

    expect(hydrated.visual_assets[0]).toMatchObject({
      relative_path: "assets/visuals/kleben-page-2.png",
      width_px: 1200,
      height_px: 900,
      source_id: "res-kleben",
    });
  });

  it("prefers the extracted graphic in focused mode and the page body in context mode", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-strategy-"));
    const sourcePath = path.join(runDir, "sources", "tribologie.pdf");
    const candidates = [
      {
        id: "fig-page",
        kind: "moodle_pdf_page",
        title: "tribologie.pdf Seite 9",
        relative_path: "assets/visuals/tribologie-page-9.png",
        mime_type: "image/png",
        width_px: 1300,
        height_px: 1000,
        source_id: "res-tribologie",
        source_url: "https://moodle.example/resource",
        source_path: sourcePath,
        source_page: 9,
        confidence: 0.9,
        caption_hint: "Viskosität",
        relevance_reason: "Page",
        generation_prompt: null,
      },
      {
        id: "fig-embedded",
        kind: "moodle_pdf_image",
        title: "tribologie.pdf – eingebettete Abbildung",
        relative_path: "assets/visuals/tribologie-viscosity-table.png",
        mime_type: "image/png",
        width_px: 600,
        height_px: 900,
        source_id: "res-tribologie",
        source_url: "https://moodle.example/resource",
        source_path: sourcePath,
        source_page: 9,
        confidence: 0.82,
        caption_hint: "Originalabbildung",
        relevance_reason: "Embedded",
        generation_prompt: null,
      },
    ];
    await writeFile(path.join(runDir, "visual-candidates.json"), JSON.stringify({
      tooling: { pdfinfo: true, pdftotext: true, pdftoppm: true, pdfimages: true, magick: true },
      warnings: [],
      candidates,
    }), "utf8");
    const selected = moodleExtractedData({
      visual_assets: [{
        id: "viscosity",
        kind: "moodle_pdf_page",
        title: "Viskositätsklassifikation",
        relative_path: null,
        mime_type: "image/png",
        width_px: null,
        height_px: null,
        source_id: "res-tribologie",
        source_url: "https://moodle.example/resource",
        source_path: sourcePath,
        source_page: 9,
        confidence: 0.9,
        caption_hint: "Vergleichstabelle der Viskositätsklassen",
        relevance_reason: "Useful table",
        generation_prompt: null,
      }],
    });

    const focused = await hydrateExtractedVisualAssets(runDir, selected, "focused");
    const context = await hydrateExtractedVisualAssets(runDir, selected, "context");

    expect(focused.visual_assets[0]).toMatchObject({
      kind: "moodle_pdf_image",
      relative_path: "assets/visuals/tribologie-viscosity-table.png",
    });
    expect(context.visual_assets[0]).toMatchObject({
      kind: "moodle_pdf_page",
      relative_path: "assets/visuals/tribologie-page-9.png",
    });
  });

  it("does not silently replace a planned Typst diagram with a full PDF page", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-diagram-"));
    await writeFile(path.join(runDir, "visual-candidates.json"), JSON.stringify({
      tooling: { pdfinfo: true, pdftotext: true, pdftoppm: true, pdfimages: true, magick: true },
      warnings: [],
      candidates: [{
        id: "fig-page",
        kind: "moodle_pdf_page",
        title: "solution.pdf Seite 1",
        relative_path: "assets/visuals/solution-page-1.png",
        mime_type: "image/png",
        width_px: 1000,
        height_px: 1500,
        source_id: "res-solution",
        source_url: "https://moodle.example/resource",
        source_path: path.join(runDir, "sources", "solution.pdf"),
        source_page: 1,
        confidence: 0.9,
        caption_hint: "Solution page",
        relevance_reason: "Page",
        generation_prompt: null,
      }],
    }), "utf8");
    const data = moodleExtractedData({
      visual_assets: [{
        id: "diagram",
        kind: "typst_diagram",
        title: "Didaktisches Toleranzfeld",
        relative_path: null,
        mime_type: null,
        width_px: null,
        height_px: null,
        source_id: "res-solution",
        source_url: "https://moodle.example/resource",
        source_path: path.join(runDir, "sources", "solution.pdf"),
        source_page: 1,
        confidence: 0.9,
        caption_hint: "Eine eigens erzeugte Diagrammkomponente",
        relevance_reason: "Didactic diagram",
        generation_prompt: null,
      }],
    });

    const hydrated = await hydrateExtractedVisualAssets(runDir, data, "auto");
    expect(hydrated.visual_assets[0]).toMatchObject({
      kind: "typst_diagram",
      relative_path: null,
    });
  });
});
