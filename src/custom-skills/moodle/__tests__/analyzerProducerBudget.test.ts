import { describe, expect, it } from "vitest";
import { buildAnalyzerPrompt, buildChapterFragmentPrompt, createAnalyzerNode } from "../nodes/analyzerNode.js";
import { resolveModelPromptBodyCharacterBudget } from "../codexClient.js";
import { chapterFragmentJsonSchema, extractedDataJsonSchema } from "../schemas.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

const request = "Prepare the selected assessment, retaining its announced topic and date.";
const title = "Assessment 3 on 12 April 2027 — Evidence interpretation (Unit C)";
const url = "https://example.edu/mod/quiz/view.php?id=300";
function fixture() {
  const state = moodleTestState();
  state.request_contract.originalPrompt = request;
  state.request_contract.userGoal = "Explain the selected evidence and reasoning. ".repeat(100);
  state.resource_manifest.resources = [{ id: "assessment", parentId: null, sectionPath: [], activityType: "quiz", title, originUrl: url,
    resolvedUrl: null, localPath: null, previewPath: null, status: "discovered", checksum: null, verifiedAt: null, examRelevance: "confirmed", failureReason: null }];
  state.source_architect_decision.learningArchitecture = { schemaVersion: 1, modules: [], excludedResourceUrls: [],
    supportResources: [{ id: "assessment", title, purpose: "general_reference", resourceUrls: [url] }] };
  state.evidence_package.records = [{ id: "announcement", resourceId: "assessment", kind: "claim", locator: { section: "Current assessment announcement" },
    content: `${title}. Opens at 10:00, duration 45 minutes. ${"Detailed official instructions. ".repeat(120)}`, confidence: 1, pairId: null, sourceUrl: url, localPath: null }];
  const records = Array.from({ length: 34 }, (_, i) => ({ id: `claim-${i}`, resourceId: "assessment", kind: "claim" as const,
    locator: { section: "Selected unit / ".repeat(25), page: i + 1 }, content: `Exact learning evidence ${i}. ${"Source lesson note ".repeat(28)}`,
    confidence: .95, pairId: null, sourceUrl: url, localPath: null }));
  return { state, records, config: moodleTestConfig({ prompt: request, originalUserPrompt: request, outputLanguage: "en" }),
    focus: { key: "assessment", title: "Assessment interpretation", resourceIds: ["assessment"], matchTerms: ["interpretation"], contentMode: "conceptual" as const } };
}

describe("complete analyzer producer budgets", () => {
  it.each([false, true])("budgets packed fragment metadata, context and exact schema before initial/repair calls (repair=%s)", repair => {
    const { state, config, focus, records } = fixture();
    const prompt = buildChapterFragmentPrompt(config, state, focus, { key: "pack", label: "Selected evidence", resourceIds: ["assessment"], records }, 0, 1, null, [],
      repair ? `[chapter: Assessment interpretation] Preserve the confirmed announcement. ${"Keep stipulated givens. ".repeat(160)}` : null);
    expect(prompt.length).toBeLessThanOrEqual(resolveModelPromptBodyCharacterBudget(repair ? "content_repair" : "content_analyzer", chapterFragmentJsonSchema) - 1_000);
    expect(prompt).toContain(request);
    expect(prompt).toContain(title);
    expect(prompt).toContain(url);
    expect(prompt).toContain("announcement");
    expect(prompt).toContain("Current assessment announcement");
    for (const record of records) expect(prompt).toContain(record.content);
  });

  it("compacts oversized diagnostic metadata before reducing whole-request source evidence", async () => {
    const { state, config } = fixture();
    state.evidence_package.warnings = ["Repeated diagnostic detail. ".repeat(4_000)];
    const prompt = await buildAnalyzerPrompt(config, state);
    expect(prompt.length).toBeLessThanOrEqual(resolveModelPromptBodyCharacterBudget("content_analyzer", extractedDataJsonSchema) - 1_000);
    expect(prompt).toContain(state.evidence_package.records[0].content);
    expect(prompt).toContain(request);
    expect(prompt).toContain(title);
    expect(prompt).toContain("Current assessment announcement");
  });

  it("retains record provenance when its resource was omitted from the bounded manifest", async () => {
    const { state, config } = fixture();
    const base = state.resource_manifest.resources[0];
    state.resource_manifest.resources = Array.from({ length: 20 }, (_, i) => ({ ...base, id: `r${i}`,
      title: "A fully identified selected resource ".repeat(20), sectionPath: ["Selected section ".repeat(40)],
      originUrl: `https://example.edu/resource/${i}`, selection: { selected: true, role: "primary_lecture" as const,
        reason: "This source supports the requested material. ".repeat(20), topic: "Evidence interpretation", priority: 900 } }));
    state.source_architect_decision.learningArchitecture = { schemaVersion: 1, modules: [], supportResources: [], excludedResourceUrls: [] };
    const record = { ...state.evidence_package.records[0], resourceId: "r19", kind: "exercise" as const,
      sourceUrl: "https://example.edu/resource/19", content: "Original complete task and stipulated givens.", locator: { page: 7, section: "Official task" } };
    state.evidence_package.records = [record];
    state.evidence_package.warnings = ["Repeated diagnostic detail. ".repeat(4_000)];
    const prompt = await buildAnalyzerPrompt(config, state);
    const manifest = JSON.parse(prompt.split("Resource manifest JSON:\n")[1].split("\n\nEvidence package")[0]);
    expect(manifest.resources.some((resource: { id: string }) => resource.id === "r19")).toBe(false);
    const packet = JSON.parse(prompt.split("Evidence package selection JSON:\n")[1].split("\n\n")[0]);
    expect(packet.records[0]).toMatchObject({ sourceUrl: record.sourceUrl, locator: record.locator, content: record.content });
  });

  it("rejects an impossible protected request before calling the client", async () => {
    const { state, config } = fixture();
    config.prompt = "Unchanged original request. ".repeat(4_000);
    config.originalUserPrompt = config.prompt;
    let calls = 0;
    await expect(buildAnalyzerPrompt(config, state)).rejects.toThrow(/producer.*capacity/i);
    expect(() => buildChapterFragmentPrompt(config, state, { key: "unit", title: "Unit", resourceIds: [], matchTerms: [] },
      { key: "unit", label: "Unit", resourceIds: [], records: [] }, 0, 1, null, [])).toThrow(/producer.*capacity/i);
    const result = await createAnalyzerNode(config, { async run() { calls++; return "{}"; } })(state);
    expect(calls).toBe(0);
    expect(result.retry_count).toBe(3);
  });

  it("does not split or chop an oversized task's evidence to force a fragment into capacity", () => {
    const { state, config, focus, records } = fixture();
    const task = { ...records[0], content: "A single source task with indivisible stated givens. ".repeat(2_000) };
    expect(() => buildChapterFragmentPrompt(config, state, focus, { key: "task", label: "Source task", resourceIds: ["assessment"], records: [task, records[1]] },
      0, 1, null, [])).toThrow(/producer.*capacity/i);
  });
});
