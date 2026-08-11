import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashRequestContract, type RequestContract } from "../shared/requestContract.js";
import type { QuestionBank } from "./adaptiveStudyModel.js";
import type { CodexClient } from "./codexClient.js";
import { balancedExcerpt } from "./modelText.js";
import { studyGuideContentJsonSchema, studyGuideContentSchema, studyGuideExerciseSchema, type StudyGuideContent } from "./studyGuideContent.js";
import type { WebLayoutRuntimeConfig } from "./types.js";
import type { QuestionBankItemReviewRecord } from "./questionBankReview.js";

const modelRepairSchema = z.object({
  itemId: z.string().min(1),
  previousContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  exercise: z.record(z.string(), z.unknown()),
});
const modelRepairBatchSchema = z.object({ repairs: z.array(modelRepairSchema) });
const modelRepairBatchJsonSchema = {
  type: "object", additionalProperties: false, required: ["repairs"],
  properties: {
    repairs: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["itemId", "previousContentHash", "exercise"],
        properties: {
          itemId: { type: "string" }, previousContentHash: { type: "string" },
          // Structured Outputs rejects `oneOf`. The canonical chapter author
          // already uses this production-proven flat exercise shape; strict
          // type-specific validation happens after irrelevant fields are
          // removed below.
          exercise: studyGuideContentJsonSchema.properties.topics.items.properties.exercises.items,
        },
      },
    },
  },
  $defs: studyGuideContentJsonSchema.$defs,
} as const;

const ITEM_REPAIR_PROMPT_BUDGET = 55_000;
const ITEM_REPAIR_MAX_CONCURRENCY = 3;
const ITEM_REPAIR_MAX_BATCH_CALLS = 6;

export function questionBankItemRepairBatchMetrics(input: Parameters<typeof resolveQuestionBankItemRepairBatch>[0]) {
  const batches = buildRepairBatches(input, input.targets);
  const schemaCharacters = JSON.stringify(modelRepairBatchJsonSchema).length;
  return {
    itemCount: input.targets.length,
    batchCalls: batches.length,
    maxConcurrency: Math.min(ITEM_REPAIR_MAX_CONCURRENCY, batches.length),
    batchedCharacters: batches.reduce((sum, batch) => sum + buildRepairPrompt(input, batch).length + schemaCharacters, 0),
    isolatedCalls: input.targets.length,
    isolatedCharacters: input.targets.reduce((sum, target) => sum + buildRepairPrompt(input, [target]).length + schemaCharacters, 0),
  };
}

export async function repairQuestionBankItem(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  content: StudyGuideContent;
  sourceText: string;
  item: QuestionBank["items"][number];
  review: QuestionBankItemReviewRecord;
  requestContract: RequestContract;
}): Promise<StudyGuideContent> {
  const repair = await resolveQuestionBankItemRepair(input);
  return applyQuestionBankItemRepairs(input.content, [repair]);
}

export interface QuestionBankItemRepair {
  item: QuestionBank["items"][number];
  exercise: z.infer<typeof studyGuideExerciseSchema>;
}

export async function resolveQuestionBankItemRepair(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  content: StudyGuideContent;
  sourceText: string;
  item: QuestionBank["items"][number];
  review: QuestionBankItemReviewRecord;
  requestContract: RequestContract;
}): Promise<QuestionBankItemRepair> {
  const [repair] = await resolveQuestionBankItemRepairBatch({
    config: input.config,
    codex: input.codex,
    content: input.content,
    sourceText: input.sourceText,
    requestContract: input.requestContract,
    targets: [{ item: input.item, review: input.review }],
  });
  return repair!;
}

