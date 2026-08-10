import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  hashRequestContract,
  type RequestContract,
} from "../shared/requestContract.js";
import type { CourseBlueprint } from "./adaptiveStudyModel.js";
import type { CodexClient } from "./codexClient.js";
import { balancedExcerpt } from "./modelText.js";
import { readExtractionHandoff } from "./studyGuideProfile.js";
import {
  normalizeStudyGuideEvidenceRefs,
  studyGuideEvidenceRefSchema,
  type StudyGuideEvidenceRef,
} from "./studyGuideContent.js";
import type { WebLayoutRuntimeConfig } from "./types.js";

const PLAN_FILE = "assessment-architecture-plan.json";
const CACHE_VERSION = "assessment-architecture-v1-open-contract";

const objectiveSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

export const assessmentCourseSummarySchema = z.object({
  courseId: z.string().min(1),
  courseTitle: z.string().min(1),
  language: z.enum(["de", "en"]),
  modules: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    objectives: z.array(objectiveSchema),
  })).min(1),
});

export type AssessmentCourseSummary = z.infer<typeof assessmentCourseSummarySchema>;

const generatedSectionSchema = z.object({
  title: z.string().min(1),
  evidenceLevel: z.enum(["explicit", "derived"]),
  deliveryMode: z.enum(["interactive", "self-assessed", "external-performance"]),
  taskCount: z.number().int().positive().nullable(),
  points: z.number().nonnegative().nullable(),
  weight: z.number().min(0).max(1).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  questionTypes: z.array(z.string().min(1)).min(1),
  learningObjectiveIds: z.array(z.string().min(1)),
  evidenceExcerpt: z.string().min(1).max(1_200),
});

const generatedPlanSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(["documented", "none", "inferred_practice"]),
  confidence: z.enum(["high", "medium", "low"]),
  durationMinutes: z.number().int().positive().nullable(),
  maxPoints: z.number().positive().nullable(),
  passingPoints: z.number().nonnegative().nullable(),
  allowedAids: z.array(z.string().min(1)),
  prohibitedAids: z.array(z.string().min(1)),
  basisRequirementIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  sections: z.array(generatedSectionSchema),
});

const sectionSchema = generatedSectionSchema.extend({
  id: z.string().regex(/^assessment-section-[a-f0-9]{20}$/),
  evidenceRefs: z.array(studyGuideEvidenceRefSchema).min(1).optional(),
});

