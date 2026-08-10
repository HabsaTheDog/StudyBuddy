import { createHash } from "node:crypto";
import { z } from "zod";
import { isAssessmentMetaQuestionText } from "./assessmentQuestionPolicy.js";
import {
  normalizeStudyGuideEvidenceRefs,
  studyGuideEvidenceRefSchema,
  studyGuideEvidenceRefsHash,
  studyGuideContentSchema,
  studyGuideExerciseSchema,
  type StudyGuideEvidenceRef,
  type StudyGuideContent,
} from "./studyGuideContent.js";
import type {
  AssessmentReferenceSolution,
  AssessmentSolutionSet,
} from "./assessmentSolutions.js";
import {
  learningVisualSchema,
  type LearningVisualSet,
} from "./learningVisualTypes.js";
import { deriveModuleDisplayTitle } from "./moduleTitles.js";
import {
  matchingApprovedQuestionReview,
  questionBankItemContentHash,
  questionBankItemReviewRecordSchema,
  questionReviewContext,
  type QuestionBankReviewSet,
} from "./questionBankReview.js";
import { handoffSectionGroups } from "./studyGuideProfile.js";
import type { RequestContract } from "../shared/requestContract.js";
import {
  compatibleProgressionPlan,
  matchingProgressionPlacement,
  progressionBindingMatches,
  type LearningProgressionPlan,
  type ProgressionBinding,
} from "./learningProgressionPlan.js";
import {
  assertAssessmentArchitecturePlanIntegrity,
  assessmentArchitecturePlanSchema,
  type AssessmentArchitecturePlan,
} from "./assessmentArchitecturePlan.js";

const learningStageIntentSchema = z.enum([
  "minimum",
  "foundation",
  "application",
  "depth",
  "assessment",
]);

const learningStageSchema = z.object({
  index: z.number().int().positive(),
  intent: learningStageIntentSchema,
  label: z.string().min(1),
  description: z.string().min(1),
});

const learningObjectiveSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
});

const learningBlockKindSchema = z.enum([
  "theory",
  "worked-example",
  "selection-practice",
  "calculation-practice",
  "open-response",
  "vocabulary-recall",
  "visual-interpretation",
  "external-performance-preparation",
]);

const courseModuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  displayTitle: z.string().min(1).optional(),
  order: z.number().int().nonnegative(),
  subtopics: z.array(z.string().min(1)).default([]),
  learningObjectives: z.array(learningObjectiveSchema).min(1),
  sourceLabels: z.array(z.string().min(1)),
  learningBlocks: z.array(z.object({
    kind: learningBlockKindSchema,
    evidenceReason: z.string().min(1),
  })).min(1),
  theoryVisual: learningVisualSchema.optional(),
});

export const courseBlueprintSchema = z.object({
  schemaVersion: z.literal(1),
  courseId: z.string().min(1),
  courseTitle: z.string().min(1),
  courseCode: z.string(),
  language: z.enum(["de", "en"]),
  scopeNote: z.string().min(1),
  modules: z.array(courseModuleSchema).min(1),
  learningStages: z.array(learningStageSchema).min(1).max(5),
});

const assessmentEvidenceSchema = z.object({
  level: z.enum(["explicit", "derived"]),
  label: z.string().min(1),
  excerpt: z.string().min(1).max(1_200),
});

const assessmentSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  evidenceLevel: z.enum(["explicit", "derived"]),
  deliveryMode: z.enum(["interactive", "self-assessed", "external-performance"]),
  taskCount: z.number().int().positive().nullable().optional(),
  points: z.number().nonnegative().nullable(),
  weight: z.number().min(0).max(1).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  questionTypes: z.array(z.string().min(1)).min(1),
  learningObjectiveIds: z.array(z.string().min(1)),
  evidenceExcerpt: z.string().min(1).max(1_200).optional(),
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
});

export const assessmentBlueprintSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["documented", "none", "inferred_practice"]),
  title: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  durationMinutes: z.number().int().positive().nullable(),
  maxPoints: z.number().positive().nullable(),
  passingPoints: z.number().nonnegative().nullable(),
  allowedAids: z.array(z.string().min(1)),
  prohibitedAids: z.array(z.string().min(1)),
  sections: z.array(assessmentSectionSchema),
  evidence: z.array(assessmentEvidenceSchema),
  basisRequirementIds: z.array(z.string().min(1)).optional(),
  rationale: z.string().min(1).optional(),
  planBinding: assessmentArchitecturePlanSchema.shape.binding.optional(),
  planContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const questionOriginSchema = z.enum([
  "course_original",
  "course_variant",
  "study_buddy_generated",
]);

const questionReviewChecksSchema = z.object({
  schema: z.boolean(),
  scope: z.boolean(),
  answer: z.boolean(),
  provenance: z.boolean(),
  rendering: z.boolean(),
});

const questionReviewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending"),
    checks: questionReviewChecksSchema,
    findings: z.array(z.string()),
  }),
  z.object({
    status: z.literal("approved"),
    checks: z.object({
      schema: z.literal(true),
      scope: z.literal(true),
      answer: z.literal(true),
      provenance: z.literal(true),
      rendering: z.literal(true),
    }),
    findings: z.array(z.string()),
    record: questionBankItemReviewRecordSchema,
  }),
]);

export const questionBankScopeBasisSchema = z.object({
  topicTitle: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)).min(1),
  sourceLabel: z.string().min(1),
  sourceTask: z.string().min(1),
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.evidenceRefs) !== Boolean(value.evidenceHash)) {
    context.addIssue({
      code: "custom",
      path: ["evidenceHash"],
      message: "Scope-basis evidence references and evidence hash must be present together.",
    });
  } else if (value.evidenceRefs && studyGuideEvidenceRefsHash(value.evidenceRefs) !== value.evidenceHash) {
    context.addIssue({
      code: "custom",
      path: ["evidenceHash"],
      message: "Scope-basis evidence hash does not match its normalized evidence references.",
    });
  }
});

const questionBankItemSchema = z.object({
  id: z.string().min(1),
  legacyExerciseId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  assessmentSectionId: z.string().min(1).optional(),
  assessmentQuestionTypes: z.array(z.string().min(1)).optional(),
  topicId: z.string().min(1),
  learningObjectiveIds: z.array(z.string().min(1)).min(1),
  type: z.enum(["cross", "calculation", "application", "vocabulary"]),
  stageIndex: z.number().int().positive(),
  stageIntent: learningStageIntentSchema,
  stageLabel: z.string().min(1),
  difficulty: z.enum(["basic", "standard", "advanced", "assessment"]),
  estimatedMinutes: z.number().int().positive(),
  origin: questionOriginSchema,
  scopeBasis: questionBankScopeBasisSchema,
  review: questionReviewSchema,
  referenceSolution: z.object({
    legacyExerciseId: z.string().min(1),
    completeness: z.literal("complete"),
    summary: z.string().min(1),
    steps: z.array(z.string().min(1)).min(2),
    finalAnswer: z.string().min(1),
    assumptions: z.array(z.string().min(1)),
    evidenceBasis: z.array(z.string().min(1)).min(1),
    missingEvidence: z.array(z.string()).max(0),
    solutionOrigin: z.enum(["course_verified", "study_buddy_generated"]),
    visualSelection: z.enum(["diagram_crop", "none"]).optional(),
    taskImage: z.object({
      dataUri: z.string().regex(/^data:image\/png;base64,/),
      alt: z.string().min(1),
      sourceLabel: z.string().min(1),
      kind: z.literal("diagram_crop").optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }).optional(),
    review: z.object({
      status: z.literal("approved"),
      findings: z.array(z.string()),
    }),
  }).optional(),
  visual: learningVisualSchema.optional(),
  exercise: studyGuideExerciseSchema,
});

export const questionBankSchema = z.object({
  schemaVersion: z.literal(1),
  courseId: z.string().min(1),
  items: z.array(questionBankItemSchema).min(1),
  coverage: z.object({
    objectiveIds: z.array(z.string().min(1)).min(1),
    coveredObjectiveIds: z.array(z.string().min(1)),
    missingObjectiveIds: z.array(z.string().min(1)),
    stageCounts: z.record(z.string(), z.number().int().nonnegative()),
  }),
});

export const adaptiveStudyModelSchema = z.object({
  courseBlueprint: courseBlueprintSchema,
  assessmentBlueprint: assessmentBlueprintSchema,
  questionBank: questionBankSchema,
});

export type CourseBlueprint = z.infer<typeof courseBlueprintSchema>;
export type AssessmentBlueprint = z.infer<typeof assessmentBlueprintSchema>;
export type QuestionBank = z.infer<typeof questionBankSchema>;
export type AdaptiveStudyModel = z.infer<typeof adaptiveStudyModelSchema>;

export function buildAdaptiveStudyModel(
  contentValue: StudyGuideContent,
  sourceText: string,
  language: "de" | "en",
  assessmentSolutions?: AssessmentSolutionSet,
  learningVisuals?: LearningVisualSet,
  questionReviews?: QuestionBankReviewSet,
  reviewContract?: { originalUserPrompt: string; requestContract: RequestContract },
  progressionPlan?: LearningProgressionPlan,
  progressionBinding?: ProgressionBinding,
  assessmentPlan?: AssessmentArchitecturePlan,
): AdaptiveStudyModel {
  const content = studyGuideContentSchema.parse(contentValue);
  const courseBlueprint = buildCourseBlueprint(
    content,
    sourceText,
    language,
    learningVisuals,
    progressionPlan,
    progressionBinding,
  );
  const assessmentBlueprint = buildAssessmentBlueprint(assessmentPlan, language);
  const questionBank = buildQuestionBank(
    content,
    courseBlueprint,
    assessmentBlueprint,
    sourceText,
    assessmentSolutions,
    learningVisuals,
    questionReviews,
    reviewContract,
    progressionPlan,
    progressionBinding,
  );
  if (progressionPlan && !compatibleProgressionPlan(progressionPlan, questionBank, progressionBinding)) {
    throw new Error("Learning progression plan is stale, incomplete, or bound to a different request contract.");
  }
  return adaptiveStudyModelSchema.parse({
    courseBlueprint,
    assessmentBlueprint,
    questionBank,
  });
}

