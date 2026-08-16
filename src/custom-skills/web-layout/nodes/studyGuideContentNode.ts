import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { normalizeStudyGuideNavigationTitles, studyGuideContentJsonSchema, studyGuideContentSchema, validateStudyGuideChapterQuality, validateStudyGuideContentQuality, type StudyGuideContent, type StudyGuideEvidenceRef } from "../studyGuideContent.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import { deriveStudyGuideRequirements, handoffSourceRegistry, knownHandoffSourceUrls, readExtractionHandoff, type StudyGuideRequirements } from "../studyGuideProfile.js";
import { balancedExcerpt } from "../modelText.js";
import { buildAdaptiveStudyModel, buildCourseBlueprint } from "../adaptiveStudyModel.js";
import { resolveAssessmentArchitecturePlan } from "../assessmentArchitecturePlan.js";
import { resolveAssessmentSolutions } from "../assessmentSolutions.js";
import { resolveLearningVisuals } from "../learningVisuals.js";
import { buildQuestionEvidenceCapsule, rejectedQuestionBankItems, resolvePlainSourceFileSections, resolveQuestionBankReviews } from "../questionBankReview.js";
import { hashRequestContract } from "../../shared/requestContract.js";
import { resolveLearningProgressionPlan } from "../learningProgressionPlan.js";
import { applyQuestionBankDrops, planQuestionBankDispositions } from "../questionBankDisposition.js";
import { applyQuestionBankItemRepairs, resolveQuestionBankItemRepairBatch } from "../questionBankItemRepair.js";

interface StudyGuideChunkPlan {
  chunk: { title: string; evidence: string };
  index: number;
}

const MAX_ITEM_REPAIR_ROUNDS = 3;