export async function resolveQuestionBankItemRepairBatch(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  content: StudyGuideContent;
  sourceText: string;
  requestContract: RequestContract;
  targets: Array<{ item: QuestionBank["items"][number]; review: QuestionBankItemReviewRecord }>;
}): Promise<QuestionBankItemRepair[]> {
  const resolved = new Map<string, QuestionBankItemRepair>();
  const pending: typeof input.targets = [];
  for (const target of input.targets) {
    assertRepairOwner(target.item);
    const cached = await readRepair(repairCachePath(input, target), { ...input, ...target });
    if (cached) resolved.set(itemKey(target.item), { item: target.item, exercise: cached });
    else pending.push(target);
  }
  const batches = buildRepairBatches(input, pending);
  if (batches.length > ITEM_REPAIR_MAX_BATCH_CALLS) {
    throw new Error(`Item-local repair needs ${batches.length} model calls and exceeds its ${ITEM_REPAIR_MAX_BATCH_CALLS}-call round bound.`);
  }
  const generated = (await mapWithConcurrency(
    batches,
    ITEM_REPAIR_MAX_CONCURRENCY,
    async (batch) => resolveCompleteRepairBatch(input, batch),
  )).flat();
  // Commit caches only after every parallel batch has complete valid coverage.
  await Promise.all(generated.map(async (repair) => {
    const target = pending.find(({ item }) => itemKey(item) === itemKey(repair.item))!;
    await writeFile(repairCachePath(input, target), `${JSON.stringify({
      itemId: repair.item.id, previousContentHash: repair.item.contentHash, exercise: repair.exercise,
    }, null, 2)}\n`, "utf8");
    resolved.set(itemKey(repair.item), repair);
  }));
  return input.targets.map(({ item }) => {
    const repair = resolved.get(itemKey(item));
    if (!repair) throw new Error(`Item-local repair lost result for ${item.id}.`);
    return repair;
  });
}

async function resolveCompleteRepairBatch(
  input: Parameters<typeof resolveQuestionBankItemRepairBatch>[0],
  batch: Parameters<typeof resolveQuestionBankItemRepairBatch>[0]["targets"],
): Promise<QuestionBankItemRepair[]> {
  const resolved = new Map<string, QuestionBankItemRepair>();
  let pending = batch;
  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt += 1) {
    const response = await input.codex.run(buildRepairPrompt(input, pending), {
      task: "content_repair", attempt, outputSchema: modelRepairBatchJsonSchema, timeoutMs: 120_000,
    });
    const candidate = modelRepairBatchSchema.parse(JSON.parse(stripJsonFence(response)));
    const expected = new Map(pending.map((target) => [itemKey(target.item), target]));
    for (const value of candidate.repairs) {
      const key = `${value.itemId}\0${value.previousContentHash}`;
      const target = expected.get(key);
      if (!target || resolved.has(key)) {
        throw new Error("Item-local repair batch returned a stale, duplicate, or unsolicited identity.");
      }
      expected.delete(key);
      resolved.set(key, { item: target.item, exercise: validateReplacement(value, { ...input, ...target }) });
    }
    pending = pending.filter(({ item }) => !resolved.has(itemKey(item)));
  }
  if (pending.length > 0) {
    throw new Error(
      `Item-local repair omitted ${pending.length} exact requested identit${pending.length === 1 ? "y" : "ies"} after three missing-only attempts: ` +
      pending.map(({ item }) => item.id).join(", "),
    );
  }
  return batch.map(({ item }) => resolved.get(itemKey(item))!);
}

function assertRepairOwner(item: QuestionBank["items"][number]): void {
  if (item.assessmentSectionId) {
    throw new Error(
      `Item-local repair cannot rewrite assessment-owned item ${item.id} inside course content. ` +
      `The documented assessment section '${item.assessmentSectionId}' remains unpublished and must be repaired by its assessment owner.`,
    );
  }
}

function repairCachePath(
  input: Pick<Parameters<typeof resolveQuestionBankItemRepairBatch>[0], "config" | "requestContract">,
  target: { item: QuestionBank["items"][number]; review: QuestionBankItemReviewRecord },
): string {
  const fingerprint = sha256(JSON.stringify({
    version: "question-bank-item-repair-v1",
    itemId: target.item.id,
    contentHash: target.item.contentHash,
    reviewRecordId: target.review.recordId,
    contractHash: hashRequestContract(input.requestContract),
    originalPrompt: input.config.originalUserPrompt,
  }));
  return path.join(input.config.runDir, `question-bank-item-repair-${fingerprint}.json`);
}