export function buildCourseBlueprint(
  content: StudyGuideContent,
  sourceText: string,
  language: "de" | "en",
  learningVisuals?: LearningVisualSet,
  progressionPlan?: LearningProgressionPlan,
  progressionBinding?: ProgressionBinding,
): CourseBlueprint {
  const sectionGroups = handoffSectionGroups(sourceText);
  const modules = content.topics.map((topic, topicIndex) => ({
    id: topic.id,
    title: sectionGroups[topicIndex]?.title ?? topic.title,
    displayTitle: topic.navigationTitle ?? deriveModuleDisplayTitle(
      sectionGroups[topicIndex]?.title ?? topic.title,
    ),
    order: topicIndex,
    subtopics: sectionGroups[topicIndex]?.subtopics ?? [],
    learningObjectives: topic.learningGoals.map((goal, goalIndex) => ({
      id: `${topic.id}-objective-${goalIndex + 1}`,
      title: goal,
      order: goalIndex,
    })),
    sourceLabels: [...new Set([
      ...topic.workedExamples.map((example) => example.source.label),
      ...topic.exercises.map((exercise) => exercise.source.label),
      ...evidenceSourceLabels(content, verifiedEvidenceRefs(content, topic, topic.evidenceRefs)),
      ...evidenceSourceLabels(content, topic.retrieval.flatMap((retrieval) =>
        verifiedEvidenceRefs(content, topic, retrieval.evidenceRefs)
      )),
    ])],
    learningBlocks: deriveLearningBlocks(topic, sourceText, Boolean(learningVisuals?.modules[topic.id])),
    ...(learningVisuals?.modules[topic.id]
      ? { theoryVisual: learningVisuals.modules[topic.id] }
      : {}),
  }));
  const stages: CourseBlueprint["learningStages"] = progressionBindingMatches(progressionPlan, progressionBinding)
    ? progressionPlan!.stages.map((stage, index) => ({
        index: index + 1,
        intent: stage.intent,
        label: stage.label,
        description: stage.description,
      }))
    : [{
        index: 1,
        intent: "minimum",
        label: language === "de" ? "Neutral eingeordnet" : "Neutral placement",
        description: language === "de"
          ? "Für diese Ansicht liegt kein kompatibler, request-gebundener Lernprogressionsplan vor."
          : "No compatible request-bound learning progression plan is available for this view.",
      }];
  return courseBlueprintSchema.parse({
    schemaVersion: 1,
    courseId: stableSlug(content.courseCode || content.courseTitle),
    courseTitle: content.courseTitle,
    courseCode: content.courseCode,
    language,
    scopeNote: content.scopeNote,
    modules,
    learningStages: stages,
  });
}

