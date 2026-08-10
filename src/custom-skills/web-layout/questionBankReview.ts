import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  hashRequestContract,
  type RequestContract,
} from "../shared/requestContract.js";
import type { QuestionBank } from "./adaptiveStudyModel.js";
import type { CodexClient } from "./codexClient.js";
import { balancedExcerpt } from "./modelText.js";
import type { StudyGuideContent } from "./studyGuideContent.js";
import type { WebLayoutRuntimeConfig } from "./types.js";
import { readExtractionHandoff } from "./studyGuideProfile.js";

const reviewCheckSchema = z.object({
  schema: z.boolean(),
  scope: z.boolean(),
  answer: z.boolean(),
  provenance: z.boolean(),
  rendering: z.boolean(),
});

const reviewFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["blocking", "advisory"]),
  message: z.string().min(1),
  repairInstruction: z.string().min(1),
});

export const questionBankItemReviewRecordSchema = z.object({
  schemaVersion: z.literal(1),
  recordId: z.string().regex(/^[a-f0-9]{64}$/),
  itemId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidence: z.object({
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    capsuleHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceHandoffHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).optional(),
  contract: z.object({
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    originalPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
    requirementIds: z.array(z.string().min(1)),
  }),
  reviewer: z.object({
    kind: z.literal("independent_model"),
    task: z.literal("quality_reviewer"),
    verdict: z.enum(["approved", "rejected", "evidence_unavailable"]),
  }),
  checks: reviewCheckSchema,
  findings: z.array(reviewFindingSchema).max(12),
});

export const questionBankReviewSetSchema = z.object({
  schemaVersion: z.literal(1),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  originalPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
  records: z.array(questionBankItemReviewRecordSchema),
});

export type QuestionBankItemReviewRecord = z.infer<typeof questionBankItemReviewRecordSchema>;
export type QuestionBankReviewSet = z.infer<typeof questionBankReviewSetSchema>;
export type UnsignedQuestionBankItemReviewRecord = Omit<
  QuestionBankItemReviewRecord,
  "schemaVersion" | "recordId"
>;

const modelReviewSetSchema = z.object({
  records: z.array(z.object({
    itemId: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    // Evidence availability is determined by the trusted capsule resolver
    // before a model call. A semantic reviewer may only approve or reject.
    verdict: z.enum(["approved", "rejected"]),
    checks: reviewCheckSchema,
    findings: z.array(reviewFindingSchema).max(12),
  })),
});

const modelReviewSetJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["records"],
  properties: {
    records: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "itemId",
          "contentHash",
          "verdict",
          "checks",
          "findings",
        ],
        properties: {
          itemId: { type: "string" },
          contentHash: { type: "string" },
          verdict: { type: "string", enum: ["approved", "rejected"] },
          checks: {
            type: "object",
            additionalProperties: false,
            required: ["schema", "scope", "answer", "provenance", "rendering"],
            properties: {
              schema: { type: "boolean" },
              scope: { type: "boolean" },
              answer: { type: "boolean" },
              provenance: { type: "boolean" },
              rendering: { type: "boolean" },
            },
          },
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "severity", "message", "repairInstruction"],
              properties: {
                code: { type: "string" },
                severity: { type: "string", enum: ["blocking", "advisory"] },
                message: { type: "string" },
                repairInstruction: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const QUESTION_REVIEW_PROMPT_TARGET_CHARS = 40_000;
const QUESTION_REVIEW_MAX_CONCURRENCY = 3;

interface ReviewContext {
  contractHash: string;
  originalPromptHash: string;
  requirementIds: string[];
}

interface QuestionEvidenceRef {
  sourceIds: string[];
  sectionIndex: number;
  sectionHeading: string;
  learningGoalIndexes: number[];
  exactSpan?: { start: number; end: number; sha256: string };
}

export interface QuestionEvidenceCapsule {
  itemId: string;
  refs: QuestionEvidenceRef[];
  passages: Array<{
    sectionIndex: number;
    sectionHeading: string;
    sourceIds: string[];
    text: string;
  }>;
}

export type QuestionEvidenceCapsuleResult =
  | {
      status: "available";
      capsule: QuestionEvidenceCapsule;
      evidenceHash: string;
      capsuleHash: string;
      sourceHandoffHash: string;
    }
  | {
      status: "evidence_unavailable";
      evidenceHash: string | null;
      sourceHandoffHash: string;
      reason: string;
    };

export function questionReviewContext(
  originalUserPrompt: string,
  requestContract: RequestContract,
): ReviewContext {
  const interactiveDeliverableIds = interactiveContractDeliverableIds(requestContract);
  const relevantRequirementIds = new Set(requestContract.requirements
    .filter((requirement) => requirement.appliesTo.some((id) => interactiveDeliverableIds.has(id)))
    .map((requirement) => requirement.id));
  const assigned = requestContract.reviewAssignments
    .filter((assignment) => ["source", "content", "interaction"].includes(assignment.owner))
    .flatMap((assignment) => assignment.requirementIds)
    .filter((id) => relevantRequirementIds.has(id));
  return {
    contractHash: hashRequestContract(requestContract),
    originalPromptHash: sha256(originalUserPrompt),
    requirementIds: [...new Set(assigned.length > 0
      ? assigned
      : [...relevantRequirementIds])].sort(),
  };
}

export function interactiveContractDeliverableIds(contract: RequestContract): Set<string> {
  const explicitInteractive = contract.deliverables.filter((deliverable) =>
    /(?:interactive|html|web|study[-_ ]?guide)/i.test(deliverable.kind)
  );
  const selected = explicitInteractive.length > 0
    ? explicitInteractive
    : contract.deliverables.filter((deliverable) => !/(?:pdf|document|print)/i.test(deliverable.kind));
  return new Set((selected.length > 0 ? selected : contract.deliverables).map((deliverable) => deliverable.id));
}

export function buildQuestionEvidenceCapsule(
  sourceText: string,
  item: QuestionBank["items"][number],
): QuestionEvidenceCapsuleResult {
  const handoff = readExtractionHandoff(sourceText);
  const sourceHandoffHash = sha256(handoff ? JSON.stringify(handoff) : sourceText);
  const scopeBasis = item.scopeBasis as typeof item.scopeBasis & {
    evidenceRefs?: QuestionEvidenceRef[];
    evidenceHash?: string;
  };
  const refs = scopeBasis.evidenceRefs;
  const evidenceHash = scopeBasis.evidenceHash ?? null;
  if (!evidenceHash || !Array.isArray(refs) || refs.length === 0) {
    return {
      status: "evidence_unavailable",
      evidenceHash,
      sourceHandoffHash,
      reason: "The item has no stable section/source evidence references.",
    };
  }

  const sections = handoff?.sections;
  const passages: QuestionEvidenceCapsule["passages"] = [];
  for (const ref of refs) {
    const section = Array.isArray(sections) ? sections[ref.sectionIndex] : undefined;
    const heading = section && typeof section.heading === "string" ? section.heading.trim() : "";
    const summary = section && typeof section.summary === "string" ? section.summary : "";
    const sourceIds = section && Array.isArray(section.source_ids) ? section.source_ids.map(String) : [];
    if (
      !section ||
      !summary.trim() ||
      heading !== ref.sectionHeading.trim() ||
      !ref.sourceIds.every((sourceId) => sourceIds.includes(sourceId))
    ) {
      return {
        status: "evidence_unavailable",
        evidenceHash,
        sourceHandoffHash,
        reason: `Stable evidence reference for section ${ref.sectionIndex} (${ref.sectionHeading}) does not resolve in this handoff.`,
      };
    }
    let text = summary;
    if (ref.exactSpan) {
      const { start, end } = ref.exactSpan;
      if (start < 0 || end <= start || end > summary.length) {
        return {
          status: "evidence_unavailable",
          evidenceHash,
          sourceHandoffHash,
          reason: `Evidence span for section ${ref.sectionIndex} is outside the resolved section summary.`,
        };
      }
      text = summary.slice(start, end);
      if (sha256(text) !== ref.exactSpan.sha256) {
        return {
          status: "evidence_unavailable",
          evidenceHash,
          sourceHandoffHash,
          reason: `Evidence span hash for section ${ref.sectionIndex} does not match this handoff.`,
        };
      }
    }
    passages.push({
      sectionIndex: ref.sectionIndex,
      sectionHeading: heading,
      sourceIds: [...ref.sourceIds],
      text,
    });
  }

  const capsule: QuestionEvidenceCapsule = {
    itemId: item.id,
    refs: structuredClone(refs),
    passages,
  };
  return {
    status: "available",
    capsule,
    evidenceHash,
    capsuleHash: sha256(JSON.stringify(capsule)),
    sourceHandoffHash,
  };
}

export function matchingApprovedQuestionReview(
  records: QuestionBankReviewSet | undefined,
  item: Pick<QuestionBank["items"][number], "id" | "contentHash">,
  context: ReviewContext,
): QuestionBankItemReviewRecord | undefined {
  if (
    !records ||
    records.contractHash !== context.contractHash ||
    records.originalPromptHash !== context.originalPromptHash
  ) return undefined;
  return records.records.find((record) =>
    record.itemId === item.id &&
    record.contentHash === item.contentHash &&
    record.contract.contractHash === context.contractHash &&
    record.contract.originalPromptHash === context.originalPromptHash &&
    sameStrings(record.contract.requirementIds, context.requirementIds) &&
    record.reviewer.verdict === "approved" &&
    Object.values(record.checks).every(Boolean) &&
    record.findings.every((finding) => finding.severity !== "blocking") &&
    record.recordId === questionBankItemReviewRecordId(unsignedRecord(record))
  );
}

export function questionBankItemContentHash(item: Pick<
  QuestionBank["items"][number],
  "exercise" | "referenceSolution" | "visual"
> & Partial<Pick<QuestionBank["items"][number], "scopeBasis">
>): string {
  return sha256(JSON.stringify({
    exercise: item.exercise,
    referenceSolution: item.referenceSolution,
    visual: item.visual,
    evidenceHash: (item.scopeBasis as { evidenceHash?: string } | undefined)?.evidenceHash,
  }));
}

export function questionBankItemReviewRecordId(
  record: UnsignedQuestionBankItemReviewRecord,
): string {
  return sha256(JSON.stringify({
    version: "question-bank-item-review-v2-evidence-capsule",
    itemId: record.itemId,
    contentHash: record.contentHash,
    evidence: record.evidence,
    contract: record.contract,
    reviewer: record.reviewer,
    checks: record.checks,
    findings: record.findings,
  }));
}

/**
 * Renderer-side defense in depth. Contract/prompt ownership is verified when
 * the review set is attached; this proves everything independently verifiable
 * from the embedded item and sealed review record before publication.
 */
export function assertQuestionBankItemPublishable(
  item: QuestionBank["items"][number],
): QuestionBankItemReviewRecord {
  if (item.review.status !== "approved") {
    throw new Error(`Question-bank publication gate rejected ${item.id}: item review is not approved.`);
  }
  const parsed = questionBankItemReviewRecordSchema.safeParse(item.review.record);
  if (!parsed.success) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: embedded review record is malformed.`);
  }
  const record = parsed.data;
  if (record.itemId !== item.id || record.contentHash !== item.contentHash) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: embedded review record is stale or belongs to another item.`);
  }
  if (item.contentHash !== questionBankItemContentHash(item)) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: item content does not match its reviewed content hash.`);
  }
  const itemEvidenceHash = (item.scopeBasis as { evidenceHash?: string }).evidenceHash;
  if (!itemEvidenceHash || record.evidence?.evidenceHash !== itemEvidenceHash) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: review evidence binding is missing or stale.`);
  }
  if (
    record.reviewer.verdict !== "approved" ||
    !Object.values(record.checks).every(Boolean) ||
    record.findings.some((finding) => finding.severity === "blocking")
  ) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: independent reviewer verdict is not publishable.`);
  }
  if (
    !sameStrings(item.review.findings, record.findings.map((finding) => finding.message)) ||
    !sameChecks(item.review.checks, record.checks)
  ) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: embedded review summary is inconsistent with its record.`);
  }
  if (record.recordId !== questionBankItemReviewRecordId(unsignedRecord(record))) {
    throw new Error(`Question-bank publication gate rejected ${item.id}: embedded review record seal is invalid.`);
  }
  return record;
}

