import { readFile } from "node:fs/promises";
import { z } from "zod";

const ExpectedSchema = z.object({
  requiredLanguage: z.enum(["de", "en"]).optional(),
  minTopics: z.number().int().nonnegative().default(1),
  minExercises: z.number().int().nonnegative().default(3),
  minApplications: z.number().int().nonnegative().default(0),
  minWorkedExamples: z.number().int().nonnegative().default(1),
  minSources: z.number().int().nonnegative().default(1),
  maxFormulas: z.number().int().nonnegative().optional(),
  requiredTerms: z.array(z.string().min(1)).default([]),
  forbiddenTerms: z.array(z.string().min(1)).default([]),
  maxWallMs: z.number().int().positive().optional(),
  maxFreshInputTokens: z.number().int().nonnegative().optional(),
  maxModelCalls: z.number().int().nonnegative().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  maxLeafToolPolicyViolations: z.number().int().nonnegative().default(0),
  minCacheHitRate: z.number().min(0).max(1).optional(),
  maxArtifactBytes: z.number().int().positive().optional(),
}).default({
  minTopics: 1,
  minExercises: 3,
  minApplications: 0,
  minWorkedExamples: 1,
  minSources: 1,
  requiredTerms: [],
  forbiddenTerms: [],
  maxLeafToolPolicyViolations: 0,
});

const InteractiveEvalCaseSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  enabled: z.boolean().default(false),
  prompt: z.string().min(1),
  language: z.enum(["de", "en"]).default("de"),
  moodleUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  expected: ExpectedSchema,
});

export const InteractiveEvalCorpusSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(""),
  cases: z.array(InteractiveEvalCaseSchema).min(1),
});

export type InteractiveEvalCase = z.infer<typeof InteractiveEvalCaseSchema>;
export type InteractiveEvalCorpus = z.infer<typeof InteractiveEvalCorpusSchema>;

export async function loadInteractiveEvalCorpus(filePath: string): Promise<InteractiveEvalCorpus> {
  return InteractiveEvalCorpusSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}