export const assessmentArchitecturePlanSchema = z.object({
  schemaVersion: z.literal(1),
  binding: z.object({
    cacheVersion: z.literal(CACHE_VERSION),
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    originalPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
    courseHash: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    semanticCacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().min(1),
  mode: z.enum(["documented", "none", "inferred_practice"]),
  confidence: z.enum(["high", "medium", "low"]),
  durationMinutes: z.number().int().positive().nullable(),
  maxPoints: z.number().positive().nullable(),
  passingPoints: z.number().nonnegative().nullable(),
  allowedAids: z.array(z.string().min(1)),
  prohibitedAids: z.array(z.string().min(1)),
  basisRequirementIds: z.array(z.string().min(1)),
  rationale: z.string().min(1),
  sections: z.array(sectionSchema),
}).superRefine((plan, context) => {
  if (plan.mode === "none" && plan.sections.length > 0) {
    context.addIssue({ code: "custom", path: ["sections"], message: "mode=none requires zero assessment sections." });
  }
  if (plan.mode !== "none" && plan.sections.length === 0) {
    context.addIssue({ code: "custom", path: ["sections"], message: `${plan.mode} requires at least one section.` });
  }
  if (plan.mode === "inferred_practice" && plan.basisRequirementIds.length === 0) {
    context.addIssue({ code: "custom", path: ["basisRequirementIds"], message: "Inferred practice requires an assigned explicit contract requirement." });
  }
  const ids = new Set<string>();
  for (const [index, section] of plan.sections.entries()) {
    if (ids.has(section.id)) {
      context.addIssue({ code: "custom", path: ["sections", index, "id"], message: "Section IDs must be unique." });
    }
    ids.add(section.id);
    if (plan.mode === "documented" && section.evidenceLevel !== "explicit") {
      context.addIssue({ code: "custom", path: ["sections", index, "evidenceLevel"], message: "Documented sections require explicit assessment evidence." });
    }
    if (plan.mode === "inferred_practice" && section.evidenceLevel !== "derived") {
      context.addIssue({ code: "custom", path: ["sections", index, "evidenceLevel"], message: "Inferred practice sections must be labelled derived." });
    }
    if (
      plan.mode === "inferred_practice" &&
      [section.taskCount, section.points, section.weight, section.durationMinutes].some((value) => value !== null)
    ) {
      context.addIssue({ code: "custom", path: ["sections", index], message: "Inferred practice may not invent documented task counts, points, weights, or durations." });
    }
  }
  if (plan.mode !== "documented" && [plan.durationMinutes, plan.maxPoints, plan.passingPoints].some((value) => value !== null)) {
    context.addIssue({ code: "custom", path: ["mode"], message: "Only documented assessment evidence may set global duration or points." });
  }
  if (plan.mode !== "documented" && (plan.allowedAids.length > 0 || plan.prohibitedAids.length > 0)) {
    context.addIssue({ code: "custom", path: ["mode"], message: "Only documented assessment evidence may set aid rules." });
  }
  if (plan.maxPoints !== null && plan.passingPoints !== null && plan.passingPoints > plan.maxPoints) {
    context.addIssue({ code: "custom", path: ["passingPoints"], message: "Passing points cannot exceed maximum points." });
  }
});

export type AssessmentArchitecturePlan = z.infer<typeof assessmentArchitecturePlanSchema>;

export function assertAssessmentArchitecturePlanIntegrity(
  value: unknown,
): AssessmentArchitecturePlan {
  const plan = assessmentArchitecturePlanSchema.parse(value);
  const { schemaVersion: _schemaVersion, binding: _binding, contentHash: _contentHash, ...content } = plan;
  if (sha256(canonicalJson(content)) !== plan.contentHash) {
    throw new Error("Assessment architecture content hash mismatch.");
  }
  return plan;
}

export interface AssessmentArchitectureContractContext {
  contractHash: string;
  originalPrompt: string;
  originalPromptHash: string;
  userGoal: string;
  deliverables: RequestContract["deliverables"];
  requirements: RequestContract["requirements"];
  reviewChecks: string[];
  notRequired: string[];
  forbidden: string[];
  contentStrategy: RequestContract["contentStrategy"];
}

export interface AssessmentArchitectureInput {
  codex: CodexClient;
  config: Pick<WebLayoutRuntimeConfig, "runDir" | "language" | "originalUserPrompt" | "diagnostics">;
  requestContract: RequestContract;
  requestContractHash: string;
  sourceText: string;
  course: CourseBlueprint | AssessmentCourseSummary;
  priorError?: string | null;
}

const generatedPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title", "mode", "confidence", "durationMinutes", "maxPoints", "passingPoints",
    "allowedAids", "prohibitedAids", "basisRequirementIds", "rationale", "sections",
  ],
  properties: {
    title: { type: "string" },
    mode: { type: "string", enum: ["documented", "none", "inferred_practice"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    durationMinutes: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    maxPoints: { anyOf: [{ type: "number", exclusiveMinimum: 0 }, { type: "null" }] },
    passingPoints: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
    allowedAids: { type: "array", items: { type: "string" } },
    prohibitedAids: { type: "array", items: { type: "string" } },
    basisRequirementIds: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title", "evidenceLevel", "deliveryMode", "taskCount", "points", "weight",
          "durationMinutes", "questionTypes", "learningObjectiveIds", "evidenceExcerpt",
        ],
        properties: {
          title: { type: "string" },
          evidenceLevel: { type: "string", enum: ["explicit", "derived"] },
          deliveryMode: { type: "string", enum: ["interactive", "self-assessed", "external-performance"] },
          taskCount: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          points: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
          weight: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
          durationMinutes: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          questionTypes: { type: "array", minItems: 1, items: { type: "string" } },
          learningObjectiveIds: { type: "array", items: { type: "string" } },
          evidenceExcerpt: { type: "string" },
        },
      },
    },
  },
} as const;

