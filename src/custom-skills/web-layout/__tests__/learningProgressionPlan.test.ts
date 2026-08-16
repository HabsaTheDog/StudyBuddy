import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashRequestContract, minimalRequestContract } from "../../shared/requestContract.js";
import { buildAdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import {
  buildLearningProgressionPrompt,
  compatibleProgressionPlan,
  resolveLearningProgressionPlan,
  progressionBankHash,
  progressionItemHash,
  type LearningProgressionPlan,
  type ProgressionBinding,
} from "../learningProgressionPlan.js";
import type { StudyGuideContent } from "../studyGuideContent.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("request-bound learning progression", () => {
  it("changes progression for different intent/evidence without using item type or list position as a rule", async () => {
    const content = progressionContent();
    const draft = buildAdaptiveStudyModel(content, "Validated course evidence.", "en");
    expect(draft.questionBank.items).toHaveLength(2);
    expect(new Set(draft.questionBank.items.map((item) => item.type))).toEqual(new Set(["cross"]));
    expect(new Set(draft.questionBank.items.flatMap((item) => item.learningObjectiveIds)).size).toBe(1);
    expect(draft.questionBank.items.every((item) =>
      item.stageIntent === "minimum" && item.difficulty === "standard"
    )).toBe(true);

    const rehearsal = await plannedModel({
      content,
      draft,
      prompt: "Build confidence first, then challenge my misconception.",
      evidence: "The first source task is introductory; the second diagnoses a documented misconception.",
      swap: false,
    });
    const diagnostic = await plannedModel({
      content,
      draft,
      prompt: "Start with the misconception diagnostic, then consolidate the introductory relation.",
      evidence: "Assessment evidence prioritizes the misconception diagnostic before consolidation.",
      swap: true,
    });
    const byLegacyId = (model: ReturnType<typeof buildAdaptiveStudyModel>) =>
      Object.fromEntries(model.questionBank.items.map((item) => [item.legacyExerciseId, {
        stage: item.stageLabel,
        intent: item.stageIntent,
        difficulty: item.difficulty,
      }]));

    expect(byLegacyId(rehearsal)).toEqual({
      "same-type-intro": { stage: "Establish the relation", intent: "foundation", difficulty: "basic" },
      "same-type-misconception": { stage: "Challenge the model", intent: "depth", difficulty: "advanced" },
    });
    expect(byLegacyId(diagnostic)).toEqual({
      "same-type-intro": { stage: "Consolidate", intent: "application", difficulty: "standard" },
      "same-type-misconception": { stage: "Diagnose first", intent: "assessment", difficulty: "assessment" },
    });
  });

  it("fails closed when a supplied plan belongs to a different request contract", () => {
    const content = progressionContent();
    const draft = buildAdaptiveStudyModel(content, "Validated course evidence.", "en");
    const originalUserPrompt = "Build a confidence-first guide.";
    const requestContract = minimalRequestContract(originalUserPrompt, ["interactive-study-guide"]);
    const plan: LearningProgressionPlan = {
      schemaVersion: 1,
      originalUserPrompt,
      requestContract,
      contractHash: hashRequestContract(requestContract),
      originalPromptHash: createHash("sha256").update(originalUserPrompt).digest("hex"),
      bankHash: progressionBankHash(draft.questionBank),
      stages: [{
        id: "evidence-stage",
        label: "Evidence stage",
        description: "A request-bound stage.",
        intent: "application",
      }],
      placements: draft.questionBank.items.map((item) => ({
        itemId: item.id,
        itemHash: progressionItemHash(item),
        learningObjectiveIds: item.learningObjectiveIds,
        stageId: "evidence-stage",
        difficulty: "standard",
        evidenceReason: "The current request and evidence support this placement.",
      })),
    };
    const wrongPrompt = "Build an assessment-first guide.";
    const wrongContract = minimalRequestContract(wrongPrompt, ["interactive-study-guide"]);

    expect(() => buildAdaptiveStudyModel(
      content,
      "Validated course evidence.",
      "en",
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
      { originalUserPrompt: wrongPrompt, requestContract: wrongContract },
    )).toThrow(/different request contract/i);
  });

  it("keeps every semantic item decision inside the model budget without asking the model to echo trusted IDs or hashes", () => {
    const content = progressionContent();
    const draft = buildAdaptiveStudyModel(content, "Validated course evidence.", "en");
    const seed = draft.questionBank.items[0]!;
    const items = Array.from({ length: 48 }, (_, index) => ({
      ...structuredClone(seed),
      id: `large-bank-item-${index}`,
      legacyExerciseId: `large-bank-legacy-${index}`,
      exercise: {
        ...structuredClone(seed.exercise),
        id: `large-bank-legacy-${index}`,
        prompt: `${index}: ${"Detailed source-grounded learning prompt. ".repeat(180)}`,
      },
    }));
    const promptText = "Plan a progression for the complete large bank.";
    const requestContract = minimalRequestContract(promptText, ["interactive-study-guide"]);
    const config = createWebLayoutRuntimeConfig({
      prompt: promptText,
      originalUserPrompt: promptText,
      kind: "study-guide",
      runDir: "/tmp/large-progression-prompt-test",
    });
    const prompt = buildLearningProgressionPrompt({
      config,
      sourceText: "Long evidence passage. ".repeat(20_000),
      questionBank: { ...draft.questionBank, items },
      requestContract,
    });

    expect(prompt.length).toBeLessThanOrEqual(50_000);
    for (const item of items) {
      expect(prompt).not.toContain(item.id);
      expect(prompt).not.toContain(progressionItemHash(item));
    }
    expect(prompt).toContain("Validated item rows use this exact field order");
    expect(prompt).toContain('"itemNumber"');
    expect(prompt).toContain('"estimatedMinutes"');
    expect(prompt).toContain("a long difficult task may carry more preparation value than several short prompts");
    expect(prompt).toContain("[bounded]");
  });

  it("lets the orchestrator repair an incomplete semantic decision and binds trusted fields itself", async () => {
    const content = progressionContent();
    const draft = buildAdaptiveStudyModel(content, "Validated course evidence.", "en");
    const prompt = "Build a confidence-first guide.";
    const requestContract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const runDir = await mkdtemp(path.join(os.tmpdir(), "learning-progression-repair-"));
    temporaryDirectories.push(runDir);
    const tasks: string[] = [];
    const plan = await resolveLearningProgressionPlan({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      sourceText: "Validated course evidence.",
      questionBank: draft.questionBank,
      requestContract,
      codex: {
        run: async (modelPrompt, options) => {
          tasks.push(options.task);
          if (options.task === "content_analyzer") {
            return JSON.stringify({
              schemaVersion: 2,
              stages: [{ label: "Foundation", description: "Start with the relation.", intent: "foundation" }],
              placements: [{ itemNumber: 1, stageNumber: 1, difficulty: "basic", evidenceReason: "The first item establishes the relation." }],
            });
          }
          expect(modelPrompt).toContain("LEARNING_PROGRESSION_REPAIR");
          expect(modelPrompt).toContain("missing [2]");
          return JSON.stringify({
            schemaVersion: 2,
            stages: [{ label: "Foundation", description: "Use both validated questions.", intent: "foundation" }],
            placements: draft.questionBank.items.map((_, index) => ({
              itemNumber: index + 1,
              stageNumber: 1,
              difficulty: index === 0 ? "basic" : "standard",
              evidenceReason: "The repaired complete decision follows the request and evidence.",
            })),
          });
        },
      },
    });

    expect(tasks).toEqual(["content_analyzer", "content_repair"]);
    expect(compatiblePlan(plan, draft.questionBank, prompt, requestContract)).toBe(true);
    expect(plan.placements.map((placement) => placement.itemId)).toEqual(draft.questionBank.items.map((item) => item.id));
    expect(JSON.parse(await readFile(path.join(runDir, "learning-progression-diagnostic.json"), "utf8")).status).toBe("repaired");
  });

  it("publishes a transparent neutral stage instead of failing the whole guide when adaptive planning is unavailable", async () => {
    const content = progressionContent();
    const draft = buildAdaptiveStudyModel(content, "Validated course evidence.", "en");
    const prompt = "Build an interactive guide.";
    const requestContract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const runDir = await mkdtemp(path.join(os.tmpdir(), "learning-progression-fallback-"));
    temporaryDirectories.push(runDir);
    let calls = 0;
    const plan = await resolveLearningProgressionPlan({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      sourceText: "Validated course evidence.",
      questionBank: draft.questionBank,
      requestContract,
      codex: {
        run: async () => {
          calls += 1;
          throw new Error("model unavailable");
        },
      },
    });

    expect(calls).toBe(1);
    expect(plan.stages).toEqual([expect.objectContaining({ id: "stage-1", label: "Complete learning path" })]);
    expect(plan.placements).toHaveLength(draft.questionBank.items.length);
    expect(compatiblePlan(plan, draft.questionBank, prompt, requestContract)).toBe(true);
    expect(JSON.parse(await readFile(path.join(runDir, "learning-progression-diagnostic.json"), "utf8"))).toMatchObject({
      status: "neutral_fallback",
      failures: ["model unavailable"],
    });
  });
});

