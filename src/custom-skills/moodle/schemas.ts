import { z } from "zod";

export const SourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["moodle_page", "pdf", "file", "quiz_question", "assignment", "local_file"]),
  url: z.string().optional(),
  path: z.string().optional(),
  page: z.number().int().positive().optional(),
});

export const FormulaSchema = z.object({
  name: z.string().min(1),
  typst: z.string().min(1),
  variables: z.array(z.string()).default([]),
  units: z.array(z.string()).default([]),
  context: z.string().default(""),
  source_ids: z.array(z.string()).default([]),
});

export const SectionSchema = z.object({
  heading: z.string().min(1),
  summary: z.string().min(1),
  key_concepts: z.array(z.string()).default([]),
  source_ids: z.array(z.string()).default([]),
});

export const WorkedExampleSchema = z.object({
  prompt: z.string().min(1),
  steps: z.array(z.string()).default([]),
  result: z.string().default(""),
  source_ids: z.array(z.string()).default([]),
});

export const QuizStyleQuestionSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  source_ids: z.array(z.string()).default([]),
});

export const ExtractedDataSchema = z.object({
  document_title: z.string().min(1),
  language: z.enum(["de", "en"]).default("de"),
  course: z.object({
    title: z.string().default("n/a"),
    url: z.string().default(""),
  }),
  sources: z.array(SourceSchema).default([]),
  sections: z.array(SectionSchema).default([]),
  formulas: z.array(FormulaSchema).default([]),
  worked_examples: z.array(WorkedExampleSchema).default([]),
  quiz_style_questions: z.array(QuizStyleQuestionSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type ExtractedData = z.infer<typeof ExtractedDataSchema>;

export const extractedDataJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_title: { type: "string" },
    language: { type: "string", enum: ["de", "en"] },
    course: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        url: { type: "string" },
      },
      required: ["title", "url"],
    },
    sources: { type: "array", items: { type: "object" } },
    sections: { type: "array", items: { type: "object" } },
    formulas: { type: "array", items: { type: "object" } },
    worked_examples: { type: "array", items: { type: "object" } },
    quiz_style_questions: { type: "array", items: { type: "object" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "document_title",
    "language",
    "course",
    "sources",
    "sections",
    "formulas",
    "worked_examples",
    "quiz_style_questions",
    "warnings"
  ],
} as const;