function buildQuestionBank(
  content: StudyGuideContent,
  blueprint: CourseBlueprint,
  assessment: AssessmentBlueprint,
  sourceText: string,
  assessmentSolutions?: AssessmentSolutionSet,
  learningVisuals?: LearningVisualSet,
  questionReviews?: QuestionBankReviewSet,
  reviewContract?: { originalUserPrompt: string; requestContract: RequestContract },
  progressionPlan?: LearningProgressionPlan,
  progressionBinding?: ProgressionBinding,
): QuestionBank {
  const neutralStage = blueprint.learningStages[0]!;
  const courseItems = content.topics.flatMap((topic, topicIndex) => {
    const module = blueprint.modules.find((candidate) => candidate.id === topic.id)!;
    const retrievalExercises: StudyGuideContent["topics"][number]["exercises"] = topic.retrieval
      .flatMap((retrieval, retrievalIndex) => {
          const evidenceRefs = verifiedEvidenceRefs(content, topic, retrieval.evidenceRefs);
          if (evidenceRefs.length === 0) return [];
          if (retrieval.prompt.trim().length < 8 || retrieval.answer.trim().length < 12) return [];
          const sourceLabels = evidenceSourceLabels(content, evidenceRefs);
          return [{
            id: `${topic.id}-retrieval-${retrievalIndex + 1}`,
            type: "application" as const,
            prompt: retrieval.prompt,
            instructions: blueprint.language === "de"
              ? ["Beantworte die Frage zunächst ohne Unterlagen.", "Vergleiche anschließend Inhalt und Fachbegriffe mit der Beispielantwort."]
              : ["Answer from memory before consulting notes.", "Then compare the substance and terminology with the sample answer."],
            sampleAnswer: retrieval.answer,
            selfCheck: blueprint.language === "de"
              ? ["Die Kernaussage ist fachlich korrekt enthalten.", "Die Antwort bleibt innerhalb des genannten Kursthemas."]
              : ["The central claim is technically correct.", "The answer stays within the stated course topic."],
            source: {
              label: sourceLabels.join(" · "),
              sourceTask: evidenceRefs.map((reference) => reference.sectionHeading).join(" · "),
              provenance: "derived" as const,
            },
            evidenceRefs,
          }];
        });
    return [...topic.exercises, ...retrievalExercises].map((exercise) => {
      const evidenceRefs = verifiedEvidenceRefs(
        content,
        topic,
        exercise.evidenceRefs ?? legacyExerciseEvidenceRefs(content, topic, topicIndex, exercise),
      );
      const objectives = objectivesForEvidence(module.learningObjectives, evidenceRefs);
      const objectiveIds = objectives.map((objective) => objective.id);
      const origin = exercise.source.provenance === "source"
        ? "course_original"
        : exercise.source.provenance === "adapted"
          ? "course_variant"
          : "study_buddy_generated";
      const referenceSolution = referenceSolutionFromExercise(
        exercise,
        objectives.map((objective) => objective.title).join("; "),
        blueprint.language,
      );
      const visual = learningVisuals?.questions[exercise.id];
      const id = stableQuestionId(
        blueprint.courseId,
        topic.id,
        objectiveIds.join("+"),
        exercise.source.sourceTask,
        exercise.type,
        exercise.id,
      );
      const scopeBasis = questionBankScopeBasisSchema.parse({
        topicTitle: topic.title,
        learningObjectives: objectives.map((objective) => objective.title),
        sourceLabel: exercise.source.label,
        sourceTask: exercise.source.sourceTask,
        evidenceRefs,
        evidenceHash: studyGuideEvidenceRefsHash(evidenceRefs),
      });
      const contentHash = questionBankItemContentHash({ exercise, referenceSolution, visual, scopeBasis });
      const progressionItem = {
        id,
        legacyExerciseId: exercise.id,
        topicId: topic.id,
        learningObjectiveIds: objectiveIds,
        type: exercise.type,
        origin,
        scopeBasis,
        exercise,
      } as QuestionBank["items"][number];
      const placement = matchingProgressionPlacement(progressionPlan, progressionItem, progressionBinding);
      const stage = placement
        ? blueprint.learningStages[progressionPlan!.stages.findIndex((candidate) => candidate.id === placement.stageId)] ?? neutralStage
        : neutralStage;
      return {
        id,
        legacyExerciseId: exercise.id,
        contentHash,
        topicId: topic.id,
        learningObjectiveIds: objectiveIds,
        type: exercise.type,
        stageIndex: stage.index,
        stageIntent: stage.intent,
        stageLabel: stage.label,
        difficulty: placement?.difficulty ?? "standard",
        estimatedMinutes: exercise.type === "cross" || exercise.type === "vocabulary" ? 2 : exercise.type === "calculation" ? 8 : 10,
        origin,
        scopeBasis,
        review: resolvedQuestionReview(id, contentHash, questionReviews, reviewContract),
        referenceSolution,
        ...(visual ? { visual } : {}),
        exercise,
      };
    });
  });
  const assessmentItems = buildAssessmentSourceItems(
    content,
    blueprint,
    assessment,
    sourceText,
    assessmentSolutions,
    questionReviews,
    reviewContract,
    progressionPlan,
    progressionBinding,
  );
  const items = [...courseItems, ...assessmentItems].filter((item) =>
    !isAssessmentMetaQuestionText({
      prompt: item.exercise.prompt,
      sourceTask: item.scopeBasis.sourceTask,
    })
  );
  const objectiveIds = blueprint.modules.flatMap((module) =>
    module.learningObjectives.map((objective) => objective.id)
  );
  const coveredObjectiveIds = [...new Set(items.flatMap((item) => item.learningObjectiveIds))];
  const stageCounts = Object.fromEntries(blueprint.learningStages.map((stage) => [
    stage.intent,
    items.filter((item) => item.stageIntent === stage.intent).length,
  ]));
  return questionBankSchema.parse({
    schemaVersion: 1,
    courseId: blueprint.courseId,
    items,
    coverage: {
      objectiveIds,
      coveredObjectiveIds,
      missingObjectiveIds: objectiveIds.filter((id) => !coveredObjectiveIds.includes(id)),
      stageCounts,
    },
  });
}

function resolvedQuestionReview(
  itemId: string,
  contentHash: string,
  reviews?: QuestionBankReviewSet,
  contract?: { originalUserPrompt: string; requestContract: RequestContract },
): z.infer<typeof questionReviewSchema> {
  if (reviews && contract) {
    const record = matchingApprovedQuestionReview(
      reviews,
      { id: itemId, contentHash },
      questionReviewContext(contract.originalUserPrompt, contract.requestContract),
    );
    if (record) {
      return {
        status: "approved",
        checks: {
          schema: true,
          scope: true,
          answer: true,
          provenance: true,
          rendering: true,
        },
        findings: record.findings.map((finding) => finding.message),
        record,
      };
    }
  }
  return {
    status: "pending",
    checks: {
      schema: false,
      scope: false,
      answer: false,
      provenance: false,
      rendering: false,
    },
    findings: [],
  };
}

