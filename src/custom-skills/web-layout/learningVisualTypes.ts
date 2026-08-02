import { z } from "zod";

export const learningVisualSchema = z.object({
  dataUri: z.string().regex(/^data:image\/png;base64,/),
  alt: z.string().min(1),
  sourceLabel: z.string().min(1),
  sourceTask: z.string().min(1),
  kind: z.literal("diagram_crop"),
  origin: z.enum(["course_original", "course_adapted"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const learningVisualSetSchema = z.object({
  schemaVersion: z.literal(1),
  modules: z.record(z.string(), learningVisualSchema),
  questions: z.record(z.string(), learningVisualSchema),
});

export type LearningVisual = z.infer<typeof learningVisualSchema>;
export type LearningVisualSet = z.infer<typeof learningVisualSetSchema>;
