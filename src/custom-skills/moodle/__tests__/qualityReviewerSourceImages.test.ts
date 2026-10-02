import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExtractedDataSchema } from "../schemas.js";
import { createAnalyzerNode } from "../nodes/analyzerNode.js";
import { createQualityReviewerNode } from "../nodes/qualityReviewerNode.js";
import { persistPendingExtractionRepairs } from "../pendingExtractionRepairs.js";
import { VISUAL_SOURCE_COMPOSITION_VERSION } from "../visualAssets.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

async function fixture() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "review-source-images-"));
  await mkdir(path.join(runDir, "assets/visuals"), { recursive: true });
  const urls = ["https://example.edu/a.pdf", "https://example.edu/b.pdf", "https://example.edu/excluded.pdf"];
  const state = moodleTestState();
  state.resource_manifest.resources = urls.map((url, i) => ({ id: `source-${i}`, title: `Native source ${i}`, originUrl: url, localPath: `/tmp/source-${i}.pdf`,
    parentId: null, sectionPath: [], activityType: "resource", resolvedUrl: null, previewPath: null, status: "acquired", checksum: null,
    verifiedAt: null, examRelevance: "unknown", failureReason: null }));
  state.source_architect_decision.learningArchitecture = { schemaVersion: 1, modules: [], supportResources: [], excludedResourceUrls: [urls[2]] };
  state.extracted_data = { document_title: "Guide", language: "en", course: { title: "Course", url: "https://example.edu/course" },
    sources: urls.map((url, i) => ({ id: `source-${i}`, title: `Native source ${i}`, url, kind: "pdf", path: `/tmp/source-${i}.pdf`, page: null })),
    sections: [], worked_examples: [], quiz_style_questions: [], visual_assets: [], warnings: [], learning_modules: [], document_context: [],
    figures: [{ asset_id: "a2", caption: "Source diagram", placement_hint: "Beside the formula", source_ids: ["source-0"] }],
    formulas: urls.map((_url, i) => ({ name: `Formula ${i}`, typst: "x = 1", variables: ["x: value"], units: ["dimensionless"], context: "Stated source method", source_ids: [`source-${i}`] })) };
  const candidates = [{ id: "a1", source: 0, page: 1 }, { id: "a2", source: 0, page: 2 }, { id: "b1", source: 1, page: 1 }, { id: "bad", source: 2, page: 1 }].map(item => ({
    id: item.id, kind: "moodle_pdf_page", compositionVersion: VISUAL_SOURCE_COMPOSITION_VERSION, title: `Original ${item.id}`, source_id: `source-${item.source}`,
    source_url: urls[item.source], source_path: `/tmp/source-${item.source}.pdf`, source_page: item.page, relative_path: `assets/visuals/${item.id}.png`,
    mime_type: "image/png", width_px: 1200, height_px: 900, confidence: .9, caption_hint: "Original composition" }));
  for (const candidate of candidates) await writeFile(path.join(runDir, candidate.relative_path), "nonempty existing image fixture");
  await writeFile(path.join(runDir, "visual-candidates.json"), JSON.stringify({ schemaVersion: "1.0", candidates, warnings: [], tooling: {} }));
  return { runDir, state };
}

