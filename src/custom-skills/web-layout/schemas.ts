import { z } from "zod";

export const webLayoutKindSchema = z.enum([
  "auto",
  "flashcards",
  "concept-visualization",
  "simulation",
  "exam-practice",
  "quiz",
  "worksheet",
  "reference",
]);

export const layoutSpecSchema = z.object({
  title: z.string().min(1),
  language: z.enum(["de", "en"]),
  kind: webLayoutKindSchema,
  audience: z.string().min(1),
  learningGoals: z.array(z.string().min(1)).min(1),
  sections: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      purpose: z.string().min(1),
      interactionType: z.string().min(1),
    }),
  ).min(1),
  requiredInteractions: z.array(z.string().min(1)).min(1),
  dataModel: z.record(z.string(), z.unknown()),
  designDirection: z.string().min(1),
  accessibilityNotes: z.array(z.string().min(1)),
});

export const layoutSpecJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "language",
    "kind",
    "audience",
    "learningGoals",
    "sections",
    "requiredInteractions",
    "dataModel",
    "designDirection",
    "accessibilityNotes",
  ],
  properties: {
    title: { type: "string" },
    language: { enum: ["de", "en"] },
    kind: { enum: webLayoutKindSchema.options },
    audience: { type: "string" },
    learningGoals: { type: "array", items: { type: "string" } },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "purpose", "interactionType"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          purpose: { type: "string" },
          interactionType: { type: "string" },
        },
      },
    },
    requiredInteractions: { type: "array", items: { type: "string" } },
    dataModel: { type: "object" },
    designDirection: { type: "string" },
    accessibilityNotes: { type: "array", items: { type: "string" } },
  },
} as const;
