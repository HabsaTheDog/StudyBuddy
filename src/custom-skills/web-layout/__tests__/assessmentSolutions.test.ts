import { describe, expect, it } from "vitest";
import {
  assessmentSolutionContractContext,
  assessmentSolutionSemanticCacheKey,
  assessmentSolutionTaskContract,
  buildAssessmentSolutionPrompt,
  buildAssessmentSolutionReviewPrompt,
  normalizedCropToPixels,
} from "../assessmentSolutions.js";
import {
  hashRequestContract,
  minimalRequestContract,
  RequestContractSchema,
} from "../../shared/requestContract.js";
import type { AdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import type { StudyGuideContent } from "../studyGuideContent.js";

describe("assessment visual crops", () => {
  it("isolates semantic solution caches by verified contract and exposes only owner-assigned requirements", () => {
    const prompt = "Create the requested assessment study guide.";
    const base = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const deliverableId = base.deliverables[0]!.id;
    const contract = RequestContractSchema.parse({
      ...base,
      requirements: [
        {
          id: "content-answer",
          statement: "Provide source-grounded comparison answers.",
          origin: "explicit",
          priority: "must",
          appliesTo: [deliverableId],
          acceptanceCheck: "Every included assessment item has a checkable answer.",
          evidenceRefs: [],
        },
        {
          id: "visual-only",
          statement: "Use a diagram only when it is necessary to interpret the task.",
          origin: "explicit",
          priority: "must",
          appliesTo: [deliverableId],
          acceptanceCheck: "Every retained crop is task-essential.",
          evidenceRefs: [],
        },
      ],
      forbidden: ["Decorative images"],
      reviewAssignments: [
        { owner: "content", requirementIds: ["content-answer"], checks: ["Answers are complete."] },
        { owner: "visual", requirementIds: ["visual-only"], checks: ["Crops are necessary."] },
        { owner: "technical", requirementIds: [], checks: ["Artifact is readable."] },
      ],
    });
    const changed = RequestContractSchema.parse({
      ...contract,
      forbidden: ["All images and visual crops"],
    });
    const contentContext = assessmentSolutionContractContext(
      prompt,
      contract,
      hashRequestContract(contract),
      "content",
    );
    const visualContext = assessmentSolutionContractContext(
      prompt,
      contract,
      hashRequestContract(contract),
      "visual",
    );
    const changedContext = assessmentSolutionContractContext(
      prompt,
      changed,
      hashRequestContract(changed),
      "content",
    );
    const identicalEvidence = { task: "same", sourceHash: "abc123" };

    expect(contentContext.requirements.map((requirement) => requirement.id)).toEqual(["content-answer"]);
    expect(visualContext.requirements.map((requirement) => requirement.id)).toEqual(["visual-only"]);
    expect(contentContext.originalPrompt).toBe(prompt);
    expect(assessmentSolutionSemanticCacheKey(contentContext, identicalEvidence))
      .not.toBe(assessmentSolutionSemanticCacheKey(changedContext, identicalEvidence));
    expect(() => assessmentSolutionContractContext(prompt, contract, "0".repeat(64)))
      .toThrow(/hash mismatch/i);
  });

  it("maps normalized crop coordinates to bounded source pixels", () => {
    expect(normalizedCropToPixels(
      { x: 120, y: 90, width: 480, height: 350 },
      1075,
      1521,
    )).toEqual({
      x: 51,
      y: 136,
      width: 671,
      height: 533,
    });
  });

  it("clamps rounding at the image boundary", () => {
    expect(normalizedCropToPixels(
      { x: 950, y: 950, width: 50, height: 50 },
      101,
      99,
    )).toEqual({
      x: 95,
      y: 94,
      width: 6,
      height: 5,
    });
  });

  it("can add bounded vertical padding for standalone learning visuals", () => {
    expect(normalizedCropToPixels(
      { x: 100, y: 100, width: 300, height: 200 },
      1000,
      1000,
      { verticalPaddingRatio: 0.1 },
    )).toEqual({
      x: 100,
      y: 80,
      width: 300,
      height: 240,
    });
  });

  it("can preserve an exact reviewer crop without assessment-side padding", () => {
    expect(normalizedCropToPixels(
      { x: 120, y: 90, width: 480, height: 350 },
      1000,
      1000,
      { horizontalPaddingRatio: 0, verticalPaddingRatio: 0 },
    )).toEqual({
      x: 120,
      y: 90,
      width: 480,
      height: 350,
    });
  });

  it("selects solution completeness from the bound item/plan contract across disciplines", () => {
    const prompt = "Prepare exact comparison answers for the documented assessment tasks.";
    const requestContract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const contract = assessmentSolutionContractContext(
      prompt,
      requestContract,
      hashRequestContract(requestContract),
    );
    const cases = [
      solutionFixture("calculation", "interactive", "calculation"),
      solutionFixture("oral-response", "external-performance", "application"),
      solutionFixture("case-analysis", "self-assessed", "application"),
      solutionFixture("laboratory-observation", "self-assessed", "application"),
    ] as const;

    const resolved = cases.map((fixture) => assessmentSolutionTaskContract(
      fixture.model,
      fixture.item,
      contract,
    ));
    expect(resolved.map((item) => item.responseMode)).toEqual([
      "quantitative-calculation",
      "constructed-response",
      "constructed-response",
      "constructed-response",
    ]);
    expect(resolved.map((item) => item.assessmentQuestionTypes[0])).toEqual([
      "calculation",
      "oral-response",
      "case-analysis",
      "laboratory-observation",
    ]);

    const config = createWebLayoutRuntimeConfig({
      prompt,
      originalUserPrompt: prompt,
      kind: "study-guide",
      language: "en",
      runDir: "/tmp/assessment-solution-prompt-test",
    });
    const prompts = cases.map((fixture) => buildAssessmentSolutionPrompt({
      config,
      content: fixture.content,
      sourceText: "Authorized passage supporting the exact documented response task.",
      model: fixture.model,
      priorError: null,
    }, fixture.item, contract));
    expect(prompts[0]).toContain("Quantitative calculation contract");
    expect(prompts[0]).toContain("governing relation");
    for (const [index, declaredType] of ["oral-response", "case-analysis", "laboratory-observation"].entries()) {
      expect(prompts[index + 1]).toContain("Constructed-response contract");
      expect(prompts[index + 1]).toContain(declaredType);
      expect(prompts[index + 1]).not.toMatch(calculationRecipeLanguage);
    }
  });

  it("changes prompt and semantic cache for identical text under a different declared plan type", () => {
    const prompt = "Build comparison responses from the exact assessment contract.";
    const requestContract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const context = assessmentSolutionContractContext(
      prompt,
      requestContract,
      hashRequestContract(requestContract),
    );
    const oral = solutionFixture("oral-response", "external-performance", "application");
    const caseAnalysis = solutionFixture("case-analysis", "self-assessed", "application");
    const oralContract = assessmentSolutionTaskContract(oral.model, oral.item, context);
    const caseContract = assessmentSolutionTaskContract(caseAnalysis.model, caseAnalysis.item, context);
    const config = createWebLayoutRuntimeConfig({
      prompt,
      originalUserPrompt: prompt,
      kind: "study-guide",
      language: "en",
      runDir: "/tmp/assessment-solution-cache-test",
    });
    const authorPrompt = (fixture: ReturnType<typeof solutionFixture>) =>
      buildAssessmentSolutionPrompt({
        config,
        content: fixture.content,
        sourceText: "Authorized response evidence.",
        model: fixture.model,
        priorError: null,
      }, fixture.item, context);
    const reviewPrompt = (fixture: ReturnType<typeof solutionFixture>) =>
      buildAssessmentSolutionReviewPrompt({
        config,
        content: fixture.content,
        sourceText: "Authorized response evidence.",
        model: fixture.model,
      }, fixture.item, {
        legacyExerciseId: fixture.item.legacyExerciseId,
        completeness: "complete",
        summary: "A complete comparison response.",
        steps: ["State the response.", "Support it with the authorized passage."],
        finalAnswer: "The response addresses the exact prompt with evidence.",
        assumptions: [],
        evidenceBasis: ["Authorized response evidence"],
        missingEvidence: [],
      }, context);

    expect(oral.item.exercise.prompt).toBe(caseAnalysis.item.exercise.prompt);
    expect(authorPrompt(oral)).not.toBe(authorPrompt(caseAnalysis));
    expect(reviewPrompt(oral)).not.toBe(reviewPrompt(caseAnalysis));
    expect(authorPrompt(oral)).not.toMatch(calculationRecipeLanguage);
    expect(authorPrompt(caseAnalysis)).not.toMatch(calculationRecipeLanguage);
    expect(reviewPrompt(oral)).not.toMatch(calculationRecipeLanguage);
    expect(reviewPrompt(caseAnalysis)).not.toMatch(calculationRecipeLanguage);
    expect(assessmentSolutionSemanticCacheKey(context, oralContract))
      .not.toBe(assessmentSolutionSemanticCacheKey(context, caseContract));
  });

  it("fails closed for contradictory or unsupported assessment item contracts", () => {
    const prompt = "Prepare the documented assessment response.";
    const requestContract = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const context = assessmentSolutionContractContext(
      prompt,
      requestContract,
      hashRequestContract(requestContract),
    );
    const contradictory = solutionFixture("calculation", "self-assessed", "application");
    expect(() => assessmentSolutionTaskContract(contradictory.model, contradictory.item, context))
      .toThrow(/unsupported or contradictory/i);
    const unsupported = solutionFixture("selection", "interactive", "cross");
    expect(() => assessmentSolutionTaskContract(unsupported.model, unsupported.item, context))
      .toThrow(/unsupported or contradictory/i);
    const stalePlan = solutionFixture("oral-response", "external-performance", "application");
    stalePlan.model.assessmentBlueprint.planBinding = {
      cacheVersion: "assessment-architecture-v1-open-contract",
      contractHash: "9".repeat(64),
      originalPromptHash: context.originalPromptHash,
      courseHash: "7".repeat(64),
      evidenceHash: "6".repeat(64),
      semanticCacheKey: "5".repeat(64),
    };
    expect(() => assessmentSolutionTaskContract(stalePlan.model, stalePlan.item, context))
      .toThrow(/different request-bound assessment plan/i);
  });
});

const calculationRecipeLanguage = /governing relation|rearrangement|substitut(?:ed|ion)|\bunits?\b|intermediate result|dimensional|physical plausibility|handbook/i;

function solutionFixture(
  declaredType: string,
  deliveryMode: "interactive" | "self-assessed" | "external-performance",
  exerciseType: "calculation" | "application" | "cross",
): {
  content: StudyGuideContent;
  model: AdaptiveStudyModel;
  item: AdaptiveStudyModel["questionBank"]["items"][number];
} {
  const source = { label: "Course reader", sourceTask: "Documented task", provenance: "source" as const };
  const sharedPrompt = "Respond completely to the documented assessment task using the authorized passage.";
  const exercise = exerciseType === "calculation"
    ? {
        id: "assessment-source-task-section",
        type: "calculation" as const,
        prompt: sharedPrompt,
        givens: ["Documented input"],
        acceptedAnswers: ["__self_check__"],
        unit: "",
        steps: ["Use the documented method.", "Report the requested result."],
        commonMistake: "Do not omit a requested subtask.",
        source,
      }
    : exerciseType === "application"
      ? {
          id: "assessment-source-task-section",
          type: "application" as const,
          prompt: sharedPrompt,
          instructions: ["Address every subtask.", "Support the response with the passage."],
          sampleAnswer: "A reviewed comparison response will be supplied after completion.",
          selfCheck: ["Every subtask is addressed.", "The passage supports the reasoning."],
          source,
        }
      : {
          id: "assessment-source-task-section",
          type: "cross" as const,
          prompt: sharedPrompt,
          selectionMode: "single" as const,
          options: [
            { text: "Supported", correct: true, feedback: "Supported." },
            { text: "Unsupported", correct: false, feedback: "Unsupported." },
          ],
          explanation: "The supported response follows from the passage.",
          source,
        };
  const content = {
    courseTitle: "Open assessment contract",
    courseCode: "OAC",
    scopeNote: "Only the authorized response task is in scope.",
    topics: [{
      id: "topic",
      title: "Documented response",
      learningGoals: ["Produce the documented response."],
      theory: { summary: "The authorized passage supplies the response evidence.", keyIdeas: ["Use evidence."], formulas: [] },
      workedExamples: [],
      exercises: [],
      retrieval: [],
    }],
    sources: [{ id: "reader", label: "Course reader", url: "", coverage: "Documented response" }],
  } satisfies StudyGuideContent;
  const sectionId = "assessment-section";
  const item = {
    id: "question-bound-assessment-task",
    legacyExerciseId: "assessment-source-task-section",
    contentHash: "a".repeat(64),
    assessmentSectionId: sectionId,
    assessmentQuestionTypes: [declaredType],
    topicId: "topic",
    learningObjectiveIds: ["topic-objective-1"],
    type: exerciseType,
    stageIndex: 1,
    stageIntent: "assessment",
    stageLabel: "Documented response",
    difficulty: "assessment",
    estimatedMinutes: 10,
    origin: "course_original",
    scopeBasis: {
      topicTitle: "Documented response",
      learningObjectives: ["Produce the documented response."],
      sourceLabel: "Course reader",
      sourceTask: "Documented task",
    },
    review: {
      status: "pending",
      checks: { schema: false, scope: false, answer: false, provenance: false, rendering: false },
      findings: [],
    },
    exercise,
  } as AdaptiveStudyModel["questionBank"]["items"][number];
  const model = {
    courseBlueprint: {},
    assessmentBlueprint: {
      schemaVersion: 1,
      mode: "documented",
      title: "Documented assessment",
      confidence: "high",
      durationMinutes: null,
      maxPoints: null,
      passingPoints: null,
      allowedAids: [],
      prohibitedAids: [],
      sections: [{
        id: sectionId,
        title: "Documented response",
        order: 0,
        evidenceLevel: "explicit",
        deliveryMode,
        taskCount: 1,
        points: null,
        weight: null,
        durationMinutes: null,
        questionTypes: [declaredType],
        learningObjectiveIds: ["topic-objective-1"],
        evidenceExcerpt: "Authorized response evidence.",
      }],
      evidence: [{ level: "explicit", label: "Course reader", excerpt: "Authorized response evidence." }],
      planContentHash: createPlanHash(declaredType, deliveryMode),
    },
    questionBank: { schemaVersion: 1, courseId: "oac", items: [item], coverage: {} },
  } as unknown as AdaptiveStudyModel;
  return { content, model, item };
}

function createPlanHash(declaredType: string, deliveryMode: string): string {
  return assessmentSolutionSemanticCacheKey(
    { contractHash: "3".repeat(64), originalPromptHash: "4".repeat(64) },
    { declaredType, deliveryMode },
  );
}
