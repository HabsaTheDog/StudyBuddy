import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { minimalRequestContract, RequestContractSchema } from "../../shared/requestContract.js";
import { buildAdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import {
  buildQuestionEvidenceCapsule,
  questionReviewContext,
  resolveQuestionBankReviews,
} from "../questionBankReview.js";
import type { StudyGuideContent } from "../studyGuideContent.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("independent question-bank item review", () => {
  it("binds HTML item review to interactive requirements and excludes PDF-only content requirements", () => {
    const contract = RequestContractSchema.parse({
      ...minimalRequestContract("Create HTML and PDF", ["interactive-html", "pdf"]),
      deliverables: [
        { id: "html", kind: "interactive-html", purpose: "Self testing" },
        { id: "pdf", kind: "pdf", purpose: "Compact reference" },
      ],
      requirements: [
        { id: "req_interactive", statement: "Interactive self testing", origin: "explicit", priority: "must", appliesTo: ["html"], acceptanceCheck: "Interactive", evidenceRefs: [] },
        { id: "req_pdf", statement: "Compact derivations", origin: "explicit", priority: "must", appliesTo: ["pdf"], acceptanceCheck: "PDF", evidenceRefs: [] },
      ],
      reviewAssignments: [
        { owner: "content", requirementIds: ["req_pdf"], checks: ["PDF content"] },
        { owner: "interaction", requirementIds: ["req_interactive"], checks: ["HTML interaction"] },
        { owner: "technical", requirementIds: [], checks: ["Valid files"] },
      ],
    });

    expect(questionReviewContext(contract.originalPrompt, contract).requirementIds).toEqual(["req_interactive"]);
  });

  it("publishes approval only from records matching item hash, stable ID, and request contract", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Create an interactive guide that checks my understanding.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const sourceText = sourceTextFixture();
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");

    expect(draft.questionBank.items.every((item) => item.review.status === "pending")).toBe(true);

    const context = questionReviewContext(prompt, contract);
    const reviews = await resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      codex: approvingReviewer(draft.questionBank.items),
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    });
    const published = buildAdaptiveStudyModel(
      content,
      sourceText,
      "en",
      undefined,
      undefined,
      reviews,
      { originalUserPrompt: prompt, requestContract: contract },
    );

    expect(published.questionBank.items.every((item) =>
      item.review.status === "approved" &&
      item.review.record.itemId === item.id &&
      item.review.record.contentHash === item.contentHash &&
      item.review.record.reviewer.verdict === "approved" &&
      item.review.record.contract.contractHash === context.contractHash
    )).toBe(true);

    const changedContent = structuredClone(content);
    const exercise = changedContent.topics[0]!.exercises[0]!;
    if (exercise.type !== "cross") throw new Error("Expected cross fixture.");
    exercise.explanation = "The changed answer now requires a new independent review record.";
    const staleHash = buildAdaptiveStudyModel(
      changedContent,
      sourceText,
      "en",
      undefined,
      undefined,
      reviews,
      { originalUserPrompt: prompt, requestContract: contract },
    );
    expect(staleHash.questionBank.items[0]?.id).toBe(published.questionBank.items[0]?.id);
    expect(staleHash.questionBank.items[0]?.review.status).toBe("pending");

    const changedPrompt = "Create a concise reference page only.";
    const changedContract = minimalRequestContract(changedPrompt, ["reference"]);
    const staleContract = buildAdaptiveStudyModel(
      content,
      sourceText,
      "en",
      undefined,
      undefined,
      reviews,
      { originalUserPrompt: changedPrompt, requestContract: changedContract },
    );
    expect(staleContract.questionBank.items[0]?.review.status).toBe("pending");

    const persisted = JSON.parse(await readFile(path.join(runDir, "question-bank-reviews.json"), "utf8"));
    expect(persisted.records).toHaveLength(draft.questionBank.items.length);
  });

  it("persists item-local rejection diagnostics and reuses matching cached approvals", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Quiz me on the supplied course evidence.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const sourceText = sourceTextFixture();
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");
    const config = createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir });

    const approved = await resolveQuestionBankReviews({
      config,
      codex: approvingReviewer(draft.questionBank.items),
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    });
    expect(approved.records).toHaveLength(draft.questionBank.items.length);
    const reused = await resolveQuestionBankReviews({
      config,
      codex: { run: async () => { throw new Error("Matching item reviews should be reused."); } },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    });
    expect(reused).toEqual(approved);

    const rejectionRunDir = await temporaryRunDir();
    const rejectedId = draft.questionBank.items[0]!.id;
    await expect(resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir: rejectionRunDir }),
      codex: {
        run: async (_reviewPrompt, options) => {
          expect(options.task).toBe("quality_reviewer");
          return JSON.stringify({
            records: draft.questionBank.items.map((item) => ({
              itemId: item.id,
              contentHash: item.contentHash,
              verdict: item.id === rejectedId ? "rejected" : "approved",
              checks: {
                schema: true,
                scope: true,
                answer: item.id !== rejectedId,
                provenance: true,
                rendering: true,
              },
              findings: item.id === rejectedId
                ? [{
                    code: "answer-mismatch",
                    severity: "blocking",
                    message: "The explanation contradicts the marked correct option.",
                    repairInstruction: "Correct the explanation for this exercise without changing other items.",
                  }]
                : [],
            })),
          });
        },
      },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    })).rejects.toThrow(new RegExp(`item ${escapeRegex(rejectedId)}; exercise force-check`));
    const rejectedArtifact = await readFile(path.join(rejectionRunDir, "question-bank-reviews.json"), "utf8");
    expect(rejectedArtifact).toContain("answer-mismatch");
    expect(rejectedArtifact).toContain("Correct the explanation for this exercise");
  });

  it("keeps complete large items while size-batching reviewer calls below the model budget", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Review every complete exercise against this course and my request.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const seed = content.topics[0]!.exercises[0]!;
    content.topics[0]!.exercises = Array.from({ length: 8 }, (_, index) => ({
      ...structuredClone(seed),
      id: `large-review-${index}`,
      prompt: `${index}: ${"Complete evidence-bound prompt detail. ".repeat(140)}`,
      explanation: `${index}: ${"Complete reviewed explanation detail. ".repeat(140)}`,
    }));
    const sourceText = sourceTextFixture("Authorized course evidence. ".repeat(20));
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");
    const seen = new Set<string>();
    const promptSizes: number[] = [];
    const attempts: number[] = [];

    const result = await resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      codex: {
        run: async (reviewPrompt, options) => {
          promptSizes.push(reviewPrompt.length + JSON.stringify(options.outputSchema).length);
          attempts.push(options.attempt ?? 0);
          const batch = draft.questionBank.items.filter((item) =>
            reviewPrompt.includes(`"itemId":"${item.id}"`)
          );
          batch.forEach((item) => seen.add(item.id));
          return JSON.stringify({
            records: batch.map((item) => ({
              itemId: item.id,
              contentHash: item.contentHash,
              verdict: "approved",
              checks: { schema: true, scope: true, answer: true, provenance: true, rendering: true },
              findings: [],
            })),
          });
        },
      },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    });

    expect(result.records).toHaveLength(8);
    expect(seen.size).toBe(8);
    expect(promptSizes.length).toBeGreaterThan(2);
    expect(Math.max(...promptSizes)).toBeLessThan(45_000);
    expect(attempts.every((attempt) => attempt === 1)).toBe(true);
  });

  it("dynamically packs and independently reviews 46 representative items in fewer than twelve calls", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Review every complete item exactly against my interactive study request.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const seed = content.topics[0]!.exercises[0]!;
    content.topics[0]!.exercises = Array.from({ length: 46 }, (_, index) => ({
      ...structuredClone(seed),
      id: `representative-review-${index}`,
      prompt: `Question ${index}: apply the documented relationship to the stated situation.`,
      explanation: `Answer ${index}: the documented relationship supports the marked option.`,
    }));
    const sourceText = sourceTextFixture("Course Reader: force and acceleration. ".repeat(100));
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");
    const reviewedIds = new Set<string>();
    const requestSizes: number[] = [];
    const attemptsByBatch: number[][] = [];
    let activeCalls = 0;
    let maximumActiveCalls = 0;

    const result = await resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      codex: {
        run: async (reviewPrompt, options) => {
          activeCalls += 1;
          maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
          await new Promise((resolve) => setTimeout(resolve, 1));
          requestSizes.push(reviewPrompt.length + JSON.stringify(options.outputSchema).length);
          const batch = draft.questionBank.items.filter((item) =>
            reviewPrompt.includes(`"itemId":"${item.id}"`)
          );
          attemptsByBatch.push(batch.map(() => options.attempt ?? 0));
          batch.forEach((item) => {
            expect(reviewedIds.has(item.id)).toBe(false);
            reviewedIds.add(item.id);
          });
          activeCalls -= 1;
          return JSON.stringify({
            records: batch.map((item) => ({
              itemId: item.id,
              contentHash: item.contentHash,
              verdict: "approved",
              checks: { schema: true, scope: true, answer: true, provenance: true, rendering: true },
              findings: [],
            })),
          });
        },
      },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    });

    expect(result.records).toHaveLength(46);
    expect(reviewedIds.size).toBe(46);
    expect(requestSizes.length).toBeLessThan(12);
    expect(Math.max(...requestSizes)).toBeLessThan(45_000);
    expect(maximumActiveCalls).toBeGreaterThan(1);
    expect(maximumActiveCalls).toBeLessThanOrEqual(3);
    expect(attemptsByBatch.flat().every((attempt) => attempt === 1)).toBe(true);
    expect(new Set(result.records.map((record) => record.itemId)).size).toBe(46);
  });

  it("resolves the exact stable section instead of the first generic Blöcke source collision", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Quiz me on the supported course details.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const reference = {
      sourceIds: ["reader"],
      sectionIndex: 1,
      sectionHeading: "Forces",
      learningGoalIndexes: [0],
    };
    content.topics[0]!.evidenceRefs = [reference];
    content.topics[0]!.exercises[0]!.evidenceRefs = [reference];
    const sourceText = sourceTextWithSections([
      { heading: "Introduction", summary: "WRONG_GENERIC_BLOCKS_EVIDENCE", source_ids: ["reader"] },
      { heading: "Forces", summary: "SUPPORTED_FORCE_ACCELERATION_CLAIM", source_ids: ["reader"] },
    ]);
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");
    const binding = buildQuestionEvidenceCapsule(sourceText, draft.questionBank.items[0]!);
    expect(binding.status).toBe("available");
    if (binding.status !== "available") throw new Error(binding.reason);
    expect(binding.capsule.passages[0]?.text).toBe("SUPPORTED_FORCE_ACCELERATION_CLAIM");

    await resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      codex: {
        run: async (reviewPrompt) => {
          expect(reviewPrompt).toContain("SUPPORTED_FORCE_ACCELERATION_CLAIM");
          expect(reviewPrompt).not.toContain("WRONG_GENERIC_BLOCKS_EVIDENCE");
          return approvedBatch(reviewPrompt, draft.questionBank.items);
        },
      },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    });
  });

  it("invalidates a cached approval when the resolved evidence or source handoff changes", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Review this evidence-bound question.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const firstSource = sourceTextFixture("First authorized force claim.");
    const secondSource = sourceTextFixture("Changed authorized force claim.");
    const draft = buildAdaptiveStudyModel(content, firstSource, "en");
    let calls = 0;
    const codex = {
      run: async (reviewPrompt: string) => {
        calls += 1;
        return approvedBatch(reviewPrompt, draft.questionBank.items);
      },
    };
    const config = createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir });
    await resolveQuestionBankReviews({ config, codex, content, sourceText: firstSource, questionBank: draft.questionBank, requestContract: contract, priorError: null });
    await resolveQuestionBankReviews({ config, codex, content, sourceText: firstSource, questionBank: draft.questionBank, requestContract: contract, priorError: null });
    await resolveQuestionBankReviews({ config, codex, content, sourceText: secondSource, questionBank: draft.questionBank, requestContract: contract, priorError: null });
    expect(calls).toBe(2);
  });

  it("fails closed on synthetic assessment-section refs without asking the model to label the claim unsupported", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Review the exact grounded item.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const sourceText = sourceTextFixture();
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");
    draft.questionBank.items[0]!.assessmentSectionId = "synthetic-assessment-section";
    draft.questionBank.items[0]!.scopeBasis.evidenceRefs![0]!.sectionHeading = "Synthetic assessment title";
    const result = await resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      codex: { run: async () => { throw new Error("Model must not run without a complete capsule."); } },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
      allowRejected: true,
    });
    expect(result.records[0]?.reviewer.verdict).toBe("evidence_unavailable");
    expect(result.records[0]?.findings[0]?.code).toBe("evidence-unavailable");
  });

  it("fails closed after three malformed local review attempts without sealing a stale record", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Review the exact exercise before publication.";
    const contract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const content = contentFixture();
    const sourceText = sourceTextFixture();
    const draft = buildAdaptiveStudyModel(content, sourceText, "en");
    const attempts: number[] = [];

    await expect(resolveQuestionBankReviews({
      config: createWebLayoutRuntimeConfig({ prompt, originalUserPrompt: prompt, kind: "study-guide", runDir }),
      codex: {
        run: async (_reviewPrompt, options) => {
          attempts.push(options.attempt ?? 0);
          return JSON.stringify({
            records: draft.questionBank.items.map((item) => ({
              itemId: item.id,
              contentHash: "0".repeat(64),
              verdict: "approved",
              checks: { schema: true, scope: true, answer: true, provenance: true, rendering: true },
              findings: [],
            })),
          });
        },
      },
      content,
      sourceText,
      questionBank: draft.questionBank,
      requestContract: contract,
      priorError: null,
    })).rejects.toThrow(/failed after 3 local attempts/i);

    expect(attempts).toEqual([1, 2, 3]);
    await expect(readFile(path.join(runDir, "question-bank-reviews.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

function approvingReviewer(
  items: ReturnType<typeof buildAdaptiveStudyModel>["questionBank"]["items"],
) {
  return {
    run: async (prompt: string, options: { task: string }) => {
      expect(options.task).toBe("quality_reviewer");
      expect(prompt).toContain("Exact original request");
      expect(prompt).toContain("Evaluated request contract");
      const batch = items.filter((item) => prompt.includes(`\"itemId\":\"${item.id}\"`));
      return JSON.stringify({
        records: batch.map((item) => ({
          itemId: item.id,
          contentHash: item.contentHash,
          verdict: "approved",
          checks: { schema: true, scope: true, answer: true, provenance: true, rendering: true },
          findings: [],
        })),
      });
    },
  };
}

async function temporaryRunDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "question-bank-review-"));
  tempDirs.push(directory);
  return directory;
}

function contentFixture(): StudyGuideContent {
  return {
    courseTitle: "Mechanics",
    courseCode: "MEC",
    scopeNote: "Only the supplied course reader is in scope.",
    topics: [{
      id: "forces",
      title: "Forces",
      learningGoals: ["Relate force and acceleration."],
      theory: {
        summary: "Force and acceleration are related by the documented course model.",
        keyIdeas: ["Force changes motion."],
        formulas: [],
      },
      workedExamples: [],
      exercises: [{
        id: "force-check",
        type: "cross",
        prompt: "Which statement correctly relates force and acceleration?",
        selectionMode: "single",
        options: [
          { text: "Acceleration follows the net force.", correct: true, feedback: "Correct." },
          { text: "Acceleration is unrelated to force.", correct: false, feedback: "This contradicts the model." },
        ],
        explanation: "The course model connects net force with acceleration.",
        source: { label: "Course Reader", sourceTask: "Force and acceleration", provenance: "source" },
      }],
      retrieval: [],
    }],
    sources: [{ id: "reader", label: "Course Reader", url: "", coverage: "Force and acceleration" }],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceTextFixture(summary = "Course Reader: force and acceleration."): string {
  return sourceTextWithSections([{ heading: "Forces", summary, source_ids: ["reader"] }]);
}

function sourceTextWithSections(sections: Array<{ heading: string; summary: string; source_ids: string[] }>): string {
  return `## Extracted data\n${JSON.stringify({ sections })}`;
}

function approvedBatch(
  prompt: string,
  items: ReturnType<typeof buildAdaptiveStudyModel>["questionBank"]["items"],
): string {
  const batch = items.filter((item) => prompt.includes(`"itemId":"${item.id}"`));
  return JSON.stringify({
    records: batch.map((item) => ({
      itemId: item.id,
      contentHash: item.contentHash,
      verdict: "approved",
      checks: { schema: true, scope: true, answer: true, provenance: true, rendering: true },
      findings: [],
    })),
  });
}