function deriveLearningBlocks(
  topic: StudyGuideContent["topics"][number],
  _sourceText: string,
  hasVisual: boolean,
): CourseBlueprint["modules"][number]["learningBlocks"] {
  const sourceReason = [...new Set([
    ...topic.workedExamples.map((example) => example.source.label),
    ...topic.exercises.map((exercise) => exercise.source.label),
  ])].slice(0, 2).join(" · ") || topic.title;
  const blocks: CourseBlueprint["modules"][number]["learningBlocks"] = [];
  const add = (kind: CourseBlueprint["modules"][number]["learningBlocks"][number]["kind"], reason: string) => {
    if (!blocks.some((block) => block.kind === kind)) blocks.push({ kind, evidenceReason: reason });
  };
  if (topic.theory.summary.trim() || topic.theory.keyIdeas.length > 0 || topic.theory.formulas.length > 0) {
    add("theory", `Course objectives and concepts in ${sourceReason}.`);
  }
  if (topic.workedExamples.length > 0) {
    add("worked-example", `The generated content plan retained source-supported worked example material for ${topic.title}.`);
  }
  if (topic.exercises.some((exercise) => exercise.type === "cross")) {
    add("selection-practice", "The evidence supports concrete distinctions, classifications, or misconception checks.");
  }
  if (topic.exercises.some((exercise) => exercise.type === "calculation")) {
    add("calculation-practice", "The evidence contains a quantitative method with solvable values.");
  }
  if (topic.exercises.some((exercise) => exercise.type === "application")) {
    add("open-response", "The learning objectives require an applied, written, spoken, procedural, or case response.");
  }
  if (topic.exercises.some((exercise) => exercise.type === "vocabulary")) {
    add("vocabulary-recall", "The course evidence requires terminology, expressions, or vocabulary retrieval.");
  }
  if (hasVisual) {
    add("visual-interpretation", "An authorized course visual materially supports this objective.");
  }
  if (blocks.length === 0) {
    add("theory", `The chapter remains visible for transparent source coverage: ${sourceReason}.`);
  }
  return blocks;
}

function buildAssessmentSourceItems(
  content: StudyGuideContent,
  course: CourseBlueprint,
  assessment: AssessmentBlueprint,
  _sourceText: string,
  assessmentSolutions?: AssessmentSolutionSet,
  questionReviews?: QuestionBankReviewSet,
  reviewContract?: { originalUserPrompt: string; requestContract: RequestContract },
  progressionPlan?: LearningProgressionPlan,
  progressionBinding?: ProgressionBinding,
): QuestionBank["items"] {
  if (assessment.mode !== "documented") return [];
  const neutralStage = course.learningStages[0]!;
  const solutionsById = new Map(
    (assessmentSolutions?.items ?? []).map((solution) => [
      solution.legacyExerciseId,
      solution,
    ]),
  );
  return assessment.sections.flatMap((section, index) => {
    if (
      section.deliveryMode === "external-performance" ||
      !section.evidenceExcerpt ||
      !section.evidenceRefs ||
      section.evidenceRefs.length === 0
    ) return [];
    const module = bestAssessmentModule(course, section.learningObjectiveIds);
    if (!module) return [];
    const selectedObjectives = module.learningObjectives.filter((objective) =>
      section.learningObjectiveIds.includes(objective.id)
    );
    if (selectedObjectives.length === 0) return [];
    const sourceLabel = assessment.evidence[index]?.label ?? content.sources[0]?.label ?? section.title;
    const sourceTask = section.evidenceExcerpt;
    const legacyExerciseId = `assessment-source-task-${section.id}`;
    const referenceSolution = solutionsById.get(legacyExerciseId);
    const exercise = assessmentSourceExerciseFromPlan({
      legacyExerciseId,
      evidenceExcerpt: section.evidenceExcerpt,
      sourceLabel,
      sourceTask,
      language: course.language,
      section,
      referenceSolution,
      solutionSetResolved: assessmentSolutions !== undefined,
    });
    if (!exercise) return [];
    const objectiveIds = selectedObjectives.map((objective) => objective.id);
    const evidenceRefs = normalizeStudyGuideEvidenceRefs(section.evidenceRefs);
    const scopeBasis = questionBankScopeBasisSchema.parse({
      topicTitle: module.title,
      learningObjectives: selectedObjectives.map((objective) => objective.title),
      sourceLabel,
      sourceTask,
      evidenceRefs,
      evidenceHash: studyGuideEvidenceRefsHash(evidenceRefs),
    });
    const id = stableQuestionId(
      course.courseId,
      module.id,
      objectiveIds.join("+"),
      sourceTask,
      exercise.type,
      exercise.id,
    );
    const normalizedReferenceSolution = referenceSolution
      ? normalizeReferenceSolution(referenceSolution)
      : undefined;
    const contentHash = questionBankItemContentHash({
      exercise,
      referenceSolution: normalizedReferenceSolution,
      scopeBasis,
    });
    const progressionItem = {
      id,
      legacyExerciseId: exercise.id,
      assessmentQuestionTypes: section.questionTypes,
      topicId: module.id,
      learningObjectiveIds: objectiveIds,
      type: exercise.type,
      origin: "course_original",
      scopeBasis,
      exercise,
    } as QuestionBank["items"][number];
    const placement = matchingProgressionPlacement(progressionPlan, progressionItem, progressionBinding);
    const stage = placement
      ? course.learningStages[progressionPlan!.stages.findIndex((candidate) => candidate.id === placement.stageId)] ?? neutralStage
      : neutralStage;
    return [{
      id,
      legacyExerciseId: exercise.id,
      contentHash,
      assessmentSectionId: section.id,
      assessmentQuestionTypes: section.questionTypes,
      topicId: module.id,
      learningObjectiveIds: objectiveIds,
      type: exercise.type,
      stageIndex: stage.index,
      stageIntent: stage.intent,
      stageLabel: stage.label,
      difficulty: placement?.difficulty ?? "standard",
      estimatedMinutes: section.durationMinutes ?? 1,
      origin: "course_original",
      scopeBasis,
      review: resolvedQuestionReview(id, contentHash, questionReviews, reviewContract),
      ...(normalizedReferenceSolution
        ? { referenceSolution: normalizedReferenceSolution }
        : {}),
      exercise,
    }];
  });
}