export function createStudyGuideContentNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function studyGuideContentNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (config.kind !== "study-guide") return { study_guide_content: {}, error_log: null };
    try {
      const requirements = deriveStudyGuideRequirements(state.source_text);
      const parsed = await buildChunkedModelContent(config, codex, state, requirements);
      const issues = [...validateStudyGuideContentQuality(parsed, requirements), ...validateSourceRegistry(parsed, state.source_text)];
      if (issues.length > 0) {
        throw new Error(issues.join("\n- "));
      }
      await writeFile(path.join(config.runDir, "study-guide-content.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      const adaptive = await persistAdaptiveStudyModel(
        config,
        codex,
        parsed,
        state.source_text,
        state.request_contract,
        state.error_log,
      );
      await config.diagnostics?.log("info", "planner", `Validated study-guide content bank with ${parsed.topics.length} topics and ${parsed.topics.flatMap((topic) => topic.exercises).length} exercises.`);
      return {
        study_guide_content: parsed as unknown as JsonObject,
        ...adaptive,
        error_log: null,
      };
    } catch (error) {
      const message = `Study-guide content builder failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "planner", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        content_retry_count: state.content_retry_count + 1,
      };
    }
  };
}

async function persistAdaptiveStudyModel(
  config: WebLayoutRuntimeConfig,
  codex: CodexClient,
  content: StudyGuideContent,
  sourceText: string,
  requestContract: LangGraphWebLayoutState["request_contract"],
  priorError: string | null,
): Promise<Pick<LangGraphWebLayoutState, "course_blueprint" | "assessment_blueprint" | "question_bank">> {
  for (let localRepairAttempt = 0; localRepairAttempt < MAX_ITEM_REPAIR_ROUNDS; localRepairAttempt += 1) {
  const requestContractHash = hashRequestContract(requestContract);
  const structuralCourse = buildCourseBlueprint(content, sourceText, config.language);
  const assessmentPlan = await resolveAssessmentArchitecturePlan({
    config,
    codex,
    requestContract,
    requestContractHash,
    sourceText,
    course: structuralCourse,
    priorError,
  });
  const neutralDraft = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    assessmentPlan,
  );
  const solutions = await resolveAssessmentSolutions({
    config,
    codex,
    content,
    sourceText,
    model: neutralDraft,
    priorError,
    originalUserPrompt: config.originalUserPrompt,
    requestContract,
    requestContractHash,
  });
  const solvedNeutralDraft = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    solutions,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    assessmentPlan,
  );
  const progressionPlan = await resolveLearningProgressionPlan({
    config,
    codex,
    sourceText,
    questionBank: solvedNeutralDraft.questionBank,
    requestContract,
  });
  const progressionBinding = {
    originalUserPrompt: config.originalUserPrompt,
    requestContract,
  };
  const solvedDraft = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    solutions,
    undefined,
    undefined,
    undefined,
    progressionPlan,
    progressionBinding,
    assessmentPlan,
  );
  const learningVisuals = await resolveLearningVisuals({
    config,
    codex,
    content,
    sourceText,
    model: solvedDraft,
    originalUserPrompt: config.originalUserPrompt,
    requestContract,
    requestContractHash,
  });
  const model = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    solutions,
    learningVisuals,
    undefined,
    undefined,
    progressionPlan,
    progressionBinding,
    assessmentPlan,
  );
  let reviews = await resolveQuestionBankReviews({
    config,
    codex,
    content,
    sourceText,
    questionBank: model.questionBank,
    requestContract,
    priorError,
    allowRejected: true,
  });
  let dispositions = planQuestionBankDispositions({
    questionBank: model.questionBank,
    reviews,
    assessmentBlueprint: model.assessmentBlueprint,
    requestContract,
  });
  await writeFile(
    path.join(config.runDir, "question-bank-dispositions.json"),
    `${JSON.stringify(dispositions, null, 2)}\n`,
    "utf8",
  );
  const evidenceRebuilds = dispositions.items.filter((item) => item.action === "rebuild_evidence");
  if (evidenceRebuilds.length > 0) {
    const itemIds = evidenceRebuilds.map((entry) => entry.itemId);
    const before = evidenceRebuilds.map((entry) => {
      const item = model.questionBank.items.find((candidate) =>
        candidate.id === entry.itemId && candidate.contentHash === entry.contentHash
      );
      const record = reviews.records.find((candidate) => candidate.recordId === entry.reviewRecordId);
      if (!item || !record) throw new Error(`Evidence-capsule rebuild lost exact item/review binding for ${entry.itemId}.`);
      return {
        itemId: item.id,
        contentHash: item.contentHash,
        previousVerdict: record.reviewer.verdict,
        capsule: buildQuestionEvidenceCapsule(sourceText, item),
      };
    });
    await config.diagnostics?.log(
      "info",
      "planner",
      `Rebuilding evidence capsules and re-reviewing ${itemIds.length} unchanged question-bank item(s).`,
    );
    const refreshed = await resolveQuestionBankReviews({
      config,
      codex,
      content,
      sourceText,
      questionBank: model.questionBank,
      requestContract,
      priorError: "Evidence capsule was unavailable. Re-evaluate only the unchanged item against its rebuilt local capsule.",
      allowRejected: true,
      forceEvidenceRebuildItemIds: itemIds,
    });
    const after = before.map((entry) => {
      const record = refreshed.records.find((candidate) =>
        candidate.itemId === entry.itemId && candidate.contentHash === entry.contentHash
      );
      if (!record) throw new Error(`Evidence-capsule re-review omitted unchanged item ${entry.itemId}.`);
      return {
        ...entry,
        refreshedVerdict: record.reviewer.verdict,
        refreshedRecordId: record.recordId,
      };
    });
    await writeFile(
      path.join(config.runDir, "question-bank-evidence-diagnostics.json"),
      `${JSON.stringify({ schemaVersion: 1, status: after.some((entry) => entry.refreshedVerdict === "evidence_unavailable") ? "failed" : "resolved", items: after }, null, 2)}\n`,
      "utf8",
    );
    const stillUnavailable = after.filter((entry) => entry.refreshedVerdict === "evidence_unavailable");
    if (stillUnavailable.length > 0) {
      const reasons = [...new Set(stillUnavailable.map((entry) =>
        entry.capsule.status === "evidence_unavailable" ? entry.capsule.reason : "Reviewer could not verify the rebuilt capsule."
      ))];
      throw new Error(
        `Evidence capsule remains unavailable after one exact same-item rebuild/review for: ${stillUnavailable.map((entry) => entry.itemId).join(", ")}. ` +
        `Diagnostic: ${reasons.join(" | ")} The affected items remain unpublished; repair the extraction/evidence handoff instead of changing their content.`,
      );
    }
    reviews = refreshed;
    dispositions = planQuestionBankDispositions({
      questionBank: model.questionBank,
      reviews,
      assessmentBlueprint: model.assessmentBlueprint,
      requestContract,
    });
    await writeFile(
      path.join(config.runDir, "question-bank-dispositions.json"),
      `${JSON.stringify(dispositions, null, 2)}\n`,
      "utf8",
    );
  }
  const repairBatch = dispositions.items
    .filter((item) => item.action === "repair");
  if (repairBatch.length > 0) {
    await config.diagnostics?.log(
      "info",
      "planner",
      `Repairing ${repairBatch.length} rejected question-bank item(s) in bounded local batch ${localRepairAttempt + 1}/${MAX_ITEM_REPAIR_ROUNDS}.`,
    );
    const pending = repairBatch.map((repair) => {
      const item = model.questionBank.items.find((candidate) =>
        candidate.id === repair.itemId && candidate.contentHash === repair.contentHash
      );
      const review = reviews.records.find((candidate) => candidate.recordId === repair.reviewRecordId);
      if (!item || !review) throw new Error(`Item-local question repair lost exact item/review binding for ${repair.itemId}.`);
      return { item, review };
    });
    const repairs = await resolveQuestionBankItemRepairBatch({
      config,
      codex,
      content,
      sourceText,
      requestContract,
      targets: pending,
    });
    const repaired = applyQuestionBankItemRepairs(
      content,
      repairs,
    );
    Object.assign(content, repaired);
    await writeFile(path.join(config.runDir, "study-guide-content.json"), `${JSON.stringify(content, null, 2)}\n`, "utf8");
    priorError = `Item-local question repair batch produced new hashes for ${pending.map(({ item }) => item.id).join(", ")}; review only those replacements.`;
    continue;
  }
  const reviewedModel = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    solutions,
    learningVisuals,
    reviews,
    { originalUserPrompt: config.originalUserPrompt, requestContract },
    progressionPlan,
    progressionBinding,
    assessmentPlan,
  );
  const publishedQuestionBank = applyQuestionBankDrops(reviewedModel.questionBank, dispositions);
  const stillRejected = rejectedQuestionBankItems(publishedQuestionBank, reviews);
  if (stillRejected.length > 0) {
    throw new Error(`Question-bank disposition left ${stillRejected.length} unapproved item(s) in the publication bank.`);
  }
  await Promise.all([
    writeFile(path.join(config.runDir, "course-blueprint.json"), `${JSON.stringify(reviewedModel.courseBlueprint, null, 2)}\n`, "utf8"),
    writeFile(path.join(config.runDir, "assessment-blueprint.json"), `${JSON.stringify(reviewedModel.assessmentBlueprint, null, 2)}\n`, "utf8"),
    writeFile(path.join(config.runDir, "question-bank.json"), `${JSON.stringify(publishedQuestionBank, null, 2)}\n`, "utf8"),
  ]);
  return {
    course_blueprint: reviewedModel.courseBlueprint as unknown as JsonObject,
    assessment_blueprint: reviewedModel.assessmentBlueprint as unknown as JsonObject,
    question_bank: publishedQuestionBank as unknown as JsonObject,
  };
  }
  throw new Error(
    `Item-local question repair exhausted ${MAX_ITEM_REPAIR_ROUNDS} bounded semantic rounds without a publishable bank.`,
  );
}

async function buildChunkedModelContent(
  config: WebLayoutRuntimeConfig,
  codex: CodexClient,
  state: LangGraphWebLayoutState,
  requirements: StudyGuideRequirements,
): Promise<StudyGuideContent> {
  const chunks = buildEvidenceChunks(state.source_text, requirements);
  const plans: StudyGuideChunkPlan[] = chunks.map((chunk, index) => ({ chunk, index }));
  const batchSize = webContentBatchSize();
  const chapterContent: Array<StudyGuideContent | undefined> = new Array(plans.length);
  const pendingPlans: StudyGuideChunkPlan[] = [];
  for (const plan of plans) {
    const chunkPath = path.join(config.runDir, `study-guide-content-chunk-${plan.index + 1}.json`);
    const sharedPath = sharedChunkCachePath(config, requirements, plan, state.request_contract);
    const local = await readCachedChunk(chunkPath);
    const value = local ?? await readCachedChunk(sharedPath);
    const reboundRefs = value ? bindStudyGuideEvidenceRefs(value, state.source_text) : 0;
    const cachedQualityIssues = value
      ? validateStudyGuideChapterQuality(value, requirements)
      : [];
    if (local && reboundRefs > 0 && cachedQualityIssues.length === 0) {
      await writeFile(chunkPath, `${JSON.stringify(local, null, 2)}\n`, "utf8");
    }
    if (local && cachedQualityIssues.length === 0 && process.env.VITEST !== "true") {
      await persistSharedChunk(sharedPath, local);
    }
    if (
      value &&
      cachedQualityIssues.length === 0 &&
      !chunkNeedsRepair(value, plan, state.error_log, state.question_bank)
    ) {
      chapterContent[plan.index] = value;
    } else {
      pendingPlans.push(plan);
    }
  }
  const selectedPendingPlans = pendingPlans;
  const effectiveBatchSize = state.error_log ? 1 : batchSize;
  const batches = Array.from(
    { length: Math.ceil(selectedPendingPlans.length / effectiveBatchSize) },
    (_, index) => selectedPendingPlans.slice(index * effectiveBatchSize, (index + 1) * effectiveBatchSize),
  );
  const concurrency = Math.min(webContentConcurrency(), batches.length);
  await config.diagnostics?.log(
    "info",
    "planner",
    `Building ${plans.length} evidence-bounded chapter(s): reusing ${plans.length - pendingPlans.length}, generating ${selectedPendingPlans.length} in ${batches.length} model batch(es) with concurrency ${concurrency}.`,
  );
  if (pendingPlans.length < plans.length) {
    await config.diagnostics?.log(
      "info",
      "planner",
      `Reusing validated chapters: ${plans.filter((plan) => chapterContent[plan.index]).map((plan) => plan.chunk.title).join(" · ")}`,
    );
  }
  await mapWithConcurrency(batches, concurrency, async (batch) => {
    await config.diagnostics?.log(
      "info",
      "planner",
      `Generating grounded content batch: ${batch.map((plan) => plan.chunk.title).join(" · ")}`,
    );
    let response: string;
    try {
      response = await codex.run(
        buildStudyGuideBatchPrompt(config, state, requirements, batch, chunks.length),
        {
          outputSchema: studyGuideContentJsonSchema,
          task: state.error_log ? "content_repair" : "content_analyzer",
          // content_retry_count counts failed node passes. The first pass that
          // switches from analysis to the dedicated repair task is therefore
          // attempt 1 for that task, not its escalated attempt 2.
          attempt: state.error_log ? Math.max(1, state.content_retry_count) : 1,
          timeoutMs: batch.length > 1 ? 180_000 : undefined,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Timeouts never change admission semantics. The previous chunk remains
      // cached for a later item-local repair, but hard schema, source, answer,
      // and correctness findings cannot become publishable through a marker.
      throw error;
    }
    const generated = normalizeDerivedSourceTasks(
      studyGuideContentSchema.parse(normalizeModelContent(JSON.parse(stripJsonFence(response)))),
    );
    const repairedNavigationTitles = normalizeStudyGuideNavigationTitles(generated);
    if (repairedNavigationTitles > 0) {
      await config.diagnostics?.log(
        "info",
        "planner",
        `Normalized ${repairedNavigationTitles} learner-facing navigation label(s) from their course-faithful chapter titles without regenerating content.`,
      );
    }
    bindStudyGuideEvidenceRefs(generated, state.source_text);
    normalizeSourceReferences(generated);
    const alignedTopics = alignGeneratedBatchTopics(
      generated.topics,
      batch.map((plan) => plan.chunk.title),
    );
    if (!alignedTopics) {
      throw new Error(`Content batch returned ${generated.topics.length} topics instead of exactly ${batch.length}.`);
    }
    if (alignedTopics.droppedTitles.length > 0) {
      await config.diagnostics?.log(
        "warn",
        "planner",
        `Ignored ${alignedTopics.droppedTitles.length} unsolicited topic(s) after preserving every exact planned chapter.`,
        { droppedTitles: alignedTopics.droppedTitles },
      );
    }
    const split = alignedTopics.topics.map((topic) => studyGuideContentSchema.parse({
      courseTitle: generated.courseTitle,
      courseCode: generated.courseCode,
      scopeNote: generated.scopeNote,
      topics: [topic],
      sources: generated.sources,
    }));
    const invalidChapters = split.flatMap((chunk, batchIndex) => {
      const issues = validateStudyGuideChapterQuality(chunk, requirements);
      return issues.length > 0
        ? [{ title: batch[batchIndex]!.chunk.title, issues }]
        : [];
    });
    const validChunks = split.flatMap((chunk, batchIndex) =>
      invalidChapters.some((invalid) => invalid.title === batch[batchIndex]!.chunk.title)
        ? []
        : [{ chunk, batchIndex }]
    );
    await Promise.all(validChunks.flatMap(({ chunk, batchIndex }) => {
      const serialized = `${JSON.stringify(chunk, null, 2)}\n`;
      const sharedPath = sharedChunkCachePath(config, requirements, batch[batchIndex], state.request_contract);
      return [
        writeFile(
          path.join(config.runDir, `study-guide-content-chunk-${batch[batchIndex].index + 1}.json`),
          serialized,
          "utf8",
        ),
        ...(process.env.VITEST === "true"
          ? []
          : [persistSharedChunk(sharedPath, chunk)]),
      ];
    }));
    validChunks.forEach(({ chunk, batchIndex }) => {
      chapterContent[batch[batchIndex]!.index] = chunk;
    });
    if (invalidChapters.length > 0) {
      throw new Error(invalidChapters.map(({ title, issues }) =>
        `[chapter: ${title}] ${issues.join("\n- ")}`
      ).join("\n"));
    }
  });
  if (chapterContent.some((chunk) => !chunk)) {
    throw new Error("Content generation completed without a chapter result for every evidence chunk.");
  }
  const resolvedChapterContent = (chapterContent as StudyGuideContent[]).map((chunk) => {
    normalizeSourceReferences(chunk);
    return chunk;
  });
  const topics = resolvedChapterContent.map((chunk) => chunk.topics[0]);
  const sources = resolvedChapterContent.flatMap((chunk) => chunk.sources);
  const notes = resolvedChapterContent.map((chunk) => chunk.scopeNote);
  const aggregate = studyGuideContentSchema.parse({
    courseTitle: requirements.courseTitle,
    courseCode: requirements.courseCode,
    scopeNote: [...new Set(notes)].join(" "),
    topics,
    sources: deduplicateSources(sources),
  });
  normalizeAggregateIdentity(aggregate);
  normalizeFormulaNotation(aggregate);
  bindStudyGuideEvidenceRefs(aggregate, state.source_text);
  normalizeSourceReferences(aggregate);
  return hydrateSourceUrls(normalizeDerivedSourceTasks(aggregate), state.source_text);
}

/**
 * Models see one bounded chapter at a time, so a model-provided sectionIndex is
 * necessarily chapter-local and is not a trusted global handoff coordinate.
 * Bind it deterministically from the exact section heading and source IDs after
 * generation. Learning-goal indexes remain topic-local by design.
 */
export function bindStudyGuideEvidenceRefs(content: StudyGuideContent, sourceText: string): number {
  const sections = readExtractionHandoff(sourceText)?.sections ?? [];
  const plainSourceSections = resolvePlainSourceFileSections(sourceText);
  if (sections.length === 0 && plainSourceSections.length === 0) return 0;
  let rebound = 0;
  const referencedSourceCoverage = new Map<string, Set<string>>();
  const plainSourceAliases = new Map<string, string>();
  const bind = (ref: StudyGuideEvidenceRef): void => {
    for (const sourceId of ref.sourceIds) {
      const coverage = referencedSourceCoverage.get(sourceId) ?? new Set<string>();
      coverage.add(ref.sectionHeading.trim());
      referencedSourceCoverage.set(sourceId, coverage);
    }
    const handoffMatches = sections.flatMap((section, sectionIndex) => {
      const heading = typeof section.heading === "string" ? section.heading.trim() : "";
      const sourceIds = Array.isArray(section.source_ids) ? section.source_ids.map(String) : [];
      return heading === ref.sectionHeading.trim() && ref.sourceIds.every((id) => sourceIds.includes(id))
        ? [sectionIndex]
        : [];
    });
    if (handoffMatches.length === 1) {
      if (ref.sectionIndex !== handoffMatches[0]) {
        ref.sectionIndex = handoffMatches[0]!;
        rebound += 1;
      }
      return;
    }
    const plainMatches = plainSourceSections.filter((section) =>
      section.heading === ref.sectionHeading.trim()
    );
    const refSources = ref.sourceIds.map((sourceId) =>
      content.sources.find((source) => source.id === sourceId)
    );
    const refsDescribePlainHeading = refSources.length > 0 && refSources.every((source) =>
      source && !source.url && source.label.trim() === ref.sectionHeading.trim()
    );
    if (plainMatches.length !== 1 || !refsDescribePlainHeading) return;
    const match = plainMatches[0]!;
    const canonicalSourceId = match.sourceIds[0];
    if (!canonicalSourceId) return;
    const priorSourceIds = [...ref.sourceIds];
    priorSourceIds.forEach((sourceId) => plainSourceAliases.set(sourceId, canonicalSourceId));
    if (ref.sectionIndex !== match.sectionIndex ||
      ref.sourceIds.length !== 1 || ref.sourceIds[0] !== canonicalSourceId) {
      ref.sectionIndex = match.sectionIndex;
      ref.sourceIds = [canonicalSourceId];
      rebound += 1;
    }
  };
  for (const topic of content.topics) {
    for (const ref of topic.evidenceRefs ?? []) bind(ref);
    for (const exercise of topic.exercises) {
      for (const ref of exercise.evidenceRefs ?? []) bind(ref);
    }
    for (const retrieval of topic.retrieval) {
      for (const ref of retrieval.evidenceRefs ?? []) bind(ref);
    }
  }
  for (const source of content.sources) {
    const canonicalSourceId = plainSourceAliases.get(source.id);
    if (canonicalSourceId && source.id !== canonicalSourceId) {
      source.id = canonicalSourceId;
      rebound += 1;
    }
  }
  const presentSourceIds = new Set(content.sources.map((source) => source.id));
  for (const source of handoffSourceRegistry(sourceText)) {
    if (!source.id || presentSourceIds.has(source.id) || !referencedSourceCoverage.has(source.id)) continue;
    content.sources.push({
      id: source.id,
      label: source.label,
      url: source.url,
      coverage: [...referencedSourceCoverage.get(source.id)!].filter(Boolean).join(" · "),
    });
    presentSourceIds.add(source.id);
    rebound += 1;
  }
  return rebound;
}

/**
 * A schema-conformant response can append an unsolicited topic to a batch.
 * Retain the response without a repair call only when every planned chapter is
 * present once by exact normalized title. Missing, renamed, or ambiguous
 * chapters still use the selective repair path.
 */
export function alignGeneratedBatchTopics<T extends { title: string }>(
  topics: T[],
  expectedTitles: string[],
): { topics: T[]; droppedTitles: string[] } | null {
  if (topics.length < expectedTitles.length) return null;
  const unused = new Set(topics.map((_, index) => index));
  const aligned: T[] = [];
  for (const expectedTitle of expectedTitles) {
    const key = normalizedTopicTitle(expectedTitle);
    const matches = [...unused].filter((index) =>
      normalizedTopicTitle(topics[index]!.title) === key
    );
    if (matches.length !== 1) return null;
    const index = matches[0]!;
    unused.delete(index);
    aligned.push(topics[index]!);
  }
  return {
    topics: aligned,
    droppedTitles: [...unused].map((index) => topics[index]!.title),
  };
}

function normalizedTopicTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function webContentConcurrency(): number {
  const configured = Number(process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY ?? 3);
  if (!Number.isFinite(configured)) return 3;
  return Math.min(4, Math.max(1, Math.floor(configured)));
}

function webContentBatchSize(): number {
  if (process.env.WEB_LAYOUT_TEST_CODEX === "1" || process.env.VITEST === "true") return 1;
  const configured = Number(process.env.STUDY_BUDDY_WEB_CONTENT_BATCH_SIZE ?? 2);
  if (!Number.isFinite(configured)) return 2;
  return Math.min(3, Math.max(1, Math.floor(configured)));
}

function sharedChunkCachePath(
  config: WebLayoutRuntimeConfig,
  requirements: StudyGuideRequirements,
  plan: StudyGuideChunkPlan,
  requestContract: LangGraphWebLayoutState["request_contract"],
): string {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    version: "study-guide-content-v7-visual-practice-evidence",
    language: config.language,
    courseCode: requirements.courseCode,
    title: plan.chunk.title,
    evidence: plan.chunk.evidence,
    requestContract,
  })).digest("hex");
  return path.join(
    process.cwd(),
    "study-buddy-data",
    "cache",
    "web-layout",
    "study-guide-chunks",
    `${fingerprint}.json`,
  );
}

async function persistSharedChunk(cachePath: string, content: StudyGuideContent): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  work: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await work(values[index]);
    }
  }
  // Do not fail fast while sibling model calls are still active. Successful
  // siblings persist validated chunks that the next graph retry can reuse;
  // waiting for every worker also prevents overlapping orphan calls and the
  // duplicate token spend they caused in the former Promise.all path.
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
  return results;
}

async function readCachedChunk(chunkPath: string): Promise<StudyGuideContent | null> {
  try {
    return studyGuideContentSchema.parse(JSON.parse(await readFile(chunkPath, "utf8")));
  } catch {
    return null;
  }
}

export function chunkNeedsRepair(
  chunk: StudyGuideContent,
  plan: StudyGuideChunkPlan,
  errorLog: string | null,
  questionBank: JsonObject = {},
): boolean {
  if (chunk.topics.length !== 1) return true;
  if (!errorLog) return false;
  if (/question[- ]bank item review|item-local question repair|assessment-owned item|does not own generated item|question-bank disposition|evidence[- ]capsule|evidence capsule remains unavailable/i.test(errorLog)) return false;
  if (new RegExp(`chunk\\s+${plan.index + 1}\\b`, "i").test(errorLog)) return true;
  const taggedChapters = [...errorLog.matchAll(/\[chapter:\s*([^\]]+)\]/gi)]
    .map((match) => normalizedTopicTitle(match[1] ?? ""));
  if (taggedChapters.includes(normalizedTopicTitle(plan.chunk.title))) return true;
  const localTargets = itemLocalRepairTargets(errorLog, questionBank);
  if (localTargets.hasItemDiagnostics) {
    return chunk.topics.some((topic) => {
      const topicIds = [topic.id, normalizedTopicTitle(topic.title)];
      if (topicIds.some((id) => localTargets.topicIds.has(id))) return true;
      return topic.exercises.some((exercise) =>
        localTargets.exerciseIds.has(exercise.id) ||
        topicIds.some((topicId) => localTargets.exerciseIds.has(`${topicId}-${exercise.id}`)) ||
        localTargets.exerciseIds.has(`${topic.id}-${exercise.id}`) ||
        [...localTargets.exerciseIds].some((exerciseId) =>
          exerciseId.startsWith(`${topic.id}-`)
        )
      );
    });
  }
  const globalFinding = /Expected (?:evidence-adaptive|at least)|dropped all of them|not present in the validated Moodle handoff/i;
  if (globalFinding.test(errorLog)) return true;
  const identifiers = [plan.chunk.title, ...chunk.topics.flatMap((topic) => [
    topic.id,
    topic.title,
    ...topic.exercises.map((exercise) => exercise.id),
  ])].filter((value) => value.length >= 3);
  return identifiers.some((identifier) => errorLog.toLocaleLowerCase().includes(identifier.toLocaleLowerCase()));
}

function itemLocalRepairTargets(
  errorLog: string,
  questionBank: JsonObject,
): { hasItemDiagnostics: boolean; itemIds: Set<string>; exerciseIds: Set<string>; topicIds: Set<string> } {
  const itemIds = new Set<string>();
  const exerciseIds = new Set<string>();
  for (const match of errorLog.matchAll(/\[item\s+([^;\]]+);\s*exercise\s+([^;\]]+)(?:;|\])/gi)) {
    if (match[1]?.trim()) itemIds.add(match[1].trim());
    if (match[2]?.trim()) exerciseIds.add(match[2].trim());
  }
  for (const match of errorLog.matchAll(/["']itemId["']\s*[:=]\s*["']([^"']+)["']/gi)) {
    if (match[1]?.trim()) itemIds.add(match[1].trim());
  }
  for (const match of errorLog.matchAll(/["']legacyExerciseId["']\s*[:=]\s*["']([^"']+)["']/gi)) {
    if (match[1]?.trim()) exerciseIds.add(match[1].trim());
  }
  const topicIds = new Set<string>();
  const items = Array.isArray(questionBank.items) ? questionBank.items : [];
  for (const value of items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !itemIds.has(item.id)) continue;
    if (typeof item.legacyExerciseId === "string") exerciseIds.add(item.legacyExerciseId);
    if (typeof item.topicId === "string") topicIds.add(item.topicId);
    const scopeBasis = item.scopeBasis;
    if (scopeBasis && typeof scopeBasis === "object" && !Array.isArray(scopeBasis)) {
      const title = (scopeBasis as Record<string, unknown>).topicTitle;
      if (typeof title === "string") topicIds.add(normalizedTopicTitle(title));
    }
  }
  return {
    hasItemDiagnostics: itemIds.size > 0 || exerciseIds.size > 0,
    itemIds,
    exerciseIds,
    topicIds,
  };
}

function normalizeDerivedSourceTasks(content: StudyGuideContent): StudyGuideContent {
  const normalize = (source: StudyGuideContent["topics"][number]["workedExamples"][number]["source"]) => {
    if (source.provenance === "derived" && !/^Abgeleitet aus Quelle\b/i.test(source.sourceTask)) {
      source.sourceTask = `Abgeleitet aus Quelle ${source.label}: ${source.sourceTask}`;
    }
    return source;
  };
  for (const topic of content.topics) {
    for (const example of topic.workedExamples) normalize(example.source);
    for (const exercise of topic.exercises) normalize(exercise.source);
  }
  return content;
}

function normalizeAggregateIdentity(content: StudyGuideContent): void {
  const usedTopicIds = new Set<string>();
  const usedExerciseIds = new Set<string>();
  const usedPrompts = new Set<string>();
  for (const [topicIndex, topic] of content.topics.entries()) {
    topic.id = uniqueIdentifier(topic.id, `topic-${topicIndex + 1}`, usedTopicIds);
    for (const [exerciseIndex, exercise] of topic.exercises.entries()) {
      exercise.id = uniqueIdentifier(
        `${topic.id}-${exercise.id}`,
        `${topic.id}-exercise-${exerciseIndex + 1}`,
        usedExerciseIds,
      );
      const promptKey = exercise.prompt.trim().toLocaleLowerCase();
      if (usedPrompts.has(promptKey)) {
        const base = `${exercise.prompt.replace(/[.\s]+$/, "")} — ${topic.title}`;
        let candidate = `${base}.`;
        let suffix = 2;
        while (usedPrompts.has(candidate.trim().toLocaleLowerCase())) {
          candidate = `${base} (${suffix}).`;
          suffix += 1;
        }
        exercise.prompt = candidate;
      }
      usedPrompts.add(exercise.prompt.trim().toLocaleLowerCase());
    }
  }
}

function uniqueIdentifier(value: string, fallback: string, used: Set<string>): string {
  const base = value.trim().replace(/\s+/g, "-") || fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function normalizeSourceReferences(content: StudyGuideContent): void {
  const sourceLabels = content.sources.map((source) => source.label);
  const exactLabels = new Map(sourceLabels.map((label) => [label.toLocaleLowerCase(), label]));
  const normalize = (
    reference: StudyGuideContent["topics"][number]["workedExamples"][number]["source"],
    topic: StudyGuideContent["topics"][number],
  ) => {
    if (exactLabels.has(reference.label.toLocaleLowerCase())) {
      reference.label = exactLabels.get(reference.label.toLocaleLowerCase())!;
      return;
    }
    const segments = reference.label.split(/\s*[;|]\s*/).filter(Boolean);
    const exactSegment = segments
      .map((segment) => exactLabels.get(segment.toLocaleLowerCase()))
      .find((label): label is string => Boolean(label));
    const fuzzy = sourceLabels.find((label) =>
      labelsOverlap(normalizeSourceKey(reference.label), normalizeSourceKey(label))
    );
    const candidates = content.sources.filter((source) => !isGenericCoursePageLabel(source.label));
    const referenceCorpus = `${topic.title} ${topic.navigationTitle ?? ""} ${reference.sourceTask}`;
    const ranked = candidates
      .map((source, index) => ({
        label: source.label,
        index,
        score: sourceReferenceMatchScore(referenceCorpus, source.label),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const topicShorthand = normalizeSourceKey(reference.label) === normalizeSourceKey(topic.title);
    const groundedFallback = ranked[0] && (ranked[0].score > 0 || topicShorthand)
      ? ranked[0].label
      : candidates.length === 1
        ? candidates[0]!.label
        : undefined;
    const replacement = exactSegment ?? fuzzy ?? groundedFallback;
    if (replacement) reference.label = replacement;
  };
  for (const topic of content.topics) {
    for (const example of topic.workedExamples) normalize(example.source, topic);
    for (const exercise of topic.exercises) normalize(exercise.source, topic);
  }
}

function isGenericCoursePageLabel(label: string): boolean {
  return /^(?:bl(?:ö|o)cke|blocks?|moodle\s+course\s+page|course\s+page)$/iu.test(label.trim());
}

function sourceReferenceMatchScore(referenceCorpus: string, sourceLabel: string): number {
  const tokens = (value: string) => new Set(
    value
      .normalize("NFKD")
      .toLocaleLowerCase()
      .match(/[a-z0-9]{3,}/g) ?? [],
  );
  const referenceTokens = tokens(referenceCorpus);
  return [...tokens(sourceLabel)].reduce(
    (score, token) => score + (referenceTokens.has(token) ? token.length : 0),
    0,
  );
}

function normalizeFormulaNotation(content: StudyGuideContent): void {
  for (const topic of content.topics) {
    for (const formula of topic.theory.formulas) {
      formula.expression = formula.expression.replace(
        /\b([A-Za-z])([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{2,})\b/g,
        "$1_$2",
      );
    }
  }
}

function buildStudyGuideBatchPrompt(
  config: WebLayoutRuntimeConfig,
  state: Pick<LangGraphWebLayoutState, "error_log" | "request_contract">,
  requirements: StudyGuideRequirements,
  batch: StudyGuideChunkPlan[],
  total: number,
): string {
  return [
    `Build ${batch.length} source-grounded chapter${batch.length === 1 ? "" : "s"} for the canonical Study Buddy content bank. Return JSON only.`,
    "This is a bounded content transformation. Do not use tools, inspect files, browse, or discuss UI implementation.",
    "Let the evaluated request contract and chapter evidence determine theory depth, learning activities, examples, retrieval, formulas, and quantity. Do not pad a chapter or satisfy a fixed component/type quota. Optional arrays may be empty.",
    "Keep title exactly course-faithful. Also provide navigationTitle as a concise learner-facing label of 2–7 meaningful words and at most 64 characters. Remove scheduling wrappers such as chapter numbers, Self-Study, Class, Week, or Part, but retain the concepts that distinguish this module from its neighbors. It must work as a standalone navigation label; never truncate a word or add generic labels such as Topic or Module.",
    "Use cross exercises for concrete misconception, comparison, classification, or sequencing checks. Use calculation exercises only when the evidence supplies a real quantitative method and necessary quantities.",
    "Every exercise must be self-contained on its visible learner card. Include the complete situation, stimulus, data, assumptions, target, options, and response instruction needed to answer it. Never refer to 'the example in the chapter', 'the summary above', a hidden list, an unseen video, or other context that is not embedded in that item. Longer task statements are preferable to missing information.",
    "Use application exercises for open case analysis, source interpretation, writing, speaking, laboratory procedures, design decisions, or other work that cannot be assessed honestly as multiple choice. Each application needs executable instructions, a useful sample answer, and specific self-check criteria.",
    "Estimate realistic focused solving time for every exercise in estimatedMinutes. A recognition check may take only a few minutes, while a complete multi-step calculation or transfer task may take substantially longer. Use effort to represent depth; do not split one coherent long task into filler merely to inflate item count.",
    "Inventory every distinct concrete exercise, quiz task, worked example, and sample-exam task present in this chapter evidence before creating variants. Preserve every useful nonredundant source task as an exercise when its complete statement can be represented. Then add Study Buddy variants only where evidenced objectives, subskills, misconceptions, response modes, or transfer demands remain under-practised. One item per objective is not automatically sufficient, and equal per-chapter or per-type counts are forbidden.",
    "Visual practice evidence distinguishes complete_task from method_only. Only complete_task may become provenance=source. method_only proves a diagram, method, derivation, or difficulty pattern but not the missing original task; use it only to create an explicitly adapted, fully self-contained variant with safe complete values, or disclose that it could not support a useful item. Preserve its source page in sourceTask (for example 'Source title, Seite 2').",
    "Use vocabulary exercises only when terminology, expressions, a glossary, language functions, or a vocabulary assessment is evidenced. Each item must test one useful in-scope term or phrase through term-to-meaning, meaning-to-term, or a context gap. Give accepted answers, a natural course-relevant context sentence, and an explanation. Select productive vocabulary or terminology at the level and in the disciplinary context supported by the course. Do not turn chapter headings or generic placeholders into vocabulary items. When the evidence establishes a topic but does not expose a word list, Study Buddy may generate stable domain vocabulary inside that exact topic scope and must use provenance=derived.",
    "Use provenance=source for directly evidenced tasks, provenance=adapted for an evidenced parameter variation, and provenance=derived only for new practice synthesized from the named source concept. Every sourceTask must identify the concrete task, slide, script section, table procedure, formula, or worked example.",
    "For every topic, evidenceRefs.learningGoalIndexes are zero-based positions in that same topic's returned learningGoals array. This applies to topic, exercise, and retrieval refs; never use indexes from the source corpus, another chapter, or the aggregate course.",
    "Never invent course facts, constants, clinical/legal rules, exam scoring, or generic filler. A calculation prompt must contain complete givens, units, a derivable result, progressive solution steps, and a concrete common mistake.",
    "Formula expressions must be concise mathematical notation, never prose, HTML, MathML, TeX delimiters, or Typst markup. Leave formulas empty if this chapter has no meaningful formula.",
    "The flat Structured Output exercise object requires every field, including estimatedMinutes. Cross exercises fill selectionMode/options/explanation; calculation exercises fill givens/acceptedAnswers/unit/steps/commonMistake; application exercises fill instructions/sampleAnswer/selfCheck; vocabulary exercises fill direction/term/acceptedAnswers/context/explanation. Use direction=none, selectionMode=none, empty arrays, or empty strings for every field irrelevant to that type. Irrelevant fields are removed before internal validation.",
    "The sources array must include every source label cited by this chapter. Copy only HTTPS Moodle URLs present in the evidence; otherwise use an empty URL. Set courseCode and courseTitle exactly as stated above. scopeNote must be one concise, non-repetitive source-limit sentence for this chapter.",
    state.error_log?.startsWith("Study-guide content builder failed:") ? `Repair these prior validation findings where applicable:\n${state.error_log}` : "",
    `Return exactly ${batch.length} topics entries in the supplied chapter order. Do not merge or rename chapters.`,
    `Course: ${requirements.courseCode} · ${requirements.courseTitle}.`,
    `Language: ${config.language}`,
    `Exact original request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract, null, 2)}`,
    ...batch.flatMap((plan) => {
      return [
        `Chapter ${plan.index + 1}/${total}: ${plan.chunk.title}. Create only the nonredundant learning objects needed to cover the contract-relevant objectives supported by this chapter. If evidence is insufficient for a useful item, disclose the gap instead of manufacturing filler.`,
        `Validated evidence for chapter ${plan.index + 1} only:\n${balancedExcerpt(plan.chunk.evidence, 28_000)}`,
      ];
    }),
  ].filter(Boolean).join("\n\n");
}

export function buildEvidenceChunks(sourceText: string, requirements: StudyGuideRequirements): Array<{ title: string; evidence: string }> {
  const handoff = readExtractionHandoff(sourceText) as unknown as Record<string, unknown> | null;
  if (!handoff) return [{ title: requirements.sectionTitles[0] ?? requirements.courseTitle, evidence: sourceText.slice(0, 180_000) }];
  const sections = Array.isArray(handoff.sections) ? handoff.sections.filter(isRecord) : [];
  const moduleIdsByTitle = new Map(
    (Array.isArray(handoff.learning_modules) ? handoff.learning_modules : [])
      .filter(isRecord)
      .flatMap((module) =>
        typeof module.title === "string" && typeof module.id === "string"
          ? [[module.title, module.id] as const]
          : []
      ),
  );
  const groups = new Map<string, Record<string, unknown>[]>();
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const ids = stringArray(section.source_ids);
    const chapter = ids.map((id) => /(?:^|_)ch(\d+)(?:_|$)/i.exec(id)?.[1]).find(Boolean);
    const primarySource = ids[0]?.replace(/_res_[a-z0-9]+$/i, "");
    const sectionTitle = typeof section.heading === "string" ? section.heading : "";
    const moduleId = moduleIdsByTitle.get(sectionTitle);
    const key = moduleId
      ? `module-${moduleId}`
      : chapter
        ? `chapter-${chapter}`
        : primarySource || `section-${index + 1}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(section);
    groups.set(key, bucket);
  }
  const entries = [...groups.entries()];
  if (!entries.length) return [{ title: requirements.sectionTitles[0] ?? requirements.courseTitle, evidence: JSON.stringify(handoff) }];
  return entries.map(([key, group], index) => {
    const sourceIds = new Set(group.flatMap((item) => stringArray(item.source_ids)));
    const selectRelated = (name: string) => Array.isArray(handoff[name])
      ? (handoff[name] as unknown[]).filter((item) => isRecord(item) && stringArray(item.source_ids).some((id) => sourceIds.has(id)))
      : [];
    const relatedSources = Array.isArray(handoff.sources)
      ? (handoff.sources as unknown[]).filter((item) => isRecord(item) && typeof item.id === "string" && sourceIds.has(item.id))
      : [];
    const title = typeof group[0]?.heading === "string" ? group[0].heading : requirements.sectionTitles[index] ?? key;
    const evidence = {
      course: handoff.course,
      chapter_title: title,
      sections: group,
      formulas: selectRelated("formulas"),
      worked_examples: selectRelated("worked_examples"),
      quiz_style_questions: selectRelated("quiz_style_questions"),
      figures: selectRelated("figures"),
      sources: relatedSources,
      warnings: handoff.warnings,
    };
    return { title, evidence: JSON.stringify(evidence) };
  });
}

