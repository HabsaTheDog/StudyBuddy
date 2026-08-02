import { readFile } from "node:fs/promises";
import { z } from "zod";

const HardGatesSchema = z.object({
  terminalArtifact: z.literal(true),
  emptyErrorLog: z.literal(true),
  qualityReviewPassed: z.literal(true),
  permissionViolations: z.number().int().nonnegative(),
  finalQuizSubmissions: z.number().int().nonnegative(),
  runtimeNetworkRequests: z.number().int().nonnegative(),
  blockingBrowserIssues: z.number().int().nonnegative(),
  questionsWithStableIdRatio: z.number().min(0).max(1),
  questionsWithObjectiveRatio: z.number().min(0).max(1),
  questionsWithResponseContractRatio: z.number().min(0).max(1),
  questionsWithOriginRatio: z.number().min(0).max(1),
  questionsWithScopeBasisRatio: z.number().min(0).max(1),
  questionsWithPassingReviewRatio: z.number().min(0).max(1),
  generatedQuestionsOutsideScope: z.number().int().nonnegative(),
  unsupportedOfficialAssessmentClaims: z.number().int().nonnegative(),
  requiredLearnerStateScenariosPassed: z.literal(true),
});

const CourseCaseSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  source: z.object({
    kind: z.string().min(1),
    selector: z.string().min(1),
  }),
  prompt: z.string().min(1),
  language: z.enum(["de", "en"]),
  requiredCapabilities: z.array(z.string().min(1)),
  forbiddenBehavior: z.array(z.string().min(1)),
}).passthrough();

export const VNextBenchmarkManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  status: z.string().min(1),
  description: z.string().default(""),
  runtimeConstraints: z.object({
    singleOfflineHtml: z.boolean(),
    networkRequestsAtRuntime: z.number().int().nonnegative(),
    backendRequired: z.boolean(),
    attemptHistoryRequired: z.boolean(),
    finalMoodleQuizSubmissionAllowed: z.boolean(),
  }).passthrough(),
  viewports: z.array(z.object({
    id: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })).min(1),
  hardGates: HardGatesSchema,
  learnerStateScenarios: z.array(z.string().min(1)).min(1),
  permissionScenarios: z.array(z.object({
    id: z.string().min(1),
    permissionSource: z.string().min(1),
    setup: z.string().min(1),
    expected: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
  }).passthrough()).min(1),
  courseCases: z.array(CourseCaseSchema).min(1),
  consistencyProtocol: z.record(z.string(), z.unknown()),
  efficiencyMetrics: z.array(z.string().min(1)).min(1),
  promotionPolicy: z.record(z.string(), z.unknown()),
}).passthrough();

export type VNextBenchmarkManifest = z.infer<typeof VNextBenchmarkManifestSchema>;
export type VNextHardGates = z.infer<typeof HardGatesSchema>;

export const DEFAULT_VNEXT_HARD_GATES: VNextHardGates = {
  terminalArtifact: true,
  emptyErrorLog: true,
  qualityReviewPassed: true,
  permissionViolations: 0,
  finalQuizSubmissions: 0,
  runtimeNetworkRequests: 0,
  blockingBrowserIssues: 0,
  questionsWithStableIdRatio: 1,
  questionsWithObjectiveRatio: 1,
  questionsWithResponseContractRatio: 1,
  questionsWithOriginRatio: 1,
  questionsWithScopeBasisRatio: 1,
  questionsWithPassingReviewRatio: 1,
  generatedQuestionsOutsideScope: 0,
  unsupportedOfficialAssessmentClaims: 0,
  requiredLearnerStateScenariosPassed: true,
};

export async function loadVNextBenchmarkManifest(filePath: string): Promise<VNextBenchmarkManifest> {
  return VNextBenchmarkManifestSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}