export function assertQuestionBankPublishable(questionBank: QuestionBank): void {
  for (const item of questionBank.items) assertQuestionBankItemPublishable(item);
}

export async function resolveQuestionBankReviews(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  content: StudyGuideContent;
  sourceText: string;
  questionBank: QuestionBank;
  requestContract: RequestContract;
  priorError: string | null;
  /** Semantic rejections are returned for an item-local disposition pass. */
  allowRejected?: boolean;
  /** Rebuild and re-review only these unchanged items instead of accepting a matching cache record. */
  forceEvidenceRebuildItemIds?: readonly string[];
}): Promise<QuestionBankReviewSet> {
  const context = questionReviewContext(input.config.originalUserPrompt, input.requestContract);
  const records: QuestionBankItemReviewRecord[] = [];
  const pending: QuestionBank["items"] = [];
  const evidenceByItem = new Map(input.questionBank.items.map((item) => [
    item.id,
    buildQuestionEvidenceCapsule(input.sourceText, item),
  ]));
  const forced = new Set(input.forceEvidenceRebuildItemIds ?? []);
  for (const item of input.questionBank.items) {
    const evidence = evidenceByItem.get(item.id)!;
    if (evidence.status === "evidence_unavailable") {
      records.push(evidenceUnavailableRecord(item, context, evidence));
      continue;
    }
    const cached = forced.has(item.id)
      ? null
      : await readCachedRecord(cachePath(item, context, evidence, input.config.runDir));
    if (cached && recordMatches(cached, item, context, evidence)) records.push(cached);
    else pending.push(item);
  }
  const batches = buildQuestionReviewBatches(input, pending, context);
  const reviewedBatches = await reviewQuestionBatches(input, batches, context);
  for (const reviewed of reviewedBatches) {
    for (const review of reviewed.records) {
      const evidence = evidenceByItem.get(review.itemId);
      if (!evidence || evidence.status !== "available") {
        throw new Error(`Question review lost the complete evidence capsule for ${review.itemId}.`);
      }
      const evidenceBinding = {
        evidenceHash: evidence.evidenceHash,
        capsuleHash: evidence.capsuleHash,
        sourceHandoffHash: evidence.sourceHandoffHash,
      };
      const record = questionBankItemReviewRecordSchema.parse({
        schemaVersion: 1,
        recordId: questionBankItemReviewRecordId({
          itemId: review.itemId,
          contentHash: review.contentHash,
          evidence: evidenceBinding,
          contract: {
            contractHash: context.contractHash,
            originalPromptHash: context.originalPromptHash,
            requirementIds: context.requirementIds,
          },
          reviewer: {
            kind: "independent_model",
            task: "quality_reviewer",
            verdict: review.verdict,
          },
          checks: review.checks,
          findings: review.findings,
        }),
        itemId: review.itemId,
        contentHash: review.contentHash,
        evidence: evidenceBinding,
        contract: {
          contractHash: context.contractHash,
          originalPromptHash: context.originalPromptHash,
          requirementIds: context.requirementIds,
        },
        reviewer: {
          kind: "independent_model",
          task: "quality_reviewer",
          verdict: review.verdict,
        },
        checks: review.checks,
        findings: review.findings,
      });
      records.push(record);
      await persistCachedRecord(
        cachePath({ id: record.itemId, contentHash: record.contentHash }, context, evidence, input.config.runDir),
        record,
      );
    }
  }
  const result = questionBankReviewSetSchema.parse({
    schemaVersion: 1,
    contractHash: context.contractHash,
    originalPromptHash: context.originalPromptHash,
    records: input.questionBank.items.map((item) =>
      records.find((record) => record.itemId === item.id && record.contentHash === item.contentHash)
    ).filter((record): record is QuestionBankItemReviewRecord => Boolean(record)),
  });
  await writeFile(
    path.join(input.config.runDir, "question-bank-reviews.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  const rejected = rejectedQuestionBankReviewDiagnostics(input.questionBank, result);
  if (rejected.length > 0 && !input.allowRejected) {
    throw new Error(`Question-bank item review failed:\n- ${rejected.join("\n- ")}`);
  }
  return result;
}

function evidenceUnavailableRecord(
  item: QuestionBank["items"][number],
  context: ReviewContext,
  evidence: Extract<QuestionEvidenceCapsuleResult, { status: "evidence_unavailable" }>,
): QuestionBankItemReviewRecord {
  const unsigned: UnsignedQuestionBankItemReviewRecord = {
    itemId: item.id,
    contentHash: item.contentHash,
    contract: {
      contractHash: context.contractHash,
      originalPromptHash: context.originalPromptHash,
      requirementIds: context.requirementIds,
    },
    reviewer: {
      kind: "independent_model",
      task: "quality_reviewer",
      verdict: "evidence_unavailable",
    },
    checks: { schema: false, scope: false, answer: false, provenance: false, rendering: false },
    findings: [{
      code: "evidence-unavailable",
      severity: "blocking",
      message: evidence.reason,
      repairInstruction: "Rebuild the item-local evidence capsule and review the unchanged item again.",
    }],
  };
  return questionBankItemReviewRecordSchema.parse({
    schemaVersion: 1,
    recordId: questionBankItemReviewRecordId(unsigned),
    ...unsigned,
  });
}

export function rejectedQuestionBankReviewDiagnostics(
  questionBank: QuestionBank,
  result: QuestionBankReviewSet,
): string[] {
  return questionBank.items.flatMap((item) => {
    const record = result.records.find((candidate) =>
      candidate.itemId === item.id && candidate.contentHash === item.contentHash
    );
    if (
      record &&
      record.reviewer.verdict === "approved" &&
      Object.values(record.checks).every(Boolean) &&
      record.findings.every((finding) => finding.severity !== "blocking")
    ) return [];
    const blockingFindings = record?.findings.filter((finding) => finding.severity === "blocking") ?? [];
    const findings = blockingFindings.length > 0
      ? blockingFindings
      : [{
          code: "missing-review",
          severity: "blocking" as const,
          message: record
            ? "The independent review did not produce a publishable approval for this exact item."
            : "No matching independent review record was produced.",
          repairInstruction: record
            ? "Repair the failed checks for this item and review its new content hash."
            : "Review this exact item and return its stable itemId and contentHash.",
        }];
    const prefix = record?.reviewer.verdict === "evidence_unavailable"
      ? "evidence unavailable"
      : "item";
    return findings.map((finding) =>
      `[${prefix} ${item.id}; exercise ${item.legacyExerciseId}; hash ${item.contentHash}] ${finding.message} ${finding.repairInstruction}`
    );
  });
}

export function rejectedQuestionBankItems(
  questionBank: QuestionBank,
  result: QuestionBankReviewSet,
): QuestionBank["items"] {
  return questionBank.items.filter((item) => !matchingPublishableRecord(result, item));
}

function matchingPublishableRecord(
  result: QuestionBankReviewSet,
  item: Pick<QuestionBank["items"][number], "id" | "contentHash">,
): QuestionBankItemReviewRecord | undefined {
  return result.records.find((record) =>
    record.itemId === item.id &&
    record.contentHash === item.contentHash &&
    record.reviewer.verdict === "approved" &&
    Object.values(record.checks).every(Boolean) &&
    record.findings.every((finding) => finding.severity !== "blocking") &&
    record.recordId === questionBankItemReviewRecordId(unsignedRecord(record))
  );
}

export function buildQuestionReviewPrompt(
  input: Parameters<typeof resolveQuestionBankReviews>[0],
  items: QuestionBank["items"],
  context: ReviewContext,
  repairError: string | null = priorItemDiagnostics(input.priorError, items),
): string {
  const capsules = items.map((item) => {
    const evidence = buildQuestionEvidenceCapsule(input.sourceText, item);
    if (evidence.status !== "available") {
      throw new Error(`Question review evidence unavailable for ${item.id}: ${evidence.reason}`);
    }
    return evidence.capsule;
  });
  const fixedPrompt = [
    "QUESTION_BANK_ITEM_REVIEWER",
    "Independently review each supplied adaptive Study Buddy question-bank item. Return JSON only and exactly one record per item.",
    "Judge each item on the exact original request, evaluated request contract, supplied course evidence, and its own response contract. Do not impose worked examples, calculations, retrieval, images, task counts, type ratios, or subject templates unless the contract requires them.",
    "Approve only when the item is in scope, answerable as written, internally correct, source/provenance claims are honest, and the declared interaction can render and assess its answer or rubric. A generated variant may use stable disciplinary knowledge only inside an evidenced topic and must not invent official course or assessment facts. Treat each item-local evidence capsule as the complete authorized grounding context for that item; never use another item's capsule.",
    "Every included capsule has already passed the deterministic evidence resolver. You may return only approved or rejected. If the supplied capsule does not support an item's claim, return rejected with provenance=false and an unsupported-provenance finding; do not request an evidence rebuild. Only the orchestrator, before this model call, may classify structurally missing or tampered evidence as evidence_unavailable.",
    "Set every check independently. verdict=approved requires every check=true and no blocking finding. Otherwise verdict=rejected and give concise item-local findings with an executable repairInstruction; never request rebuilding unrelated items or changing global quantities.",
    "Return only each itemId, its exact contentHash, the verdict, checks, and findings. The pipeline binds and seals approved records to the already verified request contract; do not copy cryptographic contract or prompt hashes into the model output.",
    `Language: ${input.config.language}`,
    `Exact original request:\n${input.config.originalUserPrompt}`,
    `Contract reference:\n${JSON.stringify(context)}`,
    `Evaluated request contract:\n${JSON.stringify(input.requestContract)}`,
    repairError ? `Prior item-local diagnostics:\n${repairError}` : "",
    `Items to review:\n${JSON.stringify(items.map((item) => ({
      itemId: item.id,
      legacyExerciseId: item.legacyExerciseId,
      contentHash: item.contentHash,
      topicId: item.topicId,
      learningObjectiveIds: item.learningObjectiveIds,
      origin: item.origin,
      scopeBasis: item.scopeBasis,
      exercise: item.exercise,
      referenceSolution: item.referenceSolution,
    })))}`,
    `Complete item-local evidence capsules:\n${JSON.stringify(capsules)}`,
  ].filter(Boolean).join("\n\n");
  if (fixedPrompt.length > QUESTION_REVIEW_PROMPT_TARGET_CHARS) {
    throw new Error(
      `Question review cannot represent ${items.length} complete item(s) and their complete evidence capsules inside its ${QUESTION_REVIEW_PROMPT_TARGET_CHARS}-character prompt budget.`,
    );
  }
  return fixedPrompt;
}

function buildQuestionReviewBatches(
  input: Parameters<typeof resolveQuestionBankReviews>[0],
  items: QuestionBank["items"],
  context: ReviewContext,
): QuestionBank["items"][] {
  const batches: QuestionBank["items"][] = [];
  let current: QuestionBank["items"] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (questionReviewPromptFits(input, candidate, context)) {
      current = candidate;
      continue;
    }
    if (current.length > 0) batches.push(current);
    current = [item];
    if (!questionReviewPromptFits(input, current, context)) {
      throw new Error(
        `Question review cannot represent complete item ${item.id} inside its ${QUESTION_REVIEW_PROMPT_TARGET_CHARS}-character prompt budget.`,
      );
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function reviewQuestionBatches(
  input: Parameters<typeof resolveQuestionBankReviews>[0],
  batches: QuestionBank["items"][],
  context: ReviewContext,
): Promise<Array<z.infer<typeof modelReviewSetSchema>>> {
  const results = new Array<z.infer<typeof modelReviewSetSchema>>(batches.length);
  const failures: Array<{ index: number; error: unknown }> = [];
  let nextIndex = 0;
  let stop = false;
  const workerCount = Math.min(QUESTION_REVIEW_MAX_CONCURRENCY, batches.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!stop) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= batches.length) return;
      try {
        results[index] = await reviewQuestionBatch(input, batches[index]!, context);
      } catch (error) {
        failures.push({ index, error });
        stop = true;
      }
    }
  }));

  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index);
    throw failures[0]!.error;
  }
  return results;
}

