import { z } from "zod";

export const SourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["moodle_page", "cis_page", "pdf", "file", "quiz_question", "assignment", "local_file"]),
  url: z.string().nullable().default(null),
  path: z.string().nullable().default(null),
  page: z.number().int().positive().nullable().default(null),
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

export const VisualAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "moodle_pdf_image",
    "moodle_pdf_page",
    "moodle_page_screenshot",
    "cis_page_screenshot",
    "typst_diagram",
    "placeholder_prompt",
  ]),
  title: z.string().min(1),
  relative_path: z.string().nullable().default(null),
  mime_type: z.enum(["image/png", "image/jpeg", "image/svg+xml"]).nullable().default(null),
  width_px: z.number().int().positive().nullable().default(null),
  height_px: z.number().int().positive().nullable().default(null),
  source_id: z.string().nullable().default(null),
  source_url: z.string().nullable().default(null),
  source_path: z.string().nullable().default(null),
  source_page: z.number().int().positive().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  caption_hint: z.string().default(""),
  relevance_reason: z.string().default(""),
  generation_prompt: z.string().nullable().default(null),
});

export const FigureSchema = z.object({
  asset_id: z.string().min(1),
  caption: z.string().min(1),
  placement_hint: z.string().default(""),
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
  visual_assets: z.array(VisualAssetSchema).default([]),
  figures: z.array(FigureSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type ExtractedData = z.infer<typeof ExtractedDataSchema>;

export const extractedDataJsonSchema = {
  type: "object",
  additionalProperties: false,
  $defs: {
    source: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        kind: {
          type: "string",
          enum: ["moodle_page", "cis_page", "pdf", "file", "quiz_question", "assignment", "local_file"],
        },
        url: { type: ["string", "null"] },
        path: { type: ["string", "null"] },
        page: { type: ["number", "null"] },
      },
      required: ["id", "title", "kind", "url", "path", "page"],
    },
    section: {
      type: "object",
      additionalProperties: false,
      properties: {
        heading: { type: "string" },
        summary: { type: "string" },
        key_concepts: { type: "array", items: { type: "string" } },
        source_ids: { type: "array", items: { type: "string" } },
      },
      required: ["heading", "summary", "key_concepts", "source_ids"],
    },
    formula: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        typst: { type: "string" },
        variables: { type: "array", items: { type: "string" } },
        units: { type: "array", items: { type: "string" } },
        context: { type: "string" },
        source_ids: { type: "array", items: { type: "string" } },
      },
      required: ["name", "typst", "variables", "units", "context", "source_ids"],
    },
    worked_example: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        result: { type: "string" },
        source_ids: { type: "array", items: { type: "string" } },
      },
      required: ["prompt", "steps", "result", "source_ids"],
    },
    quiz_style_question: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        answer: { type: "string" },
        source_ids: { type: "array", items: { type: "string" } },
      },
      required: ["question", "answer", "source_ids"],
    },
    visual_asset: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        kind: {
          type: "string",
          enum: [
            "moodle_pdf_image",
            "moodle_pdf_page",
            "moodle_page_screenshot",
            "cis_page_screenshot",
            "typst_diagram",
            "placeholder_prompt",
          ],
        },
        title: { type: "string" },
        relative_path: { type: ["string", "null"] },
        mime_type: { type: ["string", "null"], enum: ["image/png", "image/jpeg", "image/svg+xml", null] },
        width_px: { type: ["number", "null"] },
        height_px: { type: ["number", "null"] },
        source_id: { type: ["string", "null"] },
        source_url: { type: ["string", "null"] },
        source_path: { type: ["string", "null"] },
        source_page: { type: ["number", "null"] },
        confidence: { type: "number" },
        caption_hint: { type: "string" },
        relevance_reason: { type: "string" },
        generation_prompt: { type: ["string", "null"] },
      },
      required: [
        "id",
        "kind",
        "title",
        "relative_path",
        "mime_type",
        "width_px",
        "height_px",
        "source_id",
        "source_url",
        "source_path",
        "source_page",
        "confidence",
        "caption_hint",
        "relevance_reason",
        "generation_prompt",
      ],
    },
    figure: {
      type: "object",
      additionalProperties: false,
      properties: {
        asset_id: { type: "string" },
        caption: { type: "string" },
        placement_hint: { type: "string" },
        source_ids: { type: "array", items: { type: "string" } },
      },
      required: ["asset_id", "caption", "placement_hint", "source_ids"],
    },
  },
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
    sources: { type: "array", items: { "$ref": "#/$defs/source" } },
    sections: { type: "array", items: { "$ref": "#/$defs/section" } },
    formulas: { type: "array", items: { "$ref": "#/$defs/formula" } },
    worked_examples: { type: "array", items: { "$ref": "#/$defs/worked_example" } },
    quiz_style_questions: { type: "array", items: { "$ref": "#/$defs/quiz_style_question" } },
    visual_assets: { type: "array", items: { "$ref": "#/$defs/visual_asset" } },
    figures: { type: "array", items: { "$ref": "#/$defs/figure" } },
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
    "visual_assets",
    "figures",
    "warnings"
  ],
} as const;
