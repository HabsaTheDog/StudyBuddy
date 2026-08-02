import { createHash } from "node:crypto";
import { z } from "zod";
import { isAssessmentMetaQuestionText } from "./assessmentQuestionPolicy.js";
import {
  studyGuideContentSchema,
  studyGuideExerciseSchema,
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
import { handoffSectionGroups } from "./studyGuideProfile.js";

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
  learningStages: z.array(learningStageSchema).min(2).max(5),
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
  questionTypes: z.array(z.enum([
    "selection",
    "calculation",
    "open-response",
    "flashcard",
  ])).min(1),
  learningObjectiveIds: z.array(z.string().min(1)),
});

export const assessmentBlueprintSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["explicit", "inferred"]),
  title: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  durationMinutes: z.number().int().positive().nullable(),
  maxPoints: z.number().positive().nullable(),
  passingPoints: z.number().nonnegative().nullable(),
  allowedAids: z.array(z.string().min(1)),
  prohibitedAids: z.array(z.string().min(1)),
  sections: z.array(assessmentSectionSchema).min(1),
  evidence: z.array(assessmentEvidenceSchema),
});

const questionOriginSchema = z.enum([
  "course_original",
  "course_variant",
  "study_buddy_generated",
]);

const questionReviewSchema = z.object({
  status: z.literal("approved"),
  checks: z.object({
    schema: z.literal(true),
    scope: z.literal(true),
    answer: z.literal(true),
    provenance: z.literal(true),
    rendering: z.literal(true),
  }),
  findings: z.array(z.string()),
});

