import { describe, expect, it } from "vitest";
import { minimalRequestContract } from "../../shared/requestContract.js";
import { assessmentBlueprintSchema, questionBankSchema, type QuestionBank } from "../adaptiveStudyModel.js";
import { applyQuestionBankDrops, planQuestionBankDispositions } from "../questionBankDisposition.js";
import {
  questionBankItemContentHash,
  questionBankItemReviewRecordId,
  questionBankReviewSetSchema,
  questionReviewContext,
  type QuestionBankItemReviewRecord,
} from "../questionBankReview.js";

describe("question-bank reject disposition", () => {
  it("does not turn ordinary renderer types into mandatory coverage", () => {
    const contract = minimalRequestContract("Create adaptive practice", ["study-guide"]);
    const approved = item("approved", "objective-1", "application");
    const redundant = item("redundant", "objective-1", "application");
    const gap = item("gap", "objective-1", "calculation");
    const bank = bankOf([approved, redundant, gap]);
    const context = questionReviewContext(contract.originalPrompt, contract);
    const reviews = questionBankReviewSetSchema.parse({
      schemaVersion: 1,
      contractHash: context.contractHash,
      originalPromptHash: context.originalPromptHash,
      records: [record(approved, true, context), record(redundant, false, context), record(gap, false, context)],
    });
    const plan = planQuestionBankDispositions({
      questionBank: bank,
      reviews,
      assessmentBlueprint: assessmentBlueprintSchema.parse({
        schemaVersion: 1, mode: "none", title: "No documented assessment", confidence: "low",
        durationMinutes: null, maxPoints: null, passingPoints: null, allowedAids: [], prohibitedAids: [],
        sections: [], evidence: [], rationale: "No evidence.",
      }),
      requestContract: contract,
    });

    expect(plan.items.find((entry) => entry.itemId === redundant.id)?.action).toBe("drop");
    expect(plan.items.find((entry) => entry.itemId === gap.id)?.action).toBe("drop");
    expect(applyQuestionBankDrops(bank, plan).items.map((entry) => entry.id)).toEqual([approved.id]);
  });

  it("keeps documented assessment section/type slots exact", () => {
    const contract = minimalRequestContract("Prepare me for the documented exam", ["study-guide"]);
    const survivor = { ...item("survivor", "objective-1", "application"), assessmentSectionId: "oral", assessmentQuestionTypes: ["presentation"] };
    const sameSlot = { ...item("same", "objective-1", "application"), assessmentSectionId: "oral", assessmentQuestionTypes: ["presentation"] };
    const otherSlot = { ...item("other", "objective-1", "application"), assessmentSectionId: "oral", assessmentQuestionTypes: ["open-response"] };
    const bank = bankOf([survivor, sameSlot, otherSlot]);
    const context = questionReviewContext(contract.originalPrompt, contract);
    const reviews = questionBankReviewSetSchema.parse({
      schemaVersion: 1, contractHash: context.contractHash, originalPromptHash: context.originalPromptHash,
      records: [record(survivor, true, context), record(sameSlot, false, context), record(otherSlot, false, context)],
    });
    const assessment = assessmentBlueprintSchema.parse({
      schemaVersion: 1, mode: "documented", title: "Exam", confidence: "high",
      durationMinutes: null, maxPoints: null, passingPoints: null, allowedAids: [], prohibitedAids: [], evidence: [],
      sections: [{ id: "oral", title: "Oral", order: 0, evidenceLevel: "explicit", deliveryMode: "self-assessed", points: null, weight: null, durationMinutes: null, questionTypes: ["presentation", "open-response"], learningObjectiveIds: ["objective-1"] }],
    });
    const plan = planQuestionBankDispositions({ questionBank: bank, reviews, assessmentBlueprint: assessment, requestContract: contract });

    expect(plan.items.find((entry) => entry.itemId === sameSlot.id)?.action).toBe("drop");
    expect(plan.items.find((entry) => entry.itemId === otherSlot.id)?.action).toBe("repair");
  });

  it("routes unavailable evidence to capsule rebuild and semantic meta tasks to exclusion", () => {
    const contract = minimalRequestContract("Create interactive practice", ["study-guide"]);
    const approved = item("approved-evidence", "objective-1", "application");
    const unavailable = item("unavailable", "objective-1", "application");
    const meta = item("meta", "objective-2", "application");
    const bank = questionBankSchema.parse({
      ...bankOf([approved, unavailable, meta]),
      coverage: { objectiveIds: ["objective-1", "objective-2"], coveredObjectiveIds: ["objective-1", "objective-2"], missingObjectiveIds: [], stageCounts: { minimum: 3 } },
    });
    const context = questionReviewContext(contract.originalPrompt, contract);
    const metaRecord = record(meta, false, context);
    metaRecord.findings = [{ code: "meta-question", severity: "blocking", message: "This asks about extraction coverage.", repairInstruction: "Exclude it from learner practice." }];
    metaRecord.recordId = questionBankItemReviewRecordId({
      itemId: metaRecord.itemId, contentHash: metaRecord.contentHash, evidence: metaRecord.evidence,
      contract: metaRecord.contract, reviewer: metaRecord.reviewer, checks: metaRecord.checks, findings: metaRecord.findings,
    });
    const reviews = questionBankReviewSetSchema.parse({
      schemaVersion: 1, contractHash: context.contractHash, originalPromptHash: context.originalPromptHash,
      records: [record(approved, true, context), record(unavailable, "evidence_unavailable", context), metaRecord],
    });
    const plan = planQuestionBankDispositions({
      questionBank: bank, reviews, requestContract: contract,
      assessmentBlueprint: assessmentBlueprintSchema.parse({ schemaVersion: 1, mode: "none", title: "None", confidence: "low", durationMinutes: null, maxPoints: null, passingPoints: null, allowedAids: [], prohibitedAids: [], sections: [], evidence: [] }),
    });

    expect(plan.items.find((entry) => entry.itemId === unavailable.id)?.action).toBe("rebuild_evidence");
    expect(plan.items.find((entry) => entry.itemId === meta.id)?.action).toBe("exclude");
  });
});