describe("content review source compositions", () => {
  it("honors native source vetoes for URL-only candidates", async () => {
    const { runDir, state } = await fixture();
    try {
      state.resource_manifest.resources[0].selection = { selected: false, role: "primary_lecture", priority: 0, topic: null, reason: "Explicitly deselected" };
      const file = path.join(runDir, "visual-candidates.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      for (const candidate of manifest.candidates) if (candidate.source_id === "source-0") candidate.source_id = null;
      await writeFile(file, JSON.stringify(manifest));
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run(_prompt, options) {
        expect(options?.localImages).toEqual([path.join(runDir, "assets/visuals/b1.png")]);
        return JSON.stringify({ ok: true, summary: "Native veto honored", findings: [] });
      } })(state);
      expect(result.error_log).toBeNull();
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("omits unsupported original images without breaking the existing text review", async () => {
    const { runDir, state } = await fixture();
    try {
      const file = path.join(runDir, "visual-candidates.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.candidates.unshift({ ...manifest.candidates[0], id: "svg", relative_path: "assets/visuals/source.svg", mime_type: "image/svg+xml" });
      await writeFile(path.join(runDir, "assets/visuals/source.svg"), "<svg/>");
      await writeFile(file, JSON.stringify(manifest));
      const data = ExtractedDataSchema.parse(state.extracted_data);
      data.figures[0].asset_id = "svg";
      state.extracted_data = data;
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run(_prompt, options) {
        expect(options?.localImages).toHaveLength(2);
        expect(options?.localImages?.every(file => file.endsWith(".png"))).toBe(true);
        return JSON.stringify({ ok: true, summary: "Supported images only", findings: [] });
      } })(state);
      expect(result.error_log).toBeNull();
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("retains an explicitly selected source page after chapter asset IDs are namespaced", async () => {
    const { runDir, state } = await fixture();
    try {
      const data = ExtractedDataSchema.parse(state.extracted_data);
      data.figures[0].asset_id = "ch1_unit_a2";
      data.visual_assets = [{ id: "ch1_unit_a2", kind: "moodle_pdf_page", title: "Selected original diagram",
        relative_path: "assets/visuals/a2.png", mime_type: "image/png", width_px: 1200, height_px: 900,
        source_id: "source-0", source_url: "https://example.edu/a.pdf", source_path: "/tmp/source-0.pdf", source_page: 2,
        confidence: .9, caption_hint: "Original", relevance_reason: "Selected source diagram", generation_prompt: null }];
      state.extracted_data = data;
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run(_prompt, options) {
        expect(options?.localImages).toEqual([path.join(runDir, "assets/visuals/a2.png"), path.join(runDir, "assets/visuals/b1.png")]);
        return JSON.stringify({ ok: true, summary: "Namespaced page inspected", findings: [] });
      } })(state);
      expect(result.error_log).toBeNull();
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("filters excluded sources from the legacy whole-analyzer image fallback", async () => {
    const { runDir, state } = await fixture();
    try {
      const manifestPath = path.join(runDir, "visual-candidates.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.candidates.find((candidate: { id: string }) => candidate.id === "bad").width_px = 4000;
      await writeFile(manifestPath, JSON.stringify(manifest));
      const config = moodleTestConfig({ runDir, artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "source_audit" } });
      const result = await createAnalyzerNode(config, { async run(_prompt, options) {
        expect(options?.localImages).toHaveLength(2);
        expect(options?.localImages?.every(image => !image.endsWith("bad.png"))).toBe(true);
        return JSON.stringify(state.extracted_data);
      } })(state);
      expect(result.error_log).toBeNull();
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it.each([false, true])("compares cited, scoped original images in the existing initial/repair review call (repair=%s)", async repair => {
    const { runDir, state } = await fixture();
    try {
      if (repair) await persistPendingExtractionRepairs(runDir, "Semantic quality review failed:\n- [chapter: Source interpretation] preserve distinct source basis indices.", 1);
      let calls = 0;
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run(prompt, options) {
        calls++;
        expect(options?.localImages).toEqual([path.join(runDir, "assets/visuals/a2.png"), path.join(runDir, "assets/visuals/b1.png")]);
        expect(prompt).toContain('"sourcePage":2');
        expect(prompt).toContain('"sourceId":"source-0"');
        expect(prompt).toContain("Compare reproduced symbols, basis/index labels and geometry");
        if (repair) expect(prompt).toContain("preserve distinct source basis indices");
        return JSON.stringify({ ok: true, summary: "Source comparison checked", findings: [] });
      } })(state);
      expect(result.error_log).toBeNull();
      expect(calls).toBe(1);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("keeps missing and explicitly excluded source images out of the review while disclosing image limits", async () => {
    const { runDir, state } = await fixture();
    try {
      await rm(path.join(runDir, "assets/visuals/a2.png"));
      await rm(path.join(runDir, "assets/visuals/a1.png"));
      await rm(path.join(runDir, "assets/visuals/b1.png"));
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run(prompt, options) {
        expect(options?.localImages ?? []).toEqual([]);
        expect(prompt).toContain("Unattached source images are not inspected");
        return JSON.stringify({ ok: true, summary: "Text review with visible boundary", findings: [] });
      } })(state);
      expect(result.error_log).toBeNull();
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });
});