function buildRepairPrompt(
  input: Parameters<typeof resolveQuestionBankItemRepairBatch>[0],
  targets: Parameters<typeof resolveQuestionBankItemRepairBatch>[0]["targets"],
): string {
  const itemBlocks = targets.map(({ item, review }) => {
    const topic = input.content.topics.find((candidate) => candidate.id === item.topicId);
    if (!topic) throw new Error(`Item-local repair cannot locate topic ${item.topicId}.`);
    return `Repair target:\n${JSON.stringify({
      item,
      independentReviewRecord: review,
      localTopicContext: { id: topic.id, title: topic.title, learningGoals: topic.learningGoals, theory: topic.theory },
      authorizedEvidence: itemEvidenceExcerpt(input.sourceText, item, 4_000),
    })}`;
  });
  return [
    "QUESTION_BANK_ITEM_LOCAL_REPAIR",
    `Repair exactly ${targets.length} supplied rejected learning item(s) and return JSON only with repairs[]. Do not create a chapter, additional items, quotas, or neighboring subject tasks. Return exactly one repair for every supplied identity and no others.`,
    "Keep itemId, previousContentHash, exercise.id, exercise.type, and each complete source object exact. Preserve objectives and response modes. Change only fields required by each independent finding. Every result must be fully answerable and internally correct.",
    "For cross return a truthful selection contract and targeted feedback; calculation needs complete givens/units/derivation; application needs an executable prompt, useful comparison answer and explicit rubric; vocabulary needs a meaningful in-scope term/context/answer contract. Do not add calculation fields to another mode.",
    "The flat Structured Output exercise object requires every field. Fill fields for exercise.type and use selectionMode=none, direction=none, empty arrays, and empty strings for irrelevant fields; the orchestrator removes those sentinels before strict validation.",
    `Exact original request:\n${input.config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(input.requestContract)}`,
    ...itemBlocks,
  ].join("\n\n");
}

function buildRepairBatches(
  input: Parameters<typeof resolveQuestionBankItemRepairBatch>[0],
  targets: Parameters<typeof resolveQuestionBankItemRepairBatch>[0]["targets"],
) {
  const schemaChars = JSON.stringify(modelRepairBatchJsonSchema).length;
  const batches: typeof input.targets[] = [];
  let current: typeof input.targets = [];
  for (const target of targets) {
    const candidate = [...current, target];
    if (buildRepairPrompt(input, candidate).length + schemaChars <= ITEM_REPAIR_PROMPT_BUDGET) {
      current = candidate;
      continue;
    }
    if (current.length > 0) batches.push(current);
    current = [target];
    if (buildRepairPrompt(input, current).length + schemaChars > ITEM_REPAIR_PROMPT_BUDGET) {
      throw new Error(`Item-local repair cannot represent complete item ${target.item.id} within its prompt/schema budget.`);
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index]!);
    }
  }
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return results;
}

function validateReplacement(
  value: z.infer<typeof modelRepairSchema>,
  input: Parameters<typeof repairQuestionBankItem>[0],
) {
  if (value.itemId !== input.item.id || value.previousContentHash !== input.item.contentHash) {
    throw new Error(`Item-local repair returned stale identity for ${input.item.id}.`);
  }
  const normalized = normalizeModelExercise(value.exercise);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error(`Item-local repair returned an invalid exercise for ${input.item.id}.`);
  }
  const exercise = studyGuideExerciseSchema.parse({
    ...normalized,
    source: structuredClone(input.item.exercise.source),
    evidenceRefs: structuredClone(input.item.exercise.evidenceRefs),
  });
  if (exercise.id !== input.item.legacyExerciseId || exercise.type !== input.item.type) {
    throw new Error(`Item-local repair changed stable exercise identity or response mode for ${input.item.id}.`);
  }
  if (JSON.stringify(exercise.source) !== JSON.stringify(input.item.exercise.source)) {
    throw new Error(`Item-local repair changed the reviewed source/provenance basis for ${input.item.id}.`);
  }
  if (JSON.stringify(exercise) === JSON.stringify(input.item.exercise)) {
    throw new Error(`Item-local repair did not change rejected item ${input.item.id}.`);
  }
  return exercise;
}

