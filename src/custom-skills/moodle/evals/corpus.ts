import { readFile } from "node:fs/promises";
import { z } from "zod";

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  enabled: z.boolean().default(true),
  prompt: z.string().min(1),
  moodleUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  expected: z.object({
    requirePdf: z.boolean().default(true),
    requireCompleteCoverage: z.boolean().default(false),
    maxWallMs: z.number().int().positive().optional(),
    requiredTerms: z.array(z.string()).default([]),
  }).default({
    requirePdf: true,
    requireCompleteCoverage: false,
    requiredTerms: [],
  }),
});

export const EvalCorpusSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(""),
  cases: z.array(EvalCaseSchema),
});

export type StudyBuddyEvalCase = z.infer<typeof EvalCaseSchema>;
export type StudyBuddyEvalCorpus = z.infer<typeof EvalCorpusSchema>;

export async function loadEvalCorpus(filePath: string): Promise<StudyBuddyEvalCorpus> {
  return EvalCorpusSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}