function assessmentSourceExerciseFromPlan(input: {
  legacyExerciseId: string;
  evidenceExcerpt: string;
  sourceLabel: string;
  sourceTask: string;
  language: "de" | "en";
  section: AssessmentBlueprint["sections"][number];
  referenceSolution?: AssessmentReferenceSolution;
  solutionSetResolved: boolean;
}): StudyGuideContent["topics"][number]["exercises"][number] | null {
  const source = {
    label: input.sourceLabel,
    sourceTask: input.sourceTask,
    provenance: "source" as const,
  };
  const hasCompleteReference = input.referenceSolution?.completeness === "complete" &&
    input.referenceSolution.missingEvidence.length === 0;
  if (input.solutionSetResolved && !hasCompleteReference) return null;

  // These are renderer capabilities, not a semantic type inference. An exact
  // evaluator-authored calculation contract may become an auto-checkable item
  // only after the source task has a complete reviewed solution. Other open
  // question types remain visible to the composer as coverage gaps instead of
  // being reinterpreted into a convenient local widget.
  if (input.section.questionTypes.length !== 1) return null;
  const [questionType] = input.section.questionTypes;
  if (questionType === "calculation") {
    if (!input.referenceSolution) {
      return {
        id: input.legacyExerciseId,
        type: "application",
        prompt: input.evidenceExcerpt,
        instructions: input.language === "de"
          ? ["Löse den dokumentierten Rechenauftrag vollständig.", "Prüfe Rechenweg und Ergebnis anhand der nachfolgenden Lösungsprüfung."]
          : ["Solve the documented calculation task completely.", "Check the method and result against the subsequent solution review."],
        sampleAnswer: input.language === "de"
          ? "Eine geprüfte Referenzlösung wird vor der Veröffentlichung ergänzt."
          : "A reviewed reference solution is added before publication.",
        selfCheck: input.language === "de"
          ? ["Alle dokumentierten Teilaufgaben sind bearbeitet.", "Rechenweg, Annahmen und Ergebnis sind nachvollziehbar."]
          : ["Every documented subtask is addressed.", "The method, assumptions, and result are traceable."],
        source,
      };
    }
    return {
      id: input.legacyExerciseId,
      type: "calculation",
      prompt: input.evidenceExcerpt,
      givens: [input.evidenceExcerpt],
      acceptedAnswers: [input.referenceSolution.finalAnswer],
      unit: "",
      steps: input.referenceSolution.steps,
      commonMistake: input.language === "de"
        ? "Nicht alle dokumentierten Teilaufgaben, Annahmen oder Einheiten zu prüfen."
        : "Failing to check every documented subtask, assumption, or unit.",
      source,
    };
  }
  if (questionType !== "open-response") return null;
  return {
    id: input.legacyExerciseId,
    type: "application",
    prompt: input.evidenceExcerpt,
    instructions: input.language === "de"
      ? [
          "Bearbeite den dokumentierten Auftrag vollständig in der vorgegebenen Form.",
          "Vergleiche deine Ausführung anschließend mit der geprüften Referenz und den belegten Bewertungshinweisen.",
        ]
      : [
          "Complete the documented task in its stated response form.",
          "Then compare your work with the reviewed reference and documented assessment guidance.",
        ],
    sampleAnswer: input.referenceSolution?.finalAnswer ?? (input.language === "de"
      ? "Eine geprüfte Study-Buddy-Vergleichslösung wird nach der Lösungsprüfung ergänzt."
      : "A reviewed Study Buddy comparison response is added after solution review."),
    selfCheck: input.language === "de"
      ? [
          "Der dokumentierte Auftrag ist vollständig bearbeitet.",
          "Antwortform und Begründung entsprechen der belegten Aufgabenstellung.",
        ]
      : [
          "The documented task is addressed completely.",
          "The response form and reasoning match the evidenced task brief.",
        ],
    source,
  };
}