export function assessmentArchitectureContractContext(
  originalUserPrompt: string,
  contract: RequestContract,
  expectedContractHash: string,
): AssessmentArchitectureContractContext {
  const contractHash = hashRequestContract(contract);
  if (contractHash !== expectedContractHash) {
    throw new Error(`Assessment architecture contract hash mismatch: expected ${expectedContractHash}, computed ${contractHash}.`);
  }
  if (contract.originalPrompt !== originalUserPrompt) {
    throw new Error("Assessment architecture contract does not match the exact original user prompt.");
  }
  const assignments = contract.reviewAssignments.filter((assignment) =>
    assignment.owner === "content" || assignment.owner === "interaction"
  );
  const requirementIds = new Set(assignments.flatMap((assignment) => assignment.requirementIds));
  const requirements = contract.requirements.filter((requirement) => requirementIds.has(requirement.id));
  const deliverableIds = new Set(requirements.flatMap((requirement) => requirement.appliesTo));
  return {
    contractHash,
    originalPrompt: originalUserPrompt,
    originalPromptHash: sha256(originalUserPrompt),
    userGoal: contract.userGoal,
    deliverables: contract.deliverables.filter((deliverable) => deliverableIds.has(deliverable.id)),
    requirements,
    reviewChecks: [...new Set(assignments.flatMap((assignment) => assignment.checks))],
    notRequired: contract.notRequired,
    forbidden: contract.forbidden,
    contentStrategy: contract.contentStrategy,
  };
}

export function assessmentArchitectureCacheKey(input: {
  contractHash: string;
  originalPromptHash: string;
  courseHash: string;
  evidenceHash: string;
}): string {
  return sha256(canonicalJson({ cacheVersion: CACHE_VERSION, ...input }));
}

export async function resolveAssessmentArchitecturePlan(
  input: AssessmentArchitectureInput,
): Promise<AssessmentArchitecturePlan> {
  const contract = assessmentArchitectureContractContext(
    input.config.originalUserPrompt,
    input.requestContract,
    input.requestContractHash,
  );
  const course = normalizeCourse(input.course);
  const courseHash = sha256(canonicalJson(course));
  const evidenceHash = sha256(input.sourceText);
  const semanticCacheKey = assessmentArchitectureCacheKey({
    contractHash: contract.contractHash,
    originalPromptHash: contract.originalPromptHash,
    courseHash,
    evidenceHash,
  });
  const expectedBinding: AssessmentArchitecturePlan["binding"] = {
    cacheVersion: CACHE_VERSION,
    contractHash: contract.contractHash,
    originalPromptHash: contract.originalPromptHash,
    courseHash,
    evidenceHash,
    semanticCacheKey,
  };
  const localPath = path.join(input.config.runDir, PLAN_FILE);
  const local = await readBoundPlan(localPath);
  if (local) {
    const localStatus = localPlanStatus(local, expectedBinding);
    if (localStatus === "reuse") {
      assertCompatiblePlan(local, expectedBinding, input.sourceText, course, contract);
      return local;
    }
    await input.config.diagnostics?.log(
      "info",
      "planner",
      "Invalidated the local assessment architecture because repaired course/evidence semantics changed; resolving the matching bounded plan.",
    );
  }
  const sharedPath = process.env.VITEST === "true"
    ? path.join(input.config.runDir, ".assessment-architecture-cache", `${semanticCacheKey}.json`)
    : path.join(process.cwd(), "study-buddy-data", "cache", "web-layout", "assessment-architecture", `${semanticCacheKey}.json`);
  const cached = await readBoundPlan(sharedPath);
  if (cached) {
    assertCompatiblePlan(cached, expectedBinding, input.sourceText, course, contract);
    await persistPlan(localPath, cached);
    return cached;
  }

  let repairError = assessmentArchitectureRepairContext(input.priorError);
  let finalError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await input.codex.run(
        buildAssessmentArchitecturePrompt(input, contract, course, repairError),
        {
          task: "artifact_planner",
          attempt,
          outputSchema: generatedPlanJsonSchema,
          timeoutMs: 150_000,
        },
      );
      const generated = generatedPlanSchema.parse(JSON.parse(stripJsonFence(response)));
      const plan = bindGeneratedPlan(generated, expectedBinding, input.sourceText, course);
      assertCompatiblePlan(plan, expectedBinding, input.sourceText, course, contract);
      await Promise.all([persistPlan(localPath, plan), persistPlan(sharedPath, plan)]);
      await input.config.diagnostics?.log(
        "info",
        "planner",
        `Persisted contract-bound assessment architecture (${plan.mode}, ${plan.sections.length} section(s)) after ${attempt} local attempt(s).`,
      );
      return plan;
    } catch (error) {
      finalError = error;
      repairError = architectureErrorMessage(error);
      await input.config.diagnostics?.log(
        "warn",
        "planner",
        `Assessment architecture attempt ${attempt}/3 invalid: ${repairError}`,
      );
    }
  }
  throw new Error(
    `Assessment architecture planning failed after 3 local attempts: ${architectureErrorMessage(finalError)}`,
  );
}

