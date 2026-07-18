import { z } from "zod";
import { fallbackStudyGuideRequirements, type StudyGuideRequirements } from "./studyGuideProfile.js";

const sourceRefSchema = z.object({
  label: z.string().min(1),
  sourceTask: z.string().min(1),
  provenance: z.enum(["source", "adapted", "derived"]),
});

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
  source: sourceRefSchema,
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
  source: sourceRefSchema,
});

const exerciseSchema = z.discriminatedUnion("type", [
  crossExerciseSchema,
  calculationExerciseSchema,
]);

const topicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  learningGoals: z.array(z.string().min(1)).min(1),
  theory: z.object({
    summary: z.string().min(80),
    keyIdeas: z.array(z.string().min(1)).min(2),
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
    source: sourceRefSchema,
  })).min(1),
  exercises: z.array(exerciseSchema).min(3),
  retrieval: z.array(z.object({
    prompt: z.string().min(1),
    answer: z.string().min(1),
  })).min(1),
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

export const studyGuideContentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["courseTitle", "scopeNote", "topics", "sources"],
  properties: {
    courseTitle: { type: "string" },
    courseCode: { type: "string" },
    scopeNote: { type: "string" },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "learningGoals", "theory", "workedExamples", "exercises", "retrieval"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
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
          exercises: { type: "array", items: { oneOf: [{ $ref: "#/$defs/crossExercise" }, { $ref: "#/$defs/calculationExercise" }] } },
          retrieval: { type: "array", items: { type: "object", additionalProperties: false, required: ["prompt", "answer"], properties: { prompt: { type: "string" }, answer: { type: "string" } } } },
        },
      },
    },
    sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "url", "coverage"], properties: { id: { type: "string" }, label: { type: "string" }, url: { type: "string" }, coverage: { type: "string" } } } },
  },
  $defs: {
    sourceRef: { type: "object", additionalProperties: false, required: ["label", "sourceTask", "provenance"], properties: { label: { type: "string" }, sourceTask: { type: "string" }, provenance: { enum: ["source", "adapted", "derived"] } } },
    option: { type: "object", additionalProperties: false, required: ["text", "correct", "feedback"], properties: { text: { type: "string" }, correct: { type: "boolean" }, feedback: { type: "string" } } },
    crossExercise: { type: "object", additionalProperties: false, required: ["id", "type", "prompt", "selectionMode", "options", "explanation", "source"], properties: { id: { type: "string" }, type: { type: "string", const: "cross" }, prompt: { type: "string" }, selectionMode: { enum: ["single", "multiple", "true-false", "dropdown"] }, options: { type: "array", items: { $ref: "#/$defs/option" } }, explanation: { type: "string" }, source: { $ref: "#/$defs/sourceRef" } } },
    calculationExercise: { type: "object", additionalProperties: false, required: ["id", "type", "prompt", "givens", "acceptedAnswers", "unit", "steps", "commonMistake", "source"], properties: { id: { type: "string" }, type: { type: "string", const: "calculation" }, prompt: { type: "string" }, givens: { type: "array", items: { type: "string" } }, acceptedAnswers: { type: "array", items: { type: "string" } }, unit: { type: "string" }, steps: { type: "array", items: { type: "string" } }, commonMistake: { type: "string" }, source: { $ref: "#/$defs/sourceRef" } } },
    workedExample: { type: "object", additionalProperties: false, required: ["title", "prompt", "steps", "answer", "source"], properties: { title: { type: "string" }, prompt: { type: "string" }, steps: { type: "array", items: { type: "string" } }, answer: { type: "string" }, source: { $ref: "#/$defs/sourceRef" } } },
  },
} as const;

export const STUDY_GUIDE_QUALITY_TARGETS = Object.freeze({
  topics: 11,
  exercises: 40,
  crossExercises: 20,
  calculationExercises: 18,
});

export function validateStudyGuideContentQuality(content: StudyGuideContent, requirements: StudyGuideRequirements = fallbackStudyGuideRequirements(content)): string[] {
  const exercises = content.topics.flatMap((topic) => topic.exercises);
  const crosses = exercises.filter((exercise) => exercise.type === "cross");
  const calculations = exercises.filter((exercise) => exercise.type === "calculation");
  const issues: string[] = [];
  if (content.topics.length < requirements.topicTarget) issues.push(`Expected evidence-adaptive course coverage of at least ${requirements.topicTarget} topics; received ${content.topics.length}.`);
  if (exercises.length < requirements.exerciseTarget) issues.push(`Expected at least ${requirements.exerciseTarget} substantive exercises for the ${requirements.archetype} course profile; received ${exercises.length}.`);
  if (crosses.length < requirements.selectionTarget) issues.push(`Expected at least ${requirements.selectionTarget} selection/retrieval exercises; received ${crosses.length}.`);
  if (calculations.length < requirements.calculationTarget) issues.push(`Expected at least ${requirements.calculationTarget} calculation exercises for the ${requirements.archetype} course profile; received ${calculations.length}.`);
  const prompts = exercises.map((exercise) => exercise.prompt.trim().toLowerCase());
  const uniquePrompts = new Set(prompts);
  if (uniquePrompts.size !== prompts.length) issues.push("Exercise prompts must be unique; duplicated prompts were found.");
  const genericPrompt = /^(welche aussage trifft zu|wähle alle sinnvollen (?:schritte|prüfschritte)|berechne (?:den )?wert)\??$/i;
  if (prompts.some((prompt) => genericPrompt.test(prompt))) issues.push("Generic exercise-template prompts are not allowed.");
  const ids = exercises.map((exercise) => exercise.id);
  if (new Set(ids).size !== ids.length) issues.push("Exercise IDs must be globally unique.");
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
      : [exercise.prompt, ...exercise.givens, ...exercise.steps, exercise.commonMistake];
    if (fields.some((field) => forbiddenInfrastructure.test(field))) {
      issues.push(`${exercise.id} leaks infrastructure or embedded-asset data into learning content.`);
    }
    if (exercise.prompt.length > 1_500) issues.push(`${exercise.id} has an implausibly long prompt (${exercise.prompt.length} characters).`);
    if (fields.some((field) => field.length > 4_000)) issues.push(`${exercise.id} contains an implausibly long content field.`);
    if (/\bdu\b/i.test(exercise.prompt) && !/[∫]|integrier/i.test(exercise.prompt)) {
      issues.push(`${exercise.id} appears to have lost its integral operator during extraction.`);
    }
    if (fields.some((field) => /\b[xuntwy]\d{2,}\b|\)\s*[2-9]\b|π\d/i.test(field))) {
      issues.push(`${exercise.id} contains ambiguous OCR exponent notation that must be normalized or excluded.`);
    }
    if (exercise.source.provenance === "derived" && !/(?:folie|skript|kapitel|abschnitt|lernziel|quelle|thema|kursinhalt)/i.test(exercise.source.sourceTask)) {
      issues.push(`${exercise.id} is derived practice but does not identify the concrete source concept it was derived from.`);
    }
  }
  for (const topic of content.topics) {
    for (const formula of topic.theory.formulas) {
      const proseWords = formula.expression.match(/\b[A-Za-zÄÖÜäöüß]{3,}\b/g)?.filter((word) => !/^(?:lim|sin|cos|tan|exp|log)$/i.test(word)) ?? [];
      if (formula.expression.length > 240 || proseWords.length > 0 || !balancedMathDelimiters(formula.expression)) {
        issues.push(`${topic.id} contains a theory formula that violates the structured-math contract: ${formula.expression}`);
      }
    }
  }
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