async function reviewQuestionBatch(
  input: Parameters<typeof resolveQuestionBankReviews>[0],
  batch: QuestionBank["items"],
  context: ReviewContext,
): Promise<z.infer<typeof modelReviewSetSchema>> {
  let repairError = priorItemDiagnostics(input.priorError, batch);
  let finalError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await input.codex.run(
        buildQuestionReviewPrompt(input, batch, context, repairError),
        {
          task: "quality_reviewer",
          attempt,
          outputSchema: modelReviewSetJsonSchema,
          timeoutMs: 180_000,
        },
      );
      const candidate = modelReviewSetSchema.parse(JSON.parse(stripJsonFence(response)));
      assertExactCoverage(candidate.records, batch);
      return candidate;
    } catch (error) {
      finalError = error;
      repairError = reviewErrorMessage(error);
      await input.config.diagnostics?.log(
        "warn",
        "planner",
        `Question review batch [${batch.map((item) => item.id).join(", ")}] attempt ${attempt}/3 invalid: ${repairError}`,
      );
    }
  }
  throw new Error(
    `Question review batch failed after 3 local attempts: ${reviewErrorMessage(finalError)}`,
  );
}

function questionReviewPromptFits(
  input: Parameters<typeof resolveQuestionBankReviews>[0],
  items: QuestionBank["items"],
  context: ReviewContext,
): boolean {
  try {
    return buildQuestionReviewPrompt(input, items, context).length <= QUESTION_REVIEW_PROMPT_TARGET_CHARS;
  } catch {
    return false;
  }
}

