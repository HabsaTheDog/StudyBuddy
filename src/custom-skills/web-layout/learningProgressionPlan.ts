import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  hashRequestContract,
  RequestContractSchema,
  type RequestContract,
} from "../shared/requestContract.js";
import type { QuestionBank } from "./adaptiveStudyModel.js";
import type { CodexClient } from "./codexClient.js";
import { balancedExcerpt } from "./modelText.js";
import type { WebLayoutRuntimeConfig } from "./types.js";

const intentSchema = z.enum(["minimum", "foundation", "application", "depth", "assessment"]);
const difficultySchema = z.enum(["basic", "standard", "advanced", "assessment"]);

const persistedProgressionPlanSchema = z.object({
  schemaVersion: z.literal(1),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  originalPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
  bankHash: z.string().regex(/^[a-f0-9]{64}$/),
  stages: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    intent: intentSchema,
  })).min(1).max(5),
  placements: z.array(z.object({
    itemId: z.string().min(1),
    itemHash: z.string().regex(/^[a-f0-9]{64}$/),
    learningObjectiveIds: z.array(z.string().min(1)).min(1),
    stageId: z.string().min(1),
    difficulty: difficultySchema,
    evidenceReason: z.string().min(1),
  })),
});

const modelProgressionDecisionSchema = z.object({
  schemaVersion: z.literal(2),
  stages: z.array(z.object({
    label: z.string().min(1),
    description: z.string().min(1),
    intent: intentSchema,
  })).min(1).max(5),
  placements: z.array(z.object({
    itemNumber: z.number().int().min(1),
    stageNumber: z.number().int().min(1),
    difficulty: difficultySchema,
    evidenceReason: z.string().min(1),
  })),
});

export const learningProgressionPlanSchema = persistedProgressionPlanSchema.extend({
  originalUserPrompt: z.string().min(1),
  requestContract: RequestContractSchema,
});

export type LearningProgressionPlan = z.infer<typeof learningProgressionPlanSchema>;

const planJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "stages", "placements"],
  properties: {
    schemaVersion: { type: "number", enum: [2] },
    stages: {
      type: "array", minItems: 1, maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        required: ["label", "description", "intent"],
        properties: {
          label: { type: "string" }, description: { type: "string" },
          intent: { type: "string", enum: ["minimum", "foundation", "application", "depth", "assessment"] },
        },
      },
    },
    placements: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["itemNumber", "stageNumber", "difficulty", "evidenceReason"],
        properties: {
          itemNumber: { type: "number" },
          stageNumber: { type: "number" },
          difficulty: { type: "string", enum: ["basic", "standard", "advanced", "assessment"] },
          evidenceReason: { type: "string" },
        },
      },
    },
  },
} as const;

const PROGRESSION_PROMPT_TARGET_CHARS = 40_000;

export interface ProgressionBinding {
  originalUserPrompt: string;
  requestContract: RequestContract;
}

export function progressionBindingMatches(
  plan: LearningProgressionPlan | undefined,
  binding: ProgressionBinding | undefined,
): boolean {
  if (!plan || !binding) return false;
  const context = progressionContext(binding);
  return plan.originalUserPrompt === binding.originalUserPrompt &&
    hashRequestContract(plan.requestContract) === context.contractHash &&
    plan.contractHash === context.contractHash &&
    plan.originalPromptHash === context.originalPromptHash;
}

export function matchingProgressionPlacement(
  plan: LearningProgressionPlan | undefined,
  item: QuestionBank["items"][number],
  binding: ProgressionBinding | undefined,
) {
  if (!progressionBindingMatches(plan, binding)) return undefined;
  const placement = plan!.placements.find((candidate) => candidate.itemId === item.id);
  return placement &&
    placement.itemHash === progressionItemHash(item) &&
    sameStrings(placement.learningObjectiveIds, item.learningObjectiveIds)
    ? placement
    : undefined;
}

export function progressionItemHash(item: QuestionBank["items"][number]): string {
  return sha256(JSON.stringify({
    id: item.id,
    legacyExerciseId: item.legacyExerciseId,
    topicId: item.topicId,
    learningObjectiveIds: [...item.learningObjectiveIds].sort(),
    type: item.type,
    origin: item.origin,
    scopeBasis: item.scopeBasis,
    exercise: item.exercise,
  }));
}

export function progressionBankHash(questionBank: QuestionBank): string {
  return sha256(JSON.stringify(questionBank.items.map((item) => ({
    id: item.id,
    hash: progressionItemHash(item),
  })).sort((left, right) => left.id.localeCompare(right.id))));
}