export function applyQuestionBankItemRepairs(
  content: StudyGuideContent,
  repairs: QuestionBankItemRepair[],
): StudyGuideContent {
  const clone = structuredClone(content);
  for (const { item, exercise } of repairs) applyExerciseRepair(clone, item, exercise);
  return studyGuideContentSchema.parse(clone);
}

function normalizeModelExercise(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = value as Record<string, unknown>;
  const common = {
    id: item.id,
    type: item.type,
    prompt: item.prompt,
    source: item.source,
    evidenceRefs: item.evidenceRefs,
  };
  if (item.type === "cross") {
    return { ...common, selectionMode: item.selectionMode, options: item.options, explanation: item.explanation };
  }
  if (item.type === "calculation") {
    return {
      ...common,
      givens: item.givens,
      acceptedAnswers: item.acceptedAnswers,
      unit: item.unit,
      steps: item.steps,
      commonMistake: item.commonMistake,
    };
  }
  if (item.type === "application") {
    return { ...common, instructions: item.instructions, sampleAnswer: item.sampleAnswer, selfCheck: item.selfCheck };
  }
  if (item.type === "vocabulary") {
    return {
      ...common,
      direction: item.direction,
      term: item.term,
      acceptedAnswers: item.acceptedAnswers,
      context: item.context,
      explanation: item.explanation,
    };
  }
  return value;
}

function applyExerciseRepair(
  content: StudyGuideContent,
  item: QuestionBank["items"][number],
  exercise: z.infer<typeof studyGuideExerciseSchema>,
): void {
  const topic = content.topics.find((candidate) => candidate.id === item.topicId);
  if (!topic) throw new Error(`Item-local repair cannot locate topic ${item.topicId}.`);
  const index = topic.exercises.findIndex((candidate) => candidate.id === item.legacyExerciseId);
  if (index >= 0) topic.exercises[index] = exercise;
  else {
    const match = new RegExp(`^${escapeRegExp(topic.id)}-retrieval-(\\d+)$`).exec(item.legacyExerciseId);
    const retrievalIndex = match ? Number(match[1]) - 1 : -1;
    if (retrievalIndex < 0 || !topic.retrieval[retrievalIndex]) {
      throw new Error(`Item-local repair does not own generated item ${item.id}; fail closed instead of regenerating its chapter.`);
    }
    // Preserve the slot so later retrieval IDs and hashes remain stable. The
    // builder ignores this retired short entry and uses the exact replacement.
    topic.retrieval[retrievalIndex] = { prompt: "-", answer: "-" };
    topic.exercises.push(exercise);
  }
}

async function readRepair(
  filePath: string,
  input: Parameters<typeof repairQuestionBankItem>[0],
): Promise<z.infer<typeof studyGuideExerciseSchema> | null> {
  try {
    const value = modelRepairSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    return validateReplacement(value, input);
  } catch {
    return null;
  }
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function itemEvidenceExcerpt(sourceText: string, item: QuestionBank["items"][number], limit: number): string {
  const lower = sourceText.toLocaleLowerCase();
  const anchor = [item.scopeBasis.sourceTask, item.scopeBasis.sourceLabel, item.scopeBasis.topicTitle]
    .map((value) => value.trim())
    .filter((value) => value.length >= 4)
    .map((value) => lower.indexOf(value.toLocaleLowerCase()))
    .find((index) => index >= 0);
  if (anchor === undefined) return balancedExcerpt(sourceText, limit);
  const start = Math.max(0, anchor - Math.floor(limit * 0.35));
  return sourceText.slice(start, start + limit);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function itemKey(item: Pick<QuestionBank["items"][number], "id" | "contentHash">): string {
  return `${item.id}\0${item.contentHash}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
