import { createHash } from "node:crypto";
import { z } from "zod";
import { deriveModuleDisplayTitle, MODULE_DISPLAY_TITLE_MAX, moduleDisplayTitlePreservesHierarchy } from "./moduleTitles.js";
import type { StudyGuideRequirements } from "./studyGuideProfile.js";

export const studyGuideSourceRefSchema = z.object({
  label: z.string().min(1),
  sourceTask: z.string().min(1),
  provenance: z.enum(["source", "adapted", "derived"]),
});

const studyGuideEvidenceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((span) => span.end > span.start, {
  message: "Evidence span end must be greater than start.",
});

export const studyGuideEvidenceRefSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1),
  sectionIndex: z.number().int().nonnegative(),
  sectionHeading: z.string().min(1),
  learningGoalIndexes: z.array(z.number().int().nonnegative()).min(1),
  exactSpan: studyGuideEvidenceSpanSchema.nullable().optional(),
});

export type StudyGuideEvidenceRef = z.infer<typeof studyGuideEvidenceRefSchema>;

export function normalizeStudyGuideEvidenceRefs(refs: StudyGuideEvidenceRef[]): StudyGuideEvidenceRef[] {
  return [...new Map(refs.map((value) => {
    const parsed = studyGuideEvidenceRefSchema.parse(value);
    const normalized = {
      ...parsed,
      sourceIds: [...new Set(parsed.sourceIds)].sort(),
      learningGoalIndexes: [...new Set(parsed.learningGoalIndexes)].sort((left, right) => left - right),
    };
    return [JSON.stringify(normalized), normalized] as const;
  })).values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function studyGuideEvidenceRefsHash(refs: StudyGuideEvidenceRef[]): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeStudyGuideEvidenceRefs(refs)))
    .digest("hex");
}

const optionSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  feedback: z.string().min(1),
});

const crossExerciseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("cross"),
  prompt: z.string().min(8),
  selectionMode: z.enum(["single", "multiple", "true-false", "dropdown"]),
  options: z.array(optionSchema).min(2),
  explanation: z.string().min(12),
  estimatedMinutes: z.number().int().positive().optional(),
  source: studyGuideSourceRefSchema,
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
});

const calculationExerciseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("calculation"),
  prompt: z.string().min(8),
  givens: z.array(z.string().min(1)).min(1),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  unit: z.string(),
  steps: z.array(z.string().min(1)).min(2),
  commonMistake: z.string().min(8),
  estimatedMinutes: z.number().int().positive().optional(),
  source: studyGuideSourceRefSchema,
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
});

const applicationExerciseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("application"),
  prompt: z.string().min(8),
  instructions: z.array(z.string().min(1)).min(2),
  sampleAnswer: z.string().min(12),
  selfCheck: z.array(z.string().min(1)).min(2),
  estimatedMinutes: z.number().int().positive().optional(),
  source: studyGuideSourceRefSchema,
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
});

const vocabularyExerciseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("vocabulary"),
  prompt: z.string().min(8),
  direction: z.enum(["term-to-meaning", "meaning-to-term", "context-gap"]),
  term: z.string().min(1),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  context: z.string().min(1),
  explanation: z.string().min(8),
  estimatedMinutes: z.number().int().positive().optional(),
  source: studyGuideSourceRefSchema,
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
});

export const studyGuideExerciseSchema = z.discriminatedUnion("type", [
  crossExerciseSchema,
  calculationExerciseSchema,
  applicationExerciseSchema,
  vocabularyExerciseSchema,
]);

const topicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  navigationTitle: z.string().min(1).max(MODULE_DISPLAY_TITLE_MAX).optional(),
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
  learningGoals: z.array(z.string().min(1)),
  theory: z.object({
    summary: z.string(),
    keyIdeas: z.array(z.string().min(1)),
    formulas: z.array(z.object({
      expression: z.string().min(1),
      meaning: z.string().min(1),
    })),
  }),
  workedExamples: z.array(z.object({
    title: z.string().min(1),
    prompt: z.string().min(8),
    steps: z.array(z.string().min(1)).min(2),
    answer: z.string().min(1),
    source: studyGuideSourceRefSchema,
  })),
  exercises: z.array(studyGuideExerciseSchema),
  retrieval: z.array(z.object({
    prompt: z.string().min(1),
    answer: z.string().min(1),
    evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
  })),
}).superRefine((topic, context) => {
  const collections: Array<{ path: (string | number)[]; refs: StudyGuideEvidenceRef[] | undefined }> = [
    { path: ["evidenceRefs"], refs: topic.evidenceRefs },
    ...topic.exercises.map((exercise, index) => ({
      path: ["exercises", index, "evidenceRefs"],
      refs: exercise.evidenceRefs,
    })),
    ...topic.retrieval.map((retrieval, index) => ({
      path: ["retrieval", index, "evidenceRefs"],
      refs: retrieval.evidenceRefs,
    })),
  ];
  for (const collection of collections) {
    for (const [refIndex, ref] of (collection.refs ?? []).entries()) {
      for (const [goalIndexPosition, goalIndex] of ref.learningGoalIndexes.entries()) {
        if (goalIndex < topic.learningGoals.length) continue;
        context.addIssue({
          code: "custom",
          path: [...collection.path, refIndex, "learningGoalIndexes", goalIndexPosition],
          message: `learningGoalIndexes are zero-based indexes into this topic's learningGoals array (length ${topic.learningGoals.length}); got ${goalIndex}.`,
        });
      }
    }
  }
});

export const studyGuideContentSchema = z.object({
  courseTitle: z.string().min(1),
  courseCode: z.string().default(""),
  scopeNote: z.string().min(1),
  topics: z.array(topicSchema).min(1),
  sources: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    url: z.string(),
    coverage: z.string().min(1),
  })).min(1),
});

export type StudyGuideContent = z.infer<typeof studyGuideContentSchema>;

/**
 * Navigation labels are presentation metadata, not learning content. Repair a
 * model label that names only one example by deriving it from the already
 * validated course-faithful chapter title; a full chapter regeneration would
 * spend tokens without improving the semantic content.
 */
export function normalizeStudyGuideNavigationTitles(content: StudyGuideContent): number {
  let repaired = 0;
  for (const topic of content.topics) {
    if (
      topic.navigationTitle &&
      !moduleDisplayTitlePreservesHierarchy(topic.title, topic.navigationTitle)
    ) {
      topic.navigationTitle = deriveModuleDisplayTitle(topic.title);
      repaired += 1;
    }
  }
  return repaired;
}

