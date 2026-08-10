import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { minimalRequestContract } from "../../shared/requestContract.js";
import { buildAdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { questionBankItemRepairBatchMetrics, repairQuestionBankItem, resolveQuestionBankItemRepairBatch } from "../questionBankItemRepair.js";
import { questionBankItemReviewRecordId, questionReviewContext } from "../questionBankReview.js";
import { studyGuideContentSchema } from "../studyGuideContent.js";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("item-local question repair", () => {
  it("passes exact owner context and changes only the rejected exercise", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "question-item-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Prepare adaptive open-response practice", kind: "study-guide", runDir });
    const contract = minimalRequestContract(config.originalUserPrompt, [config.kind]);
    const content = studyGuideContentSchema.parse({
      courseTitle: "Course", courseCode: "C1", scopeNote: "Bounded evidence.",
      sources: [{ id: "s1", label: "Script", url: "", coverage: "Topic" }],
      topics: [{
        id: "topic", title: "Topic", learningGoals: ["Explain the concept"],
        theory: { summary: "A grounded concept summary.", keyIdeas: ["Key idea"], formulas: [] },
        workedExamples: [], retrieval: [],
        exercises: [application("keep", "Keep this complete answer."), application("repair", "This answer is incomplete.")],
      }],
    });
    const model = buildAdaptiveStudyModel(content, "AUTHORIZED_EVIDENCE_MARKER", "en");
    const item = model.questionBank.items.find((candidate) => candidate.legacyExerciseId === "repair")!;
    const context = questionReviewContext(config.originalUserPrompt, contract);
    const unsigned = {
      itemId: item.id, contentHash: item.contentHash,
      contract: { contractHash: context.contractHash, originalPromptHash: context.originalPromptHash, requirementIds: context.requirementIds },
      reviewer: { kind: "independent_model" as const, task: "quality_reviewer" as const, verdict: "rejected" as const },
      checks: { schema: true, scope: true, answer: false, provenance: true, rendering: true },
      findings: [{ code: "answer", severity: "blocking" as const, message: "Incomplete answer.", repairInstruction: "Complete only this comparison answer." }],
    };
    const record = { schemaVersion: 1 as const, recordId: questionBankItemReviewRecordId(unsigned), ...unsigned };
    let observedPrompt = "";
    let observedSchema: unknown;
    const repaired = await repairQuestionBankItem({
      config, content, sourceText: "AUTHORIZED_EVIDENCE_MARKER", item, review: record, requestContract: contract,
      codex: { run: async (prompt, options) => {
        observedPrompt = prompt;
        observedSchema = options.outputSchema;
        return JSON.stringify({ repairs: [{
          itemId: item.id, previousContentHash: item.contentHash,
          exercise: application("repair", "A complete grounded comparison with the principle, application, and justification."),
        }] });
      } },
    });

    expect(observedPrompt).toContain(config.originalUserPrompt);
    expect(observedPrompt).toContain("AUTHORIZED_EVIDENCE_MARKER");
    expect(JSON.stringify(observedSchema)).not.toContain('"oneOf"');
    expect(JSON.stringify(observedSchema)).toContain('"selectionMode"');
    expect(repaired.topics[0]!.exercises[0]).toEqual(content.topics[0]!.exercises[0]);
    expect(repaired.topics[0]!.exercises[1]).not.toEqual(content.topics[0]!.exercises[1]);
    expect(repaired.topics[0]!.exercises[1]!.id).toBe("repair");
  });

  it("fails closed with an owner-specific diagnosis for assessment items", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "assessment-item-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Prepare for the documented assessment", kind: "study-guide", runDir });
    const contract = minimalRequestContract(config.originalUserPrompt, [config.kind]);
    const content = studyGuideContentSchema.parse({
      courseTitle: "Course", courseCode: "C1", scopeNote: "Bounded evidence.", sources: [{ id: "s1", label: "Script", url: "", coverage: "Topic" }],
      topics: [{ id: "topic", title: "Topic", learningGoals: ["Explain"], theory: { summary: "Grounded summary.", keyIdeas: [], formulas: [] }, workedExamples: [], retrieval: [], exercises: [application("assessment", "A complete answer grounded in the source.")] }],
    });
    const base = buildAdaptiveStudyModel(content, "Evidence", "en").questionBank.items[0]!;
    const item = { ...base, assessmentSectionId: "oral", assessmentQuestionTypes: ["presentation"] };
    const context = questionReviewContext(config.originalUserPrompt, contract);
    const unsigned = {
      itemId: item.id, contentHash: item.contentHash,
      contract: { contractHash: context.contractHash, originalPromptHash: context.originalPromptHash, requirementIds: context.requirementIds },
      reviewer: { kind: "independent_model" as const, task: "quality_reviewer" as const, verdict: "rejected" as const },
      checks: { schema: true, scope: true, answer: false, provenance: true, rendering: true },
      findings: [{ code: "answer", severity: "blocking" as const, message: "Incomplete.", repairInstruction: "Repair at the assessment owner." }],
    };
    const record = { schemaVersion: 1 as const, recordId: questionBankItemReviewRecordId(unsigned), ...unsigned };
    let calls = 0;
    await expect(repairQuestionBankItem({
      config, content, sourceText: "Evidence", item, review: record, requestContract: contract,
      codex: { run: async () => { calls += 1; return "{}"; } },
    })).rejects.toThrow("assessment-owned item");
    expect(calls).toBe(0);
  });

  it("greedily batches nine exact repairs with bounded concurrency and fewer characters", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "nine-item-batch-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Create interactive practice", kind: "study-guide", runDir });
    const contract = minimalRequestContract(config.originalUserPrompt, [config.kind]);
    const content = studyGuideContentSchema.parse({
      courseTitle: "Course", courseCode: "C1", scopeNote: "Bounded evidence.", sources: [{ id: "s1", label: "Script", url: "", coverage: "Topic" }],
      topics: [{ id: "topic", title: "Topic", learningGoals: ["Explain"], theory: { summary: "Grounded summary.", keyIdeas: [], formulas: [] }, workedExamples: [], retrieval: [], exercises: Array.from({ length: 9 }, (_, index) => application(`repair-${index + 1}`, `Incomplete answer ${index + 1}.`)) }],
    });
    const items = buildAdaptiveStudyModel(content, "Evidence", "en").questionBank.items;
    const context = questionReviewContext(config.originalUserPrompt, contract);
    const targets = items.map((item) => {
      const unsigned = {
        itemId: item.id, contentHash: item.contentHash,
        contract: { contractHash: context.contractHash, originalPromptHash: context.originalPromptHash, requirementIds: context.requirementIds },
        reviewer: { kind: "independent_model" as const, task: "quality_reviewer" as const, verdict: "rejected" as const },
        checks: { schema: true, scope: true, answer: false, provenance: true, rendering: true },
        findings: [{ code: "answer", severity: "blocking" as const, message: "Incomplete.", repairInstruction: "Complete this answer." }],
      };
      return { item, review: { schemaVersion: 1 as const, recordId: questionBankItemReviewRecordId(unsigned), ...unsigned } };
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let actualCharacters = 0;
    const input = {
      config, content, sourceText: "Evidence", requestContract: contract, targets,
      codex: { run: async (prompt: string, options: { outputSchema?: unknown }) => {
        calls += 1; active += 1; maxActive = Math.max(maxActive, active);
        actualCharacters += prompt.length + JSON.stringify(options.outputSchema).length;
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const repairItems = [...prompt.matchAll(/Repair target:\n([^\n]+)/g)].map((match) =>
          (JSON.parse(match[1]!) as { item: typeof items[number] }).item
        );
        return JSON.stringify({ repairs: repairItems.map((item) => ({
          itemId: item.id, previousContentHash: item.contentHash,
          exercise: { ...item.exercise, sampleAnswer: `${String((item.exercise as { sampleAnswer: string }).sampleAnswer)} Complete.` },
        })) });
      } },
    };
    const metrics = questionBankItemRepairBatchMetrics(input);
    const repairs = await resolveQuestionBankItemRepairBatch(input);

    expect(repairs).toHaveLength(9);
    expect(calls).toBe(metrics.batchCalls);
    expect(calls).toBeLessThan(9);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(actualCharacters).toBe(metrics.batchedCharacters);
    expect(metrics.batchedCharacters).toBeLessThan(metrics.isolatedCharacters);
  });
});

function application(id: string, sampleAnswer: string) {
  return {
    id, type: "application" as const, prompt: `Explain and apply the concept in item ${id}.`,
    instructions: ["Explain the principle.", "Apply it to the case."], sampleAnswer,
    selfCheck: ["The principle is stated.", "The application is justified."],
    source: { label: "Script", sourceTask: `Task ${id}`, provenance: "derived" as const },
  };
}