function buildAssessmentArchitecturePrompt(
  input: AssessmentArchitectureInput,
  contract: AssessmentArchitectureContractContext,
  course: AssessmentCourseSummary,
  repairError: string | null,
): string {
  return [
    "ASSESSMENT_ARCHITECTURE_PLANNER",
    "Return JSON only. Evaluate an assessment architecture from the exact request, assigned contract requirements, course objectives, and supplied evidence. Do not use tools or external knowledge.",
    "Do not infer assessment structure from a discipline, course name, familiar exam convention, keyword recipe, or fixed task/type/count template. Preserve the task forms actually documented by the evidence.",
    "Use mode=documented only when the evidence explicitly documents an assessment. Every documented section must quote one exact compact evidenceExcerpt and use evidenceLevel=explicit.",
    "If no real assessment structure is documented, mode=none with zero sections is valid and preferred. Leave unknown duration, points, passing points, weights, task counts, section durations, and aids null or empty; never estimate them.",
    "Use mode=inferred_practice only when an assigned explicit content/interaction requirement actually requests interactive assessment preparation. List its exact requirement ID in basisRequirementIds. Label every section evidenceLevel=derived, leave all documented quantities null, quote the exact course-objective text used as evidenceExcerpt, and explain in rationale that this is Study Buddy practice rather than an official assessment.",
    "Choose questionTypes from the learning action expressed by the evidence or objective; questionTypes are open strings and must not be translated through a predetermined taxonomy. deliveryMode is only the universal execution capability: interactive for an honestly machine-operable interaction, self-assessed when the learner must compare against criteria or a reference response, and external-performance when the offline page cannot perform or grade the documented act honestly.",
    "Map only known learningObjectiveIds from the supplied structural course summary. Do not create objectives. Use a concise factual title and rationale.",
    repairError ? `Prior localized architecture finding to repair:\n${repairError}` : "",
    `Language: ${input.config.language}`,
    `Assigned contract context (exact original prompt, verified hashes, and content/interaction-owned requirements only):\n${JSON.stringify(contract)}`,
    `Structural course/objective summary:\n${JSON.stringify(course)}`,
    `Authorized assessment/course evidence:\n${balancedExcerpt(input.sourceText, 36_000)}`,
  ].filter(Boolean).join("\n\n");
}

function assessmentArchitectureRepairContext(value: string | null | undefined): string | null {
  if (!value || !/assessment architecture/i.test(value)) return null;
  return balancedExcerpt(value, 4_000);
}

