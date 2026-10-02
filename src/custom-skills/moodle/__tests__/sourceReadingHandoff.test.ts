import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildVisualPlannerPrompt } from "../nodes/visualPlannerNode.js";
import { buildAnalyzerPrompt, buildChapterFragmentPrompt, buildChapterSlices, createAnalyzerNode } from "../nodes/analyzerNode.js";
import { visualSourceArtifacts, visualRequiredResourceIds } from "../visualAssets.js";
import { buildVisualPageIndex } from "../visualPlanner.js";
import { createSourceArchitectNode } from "../sourceArchitect.js";
import { moodleExtractedData, moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

async function fixture() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-reading-handoff-"));
  const lectureUrl = "https://example.edu/lesson.pdf", taskUrl = "https://example.edu/practice.pdf", wrapperUrl = "https://example.edu/launcher";
  const architecture = { schemaVersion: 1 as const, modules: [{ id: "method", title: "Evidence interpretation", priority: "essential" as const,
    contentMode: "conceptual" as const, learningObjectives: ["Interpret a source and apply its evidenced method."], assessmentSignals: [],
    resourceUrls: [lectureUrl, taskUrl, wrapperUrl] }], supportResources: [], excludedResourceUrls: [] as string[] };
  const state = moodleTestState();
  state.resource_manifest.courseUrl = "https://example.edu/course";
  state.source_architect_decision = { round: 1, status: "request_more", coverageSummary: "Requested practice acquisition", requestedUrls: [taskUrl],
    remainingAvailable: 1, reasons: [], learningArchitecture: { ...architecture, excludedResourceUrls: [], modules: [{ ...architecture.modules[0], resourceUrls: [lectureUrl] }] } };
  const base = { parentId: null, sectionPath: [], activityType: "resource", resolvedUrl: null, previewPath: null, status: "acquired" as const,
    checksum: null, verifiedAt: null, examRelevance: "unknown" as const, failureReason: null,
    selection: { selected: true, role: "worked_example" as const, priority: 600, topic: null, reason: "Requested exact source" } };
  state.resource_manifest.resources = [
    { ...base, id: "lecture", title: "Original lesson", originUrl: lectureUrl, localPath: path.join(runDir, "lesson.pdf") },
    { ...base, id: "task", title: "Original scanned practice", originUrl: taskUrl, localPath: path.join(runDir, "practice.pdf"),
      extraction: { status: "unusable", method: "native_pdf_text", characterCount: 0, pageCount: 2, warnings: ["Inspect existing original pages."] } },
    { ...base, id: "wrapper", title: "Native link launcher", originUrl: wrapperUrl, activityType: "url", localPath: null },
  ];
  for (const resource of state.resource_manifest.resources) if (resource.localPath) await writeFile(resource.localPath, "%PDF-1.4 nonempty acquired fixture");
  state.evidence_package.records = [{ id: "launcher-record", resourceId: "wrapper", kind: "claim", locator: { section: "Launcher page" },
    content: "This acquired page exposes a link; the linked target has not been read.", confidence: 1, pairId: null, sourceUrl: wrapperUrl, localPath: null }];
  state.moodle_raw_text = `[Moodle page]\nTitle: Native link launcher\nURL: ${wrapperUrl}\n\n${state.evidence_package.records[0].content}`;
  await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({ schemaVersion: 1, entries: [
    ...state.resource_manifest.resources.map(resource => ({ href: resource.originUrl, label: resource.title, selected: true, sectionTitle: "Source interpretation", role: "worked_example", priority: 600, score: 1 })),
    { href: "https://example.edu/optional.pdf", label: "Optional source", selected: false, sectionTitle: "Optional", role: "supplementary", priority: 10, score: 0 },
  ] }));
  const response = { status: "request_more", coverage_summary: "Acquired scanned practice requires page reading before coverage can be verified.",
    requested_urls: [lectureUrl, taskUrl, wrapperUrl], reasons: ["Inspect the original files and preserve the unverified linked-target gap."], learning_architecture: architecture };
  const config = moodleTestConfig({ runDir, runtimeCacheDir: path.join(runDir, "cache"), intentDecision: { ...moodleTestConfig().intentDecision!, needsCourseMaterial: true } });
  return { runDir, state, response, config, taskUrl, lectureUrl, wrapperUrl };
}