async function plannedModel(input: {
  content: StudyGuideContent;
  draft: ReturnType<typeof buildAdaptiveStudyModel>;
  prompt: string;
  evidence: string;
  swap: boolean;
}) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "learning-progression-"));
  temporaryDirectories.push(runDir);
  const requestContract = minimalRequestContract(input.prompt, ["interactive-study-guide"]);
  const config = createWebLayoutRuntimeConfig({
    prompt: input.prompt,
    originalUserPrompt: input.prompt,
    kind: "study-guide",
    runDir,
  });
  const plan = await resolveLearningProgressionPlan({
    config,
    sourceText: input.evidence,
    questionBank: input.draft.questionBank,
    requestContract,
    codex: {
      run: async (prompt) => {
        expect(prompt).toContain(`Exact original request:\n${input.prompt}`);
        expect(prompt).toContain(input.evidence);
        expect(prompt).toContain("do not use a subject template, fixed stage count");
        const [first, second] = input.draft.questionBank.items;
        const stages = input.swap
          ? [
              { label: "Diagnose first", description: "Use the evidenced diagnostic first.", intent: "assessment" },
              { label: "Consolidate", description: "Consolidate after the diagnostic.", intent: "application" },
            ]
          : [
              { label: "Establish the relation", description: "Establish the evidenced relation.", intent: "foundation" },
              { label: "Challenge the model", description: "Challenge the documented misconception.", intent: "depth" },
            ];
        return JSON.stringify({
          schemaVersion: 2,
          stages,
          placements: [first!, second!].map((_, index) => ({
            itemNumber: index + 1,
            stageNumber: input.swap
              ? index === 0 ? 2 : 1
              : index === 0 ? 1 : 2,
            difficulty: input.swap
              ? index === 0 ? "standard" : "assessment"
              : index === 0 ? "basic" : "advanced",
            evidenceReason: input.swap
              ? "The current request prioritizes diagnostic evidence."
              : "The current request asks to build confidence before challenge.",
          })),
        });
      },
    },
  });
  const binding: ProgressionBinding = { originalUserPrompt: input.prompt, requestContract };
  const result = buildAdaptiveStudyModel(
    input.content,
    input.evidence,
    "en",
    undefined,
    undefined,
    undefined,
    undefined,
    plan,
    binding,
  );
  const persisted = JSON.parse(
    await readFile(path.join(runDir, "learning-progression-plan.json"), "utf8"),
  );
  expect(persisted.contractHash).toBe(plan.contractHash);
  expect(persisted.originalUserPrompt).toBe(input.prompt);
  expect(persisted.requestContract).toEqual(requestContract);
  return result;
}