function architectureErrorMessage(error: unknown): string {
  return balancedExcerpt(error instanceof Error ? error.message : String(error), 4_000);
}

function bindGeneratedPlan(
  generated: z.infer<typeof generatedPlanSchema>,
  binding: AssessmentArchitecturePlan["binding"],
  sourceText: string,
  course: AssessmentCourseSummary,
): AssessmentArchitecturePlan {
  const sections = generated.sections.map((section) => ({
    ...section,
    id: stableSectionId(generated.mode, section),
    ...(section.evidenceLevel === "explicit"
      ? resolvedAssessmentEvidenceRefs(sourceText, course, section)
      : {}),
  }));
  const content = { ...generated, sections };
  return assessmentArchitecturePlanSchema.parse({
    schemaVersion: 1,
    binding,
    contentHash: sha256(canonicalJson(content)),
    ...content,
  });
}

function resolvedAssessmentEvidenceRefs(
  sourceText: string,
  course: AssessmentCourseSummary,
  section: z.infer<typeof generatedSectionSchema>,
): { evidenceRefs: StudyGuideEvidenceRef[] } | Record<string, never> {
  const handoff = readExtractionHandoff(sourceText);
  const objectiveIds = new Set(section.learningObjectiveIds);
  const learningGoalIndexes = [...new Set(course.modules.flatMap((module) =>
    module.objectives.flatMap((objective, index) => objectiveIds.has(objective.id) ? [index] : [])
  ))].sort((left, right) => left - right);
  if (!handoff || learningGoalIndexes.length === 0) return {};
  const excerpt = normalizeWhitespace(section.evidenceExcerpt);
  const refs = (handoff.sections ?? []).flatMap((candidate, sectionIndex) => {
    const heading = typeof candidate.heading === "string" ? candidate.heading.trim() : "";
    const summary = typeof candidate.summary === "string" ? candidate.summary : "";
    const sourceIds = Array.isArray(candidate.source_ids)
      ? [...new Set(candidate.source_ids.map(String).filter(Boolean))].sort()
      : [];
    if (!heading || !summary || sourceIds.length === 0 || !normalizeWhitespace(summary).includes(excerpt)) {
      return [];
    }
    const exactStart = summary.indexOf(section.evidenceExcerpt);
    return [{
      sourceIds,
      sectionIndex,
      sectionHeading: heading,
      learningGoalIndexes,
      ...(exactStart >= 0
        ? {
            exactSpan: {
              start: exactStart,
              end: exactStart + section.evidenceExcerpt.length,
              sha256: sha256(section.evidenceExcerpt),
            },
          }
        : {}),
    }];
  });
  return refs.length > 0
    ? { evidenceRefs: normalizeStudyGuideEvidenceRefs(refs) }
    : {};
}

function assertCompatiblePlan(
  plan: AssessmentArchitecturePlan,
  expectedBinding: AssessmentArchitecturePlan["binding"],
  sourceText: string,
  course: AssessmentCourseSummary,
  contract: AssessmentArchitectureContractContext,
): void {
  assertAssessmentArchitecturePlanIntegrity(plan);
  assertBindingSelfConsistent(plan.binding);
  if (canonicalJson(plan.binding) !== canonicalJson(expectedBinding)) {
    throw new Error("Assessment architecture cache binding is stale or belongs to another request/evidence set.");
  }
  const objectiveById = new Map(course.modules.flatMap((module) =>
    module.objectives.map((objective) => [objective.id, objective] as const)
  ));
  const allowedRequirementIds = new Set(contract.requirements
    .filter((requirement) => requirement.origin === "explicit")
    .map((requirement) => requirement.id));
  if (plan.basisRequirementIds.some((id) => !allowedRequirementIds.has(id))) {
    throw new Error("Assessment architecture cites an unassigned or non-explicit contract requirement.");
  }
  const normalizedEvidence = normalizeWhitespace(sourceText);
  for (const section of plan.sections) {
    const objectives = section.learningObjectiveIds.map((id) => objectiveById.get(id));
    if (objectives.some((objective) => !objective)) {
      throw new Error(`Assessment section ${section.id} cites an unknown learning objective.`);
    }
    if (section.evidenceLevel === "explicit") {
      if (!normalizedEvidence.includes(normalizeWhitespace(section.evidenceExcerpt))) {
        throw new Error(`Assessment section ${section.id} evidence excerpt is not present in the supplied evidence.`);
      }
      if (section.evidenceRefs) {
        const resolved = resolvedAssessmentEvidenceRefs(sourceText, course, section);
        if (!("evidenceRefs" in resolved) || canonicalJson(section.evidenceRefs) !== canonicalJson(resolved.evidenceRefs)) {
          throw new Error(`Assessment section ${section.id} has stale or non-resolving evidence references.`);
        }
      }
    } else {
      const excerpt = normalizeWhitespace(section.evidenceExcerpt);
      if (!objectives.some((objective) => excerpt.includes(normalizeWhitespace(objective!.title)))) {
        throw new Error(`Derived assessment section ${section.id} does not quote one of its course objectives.`);
      }
    }
  }
}