describe("acquired source reading handoff", () => {
  it("invalidates chapter and fragment caches when exploratory original bytes change, while reusing unchanged originals", async () => {
    const f = await fixture();
    try {
      const resource = f.state.resource_manifest.resources[1];
      const writeOriginal = async (content: string) => {
        await writeFile(resource.localPath!, content);
        resource.checksum = createHash("sha256").update(content).digest("hex");
      };
      await writeOriginal("%PDF-1.4 original acquired source");
      f.state.source_architect_decision.pendingReads = [{ resourceId: resource.id, url: resource.originUrl, medium: "pdf_pages", purpose: "scope_assessment", limitation: null }];
      const codex = { run: vi.fn(async () => JSON.stringify({ sections: [{ heading: "Evidence interpretation", summary: "Relevance is bounded by the existing goals.", key_concepts: [], source_ids: ["lecture", "task"] }], formulas: [], worked_examples: [], figures: [], warnings: [] })) };
      const config = { ...f.config, artifactIntent: { ...f.config.artifactIntent, profile: "study_guide" as const } };
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      const originalCalls = codex.run.mock.calls.length;
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      expect(codex.run.mock.calls).toHaveLength(originalCalls);
      await writeOriginal("%PDF-1.4 corrected original source with changed source geometry");
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      expect(codex.run.mock.calls.length).toBeGreaterThan(originalCalls);
      const correctedCalls = codex.run.mock.calls.length;
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      expect(codex.run.mock.calls).toHaveLength(correctedCalls);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each(["normalized-id", "empty-first-module"])("owns exploratory slices through the first actual admissible %s focus", async scenario => {
    const f = await fixture();
    try {
      const module = f.state.source_architect_decision.learningArchitecture!.modules[0];
      module.id = "Evidence Interpretation / first";
      if (scenario === "empty-first-module") f.state.source_architect_decision.learningArchitecture!.modules.unshift({ ...module, id: "empty", priority: "supplementary", resourceUrls: [] });
      f.state.source_architect_decision.pendingReads = [{ resourceId: "task", url: f.taskUrl, medium: "pdf_pages", purpose: "scope_assessment", limitation: null }];
      expect(buildChapterSlices(f.state, { key: "evidence-interpretation-first", title: module.title, resourceIds: ["lecture"], matchTerms: [] })
        .some(slice => slice.resourceIds.includes("task"))).toBe(true);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("supplies seven exploratory originals through actual bounded model packs and retains unread-page limits", async () => {
    const f = await fixture();
    try {
      const module = f.state.source_architect_decision.learningArchitecture!.modules[0];
      module.resourceUrls = [f.lectureUrl];
      module.learningObjectives = Array(4).fill("Evidence interpretation: compare source statements and assumptions.");
      f.state.resource_manifest.resources[0].selection!.role = "primary_lecture";
      const tasks = Array.from({ length: 7 }, (_, index) => ({ ...f.state.resource_manifest.resources[1],
        id: `task-${index}`, title: `Exploratory original ${index}`, originUrl: `https://example.edu/reading/${index}`, localPath: path.join(f.runDir, `original-${index}.pdf`) }));
      f.state.resource_manifest.resources = [f.state.resource_manifest.resources[0], f.state.resource_manifest.resources[2], ...tasks];
      const wrapper = f.state.resource_manifest.resources[1];
      f.state.evidence_package.records[0].content = "Evidence interpretation compares source statements and assumptions.";
      f.state.source_architect_decision.learningArchitecture!.supportResources = [{ id: "support", title: "Evidence interpretation", purpose: "general_reference", resourceUrls: [wrapper.originUrl] }];
      f.state.source_architect_decision.pendingReads = [{ resourceId: "lecture", url: f.lectureUrl, medium: "pdf_pages", limitation: null },
        ...tasks.map(resource => ({ resourceId: resource.id, url: resource.originUrl, medium: "pdf_pages" as const, purpose: "scope_assessment" as const, limitation: null }))];
      const visualDir = path.join(f.runDir, "assets", "visuals"); await mkdir(visualDir, { recursive: true });
      const candidates = tasks.flatMap((resource, index) => [1, 2].map(page => ({ id: `${resource.id}-${page}`, kind: "moodle_pdf_page" as const,
        title: resource.title, relative_path: `assets/visuals/${resource.id}-${page}.png`, mime_type: "image/png", width_px: 1200, height_px: 1600,
        source_id: resource.id, source_url: resource.originUrl, source_path: resource.localPath, source_page: page,
        confidence: index % 2 === 0 ? 1 : 0.7, caption_hint: "Original page", relevance_reason: "Explicit reading request", generation_prompt: null })));
      for (const resource of tasks) await writeFile(resource.localPath, "%PDF-1.4 acquired fixture");
      for (const candidate of candidates) await writeFile(path.join(f.runDir, candidate.relative_path), "nonempty attachment fixture");
      await writeFile(path.join(f.runDir, "visual-candidates.json"), JSON.stringify({ tooling: { pdfinfo: true, pdftotext: true, pdftoppm: true, pdfimages: true, magick: true }, warnings: [], candidates }));
      const calls: { images: string[]; prompt: string }[] = [];
      const result = await createAnalyzerNode({ ...f.config, executionProfile: "balanced", artifactIntent: { ...f.config.artifactIntent, profile: "study_guide" } }, {
        async run(prompt, options) {
          calls.push({ prompt, images: options?.localImages ?? [] });
          const ids = JSON.parse(prompt.split("Erlaubte Ressourcen: ")[1]!.split("\n\n")[0]!).map((resource: { id: string }) => resource.id);
          return JSON.stringify({ sections: [{ heading: "Evidence interpretation", summary: "Source relevance remains bounded by the existing learning goals.", key_concepts: [], source_ids: ids }], formulas: [], worked_examples: [], figures: [], warnings: [] });
        },
      })(f.state);
      expect(result.error_log).toBeNull();
      expect(calls.length).toBeLessThanOrEqual(6);
      expect(calls.every(call => call.images.length <= 2)).toBe(true);
      expect(tasks.every(resource => calls.some(call => call.images.some(image => path.basename(image).startsWith(resource.id))))).toBe(true);
      expect((result.extracted_data as ReturnType<typeof moodleExtractedData>).learning_modules[0]?.resource_ids).toEqual(["ch1_method_lecture", "wrapper"]);
      expect((result.extracted_data as ReturnType<typeof moodleExtractedData>).sources.map(source => source.url)).toEqual(expect.arrayContaining(tasks.map(resource => resource.originUrl)));
      for (const resource of tasks) {
        const supplied = candidates.filter(candidate => candidate.source_id === resource.id &&
          calls.some(call => call.images.includes(path.join(f.runDir, candidate.relative_path)))).map(candidate => candidate.source_page);
        const remaining = [1, 2].filter(page => !supplied.includes(page));
        expect((result.extracted_data as ReturnType<typeof moodleExtractedData>).warnings)
          .toEqual(expect.arrayContaining([expect.stringContaining(`Exploratory reading boundary for ${resource.title} (${resource.originUrl}): original pages supplied to this analysis: ${supplied.join(", ")}; pages not supplied: ${remaining.join(", ") || "none"}. Page availability does not verify methods or examination scope; retain the existing request and learning goals.`)]));
      }
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("bridges an explicit previously acquired request into exploratory original-page slices without assigning curriculum", async () => {
    const f = await fixture();
    try {
      f.response.requested_urls = [f.lectureUrl, f.taskUrl];
      f.response.learning_architecture.modules[0].resourceUrls = [f.lectureUrl];
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.error_log).toBeNull();
      expect(result.source_architect_decision?.status).toBe("sufficient");
      expect(result.source_architect_decision?.pendingReads?.find(read => read.resourceId === "task")?.purpose).toBe("scope_assessment");
      expect(result.source_architect_decision?.learningArchitecture?.modules[0].resourceUrls).toEqual([f.lectureUrl]);
      const next = { ...f.state, ...result };
      const focus = { key: "method", title: "Evidence interpretation", resourceIds: ["lecture"], matchTerms: [] };
      const slices = buildChapterSlices(next, focus);
      const exploration = slices.find(slice => slice.resourceIds.includes("task"));
      expect(exploration).toBeDefined();
      expect(exploration?.records).toEqual([]);
      expect(buildChapterFragmentPrompt(f.config, next, focus, exploration!, 0, slices.length, null, []))
        .toContain("Evaluate exploratory sources only against the existing request and learning goals");
      expect(buildChapterSlices(next, { ...focus, key: "another-module" }).some(slice => slice.resourceIds.includes("task"))).toBe(false);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each(["unrequested", "unknown", "deselected", "missing", "excluded"])("does not bridge %s prior-acquisition targets into exploration", async invalid => {
    const f = await fixture();
    try {
      f.response.requested_urls = [f.taskUrl];
      f.response.learning_architecture.modules[0].resourceUrls = [f.lectureUrl];
      if (invalid === "unrequested") f.state.source_architect_decision.requestedUrls = [];
      if (invalid === "unknown") f.response.requested_urls = ["https://example.edu/unrequested-unknown.pdf"];
      if (invalid === "deselected") f.state.resource_manifest.resources[1].selection!.selected = false;
      if (invalid === "missing") await rm(f.state.resource_manifest.resources[1].localPath!);
      if (invalid === "excluded") f.response.learning_architecture.excludedResourceUrls.push(f.taskUrl);
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.source_architect_decision?.status).toBe("blocked");
      expect(result.error_log).toContain("not an admissible acquired reading target");
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("hands assigned acquired files and native launcher evidence to the existing readers without claiming verified coverage", async () => {
    const f = await fixture();
    try {
      f.state.resource_manifest.resources[2].resolvedUrl = "https://example.edu/known-target";
      const codex = { run: vi.fn(async () => JSON.stringify(f.response)) };
      const result = await createSourceArchitectNode(f.config, codex)(f.state);
      expect(result.error_log).toBeNull();
      expect(result.source_architect_decision).toMatchObject({ status: "sufficient", requestedUrls: [], learningArchitecture: f.response.learning_architecture });
      expect(result.source_architect_decision?.pendingReads?.map(read => read.url)).toEqual(f.response.requested_urls);
      expect(result.source_architect_decision?.pendingReads?.find(read => read.resourceId === "wrapper")?.limitation).toContain("linked target");
      expect(result.source_architect_decision?.coverageSummary).toContain("subject reading remains pending");
      const next = { ...f.state, ...result };
      expect(visualSourceArtifacts(undefined, next).map(artifact => artifact.resourceId)).toEqual(["lecture", "task"]);
      expect(visualRequiredResourceIds(next).has("task")).toBe(true);
      const focus = { key: "method", title: "Evidence interpretation", resourceIds: ["lecture", "task", "wrapper"], matchTerms: [] };
      const slices = buildChapterSlices(next, focus);
      expect(slices.find(slice => slice.resourceIds.includes("task"))?.records).toEqual([]);
      expect(slices.find(slice => slice.resourceIds.includes("lecture"))?.records).toEqual([]);
      const prompts = [buildVisualPlannerPrompt(f.config, next, { schemaVersion: "1.0", generatedAt: "now", entries: [], warnings: [] }),
        await buildAnalyzerPrompt(f.config, next, focus),
        buildChapterFragmentPrompt(f.config, next, focus, { key: "slice", label: "Assigned sources", resourceIds: focus.resourceIds, records: next.evidence_package.records }, 0, 1, null, [])];
      for (const prompt of prompts) {
        expect(prompt).toContain("Acquisition readiness does not prove subject coverage");
        expect(prompt).toContain(f.taskUrl);
        expect(prompt).toContain("linked target content is not verified");
      }
      f.state.source_architect_decision = { ...result.source_architect_decision!, requestedUrls: [f.taskUrl] };
      await createSourceArchitectNode(f.config, codex)(f.state);
      expect(codex.run).toHaveBeenCalledTimes(1);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("keeps genuine available acquisition requests actionable alongside acquired reading debt", async () => {
    const f = await fixture();
    try {
      f.response.requested_urls.push("https://example.edu/optional.pdf");
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.error_log).toBeNull();
      expect(result.source_architect_decision).toMatchObject({ status: "request_more", requestedUrls: ["https://example.edu/optional.pdf"] });
      expect(result.source_architect_decision?.pendingReads).toHaveLength(3);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each(["sufficient", "request_more"])("preserves known exploratory native reading through a %s semantic reassessment", async reassessmentStatus => {
    const f = await fixture();
    try {
      f.response.requested_urls = ["https://example.edu/optional.pdf", f.wrapperUrl];
      f.response.learning_architecture.modules[0].resourceUrls = [f.lectureUrl];
      f.response.learning_architecture.modules.push({ ...f.response.learning_architecture.modules[0], id: "practice", title: "Applying evidence", resourceUrls: [] });
      const response = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(response.error_log).toBeNull();
      expect(response.source_architect_decision).toMatchObject({ status: "request_more", requestedUrls: ["https://example.edu/optional.pdf"],
        pendingReads: [{ resourceId: "wrapper", url: f.wrapperUrl, medium: "native_text", purpose: "scope_assessment" }] });
      expect(response.source_architect_decision?.learningArchitecture?.modules.map(module => module.id)).toEqual(["method", "practice"]);
      expect(response.source_architect_decision?.learningArchitecture?.modules[1].resourceUrls).toEqual([]);
      const next = { ...f.state, ...response };
      const acquired = { ...next.resource_manifest.resources[0], id: "new-practice", title: "New acquired method application", originUrl: "https://example.edu/optional.pdf", localPath: path.join(f.runDir, "new.pdf") };
      await writeFile(acquired.localPath, "%PDF-1.4 existing acquired source"); next.resource_manifest.resources.push(acquired);
      const calls = vi.fn(async (prompt: string) => {
        expect(prompt).toContain("scope_assessment");
        expect(prompt).toContain("Applying evidence");
        return JSON.stringify({ ...f.response, status: reassessmentStatus, requested_urls: reassessmentStatus === "request_more" ? [f.lectureUrl] : [], learning_architecture: { ...f.response.learning_architecture,
          modules: [{ ...f.response.learning_architecture.modules[0] }, { ...f.response.learning_architecture.modules[1], resourceUrls: [acquired.originUrl] }] } });
      });
      const reassessed = await createSourceArchitectNode(f.config, { run: calls })(next);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(reassessed.error_log).toBeNull();
      expect(reassessed.source_architect_decision?.pendingReads?.find(read => read.resourceId === "wrapper")?.purpose).toBe("scope_assessment");
      const finalState = { ...next, ...reassessed };
      const focus = { key: "method", title: "Evidence interpretation", resourceIds: ["lecture"], matchTerms: [] };
      expect(await buildAnalyzerPrompt(f.config, finalState, focus)).toContain("scope_assessment");
      expect(await buildAnalyzerPrompt(f.config, finalState, focus)).toContain("linked target content is not verified");
      expect(finalState.source_architect_decision.learningArchitecture?.modules.every(module => !module.resourceUrls.includes(f.wrapperUrl))).toBe(true);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each(["unknown", "excluded", "diagnostic-only"])("rejects %s exploratory targets even while genuine downloads are available", async invalid => {
    const f = await fixture();
    try {
      f.response.requested_urls = ["https://example.edu/optional.pdf", f.wrapperUrl];
      f.response.learning_architecture.modules[0].resourceUrls = [f.lectureUrl];
      if (invalid === "unknown") f.response.requested_urls[1] = "https://example.edu/unknown-target";
      if (invalid === "excluded") f.response.learning_architecture.excludedResourceUrls.push(f.wrapperUrl);
      if (invalid === "diagnostic-only") f.state.moodle_raw_text = "";
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.source_architect_decision?.status).toBe("blocked");
      expect(result.error_log).toContain("not an admissible acquired reading target");
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("does not declare an essential empty planning module ready after acquisitions drain", async () => {
    const f = await fixture();
    try {
      f.response.status = "sufficient";
      f.response.requested_urls = [];
      f.response.learning_architecture.modules.push({ ...f.response.learning_architecture.modules[0], id: "missing-method", title: "Unsupported method", resourceUrls: [] });
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.source_architect_decision?.status).toBe("blocked");
      expect(result.error_log).toContain("missing-method");
      expect(result.source_architect_decision?.learningArchitecture?.modules.some(module => module.id === "missing-method")).toBe(true);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("accepts a native HTML-only acquired page with exact original snapshot provenance", async () => {
    const f = await fixture();
    try {
      const resource = f.state.resource_manifest.resources[2];
      resource.activityType = "page"; resource.status = "discovered";
      f.response.requested_urls = [f.wrapperUrl];
      f.response.learning_architecture.modules[0].resourceUrls = [f.wrapperUrl];
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.error_log).toBeNull();
      expect(result.source_architect_decision?.pendingReads).toEqual([{ resourceId: "wrapper", url: f.wrapperUrl, medium: "native_text", limitation: null }]);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it("does not reuse acquisition readiness after a debt-bearing cached file disappears", async () => {
    const f = await fixture();
    try {
      f.state.source_architect_decision.round = 0;
      const codex = { run: vi.fn(async () => JSON.stringify(f.response)) };
      expect((await createSourceArchitectNode(f.config, codex)(f.state)).source_architect_decision?.status).toBe("sufficient");
      await rm(f.state.resource_manifest.resources[1].localPath!);
      f.state.resource_manifest.resources[1].localPath = null;
      f.state.resource_manifest.resources[1].status = "discovered";
      delete f.state.resource_manifest.resources[1].extraction;
      const result = await createSourceArchitectNode(f.config, codex)(f.state);
      expect(codex.run).toHaveBeenCalledTimes(2);
      expect(result.source_architect_decision?.status).toBe("request_more");
      expect(result.source_architect_decision?.requestedUrls).toContain(f.taskUrl);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each([1, 25])("invalidates changed reading debt in the %i-record chapter cache while reusing unchanged debt", async count => {
    const f = await fixture();
    try {
      const resource = f.state.resource_manifest.resources[2];
      resource.activityType = "page";
      resource.selection!.role = "primary_lecture";
      f.state.resource_manifest.resources = [resource];
      const content = "Interpret a source by comparing the stated claim and supporting observations and explaining their limits.";
      f.state.evidence_package.records = Array.from({ length: count }, (_, i) => ({ ...f.state.evidence_package.records[0], id: `native-${i}`, content: `${content} Observation ${i}.` }));
      f.state.source_architect_decision = { round: 2, status: "sufficient", requestedUrls: [], reasons: [], remainingAvailable: 0, coverageSummary: "Native source acquired",
        learningArchitecture: { ...f.response.learning_architecture, modules: [{ ...f.response.learning_architecture.modules[0], resourceUrls: [resource.originUrl] }] } };
      const codex = { run: vi.fn(async (_prompt: string) => JSON.stringify(moodleExtractedData({ sources: [{ id: resource.id, title: resource.title, kind: "moodle_page", url: resource.originUrl, path: null, page: null }],
        sections: [{ heading: "Evidence interpretation", summary: content, key_concepts: ["Claim", "Observations"], source_ids: [resource.id] }] }))) };
      const config = { ...f.config, artifactIntent: { ...f.config.artifactIntent, profile: "study_guide" as const } };
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      const firstCalls = codex.run.mock.calls.length;
      f.state.source_architect_decision.pendingReads = [{ resourceId: resource.id, url: resource.originUrl, medium: "native_text", limitation: "Unverified target content requires original reading." }];
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      expect(codex.run.mock.calls.length).toBeGreaterThan(firstCalls);
      expect(codex.run.mock.calls.at(-1)?.[0]).toContain("Unverified target content requires original reading");
      const debtCalls = codex.run.mock.calls.length;
      expect((await createAnalyzerNode(config, codex)(f.state)).error_log).toBeNull();
      expect(codex.run.mock.calls).toHaveLength(debtCalls);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each(["deselected", "excluded", "skipped", "failed"])("does not offer a %s PDF to the visual consumer", async veto => {
    const f = await fixture();
    try {
      f.state.resource_manifest.resources = [f.state.resource_manifest.resources[1]];
      const resource = f.state.resource_manifest.resources[0];
      if (veto === "deselected") resource.selection!.selected = false;
      if (veto === "excluded") f.state.source_architect_decision.learningArchitecture!.excludedResourceUrls.push(resource.originUrl);
      if (veto === "skipped") resource.status = "skipped";
      if (veto === "failed") resource.status = "failed";
      f.state.source_architect_decision.pendingReads = [{ resourceId: resource.id, url: resource.originUrl, medium: "pdf_pages", limitation: null }];
      f.state.source_architect_decision.learningArchitecture!.modules[0].resourceUrls.push(resource.originUrl);
      expect(visualSourceArtifacts(undefined, f.state)).toEqual([]);
      expect((await buildVisualPageIndex(f.config, f.state)).entries).toEqual([]);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });

  it.each(["unknown", "missing", "deselected", "excluded", "unassigned", "diagnostic-only"])("keeps an invalid %s reading request blocked and preserves semantic architecture", async failure => {
    const f = await fixture();
    try {
      if (failure === "unknown") f.response.requested_urls.push("https://example.edu/not-authorized.pdf");
      if (failure === "missing") await rm(f.state.resource_manifest.resources[1].localPath!);
      if (failure === "deselected") f.state.resource_manifest.resources[1].selection!.selected = false;
      if (failure === "excluded") f.response.learning_architecture.excludedResourceUrls.push(f.taskUrl);
      if (failure === "diagnostic-only") {
        f.state.resource_manifest.resources[1].localPath = null;
        f.state.resource_manifest.resources[1].status = "discovered";
        f.state.evidence_package.records.push({ ...f.state.evidence_package.records[0], id: "discovery-diagnostic", resourceId: "task", kind: "claim", sourceUrl: f.taskUrl, content: "Resource discovered; no source content acquired or downloaded." });
      }
      if (failure === "unassigned") {
        f.response.learning_architecture.modules[0].resourceUrls = [f.lectureUrl, f.wrapperUrl];
        f.state.source_architect_decision.requestedUrls = []; // No prior authorized acquisition intent.
      }
      const result = await createSourceArchitectNode(f.config, { async run() { return JSON.stringify(f.response); } })(f.state);
      expect(result.source_architect_decision?.status).toBe("blocked");
      expect(result.error_log).toContain("Source architect blocked publication");
      expect(result.source_architect_decision?.learningArchitecture?.modules.map(module => module.id)).toEqual(["method"]);
    } finally { await rm(f.runDir, { recursive: true, force: true }); }
  });
});
