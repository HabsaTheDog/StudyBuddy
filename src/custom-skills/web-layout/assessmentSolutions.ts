import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { CodexClient } from "./codexClient.js";
import type { AdaptiveStudyModel } from "./adaptiveStudyModel.js";
import type { StudyGuideContent } from "./studyGuideContent.js";
import type { WebLayoutRuntimeConfig } from "./types.js";
import { balancedExcerpt } from "./modelText.js";
import {
  hashRequestContract,
  type RequestContract,
} from "../shared/requestContract.js";

const execFileAsync = promisify(execFile);

const generatedSolutionSchema = z.object({
  legacyExerciseId: z.string().min(1),
  completeness: z.enum(["complete", "insufficient"]),
  summary: z.string().min(1),
  steps: z.array(z.string().min(1)).min(2).max(36),
  finalAnswer: z.string().min(1),
  assumptions: z.array(z.string().min(1)).max(20),
  evidenceBasis: z.array(z.string().min(1)).min(1).max(20),
  missingEvidence: z.array(z.string().min(1)).max(12),
});

const taskImageSchema = z.object({
  dataUri: z.string().regex(/^data:image\/png;base64,/),
  alt: z.string().min(1),
  sourceLabel: z.string().min(1),
  kind: z.literal("diagram_crop").optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const reviewedSolutionSchema = generatedSolutionSchema.extend({
  solutionOrigin: z.enum(["course_verified", "study_buddy_generated"]),
  visualSelection: z.enum(["diagram_crop", "none"]).optional(),
  taskImage: taskImageSchema.optional(),
  review: z.object({
    status: z.literal("approved"),
    findings: z.array(z.string()),
  }),
  contractBinding: z.object({
    contractHash: z.string().regex(/^[a-f0-9]{64}$/),
    originalPromptHash: z.string().regex(/^[a-f0-9]{64}$/),
    itemSemanticHash: z.string().regex(/^[a-f0-9]{64}$/),
    planSemanticHash: z.string().regex(/^[a-f0-9]{64}$/),
    assessmentSectionId: z.string().min(1),
    assessmentQuestionTypes: z.array(z.string().min(1)).min(1),
    deliveryMode: z.enum(["interactive", "self-assessed", "external-performance"]),
    exerciseType: z.enum(["cross", "calculation", "application", "vocabulary"]),
    responseMode: z.enum(["quantitative-calculation", "constructed-response"]),
  }).optional(),
});

export const assessmentSolutionSetSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(reviewedSolutionSchema),
});

export type AssessmentSolutionSet = z.infer<typeof assessmentSolutionSetSchema>;
export type AssessmentReferenceSolution = AssessmentSolutionSet["items"][number];

export interface AssessmentContractContext {
  contractHash: string;
  originalPrompt: string;
  originalPromptHash: string;
  evaluationStatus: RequestContract["evaluationStatus"];
  userGoal: string;
  deliverables: RequestContract["deliverables"];
  requirements: RequestContract["requirements"];
  reviewChecks: string[];
  notRequired: string[];
  forbidden: string[];
  contentStrategy: RequestContract["contentStrategy"];
}

export interface AssessmentSolutionTaskContract {
  schemaVersion: 1;
  contractHash: string;
  originalPromptHash: string;
  itemSemanticHash: string;
  planSemanticHash: string;
  assessmentSectionId: string;
  assessmentQuestionTypes: string[];
  deliveryMode: "interactive" | "self-assessed" | "external-performance";
  exerciseType: AdaptiveStudyModel["questionBank"]["items"][number]["type"];
  responseMode: "quantitative-calculation" | "constructed-response";
  learningObjectiveIds: string[];
}

export function assessmentSolutionSemanticCacheKey(
  context: Pick<AssessmentContractContext, "contractHash" | "originalPromptHash">,
  payload: unknown,
): string {
  return createHash("sha256").update(JSON.stringify({
    contractHash: context.contractHash,
    originalPromptHash: context.originalPromptHash,
    payload,
  })).digest("hex");
}

