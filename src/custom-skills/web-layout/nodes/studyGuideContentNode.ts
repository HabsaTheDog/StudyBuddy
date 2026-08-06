import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { studyGuideContentJsonSchema, studyGuideContentSchema, validateStudyGuideContentQuality, type StudyGuideContent } from "../studyGuideContent.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import { buildContentFromPracticeCorpus } from "../practiceCorpusContent.js";
import { deriveStudyGuideRequirements, handoffSourceRegistry, isMaes2PracticeCorpus, knownHandoffSourceUrls, readExtractionHandoff, type StudyGuideRequirements } from "../studyGuideProfile.js";
import { balancedExcerpt } from "../modelText.js";
import { buildAdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { resolveAssessmentSolutions } from "../assessmentSolutions.js";
import { resolveLearningVisuals } from "../learningVisuals.js";

interface StudyGuideChunkPlan {
  chunk: { title: string; evidence: string };
  index: number;
  exerciseTarget: number;
  calculationTarget: number;
  applicationTarget: number;
  vocabularyTarget: number;
}

export function createStudyGuideContentNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function studyGuideContentNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (config.kind !== "study-guide") return { study_guide_content: {}, error_log: null };
    try {
      const requirements = deriveStudyGuideRequirements(state.source_text);
      // The reusable MAES corpus is authored in German. English artifacts use
      // the model-backed content builder so course material is translated
      // instead of being mislabeled as English metadata around German prose.
      const deterministic = config.language === "de" && isMaes2PracticeCorpus(state.source_text)
        ? buildContentFromPracticeCorpus(state.source_text, state.layout_spec)
        : null;
      if (deterministic) {
        const parsed = studyGuideContentSchema.parse(deterministic);
        normalizeFormulaNotation(parsed);
        const issues = [...validateStudyGuideContentQuality(parsed, requirements), ...validateSourceRegistry(parsed, state.source_text)];
        if (issues.length > 0) throw new Error(issues.join("\n- "));
        await writeFile(path.join(config.runDir, "study-guide-content.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        const adaptive = await persistAdaptiveStudyModel(
          config,
          codex,
          parsed,
          state.source_text,
          state.error_log,
        );
        await config.diagnostics?.log("info", "planner", `Deterministically extracted and validated ${parsed.topics.flatMap((topic) => topic.exercises).length} concrete practice tasks from the Moodle corpus.`);
        return {
          study_guide_content: parsed as unknown as JsonObject,
          ...adaptive,
          error_log: null,
        };
      }
      const parsed = await buildChunkedModelContent(config, codex, state, requirements);
      const issues = [...validateStudyGuideContentQuality(parsed, requirements), ...validateSourceRegistry(parsed, state.source_text)];
      if (issues.length > 0) throw new Error(issues.join("\n- "));
      await writeFile(path.join(config.runDir, "study-guide-content.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      const adaptive = await persistAdaptiveStudyModel(
        config,
        codex,
        parsed,
        state.source_text,
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
  priorError: string | null,
): Promise<Pick<LangGraphWebLayoutState, "course_blueprint" | "assessment_blueprint" | "question_bank">> {
  const draft = buildAdaptiveStudyModel(content, sourceText, config.language);
  const solutions = await resolveAssessmentSolutions({
    config,
    codex,
    content,
    sourceText,
    model: draft,
    priorError,
  });
  const solvedDraft = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    solutions,
  );
  const learningVisuals = await resolveLearningVisuals({
    config,
    codex,
    content,
    sourceText,
    model: solvedDraft,
  });
  const model = buildAdaptiveStudyModel(
    content,
    sourceText,
    config.language,
    solutions,
    learningVisuals,
  );
  await Promise.all([
    writeFile(path.join(config.runDir, "course-blueprint.json"), `${JSON.stringify(model.courseBlueprint, null, 2)}\n`, "utf8"),
    writeFile(path.join(config.runDir, "assessment-blueprint.json"), `${JSON.stringify(model.assessmentBlueprint, null, 2)}\n`, "utf8"),
    writeFile(path.join(config.runDir, "question-bank.json"), `${JSON.stringify(model.questionBank, null, 2)}\n`, "utf8"),
  ]);
  return {
    course_blueprint: model.courseBlueprint as unknown as JsonObject,
    assessment_blueprint: model.assessmentBlueprint as unknown as JsonObject,
    question_bank: model.questionBank as unknown as JsonObject,
  };
}

async function buildChunkedModelContent(
  config: WebLayoutRuntimeConfig,
  codex: CodexClient,
  state: LangGraphWebLayoutState,
  requirements: StudyGuideRequirements,
): Promise<StudyGuideContent> {
  const chunks = buildEvidenceChunks(state.source_text, requirements);
  const plans: StudyGuideChunkPlan[] = [];
  let remainingExercises = requirements.exerciseTarget;
  let remainingCalculations = requirements.calculationTarget;
  let remainingApplications = requirements.applicationTarget;
  let remainingVocabulary = requirements.vocabularyTarget;
  const vocabularyChapterIndexes = new Set(chunks.flatMap((chunk, index) =>
    requirements.vocabularyAssessmentRequired || /\b(?:vocabulary|vocab|wortschatz|terminology|expressions?|fachbegriffe?|glossar|glossary)\b/i.test(chunk.evidence)
      ? [index]
      : []
  ));
  for (let index = 0; index < chunks.length; index += 1) {
    const topicsLeft = chunks.length - index;
    const exerciseTarget = Math.max(3, Math.ceil(remainingExercises / topicsLeft));
    const calculationTarget = Math.max(0, Math.min(exerciseTarget, Math.ceil(remainingCalculations / topicsLeft)));
    const applicationTarget = Math.min(
      exerciseTarget - calculationTarget,
      Math.max(0, Math.ceil(remainingApplications / topicsLeft)),
    );
    const vocabularyChaptersLeft = [...vocabularyChapterIndexes].filter((candidate) => candidate >= index).length;
    const vocabularyTarget = vocabularyChapterIndexes.has(index)
      ? Math.min(
          exerciseTarget - calculationTarget - applicationTarget,
          Math.max(0, Math.ceil(remainingVocabulary / Math.max(1, vocabularyChaptersLeft))),
        )
      : 0;
    plans.push({
      chunk: chunks[index],
      index,
      exerciseTarget,
      calculationTarget,
      applicationTarget,
      vocabularyTarget,
    });
    remainingExercises -= exerciseTarget;
    remainingCalculations -= calculationTarget;
    remainingApplications -= applicationTarget;
    remainingVocabulary -= vocabularyTarget;
  }
  const batchSize = webContentBatchSize();
  const chapterContent: Array<StudyGuideContent | undefined> = new Array(plans.length);
  const pendingPlans: StudyGuideChunkPlan[] = [];
  for (const plan of plans) {
    const chunkPath = path.join(config.runDir, `study-guide-content-chunk-${plan.index + 1}.json`);
    const sharedPath = sharedChunkCachePath(config, requirements, plan);
    const local = await readCachedChunk(chunkPath);
    const value = local ?? await readCachedChunk(sharedPath);
    if (local && process.env.VITEST !== "true") {
      await persistSharedChunk(sharedPath, local);
    }
    if (value && !chunkNeedsRepair(value, plan, state.error_log)) {
      chapterContent[plan.index] = value;
    } else {
      pendingPlans.push(plan);
    }
  }
  const effectiveBatchSize = state.error_log && requirements.vocabularyAssessmentRequired
    ? 1
    : batchSize;
  const batches = Array.from(
    { length: Math.ceil(pendingPlans.length / effectiveBatchSize) },
    (_, index) => pendingPlans.slice(index * effectiveBatchSize, (index + 1) * effectiveBatchSize),
  );
  const concurrency = Math.min(webContentConcurrency(), batches.length);
  await config.diagnostics?.log(
    "info",
    "planner",
    `Building ${plans.length} evidence-bounded chapter(s): reusing ${plans.length - pendingPlans.length}, generating ${pendingPlans.length} in ${batches.length} model batch(es) with concurrency ${concurrency}.`,
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
    const response = await codex.run(
      buildStudyGuideBatchPrompt(config, state, requirements, batch, chunks.length),
      {
        outputSchema: studyGuideContentJsonSchema,
        task: state.error_log ? "content_repair" : "content_analyzer",
        attempt: state.content_retry_count + 1,
        timeoutMs: batch.length > 1 ? 180_000 : undefined,
      },
    );
    const generated = normalizeDerivedSourceTasks(
      studyGuideContentSchema.parse(normalizeModelContent(JSON.parse(stripJsonFence(response)))),
    );
    if (generated.topics.length !== batch.length) {
      throw new Error(`Content batch returned ${generated.topics.length} topics instead of exactly ${batch.length}.`);
    }
    const split = generated.topics.map((topic) => studyGuideContentSchema.parse({
      courseTitle: generated.courseTitle,
      courseCode: generated.courseCode,
      scopeNote: generated.scopeNote,
      topics: [topic],
      sources: generated.sources,
    }));
    await Promise.all(split.flatMap((chunk, batchIndex) => {
      const serialized = `${JSON.stringify(chunk, null, 2)}\n`;
      const sharedPath = sharedChunkCachePath(config, requirements, batch[batchIndex]);
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
    split.forEach((chunk, batchIndex) => {
      chapterContent[batch[batchIndex]!.index] = chunk;
    });
  });
  if (chapterContent.some((chunk) => !chunk)) {
    throw new Error("Content generation completed without a chapter result for every evidence chunk.");
  }
  const resolvedChapterContent = chapterContent as StudyGuideContent[];
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
  normalizeSourceReferences(aggregate);
  return hydrateSourceUrls(normalizeDerivedSourceTasks(aggregate), state.source_text);
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
): string {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    version: "study-guide-content-v5-dense-vocabulary",
    language: config.language,
    courseCode: requirements.courseCode,
    title: plan.chunk.title,
    evidence: plan.chunk.evidence,
    exerciseTarget: plan.exerciseTarget,
    calculationTarget: plan.calculationTarget,
    applicationTarget: plan.applicationTarget,
    vocabularyTarget: plan.vocabularyTarget,
    vocabularyAssessmentRequired: requirements.vocabularyAssessmentRequired,
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

async function readCachedChunk(chunkPath: string): Promise<StudyGuideContent | null> {
  try {
    return studyGuideContentSchema.parse(JSON.parse(await readFile(chunkPath, "utf8")));
  } catch {
    return null;
  }
}

function chunkNeedsRepair(
  chunk: StudyGuideContent,
  plan: StudyGuideChunkPlan,
  errorLog: string | null,
): boolean {
  const exercises = chunk.topics.flatMap((topic) => topic.exercises);
  if (
    chunk.topics.length !== 1 ||
    exercises.length !== plan.exerciseTarget ||
    exercises.filter((exercise) => exercise.type === "calculation").length !== plan.calculationTarget ||
    exercises.filter((exercise) => exercise.type === "application").length !== plan.applicationTarget
    || exercises.filter((exercise) => exercise.type === "vocabulary").length !== plan.vocabularyTarget
  ) {
    return true;
  }
  if (!errorLog) return false;
  const globalFinding = /Expected (?:evidence-adaptive|at least)|dropped all of them|not present in the validated Moodle handoff/i;
  if (globalFinding.test(errorLog)) return true;
  if (new RegExp(`chunk\\s+${plan.index + 1}\\b`, "i").test(errorLog)) return true;
  const identifiers = [plan.chunk.title, ...chunk.topics.flatMap((topic) => [
    topic.id,
    topic.title,
    ...topic.exercises.map((exercise) => exercise.id),
    ...topic.exercises.map((exercise) => exercise.source.label),
  ])].filter((value) => value.length >= 3);
  return identifiers.some((identifier) => errorLog.toLocaleLowerCase().includes(identifier.toLocaleLowerCase()));
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

function normalizeSourceReferences(content: StudyGuideContent): void {
  const sourceLabels = content.sources.map((source) => source.label);
  const exactLabels = new Map(sourceLabels.map((label) => [label.toLocaleLowerCase(), label]));
  const normalize = (reference: StudyGuideContent["topics"][number]["workedExamples"][number]["source"]) => {
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
    const replacement = exactSegment ?? fuzzy;
    if (replacement) reference.label = replacement;
  };
  for (const topic of content.topics) {
    for (const example of topic.workedExamples) normalize(example.source);
    for (const exercise of topic.exercises) normalize(exercise.source);
  }
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
  state: Pick<LangGraphWebLayoutState, "error_log">,
  requirements: StudyGuideRequirements,
  batch: StudyGuideChunkPlan[],
  total: number,
): string {
  return [
    `Build ${batch.length} source-grounded chapter${batch.length === 1 ? "" : "s"} for the canonical Study Buddy content bank. Return JSON only.`,
    "This is a bounded content transformation. Do not use tools, inspect files, browse, or discuss UI implementation.",
    "Match theory depth to the chapter evidence: cover every required concept and prerequisite needed for the exercises, but do not repeat source-limit boilerplate or pad a chapter to a fixed length. Include precise key ideas, an evidence-appropriate worked example, learning goals, and retrieval prompts.",
    "Keep title exactly course-faithful. Also provide navigationTitle as a concise learner-facing label of 2–7 meaningful words and at most 64 characters. Remove scheduling wrappers such as chapter numbers, Self-Study, Class, Week, or Part, but retain the concepts that distinguish this module from its neighbors. It must work as a standalone navigation label; never truncate a word or add generic labels such as Topic or Module.",
    "Use cross exercises for concrete misconception, comparison, classification, or sequencing checks. Use calculation exercises only when the evidence supplies a real quantitative method and necessary quantities.",
    "Use application exercises for open case analysis, source interpretation, writing, speaking, laboratory procedures, design decisions, or other work that cannot be assessed honestly as multiple choice. Each application needs executable instructions, a useful sample answer, and specific self-check criteria.",
    "Use vocabulary exercises only when terminology, expressions, a glossary, language functions, or a vocabulary assessment is evidenced. Each item must test one useful in-scope term or phrase through term-to-meaning, meaning-to-term, or a context gap. Give accepted answers, a natural course-relevant context sentence, and an explanation. Select productive B2/C1 professional or disciplinary vocabulary and functional multi-word expressions that a learner could realistically need in the documented assessment. Never use a chapter heading, assessment format, presentation name, generic classroom word, or obvious everyday verb as the vocabulary term. For example, do not use 'presentation', 'test', 'detail', 'show', or 'question' in isolation. When the evidence establishes a topic but does not expose a word list, Study Buddy may generate stable domain vocabulary inside that exact topic scope and must use provenance=derived.",
    "Use provenance=source for directly evidenced tasks, provenance=adapted for an evidenced parameter variation, and provenance=derived only for new practice synthesized from the named source concept. Every sourceTask must identify the concrete task, slide, script section, table procedure, formula, or worked example.",
    "Never invent course facts, constants, clinical/legal rules, exam scoring, or generic filler. A calculation prompt must contain complete givens, units, a derivable result, progressive solution steps, and a concrete common mistake.",
    "Formula expressions must be concise mathematical notation, never prose, HTML, MathML, TeX delimiters, or Typst markup. Leave formulas empty if this chapter has no meaningful formula.",
    "The flat Structured Output exercise object requires every field. Cross exercises fill selectionMode/options/explanation; calculation exercises fill givens/acceptedAnswers/unit/steps/commonMistake; application exercises fill instructions/sampleAnswer/selfCheck; vocabulary exercises fill direction/term/acceptedAnswers/context/explanation. Use direction=none, selectionMode=none, empty arrays, or empty strings for every field irrelevant to that type. Irrelevant fields are removed before internal validation.",
    "The sources array must include every source label cited by this chapter. Copy only HTTPS Moodle URLs present in the evidence; otherwise use an empty URL. Set courseCode and courseTitle exactly as stated above. scopeNote must be one concise, non-repetitive source-limit sentence for this chapter.",
    state.error_log?.startsWith("Study-guide content builder failed:") ? `Repair these prior validation findings where applicable:\n${state.error_log}` : "",
    `Return exactly ${batch.length} topics entries in the supplied chapter order. Do not merge or rename chapters.`,
    `Course: ${requirements.courseCode} · ${requirements.courseTitle}. Course profile: ${requirements.archetype}.`,
    `Language: ${config.language}`,
    ...batch.flatMap((plan) => {
      const selectionTarget = plan.exerciseTarget - plan.calculationTarget - plan.applicationTarget - plan.vocabularyTarget;
      return [
        `Chapter ${plan.index + 1}/${total}: ${plan.chunk.title}. Return exactly ${plan.exerciseTarget} substantive exercises for this chapter: ${selectionTarget} cross/selection, ${plan.calculationTarget} genuine calculation, ${plan.applicationTarget} open application, and ${plan.vocabularyTarget} vocabulary retrieval exercises.`,
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
  const entries = [...groups.entries()].slice(0, requirements.topicTarget);
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

export function buildStudyGuideContentPrompt(config: WebLayoutRuntimeConfig, state: Pick<LangGraphWebLayoutState, "source_text" | "layout_spec" | "error_log">): string {
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
    "Never manufacture generic prompts such as 'Welche Aussage trifft zu?', 'Wähle alle sinnvollen Schritte', or 'Berechne den Wert' without a complete mathematical statement.",
    "Kreuzerl distractors must encode plausible course-specific misconceptions and each option needs targeted feedback.",
    "Calculation exercises must be fully specified, include accepted exact/decimal answers as needed, and include a real derivation plus a concrete common mistake. Do not force calculation exercises into a non-quantitative topic.",
    "Open application exercises must support cases, source analysis, writing, speaking, procedures, or design work with a sample response and an explicit self-check rubric.",
    "Vocabulary exercises are a separate learning object, not generic language decoration. Select them only from evidenced terminology, expressions, glossary needs, or assessment requirements. They must test productive B2/C1 professional or disciplinary vocabulary, useful functional phrases, direct recall, or context. Reject chapter titles, assessment names, and isolated generic words such as presentation, test, detail, show, or question. Study Buddy knowledge may fill the vocabulary set only inside an established course topic.",
    "Keep each title course-faithful and add navigationTitle as a concise learner-facing label of 2–7 meaningful words and at most 64 characters. Remove scheduling wrappers such as chapter numbers, Self-Study, Class, Week, or Part, but keep the concepts that distinguish the module from its neighbors. Never truncate a word or use generic labels such as Topic or Module.",
    "The response schema uses one flat exercise object for Structured Output compatibility. Fill only the fields relevant to cross, calculation, application, or vocabulary, and use empty arrays, strings, or the none enum for all other required fields. Irrelevant empty fields are removed before strict internal validation.",
    `Evidence-adaptive course profile: ${requirements.archetype}. Cover at least ${requirements.topicTarget} evidenced topics and create at least ${requirements.exerciseTarget} substantive exercises total, including at least ${requirements.selectionTarget} selection/retrieval exercises, ${requirements.calculationTarget} genuine calculations, ${requirements.applicationTarget} open applications, and ${requirements.vocabularyTarget} evidence-grounded vocabulary retrieval items. The handoff exposes about ${requirements.sourceExerciseCount} direct source exercises, so at least ${requirements.derivedPracticeMinimum} tasks may need to be transparently derived from course content.`,
    `Profile rationale: ${requirements.rationale}`,
    "Match theory depth to the evidence and exercise prerequisites instead of a fixed paragraph length; cover required concepts without filler or repeated source-limit prose. Include a complete worked example for every topic. Formula strings must contain normal mathematical notation suitable for deterministic MathML rendering later; never output HTML or MathML here. Leave formulas empty for topics without meaningful mathematical notation.",
    "Set courseCode to the official short course identifier when present and courseTitle to the actual course title, never a generic 'Interaktiver Study Guide' label.",
    "Do not claim official exam scoring. Explain gaps such as inaccessible Minitests in scopeNote.",
    state.error_log?.startsWith("Study-guide content builder failed:") ? `Repair these content-bank validation findings:\n${state.error_log}` : "",
    `Language: ${config.language}`,
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
              selectionMode: item.selectionMode,
              options: item.options,
              explanation: item.explanation,
              source: item.source,
            };
          }
          if (item.type === "calculation") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              givens: item.givens,
              acceptedAnswers: item.acceptedAnswers,
              unit: item.unit,
              steps: item.steps,
              commonMistake: item.commonMistake,
              source: item.source,
            };
          }
          if (item.type === "application") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              instructions: item.instructions,
              sampleAnswer: item.sampleAnswer,
              selfCheck: item.selfCheck,
              source: item.source,
            };
          }
          if (item.type === "vocabulary") {
            return {
              id: item.id,
              type: item.type,
              prompt: item.prompt,
              direction: item.direction,
              term: item.term,
              acceptedAnswers: item.acceptedAnswers,
              context: item.context,
              explanation: item.explanation,
              source: item.source,
            };
          }
          return exercise;
        }),
      };
    }),
  };
}
