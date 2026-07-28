import { readFile } from "node:fs/promises";
import { z } from "zod";

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  enabled: z.boolean().default(true),
  prompt: z.string().min(1),
  language: z.enum(["de", "en"]).default("de"),
  moodleUrl: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  expected: z.object({
    requirePdf: z.boolean().default(true),
    requireCompleteCoverage: z.boolean().default(false),
    requireQualityReview: z.boolean().default(true),
    maxWallMs: z.number().int().positive().optional(),
    maxFreshInputTokens: z.number().int().nonnegative().optional(),
    maxModelCalls: z.number().int().nonnegative().optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    maxToolCalls: z.number().int().nonnegative().optional(),
    maxLeafToolPolicyViolations: z.number().int().nonnegative().optional(),
    maxInputAmplification: z.number().positive().optional(),
    maxSelectedResources: z.number().int().nonnegative().optional(),
    maxResourceAttempts: z.number().int().nonnegative().optional(),
    minTopics: z.number().int().nonnegative().optional(),
    minFormulas: z.number().int().nonnegative().optional(),
    maxFormulas: z.number().int().nonnegative().optional(),
    minWorkedExamples: z.number().int().nonnegative().optional(),
    maxWorkedExamples: z.number().int().nonnegative().optional(),
    minSources: z.number().int().nonnegative().optional(),
    minCourseChapters: z.number().int().nonnegative().optional(),
    maxCourseChapters: z.number().int().positive().optional(),
    minCoveredChapters: z.number().int().nonnegative().optional(),
    minOfficialTopicMappings: z.number().int().nonnegative().optional(),
    requiredOfficialTopicNumbers: z.array(z.number().int().positive()).default([]),
    requiredPracticeTopicNumbers: z.array(z.number().int().positive()).default([]),
    minChapterRoadmaps: z.number().int().nonnegative().optional(),
    minChaptersWithMultipleTopics: z.number().int().nonnegative().optional(),
    minChaptersWithWorkedExamples: z.number().int().nonnegative().optional(),
    requiredCourseLabel: z.string().min(1).optional(),
    requiredLanguage: z.enum(["de", "en"]).optional(),
    requiredContentModes: z.array(z.enum([
      "quantitative",
      "conceptual",
      "procedural",
      "case_based",
      "mixed",
    ])).default([]),
    requiredTerms: z.array(z.string()).default([]),
    forbiddenTerms: z.array(z.string()).default([]),
  }).default({
    requirePdf: true,
    requireCompleteCoverage: false,
    requireQualityReview: true,
    requiredOfficialTopicNumbers: [],
    requiredPracticeTopicNumbers: [],
    requiredContentModes: [],
    requiredTerms: [],
    forbiddenTerms: [],
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
