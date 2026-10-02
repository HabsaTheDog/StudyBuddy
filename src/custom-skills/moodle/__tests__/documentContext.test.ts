import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAnalyzerNode, buildAnalyzerPrompt, buildChapterFragmentPrompt } from "../nodes/analyzerNode.js";
import { ResourceManifestSchema, EvidencePackageSchema } from "../examNavigatorContracts.js";
import { validateExtractedData } from "../validation.js";
import { buildDocumentContext } from "../documentContext.js";
import { moodleExtractedData, moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

function fixture() {
  const courseUrl = "https://moodle.example/course/view.php?id=41";
  const quizUrl = "https://moodle.example/mod/quiz/view.php?id=42";
  const resources = [
    { id: "course", activityType: "course", title: "Literature Methods", originUrl: courseUrl, localPath: null },
    { id: "assessment", activityType: "quiz", title: "First assessment on 17.04.2027 — Essay interpretation (Unit B)", originUrl: quizUrl, localPath: null },
    ...["a", "b"].map(id => ({ id, activityType: "resource", title: `Essay interpretation ${id}`, originUrl: `https://moodle.example/${id}.pdf`, localPath: `/tmp/${id}.pdf` })),
  ];
  const records = [
    ...Array.from({ length: 24 }, (_, i) => ({ resourceId: "course", content: `Other enrolled-course information ${i}: unrelated navigation and older units. `.repeat(7) })),
    { resourceId: "course", content: "First assessment on 17.04.2027 — Essay interpretation (Unit B). Use the current assessment announcement; the navigation lists older units too." },
    { resourceId: "assessment", content: "Opens 17 April 2027 at 10:00; closes 17 April 2027 at 11:00." },
    { resourceId: "assessment", content: "Duration: 45 minutes. Interpret one essay with three parts." },
    ...["a", "b"].map(id => ({ resourceId: id, content: `Essay interpretation ${id}: describe the argument, explain the literary evidence and evaluate the stated conclusion.` })),
  ];
  return moodleTestState({
    request_contract: { ...moodleTestState().request_contract, originalPrompt: "Prepare for my first assessment in essay interpretation." },
    resource_manifest: ResourceManifestSchema.parse({ schemaVersion: "1.0", courseUrl, generatedAt: new Date().toISOString(),
      resources: resources.map(r => ({ ...r, status: r.localPath ? "acquired" : "discovered", parentId: null, sectionPath: [],
        resolvedUrl: null, previewPath: null, checksum: null, verifiedAt: null, examRelevance: "inferred", failureReason: null })) }),
    evidence_package: EvidencePackageSchema.parse({ schemaVersion: "1.0", generatedAt: new Date().toISOString(), warnings: [],
      records: records.map((r, i) => ({ ...r, id: `ev-${i}`, kind: "claim", locator: { section: resources.find(s => s.id === r.resourceId)!.title },
        confidence: .95, pairId: null, localPath: null, sourceUrl: resources.find(s => s.id === r.resourceId)!.originUrl })) }),
    source_architect_decision: { round: 1, status: "sufficient", coverageSummary: "Selected study content and native assessment context read.", requestedUrls: [], remainingAvailable: 0, reasons: [],
      learningArchitecture: { schemaVersion: 1, modules: ["a", "b"].map(id => ({ id, title: `Essay interpretation ${id}`, priority: "essential", contentMode: "conceptual",
        learningObjectives: ["Explain literary evidence."], assessmentSignals: ["Interpret the assessment essay."], resourceUrls: [`https://moodle.example/${id}.pdf`] })),
        supportResources: [{ id: "assessment-context", title: "Assessment essay interpretation", purpose: "general_reference", resourceUrls: [quizUrl] }], excludedResourceUrls: [] } },
  });
}

describe("document-level evidence handoff", () => {
  it("retains semantically assigned native assessment context independently of support-role placement", () => {
    const state = fixture();
    const architecture = state.source_architect_decision.learningArchitecture!;
    architecture.modules[0].resourceUrls.push(state.resource_manifest.resources.find(resource => resource.id === "assessment")!.originUrl);
    architecture.supportResources = [];
    const context = buildDocumentContext(state);
    const assessment = context.find(entry => entry.source_id === "assessment");
    expect(assessment?.title).toBe("First assessment on 17.04.2027 — Essay interpretation (Unit B)");
    expect(assessment?.url).toBe("https://moodle.example/mod/quiz/view.php?id=42");
    expect(assessment?.records.map(record => record.excerpt).join(" ")).toContain("Duration: 45 minutes");
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(8000);
  });
  it("defaults legacy extraction to an empty document context", () => {
    expect(validateExtractedData(moodleExtractedData()).document_context).toEqual([]);
  });

  it("preserves read HTML assessment context independently of local chapter files through persistence", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-document-context-"));
    try {
      const state = fixture();
      const prompts: string[] = [];
      const config = moodleTestConfig({ runDir, runtimeCacheDir: path.join(runDir, "cache"), outputLanguage: "en",
        prompt: "Prepare for my first assessment in essay interpretation.", artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" } });
      const result = await createAnalyzerNode(config, { async run(prompt) {
        prompts.push(prompt);
        const id = prompt.includes('"title":"Essay interpretation a"') ? "a" : "b";
        return JSON.stringify(moodleExtractedData({ document_context: [{ source_id: "fabricated", title: "Invented announcement", url: "https://moodle.example/invented", records: [{ record_id: "fake-record", locator: {}, excerpt: "Invented date." }], omitted_records: 0 }],
          sources: [{ id: "assessment", title: "Invented source replacement", kind: "moodle_page", url: "https://moodle.example/fake", path: null, page: null },
            { id, title: `Essay interpretation ${id}`, kind: "pdf", url: `https://moodle.example/${id}.pdf`, path: `/tmp/${id}.pdf`, page: 1 }],
          sections: [{ heading: `Essay interpretation ${id}`, summary: "Explain the source argument and its literary evidence.", key_concepts: ["Evaluate the stated conclusion."], source_ids: [id] }] }));
      } })(state);

      expect(result.error_log).toBeNull();
      expect(prompts).toHaveLength(2);
      for (const prompt of prompts) {
        expect(prompt).toContain("Document-level source context");
        expect(prompt).toContain("First assessment on 17.04.2027");
        expect(prompt).toContain("Duration: 45 minutes");
      }
      const saved = JSON.parse(await readFile(path.join(runDir, "extracted-data.json"), "utf8"));
      expect(saved.learning_modules).toHaveLength(2);
      expect(saved.document_context.map((entry: { source_id: string }) => entry.source_id)).toEqual(["assessment", "course"]);
      expect(saved.document_context[0]).toMatchObject({ source_id: "assessment", title: state.resource_manifest.resources[1].title, url: state.resource_manifest.resources[1].originUrl });
      expect(saved.document_context[0].records.some((r: { excerpt: string }) => r.excerpt.includes("45 minutes"))).toBe(true);
      expect(saved.document_context[1].records.some((r: { excerpt: string }) => r.excerpt.startsWith("First assessment on 17.04.2027"))).toBe(true);
      expect(saved.document_context[1].omitted_records).toBeGreaterThan(0);
      expect(JSON.stringify(saved.document_context).length).toBeLessThanOrEqual(8_000);
      expect(saved.sources.some((source: { id: string }) => source.id === "assessment")).toBe(true);
      expect(saved.sources.find((source: { id: string }) => source.id === "assessment").url).toBe(state.resource_manifest.resources[1].originUrl);
      expect(JSON.stringify(saved.document_context)).not.toContain("fabricated");
      for (const entry of saved.document_context) for (const record of entry.records) {
        const actual = state.evidence_package.records.find(r => r.id === record.record_id)!;
        expect(record.excerpt).toBe(actual.content);
        expect(record.locator).toEqual(actual.locator);
      }
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("rejects excluded, foreign-course and unread context without changing permissions or subject scope", () => {
    const state = fixture();
    const assessment = state.resource_manifest.resources.find(r => r.id === "assessment")!;
    state.source_architect_decision.learningArchitecture!.excludedResourceUrls.push(assessment.originUrl);
    const foreign = { ...state.resource_manifest.resources[0], id: "foreign", originUrl: "https://moodle.example/course/view.php?id=999", title: "Foreign course" };
    const unread = { ...assessment, id: "unread", originUrl: "https://moodle.example/mod/quiz/view.php?id=999", title: "Unread advertised assessment" };
    state.resource_manifest.resources.push(foreign, unread);
    state.source_architect_decision.learningArchitecture!.supportResources.push({ id: "unread", title: unread.title, purpose: "general_reference", resourceUrls: [unread.originUrl] });
    state.evidence_package.records.push({ ...state.evidence_package.records[0], id: "foreign-record", resourceId: foreign.id, sourceUrl: foreign.originUrl });
    expect(buildDocumentContext(state).map(entry => entry.source_id)).toEqual(["course"]);
    expect(state.source_architect_decision.learningArchitecture!.modules).toHaveLength(2);
  });

  it.each(["deselected", "skipped", "unauthorized"] as const)("keeps a %s native reference vetoed in both document and chapter packets", async veto => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-document-context-veto-"));
    try {
      const state = fixture();
      const assessment = state.resource_manifest.resources.find(resource => resource.id === "assessment")!;
      if (veto !== "deselected") assessment.status = veto;
      else assessment.selection = { selected: false, reason: "Intentionally omitted", priority: 0, role: "administrative", topic: null };
      expect(buildDocumentContext(state).map(entry => entry.source_id)).toEqual(["course"]);
      const result = await createAnalyzerNode(moodleTestConfig({ runDir, runtimeCacheDir: path.join(runDir, "cache") }), {
        async run() { return JSON.stringify(moodleExtractedData({ sections: [{ heading: "Literary evidence", summary: "Interpret the source argument.", key_concepts: [], source_ids: [] }] })); },
      })(state);
      expect(result.error_log).toBeNull();
      const saved = JSON.parse(await readFile(path.join(runDir, "extracted-data.json"), "utf8"));
      expect(saved.document_context.map((entry: { source_id: string }) => entry.source_id)).toEqual(["course"]);
      expect(saved.learning_modules.every((module: { resource_ids: string[] }) => module.resource_ids.every(id => !id.endsWith("assessment")))).toBe(true);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("preserves server-owned context and native citation IDs through dense materialization and cached reuse", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-document-context-dense-"));
    try {
      const state = fixture();
      state.source_architect_decision.learningArchitecture!.supportResources[0].title = "Assessment context";
      for (const id of ["a", "b"]) {
        const original = state.evidence_package.records.find(record => record.resourceId === id)!;
        state.evidence_package.records.push(...Array.from({ length: 19 }, (_, index) => ({ ...original, id: `${id}-dense-${index}` })));
      }
      const config = moodleTestConfig({ runDir, runtimeCacheDir: path.join(runDir, "cache"), outputLanguage: "en",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" } });
      let calls = 0;
      const codex = { async run(prompt: string) {
        calls++;
        expect(prompt).toContain("Document-level source context");
        return JSON.stringify({ sections: [{ heading: "Assessment context", summary: "The cited native announcement identifies the selected assessment.", key_concepts: [], source_ids: ["assessment"] }],
          formulas: [], worked_examples: [], figures: [], warnings: [] });
      } };
      const node = createAnalyzerNode(config, codex);
      const first = await node(state);
      expect(first.error_log).toBeNull();
      expect(calls).toBeGreaterThan(0);
      const firstCalls = calls;
      const firstSaved = JSON.parse(await readFile(path.join(runDir, "extracted-data.json"), "utf8"));
      expect(firstSaved.sections[0].source_ids).toEqual(["assessment"]);
      expect(firstSaved.sources.filter((source: { id: string }) => source.id === "assessment")).toHaveLength(1);
      expect(firstSaved.document_context).toEqual(buildDocumentContext(state));
      expect(firstSaved.learning_modules[0].resource_ids).not.toContain("course");
      const cached = await node(state);
      expect(cached.error_log).toBeNull();
      expect(calls).toBe(firstCalls);
      const cachedSaved = JSON.parse(await readFile(path.join(runDir, "extracted-data.json"), "utf8"));
      expect(cachedSaved.document_context).toEqual(firstSaved.document_context);
      expect(cachedSaved.sections[0].source_ids).toEqual(["assessment"]);
      state.evidence_package.records.find(record => record.resourceId === "assessment")!.content += " Confirmed revised opening information.";
      const refreshed = await node(state);
      expect(refreshed.error_log).toBeNull();
      expect(calls).toBeGreaterThan(firstCalls);
      const refreshedSaved = JSON.parse(await readFile(path.join(runDir, "extracted-data.json"), "utf8"));
      expect(refreshedSaved.document_context).toEqual(buildDocumentContext(state));
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("gives a focused fragment positive document evidence without expanding its learning scope", async () => {
    const state = fixture();
    const config = moodleTestConfig({ prompt: "Prepare for the first assessment in essay interpretation." });
    const focus = { key: "a", title: "Essay interpretation a", resourceIds: ["a"], matchTerms: [] };
    const whole = await buildAnalyzerPrompt(config, state, focus);
    const fragment = buildChapterFragmentPrompt(config, state, focus, { key: "a", label: "Literary evidence", resourceIds: ["a"], records: [state.evidence_package.records.at(-2)!] }, 0, 1, null, []);
    for (const prompt of [whole, fragment]) {
      expect(prompt).toContain("Document-level source context");
      expect(prompt).toContain("First assessment on 17.04.2027");
      expect(prompt).toContain("Duration: 45 minutes");
    }
  });
});