function normalizeReferenceSolution(
  solution: AssessmentReferenceSolution,
): NonNullable<QuestionBank["items"][number]["referenceSolution"]> {
  if (solution.completeness !== "complete" || solution.missingEvidence.length > 0) {
    throw new Error(
      `Assessment reference solution ${solution.legacyExerciseId} is not publishable.`,
    );
  }
  return {
    ...solution,
    completeness: "complete",
    missingEvidence: [],
    summary: cleanText(solution.summary),
    steps: solution.steps.map(cleanText),
    finalAnswer: cleanText(solution.finalAnswer),
    assumptions: solution.assumptions.map(cleanText),
    evidenceBasis: solution.evidenceBasis.map(cleanText),
  };
}

function referenceSolutionFromExercise(
  exercise: StudyGuideContent["topics"][number]["exercises"][number],
  objectiveTitle: string,
  language: "de" | "en",
): NonNullable<QuestionBank["items"][number]["referenceSolution"]> {
  const sourceEvidence = `${exercise.source.label}: ${exercise.source.sourceTask}`;
  const objectiveEvidence = language === "de"
    ? `Geprüftes Lernziel: ${objectiveTitle}`
    : `Reviewed learning objective: ${objectiveTitle}`;
  const solutionOrigin = exercise.source.provenance === "source"
    ? "course_verified" as const
    : "study_buddy_generated" as const;
  if (exercise.type === "cross") {
    const correct = exercise.options
      .map((option, index) => option.correct
        ? `${String.fromCharCode(65 + index)}: ${option.text}`
        : "")
      .filter(Boolean);
    return {
      legacyExerciseId: exercise.id,
      completeness: "complete",
      summary: exercise.explanation,
      steps: [
        language === "de"
          ? "Jede Antwortmöglichkeit wird einzeln mit der belegten Kernaussage des Lernziels verglichen."
          : "Compare each option separately with the supported central claim of the learning objective.",
        exercise.explanation,
      ],
      finalAnswer: correct.join(" · "),
      assumptions: [],
      evidenceBasis: [sourceEvidence, objectiveEvidence],
      missingEvidence: [],
      solutionOrigin,
      review: { status: "approved", findings: [] },
    };
  }
  if (exercise.type === "calculation") {
    const accepted = exercise.acceptedAnswers.filter((answer) => answer !== "__self_check__");
    if (accepted.length === 0) {
      throw new Error(
        `Calculation ${exercise.id} has no complete answer contract for a reference solution.`,
      );
    }
    const steps = ensureTwoSolutionSteps(
      exercise.steps,
      language === "de"
        ? "Das Ergebnis wird mit Einheit und den verlangten Teilgrößen angegeben."
        : "State the result with its unit and every requested sub-result.",
    );
    return {
      legacyExerciseId: exercise.id,
      completeness: "complete",
      summary: language === "de"
        ? `Die Aufgabe wird mit dem geprüften Rechenweg gelöst und auf ${accepted.join(" oder ")} geführt.`
        : `Apply the reviewed method to obtain ${accepted.join(" or ")}.`,
      steps,
      finalAnswer: accepted.join(" · "),
      assumptions: [],
      evidenceBasis: [sourceEvidence, objectiveEvidence],
      missingEvidence: [],
      solutionOrigin,
      review: { status: "approved", findings: [] },
    };
  }
  if (exercise.type === "vocabulary") {
    return {
      legacyExerciseId: exercise.id,
      completeness: "complete",
      summary: exercise.explanation,
      steps: [
        language === "de"
          ? `Ordne „${exercise.term}“ der Bedeutung im belegten Kurskontext zu.`
          : `Map “${exercise.term}” to its meaning in the supported course context.`,
        exercise.context,
      ],
      finalAnswer: exercise.acceptedAnswers.join(" · "),
      assumptions: [],
      evidenceBasis: [sourceEvidence, objectiveEvidence],
      missingEvidence: [],
      solutionOrigin,
      review: { status: "approved", findings: [] },
    };
  }
  return {
    legacyExerciseId: exercise.id,
    completeness: "complete",
    summary: exercise.sampleAnswer,
    steps: ensureTwoSolutionSteps(
      exercise.instructions,
      language === "de"
        ? "Die Antwort wird anschließend vollständig mit der Beispielantwort und den Kriterien abgeglichen."
        : "Then compare the complete response with the sample answer and its criteria.",
    ),
    finalAnswer: exercise.sampleAnswer,
    assumptions: [],
    evidenceBasis: [sourceEvidence, objectiveEvidence],
    missingEvidence: [],
    solutionOrigin,
    review: { status: "approved", findings: [] },
  };
}