export const studyGuideContentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["courseTitle", "courseCode", "scopeNote", "topics", "sources"],
  properties: {
    courseTitle: { type: "string" },
    courseCode: { type: "string" },
    scopeNote: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "navigationTitle", "evidenceRefs", "learningGoals", "theory", "workedExamples", "exercises", "retrieval"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          navigationTitle: { type: "string", maxLength: MODULE_DISPLAY_TITLE_MAX },
          evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } },
          learningGoals: { type: "array", items: { type: "string" } },
          theory: {
            type: "object", additionalProperties: false,
            required: ["summary", "keyIdeas", "formulas"],
            properties: {
              summary: { type: "string" },
              keyIdeas: { type: "array", items: { type: "string" } },
              formulas: { type: "array", items: { type: "object", additionalProperties: false, required: ["expression", "meaning"], properties: { expression: { type: "string" }, meaning: { type: "string" } } } },
            },
          },
          workedExamples: { type: "array", items: { $ref: "#/$defs/workedExample" } },
          exercises: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "type", "prompt", "estimatedMinutes", "selectionMode", "options", "explanation", "givens", "acceptedAnswers", "unit", "steps", "commonMistake", "instructions", "sampleAnswer", "selfCheck", "direction", "term", "context", "source", "evidenceRefs"],
              properties: {
                id: { type: "string" },
                type: { enum: ["cross", "calculation", "application", "vocabulary"] },
                prompt: { type: "string" },
                estimatedMinutes: { type: "integer", minimum: 1 },
                selectionMode: { enum: ["single", "multiple", "true-false", "dropdown", "none"] },
                options: { type: "array", items: { $ref: "#/$defs/option" } },
                explanation: { type: "string" },
                givens: { type: "array", items: { type: "string" } },
                acceptedAnswers: { type: "array", items: { type: "string" } },
                unit: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                commonMistake: { type: "string" },
                instructions: { type: "array", items: { type: "string" } },
                sampleAnswer: { type: "string" },
                selfCheck: { type: "array", items: { type: "string" } },
                direction: { enum: ["term-to-meaning", "meaning-to-term", "context-gap", "none"] },
                term: { type: "string" },
                context: { type: "string" },
                source: { $ref: "#/$defs/sourceRef" },
                evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } },
              },
            },
          },
          retrieval: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["prompt", "answer", "evidenceRefs"],
              properties: {
                prompt: { type: "string" },
                answer: { type: "string" },
                evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } },
              },
            },
          },
        },
      },
    },
    sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "url", "coverage"], properties: { id: { type: "string" }, label: { type: "string" }, url: { type: "string" }, coverage: { type: "string" } } } },
  },
  $defs: {
    evidenceRef: { type: "object", additionalProperties: false, required: ["sourceIds", "sectionIndex", "sectionHeading", "learningGoalIndexes", "exactSpan"], properties: { sourceIds: { type: "array", minItems: 1, items: { type: "string" } }, sectionIndex: { type: "integer", minimum: 0 }, sectionHeading: { type: "string" }, learningGoalIndexes: { type: "array", minItems: 1, items: { type: "integer", minimum: 0 } }, exactSpan: { anyOf: [{ type: "object", additionalProperties: false, required: ["start", "end", "sha256"], properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 1 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } } }, { type: "null" }] } } },
    sourceRef: { type: "object", additionalProperties: false, required: ["label", "sourceTask", "provenance"], properties: { label: { type: "string" }, sourceTask: { type: "string" }, provenance: { enum: ["source", "adapted", "derived"] } } },
    option: { type: "object", additionalProperties: false, required: ["text", "correct", "feedback"], properties: { text: { type: "string" }, correct: { type: "boolean" }, feedback: { type: "string" } } },
    crossExercise: { type: "object", additionalProperties: false, required: ["id", "type", "prompt", "estimatedMinutes", "selectionMode", "options", "explanation", "source", "evidenceRefs"], properties: { id: { type: "string" }, type: { type: "string", const: "cross" }, prompt: { type: "string" }, estimatedMinutes: { type: "integer", minimum: 1 }, selectionMode: { enum: ["single", "multiple", "true-false", "dropdown"] }, options: { type: "array", items: { $ref: "#/$defs/option" } }, explanation: { type: "string" }, source: { $ref: "#/$defs/sourceRef" }, evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } } } },
    calculationExercise: { type: "object", additionalProperties: false, required: ["id", "type", "prompt", "estimatedMinutes", "givens", "acceptedAnswers", "unit", "steps", "commonMistake", "source", "evidenceRefs"], properties: { id: { type: "string" }, type: { type: "string", const: "calculation" }, prompt: { type: "string" }, estimatedMinutes: { type: "integer", minimum: 1 }, givens: { type: "array", items: { type: "string" } }, acceptedAnswers: { type: "array", items: { type: "string" } }, unit: { type: "string" }, steps: { type: "array", items: { type: "string" } }, commonMistake: { type: "string" }, source: { $ref: "#/$defs/sourceRef" }, evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } } } },
    applicationExercise: { type: "object", additionalProperties: false, required: ["id", "type", "prompt", "estimatedMinutes", "instructions", "sampleAnswer", "selfCheck", "source", "evidenceRefs"], properties: { id: { type: "string" }, type: { type: "string", const: "application" }, prompt: { type: "string" }, estimatedMinutes: { type: "integer", minimum: 1 }, instructions: { type: "array", items: { type: "string" } }, sampleAnswer: { type: "string" }, selfCheck: { type: "array", items: { type: "string" } }, source: { $ref: "#/$defs/sourceRef" }, evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } } } },
    vocabularyExercise: { type: "object", additionalProperties: false, required: ["id", "type", "prompt", "estimatedMinutes", "direction", "term", "acceptedAnswers", "context", "explanation", "source", "evidenceRefs"], properties: { id: { type: "string" }, type: { type: "string", const: "vocabulary" }, prompt: { type: "string" }, estimatedMinutes: { type: "integer", minimum: 1 }, direction: { enum: ["term-to-meaning", "meaning-to-term", "context-gap"] }, term: { type: "string" }, acceptedAnswers: { type: "array", items: { type: "string" } }, context: { type: "string" }, explanation: { type: "string" }, source: { $ref: "#/$defs/sourceRef" }, evidenceRefs: { type: "array", minItems: 1, items: { $ref: "#/$defs/evidenceRef" } } } },
    workedExample: { type: "object", additionalProperties: false, required: ["title", "prompt", "steps", "answer", "source"], properties: { title: { type: "string" }, prompt: { type: "string" }, steps: { type: "array", items: { type: "string" } }, answer: { type: "string" }, source: { $ref: "#/$defs/sourceRef" } } },
  },
} as const;