function priorItemDiagnostics(
  value: string | null,
  items: QuestionBank["items"],
): string | null {
  if (!value || !/question[- ]bank item review|question reviewer|question review batch/i.test(value)) return null;
  const ids = items.map((item) => item.id);
  const lines = value.split("\n").filter((line) => ids.some((id) => line.includes(id)));
  return lines.length > 0 ? exactBudgetExcerpt(lines.join("\n"), 4_000) : null;
}

function reviewErrorMessage(error: unknown): string {
  return exactBudgetExcerpt(error instanceof Error ? error.message : String(error), 4_000);
}

function exactBudgetExcerpt(value: string, budget: number): string {
  if (budget <= 0) return "";
  if (value.length <= budget) return value;
  const excerpt = balancedExcerpt(value, Math.max(1, budget - 512));
  return excerpt.length <= budget ? excerpt : excerpt.slice(0, budget);
}

function assertExactCoverage(
  reviews: z.infer<typeof modelReviewSetSchema>["records"],
  items: QuestionBank["items"],
): void {
  const expected = new Map(items.map((item) => [item.id, item.contentHash]));
  if (reviews.length !== expected.size) {
    throw new Error(`Question reviewer returned ${reviews.length} records for ${expected.size} items.`);
  }
  const seen = new Set<string>();
  for (const review of reviews) {
    if (seen.has(review.itemId) || expected.get(review.itemId) !== review.contentHash) {
      throw new Error(`Question reviewer returned a duplicate, unknown, or stale record for ${review.itemId}.`);
    }
    if (
      review.verdict === "approved" &&
      (!Object.values(review.checks).every(Boolean) || review.findings.some((finding) => finding.severity === "blocking"))
    ) {
      throw new Error(`Question reviewer returned an inconsistent approval for ${review.itemId}.`);
    }
    seen.add(review.itemId);
  }
}