function ensureTwoSolutionSteps(steps: string[], fallback: string): string[] {
  const clean = steps.map(cleanText).filter(Boolean);
  return clean.length >= 2 ? clean : [...clean, fallback].slice(0, 2);
}

function bestAssessmentModule(
  course: CourseBlueprint,
  objectiveIds: string[],
): CourseBlueprint["modules"][number] | undefined {
  return [...course.modules].sort((left, right) => {
    const leftMatches = left.learningObjectives.filter((objective) =>
      objectiveIds.includes(objective.id)
    ).length;
    const rightMatches = right.learningObjectives.filter((objective) =>
      objectiveIds.includes(objective.id)
    ).length;
    return rightMatches - leftMatches || right.order - left.order;
  })[0];
}

function buildAssessmentBlueprint(
  plan: AssessmentArchitecturePlan | undefined,
  language: "de" | "en",
): AssessmentBlueprint {
  if (!plan) {
    return assessmentBlueprintSchema.parse({
      schemaVersion: 1,
      mode: "none",
      title: language === "de" ? "Keine dokumentierte Prüfungsarchitektur" : "No documented assessment architecture",
      confidence: "low",
      durationMinutes: null,
      maxPoints: null,
      passingPoints: null,
      allowedAids: [],
      prohibitedAids: [],
      sections: [],
      evidence: [],
      basisRequirementIds: [],
      rationale: language === "de"
        ? "Für diesen Modellaufbau wurde kein verifizierter Assessment-Plan übergeben."
        : "No verified assessment plan was supplied for this model build.",
    });
  }
  const verified = assertAssessmentArchitecturePlanIntegrity(plan);
  return assessmentBlueprintSchema.parse({
    schemaVersion: 1,
    mode: verified.mode,
    title: verified.title,
    confidence: verified.confidence,
    durationMinutes: verified.durationMinutes,
    maxPoints: verified.maxPoints,
    passingPoints: verified.passingPoints,
    allowedAids: verified.allowedAids,
    prohibitedAids: verified.prohibitedAids,
    sections: verified.sections.map((section, order) => ({ ...section, order })),
    evidence: verified.sections.map((section) => ({
      level: section.evidenceLevel,
      label: section.title,
      excerpt: section.evidenceExcerpt,
    })),
    basisRequirementIds: verified.basisRequirementIds,
    rationale: verified.rationale,
    planBinding: verified.binding,
    planContentHash: verified.contentHash,
  });
}

function objectivesForEvidence(
  objectives: CourseBlueprint["modules"][number]["learningObjectives"],
  refs: StudyGuideEvidenceRef[],
): CourseBlueprint["modules"][number]["learningObjectives"] {
  const indexes = new Set(refs.flatMap((reference) => reference.learningGoalIndexes));
  const evidenced = objectives.filter((objective) => indexes.has(objective.order));
  if (evidenced.length === 0) {
    throw new Error("Evidence capsule does not bind any learning objective in its course module.");
  }
  return evidenced;
}

function verifiedEvidenceRefs(
  content: StudyGuideContent,
  topic: StudyGuideContent["topics"][number],
  refs: StudyGuideEvidenceRef[] | undefined,
): StudyGuideEvidenceRef[] {
  if (!refs || refs.length === 0) return [];
  const normalized = normalizeStudyGuideEvidenceRefs(refs);
  const sourceIds = new Set(content.sources.map((source) => source.id));
  for (const reference of normalized) {
    if (reference.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error(`Evidence capsule for ${topic.id} references an unknown source ID.`);
    }
    if (reference.learningGoalIndexes.some((index) => index >= topic.learningGoals.length)) {
      throw new Error(`Evidence capsule for ${topic.id} references a missing learning goal index.`);
    }
  }
  return normalized;
}

function legacyExerciseEvidenceRefs(
  content: StudyGuideContent,
  topic: StudyGuideContent["topics"][number],
  topicIndex: number,
  exercise: StudyGuideContent["topics"][number]["exercises"][number],
): StudyGuideEvidenceRef[] {
  const matchedSource = content.sources.find((source) => source.label === exercise.source.label) ?? content.sources[0]!;
  return [{
    sourceIds: [matchedSource.id],
    sectionIndex: topicIndex,
    sectionHeading: topic.title,
    learningGoalIndexes: [0],
  }];
}

function evidenceSourceLabels(content: StudyGuideContent, refs: StudyGuideEvidenceRef[]): string[] {
  const labels = refs.flatMap((reference) => reference.sourceIds.map((sourceId) =>
    content.sources.find((source) => source.id === sourceId)?.label
  )).filter((label): label is string => Boolean(label));
  return [...new Set(labels)];
}

function cleanText(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
}

function stableSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "course";
}

function stableQuestionId(
  courseId: string,
  topicId: string,
  objectiveId: string,
  sourceTask: string,
  type: string,
  coverageSlot: string,
): string {
  return `question-${sha256([
    courseId,
    topicId,
    objectiveId,
    sourceTask.trim().toLocaleLowerCase(),
    type,
    coverageSlot,
  ].join("\u0000")).slice(0, 20)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