function deduplicateSources(sources: StudyGuideContent["sources"]): StudyGuideContent["sources"] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.id}\u0000${source.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function buildStudyGuideContentPrompt(config: WebLayoutRuntimeConfig, state: Pick<LangGraphWebLayoutState, "source_text" | "layout_spec" | "request_contract" | "error_log">): string {
  const requirements = deriveStudyGuideRequirements(state.source_text);
  return [
    "Build the canonical, source-grounded content bank for a Study Buddy study guide. Return JSON only.",
    "This is a content-analysis task, not a UI task. Do not describe layouts, controls, colors, or implementation.",
    "Extract concrete exercises from supplied quizzes, worksheets, assignments, and worked examples whenever they exist. Preserve their substance, quantities, conditions, and original question type.",
    "For every exercise, sourceTask must identify the concrete source task (for example 'Minitest 4, Aufgabe 7'), not merely a chapter.",
    "Use provenance=source only when the exercise is directly represented in the evidence. Use provenance=adapted for a deliberate parameter variation of an evidenced exercise pattern. Use provenance=derived for new practice synthesized from a concrete cited slide, script section, learning objective, case, diagram, or definition.",
    "When direct exercises are sparse, create useful derived practice instead of generic filler. Quantitative sources should yield fully specified worked calculations. Conceptual sources should yield comparison, sequencing, classification, explanation, and misconception checks. Case-based sources should yield realistic decisions or scenarios grounded in the supplied facts. Never invent course facts, clinical recommendations, legal rules, official scoring, or unsupported numerical constants.",
    "Treat sample exams, past papers, mock exams, and documented assessment formats as task evidence, not quiz trivia. Never create learner questions asking what topics an exam contains, how long it lasts, which aids are allowed, how its tasks are titled, or how many points it has. Use those facts only in the assessment blueprint and interface.",
    "When an authorized sample or past exam contains actual tasks, preserve those technical, conceptual, writing, language, case, or calculation tasks as assessment practice. When only an assessment format is documented, create realistic in-scope tasks that match the evidenced response modes and course objectives. Generated practice values are allowed when they are complete, internally consistent, safely solvable, and clearly part of a Study Buddy-generated variant rather than claimed as official course facts.",
    "Every derived sourceTask must name the concrete source concept, for example 'Abgeleitet aus Skript Kapitel 3: Lagerauswahl' or 'Abgeleitet aus Folie 18: Marktformen'. The source label must correspond to an entry in the source register.",
    "For every topic, evidenceRefs.learningGoalIndexes are zero-based positions in that same topic's returned learningGoals array. This applies to topic, exercise, and retrieval refs; never use indexes from the source corpus, another chapter, or the aggregate course.",
    "Never manufacture generic prompts such as 'Welche Aussage trifft zu?', 'Wähle alle sinnvollen Schritte', or 'Berechne den Wert' without a complete mathematical statement.",
    "Every exercise must be self-contained on its visible learner card. Include all stimulus text, situation, data, assumptions, targets, choices, and response instructions required to solve it; never depend on an unseen chapter, prior summary, external video, or missing list.",
    "Kreuzerl distractors must encode plausible course-specific misconceptions and each option needs targeted feedback.",
    "Calculation exercises must be fully specified, include accepted exact/decimal answers as needed, and include a real derivation plus a concrete common mistake. Do not force calculation exercises into a non-quantitative topic.",
    "Open application exercises must support cases, source analysis, writing, speaking, procedures, or design work with a sample response and an explicit self-check rubric.",
    "Set estimatedMinutes to the realistic focused effort for each exercise. Use this workload signal when deciding breadth: short foundation checks can be numerous when useful; a few substantial advanced calculations or transfer tasks may represent much more practice. Do not stop after nominally touching an objective once, and do not use a fixed number per topic or type.",
    "Inventory every distinct concrete quiz task, worksheet problem, worked example, and sample-exam task in the supplied evidence. Preserve useful nonredundant tasks when their complete statement is available, record why duplicates are adapted or omitted in scopeNote, and synthesize variants only for evidenced practice gaps.",
    "Visual practice evidence distinguishes complete_task from method_only. Treat only a complete visible task as course_original. A visible diagram or worked solution without its original prompt is still useful method evidence, but any learner task reconstructed from it must be a fully specified course_variant with safe values and an exact source-page reference, never a fabricated Moodle original.",
    "Vocabulary exercises are a separate learning object, not generic language decoration. Select them only from evidenced terminology, expressions, glossary needs, or assessment requirements. They must test productive course-appropriate terminology or functional phrases in context. Reject chapter labels and generic placeholders; do not apply a fixed language level or a subject-name vocabulary recipe. Study Buddy knowledge may fill the vocabulary set only inside an established course topic.",
    "Keep each title course-faithful and add navigationTitle as a concise learner-facing label of 2–7 meaningful words and at most 64 characters. Remove scheduling wrappers such as chapter numbers, Self-Study, Class, Week, or Part, but keep the concepts that distinguish the module from its neighbors. Never truncate a word or use generic labels such as Topic or Module.",
    "The response schema uses one flat exercise object for Structured Output compatibility. Fill only the fields relevant to cross, calculation, application, or vocabulary, and use empty arrays, strings, or the none enum for all other required fields. Irrelevant empty fields are removed before strict internal validation.",
    "Use the evaluated request contract as the semantic authority. Determine content forms and quantity by objective coverage, usefulness, evidence, and explicit user counts; never by a fixed subject archetype, per-topic quota, or conventional study-guide template.",
    "Match theory depth to the evidence and contract instead of a fixed paragraph length. Worked examples, retrieval prompts, formulas, visuals, and every exercise type are optional unless required by the contract. Formula strings must contain normal mathematical notation suitable for deterministic MathML rendering later; never output HTML or MathML here.",
    "Set courseCode to the official short course identifier when present and courseTitle to the actual course title, never a generic 'Interaktiver Study Guide' label.",
    "Do not claim official exam scoring. Explain gaps such as inaccessible Minitests in scopeNote.",
    state.error_log?.startsWith("Study-guide content builder failed:") ? `Repair these content-bank validation findings:\n${state.error_log}` : "",
    `Language: ${config.language}`,
    `Exact original request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract, null, 2)}`,
    `Layout plan for scope only:\n${JSON.stringify(state.layout_spec, null, 2)}`,
    `Canonical source corpus:\n${balancedExcerpt(state.source_text, 55_000)}`,
  ].filter(Boolean).join("\n\n");
}

function validateSourceRegistry(content: StudyGuideContent, sourceText: string): string[] {
  const issues: string[] = [];
  const knownUrls = knownHandoffSourceUrls(sourceText);
  const labels = new Set(content.sources.map((source) => source.label));
  const references = content.topics.flatMap((topic) => [
    ...topic.workedExamples.map((example) => example.source),
    ...topic.exercises.map((exercise) => exercise.source),
  ]);
  for (const source of content.sources) {
    if (source.url && knownUrls.size > 0 && !knownUrls.has(source.url)) {
      issues.push(`Source ${source.id} uses a URL that is not present in the validated Moodle handoff.`);
    }
  }
  if (knownUrls.size > 0 && content.sources.every((source) => !source.url)) {
    issues.push("The validated Moodle handoff contains source URLs, but the study-guide source register dropped all of them.");
  }
  for (const reference of references) {
    if (reference.provenance !== "adapted" && !labels.has(reference.label)) issues.push(`Learning content cites '${reference.label}', but that label is missing from the source register.`);
  }
  return [...new Set(issues)];
}

function hydrateSourceUrls(content: StudyGuideContent, sourceText: string): StudyGuideContent {
  const registry = handoffSourceRegistry(sourceText);
  const knownUrls = new Set(registry.map((source) => source.url));
  for (const source of content.sources) {
    if (source.url && knownUrls.has(source.url)) continue;
    const sourceId = normalizeSourceKey(source.id);
    const sourceLabel = normalizeSourceKey(source.label);
    const match = registry.find((candidate) => {
      const candidateId = normalizeSourceKey(candidate.id);
      const candidateLabel = normalizeSourceKey(candidate.label);
      return Boolean(
        (sourceId && candidateId && (sourceId === candidateId || sourceId.includes(candidateId) || candidateId.includes(sourceId))) ||
        labelsOverlap(sourceLabel, candidateLabel),
      );
    });
    source.url = match?.url ?? "";
  }
  return content;
}

function labelsOverlap(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const tokens = (value: string) => new Set(value.match(/[a-z]+|\d+/g) ?? []);
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token) && token.length > 1);
  return shared.length >= 2;
}