function localPlanStatus(
  plan: AssessmentArchitecturePlan,
  expected: AssessmentArchitecturePlan["binding"],
): "reuse" | "recompute" {
  assertAssessmentArchitecturePlanIntegrity(plan);
  assertBindingSelfConsistent(plan.binding);
  if (
    plan.binding.contractHash !== expected.contractHash ||
    plan.binding.originalPromptHash !== expected.originalPromptHash
  ) {
    throw new Error("Assessment architecture cache binding is stale or belongs to another request.");
  }
  if (
    plan.binding.courseHash !== expected.courseHash ||
    plan.binding.evidenceHash !== expected.evidenceHash
  ) {
    return "recompute";
  }
  if (plan.binding.semanticCacheKey !== expected.semanticCacheKey) {
    throw new Error("Assessment architecture cache binding has an invalid semantic cache key.");
  }
  return "reuse";
}

function assertBindingSelfConsistent(binding: AssessmentArchitecturePlan["binding"]): void {
  const expected = assessmentArchitectureCacheKey({
    contractHash: binding.contractHash,
    originalPromptHash: binding.originalPromptHash,
    courseHash: binding.courseHash,
    evidenceHash: binding.evidenceHash,
  });
  if (binding.semanticCacheKey !== expected) {
    throw new Error("Assessment architecture cache binding has an invalid semantic cache key.");
  }
}

function normalizeCourse(course: CourseBlueprint | AssessmentCourseSummary): AssessmentCourseSummary {
  if ("courseTitle" in course && course.modules.every((module) => "objectives" in module)) {
    return assessmentCourseSummarySchema.parse(course);
  }
  const blueprint = course as CourseBlueprint;
  return assessmentCourseSummarySchema.parse({
    courseId: blueprint.courseId,
    courseTitle: blueprint.courseTitle,
    language: blueprint.language,
    modules: blueprint.modules.map((module) => ({
      id: module.id,
      title: module.title,
      objectives: module.learningObjectives.map((objective) => ({ id: objective.id, title: objective.title })),
    })),
  });
}

function stableSectionId(
  mode: z.infer<typeof generatedPlanSchema>["mode"],
  section: z.infer<typeof generatedSectionSchema>,
): string {
  return `assessment-section-${sha256(canonicalJson({
    mode,
    title: normalizeWhitespace(section.title).toLocaleLowerCase(),
    evidenceLevel: section.evidenceLevel,
    evidenceExcerpt: normalizeWhitespace(section.evidenceExcerpt),
    objectiveIds: [...section.learningObjectiveIds].sort(),
  })).slice(0, 20)}`;
}

async function readBoundPlan(filePath: string): Promise<AssessmentArchitecturePlan | null> {
  try {
    return assessmentArchitecturePlanSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Invalid persisted assessment architecture at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function persistPlan(filePath: string, plan: AssessmentArchitecturePlan): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