function recordMatches(
  record: QuestionBankItemReviewRecord,
  item: Pick<QuestionBank["items"][number], "id" | "contentHash">,
  context: ReviewContext,
  evidence: Extract<QuestionEvidenceCapsuleResult, { status: "available" }>,
): boolean {
  return record.itemId === item.id &&
    record.contentHash === item.contentHash &&
    record.evidence?.evidenceHash === evidence.evidenceHash &&
    record.evidence.capsuleHash === evidence.capsuleHash &&
    record.evidence.sourceHandoffHash === evidence.sourceHandoffHash &&
    record.contract.contractHash === context.contractHash &&
    record.contract.originalPromptHash === context.originalPromptHash &&
    sameStrings(record.contract.requirementIds, context.requirementIds) &&
    record.recordId === questionBankItemReviewRecordId(unsignedRecord(record));
}

function unsignedRecord(record: QuestionBankItemReviewRecord): UnsignedQuestionBankItemReviewRecord {
  return {
    itemId: record.itemId,
    contentHash: record.contentHash,
    evidence: record.evidence,
    contract: record.contract,
    reviewer: record.reviewer,
    checks: record.checks,
    findings: record.findings,
  };
}

function cachePath(
  item: Pick<QuestionBank["items"][number], "id" | "contentHash">,
  context: ReviewContext,
  evidence: Extract<QuestionEvidenceCapsuleResult, { status: "available" }>,
  runDir: string,
): string {
  const root = process.env.VITEST === "true"
    ? path.join(runDir, "question-bank-review-cache")
    : path.join(
        process.cwd(),
        "study-buddy-data",
        "cache",
        "web-layout",
        "question-bank-reviews",
      );
  return path.join(
    root,
    `${sha256(JSON.stringify({
      version: "question-bank-item-review-v2-evidence-capsule",
      itemId: item.id,
      contentHash: item.contentHash,
      evidenceHash: evidence.evidenceHash,
      capsuleHash: evidence.capsuleHash,
      sourceHandoffHash: evidence.sourceHandoffHash,
      contractHash: context.contractHash,
      originalPromptHash: context.originalPromptHash,
    }))}.json`,
  );
}

async function readCachedRecord(filePath: string): Promise<QuestionBankItemReviewRecord | null> {
  try {
    return questionBankItemReviewRecordSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function persistCachedRecord(filePath: string, record: QuestionBankItemReviewRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function sameStrings(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameChecks(
  left: z.infer<typeof reviewCheckSchema>,
  right: z.infer<typeof reviewCheckSchema>,
): boolean {
  return (Object.keys(left) as Array<keyof typeof left>).every((key) => left[key] === right[key]);
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
