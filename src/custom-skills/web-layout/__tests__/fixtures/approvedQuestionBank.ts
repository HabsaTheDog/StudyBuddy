import type { AdaptiveStudyModel } from "../../adaptiveStudyModel.js";
import {
  buildQuestionEvidenceCapsule,
  questionBankItemContentHash,
  questionBankItemReviewRecordId,
  type UnsignedQuestionBankItemReviewRecord,
} from "../../questionBankReview.js";

const testContractHash = "1".repeat(64);
const testOriginalPromptHash = "2".repeat(64);

export function approveQuestionBankForRendering<T extends AdaptiveStudyModel>(model: T): T {
  for (const item of model.questionBank.items) {
    const checks = {
      schema: true,
      scope: true,
      answer: true,
      provenance: true,
      rendering: true,
    } as const;
    const capsule = buildQuestionEvidenceCapsule(syntheticEvidenceHandoff(item), item);
    if (capsule.status !== "available") {
      throw new Error(`Approved renderer fixture could not build evidence for ${item.id}: ${capsule.reason}`);
    }
    const unsigned: UnsignedQuestionBankItemReviewRecord = {
      itemId: item.id,
      contentHash: item.contentHash,
      evidence: {
        evidenceHash: capsule.evidenceHash,
        capsuleHash: capsule.capsuleHash,
        sourceHandoffHash: capsule.sourceHandoffHash,
      },
      contract: {
        contractHash: testContractHash,
        originalPromptHash: testOriginalPromptHash,
        requirementIds: ["renderer-publication-test"],
      },
      reviewer: {
        kind: "independent_model",
        task: "quality_reviewer",
        verdict: "approved",
      },
      checks,
      findings: [],
    };
    item.review = {
      status: "approved",
      checks: { ...checks },
      findings: [],
      record: {
        schemaVersion: 1,
        recordId: questionBankItemReviewRecordId(unsigned),
        ...unsigned,
      },
    };
    const sealedHash = questionBankItemContentHash(item);
    if (sealedHash !== item.contentHash) {
      item.contentHash = sealedHash;
      item.review.record.contentHash = sealedHash;
      item.review.record.recordId = questionBankItemReviewRecordId(item.review.record);
    }
  }
  for (const item of model.questionBank.items) {
    const sealedHash = questionBankItemContentHash(item);
    if (item.review.status !== "approved") throw new Error(`Approved fixture lost review state for ${item.id}.`);
    item.contentHash = sealedHash;
    item.review.record.contentHash = sealedHash;
    item.review.record.recordId = questionBankItemReviewRecordId(item.review.record);
  }
  return model;
}

function syntheticEvidenceHandoff(item: AdaptiveStudyModel["questionBank"]["items"][number]): string {
  const refs = item.scopeBasis.evidenceRefs ?? [];
  const sections: Array<{ heading: string; summary: string; source_ids: string[] }> = [];
  for (const ref of refs) {
    sections[ref.sectionIndex] = {
      heading: ref.sectionHeading,
      summary: `Synthetic authorized evidence capsule for ${ref.sectionHeading}.`,
      source_ids: [...ref.sourceIds],
    };
  }
  return `## Extracted data\n\n${JSON.stringify({ sections })}`;
}
