import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AdaptiveStudyModel } from "./adaptiveStudyModel.js";
import { cropDiagramImage } from "./assessmentSolutions.js";
import type { CodexClient } from "./codexClient.js";
import {
  learningVisualSetSchema,
  type LearningVisual,
  type LearningVisualSet,
} from "./learningVisualTypes.js";
import { readExtractionHandoff } from "./studyGuideProfile.js";
import type { StudyGuideContent } from "./studyGuideContent.js";
import type { WebLayoutRuntimeConfig } from "./types.js";
import {
  hashRequestContract,
  type RequestContract,
} from "../shared/requestContract.js";

const execFileAsync = promisify(execFile);
const MAX_VISUAL_TARGETS = 10;
const MAX_QUESTION_TARGETS_PER_TOPIC = 1;

const cropSchema = z.object({
  x: z.number().int().min(0).max(950),
  y: z.number().int().min(0).max(950),
  width: z.number().int().min(50).max(1000),
  height: z.number().int().min(50).max(1000),
});

const planSchema = z.object({
  items: z.array(z.object({
    targetId: z.string().min(1),
    crop: cropSchema.nullable(),
    alt: z.string(),
    reason: z.string().min(1),
  })),
});

const planJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "crop", "alt", "reason"],
        properties: {
          targetId: { type: "string" },
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

interface PdfSource {
  id: string;
  title: string;
  pdfPath: string;
}

export interface AuthorizedImageAsset {
  id: string;
  title: string;
  imagePath: string;
  sourceId: string;
  sourcePage: number;
  captionHint: string;
  relevanceReason: string;
}

interface VisualTarget {
  targetId: string;
  targetKind: "module" | "question";
  source: PdfSource;
  sourceLabel: string;
  sourceTask: string;
  query: string;
  priority: number;
  origin: LearningVisual["origin"];
  figureHint?: string;
}

interface Candidate extends Omit<VisualTarget, "source"> {
  sourceKind: "validated_asset" | "pdf_page";
  page: number;
  pageText: string;
  imagePath: string;
  imageHash: string;
}

export interface LearningVisualContractContext {
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

export function learningVisualSemanticCacheKey(
  context: Pick<LearningVisualContractContext, "contractHash" | "originalPromptHash">,
  payload: unknown,
): string {
  return createHash("sha256").update(JSON.stringify({
    contractHash: context.contractHash,
    originalPromptHash: context.originalPromptHash,
    payload,
  })).digest("hex");
}

export function learningVisualReviewBatchMetadata(
  batchIndex: number,
  retryCount = 0,
): { batchOrdinal: number; attempt: number } {
  if (!Number.isInteger(batchIndex) || batchIndex < 0) {
    throw new RangeError(`Visual review batch index must be a non-negative integer, got ${batchIndex}.`);
  }
  if (!Number.isInteger(retryCount) || retryCount < 0) {
    throw new RangeError(`Visual review retry count must be a non-negative integer, got ${retryCount}.`);
  }
  return {
    batchOrdinal: batchIndex + 1,
    attempt: retryCount + 1,
  };
}

export function learningVisualContractContext(
  originalUserPrompt: string,
  requestContract: RequestContract,
  requestContractHash: string,
): LearningVisualContractContext {
  const actualHash = hashRequestContract(requestContract);
  if (actualHash !== requestContractHash) {
    throw new Error(`Learning-visual request contract hash mismatch: expected ${requestContractHash}, computed ${actualHash}.`);
  }
  if (requestContract.originalPrompt !== originalUserPrompt) {
    throw new Error("Learning-visual request contract does not match the exact original user prompt.");
  }
  const assignments = requestContract.reviewAssignments.filter((assignment) => assignment.owner === "visual");
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

export async function resolveLearningVisuals(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  content: StudyGuideContent;
  sourceText: string;
  model: AdaptiveStudyModel;
  originalUserPrompt: string;
  requestContract: RequestContract;
  requestContractHash: string;
}): Promise<LearningVisualSet> {
  const contract = learningVisualContractContext(
    input.originalUserPrompt,
    input.requestContract,
    input.requestContractHash,
  );
  const empty = (): LearningVisualSet => learningVisualSetSchema.parse({
    schemaVersion: 1,
    modules: {},
    questions: {},
  });
  const sources = authorizedPdfSources(input.sourceText);
  const assets = authorizedImageAssets(input.sourceText);
  if (sources.length === 0 && assets.length === 0) {
    const result = empty();
    await persist(input.config.runDir, result);
    return result;
  }
  const assetCandidates = await selectValidatedAssetCandidates(
    input.content,
    input.model,
    input.sourceText,
    assets,
  );
  const assetModuleIds = new Set(
    assetCandidates
      .filter((candidate) => candidate.targetKind === "module")
      .map((candidate) => candidate.targetId),
  );
  const targets = selectTargets(
    input.content,
    input.model,
    sources,
    figureHintsBySource(input.sourceText),
  )
    .filter((target) =>
      target.targetKind !== "module" || !assetModuleIds.has(target.targetId)
    )
    .sort((left, right) => right.priority - left.priority)
    .slice(0, MAX_VISUAL_TARGETS);
  const pdfCandidates = (await Promise.all(targets.map((target) =>
    createCandidate(target, input.config.runDir)
  ))).filter((value): value is Candidate => value !== null);
  const candidates = [...assetCandidates, ...pdfCandidates]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, MAX_VISUAL_TARGETS);
  if (candidates.length === 0) {
    const result = empty();
    await persist(input.config.runDir, result);
    return result;
  }

  const batches = Array.from(
    { length: Math.ceil(candidates.length / 4) },
    (_, index) => candidates.slice(index * 4, (index + 1) * 4),
  );
  await input.config.diagnostics?.log(
    "info",
    "planner",
    `Reviewing ${candidates.length} course-page candidate(s) in ${batches.length} parallel image-safe batch(es).`,
  );
  const batchPlans = await Promise.all(batches.map(async (batch, batchIndex) => {
    const batchMetadata = learningVisualReviewBatchMetadata(batchIndex);
    const fingerprint = learningVisualSemanticCacheKey(contract, {
      version: "learning-visual-plan-v8-request-contract",
      language: input.config.language,
      candidates: batch.map((candidate) => ({
        targetId: candidate.targetId,
        targetKind: candidate.targetKind,
        sourceLabel: candidate.sourceLabel,
        sourceTask: candidate.sourceTask,
        page: candidate.page,
        imageHash: candidate.imageHash,
      })),
    });
    const cachePath = path.join(
      process.cwd(),
      "study-buddy-data",
      "cache",
      "web-layout",
      "learning-visuals",
      `${fingerprint}.json`,
    );
    const cached = await readPlan(cachePath);
    if (cached && coversTargets(cached.items, batch)) {
      await input.config.diagnostics?.log(
        "info",
        "planner",
        `Reusing visual review batch ${batchMetadata.batchOrdinal}/${batches.length}.`,
      );
      return cached;
    }
    const response = await input.codex.run(
      buildPrompt(input.config.language, batch, contract),
      {
        task: "content_analyzer",
        // Batch ordinal describes independent parallel work. Attempt is local
        // to this exact batch and increases only if that batch is retried.
        attempt: batchMetadata.attempt,
        outputSchema: planJsonSchema,
        timeoutMs: 150_000,
        localImages: batch.map((candidate) => candidate.imagePath),
      },
    );
    const generated = planSchema.parse(JSON.parse(stripJsonFence(response)));
    assertExactCoverage(generated.items, batch);
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
    return generated;
  }));
  const initialPlan = planSchema.parse({
    items: batchPlans.flatMap((batch) => batch.items),
  });
  const plan = await refineCropsAgainstPreviews({
    config: input.config,
    codex: input.codex,
    candidates,
    plan: initialPlan,
  });

  const modules: Record<string, LearningVisual> = {};
  const questions: Record<string, LearningVisual> = {};
  const planById = new Map(plan.items.map((item) => [item.targetId, item]));
  const outputDir = path.join(input.config.runDir, "learning-visual-crops");
  await mkdir(outputDir, { recursive: true });
  for (const candidate of candidates) {
    const selection = planById.get(candidate.targetId);
    if (
      !selection?.crop ||
      !selection.alt.trim() ||
      !isUsableCrop(selection.crop)
    ) continue;
    const outputPath = path.join(outputDir, `${safeStem(candidate.targetId)}.png`);
    const finalCrop = reviewedCropForRendering(selection.crop);
    if (!isUsableCrop(finalCrop)) continue;
    const dimensions = await cropDiagramImage(
      candidate.imagePath,
      outputPath,
      finalCrop,
      // The visual reviewer already returns a self-contained crop. Adding
      // vertical padding here reintroduced the page prose and worked solution
      // that the crop contract explicitly excludes.
      {
        horizontalPaddingRatio: 0,
        verticalPaddingRatio: 0,
      },
    );
    const image = await readFile(outputPath);
    const visual = {
      dataUri: `data:image/png;base64,${image.toString("base64")}`,
      alt: selection.alt,
      sourceLabel: candidate.sourceLabel,
      sourceTask: candidate.sourceTask,
      kind: "diagram_crop" as const,
      origin: candidate.origin,
      width: dimensions.width,
      height: dimensions.height,
    };
    if (candidate.targetKind === "module") modules[candidate.targetId] = visual;
    else questions[candidate.targetId] = visual;
  }
  const result = learningVisualSetSchema.parse({
    schemaVersion: 1,
    modules,
    questions,
  });
  await persist(input.config.runDir, result);
  return result;
}

async function refineCropsAgainstPreviews(input: {
  config: WebLayoutRuntimeConfig;
  codex: CodexClient;
  candidates: Candidate[];
  plan: z.infer<typeof planSchema>;
}): Promise<z.infer<typeof planSchema>> {
  const initialById = new Map(input.plan.items.map((item) => [item.targetId, item]));
  const previewDir = path.join(input.config.runDir, "learning-visual-previews");
  await mkdir(previewDir, { recursive: true });
  const previews: Array<{
    candidate: Candidate;
    current: z.infer<typeof planSchema>["items"][number];
    previewPath: string;
    previewHash: string;
  }> = [];
  for (const candidate of input.candidates) {
    const current = initialById.get(candidate.targetId);
    if (!current?.crop || !current.alt.trim() || !isUsableCrop(current.crop)) continue;
    const previewPath = path.join(previewDir, `${safeStem(candidate.targetId)}.png`);
    await cropDiagramImage(candidate.imagePath, previewPath, current.crop, {
      horizontalPaddingRatio: 0,
      verticalPaddingRatio: 0,
    });
    const previewHash = createHash("sha256")
      .update(await readFile(previewPath))
      .digest("hex");
    previews.push({ candidate, current, previewPath, previewHash });
  }
  if (previews.length === 0) return input.plan;

  const batches = Array.from(
    { length: Math.ceil(previews.length / 2) },
    (_, index) => previews.slice(index * 2, (index + 1) * 2),
  );
  const reviewedItems = (await Promise.all(batches.map(async (batch, batchIndex) => {
    const fingerprint = createHash("sha256").update(JSON.stringify({
      version: "learning-visual-crop-refinement-v3-no-edge-fragments",
      language: input.config.language,
      candidates: batch.map(({ candidate, current, previewHash }) => ({
        targetId: candidate.targetId,
        imageHash: candidate.imageHash,
        previewHash,
        currentCrop: current.crop,
      })),
    })).digest("hex");
    const cachePath = path.join(
      process.cwd(),
      "study-buddy-data",
      "cache",
      "web-layout",
      "learning-visual-crop-refinement",
      `${fingerprint}.json`,
    );
    const candidates = batch.map(({ candidate }) => candidate);
    const cached = await readPlan(cachePath);
    if (cached && coversTargets(cached.items, candidates)) {
      await input.config.diagnostics?.log(
        "info",
        "planner",
        `Reusing visual crop refinement ${batchIndex + 1}/${batches.length}.`,
      );
      return cached.items;
    }
    try {
      const response = await input.codex.run(
        buildCropRefinementPrompt(input.config.language, batch),
        {
          task: "content_analyzer",
          attempt: 1,
          outputSchema: planJsonSchema,
          timeoutMs: 150_000,
          localImages: batch.flatMap(({ candidate, previewPath }) => [
            candidate.imagePath,
            previewPath,
          ]),
        },
      );
      const generated = planSchema.parse(JSON.parse(stripJsonFence(response)));
      assertExactCoverage(generated.items, candidates);
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
      return generated.items;
    } catch (error) {
      await input.config.diagnostics?.log(
        "warn",
        "planner",
        `Visual crop refinement ${batchIndex + 1}/${batches.length} was unavailable; retaining the reviewed first-pass crop: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return batch.map(({ current }) => current);
    }
  }))).flat();
  const reviewedById = new Map(reviewedItems.map((item) => [item.targetId, item]));
  return planSchema.parse({
    items: input.plan.items.map((item) => reviewedById.get(item.targetId) ?? item),
  });
}

function authorizedPdfSources(sourceText: string): PdfSource[] {
  const handoff = readExtractionHandoff(sourceText);
  return (handoff?.sources ?? []).flatMap((source) => {
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const title = typeof source.title === "string" ? source.title.trim() : "";
    const kind = typeof source.kind === "string" ? source.kind.trim().toLowerCase() : "";
    const pdfPath = typeof source.path === "string" ? source.path.trim() : "";
    if (!id || !title || kind !== "pdf" || !pdfPath.endsWith(".pdf") || !existsSync(pdfPath)) {
      return [];
    }
    return [{ id, title, pdfPath }];
  });
}

export function authorizedImageAssets(sourceText: string): AuthorizedImageAsset[] {
  const handoff = readExtractionHandoff(sourceText);
  const extractionRoot = /^# Moodle extraction handoff:\s*(.+)$/m
    .exec(sourceText)?.[1]?.trim() ?? "";
  return (handoff?.visual_assets ?? []).flatMap((asset) => {
    const id = typeof asset.id === "string" ? asset.id.trim() : "";
    const title = typeof asset.title === "string" ? asset.title.trim() : "";
    const relativePath = typeof asset.relative_path === "string"
      ? asset.relative_path.trim()
      : "";
    const sourceId = typeof asset.source_id === "string"
      ? asset.source_id.trim()
      : "";
    const sourcePage = typeof asset.source_page === "number" &&
        Number.isInteger(asset.source_page) &&
        asset.source_page > 0
      ? asset.source_page
      : 1;
    const captionHint = typeof asset.caption_hint === "string"
      ? asset.caption_hint.trim()
      : "";
    const relevanceReason = typeof asset.relevance_reason === "string"
      ? asset.relevance_reason.trim()
      : "";
    const imagePath = relativePath
      ? path.isAbsolute(relativePath)
        ? relativePath
        : extractionRoot
          ? path.resolve(extractionRoot, relativePath)
          : ""
      : "";
    if (
      !id ||
      !title ||
      !sourceId ||
      !imagePath ||
      !/\.(?:png|jpe?g)$/i.test(imagePath) ||
      !existsSync(imagePath)
    ) {
      return [];
    }
    return [{
      id,
      title,
      imagePath,
      sourceId,
      sourcePage,
      captionHint,
      relevanceReason,
    }];
  });
}

async function selectValidatedAssetCandidates(
  content: StudyGuideContent,
  model: AdaptiveStudyModel,
  sourceText: string,
  assets: AuthorizedImageAsset[],
): Promise<Candidate[]> {
  const handoff = readExtractionHandoff(sourceText);
  const sourcesById = new Map((handoff?.sources ?? []).flatMap((source) => {
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const title = typeof source.title === "string" ? source.title.trim() : "";
    return id && title ? [[id, title] as const] : [];
  }));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const rankedByModule = new Map<string, { score: number; candidate: Candidate }>();
  for (const figure of handoff?.figures ?? []) {
    const assetId = typeof figure.asset_id === "string"
      ? figure.asset_id.trim()
      : "";
    const asset = assetsById.get(assetId);
    if (!asset) continue;
    const caption = typeof figure.caption === "string" ? figure.caption.trim() : "";
    const placement = typeof figure.placement_hint === "string"
      ? figure.placement_hint.trim()
      : "";
    const evidence = [
      caption,
      placement,
      asset.captionHint,
      asset.relevanceReason,
      asset.title,
    ].filter(Boolean).join(" ");
    if (
      /(?:titelblatt|title\s+(?:page|slide)|integrationskonstant|formula[- ]only|formel(?:ausdruck|blatt))/i
        .test(evidence)
    ) {
      continue;
    }
    const sourceTitle = sourcesById.get(asset.sourceId) ?? asset.title;
    const image = await readFile(asset.imagePath);
    const imageHash = createHash("sha256").update(image).digest("hex");
    for (const topic of content.topics) {
      const module = model.courseBlueprint.modules.find((item) => item.id === topic.id);
      if (!module) continue;
      const sourceScore = sourceTitleMatchScore(module.sourceLabels, sourceTitle);
      const topicText = [
        topic.title,
        topic.theory.summary,
        ...topic.theory.keyIdeas,
      ].join(" ");
      const evidenceScore = tokenOverlap(evidence, topicText) * 100;
      const score = Math.max(sourceScore, evidenceScore);
      if (score < 18) continue;
      const candidate: Candidate = {
        targetId: topic.id,
        targetKind: "module",
        sourceLabel: sourceTitle,
        sourceTask: `${topic.title}: ${caption || asset.captionHint || asset.title}`,
        query: `${topic.title} ${evidence}`,
        priority: 120 + score,
        origin: "course_original",
        figureHint: evidence,
        sourceKind: "validated_asset",
        page: asset.sourcePage,
        pageText: evidence,
        imagePath: asset.imagePath,
        imageHash,
      };
      const current = rankedByModule.get(topic.id);
      if (!current || score > current.score) {
        rankedByModule.set(topic.id, { score, candidate });
      }
    }
  }
  return [...rankedByModule.values()].map(({ candidate }) => candidate);
}

function selectTargets(
  content: StudyGuideContent,
  model: AdaptiveStudyModel,
  sources: PdfSource[],
  figureHints: Map<string, string[]>,
): VisualTarget[] {
  const targets: VisualTarget[] = [];
  for (const topic of content.topics) {
    if (/(?:prüfung|exam|assessment)\s*(?:straining|training|practice)?/i.test(topic.title)) {
      continue;
    }
    const module = model.courseBlueprint.modules.find((item) => item.id === topic.id);
    if (!module) continue;
    const source = bestSource(
      module.sourceLabels,
      sources,
      (candidate) => /folien|slide|lecture|skript|theorie/i.test(candidate.title) ? 8 : 0,
    );
    if (source) {
      const figureHint = relevantFigureHint(
        figureHints.get(source.id) ?? [],
        [
          topic.title,
          topic.theory.summary,
          ...topic.theory.keyIdeas,
        ].join(" "),
      );
      targets.push({
        targetId: topic.id,
        targetKind: "module",
        source,
        sourceLabel: source.title,
        sourceTask: `${topic.title}: ${topic.theory.summary}`,
        query: figureHint
          ? `${topic.title} ${figureHint}`
          : [
              topic.title,
              topic.theory.summary,
              ...topic.theory.keyIdeas,
              ...topic.theory.formulas.flatMap((formula) => [formula.expression, formula.meaning]),
            ].join(" "),
        priority: 60,
        origin: "course_original",
        ...(figureHint ? { figureHint } : {}),
      });
    }
    const eligible = model.questionBank.items
      .filter((item) =>
        item.topicId === topic.id &&
        !item.assessmentSectionId &&
        item.origin !== "study_buddy_generated"
      )
      .map((item): VisualTarget | null => {
        const itemSource = sourceNamedByTask(
          item.scopeBasis.sourceTask,
          sources,
        ) ?? bestSource([item.scopeBasis.sourceLabel], sources);
        if (!itemSource) return null;
        const visualCue = visualCueScore([
          item.exercise.prompt,
          item.scopeBasis.sourceTask,
          item.exercise.type === "calculation" ? item.exercise.givens.join(" ") : "",
        ].join(" "));
        return {
          targetId: item.legacyExerciseId,
          targetKind: "question" as const,
          source: itemSource,
          sourceLabel: itemSource.title,
          sourceTask: item.scopeBasis.sourceTask,
          query: [
            item.exercise.prompt,
            item.scopeBasis.sourceTask,
            item.exercise.type === "calculation" ? item.exercise.givens.join(" ") : "",
          ].join(" "),
          priority: 80 + visualCue + (item.origin === "course_original" ? 8 : 0) +
            (item.type === "cross" ? 0 : 4),
          origin: item.origin === "course_original"
            ? "course_original" as const
            : "course_adapted" as const,
        };
      })
      .filter((value): value is VisualTarget => value !== null)
      .sort((left, right) => right.priority - left.priority)
      .slice(0, MAX_QUESTION_TARGETS_PER_TOPIC);
    targets.push(...eligible);
  }
  return targets;
}

function bestSource(
  labels: string[],
  sources: PdfSource[],
  preference: (source: PdfSource) => number = () => 0,
): PdfSource | null {
  const ranked = sources.map((source) => {
    const match = sourceTitleMatchScore(labels, source.title);
    return { source, score: match + preference(source) };
  }).sort((left, right) => right.score - left.score);
  return ranked[0]?.score && ranked[0].score >= 18 ? ranked[0].source : null;
}

export function sourceTitleMatchScore(labels: string[], sourceTitle: string): number {
  const normalizedLabels = labels.map(normalize).filter(Boolean);
  const title = normalize(sourceTitle);
  return normalizedLabels.reduce((best, label) => {
    if (title === label) return Math.max(best, 100);
    if (title.includes(label) || label.includes(title)) return Math.max(best, 70);
    return Math.max(best, tokenOverlap(label, title) * 40);
  }, 0);
}

function sourceNamedByTask(
  sourceTask: string,
  sources: PdfSource[],
): PdfSource | null {
  const taskNumber = /(?:beispiel|example|aufgabe|task)\s*([a-g]|\d{1,2})\b/i
    .exec(sourceTask)?.[1];
  if (!taskNumber) return null;
  const expected = normalize(`Angabe ${taskNumber}`);
  return sources.find((source) => normalize(source.title) === expected) ?? null;
}

async function createCandidate(
  target: VisualTarget,
  runDir: string,
): Promise<Candidate | null> {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", target.source.pdfPath, "-"],
      { maxBuffer: 20_000_000 },
    );
    const pages = stdout.split("\f").map((text, index) => ({
      page: index + 1,
      text: text.trim(),
      score: rankPage(text, target.query, index),
    })).filter((page) => page.text.length > 20);
    const selected = pages
      .sort((left, right) => right.score - left.score)
      .find((page) =>
        !isDeterministicTitlePage(
          page.text,
          page.page - 1,
          Boolean(target.figureHint),
        )
      );
    if (!selected) return null;
    if (
      target.targetKind === "question" &&
      matchingQueryTokens(selected.text, target.query) < 2
    ) {
      return null;
    }
    const pageDir = path.join(runDir, "learning-visual-pages");
    await mkdir(pageDir, { recursive: true });
    const prefix = path.join(pageDir, safeStem(target.targetId));
    await execFileAsync("pdftoppm", [
      "-f",
      String(selected.page),
      "-l",
      String(selected.page),
      "-singlefile",
      "-r",
      "100",
      "-png",
      target.source.pdfPath,
      prefix,
    ], { maxBuffer: 4_000_000 });
    const imagePath = `${prefix}.png`;
    const imageHash = createHash("sha256").update(await readFile(imagePath)).digest("hex");
    const { source: _source, ...candidate } = target;
    return {
      ...candidate,
      sourceKind: "pdf_page",
      page: selected.page,
      pageText: selected.text,
      imagePath,
      imageHash,
    };
  } catch {
    return null;
  }
}

export function isDeterministicTitlePage(
  text: string,
  zeroBasedPage: number,
  hasFigureHint = false,
): boolean {
  return !hasFigureHint &&
    zeroBasedPage === 0 &&
    visualCueScore(text) === 0 &&
    tokens(text).length <= 24;
}

function figureHintsBySource(sourceText: string): Map<string, string[]> {
  const handoff = readExtractionHandoff(sourceText);
  const result = new Map<string, string[]>();
  for (const figure of handoff?.figures ?? []) {
    const caption = typeof figure.caption === "string" ? figure.caption.trim() : "";
    const placement = typeof figure.placement_hint === "string"
      ? figure.placement_hint.trim()
      : "";
    const hint = [caption, placement].filter(Boolean).join(" ");
    if (!hint || /^(?:titelblatt|title\s+(?:page|slide))\b/i.test(caption)) continue;
    const sourceIds = Array.isArray(figure.source_ids)
      ? figure.source_ids.filter((value): value is string => typeof value === "string")
      : [];
    for (const sourceId of sourceIds) {
      const existing = result.get(sourceId) ?? [];
      existing.push(hint);
      result.set(sourceId, existing);
    }
  }
  return result;
}

function relevantFigureHint(hints: string[], topicText: string): string | null {
  if (hints.length === 0) return null;
  const ranked = hints
    .map((hint) => ({
      hint,
      score: tokenOverlap(hint, topicText) -
        (/(?:integrationskonstant|formula|equation|gleichungsausdruck|formelausdruck)/i.test(hint)
          ? 1
          : 0),
    }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score && ranked[0].score >= 0.08
    ? ranked[0].hint
    : null;
}

export function rankPage(text: string, query: string, zeroBasedPage: number): number {
  const normalizedText = normalize(text);
  const queryTokens = [...new Set(tokens(query))];
  const overlap = queryTokens.reduce(
    (total, token) => total + (normalizedText.includes(token) ? Math.min(12, token.length) : 0),
    0,
  );
  // Slides dominated by a diagram often yield only a title and a few labels
  // during PDF text extraction. Reward such sparse-but-relevant pages so the
  // visual reviewer sees the diagram rather than the adjacent prose slide.
  const sparseVisualBonus = normalizedText.length >= 30 && normalizedText.length <= 220
    ? 42
    : normalizedText.length <= 420
      ? 12
      : 0;
  return overlap + visualCueScore(text) + sparseVisualBonus -
    (zeroBasedPage === 0 ? 2 : 0);
}

function buildPrompt(
  language: "de" | "en",
  candidates: Candidate[],
  contract: LearningVisualContractContext,
): string {
  return [
    "LEARNING_VISUAL_CROP_PLANNER",
    "Return JSON only. Each attached image is one authorized course PDF page and corresponds to the target at the same array index.",
    "Decide independently for every target whether the page contains a diagram, graph, technical drawing, map, table, annotated illustration, or other visual that materially improves understanding of the theory or is useful for solving the question.",
    "The exact original request and the visual review assignment below are authoritative. If visuals are forbidden or explicitly not required, return crop=null for every target. Do not invent visual requirements absent from the assigned contract context.",
    "Reject decorative images, logos, portraits, page chrome, screenshots of prose, ordinary formula-only text, and visuals unrelated to the exact target. A theory visual must clarify the named concept. A question visual must be relevant to that exact task; do not attach a merely topical image.",
    "If useful, return one crop in a normalized 1000 × 1000 coordinate system. Include every label, axis, legend, dimension arrow, callout, and table heading needed to interpret the visual.",
    "Exclude page headings, footers, page numbers, prose explanations, and the written task statement: those remain searchable HTML. Use tight padding and never crop more than 60% of the page. If a clean, self-contained crop is not possible or adds no learning value, set crop to null.",
    "Crop the cohesive diagram itself, not a rectangular page region around it. Before returning coordinates, inspect all four crop edges: no complete prose line, worked-solution equation, derivation, or neighboring exercise may remain outside the diagram's own labels. Tighten the edge until it is gone. Prefer one complete primary diagram over multiple diagram clusters when including the second cluster would also include surrounding prose or calculations.",
    "Alt text describes only the retained visual in the requested language and does not repeat the task.",
    `Language: ${language}`,
    `Visual contract context (verified hashes and visual-owned requirements only):\n${JSON.stringify(contract)}`,
    `Targets:\n${JSON.stringify(candidates.map((candidate, imageIndex) => ({
      imageIndex,
      targetId: candidate.targetId,
      kind: candidate.targetKind,
      source: candidate.sourceLabel,
      sourcePage: candidate.page,
      targetText: candidate.figureHint
        ? `${candidate.sourceTask}\nExpected visual evidence: ${candidate.figureHint}`
        : candidate.sourceTask,
    })))}`,
  ].join("\n\n");
}

function buildCropRefinementPrompt(
  language: "de" | "en",
  previews: Array<{
    candidate: Candidate;
    current: z.infer<typeof planSchema>["items"][number];
    previewPath: string;
    previewHash: string;
  }>,
): string {
  return [
    "LEARNING_VISUAL_CROP_REFINER",
    "Return JSON only. Every target has two attached images: first the authorized original source image, then the exact preview produced by the current crop.",
    "Return crop coordinates in the ORIGINAL image's normalized 1000 × 1000 coordinate system. Keep the existing coordinates only if the preview is already a complete, clean learning visual.",
    "Correct both failure modes: (1) do not cut off diagram linework, arrows, axes, labels, legends, or dimensions; (2) do not retain neighboring prose, headings, worked-solution equations, task statements, page numbers, or fragments from another diagram.",
    "A short label belonging to the diagram is allowed. A prose sentence or standalone derivation beside or below it is not. Prefer one cohesive, fully legible diagram. If no clean crop exists, set crop to null and alt to an empty string.",
    "Inspect the preview's four edges at high attention. Even a partial equation glyph, a clipped word, a lone numeral from a neighboring sketch, or half of an unrelated arrow makes the crop invalid. Do not merely shave that edge if it would cut the target: instead select one smaller complete subdiagram from the original. The reason may claim that prose or equations were excluded only when no such fragment is visibly retained.",
    "Use tight visual padding. Do not expand merely to preserve blank space. Alt text must describe only the final retained visual in the requested language.",
    `Language: ${language}`,
    `Targets:\n${JSON.stringify(previews.map(({ candidate, current }, index) => ({
      targetId: candidate.targetId,
      originalImageIndex: index * 2,
      currentPreviewImageIndex: index * 2 + 1,
      currentCrop: current.crop,
      targetText: candidate.sourceTask,
      currentAlt: current.alt,
    })))}`,
  ].join("\n\n");
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isUsableCrop(crop: z.infer<typeof cropSchema>): boolean {
  return crop.x + crop.width <= 1000 &&
    crop.y + crop.height <= 1000 &&
    crop.width * crop.height <= 1_000_000;
}

export function reviewedCropForRendering(
  crop: z.infer<typeof cropSchema>,
): z.infer<typeof cropSchema> {
  // This exact normalized rectangle was returned by the last successful visual
  // review. Pixel conversion may not shrink, expand, or replace it afterward.
  return { ...crop };
}

function tokens(value: string): string[] {
  return normalize(value).split(/\s+/).filter((token) =>
    token.length >= 4 && !/^(?:dies|diese|eine|einer|einem|einen|sowie|from|that|with|this|will|werden|kann|oder|auch|angabe|aufgabe|beispiel|example|course|source|task|exercise|original|folie|folien|slide|slides|lecture|skript|theorie|theory|material|handout)$/.test(token)
  );
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const matches = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return matches / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function matchingQueryTokens(text: string, query: string): number {
  const normalizedText = normalize(text);
  return [...new Set(tokens(query))].filter((token) =>
    normalizedText.includes(token)
  ).length;
}

function visualCueScore(value: string): number {
  return (value.match(
    /\b(?:skizze|diagramm|darstell|abbild|grafik|graph|zeichnung|querschnitt|tabelle|kennlinie|schema|map|figure|illustration|chart|plot|shown|pictured)\w*/gi,
  ) ?? []).length * 8;
}

async function readPlan(filePath: string): Promise<z.infer<typeof planSchema> | null> {
  try {
    return planSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

function coversTargets(
  items: Array<{ targetId: string }>,
  candidates: Candidate[],
): boolean {
  const ids = new Set(items.map((item) => item.targetId));
  return candidates.every((candidate) => ids.has(candidate.targetId));
}

function assertExactCoverage(
  items: Array<{ targetId: string }>,
  candidates: Candidate[],
): void {
  const expected = candidates.map((candidate) => candidate.targetId).sort();
  const actual = items.map((item) => item.targetId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Learning visual plan did not cover the exact candidate set.");
  }
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function safeStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 72) || "learning-visual";
}

async function persist(runDir: string, result: LearningVisualSet): Promise<void> {
  await writeFile(
    path.join(runDir, "learning-visuals.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}
