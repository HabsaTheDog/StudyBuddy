import { createHash } from "node:crypto";
import { z } from "zod";
import { hashRequestContract, type RequestContract } from "../shared/requestContract.js";
import { questionBankSchema, type AssessmentBlueprint, type QuestionBank } from "./adaptiveStudyModel.js";
import {
  questionBankItemReviewRecordId,
  interactiveContractDeliverableIds,
  rejectedQuestionBankItems,
  type QuestionBankItemReviewRecord,
  type QuestionBankReviewSet,
} from "./questionBankReview.js";

const dispositionSchema = z.object({
  itemId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  reviewRecordId: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["drop", "repair", "rebuild_evidence", "exclude"]),
  coverageAtoms: z.array(z.string().min(1)),
  missingCoverageAtoms: z.array(z.string().min(1)),
  reason: z.string().min(1),
});

export const questionBankDispositionSetSchema = z.object({
  schemaVersion: z.literal(1),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  questionBankHash: z.string().regex(/^[a-f0-9]{64}$/),
  dispositionId: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(dispositionSchema),
});

export type QuestionBankDispositionSet = z.infer<typeof questionBankDispositionSetSchema>;

/**
 * Decide only whether an independently rejected item is redundant. This does
 * not invent quantities: an item may be removed only when approved survivors
 * preserve its exact objective/response-mode claims, documented assessment
 * slots, and explicit content-contract ownership.
 */
export function planQuestionBankDispositions(input: {
  questionBank: QuestionBank;
  reviews: QuestionBankReviewSet;
  assessmentBlueprint: AssessmentBlueprint;
  requestContract: RequestContract;
}): QuestionBankDispositionSet {
  const contractHash = hashRequestContract(input.requestContract);
  if (
    input.reviews.contractHash !== contractHash ||
    input.reviews.originalPromptHash !== sha256(input.requestContract.originalPrompt)
  ) {
    throw new Error("Cannot disposition question-bank reviews bound to another request contract or original prompt.");
  }
  const rejected = rejectedQuestionBankItems(input.questionBank, input.reviews);
  const rejectedKeys = new Set(rejected.map(itemKey));
  const approved = input.questionBank.items.filter((item) => !rejectedKeys.has(itemKey(item)));
  const survivorAtoms = new Set(approved.flatMap((item) => coverageAtoms(
    item, input.assessmentBlueprint, input.requestContract, input.reviews,
  )));
  const items = rejected.map((item) => {
    const record = exactRecord(input.reviews, item);
    const atoms = coverageAtoms(item, input.assessmentBlueprint, input.requestContract, input.reviews);
    const missing = atoms.filter((atom) => !survivorAtoms.has(atom));
    const evidenceUnavailable = record.reviewer.verdict === "evidence_unavailable";
    const semanticExclusion = record.findings.some((finding) => isNonPublishableLearningTaskFinding(finding.code));
    const action = evidenceUnavailable
      ? "rebuild_evidence"
      : semanticExclusion
        ? "exclude"
        : missing.length === 0
          ? "drop"
          : "repair";
    return dispositionSchema.parse({
      itemId: item.id,
      contentHash: item.contentHash,
      reviewRecordId: record.recordId,
      action,
      coverageAtoms: atoms,
      missingCoverageAtoms: missing,
      reason: evidenceUnavailable
        ? "The unchanged item requires a rebuilt evidence capsule and exact same-item review before any content disposition."
        : semanticExclusion
          ? "Independent semantic review identified a non-embeddable learning task or evidence-gap/meta question; it cannot enter the offline learner bank."
          : missing.length === 0
            ? "Approved remaining items preserve this item's exact objective, documented assessment-slot, and explicit contract coverage."
            : `Removing this item would leave uncovered semantic claims: ${missing.join(", ")}`,
    });
  });
  const unsigned = {
    schemaVersion: 1 as const,
    contractHash,
    questionBankHash: sha256(JSON.stringify(input.questionBank.items.map((item) => itemKey(item)).sort())),
    items,
  };
  return questionBankDispositionSetSchema.parse({
    ...unsigned,
    dispositionId: sha256(JSON.stringify({ version: "question-bank-disposition-v1", ...unsigned })),
  });
}