export function assessmentSolutionContractContext(
  originalUserPrompt: string,
  requestContract: RequestContract,
  requestContractHash: string,
  owner: "content" | "visual" = "content",
): AssessmentContractContext {
  const actualHash = hashRequestContract(requestContract);
  if (actualHash !== requestContractHash) {
    throw new Error(`Assessment request contract hash mismatch: expected ${requestContractHash}, computed ${actualHash}.`);
  }
  if (requestContract.originalPrompt !== originalUserPrompt) {
    throw new Error("Assessment request contract does not match the exact original user prompt.");
  }
  const assignments = requestContract.reviewAssignments.filter((assignment) => assignment.owner === owner);
  const requirementIds = new Set(assignments.flatMap((assignment) => assignment.requirementIds));
  const requirements = requestContract.requirements.filter((requirement) => requirementIds.has(requirement.id));
  const deliverableIds = new Set(requirements.flatMap((requirement) => requirement.appliesTo));
  return {
    contractHash: actualHash,
    originalPrompt: originalUserPrompt,
    originalPromptHash: createHash("sha256").update(originalUserPrompt).digest("hex"),
    evaluationStatus: requestContract.evaluationStatus,
    userGoal: requestContract.userGoal,
    deliverables: requestContract.deliverables.filter((deliverable) => deliverableIds.has(deliverable.id)),
    requirements,
    reviewChecks: [...new Set(assignments.flatMap((assignment) => assignment.checks))],
    notRequired: requestContract.notRequired,
    forbidden: requestContract.forbidden,
    contentStrategy: requestContract.contentStrategy,
  };
}

export function assessmentSolutionTaskContract(
  model: AdaptiveStudyModel,
  item: AdaptiveStudyModel["questionBank"]["items"][number],
  context: Pick<AssessmentContractContext, "contractHash" | "originalPromptHash">,
): AssessmentSolutionTaskContract {
  if (!item.assessmentSectionId || !item.assessmentQuestionTypes?.length) {
    throw new Error(`Assessment solution item ${item.id} has no bound assessment section/question types.`);
  }
  const section = model.assessmentBlueprint.sections.find((candidate) =>
    candidate.id === item.assessmentSectionId
  );
  if (!section) {
    throw new Error(`Assessment solution item ${item.id} cites unknown section ${item.assessmentSectionId}.`);
  }
  if (!sameStrings(item.assessmentQuestionTypes, section.questionTypes)) {
    throw new Error(`Assessment solution item ${item.id} question types do not match its assessment plan section.`);
  }
  const planBinding = model.assessmentBlueprint.planBinding;
  if (
    planBinding &&
    (planBinding.contractHash !== context.contractHash ||
      planBinding.originalPromptHash !== context.originalPromptHash)
  ) {
    throw new Error(`Assessment solution item ${item.id} belongs to a different request-bound assessment plan.`);
  }
  const calculationDeclared = section.questionTypes.includes("calculation");
  const questionTypes = [...item.assessmentQuestionTypes].sort();
  const responseMode = item.type === "calculation" &&
      item.exercise.type === "calculation" && calculationDeclared
    ? "quantitative-calculation"
    : item.type === "application" &&
        item.exercise.type === "application" && !calculationDeclared
      ? "constructed-response"
      : null;
  if (!responseMode) {
    throw new Error(
      `Assessment solution item ${item.id} has an unsupported or contradictory response contract.`,
    );
  }
  const itemSemanticHash = createHash("sha256").update(JSON.stringify({
    id: item.id,
    legacyExerciseId: item.legacyExerciseId,
    assessmentSectionId: item.assessmentSectionId,
    assessmentQuestionTypes: questionTypes,
    topicId: item.topicId,
    learningObjectiveIds: item.learningObjectiveIds,
    type: item.type,
    scopeBasis: item.scopeBasis,
    exercise: item.exercise,
  })).digest("hex");
  const planSemanticHash = createHash("sha256").update(JSON.stringify({
    planContentHash: model.assessmentBlueprint.planContentHash,
    planBinding: model.assessmentBlueprint.planBinding,
    mode: model.assessmentBlueprint.mode,
    basisRequirementIds: [...(model.assessmentBlueprint.basisRequirementIds ?? [])].sort(),
    section: { ...section, questionTypes: [...section.questionTypes].sort() },
  })).digest("hex");
  return {
    schemaVersion: 1,
    contractHash: context.contractHash,
    originalPromptHash: context.originalPromptHash,
    itemSemanticHash,
    planSemanticHash,
    assessmentSectionId: item.assessmentSectionId,
    assessmentQuestionTypes: questionTypes,
    deliveryMode: section.deliveryMode,
    exerciseType: item.type,
    responseMode,
    learningObjectiveIds: [...item.learningObjectiveIds],
  };
}

const generatedSetSchema = z.object({
  items: z.array(generatedSolutionSchema),
});

const reviewSetSchema = z.object({
  items: z.array(z.object({
    legacyExerciseId: z.string().min(1),
    approved: z.boolean(),
    findings: z.array(z.string()).max(8),
  })),
});