function item(id: string, objectiveId: string, type: "application" | "calculation"): QuestionBank["items"][number] {
  const source = { label: "Source", sourceTask: `Task ${id}`, provenance: "derived" as const };
  const exercise = type === "application" ? {
    id, type, prompt: `Explain the relevant concept for item ${id}.`,
    instructions: ["State the principle.", "Apply it."], sampleAnswer: "A complete comparison answer grounded in the supplied concept.",
    selfCheck: ["The principle is correct.", "The application is justified."], source,
  } : {
    id, type, prompt: `Calculate the requested quantity for item ${id}.`, givens: ["x = 2 m"],
    acceptedAnswers: ["4"], unit: "m", steps: ["State the relation.", "Insert the value."],
    commonMistake: "Do not omit the unit.", source,
  };
  const contentHash = questionBankItemContentHash({ exercise });
  return {
    id: `question-${id}`, legacyExerciseId: id, contentHash, topicId: "topic", learningObjectiveIds: [objectiveId],
    type, stageIndex: 1, stageIntent: "minimum", stageLabel: "Neutral", difficulty: "standard", estimatedMinutes: 3,
    origin: "study_buddy_generated", scopeBasis: { topicTitle: "Topic", learningObjectives: [objectiveId], sourceLabel: source.label, sourceTask: source.sourceTask },
    review: { status: "pending", checks: { schema: false, scope: false, answer: false, provenance: false, rendering: false, selfContained: false, feedback: false }, findings: [] },
    exercise,
  };
}

function bankOf(items: QuestionBank["items"]): QuestionBank {
  return questionBankSchema.parse({
    schemaVersion: 1, courseId: "course", items,
    coverage: { objectiveIds: ["objective-1"], coveredObjectiveIds: ["objective-1"], missingObjectiveIds: [], stageCounts: { minimum: items.length } },
  });
}

function record(
  itemValue: QuestionBank["items"][number],
  approved: boolean | "evidence_unavailable",
  context: ReturnType<typeof questionReviewContext>,
): QuestionBankItemReviewRecord {
  const isApproved = approved === true;
  const verdict = approved === "evidence_unavailable" ? "evidence_unavailable" as const : isApproved ? "approved" as const : "rejected" as const;
  const unsigned = {
    itemId: itemValue.id, contentHash: itemValue.contentHash,
    contract: { contractHash: context.contractHash, originalPromptHash: context.originalPromptHash, requirementIds: context.requirementIds },
    reviewer: { kind: "independent_model" as const, task: "quality_reviewer" as const, verdict },
    checks: isApproved
      ? { schema: true, scope: true, answer: true, provenance: true, rendering: true, selfContained: true, feedback: true }
      : { schema: false, scope: false, answer: false, provenance: false, rendering: false, selfContained: false, feedback: false },
    findings: isApproved ? [] : [{
      code: approved === "evidence_unavailable" ? "evidence-unavailable" : "answer",
      severity: "blocking" as const,
      message: approved === "evidence_unavailable" ? "Evidence capsule unavailable." : "Answer is incomplete.",
      repairInstruction: approved === "evidence_unavailable" ? "Rebuild the capsule." : "Repair only this answer contract.",
    }],
  };
  return { schemaVersion: 1, recordId: questionBankItemReviewRecordId(unsigned), ...unsigned };
}