export function validateStudyGuideChapterQuality(content: StudyGuideContent, _requirements?: StudyGuideRequirements): string[] {
  const exercises = content.topics.flatMap((topic) => topic.exercises);
  const crosses = exercises.filter((exercise) => exercise.type === "cross");
  const vocabulary = exercises.filter((exercise) => exercise.type === "vocabulary");
  const issues: string[] = [];
  const vocabularyTerms = vocabulary.map((exercise) => exercise.term.trim().toLocaleLowerCase());
  if (new Set(vocabularyTerms).size !== vocabularyTerms.length) {
    const duplicateGroups = [...new Set(vocabularyTerms)]
      .map((term) => vocabulary.filter((exercise) =>
        exercise.term.trim().toLocaleLowerCase() === term
      ))
      .filter((group) => group.length > 1);
    for (const group of duplicateGroups) {
      issues.push(`Vocabulary term '${group[0]!.term}' is duplicated in ${group.map((exercise) => exercise.id).join(", ")}; keep it only in the most relevant course topic and replace the other item.`);
    }
  }
  for (const exercise of vocabulary) {
    if (exercise.acceptedAnswers.some((answer) =>
      answer.trim().length < 4 && !/^[A-Z][A-Z0-9&.-]{1,5}$/.test(answer.trim())
    )) {
      issues.push(`${exercise.id} has an implausibly short vocabulary answer contract.`);
    }
    if (exercise.direction === "term-to-meaning" && exercise.acceptedAnswers.some((answer) =>
      answer.trim().toLocaleLowerCase() === exercise.term.trim().toLocaleLowerCase()
    )) {
      issues.push(`${exercise.id} repeats the term as its own meaning instead of defining or translating it.`);
    }
  }
  const prompts = exercises.map((exercise) => exercise.prompt.trim().toLowerCase());
  const genericPrompt = /^(welche aussage trifft zu|wähle alle sinnvollen (?:schritte|prüfschritte)|berechne (?:den )?wert)\??$/i;
  if (prompts.some((prompt) => genericPrompt.test(prompt))) issues.push("Generic exercise-template prompts are not allowed.");
  for (const exercise of crosses) {
    const correctCount = exercise.options.filter((option) => option.correct).length;
    if (correctCount === 0) issues.push(`${exercise.id} has no correct option.`);
    if (exercise.selectionMode === "single" && correctCount !== 1) issues.push(`${exercise.id} is single-choice but has ${correctCount} correct options.`);
    if (exercise.options.length < 3 && exercise.selectionMode !== "true-false") issues.push(`${exercise.id} needs at least three meaningful options.`);
  }
  const forbiddenInfrastructure = /(?:data:image\/|Local Moodle artifact root|Approved local image assets|assets\/logo|\/home\/[^\s]+)/i;
  for (const exercise of exercises) {
    const fields = exercise.type === "cross"
      ? [exercise.prompt, exercise.explanation, ...exercise.options.map((option) => option.text)]
      : exercise.type === "calculation"
        ? [exercise.prompt, ...exercise.givens, ...exercise.steps, exercise.commonMistake]
        : exercise.type === "application"
          ? [exercise.prompt, ...exercise.instructions, exercise.sampleAnswer, ...exercise.selfCheck]
          : [exercise.prompt, exercise.term, ...exercise.acceptedAnswers, exercise.context, exercise.explanation];
    if (fields.some((field) => forbiddenInfrastructure.test(field))) {
      issues.push(`${exercise.id} leaks infrastructure or embedded-asset data into learning content.`);
    }
    if (exercise.prompt.length > 1_500) issues.push(`${exercise.id} has an implausibly long prompt (${exercise.prompt.length} characters).`);
    if (fields.some((field) => field.length > 4_000)) issues.push(`${exercise.id} contains an implausibly long content field.`);
    if (fields.some((field) => /\b[xuntwy]\d{2,}\b|\)\s*[2-9]\b|π\d/i.test(field))) {
      issues.push(`${exercise.id} contains ambiguous OCR exponent notation that must be normalized or excluded.`);
    }
    if (exercise.source.provenance === "derived" && !/(?:folie|skript|kapitel|abschnitt|lernziel|quelle|thema|kursinhalt)/i.test(exercise.source.sourceTask)) {
      issues.push(`${exercise.id} is derived practice but does not identify the concrete source concept it was derived from.`);
    }
  }
  for (const topic of content.topics) {
    if (topic.navigationTitle && !moduleDisplayTitlePreservesHierarchy(topic.title, topic.navigationTitle)) {
      issues.push(`${topic.id} navigationTitle '${topic.navigationTitle}' does not preserve a recognizable concept from the course-faithful title '${topic.title}'; use the module concept rather than naming only one example or activity.`);
    }
    for (const formula of topic.theory.formulas) {
      const withoutNamedSubscripts = formula.expression.replace(/_[A-Za-z]+(?:,[A-Za-z]+)*/g, "");
      const proseWords = withoutNamedSubscripts.match(/\b[A-Za-zÄÖÜäöüß]{3,}\b/g)
        ?.filter((word) => !/^(?:lim|sin|cos|tan|exp|log|min|max|abs)$/i.test(word)) ?? [];
      if (formula.expression.length > 240 || proseWords.length > 8 || !balancedMathDelimiters(formula.expression)) {
        issues.push(`${topic.id} contains a theory formula that violates the structured-math contract: ${formula.expression}`);
      }
    }
  }
  return issues;
}

export function validateStudyGuideContentQuality(content: StudyGuideContent, requirements?: StudyGuideRequirements): string[] {
  const issues = validateStudyGuideChapterQuality(content, requirements);
  const exercises = content.topics.flatMap((topic) => topic.exercises);
  const prompts = exercises.map((exercise) => exercise.prompt.trim().toLowerCase());
  if (new Set(prompts).size !== prompts.length) {
    issues.push("Exercise prompts must be unique; duplicated prompts were found.");
  }
  const ids = exercises.map((exercise) => exercise.id);
  if (new Set(ids).size !== ids.length) issues.push("Exercise IDs must be globally unique.");
  return issues;
}

function balancedMathDelimiters(value: string): boolean {
  const stack: string[] = [];
  const closing: Record<string, string> = { ")": "(", "}": "{" };
  for (const character of value) {
    if (character === "(" || character === "{") stack.push(character);
    else if ((character === ")" || character === "}") && stack.pop() !== closing[character]) return false;
  }
  return stack.length === 0;
}