const normalizedCropSchema = z.object({
  x: z.number().int().min(0).max(950),
  y: z.number().int().min(0).max(950),
  width: z.number().int().min(50).max(1000),
  height: z.number().int().min(50).max(1000),
}).refine(
  (crop) =>
    crop.x + crop.width <= 1000 &&
    crop.y + crop.height <= 1000 &&
    crop.width * crop.height <= 600_000,
  "Crop must stay inside the page and cover no more than 60% of it.",
);

const visualPlanSetSchema = z.object({
  items: z.array(z.object({
    legacyExerciseId: z.string().min(1),
    crop: normalizedCropSchema.nullable(),
    alt: z.string().min(1),
    reason: z.string().min(1),
  })),
});

const visualPlanSetJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["legacyExerciseId", "crop", "alt", "reason"],
        properties: {
          legacyExerciseId: { type: "string" },
          crop: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "width", "height"],
                properties: {
                  x: { type: "integer", minimum: 0, maximum: 950 },
                  y: { type: "integer", minimum: 0, maximum: 950 },
                  width: { type: "integer", minimum: 50, maximum: 1000 },
                  height: { type: "integer", minimum: 50, maximum: 1000 },
                },
              },
              { type: "null" },
            ],
          },
          alt: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const generatedSetJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "legacyExerciseId",
          "completeness",
          "summary",
          "steps",
          "finalAnswer",
          "assumptions",
          "evidenceBasis",
          "missingEvidence",
        ],
        properties: {
          legacyExerciseId: { type: "string" },
          completeness: { type: "string", enum: ["complete", "insufficient"] },
          summary: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          finalAnswer: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
          evidenceBasis: { type: "array", items: { type: "string" } },
          missingEvidence: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const reviewSetJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["legacyExerciseId", "approved", "findings"],
        properties: {
          legacyExerciseId: { type: "string" },
          approved: { type: "boolean" },
          findings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export async function resolveAssessmentSolutions(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  content: StudyGuideContent;
  sourceText: string;
  model: AdaptiveStudyModel;
  priorError: string | null;
  originalUserPrompt: string;
  requestContract: RequestContract;
  requestContractHash: string;
}): Promise<AssessmentSolutionSet> {
  const contentContract = assessmentSolutionContractContext(
    input.originalUserPrompt,
    input.requestContract,
    input.requestContractHash,
    "content",
  );
  const visualContract = assessmentSolutionContractContext(
    input.originalUserPrompt,
    input.requestContract,
    input.requestContractHash,
    "visual",
  );
  const tasks = input.model.questionBank.items.filter((item) =>
    item.assessmentSectionId && item.legacyExerciseId.startsWith("assessment-source-task-")
  );
  if (tasks.length === 0) {
    const empty = assessmentSolutionSetSchema.parse({ schemaVersion: 1, items: [] });
    await writeFile(
      path.join(input.config.runDir, "assessment-solutions.json"),
      `${JSON.stringify(empty, null, 2)}\n`,
      "utf8",
    );
    return empty;
  }
  const taskContracts = new Map(tasks.map((task) => [
    task.id,
    assessmentSolutionTaskContract(input.model, task, contentContract),
  ]));

  const fingerprint = assessmentSolutionSemanticCacheKey(contentContract, {
    version: "assessment-solutions-v5-open-item-contract",
    language: input.config.language,
    tasks: tasks.map((item) => ({
      id: item.legacyExerciseId,
      taskContract: taskContracts.get(item.id),
    })),
    content: input.content.topics.map((topic) => ({
      title: topic.title,
      theory: topic.theory,
      workedExamples: topic.workedExamples,
    })),
  });
  const sharedPath = path.join(
    process.cwd(),
    "study-buddy-data",
    "cache",
    "web-layout",
    "assessment-solutions",
    `${fingerprint}.json`,
  );
  const cached = await readSolutionSet(sharedPath);
  const localImages = await renderAssessmentEvidencePages(
    input.sourceText,
    input.config.runDir,
    tasks.length,
  );
  if (cached && coversAllTaskContracts(cached, tasks, taskContracts)) {
    const visualized = await attachAssessmentVisuals({
      config: input.config,
      codex: input.codex,
      tasks,
      solutions: cached.items,
      localImages,
      visualContract,
    });
    const migrated = assessmentSolutionSetSchema.parse({
      schemaVersion: 1,
      items: visualized,
    });
    const serialized = `${JSON.stringify(migrated, null, 2)}\n`;
    await Promise.all([
      writeFile(sharedPath, serialized, "utf8"),
      writeFile(path.join(input.config.runDir, "assessment-solutions.json"), serialized, "utf8"),
    ]);
    await input.config.diagnostics?.log(
      "info",
      "planner",
      `Reused ${cached.items.length} reviewed assessment solution(s) and refreshed only their visual crops.`,
    );
    return migrated;
  }
  await input.config.diagnostics?.log(
    "info",
    "planner",
    `Resolving ${tasks.length} complete assessment solution(s) in bounded per-task calls with ${localImages.length} evidence page(s).`,
  );
  const itemCacheDir = path.join(path.dirname(sharedPath), "items");
  await mkdir(itemCacheDir, { recursive: true });
  const resolvedItems = await Promise.all(tasks.map(async (task, index) => {
    const taskContract = taskContracts.get(task.id)!;
    const itemFingerprint = assessmentSolutionSemanticCacheKey(contentContract, {
      version: "assessment-solution-item-v4-open-item-contract",
      language: input.config.language,
      taskContract,
      topic: relevantTopicContext(input.content, task.topicId),
    });
    const itemCachePath = path.join(itemCacheDir, `${itemFingerprint}.json`);
    const cachedItem = await readReviewedSolution(itemCachePath, taskContract);
    if (cachedItem) {
      await input.config.diagnostics?.log(
        "info",
        "planner",
        `Reusing reviewed solution for ${task.legacyExerciseId}.`,
      );
      return cachedItem;
    }
    const localImage = localImages[index] ? [localImages[index]!] : [];
    const generatedResponse = await input.codex.run(
      buildAssessmentSolutionPrompt(input, task, contentContract),
      {
        task: "content_analyzer",
        attempt: index + 1,
        outputSchema: generatedSetJsonSchema,
        timeoutMs: 180_000,
        localImages: localImage,
      },
    );
    const generated = generatedSetSchema.parse(JSON.parse(stripJsonFence(generatedResponse)));
    assertExactCoverage(generated.items, [task.legacyExerciseId]);
    const solution = generated.items[0]!;
    const reviewResponse = await input.codex.run(
      buildAssessmentSolutionReviewPrompt(input, task, solution, contentContract),
      {
        task: "quality_reviewer",
        attempt: index + 1,
        outputSchema: reviewSetJsonSchema,
        timeoutMs: 180_000,
        localImages: localImage,
      },
    );
    const reviewed = reviewSetSchema.parse(JSON.parse(stripJsonFence(reviewResponse)));
    assertExactCoverage(reviewed.items, [task.legacyExerciseId]);
    const review = reviewed.items[0]!;
    if (
      solution.completeness !== "complete" ||
      solution.missingEvidence.length > 0 ||
      !review.approved
    ) {
      throw new Error([
        "Assessment solutions failed the publication gate.",
        `${solution.legacyExerciseId}: ${[
          ...(solution.completeness === "complete" ? [] : ["Musterlösung ist unvollständig."]),
          ...solution.missingEvidence,
          ...review.findings,
        ].join(" · ")}`,
      ].join("\n"));
    }
    const resolved = reviewedSolutionSchema.parse({
      ...solution,
      solutionOrigin: "study_buddy_generated",
      contractBinding: persistedTaskBinding(taskContract),
      review: {
        status: "approved",
        findings: review.findings,
      },
    });
    await writeFile(itemCachePath, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");
    return resolved;
  }));
  const itemsWithTaskEvidence = await attachAssessmentVisuals({
    config: input.config,
    codex: input.codex,
    tasks,
    solutions: resolvedItems,
    localImages,
    visualContract,
  });
  const result = assessmentSolutionSetSchema.parse({
    schemaVersion: 1,
    items: itemsWithTaskEvidence,
  });
  await mkdir(path.dirname(sharedPath), { recursive: true });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  await Promise.all([
    writeFile(sharedPath, serialized, "utf8"),
    writeFile(path.join(input.config.runDir, "assessment-solutions.json"), serialized, "utf8"),
  ]);
  return result;
}

async function attachAssessmentVisuals(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  tasks: AdaptiveStudyModel["questionBank"]["items"];
  solutions: AssessmentReferenceSolution[];
  localImages: string[];
  visualContract: AssessmentContractContext;
}): Promise<AssessmentReferenceSolution[]> {
  const stripped = input.solutions.map(({ taskImage: _taskImage, ...solution }) => solution);
  if (input.localImages.length === 0) return stripped;
  const evidence = await Promise.all(input.localImages.map(async (imagePath, index) => ({
    imagePath,
    legacyExerciseId: input.tasks[index]?.legacyExerciseId ?? `assessment-source-task-${index + 1}`,
    prompt: input.tasks[index]?.exercise.prompt ?? "",
    givens: input.tasks[index]?.exercise.type === "calculation"
      ? input.tasks[index]?.exercise.givens ?? []
      : [],
    hash: createHash("sha256").update(await readFile(imagePath)).digest("hex"),
  })));
  const cropFingerprint = assessmentSolutionSemanticCacheKey(input.visualContract, {
    version: "assessment-visual-crops-v2-request-contract",
    language: input.config.language,
    pages: evidence.map(({ legacyExerciseId, prompt, givens, hash }) => ({
      legacyExerciseId,
      prompt,
      givens,
      hash,
    })),
  });
  const cropCachePath = path.join(
    process.cwd(),
    "study-buddy-data",
    "cache",
    "web-layout",
    "assessment-visual-crops",
    `${cropFingerprint}.json`,
  );
  let plan = await readVisualPlan(cropCachePath);
  if (!plan || !coversAllTasks(plan, evidence.map((item) => item.legacyExerciseId))) {
    const response = await input.codex.run(
      buildVisualCropPrompt(input.config.language, evidence, input.visualContract),
      {
        task: "content_analyzer",
        attempt: 1,
        outputSchema: visualPlanSetJsonSchema,
        timeoutMs: 120_000,
        localImages: evidence.map((item) => item.imagePath),
      },
    );
    plan = visualPlanSetSchema.parse(JSON.parse(stripJsonFence(response)));
    assertExactCoverage(plan.items, evidence.map((item) => item.legacyExerciseId));
    await mkdir(path.dirname(cropCachePath), { recursive: true });
    await writeFile(cropCachePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  const planById = new Map(plan.items.map((item) => [item.legacyExerciseId, item]));
  const outputDir = path.join(input.config.runDir, "assessment-evidence-crops");
  await mkdir(outputDir, { recursive: true });
  return Promise.all(stripped.map(async (solution) => {
    const page = evidence.find((item) => item.legacyExerciseId === solution.legacyExerciseId);
    const selection = planById.get(solution.legacyExerciseId);
    if (!page || !selection?.crop) {
      return reviewedSolutionSchema.parse({
        ...solution,
        visualSelection: "none",
      });
    }
    const outputPath = path.join(outputDir, `${safeFileStem(solution.legacyExerciseId)}.png`);
    const dimensions = await cropDiagramImage(page.imagePath, outputPath, selection.crop);
    const image = await readFile(outputPath);
    return reviewedSolutionSchema.parse({
      ...solution,
      visualSelection: "diagram_crop",
      taskImage: {
        dataUri: `data:image/png;base64,${image.toString("base64")}`,
        alt: selection.alt,
        sourceLabel: input.config.language === "de"
          ? "Grafikausschnitt aus der Musterprüfung"
          : "Diagram crop from the sample assessment",
        kind: "diagram_crop",
        width: dimensions.width,
        height: dimensions.height,
      },
    });
  }));
}

function buildVisualCropPrompt(
  language: "de" | "en",
  evidence: Array<{
    legacyExerciseId: string;
    prompt: string;
    givens: string[];
  }>,
  contract: AssessmentContractContext,
): string {
  return [
    "ASSESSMENT_VISUAL_CROP_PLANNER",
    "Return JSON only. The attached page images correspond to the supplied items in the same order.",
    "For each page, decide whether the learner needs an original diagram, graph, table, map, illustration, or other visual that cannot be represented adequately by the HTML task text.",
    "The exact original request and the visual review assignment below are authoritative. If visuals are forbidden or explicitly not required, return crop=null for every item. Do not invent visual requirements absent from the assigned contract context.",
    "When a visual is needed, return one normalized crop rectangle on a 1000 × 1000 coordinate system: x and y are the top-left corner; width and height are the crop size.",
    "Crop only the indispensable visual. Include dimension arrows, legends, labels, axes, and callouts that belong to the drawing. Exclude page headings, prose paragraphs, bullet lists, the written task statement, requested-subtask lists, page numbers, borders, and blank page area.",
    "Use 10–20 normalized units of padding around the visual. The crop may not cover more than 60% of the page. If the page contains no independently useful visual, set crop to null.",
    "The alt text must describe only the cropped visual in the requested language, without repeating the task statement.",
    `Language: ${language}`,
    `Visual contract context:\n${JSON.stringify(contract)}`,
    `Items:\n${JSON.stringify(evidence.map(({ legacyExerciseId, prompt, givens }) => ({
      legacyExerciseId,
      htmlTaskText: { prompt, givens },
    })))}`,
  ].join("\n\n");
}

export function normalizedCropToPixels(
  crop: z.infer<typeof normalizedCropSchema>,
  imageWidth: number,
  imageHeight: number,
  options: {
    horizontalPaddingRatio?: number;
    verticalPaddingRatio?: number;
  } = {},
): { x: number; y: number; width: number; height: number } {
  // Diagram labels and dimension callouts commonly extend horizontally beyond
  // the detected linework. Preserve a bounded side margin without expanding
  // vertically into the duplicated task statement below the visual.
  const horizontalPaddingRatio = options.horizontalPaddingRatio ?? 0.15;
  const horizontalPadding = crop.width >= 320 && horizontalPaddingRatio > 0
    ? Math.max(18, Math.round(crop.width * horizontalPaddingRatio))
    : 0;
  const paddedX = Math.max(0, crop.x - horizontalPadding);
  const paddedRight = Math.min(1000, crop.x + crop.width + horizontalPadding);
  const verticalPadding = Math.max(
    0,
    Math.round(crop.height * (options.verticalPaddingRatio ?? 0)),
  );
  const paddedY = Math.max(0, crop.y - verticalPadding);
  const paddedBottom = Math.min(1000, crop.y + crop.height + verticalPadding);
  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(imageWidth * paddedX / 1000)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(imageHeight * paddedY / 1000)));
  const width = Math.max(1, Math.min(
    imageWidth - x,
    Math.ceil(imageWidth * (paddedRight - paddedX) / 1000),
  ));
  const height = Math.max(1, Math.min(
    imageHeight - y,
    Math.ceil(imageHeight * (paddedBottom - paddedY) / 1000),
  ));
  return { x, y, width, height };
}

export async function cropDiagramImage(
  inputPath: string,
  outputPath: string,
  crop: { x: number; y: number; width: number; height: number },
  options: {
    horizontalPaddingRatio?: number;
    verticalPaddingRatio?: number;
  } = {},
): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("identify", ["-format", "%w %h", inputPath]);
  const [imageWidth, imageHeight] = stdout.trim().split(/\s+/).map(Number);
  if (!imageWidth || !imageHeight) throw new Error(`Could not read image dimensions for ${inputPath}.`);
  const pixels = normalizedCropToPixels(crop, imageWidth, imageHeight, options);
  await execFileAsync("magick", [
    inputPath,
    "-crop",
    `${pixels.width}x${pixels.height}+${pixels.x}+${pixels.y}`,
    "+repage",
    "-strip",
    "-define",
    "png:compression-level=9",
    outputPath,
  ], { maxBuffer: 4_000_000 });
  return { width: pixels.width, height: pixels.height };
}