function normalizeSourceKey(value: string): string {
  return value.normalize("NFKD").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeModelContent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.topics)) return value;
  return {
    ...root,
    topics: root.topics.map((topic) => {
      if (!topic || typeof topic !== "object" || Array.isArray(topic)) return topic;
      const record = topic as Record<string, unknown>;
      if (!Array.isArray(record.exercises)) return topic;
      return {
        ...record,
        exercises: record.exercises.map((exercise) => {
          if (!exercise || typeof exercise !== "object" || Array.isArray(exercise)) return exercise;
          const item = exercise as Record<string, unknown>;
          if (item.type === "cross") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              estimatedMinutes: item.estimatedMinutes,
              selectionMode: item.selectionMode,
              options: item.options,
              explanation: item.explanation,
              source: item.source,
              evidenceRefs: item.evidenceRefs,
            };
          }
          if (item.type === "calculation") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              estimatedMinutes: item.estimatedMinutes,
              givens: item.givens,
              acceptedAnswers: item.acceptedAnswers,
              unit: item.unit,
              steps: item.steps,
              commonMistake: item.commonMistake,
              source: item.source,
              evidenceRefs: item.evidenceRefs,
            };
          }
          if (item.type === "application") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              estimatedMinutes: item.estimatedMinutes,
              instructions: item.instructions,
              sampleAnswer: item.sampleAnswer,
              selfCheck: item.selfCheck,
              source: item.source,
              evidenceRefs: item.evidenceRefs,
            };
          }
          if (item.type === "vocabulary") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              estimatedMinutes: item.estimatedMinutes,
              direction: item.direction,
              term: item.term,
              acceptedAnswers: item.acceptedAnswers,
              context: item.context,
              explanation: item.explanation,
              source: item.source,
              evidenceRefs: item.evidenceRefs,
            };
          }
          return exercise;
        }),
      };
    }),
  };
}