export function compatibleProgressionPlan(
  plan: LearningProgressionPlan | undefined,
  questionBank: QuestionBank,
  binding: ProgressionBinding | undefined,
): boolean {
  if (!progressionBindingMatches(plan, binding)) return false;
  if (
    plan!.bankHash !== progressionBankHash(questionBank)
  ) return false;
  const stageIds = new Set(plan!.stages.map((stage) => stage.id));
  if (stageIds.size !== plan!.stages.length || plan!.placements.length !== questionBank.items.length) return false;
  const placements = new Map(plan!.placements.map((placement) => [placement.itemId, placement]));
  if (placements.size !== plan!.placements.length) return false;
  return questionBank.items.every((item) => {
    const placement = placements.get(item.id);
    return placement?.itemHash === progressionItemHash(item) &&
      stageIds.has(placement.stageId) &&
      sameStrings(placement.learningObjectiveIds, item.learningObjectiveIds);
  });
}

export async function resolveLearningProgressionPlan(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  sourceText: string;
  questionBank: QuestionBank;
  requestContract: RequestContract;
}): Promise<LearningProgressionPlan> {
  const binding = { originalUserPrompt: input.config.originalUserPrompt, requestContract: input.requestContract };
  const context = progressionContext(binding);
  const bankHash = progressionBankHash(input.questionBank);
  const fingerprint = sha256(JSON.stringify({ version: "learning-progression-v2", ...context, bankHash }));
  const cacheRoot = process.env.VITEST === "true"
    ? path.join(input.config.runDir, "learning-progression-cache")
    : path.join(process.cwd(), "study-buddy-data", "cache", "web-layout", "learning-progression");
  const cachePath = path.join(cacheRoot, `${fingerprint}.json`);
  const cached = await readPlan(cachePath);
  if (cached && compatibleProgressionPlan(cached, input.questionBank, binding)) {
    await persistRun(input.config.runDir, cached);
    return cached;
  }
  const prompt = buildLearningProgressionPrompt(input, context, bankHash);
  const failures: string[] = [];
  let firstResponse: string | undefined;
  try {
    firstResponse = await input.codex.run(prompt, {
      task: "content_analyzer",
      attempt: 1,
      outputSchema: planJsonSchema,
      timeoutMs: 180_000,
    });
    const plan = materializeModelDecision(firstResponse, input, context, bankHash);
    await persistAdaptivePlan(cachePath, input.config.runDir, plan);
    await persistDiagnostic(input.config.runDir, "adaptive", []);
    return plan;
  } catch (error) {
    failures.push(errorMessage(error));
  }

  if (firstResponse !== undefined) {
    try {
      const repairedResponse = await input.codex.run(
        buildLearningProgressionRepairPrompt(prompt, firstResponse, failures[0]!),
        {
          task: "content_repair",
          attempt: 1,
          outputSchema: planJsonSchema,
          timeoutMs: 120_000,
        },
      );
      const plan = materializeModelDecision(repairedResponse, input, context, bankHash);
      await persistAdaptivePlan(cachePath, input.config.runDir, plan);
      await persistDiagnostic(input.config.runDir, "repaired", failures);
      return plan;
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  const fallback = neutralProgressionPlan(input, context, bankHash);
  await persistRun(input.config.runDir, fallback);
  await persistDiagnostic(input.config.runDir, "neutral_fallback", failures);
  await input.config.diagnostics?.log(
    "warn",
    "planner",
    "Adaptive learning-stage planning was unavailable; publishing the validated bank in one transparent neutral stage.",
    { failures },
  );
  return fallback;
}

export function buildLearningProgressionPrompt(
  input: Pick<Parameters<typeof resolveLearningProgressionPlan>[0], "config" | "sourceText" | "questionBank" | "requestContract">,
  context = progressionContext({
    originalUserPrompt: input.config.originalUserPrompt,
    requestContract: input.requestContract,
  }),
  bankHash = progressionBankHash(input.questionBank),
): string {
  const prefix = [
    "LEARNING_PROGRESSION_PLANNER",
    "Create an evidence- and request-adaptive learning progression for the supplied validated question bank. Return JSON only.",
    "Choose between one and five coherent stages. Course-appropriate labels are welcome, but do not use a subject template, fixed stage count, question-type ladder, per-stage quota, or array position as pedagogy.",
    "Place every numbered item exactly once. Base placement and difficulty on the original request, evaluated contract, evidenced objectives, source task, answer contract, prerequisite demand, transfer depth, and documented assessment role. Two items with the same type may belong to different stages; different types may belong to the same stage.",
    "Use intent only as a portable semantic tag. Use assessment only when evidence and the contract support assessment-oriented practice. evidenceReason must explain the item-local decision.",
    "Return only semantic decisions. itemNumber and stageNumber are one-based positions from the supplied arrays. Never return item IDs, hashes, contract hashes, bank hashes, or learning-objective IDs; Study Buddy binds those trusted fields after your decision.",
    `Exact original request:\n${input.config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(input.requestContract)}`,
    `System context for evaluation only; do not reproduce it:\n${JSON.stringify({ ...context, bankHash })}`,
  ].join("\n\n");
  const itemLegend = [
    "Validated item rows use this exact field order:",
    '["itemNumber","type","origin","assessmentSectionId","assessmentQuestionTypes","topicTitle","scopeLearningObjectives","scopeSourceTask","prompt","responseContract"]',
    'responseContract rows begin with "cross", "calculation", "application", or "vocabulary" and retain the complete type-specific answer-contract structure.',
  ].join("\n");
  const attempts = [320, 180, 96, 48, 24].map((textLimit) => {
    const items = JSON.stringify(input.questionBank.items.map((item, index) =>
      progressionPlannerItemView(item, index, textLimit)
    ));
    const withoutEvidence = `${prefix}\n\n${itemLegend}\n\nValidated items:\n${items}\n\nEvidence excerpt:\n`;
    const evidenceBudget = Math.max(
      0,
      Math.min(8_000, PROGRESSION_PROMPT_TARGET_CHARS - withoutEvidence.length),
    );
    const evidence = evidenceBudget > 0
      ? balancedExcerpt(input.sourceText, evidenceBudget)
      : "";
    return `${withoutEvidence}${evidence}`;
  });
  const prompt = attempts.find((candidate) => candidate.length <= PROGRESSION_PROMPT_TARGET_CHARS);
  if (!prompt) {
    throw new Error(
      `Learning progression planner cannot represent all ${input.questionBank.items.length} items inside its ${PROGRESSION_PROMPT_TARGET_CHARS}-character semantic budget.`,
    );
  }
  return prompt;
}

function progressionPlannerItemView(
  item: QuestionBank["items"][number],
  index: number,
  textLimit: number,
) {
  const clip = (value: string) => compactSemanticText(value, textLimit);
  const responseContract = item.exercise.type === "cross"
    ? [
        "cross",
        item.exercise.selectionMode,
        item.exercise.options.map((option) => [clip(option.text), option.correct]),
        clip(item.exercise.explanation),
      ]
    : item.exercise.type === "calculation"
      ? [
          "calculation",
          item.exercise.givens.map(clip),
          item.exercise.acceptedAnswers.map(clip),
          item.exercise.unit,
          item.exercise.steps.map(clip),
          clip(item.exercise.commonMistake),
        ]
      : item.exercise.type === "application"
        ? [
            "application",
            item.exercise.instructions.map(clip),
            clip(item.exercise.sampleAnswer),
            item.exercise.selfCheck.map(clip),
          ]
        : [
            "vocabulary",
            item.exercise.direction,
            clip(item.exercise.term),
            item.exercise.acceptedAnswers.map(clip),
            clip(item.exercise.context),
            clip(item.exercise.explanation),
          ];
  return [
    index + 1,
    item.type,
    item.origin,
    item.assessmentSectionId ?? null,
    item.assessmentQuestionTypes ?? [],
    clip(item.scopeBasis.topicTitle),
    item.scopeBasis.learningObjectives.map(clip),
    clip(item.scopeBasis.sourceTask),
    clip(item.exercise.prompt),
    responseContract,
  ];
}

function materializeModelDecision(
  response: string,
  input: Pick<Parameters<typeof resolveLearningProgressionPlan>[0], "config" | "questionBank" | "requestContract">,
  context: ReturnType<typeof progressionContext>,
  bankHash: string,
): LearningProgressionPlan {
  const decision = modelProgressionDecisionSchema.parse(JSON.parse(stripJsonFence(response)));
  const expected = input.questionBank.items.length;
  const byNumber = new Map<number, (typeof decision.placements)[number]>();
  const duplicates: number[] = [];
  const outOfRange: number[] = [];
  for (const placement of decision.placements) {
    if (placement.itemNumber > expected || placement.stageNumber > decision.stages.length) {
      outOfRange.push(placement.itemNumber);
      continue;
    }
    if (byNumber.has(placement.itemNumber)) duplicates.push(placement.itemNumber);
    byNumber.set(placement.itemNumber, placement);
  }
  const missing = input.questionBank.items
    .map((_, index) => index + 1)
    .filter((itemNumber) => !byNumber.has(itemNumber));
  if (duplicates.length || outOfRange.length || missing.length || byNumber.size !== expected) {
    throw new Error(
      `Progression decision coverage mismatch: expected ${expected}; missing [${missing.join(",")}]; duplicate [${duplicates.join(",")}]; out-of-range [${outOfRange.join(",")}].`,
    );
  }
  const stages = decision.stages.map((stage, index) => ({
    ...stage,
    id: `stage-${index + 1}`,
  }));
  return learningProgressionPlanSchema.parse({
    schemaVersion: 1,
    ...context,
    bankHash,
    originalUserPrompt: input.config.originalUserPrompt,
    requestContract: input.requestContract,
    stages,
    placements: input.questionBank.items.map((item, index) => {
      const semantic = byNumber.get(index + 1)!;
      return {
        itemId: item.id,
        itemHash: progressionItemHash(item),
        learningObjectiveIds: item.learningObjectiveIds,
        stageId: stages[semantic.stageNumber - 1]!.id,
        difficulty: semantic.difficulty,
        evidenceReason: semantic.evidenceReason,
      };
    }),
  });
}

function buildLearningProgressionRepairPrompt(
  originalPrompt: string,
  previousResponse: string,
  diagnostic: string,
): string {
  return [
    "LEARNING_PROGRESSION_REPAIR",
    "Repair only the semantic learning-progression decision below. Return one complete corrected JSON decision using the same compact schema.",
    "Do not regenerate learning content. Do not copy or invent technical IDs or hashes. Keep good stage decisions where possible and fix the diagnosed coverage or shape problem.",
    originalPrompt,
    `Orchestrator diagnostic:\n${diagnostic}`,
    `Previous decision:\n${compactSemanticText(previousResponse, 8_000)}`,
  ].join("\n\n");
}

function neutralProgressionPlan(
  input: Pick<Parameters<typeof resolveLearningProgressionPlan>[0], "config" | "questionBank" | "requestContract">,
  context: ReturnType<typeof progressionContext>,
  bankHash: string,
): LearningProgressionPlan {
  const stage = {
    id: "stage-1",
    label: input.config.language === "de" ? "Gesamter Lernpfad" : "Complete learning path",
    description: input.config.language === "de"
      ? "Alle validierten Lernobjekte bleiben verfügbar; eine feinere adaptive Einordnung war für diesen Lauf nicht zuverlässig möglich."
      : "All validated learning objects remain available; a finer adaptive placement was not reliable for this run.",
    intent: "minimum" as const,
  };
  return learningProgressionPlanSchema.parse({
    schemaVersion: 1,
    ...context,
    bankHash,
    originalUserPrompt: input.config.originalUserPrompt,
    requestContract: input.requestContract,
    stages: [stage],
    placements: input.questionBank.items.map((item) => ({
      itemId: item.id,
      itemHash: progressionItemHash(item),
      learningObjectiveIds: item.learningObjectiveIds,
      stageId: stage.id,
      difficulty: "standard" as const,
      evidenceReason: input.config.language === "de"
        ? "Systemgebundene neutrale Einordnung nach nicht zuverlässiger adaptiver Planung."
        : "System-bound neutral placement after adaptive planning was not reliable.",
    })),
  });
}

async function persistAdaptivePlan(cachePath: string, runDir: string, plan: LearningProgressionPlan): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await persistRun(runDir, plan);
}

async function persistDiagnostic(
  runDir: string,
  status: "adaptive" | "repaired" | "neutral_fallback",
  failures: string[],
): Promise<void> {
  await writeFile(
    path.join(runDir, "learning-progression-diagnostic.json"),
    `${JSON.stringify({ schemaVersion: 1, status, failures }, null, 2)}\n`,
    "utf8",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactSemanticText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = " … [bounded] … ";
  const available = Math.max(2, limit - marker.length);
  const start = Math.ceil(available * 0.7);
  return `${value.slice(0, start)}${marker}${value.slice(value.length - (available - start))}`;
}

function progressionContext(binding: ProgressionBinding) {
  return {
    contractHash: hashRequestContract(binding.requestContract),
    originalPromptHash: sha256(binding.originalUserPrompt),
  };
}

async function persistRun(runDir: string, plan: LearningProgressionPlan): Promise<void> {
  await writeFile(path.join(runDir, "learning-progression-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

async function readPlan(filePath: string): Promise<LearningProgressionPlan | null> {
  try { return learningProgressionPlanSchema.parse(JSON.parse(await readFile(filePath, "utf8"))); } catch { return null; }
}

function sameStrings(left: string[], right: string[]): boolean {
  const a = [...left].sort(); const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stripJsonFence(value: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value.trim());
  return match ? match[1].trim() : value.trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