async function readVisualPlan(
  filePath: string,
): Promise<z.infer<typeof visualPlanSetSchema> | null> {
  try {
    return visualPlanSetSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

function safeFileStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "assessment-visual";
}

export function missingAssessmentSolutionIds(model: AdaptiveStudyModel): string[] {
  return model.questionBank.items.flatMap((item) =>
    item.assessmentSectionId &&
    item.legacyExerciseId.startsWith("assessment-source-task-") &&
    !item.referenceSolution
      ? [item.legacyExerciseId]
      : []
  );
}

export function buildAssessmentSolutionPrompt(
  input: {
    config: WebLayoutRuntimeConfig;
    content: StudyGuideContent;
    sourceText: string;
    model: AdaptiveStudyModel;
    priorError: string | null;
  },
  task: AdaptiveStudyModel["questionBank"]["items"][number],
  contract: AssessmentContractContext,
): string {
  const taskContract = assessmentSolutionTaskContract(input.model, task, contract);
  const responseInstructions = taskContract.responseMode === "quantitative-calculation"
    ? [
        "Quantitative calculation contract: solve every requested quantitative subtask. Show the governing relation, any necessary rearrangement, substituted values, intermediate results, and the final result. Carry units wherever they apply and include a short dimensional or physical plausibility check where meaningful; do not invent a unit for a dimensionless or unit-free result.",
        "If the task requires a handbook, diagram, standard table, or conventional approximation absent from the extracted course text, a complete pedagogical comparison calculation may adopt a commonly taught value only when it is explicitly disclosed under assumptions and is not presented as an official course value.",
        "Do not stop at a symbolic relation when the declared task requires a checkable numerical result. Use completeness=insufficient only when even a transparent in-scope assumption cannot produce the requested comparison result.",
        "finalAnswer must state every requested quantitative result or conclusion with applicable units, never 'see steps'.",
      ]
    : [
        "Constructed-response contract: provide a complete model response to every requested subtask in the declared response form. Use steps for the response structure, evidence-based reasoning, and explicit comparison criteria or rubric; finalAnswer must contain the complete comparison response or conclusions, never 'see steps'.",
        "For oral or external performance, supply a substantive model content/argument and criteria the learner can rehearse against; do not pretend the offline page performed or officially graded the live act. For self-assessed work, make the comparison criteria specific enough to judge fulfilment.",
        "Do not add quantitative machinery that is absent from this exact constructed-response task. Do not translate the declared plan type through a subject template.",
      ];
  return [
    "ASSESSMENT_SOLUTION_AUTHOR",
    "Create one complete comparison solution for the supplied assessment task. Return JSON only.",
    "This is a bounded assessment-answer transformation. Use the supplied course evidence, task text, and attached task-page images. Do not use tools or external research.",
    "The learner must be able to compare their own response with a substantive answer after finishing. A generic method description or a list that merely repeats requested subtasks is not a solution.",
    ...responseInstructions,
    "Use model knowledge only inside the assessment scope established by the original task. Disclose every adopted assumption and never present a Study Buddy comparison answer as an official course key.",
    "Set completeness=complete only when the response answers every requested subtask in its declared response form.",
    "evidenceBasis names the exact course source, task image, relation, example, or passage used. missingEvidence must be empty for a publishable solution.",
    input.priorError?.includes("Assessment solutions failed")
      ? `Repair these prior solution findings:\n${input.priorError}`
      : "",
    `Language: ${input.config.language}`,
    `Assigned content contract context (exact original request, verified hashes, and content-owned requirements only):\n${JSON.stringify(contract)}`,
    `Bound item/plan solution contract:\n${JSON.stringify(taskContract)}`,
    `Assessment task:\n${JSON.stringify({
      legacyExerciseId: task.legacyExerciseId,
      sectionId: task.assessmentSectionId,
      assessmentQuestionTypes: task.assessmentQuestionTypes,
      scopeBasis: task.scopeBasis,
      exercise: task.exercise,
    })}`,
    `Relevant generated course bank:\n${balancedExcerpt(JSON.stringify(
      relevantTopicContext(input.content, task.topicId),
    ), 14_000)}`,
    `Assessment evidence excerpt:\n${assessmentEvidenceExcerpt(input.sourceText, 12_000)}`,
  ].filter(Boolean).join("\n\n");
}

export function buildAssessmentSolutionReviewPrompt(
  input: {
    config: WebLayoutRuntimeConfig;
    content: StudyGuideContent;
    sourceText: string;
    model: AdaptiveStudyModel;
  },
  task: AdaptiveStudyModel["questionBank"]["items"][number],
  solution: z.infer<typeof generatedSolutionSchema>,
  contract: AssessmentContractContext,
): string {
  const taskContract = assessmentSolutionTaskContract(input.model, task, contract);
  const responseReview = taskContract.responseMode === "quantitative-calculation"
    ? "For this quantitative contract, verify the relations, necessary rearrangements, substitutions, applicable units, arithmetic, results, disclosed assumptions, and meaningful plausibility checks. Do not require units where none apply."
    : "For this constructed-response contract, verify substantive coverage, evidence-based reasoning, response-form fidelity, and usable comparison criteria or rubric. Reject invented quantitative apparatus that is absent from the exact task.";
  return [
    "ASSESSMENT_SOLUTION_REVIEWER",
    "Independently review every proposed assessment solution. Return JSON only.",
    "Approve only if the learner can compare their response against a complete, internally consistent answer to every requested subtask.",
    responseReview,
    "Reject placeholders, omitted subtasks, hidden assumptions, unsupported claims, or a finalAnswer that does not contain the actual comparison response. Do not demand that a Study Buddy-generated solution pretend to be an official course solution.",
    `Language: ${input.config.language}`,
    `Assigned content contract context (exact original request, verified hashes, and content-owned requirements only):\n${JSON.stringify(contract)}`,
    `Bound item/plan solution contract:\n${JSON.stringify(taskContract)}`,
    `Task:\n${JSON.stringify({
      legacyExerciseId: task.legacyExerciseId,
      sectionId: task.assessmentSectionId,
      assessmentQuestionTypes: task.assessmentQuestionTypes,
      exercise: task.exercise,
    })}`,
    `Proposed solution:\n${JSON.stringify(solution)}`,
    `Course context:\n${balancedExcerpt(JSON.stringify(
      relevantTopicContext(input.content, task.topicId),
    ), 8_000)}`,
    `Assessment evidence excerpt:\n${assessmentEvidenceExcerpt(input.sourceText, 6_000)}`,
  ].join("\n\n");
}

function assessmentEvidenceExcerpt(sourceText: string, limit = 16_000): string {
  const markers = [
    /Musterpr[üu]fung/i,
    /sample\s+exam/i,
    /past\s+(?:paper|exam)/i,
    /Pr[üu]fungstraining/i,
  ];
  const index = markers.map((pattern) => sourceText.search(pattern)).find((value) => value >= 0) ?? -1;
  if (index < 0) return balancedExcerpt(sourceText, limit);
  const start = Math.max(0, index - Math.floor(limit * 0.2));
  return sourceText.slice(start, start + limit);
}

async function renderAssessmentEvidencePages(
  sourceText: string,
  runDir: string,
  taskCount: number,
): Promise<string[]> {
  const pdfPath = assessmentPdfPath(sourceText);
  if (!pdfPath || !existsSync(pdfPath) || taskCount < 1) return [];
  const outputDir = path.join(runDir, "assessment-evidence-pages");
  const prefix = path.join(outputDir, "assessment");
  await mkdir(outputDir, { recursive: true });
  try {
    await execFileAsync("pdftoppm", [
      "-f",
      "2",
      "-l",
      String(taskCount + 1),
      "-r",
      "130",
      "-png",
      pdfPath,
      prefix,
    ], { maxBuffer: 4_000_000 });
    return (await readdir(outputDir))
      .filter((name) => /^assessment-\d+\.png$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .slice(0, Math.min(4, taskCount))
      .map((name) => path.join(outputDir, name));
  } catch {
    return [];
  }
}

function assessmentPdfPath(sourceText: string): string | null {
  const assessmentBlock = sourceText.match(
    /"title"\s*:\s*"[^"]*(?:Musterpr|sample\s+exam|past\s+(?:paper|exam))[^"]*"[\s\S]{0,1800}?"(?:previewPath|localPath|path)"\s*:\s*"([^"]+\.pdf)"/i,
  );
  if (assessmentBlock?.[1]) return assessmentBlock[1];
  const fallback = sourceText.match(
    /(?:Musterpr|sample[-_ ]?exam|past[-_ ]?(?:paper|exam))[^"\n]{0,100}\.pdf/i,
  )?.[0];
  if (!fallback) return null;
  const absoluteStart = fallback.search(/(?:\/|[A-Za-z]:[\\/])/);
  return absoluteStart >= 0 ? fallback.slice(absoluteStart) : null;
}

function coversAllTasks(
  set: { items: Array<{ legacyExerciseId: string }> },
  ids: string[],
): boolean {
  const present = new Set(set.items.map((item) => item.legacyExerciseId));
  return ids.every((id) => present.has(id));
}

function coversAllTaskContracts(
  set: AssessmentSolutionSet,
  tasks: AdaptiveStudyModel["questionBank"]["items"],
  contracts: Map<string, AssessmentSolutionTaskContract>,
): boolean {
  if (!coversAllTasks(set, tasks.map((item) => item.legacyExerciseId))) return false;
  return tasks.every((task) => {
    const solution = set.items.find((item) => item.legacyExerciseId === task.legacyExerciseId);
    const contract = contracts.get(task.id);
    return Boolean(solution?.contractBinding && contract &&
      JSON.stringify(solution.contractBinding) === JSON.stringify(persistedTaskBinding(contract)));
  });
}

function assertExactCoverage(
  items: Array<{ legacyExerciseId: string }>,
  ids: string[],
): void {
  const expected = [...ids].sort();
  const actual = items.map((item) => item.legacyExerciseId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Assessment solution coverage mismatch: expected ${expected.join(", ")}, received ${actual.join(", ")}.`,
    );
  }
}

async function readSolutionSet(filePath: string): Promise<AssessmentSolutionSet | null> {
  try {
    return assessmentSolutionSetSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

async function readReviewedSolution(
  filePath: string,
  expectedContract: AssessmentSolutionTaskContract,
): Promise<AssessmentReferenceSolution | null> {
  try {
    const solution = reviewedSolutionSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    return solution.contractBinding &&
        JSON.stringify(solution.contractBinding) === JSON.stringify(persistedTaskBinding(expectedContract))
      ? solution
      : null;
  } catch {
    return null;
  }
}

function persistedTaskBinding(contract: AssessmentSolutionTaskContract) {
  return {
    contractHash: contract.contractHash,
    originalPromptHash: contract.originalPromptHash,
    itemSemanticHash: contract.itemSemanticHash,
    planSemanticHash: contract.planSemanticHash,
    assessmentSectionId: contract.assessmentSectionId,
    assessmentQuestionTypes: contract.assessmentQuestionTypes,
    deliveryMode: contract.deliveryMode,
    exerciseType: contract.exerciseType,
    responseMode: contract.responseMode,
  };
}

function relevantTopicContext(
  content: StudyGuideContent,
  topicId: string,
): StudyGuideContent["topics"] {
  const direct = content.topics.filter((topic) => topic.id === topicId);
  const remaining = content.topics.filter((topic) => topic.id !== topicId);
  return [...direct, ...remaining];
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function sameStrings(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