function compatiblePlan(
  plan: LearningProgressionPlan,
  questionBank: ReturnType<typeof buildAdaptiveStudyModel>["questionBank"],
  originalUserPrompt: string,
  requestContract: ReturnType<typeof minimalRequestContract>,
): boolean {
  const binding: ProgressionBinding = { originalUserPrompt, requestContract };
  return compatibleProgressionPlan(plan, questionBank, binding);
}

function progressionContent(): StudyGuideContent {
  const source = (sourceTask: string) => ({
    label: "Course reader",
    sourceTask,
    provenance: "source" as const,
  });
  return {
    courseTitle: "Evidence progression test",
    courseCode: "EPT",
    scopeNote: "Only the supplied evidence is in scope.",
    topics: [{
      id: "relation",
      title: "Documented relation",
      learningGoals: ["Explain the documented relation."],
      theory: { summary: "A documented relation with one known misconception.", keyIdeas: ["Relation"], formulas: [] },
      workedExamples: [],
      exercises: [
        crossExercise("same-type-intro", "Which statement establishes the documented relation?", source("Introductory relation check")),
        crossExercise("same-type-misconception", "Which statement corrects the documented misconception?", source("Misconception diagnostic")),
      ],
      retrieval: [],
    }],
    sources: [{ id: "reader", label: "Course reader", url: "", coverage: "Relation and misconception" }],
  };
}

function crossExercise(id: string, prompt: string, source: { label: string; sourceTask: string; provenance: "source" }) {
  return {
    id,
    type: "cross" as const,
    prompt,
    selectionMode: "single" as const,
    options: [
      { text: "Supported statement", correct: true, feedback: "Supported by the evidence." },
      { text: "Documented misconception", correct: false, feedback: "This is the misconception." },
    ],
    explanation: "The supported statement follows from the supplied course evidence.",
    source,
  };
}