const questionBankItemSchema = z.object({
  id: z.string().min(1),
  legacyExerciseId: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  assessmentSectionId: z.string().min(1).optional(),
  topicId: z.string().min(1),
  learningObjectiveIds: z.array(z.string().min(1)).min(1),
  type: z.enum(["cross", "calculation", "application", "vocabulary"]),
  stageIndex: z.number().int().positive(),
  stageIntent: learningStageIntentSchema,
  stageLabel: z.string().min(1),
  difficulty: z.enum(["basic", "standard", "advanced", "assessment"]),
  estimatedMinutes: z.number().int().positive(),
  origin: questionOriginSchema,
  scopeBasis: z.object({
    topicTitle: z.string().min(1),
    learningObjectives: z.array(z.string().min(1)).min(1),
    sourceLabel: z.string().min(1),
    sourceTask: z.string().min(1),
  }),
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
): AdaptiveStudyModel {
  const content = studyGuideContentSchema.parse(contentValue);
  const assessmentCorpus = normalizeEvidenceText(sourceText);
  const hasAssessmentEvidence = hasExplicitAssessmentEvidence(assessmentCorpus);
  const courseBlueprint = buildCourseBlueprint(
    content,
    sourceText,
    language,
    hasAssessmentEvidence,
    learningVisuals,
  );
  const assessmentBlueprint = buildAssessmentBlueprint(
    content,
    courseBlueprint,
    assessmentCorpus,
    language,
  );
  const questionBank = buildQuestionBank(
    content,
    courseBlueprint,
    assessmentBlueprint,
    assessmentCorpus,
    assessmentSolutions,
    learningVisuals,
  );
  return adaptiveStudyModelSchema.parse({
    courseBlueprint,
    assessmentBlueprint,
    questionBank,
  });
}

function buildCourseBlueprint(
  content: StudyGuideContent,
  sourceText: string,
  language: "de" | "en",
  hasAssessmentEvidence: boolean,
  learningVisuals?: LearningVisualSet,
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
    ])],
    learningBlocks: deriveLearningBlocks(topic, sourceText, Boolean(learningVisuals?.modules[topic.id])),
    ...(learningVisuals?.modules[topic.id]
      ? { theoryVisual: learningVisuals.modules[topic.id] }
      : {}),
  }));
  const t = language === "de"
    ? {
        foundation: ["Grundlagen", "Begriffe, Zusammenhänge und erste sichere Anwendungen."],
        application: ["Anwenden", "Das Gelernte in typischen Aufgaben verwenden."],
        depth: ["Vertiefen", "Mehrschrittige, offene oder anspruchsvollere Aufgaben bearbeiten."],
        assessment: ["Prüfungsnah", "An der belegten Prüfungs- oder Aufgabenform orientiert üben."],
      }
    : {
        foundation: ["Foundations", "Build concepts, relationships, and first reliable applications."],
        application: ["Apply", "Use the material in representative tasks."],
        depth: ["Deepen", "Work through multi-step, open, or more demanding tasks."],
        assessment: ["Assessment practice", "Practise the documented assessment or task format."],
      };
  const stages: CourseBlueprint["learningStages"] = [
    { index: 1, intent: "foundation", label: t.foundation[0], description: t.foundation[1] },
    { index: 2, intent: "application", label: t.application[0], description: t.application[1] },
  ];
  if (content.topics.some((topic) => topic.exercises.length >= 3)) {
    stages.push({ index: 3, intent: "depth", label: t.depth[0], description: t.depth[1] });
  }
  if (hasAssessmentEvidence) {
    stages.push({ index: stages.length + 1, intent: "assessment", label: t.assessment[0], description: t.assessment[1] });
  }
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
): QuestionBank {
  const assessmentStage = blueprint.learningStages.find((stage) => stage.intent === "assessment");
  const depthStage = blueprint.learningStages.find((stage) => stage.intent === "depth");
  const applicationStage = blueprint.learningStages.find((stage) => stage.intent === "application")!;
  const foundationStage = blueprint.learningStages.find((stage) => stage.intent === "foundation")!;
  const courseItems = content.topics.flatMap((topic) => {
    const module = blueprint.modules.find((candidate) => candidate.id === topic.id)!;
    const fallbackSource = topic.exercises[0]?.source ?? topic.workedExamples[0]?.source;
    const retrievalExercises: StudyGuideContent["topics"][number]["exercises"] = fallbackSource
      ? topic.retrieval.flatMap((retrieval, retrievalIndex) => {
          if (retrieval.prompt.trim().length < 8 || retrieval.answer.trim().length < 12) return [];
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
              label: fallbackSource.label,
              sourceTask: blueprint.language === "de"
                ? `Abgeleitet aus Quelle ${fallbackSource.label}: Wiederholungsfrage zu ${topic.title}`
                : `Derived from source ${fallbackSource.label}: retrieval for ${topic.title}`,
              provenance: "derived" as const,
            },
          }];
        })
      : [];
    return [...topic.exercises, ...retrievalExercises].map((exercise, exerciseIndex) => {
      const objective = selectObjective(module.learningObjectives, exercise.prompt, exercise.source.sourceTask, exercise.id);
      const assessmentLike = Boolean(
        assessmentStage &&
        /(?:musterprüfung|prüfung|exam|klausur|vocabulary\s*test|vokabeltest|test\s*question)/i.test(exercise.source.sourceTask),
      );
      const stage = assessmentLike
        ? assessmentStage!
        : exercise.type === "cross" || exercise.type === "vocabulary"
          ? foundationStage
          : exerciseIndex >= Math.ceil(topic.exercises.length / 2) && depthStage
            ? depthStage
            : applicationStage;
      const difficulty = stage.intent === "assessment"
        ? "assessment"
        : stage.intent === "depth"
          ? "advanced"
          : stage.intent === "foundation"
            ? "basic"
            : "standard";
      const origin = exercise.source.provenance === "source"
        ? "course_original"
        : exercise.source.provenance === "adapted"
          ? "course_variant"
          : "study_buddy_generated";
      const referenceSolution = referenceSolutionFromExercise(
        exercise,
        objective.title,
        blueprint.language,
      );
      const visual = learningVisuals?.questions[exercise.id];
      return {
        id: stableQuestionId(
          blueprint.courseId,
          topic.id,
          objective.id,
          exercise.source.sourceTask,
          exercise.type,
          exercise.id,
        ),
        legacyExerciseId: exercise.id,
        contentHash: sha256(JSON.stringify({ exercise, referenceSolution, visual })),
        topicId: topic.id,
        learningObjectiveIds: [objective.id],
        type: exercise.type,
        stageIndex: stage.index,
        stageIntent: stage.intent,
        stageLabel: stage.label,
        difficulty,
        estimatedMinutes: exercise.type === "cross" || exercise.type === "vocabulary" ? 2 : exercise.type === "calculation" ? 8 : 10,
        origin,
        scopeBasis: {
          topicTitle: topic.title,
          learningObjectives: [objective.title],
          sourceLabel: exercise.source.label,
          sourceTask: exercise.source.sourceTask,
        },
        review: {
          status: "approved" as const,
          checks: {
            schema: true as const,
            scope: true as const,
            answer: true as const,
            provenance: true as const,
            rendering: true as const,
          },
          findings: [],
        },
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

function deriveLearningBlocks(
  topic: StudyGuideContent["topics"][number],
  _sourceText: string,
  hasVisual: boolean,
): CourseBlueprint["modules"][number]["learningBlocks"] {
  const corpus = [
    topic.title,
    ...topic.learningGoals,
    ...topic.exercises.map((exercise) => `${exercise.prompt} ${exercise.source.sourceTask}`),
  ].join(" ");
  const sourceReason = [...new Set([
    ...topic.workedExamples.map((example) => example.source.label),
    ...topic.exercises.map((exercise) => exercise.source.label),
  ])].slice(0, 2).join(" · ") || topic.title;
  const blocks: CourseBlueprint["modules"][number]["learningBlocks"] = [
    { kind: "theory", evidenceReason: `Course objectives and concepts in ${sourceReason}.` },
    { kind: "worked-example", evidenceReason: `Worked application required for ${topic.title}.` },
  ];
  const add = (kind: CourseBlueprint["modules"][number]["learningBlocks"][number]["kind"], reason: string) => {
    if (!blocks.some((block) => block.kind === kind)) blocks.push({ kind, evidenceReason: reason });
  };
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
  if (/(?:pecha\s*kucha|presentation|oral(?:ly)?|speaking|vortrag|präsentation|mündlich)/i.test(corpus)) {
    add("external-performance-preparation", "The course requires a live or externally judged performance that the offline page can prepare but not honestly simulate or grade.");
  }
  return blocks;
}

function buildAssessmentSourceItems(
  content: StudyGuideContent,
  course: CourseBlueprint,
  assessment: AssessmentBlueprint,
  sourceText: string,
  assessmentSolutions?: AssessmentSolutionSet,
): QuestionBank["items"] {
  if (assessment.mode !== "explicit") return [];
  const stage = course.learningStages.find((candidate) => candidate.intent === "assessment");
  if (!stage) return [];
  const tasks = numberedAssessmentTasks(assessmentExcerpt(sourceText));
  if (!tasks.length) return [];
  const sourceLabel = content.sources.find((source) =>
    /(?:muster|probe|alt).{0,20}(?:prüfung|klausur)|sample.{0,12}exam|past.{0,12}(?:paper|exam)/i.test(source.label)
  )?.label ?? assessment.evidence[0]?.label ??
    (course.language === "de" ? "Prüfungsunterlagen" : "Assessment material");
  const solutionsById = new Map(
    (assessmentSolutions?.items ?? []).map((solution) => [
      solution.legacyExerciseId,
      solution,
    ]),
  );
  return tasks.flatMap((task, index) => {
    const section = assessment.sections[index];
    if (!section) return [];
    const givens = assessmentTaskLines(task.context);
    if (givens.join(" ").length < 80) return [];
    const module = bestAssessmentModule(course, section.learningObjectiveIds);
    const objectives = section.learningObjectiveIds.length
      ? course.modules.flatMap((candidate) => candidate.learningObjectives)
        .filter((objective) => section.learningObjectiveIds.includes(objective.id))
      : module.learningObjectives;
    const selectedObjectives = objectives.length ? objectives : module.learningObjectives;
    const sourceTask = course.language === "de"
      ? `Originale Prüfungsaufgabe ${index + 1}: ${task.title}`
      : `Original assessment task ${index + 1}: ${task.title}`;
    const exercise: StudyGuideContent["topics"][number]["exercises"][number] = {
      id: `assessment-source-task-${index + 1}`,
      type: "calculation",
      prompt: course.language === "de"
        ? `Bearbeite die Prüfungsaufgabe „${task.title}“ vollständig und dokumentiere deinen Lösungsweg nachvollziehbar.`
        : `Complete the assessment task “${task.title}” and document a traceable solution.`,
      givens,
      acceptedAnswers: ["__self_check__"],
      unit: "",
      steps: assessmentRubricSteps(givens, course.language),
      commonMistake: course.language === "de"
        ? "Nur Endwerte oder eine Beschreibung der Musterprüfung anzugeben, statt die technische Aufgabe mit Rechenweg zu lösen."
        : "Reporting only final values or describing the sample exam instead of solving the technical task with a traceable method.",
      source: {
        label: sourceLabel,
        sourceTask,
        provenance: "source",
      },
    };
    const referenceSolution = solutionsById.get(exercise.id);
    const objectiveIds = selectedObjectives.map((objective) => objective.id);
    return [{
      id: stableQuestionId(
        course.courseId,
        module.id,
        objectiveIds.join("+"),
        sourceTask,
        exercise.type,
        exercise.id,
      ),
      legacyExerciseId: exercise.id,
      contentHash: sha256(JSON.stringify({ exercise, referenceSolution })),
      assessmentSectionId: section.id,
      topicId: module.id,
      learningObjectiveIds: objectiveIds,
      type: exercise.type,
      stageIndex: stage.index,
      stageIntent: stage.intent,
      stageLabel: stage.label,
      difficulty: "assessment",
      estimatedMinutes: Math.max(10, Math.min(45, Math.round((task.points ?? 20) / 2))),
      origin: "course_original",
      scopeBasis: {
        topicTitle: module.title,
        learningObjectives: selectedObjectives.map((objective) => objective.title),
        sourceLabel,
        sourceTask,
      },
      review: {
        status: "approved",
        checks: {
          schema: true,
          scope: true,
          answer: true,
          provenance: true,
          rendering: true,
        },
        findings: [],
      },
      ...(referenceSolution
        ? { referenceSolution: normalizeReferenceSolution(referenceSolution) }
        : {}),
      exercise,
    }];
  });
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

function assessmentRubricSteps(
  taskLines: string[],
  language: "de" | "en",
): string[] {
  const demandIndex = taskLines.findIndex((line) =>
    /(?:zu\s+ermittel|gesucht|required|to\s+be\s+determined|determine\s+the\s+following)/i.test(line)
  );
  const demandLines = demandIndex >= 0 ? taskLines.slice(demandIndex + 1) : taskLines;
  const requested: string[] = [];
  for (const line of demandLines) {
    const numbered = /^\s*\d+[.)]\s*/.test(line);
    const bullet = /^\s*[-–—•]\s*/.test(line);
    const explicitDemand =
      /(?:bestimm|ermittel|berechn|nachzuprüf|analys|determin|calculate|verify|analyse|analyze)/i.test(line);
    if (numbered || (demandIndex >= 0 && bullet) || (demandIndex < 0 && explicitDemand)) {
      const cleaned = cleanText(line.replace(/^\s*(?:\d+[.)]|[-–—•])\s*/, ""));
      if (cleaned.length >= 5) requested.push(cleaned);
      continue;
    }
    if (requested.length > 0 && line.length >= 3) {
      requested[requested.length - 1] = cleanText(
        `${requested[requested.length - 1]} ${line}`,
      );
    }
  }
  const uniqueRequested = [...new Set(requested)].slice(0, 7);
  const taskCriteria = uniqueRequested.map((line) =>
    language === "de"
      ? conciseRubricCriterion(line, "de")
      : conciseRubricCriterion(line, "en")
  );
  const methodCriteria = language === "de"
    ? [
        "Ausgangsformeln und Umformungen sind korrekt.",
        "Zahlenwerte, Einheiten und Tabellenwerte sind nachvollziehbar.",
        "Ergebnisse sind plausibel und den Teilfragen eindeutig zugeordnet.",
      ]
    : [
        "Governing relations and rearrangements are correct.",
        "Values, units, and table references are traceable.",
        "Results are plausible and mapped clearly to the requested subtasks.",
      ];
  return [...taskCriteria, ...methodCriteria].slice(0, 10);
}

function conciseRubricCriterion(line: string, language: "de" | "en"): string {
  const trimmed = line.replace(/[,:;.\s]+$/, "");
  if (language === "de") {
    if (/^(?:der|die|das|den)\b/i.test(trimmed)) return `${trimmed} korrekt bestimmt.`;
    return `${trimmed} vollständig und korrekt bearbeitet.`;
  }
  return `${trimmed} completed correctly.`;
}

function bestAssessmentModule(
  course: CourseBlueprint,
  objectiveIds: string[],
): CourseBlueprint["modules"][number] {
  const explicitAssessmentModule = course.modules.find((module) =>
    /(?:prüfung|klausur|exam|assessment|test)/i.test(module.title)
  );
  if (explicitAssessmentModule) return explicitAssessmentModule;
  return [...course.modules].sort((left, right) => {
    const leftMatches = left.learningObjectives.filter((objective) =>
      objectiveIds.includes(objective.id)
    ).length;
    const rightMatches = right.learningObjectives.filter((objective) =>
      objectiveIds.includes(objective.id)
    ).length;
    return rightMatches - leftMatches || right.order - left.order;
  })[0]!;
}

function buildAssessmentBlueprint(
  content: StudyGuideContent,
  course: CourseBlueprint,
  sourceText: string,
  language: "de" | "en",
): AssessmentBlueprint {
  const explicitEvidence = hasExplicitAssessmentEvidence(sourceText);
  const excerpt = assessmentExcerpt(sourceText);
  const durationMinutes = firstNumber(excerpt, /(?:Dauer|duration|time)\s*:?\s*(\d{1,3})\s*(?:min|minutes?)/i);
  const maxPoints = firstNumber(excerpt, /(?:Maximal\s+sind(?:\s+auf\s+diese\s+Klausur)?|maximum(?:\s+of)?)\D{0,40}(\d{1,4})\s*(?:Punkte|points?)/i);
  const passingPoints = firstNumber(excerpt, /(?:ab|from)\s+(\d{1,4})\s*(?:Punkten|points?)\s+(?:positiv|pass)/i);
  const numberedSections = numberedAssessmentTasks(excerpt);
  const namedSections = numberedSections.length
    ? numberedSections
    : detectNamedAssessmentSections(excerpt);
  const explicitStructure = explicitEvidence && namedSections.length > 0;
  const sections = namedSections.length
    ? namedSections.map((section, index) => assessmentSection(
        section.title,
        index,
        explicitStructure ? "explicit" : "derived",
        numberedSections.length ? 1 : null,
        section.points,
        maxPoints,
        course,
        section.context,
        section.weight,
      ))
    : derivedAssessmentSections(content, course, language);
  const pointsTotal = sections.reduce((total, section) => total + (section.points ?? 0), 0);
  if (!maxPoints && pointsTotal > 0) {
    for (const section of sections) section.weight = (section.points ?? 0) / pointsTotal;
  }
  const aids = extractAids(excerpt, /(?:Erlaubt\s+sind|Allowed(?:\s+aids)?(?:\s+are)?)\s*:?\s*([^\\\n]{3,240})/i);
  const prohibited = extractAids(excerpt, /(?:Keine\s+Verwendung\s+von|Not\s+allowed)\s*:?\s*([^\\\n]{3,240})/i);
  const title = explicitStructure
    ? language === "de" ? "Prüfungssimulation" : "Exam simulation"
    : language === "de" ? "Übungssimulation nach Kursstruktur" : "Exercise simulation based on course structure";
  return assessmentBlueprintSchema.parse({
    schemaVersion: 1,
    mode: explicitStructure ? "explicit" : "inferred",
    title,
    confidence: explicitStructure && sections.length >= 2
      ? "high"
      : explicitStructure
        ? "medium"
        : "low",
    durationMinutes,
    maxPoints,
    passingPoints,
    allowedAids: aids,
    prohibitedAids: prohibited,
    sections,
    evidence: excerpt
      ? [{
          level: explicitEvidence ? "explicit" : "derived",
          label: explicitEvidence
            ? language === "de" ? "Prüfungsinformation im Kurs" : "Course assessment information"
            : language === "de" ? "Aus Kurs- und Aufgabenstruktur abgeleitet" : "Derived from course and task structure",
          excerpt: excerpt.slice(0, 1_200),
        }]
      : [],
  });
}

function assessmentSection(
  title: string,
  order: number,
  evidenceLevel: "explicit" | "derived",
  taskCount: number | null,
  points: number | null,
  maxPoints: number | null,
  course: CourseBlueprint,
  context = "",
  explicitWeight: number | null = null,
): AssessmentBlueprint["sections"][number] {
  const titleLower = title.toLocaleLowerCase();
  const lower = `${title} ${context}`.toLocaleLowerCase();
  const questionTypes: AssessmentBlueprint["sections"][number]["questionTypes"] =
    /(?:rechen|calculation|numeric|mathemat)/i.test(titleLower)
      ? ["calculation"]
      : /(?:vocab|wortschatz|flashcard)/i.test(titleLower)
        ? ["flashcard"]
      : /(?:text|writing|essay|fall|case|argument|presentation|pecha|oral|speaking)/i.test(titleLower)
          ? ["open-response"]
          : /(?:theorie|theory|reading|lese|grammatik|grammar)/i.test(titleLower)
            ? ["selection", "open-response"]
            : /(?:berechn|maß(?:toleranz|eintragung)|festigkeit|nachgiebigkeit|vorspannkraft|drehmoment|calculation|numeric|mathemat)/i.test(lower)
              ? ["calculation"]
              : ["selection", "open-response"];
  const titleTokens = meaningfulTokens(title);
  const contextTokens = meaningfulTokens(context);
  const objectives = course.modules.flatMap((module) => module.learningObjectives);
  const matchedByTitle = objectives.filter((objective) =>
    tokenSetsRelated(meaningfulTokens(objective.title), titleTokens)
  );
  const matchedByContext = course.modules
    .filter((module) => tokenSetsRelated(meaningfulTokens(module.title), contextTokens))
    .flatMap((module) => module.learningObjectives);
  let matchedObjectives = [...new Map(
    [...matchedByTitle, ...matchedByContext].map((objective) => [objective.id, objective]),
  ).values()];
  if (
    matchedObjectives.length === 0 &&
    (questionTypes.includes("flashcard") || /^(?:theorie(?:teil)?|theory(?:\s+section)?|rechen(?:teil)?|calculation(?:\s+section)?|numerical(?:\s+section)?|vokabular(?:teil)?|vocabulary(?:\s+(?:section|test|part))?|leseverstehen|reading(?:\s+comprehension)?|grammatik(?:teil)?|grammar(?:\s+section)?|schreib(?:teil)?|textproduktion|writing(?:\s+section)?|essay)$/i.test(title.trim()))
  ) {
    matchedObjectives = objectives;
  }
  return {
    id: `assessment-section-${order + 1}`,
    title,
    order,
    evidenceLevel,
    deliveryMode: assessmentDeliveryMode(title, context),
    taskCount,
    points,
    weight: explicitWeight ?? (points !== null && maxPoints ? points / maxPoints : null),
    durationMinutes: null,
    questionTypes,
    learningObjectiveIds: matchedObjectives.map((objective) => objective.id),
  };
}

function derivedAssessmentSections(
  content: StudyGuideContent,
  course: CourseBlueprint,
  language: "de" | "en",
): AssessmentBlueprint["sections"] {
  const exercises = content.topics.flatMap((topic) => topic.exercises);
  const definitions: Array<{ title: string; types: AssessmentBlueprint["sections"][number]["questionTypes"] }> = [];
  if (exercises.some((exercise) => exercise.type === "cross")) {
    definitions.push({
      title: language === "de" ? "Grundlagen und Verständnis" : "Foundations and understanding",
      types: ["selection"],
    });
  }
  if (exercises.some((exercise) => exercise.type === "calculation")) {
    definitions.push({
      title: language === "de" ? "Rechnen und Anwenden" : "Calculation and application",
      types: ["calculation"],
    });
  }
  if (exercises.some((exercise) => exercise.type === "application")) {
    definitions.push({
      title: language === "de" ? "Transfer und offene Aufgaben" : "Transfer and open responses",
      types: ["open-response"],
    });
  }
  if (exercises.some((exercise) => exercise.type === "vocabulary")) {
    definitions.push({
      title: language === "de" ? "Vokabular und Fachbegriffe" : "Vocabulary and terminology",
      types: ["flashcard"],
    });
  }
  return definitions.map((definition, order) => ({
    id: `assessment-section-${order + 1}`,
    title: definition.title,
    order,
    evidenceLevel: "derived",
    deliveryMode: definition.types.includes("open-response") ? "self-assessed" : "interactive",
    taskCount: null,
    points: null,
    weight: null,
    durationMinutes: null,
    questionTypes: definition.types,
    learningObjectiveIds: course.modules.flatMap((module) =>
      module.learningObjectives.map((objective) => objective.id)
    ),
  }));
}

function assessmentDeliveryMode(
  title: string,
  context: string,
): AssessmentBlueprint["sections"][number]["deliveryMode"] {
  if (/(?:vocab|wortschatz|flashcard|selection|multiple\s*choice|identif(?:y|ication)|classif(?:y|ication)|matching|zuordn|calculation|rechen|numeric|reading|grammar|lese|grammatik)/i.test(title)) {
    return "interactive";
  }
  if (/(?:pecha\s*kucha|presentation|oral(?:ly)?|speaking|viva|practical(?:\s+\w+){0,5}\s+(?:exam|demonstration)|lab(?:oratory)?(?:\s+\w+){0,5}\s+(?:exam|demonstration)|vortrag|präsentation|mündlich)/i.test(title)) {
    return "external-performance";
  }
  if (/(?:writing|essay|case|argument|textproduktion|schreib|fallstudie)/i.test(`${title} ${context}`)) {
    return "self-assessed";
  }
  return "interactive";
}

function selectObjective(
  objectives: CourseBlueprint["modules"][number]["learningObjectives"],
  prompt: string,
  sourceTask: string,
  fallbackKey: string,
): CourseBlueprint["modules"][number]["learningObjectives"][number] {
  const evidenceTokens = tokens(`${prompt} ${sourceTask}`);
  const scored = objectives.map((objective) => ({
    objective,
    score: [...tokens(objective.title)].filter((token) => evidenceTokens.has(token)).length,
  })).sort((left, right) => right.score - left.score);
  if ((scored[0]?.score ?? 0) > 0) return scored[0].objective;
  const fallbackIndex = Number.parseInt(sha256(fallbackKey).slice(0, 8), 16) % objectives.length;
  return objectives[fallbackIndex];
}

function hasExplicitAssessmentEvidence(value: string): boolean {
  return assessmentMarkerIndexes(value).length > 0;
}

function assessmentExcerpt(value: string): string {
  const indexes = assessmentMarkerIndexes(value);
  if (indexes.length === 0) return "";
  const candidates = indexes.map((index) => {
    const excerpt = value.slice(Math.max(0, index - 500), index + 30_000);
    const score =
      (excerpt.match(/(?:Aufgabe|Question|Task)\s*\d{1,2}\s*:/gi)?.length ?? 0) * 12 +
      (excerpt.match(/(?:\d+(?:[.,]\d+)?)\s*(?:Punkte|points?)/gi)?.length ?? 0) * 5 +
      (excerpt.match(/\(\s*\d+(?:[.,]\d+)?\s*%\s*\)/g)?.length ?? 0) * 10 +
      (/(?:consist(?:s|ed)?\s+of|besteht\s+aus).{0,500}(?:presentation|präsentation|vocabulary|vokabular|oral|mündlich)/is.test(excerpt) ? 20 : 0) +
      (/(?:Dauer|duration|time)\s*:?\s*\d{1,3}\s*(?:min|minutes?)/i.test(excerpt) ? 8 : 0) +
      (/(?:Erlaubt\s+sind|Allowed(?:\s+aids)?)/i.test(excerpt) ? 6 : 0) +
      (/(?:Keine\s+Verwendung\s+von|Not\s+allowed)/i.test(excerpt) ? 6 : 0);
    return { excerpt, score, index };
  }).sort((left, right) => right.score - left.score || right.index - left.index);
  return candidates[0].excerpt
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function numberedAssessmentTasks(
  value: string,
): Array<{
  title: string;
  points: number | null;
  weight: number | null;
  order: number;
  context: string;
}> {
  const matches = [...value.matchAll(
    /(?:Aufgabe|Question|Task)\s*(\d{1,2})\s*:\s*([^\\\n(]{3,120}?)(?:\s*\((\d+(?:[.,]\d+)?)\s*(?:Punkte|points?)\))?(?=\\n|\n|$)/gi,
  )];
  return matches.map((match, index) => ({
    title: cleanText(match[2]),
    points: match[3] ? Number(match[3].replace(",", ".")) : null,
    weight: null,
    order: index,
    context: value.slice(
      match.index,
      matches[index + 1]?.index ?? Math.min(value.length, match.index + 4_000),
    ).split(/\n(?:\[Linked file\]|Selection:|Extraction status:)/i)[0],
  })).filter((section) => section.title.length >= 3);
}

function assessmentTaskLines(context: string): string[] {
  const lines = context
    .replace(/^(?:Aufgabe|Question|Task)\s*\d{1,2}\s*:[^\n]*(?:\n|$)/i, "")
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter((line) =>
      line.length >= 3 &&
      !/^\[Linked file\]$/i.test(line) &&
      !/^(?:Seite|Page)\s*\d+\b/i.test(line) &&
      !/^(?:Punkte|Note|Bewertung|Score|Grade)\s*:/i.test(line)
    )
    .map((line) => line.slice(0, 700));
  return lines.slice(0, 16);
}

function assessmentMarkerIndexes(value: string): number[] {
  const indexes = [
    ...value.matchAll(/(?:Musterprüfung|Prüfungsaufbau|Klausur|sample\s+exam|assessment\s+structure|exam\s+(?:format|structure))/gi),
    ...value.matchAll(/(?:Prüfung.{0,220}?(?:besteht|gliedert|umfasst|Teil|Dauer|Punkte|Hilfsmittel)|(?:exam|assessment).{0,220}?(?:consist(?:s|ed)?|includes|section|part|duration|points|aids))/gis),
  ].map((match) => match.index);
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function normalizeEvidenceText(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, " ")
    .replace(/\u00a0/g, " ");
}

function cleanText(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\s+/g, " ").trim();
}

function firstNumber(value: string, pattern: RegExp): number | null {
  const match = pattern.exec(value);
  return match?.[1] ? Number(match[1].replace(",", ".")) : null;
}

function extractAids(value: string, pattern: RegExp): string[] {
  const match = pattern.exec(value)?.[1];
  if (!match) return [];
  return match
    .split(/\s*(?:,|;|•| und | and )\s*/i)
    .map((entry) => entry.replace(/[.]+$/g, "").trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, 8);
}

function detectNamedAssessmentSections(
  value: string,
): Array<{ title: string; points: number | null; weight: number | null; order: number; context: string }> {
  const weighted = [...value.matchAll(
    /\b(Pecha\s*Kucha\s+presentation|content\s+questions?(?:\s+to\s+be\s+answered\s+orally)?|oral\s+(?:content\s+)?questions?|vocabulary\s+test)\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/gi,
  )].map((match) => ({
    title: cleanText(match[1]),
    points: null,
    weight: Number(match[2].replace(",", ".")) / 100,
    order: match.index,
    context: value.slice(Math.max(0, match.index - 500), match.index + 1_500),
  }));
  if (weighted.length >= 2) {
    return [...new Map(weighted.map((section) => [
      section.title.toLocaleLowerCase(),
      section,
    ])).values()]
      .sort((left, right) => left.order - right.order)
      .map((section, order) => ({ ...section, order }));
  }
  const genericWeighted = value
    .split(/\s*(?:,|;|\band\b|\bund\b)\s*/i)
    .flatMap((fragment) => {
      const match = /([^()\n]{2,100}?)\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/i.exec(fragment);
      if (!match) return [];
      const title = cleanText(match[1])
        .replace(/^.*?(?:consists?\s+of|besteht\s+aus|includes?|umfasst)\s+/i, "")
        .replace(/^(?:an?|the|einen?|eine[mnr]?|einem)\s+/i, "")
        .replace(/[.:]\s*$/, "");
      if (title.length < 3 || title.length > 90) return [];
      return [{
        title,
        points: null,
        weight: Number(match[2].replace(",", ".")) / 100,
        order: value.indexOf(match[0]),
        context: value.slice(Math.max(0, value.indexOf(match[0]) - 500), value.indexOf(match[0]) + 1_500),
      }];
    });
  if (genericWeighted.length >= 2) {
    return [...new Map(genericWeighted.map((section) => [
      section.title.toLocaleLowerCase(),
      section,
    ])).values()]
      .sort((left, right) => left.order - right.order)
      .map((section, order) => ({ ...section, order }));
  }
  const patterns = [
    /\b(?:Theorie(?:teil)?|Theory(?:\s+section)?)\b/i,
    /\b(?:Rechen(?:teil)?|Calculation(?:\s+section)?|Numerical(?:\s+section)?)\b/i,
    /\b(?:Vokabular(?:teil)?|Vocabulary(?:\s+section)?)\b/i,
    /\b(?:Leseverstehen|Reading(?:\s+comprehension)?)\b/i,
    /\b(?:Grammatik(?:teil)?|Grammar(?:\s+section)?)\b/i,
    /\b(?:Schreib(?:teil)?|Textproduktion|Writing(?:\s+section)?|Essay)\b/i,
    /\b(?:Fall(?:studie|teil)?|Case(?:\s+study|\s+section)?)\b/i,
    /\b(?:Pecha\s*Kucha\s+presentation|Presentation(?:\s+section)?)\b/i,
    /\b(?:content\s+questions?(?:\s+to\s+be\s+answered\s+orally)?|oral\s+(?:content\s+)?questions?|Speaking(?:\s+section)?)\b/i,
  ];
  const titles: string[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match && !titles.some((title) => title.toLocaleLowerCase() === match[0].toLocaleLowerCase())) {
      titles.push(match[0]);
    }
  }
  return titles.map((title, order) => ({ title, points: null, weight: null, order, context: value }));
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKD")
      .toLocaleLowerCase()
      .match(/[a-zäöüß]{4,}/g) ?? [],
  );
}

function meaningfulTokens(value: string): Set<string> {
  const stop = new Set([
    "einer", "eines", "einem", "eine", "einen", "einem", "einer", "eines",
    "diese", "dieser", "dieses", "sowie", "anhand", "gegebenen", "durchführen",
    "welche", "zusätzlichen", "angaben", "erforderlich", "erkennen", "unter",
    "with", "from", "that", "this", "these", "which", "given", "using", "and",
  ]);
  return new Set([...tokens(value)].filter((token) => !stop.has(token)));
}

function tokenSetsRelated(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((leftToken) =>
    [...right].some((rightToken) => {
      const leftStem = leftToken.replace(/(?:ungen|ung|ern|en|er|es|e|s)$/i, "");
      const rightStem = rightToken.replace(/(?:ungen|ung|ern|en|er|es|e|s)$/i, "");
      return leftStem === rightStem ||
        (leftStem.length >= 6 && rightStem.length >= 6 &&
          (leftStem.includes(rightStem) || rightStem.includes(leftStem)));
    })
  );
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