export function applyQuestionBankDrops(
  questionBank: QuestionBank,
  dispositions: QuestionBankDispositionSet,
): QuestionBank {
  const parsed = questionBankDispositionSetSchema.parse(dispositions);
  const expectedBankHash = sha256(JSON.stringify(questionBank.items.map((item) => itemKey(item)).sort()));
  const { dispositionId: _dispositionId, ...unsigned } = parsed;
  if (
    parsed.questionBankHash !== expectedBankHash ||
    parsed.dispositionId !== sha256(JSON.stringify({ version: "question-bank-disposition-v1", ...unsigned }))
  ) throw new Error("Question-bank disposition is stale or its integrity seal is invalid.");
  const drops = new Set(parsed.items
    .filter((item) => item.action === "drop" || item.action === "exclude")
    .map((item) => `${item.itemId}\0${item.contentHash}`));
  const items = questionBank.items.filter((item) => !drops.has(itemKey(item)));
  const coveredObjectiveIds = [...new Set(items.flatMap((item) => item.learningObjectiveIds))];
  const stageCounts = Object.fromEntries(Object.keys(questionBank.coverage.stageCounts).map((stage) => [
    stage,
    items.filter((item) => item.stageIntent === stage).length,
  ]));
  return questionBankSchema.parse({
    ...questionBank,
    items,
    coverage: {
      ...questionBank.coverage,
      coveredObjectiveIds,
      missingObjectiveIds: questionBank.coverage.objectiveIds.filter((id) => !coveredObjectiveIds.includes(id)),
      stageCounts,
    },
  });
}

export function isNonPublishableLearningTaskFinding(code: string): boolean {
  return new Set([
    "extraction-gap",
    "extraction_gap",
    "meta-question",
    "meta_question",
    "external-unembedded",
    "external_unembedded",
    "external-task-unavailable",
  ]).has(code.trim().toLocaleLowerCase());
}

function coverageAtoms(
  item: QuestionBank["items"][number],
  assessment: AssessmentBlueprint,
  contract: RequestContract,
  reviews: QuestionBankReviewSet,
): string[] {
  const atoms = item.learningObjectiveIds.map((id) => `objective:${id}`);
  const section = assessment.mode === "documented" && item.assessmentSectionId
    ? assessment.sections.find((candidate) => candidate.id === item.assessmentSectionId)
    : undefined;
  if (section) {
    for (const id of item.learningObjectiveIds.filter((candidate) => section.learningObjectiveIds.includes(candidate))) {
      atoms.push(`assessment-objective:${section.id}:${id}`);
    }
    for (const type of (item.assessmentQuestionTypes ?? []).filter((candidate) => section.questionTypes.includes(candidate))) {
      atoms.push(`assessment-type:${section.id}:${type}`);
    }
  }
  const record = exactRecord(reviews, item);
  const interactiveDeliverables = interactiveContractDeliverableIds(contract);
  const explicitInteractiveIds = new Set(contract.reviewAssignments
    .filter((assignment) => ["source", "content", "interaction"].includes(assignment.owner))
    .flatMap((assignment) => assignment.requirementIds)
    .filter((id) => contract.requirements.some((requirement) =>
      requirement.id === id &&
      requirement.origin === "explicit" &&
      requirement.appliesTo.some((deliverableId) => interactiveDeliverables.has(deliverableId))
    )));
  for (const id of record.contract.requirementIds) {
    if (explicitInteractiveIds.has(id)) atoms.push(`contract:${id}`);
  }
  return [...new Set(atoms)].sort();
}

function exactRecord(
  reviews: QuestionBankReviewSet,
  item: Pick<QuestionBank["items"][number], "id" | "contentHash">,
): QuestionBankItemReviewRecord {
  const record = reviews.records.find((candidate) => candidate.itemId === item.id && candidate.contentHash === item.contentHash);
  if (!record || record.recordId !== questionBankItemReviewRecordId({
    itemId: record.itemId,
    contentHash: record.contentHash,
    evidence: record.evidence,
    contract: record.contract,
    reviewer: record.reviewer,
    checks: record.checks,
    findings: record.findings,
  })) throw new Error(`Cannot disposition ${item.id}: exact sealed review record is missing or invalid.`);
  return record;
}

function itemKey(item: Pick<QuestionBank["items"][number], "id" | "contentHash">): string {
  return `${item.id}\0${item.contentHash}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
