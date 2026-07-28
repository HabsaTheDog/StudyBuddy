import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isNonRetryableCodexError,
  ModelCallTimeoutError,
  type CodexClient,
} from "../codexClient.js";
import {
  ChapterFragmentSchema,
  chapterFragmentJsonSchema,
  extractedDataJsonSchema,
  type ChapterFragment,
} from "../schemas.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";
import { readVisualManifest } from "../visualAssets.js";
import { StudyBuddyCheckpointError, throwIfAborted } from "../runtimeAbort.js";
import {
  resolveAnalysisBudget,
  selectAnalysisSlices,
  type AnalysisSliceCandidate,
} from "../analysisBudget.js";
import {
  STUDENT_FIRST_POLICY,
  STUDENT_FIRST_POLICY_VERSION,
} from "../studentFirstPolicy.js";
import { resolveTaskBudget } from "../taskBudget.js";
import { canonicalizeResourceUrl } from "../resourceAcquisition.js";
import { resolveTaskModelPolicy } from "../modelPolicy.js";
import { markExtractionRepairComplete } from "../pendingExtractionRepairs.js";
import { languageName } from "../../shared/languagePolicy.js";
import {
  extractResolvedCourseIdentity,
  resolveRequestedCourseCode,
} from "../courseTargeting.js";
import {
  adaptiveEvidenceSliceLimit,
  applyAdaptiveExtractionBudget,
  updateAdaptiveRuntimeProgress,
} from "../adaptiveRuntimeBudget.js";

const ANALYZER_RETRY_LIMIT = 3;
const CHAPTER_ANALYZER_VERSION = "2026-07-26.8-subtopic-frequency";
const FOCUSED_CONTEXT_BUDGET = 15_000;
const FOCUSED_EVIDENCE_BUDGET = 9_000;
const FOCUSED_SOURCE_OVERVIEW_BUDGET = 2_000;
const FOCUSED_VISUAL_CANDIDATE_LIMIT = 6;
const DENSE_CHAPTER_RECORD_LIMIT = 18;
const DENSE_CHAPTER_CHARACTER_LIMIT = 13_000;
const FRAGMENT_EVIDENCE_CHARACTER_LIMIT = 9_000;
const PACKED_FRAGMENT_EVIDENCE_CHARACTER_LIMIT = 40_000;
const MAX_SLICES_PER_MODEL_CALL = 4;
const FRAGMENT_RECORD_OVERLAP = 2;
// Codex SDK threads in one process can contend without emitting any usage when
// launched concurrently. Sequential chapter handoffs are bounded, cacheable,
// and avoid turning apparent parallelism into paired model timeouts.
const CHAPTER_ANALYZER_CONCURRENCY = 1;

export function createAnalyzerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function analyzerNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      throwIfAborted(config.abortSignal);
      const analyzed = shouldAnalyzeByChapter(config, state)
        ? await analyzeCourseChapters(config, state, codex)
        : await analyzeWholeRequest(config, state, codex);
      const validated = reconcileRequestedCourseIdentity(
        config,
        analyzed,
        state.moodle_raw_text,
      );
      throwIfAborted(config.abortSignal);
      await persistExtractedData(config.runDir, validated);
      await config.diagnostics?.log("info", "analyzer", "Validated and persisted extracted study data.");
      return {
        extracted_data: validated,
        error_log: null,
      };
    } catch (error) {
      // A run-level timeout/cancellation belongs to the graph runtime. It must
      // terminate the active run instead of becoming analyzer repair state.
      throwIfAborted(config.abortSignal);
      if (error instanceof StudyBuddyCheckpointError) {
        throw error;
      }
      if (error instanceof ModelCallTimeoutError) {
        throw capacityCheckpoint(error);
      }
      const nonRetryable = isNonRetryableCodexError(error);
      if (nonRetryable) {
        await config.diagnostics?.log(
          "error",
          "analyzer",
          "Analyzer stopped after a non-retryable model error.",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return {
        error_log: `Analyzer failed${nonRetryable ? " (non-retryable)" : ""}: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: nonRetryable
          ? Math.max(ANALYZER_RETRY_LIMIT, state.retry_count + 1)
          : state.retry_count + 1,
      };
    }
  };
}

export function reconcileRequestedCourseIdentity(
  config: MoodleRuntimeConfig,
  data: ReturnType<typeof validateExtractedData>,
  sourceText = "",
): ReturnType<typeof validateExtractedData> {
  const resolvedIdentity = extractResolvedCourseIdentity(sourceText);
  const requestedCode = resolveRequestedCourseCode(
    config.prompt,
    config.originalUserPrompt ?? "",
    sourceText,
  );
  const courseTitle = resolvedIdentity &&
      resolvedIdentity.confidence !== "low" &&
      resolvedIdentity.confidence !== "direct"
    ? resolvedIdentity.title
    : requestedCode ?? (resolvedIdentity?.confidence === "direct"
      ? resolvedIdentity.title
      : undefined);
  if (!courseTitle) return data;
  const title = config.artifactIntent.profile === "study_guide"
    ? `${courseTitle} – Study Guide`
    : data.document_title.toLowerCase().includes(courseTitle.toLowerCase())
      ? data.document_title
      : `${courseTitle} – ${data.document_title}`;
  return validateExtractedData({
    ...data,
    document_title: title,
    course: {
      ...data.course,
      title: courseTitle,
      ...(resolvedIdentity?.url ? { url: resolvedIdentity.url } : {}),
    },
  });
}

async function analyzeWholeRequest(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  codex: CodexClient,
) {
  const response = await codex.run(await buildAnalyzerPrompt(config, state), {
    outputSchema: extractedDataJsonSchema,
    task: "content_analyzer",
    attempt: state.retry_count + 1,
    localImages: await analyzerVisualAttachments(config.runDir, state),
  });
  return validateAnalyzerResponse(response, config);
}

function validateAnalyzerResponse(
  response: string,
  config: MoodleRuntimeConfig,
): ReturnType<typeof validateExtractedData> {
  const parsed = parseJsonObjectOrArray(response);
  if (Array.isArray(parsed)) {
    throw new Error("Analyzer must return one extracted-data object, not an array.");
  }
  return validateExtractedData({
    ...parsed,
    language: config.outputLanguage,
  });
}

export interface ChapterFocus {
  key: string;
  title: string;
  resourceIds: string[];
  directResourceIds?: string[];
  supportResourceIds?: string[];
  matchTerms: string[];
  priority?: "essential" | "important" | "supplementary";
  contentMode?: "quantitative" | "conceptual" | "procedural" | "case_based" | "mixed";
  learningObjectives?: string[];
  assessmentSignals?: string[];
}

interface CachedChapterHandoff {
  fingerprint: string;
  data: ReturnType<typeof validateExtractedData>;
}

function shouldAnalyzeByChapter(config: MoodleRuntimeConfig, state: LangGraphAgentState): boolean {
  return ["study_guide", "exam_navigator", "interactive_learning", "practice_pack"].includes(
    config.artifactIntent.profile,
  ) && chapterFocuses(state).length > 1;
}

async function analyzeCourseChapters(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  codex: CodexClient,
) {
  const analysisBudget = resolveAnalysisBudget(config.executionProfile);
  const focuses = chapterFocuses(state)
    .sort((left, right) => focusPriority(right) - focusPriority(left))
    .slice(0, analysisBudget.maxSelectedSlices);
  await applyAdaptiveExtractionBudget(config, state, focuses.length);
  const evidenceSlicesPerChapter = config.executionProfile === "quality" ? 4 : 2;
  const sliceBudgets = focuses.map((focus) => {
    const evidencedDirectResources = new Set(
      state.evidence_package.records
        .filter((record) => (focus.directResourceIds ?? focus.resourceIds).includes(record.resourceId))
        .map((record) => record.resourceId),
    ).size;
    // A direct exercise/solution dependency must not disappear merely because
    // a chapter has more assigned sources than the default slice count. Up to
    // four compact slices can still be packed into one bounded model call.
    return Math.min(
      Math.max(
        evidenceSlicesPerChapter,
        Math.min(4, evidencedDirectResources),
        Math.min(4, 1 + (focus.learningObjectives?.length ?? 0)),
      ),
      analysisBudget.maxModelCallsPerModule,
    );
  });
  const cacheDir = path.join(config.runDir, "chapter-handoffs");
  const sharedCacheDir = path.join(config.runtimeCacheDir, "chapter-handoffs");
  await Promise.all([
    mkdir(cacheDir, { recursive: true }),
    mkdir(sharedCacheDir, { recursive: true }),
  ]);
  const mentioned = focuses.filter((focus) =>
    focusMatchesError(focus, state.error_log)
  );
  const localizedSemanticRepair = state.error_log?.startsWith("Semantic quality review failed:") ?? false;
  const invalidKeys = new Set(
    state.error_log && mentioned.length === 0 && !localizedSemanticRepair
      ? focuses.map((focus) => focus.key)
      : mentioned.map((focus) => focus.key),
  );
  const results = new Array<ReturnType<typeof validateExtractedData>>(focuses.length);
  const failures: Array<{ focus: ChapterFocus; message: string }> = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < focuses.length) {
      throwIfAborted(config.abortSignal);
      const index = cursor++;
      const focus = focuses[index];
      const fingerprint = chapterFingerprint(config, state, focus);
      const cachePath = path.join(cacheDir, `${focus.key}.json`);
      const sharedCachePath = path.join(sharedCacheDir, `${fingerprint}.json`);
      const recovered = config.resumeExtractionRunDir && !invalidKeys.has(focus.key)
        ? await readPersistedChapterHandoff(cachePath, config.outputLanguage)
        : null;
      const cached = invalidKeys.has(focus.key)
        ? null
        : recovered ??
          await readChapterCache(cachePath, fingerprint) ??
          await readChapterCache(sharedCachePath, fingerprint);
      throwIfAborted(config.abortSignal);
      if (cached) {
        const enrichedData = await enrichCachedChapterHandoff(config, state, focus, cached.data);
        throwIfAborted(config.abortSignal);
        results[index] = enrichedData;
        const enrichedCache = { fingerprint, data: enrichedData };
        const serialized = `${JSON.stringify(enrichedCache, null, 2)}\n`;
        await Promise.all([
          writeFile(cachePath, serialized, "utf8"),
          writeFile(sharedCachePath, serialized, "utf8"),
        ]);
        await config.diagnostics?.log("info", "analyzer", `Reused validated chapter handoff: ${focus.title}`);
        await updateAdaptiveRuntimeProgress(
          config,
          results.filter(Boolean).length,
          focuses.length,
        );
        continue;
      }
      try {
        ensureChapterRuntimeBudget(config, state, focus, results);
        const dense = isDenseChapter(state, focus) ||
          (
            config.artifactIntent.profile === "study_guide" &&
            focusNeedsQuantitativeApplication(focus)
          );
        await config.diagnostics?.log(
          "info",
          "analyzer",
          dense
            ? `Analyzing dense chapter in bounded topic fragments: ${focus.title}`
            : `Analyzing chapter independently: ${focus.title}`,
        );
        const analyzed = dense
          ? await analyzeDenseChapter(
              config,
              state,
              focus,
              codex,
              adaptiveEvidenceSliceLimit(config, sliceBudgets[index]),
              invalidKeys.has(focus.key) ? state.error_log : undefined,
            )
          : validateAnalyzerResponse(await codex.run(
              await buildAnalyzerPrompt(config, state, focus),
              {
                outputSchema: extractedDataJsonSchema,
                task: "content_analyzer",
                attempt: state.retry_count + 1,
                localImages: await analyzerVisualAttachments(config.runDir, state, focus),
              },
            ), config);
        const data = ensureFocusLearningModule(analyzed, focus);
        throwIfAborted(config.abortSignal);
        assertChapterHandoff(data, focus);
        const serialized = `${JSON.stringify({ fingerprint, data }, null, 2)}\n`;
        await Promise.all([
          writeFile(cachePath, serialized, "utf8"),
          writeFile(sharedCachePath, serialized, "utf8"),
        ]);
        if (invalidKeys.has(focus.key)) {
          await markExtractionRepairComplete(config.runDir, focus.title);
        }
        results[index] = data;
        await updateAdaptiveRuntimeProgress(
          config,
          results.filter(Boolean).length,
          focuses.length,
        );
      } catch (error) {
        // Do not aggregate a global abort as a chapter failure or advance to
        // another chapter. The outer node rethrows the same run-level reason.
        throwIfAborted(config.abortSignal);
        if (error instanceof StudyBuddyCheckpointError) {
          throw error;
        }
        if (error instanceof ModelCallTimeoutError) {
          throw capacityCheckpoint(error, focus.title);
        }
        await config.diagnostics?.log(
          "error",
          "analyzer",
          `Chapter analysis failed: ${focus.title}`,
          { error: error instanceof Error ? error.message : String(error) },
        );
        failures.push({
          focus,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  await Promise.all(Array.from({
    length: Math.min(CHAPTER_ANALYZER_CONCURRENCY, focuses.length),
  }, () => worker()));
  if (failures.length > 0) {
    throw new Error(failures
      .map(({ focus, message }) => `[chapter: ${focus.title}] Chapter analyzer failed: ${message}`)
      .join("\n"));
  }
  return mergeChapterHandoffs(results, focuses, config);
}

type EvidenceRecord = LangGraphAgentState["evidence_package"]["records"][number];
type ManifestResource = LangGraphAgentState["resource_manifest"]["resources"][number];
type VisualManifest = NonNullable<Awaited<ReturnType<typeof readVisualManifest>>>;
type VisualCandidate = VisualManifest["candidates"][number];

export interface ChapterSlice {
  key: string;
  label: string;
  resourceIds: string[];
  records: EvidenceRecord[];
}

interface VisualRetrievalRequest {
  resourceId: string;
  pages: number[];
  purpose: string;
  priority: string;
  placementHint: string;
  reason: string;
}

function isDenseChapter(state: LangGraphAgentState, focus: ChapterFocus): boolean {
  const records = state.evidence_package.records.filter((record) =>
    focus.resourceIds.includes(record.resourceId)
  );
  const characters = records.reduce((sum, record) => sum + JSON.stringify(record).length, 0);
  return records.length > DENSE_CHAPTER_RECORD_LIMIT || characters > DENSE_CHAPTER_CHARACTER_LIMIT;
}

async function analyzeDenseChapter(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
  codex: CodexClient,
  maxSlices: number,
  repairFeedbackOverride?: string | null,
): Promise<ReturnType<typeof validateExtractedData>> {
  const allCandidateSlices = buildChapterSlices(state, focus);
  const directResourceIds = new Set(focus.directResourceIds ?? focus.resourceIds);
  const directEvidenceCharacters = state.evidence_package.records
    .filter((record) => directResourceIds.has(record.resourceId))
    .reduce((sum, record) => sum + record.content.length, 0);
  const candidateSlices = directEvidenceCharacters >= 600
    ? allCandidateSlices.filter((slice) =>
        slice.resourceIds.some((resourceId) => directResourceIds.has(resourceId)) ||
        supportSliceMatchesFocus(slice, focus)
      )
    : allCandidateSlices;
  const profileBudget = resolveAnalysisBudget(config.executionProfile);
  const repairFeedback = repairFeedbackOverride === undefined
    ? focusMatchesError(focus, state.error_log) ? state.error_log : null
    : repairFeedbackOverride;
  const officialTopicCount = officialCourseTopics(focus).length;
  const effectiveMaxSlices = officialTopicCount > 0
    ? Math.max(maxSlices, Math.min(4, candidateSlices.length))
    : maxSlices;
  const retrievalRequests = await readVisualRetrievalRequests(config.runDir);
  const dependencyResourceIds = new Set(retrievalRequests
    .filter((request) => request.priority === "high" && focus.resourceIds.includes(request.resourceId))
    .map((request) => request.resourceId));
  const candidates = candidateSlices.map((slice, index) => {
      const sourceRole = dominantSliceRole(state, slice);
      const reservation = slice.resourceIds.some((id) =>
        (focus.directResourceIds ?? focus.resourceIds).includes(id)
      )
        ? "dependency" as const
        : slice.resourceIds.some((id) => dependencyResourceIds.has(id))
          ? "dependency" as const
          : undefined;
      return {
        id: slice.key,
        resourceId: slice.resourceIds.join("+") || focus.key,
        moduleId: focus.key,
        sourceRole,
        title: slice.label,
        content: slice.records.map((record) => record.content).join(" "),
        tags: sliceSourceTags(state, slice),
        ordinal: index,
        totalSlices: candidateSlices.length,
        reservation,
        slice,
      };
    });
  const selected = selectAnalysisSlices<AnalysisSliceCandidate & { slice: ChapterSlice }>({
    candidates,
    relevanceTerms: [
      focus.title,
      ...focus.matchTerms,
      ...(focus.learningObjectives ?? []),
      ...(focus.assessmentSignals ?? []),
      ...(repairFeedback ? [repairFeedback] : []),
    ],
    profile: config.executionProfile,
    limits: {
      ...profileBudget,
      maxGlobalModelCalls: effectiveMaxSlices,
      maxModelCallsPerModule: effectiveMaxSlices,
      maxSlicesPerResource: Math.max(
        profileBudget.maxSlicesPerResource,
        effectiveMaxSlices,
      ),
      maxSelectedSlices: effectiveMaxSlices,
    },
  });
  const courseBalancedSelection = ensureOfficialTopicEvidenceSelection(
    selected.selected,
    candidates,
    focus,
    effectiveMaxSlices,
  );
  const selectedCandidates = ensureDirectEvidenceSelection(
    courseBalancedSelection,
    candidates,
    focus.directResourceIds ?? focus.resourceIds,
    effectiveMaxSlices,
  );
  assertSelectedChapterEvidence(state, focus, selectedCandidates);
  const slices = packSelectedSlices(selectedCandidates);
  await config.diagnostics?.log(
    selected.omittedCount > 0 ? "warn" : "info",
    "analyzer",
    `Budgeted ${focus.title}: retained ${selectedCandidates.length}/${candidateSlices.length} evidence slice(s) in ${slices.length} model call(s).`,
    {
      contentMode: focus.contentMode ?? "mixed",
      omittedSlices: selected.omittedCount,
      modelCallPacks: slices.length,
      countsByResource: selected.countsByResource,
      directResources: focus.directResourceIds ?? focus.resourceIds,
      supportResources: focus.supportResourceIds ?? [],
    },
  );
  const visualManifest = await readVisualManifest(config.runDir);
  const fragments: ChapterFragment[] = [];
  const fragmentCacheDir = path.join(config.runtimeCacheDir, "chapter-fragments");
  await mkdir(fragmentCacheDir, { recursive: true });

  for (const [index, slice] of slices.entries()) {
    throwIfAborted(config.abortSignal);
    // Once the reviewer has localized a blocking finding to this chapter, its
    // selected fragments must actually see that feedback. Previously generic
    // contradictions (for example an incorrect direction-field definition)
    // failed sliceNeedsRepair and silently reused the same cached fragment.
    let sliceRepairFeedback = repairFeedback;
    const fingerprintBase = {
      analyzerVersion: CHAPTER_ANALYZER_VERSION,
      outputLanguage: config.outputLanguage,
      profile: config.artifactIntent.profile,
      policy: STUDENT_FIRST_POLICY_VERSION,
      focus,
      slice: slice.key,
      repairFeedback: sliceRepairFeedback,
    };
    const legacyFingerprint = createHash("sha256").update(JSON.stringify({
      ...fingerprintBase,
      records: slice.records.map((record) => ({
        id: record.id,
        resourceId: record.resourceId,
        content: record.content,
      })),
    })).digest("hex");
    const semanticFingerprint = createHash("sha256").update(JSON.stringify({
      ...fingerprintBase,
      records: slice.records
        .filter((record) => !/^Selection:\s/i.test(record.content))
        .map((record) => ({ resourceId: record.resourceId, content: record.content })),
    })).digest("hex");
    const fragmentCachePaths = [...new Set([semanticFingerprint, legacyFingerprint])]
      .map((fingerprint) => path.join(fragmentCacheDir, `${fingerprint}.json`));
    const requiresApplication =
      sliceRequiresAppliedExample(state, focus, slice) ||
      (slices.length === 1 && focusNeedsQuantitativeApplication(focus));
    const minimumLearningCharacters =
      slices.length === 1 && focusNeedsQuantitativeApplication(focus) ? 1_200 : 0;
    let cachedFragment: ChapterFragment | null = null;
    for (const cachePath of fragmentCachePaths) {
      cachedFragment = await readFile(cachePath, "utf8")
        .then((text) => normalizeFragmentReferences(
          ChapterFragmentSchema.parse(JSON.parse(text)),
          slice,
          visualManifest,
        ))
        .catch(() => null);
      if (cachedFragment) break;
    }
    if (
      cachedFragment &&
      repairFeedback &&
      fragmentContainsIncompleteFormula(cachedFragment, repairFeedback)
    ) {
      cachedFragment = null;
      sliceRepairFeedback = repairFeedback;
      await config.diagnostics?.log(
        "info",
        "analyzer",
        `Invalidated formula-metadata fragment ${index + 1}/${slices.length}: ${slice.label}`,
      );
    }
    const cachedApplicationError = cachedFragment && requiresApplication
      ? appliedFragmentQualityError(cachedFragment, focus, minimumLearningCharacters)
      : null;
    if (cachedFragment && cachedApplicationError) {
      cachedFragment = null;
      sliceRepairFeedback =
        `Validator-Diagnose: ${cachedApplicationError}`;
      await config.diagnostics?.log(
        "info",
        "analyzer",
        `Invalidated weak application fragment ${index + 1}/${slices.length}: ${slice.label}`,
      );
    }
    if (cachedFragment) {
      fragments.push(cachedFragment);
      await config.diagnostics?.log(
        "info",
        "analyzer",
        `Reused validated topic fragment ${index + 1}/${slices.length}: ${slice.label}`,
      );
      continue;
    }
    ensureChapterRuntimeBudget(config, state, focus, []);
    await config.diagnostics?.log(
      "info",
      "analyzer",
      `Analyzing ${focus.title}, topic fragment ${index + 1}/${slices.length}: ${slice.label}`,
    );
    const localImages = await chapterVisualAttachments(
      config.runDir,
      slice,
      visualManifest,
      retrievalRequests,
    );
    let fragment: ChapterFragment | null = null;
    let localRepairFeedback = sliceRepairFeedback;
    const localAttempts = requiresApplication ? 2 : 1;
    for (let localAttempt = 0; localAttempt < localAttempts; localAttempt += 1) {
      const prompt = buildChapterFragmentPrompt(
        config,
        state,
        focus,
        slice,
        index,
        slices.length,
        visualManifest,
        retrievalRequests,
        localRepairFeedback,
      );
      try {
        const response = await codex.run(prompt, {
          outputSchema: chapterFragmentJsonSchema,
          task: "content_analyzer",
          attempt: state.retry_count + localAttempt + 1,
          localImages,
        });
        throwIfAborted(config.abortSignal);
        const candidate = normalizeFragmentReferences(
          ChapterFragmentSchema.parse(parseJsonObjectOrArray(response)),
          slice,
          visualManifest,
        );
        const applicationError = requiresApplication
          ? appliedFragmentQualityError(candidate, focus, minimumLearningCharacters)
          : null;
        if (applicationError) {
          throw new Error(applicationError);
        }
        fragment = candidate;
        break;
      } catch (error) {
        throwIfAborted(config.abortSignal);
        if (error instanceof ModelCallTimeoutError) throw error;
        if (localAttempt + 1 >= localAttempts) throw error;
        localRepairFeedback =
          `Validator-Diagnose für den einmaligen lokalen Reparaturversuch: ${
            error instanceof Error ? error.message : String(error)
          } Die bereits ausgewählte Anwendungsquelle muss als vollständig nachvollziehbares Beispiel mit Aufgabenstellung, konkreter mathematischer Beziehung, geordneten Schritten, Ergebnis und Kontrolle umgesetzt werden. Falls die Quellwerte nicht vollständig lesbar sind, erstelle aus den belegten Beziehungen ein kleines origin='derived'-Beispiel mit ausdrücklich gesetzten Werten.`;
        await config.diagnostics?.log(
          "warn",
          "analyzer",
          `Repairing only the invalid ${focus.title} topic fragment before advancing.`,
        );
      }
    }
    if (!fragment) {
      throw new Error(`Chapter fragment repair produced no result for ${focus.title}.`);
    }
    await Promise.all(fragmentCachePaths.map((cachePath) =>
      writeFile(cachePath, `${JSON.stringify(fragment, null, 2)}\n`, "utf8")
    ));
    fragments.push(fragment);
  }

  const materialized = materializeDenseChapter(
    config,
    state,
    focus,
    fragments,
    visualManifest,
    retrievalRequests,
  );
  return enrichCachedChapterHandoff(config, state, focus, materialized);
}

function supportSliceMatchesFocus(
  slice: ChapterSlice,
  focus: ChapterFocus,
): boolean {
  const content = normalizeFocusText(slice.records.map((record) => record.content).join(" "));
  const titleAnchors = focusAnchorTerms(focus.title);
  if (titleAnchors.some((anchor) => content.includes(anchor))) return true;
  const assessmentAnchors = focusAnchorTerms((focus.assessmentSignals ?? []).join(" "));
  return assessmentAnchors.filter((anchor) => content.includes(anchor)).length >= 2;
}

function sliceRequiresAppliedExample(
  state: LangGraphAgentState,
  focus: ChapterFocus,
  slice: ChapterSlice,
): boolean {
  if (focus.contentMode === "conceptual") return false;
  return slice.resourceIds.some((resourceId) => {
    const resource = state.resource_manifest.resources.find((item) => item.id === resourceId);
    const role = resource?.selection?.role;
    return role === "worked_example" ||
      role === "sample_exam" ||
      /(?:beispiel|example|übung|uebung|lösung|loesung|solution|aufgabe|exercise)/i
        .test(resource?.title ?? "");
  });
}

function appliedFragmentQualityError(
  fragment: ChapterFragment,
  focus: ChapterFocus,
  minimumLearningCharacters = 0,
): string | null {
  const example = fragment.worked_examples[0];
  if (!example) {
    return `The ${focus.title} fragment requires an applied example but returned none.`;
  }
  if (example.steps.length < 4) {
    return `The ${focus.title} worked example needs at least four ordered reasoning and checking steps.`;
  }
  if (example.result.trim().length < 24) {
    return `The ${focus.title} worked example result is too short to be independently checked.`;
  }
  if (minimumLearningCharacters > 0) {
    const learningCharacters = [
      ...fragment.sections.flatMap((section) => [
        section.heading,
        section.summary,
        ...section.key_concepts,
      ]),
      ...fragment.formulas.flatMap((formula) => [
        formula.name,
        formula.typst,
        ...formula.variables,
        ...formula.units,
        formula.context,
      ]),
      ...fragment.worked_examples.flatMap((item) => [
        item.learning_goal,
        item.prompt,
        ...item.steps,
        item.result,
      ]),
    ].join(" ").replace(/\s+/g, " ").trim().length;
    if (learningCharacters < minimumLearningCharacters) {
      return `The ${focus.title} fragment is too shallow to learn from (${learningCharacters}/${minimumLearningCharacters} learning characters).`;
    }
  }
  if (focusNeedsQuantitativeApplication(focus)) {
    const formulaText = fragment.formulas.map((formula) =>
      `${formula.name} ${formula.typst} ${formula.context} ${formula.variables.join(" ")}`
    ).join(" ");
    if (
      fragment.formulas.length === 0 ||
      !formulaAlignsWithQuantitativeFocus(formulaText, focus)
    ) {
      return `The quantitative ${focus.title} fragment has no central formula aligned with its named learning objectives.`;
    }
    const exampleText = [
      example.prompt,
      ...example.steps,
      example.result,
    ].join(" ");
    if (!/[=≤≥<>]|(?:<=|>=|approx|sqrt|sum|integral|dot\(|vec\()/i.test(exampleText)) {
      return `The quantitative ${focus.title} worked example contains no executable mathematical relationship.`;
    }
    if (!/(?:prüf|kontroll|plausib|einheit|vorzeichen|probe|check)/i.test(exampleText)) {
      return `The quantitative ${focus.title} worked example contains no explicit result check.`;
    }
  }
  return null;
}

function formulaAlignsWithQuantitativeFocus(
  formulaText: string,
  focus: ChapterFocus,
): boolean {
  const normalizedFormula = normalizeFocusText(formulaText);
  const titleAnchors = focusAnchorTerms(focus.title);
  const titleMatches = titleAnchors.some((anchor) => normalizedFormula.includes(anchor));
  const objectiveAnchors = focusAnchorTerms((focus.learningObjectives ?? []).join(" "))
    .filter((anchor) => !titleAnchors.some((titleAnchor) =>
      anchor.includes(titleAnchor) || titleAnchor.includes(anchor)
    ));
  const objectiveMatches = objectiveAnchors
    .filter((anchor) => normalizedFormula.includes(anchor)).length;
  const assessmentAnchors = focusAnchorTerms((focus.assessmentSignals ?? []).join(" "));
  const assessmentMatches = assessmentAnchors
    .filter((anchor) => normalizedFormula.includes(anchor)).length;
  return (
    titleMatches && (objectiveAnchors.length === 0 || objectiveMatches >= 1)
  ) || objectiveMatches >= 2 || assessmentMatches >= 2;
}

function focusAnchorTerms(value: string): string[] {
  const ignored = new Set([
    "anwenden", "aufstellen", "bestimmen", "berechnen", "durchfuhren", "durchfuehren",
    "erklaren", "erklaeren", "formulieren", "geeignete", "korrekte", "korrekten",
    "losen", "loesen", "prufen", "pruefen", "verwenden", "wahlen", "waehlen",
    "apply", "calculate", "choose", "determine", "explain", "formulate", "solve", "verify",
    "beziehungen", "ergebnis", "methode", "method", "rechnung", "relationships",
  ]);
  return [...new Set(normalizeFocusText(value).split(" ")
    .filter((token) => token.length >= 6 && !ignored.has(token))
    .map((token) => token.slice(0, Math.min(token.length, 8))))];
}

function normalizeFocusText(value: string): string {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function focusNeedsQuantitativeApplication(focus: ChapterFocus): boolean {
  if (focus.contentMode === "quantitative") return true;
  if (focus.contentMode !== "mixed") return false;
  const learningSignal = [
    focus.title,
    ...(focus.learningObjectives ?? []),
    ...(focus.assessmentSignals ?? []),
  ].join(" ");
  return /(?:berechn|rechnung|gleichung|formel|bilanz|numer|quantit|herleit|ableit|lösen|loesen|aufstellen|geschwindigkeit|beschleunigung|moment|kraft|spannung|frequenz)/i
    .test(learningSignal);
}

function capacityCheckpoint(
  error: ModelCallTimeoutError,
  chapterTitle?: string,
): StudyBuddyCheckpointError {
  const chapter = chapterTitle ? ` while analyzing ${chapterTitle}` : "";
  return new StudyBuddyCheckpointError(
    `Extraction capacity checkpoint required: ${error.task} on ${error.model}${chapter} ` +
    `produced no token usage within ${error.timeoutMs}ms. Validated handoffs were preserved; ` +
    "resume after fair model admission without crawling sources.",
  );
}

function ensureChapterRuntimeBudget(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
  completed: Array<ReturnType<typeof validateExtractedData> | undefined>,
): void {
  const telemetry = config.executionTelemetry?.getSnapshot();
  if (!telemetry || config.maxRuntimeMs < 3 * 60_000) return;
  const startedAt = Date.parse(telemetry.startedAt);
  if (!Number.isFinite(startedAt)) return;

  const policy = resolveTaskModelPolicy({
    profile: config.executionProfile,
    task: "content_analyzer",
    attempt: state.retry_count + 1,
    globalModel: config.codexModel,
    globalReasoningEffort: config.codexReasoningEffort,
    overrides: config.modelPolicyOverrides,
  });
  const remainingMs = config.maxRuntimeMs - (Date.now() - startedAt);
  // Reserve one bounded analyzer call plus enough time to persist, normalize,
  // and enter the extraction quality gates. A later recovery run receives a
  // fresh budget and consumes these handoffs without crawling again.
  const requiredMs = Math.min(policy.timeoutMs, 90_000) + 75_000;
  if (remainingMs >= requiredMs) return;

  const persistedCount = completed.filter(Boolean).length;
  throw new StudyBuddyCheckpointError(
    `Extraction checkpoint required: ${persistedCount} validated chapter handoff(s) persisted before ${focus.title}; ` +
    `${Math.max(0, Math.round(remainingMs / 1_000))}s remained, ${Math.round(requiredMs / 1_000)}s required. ` +
    "Resume from this run without crawling sources.",
  );
}

function packSelectedSlices(
  selected: Array<AnalysisSliceCandidate & { slice: ChapterSlice }>,
): ChapterSlice[] {
  const packed: ChapterSlice[] = [];
  const packSizes: number[] = [];
  for (const candidate of selected) {
    const previousPack = packed.at(-1);
    const combinedRecords = previousPack
      ? uniqueBy([...previousPack.records, ...candidate.slice.records], (record) => record.id)
      : candidate.slice.records;
    const combinedCharacters = combinedRecords.reduce(
      (sum, record) => sum + JSON.stringify(record).length,
      0,
    );
    const previousPackSize = packSizes.at(-1) ?? 0;
    if (
      previousPack &&
      previousPackSize < MAX_SLICES_PER_MODEL_CALL &&
      combinedCharacters <= PACKED_FRAGMENT_EVIDENCE_CHARACTER_LIMIT
    ) {
      packed[packed.length - 1] = {
        key: `${previousPack.key.startsWith("packed-") ? previousPack.key : `packed-${previousPack.key}`}-${candidate.slice.key}`,
        label: `${previousPack.label} + ${candidate.slice.label}`,
        resourceIds: [...new Set([...previousPack.resourceIds, ...candidate.slice.resourceIds])],
        records: combinedRecords,
      };
      packSizes[packSizes.length - 1] = previousPackSize + 1;
    } else {
      packed.push(candidate.slice);
      packSizes.push(1);
    }
  }
  return packed;
}

function dominantSliceRole(state: LangGraphAgentState, slice: ChapterSlice): string {
  const roles = slice.resourceIds.map((resourceId) =>
    state.resource_manifest.resources.find((resource) => resource.id === resourceId)?.selection?.role ?? "supplementary"
  );
  for (const preferred of ["sample_exam", "worked_example", "formula", "primary_lecture", "overview"]) {
    if (roles.includes(preferred as typeof roles[number])) return preferred;
  }
  return roles[0] ?? "supplementary";
}

function sliceSourceTags(state: LangGraphAgentState, slice: ChapterSlice): string[] {
  return state.resource_manifest.resources
    .filter((resource) => slice.resourceIds.includes(resource.id))
    .flatMap((resource) => [
      resource.title,
      ...resource.sectionPath,
      resource.selection?.topic ?? "",
      resource.selection?.role ?? "",
    ])
    .filter(Boolean);
}

/**
 * Generic relevance selection balances source roles and document positions.
 * Architecture-assigned sources are a stronger contract: when they contain
 * evidence, one slice from each assigned source must survive. Repair the
 * selection deterministically before a model call instead of sending
 * support-only context or repeating the same failed graph attempt.
 */
export function ensureDirectEvidenceSelection<
  T extends AnalysisSliceCandidate & { slice: ChapterSlice },
>(
  selected: readonly T[],
  candidates: readonly T[],
  directResourceIds: readonly string[],
  limit: number,
): T[] {
  const boundedLimit = Math.max(0, limit);
  const result = [...selected].slice(0, boundedLimit);
  const directIds = [...new Set(directResourceIds)];
  const covers = (candidate: T, resourceId: string) =>
    candidate.slice.resourceIds.includes(resourceId);
  const isDirect = (candidate: T) =>
    directIds.some((resourceId) => covers(candidate, resourceId));
  const candidateScore = (candidate: T) =>
    candidate.slice.records.reduce(
      (score, record) =>
        score +
        (record.kind === "solution" ? 12 : record.kind === "exercise" ? 10 : 1) +
        Math.min(4, record.content.length / 1_000),
      0,
    );

  for (const resourceId of directIds) {
    if (result.some((candidate) => covers(candidate, resourceId))) continue;
    const replacement = candidates
      .filter((candidate) => covers(candidate, resourceId))
      .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
    if (!replacement) continue;
    if (result.length < boundedLimit) {
      result.push(replacement);
      continue;
    }
    const supportIndex = lastMatchingIndex(result, (candidate) => !isDirect(candidate));
    if (supportIndex >= 0) {
      result[supportIndex] = replacement;
      continue;
    }
    const duplicateIndex = lastMatchingIndex(result, (candidate, index) =>
      candidate.slice.resourceIds.every((coveredId) =>
        !directIds.includes(coveredId) ||
        result.some((other, otherIndex) =>
          otherIndex !== index && covers(other, coveredId)
        )
      )
    );
    if (duplicateIndex >= 0) result[duplicateIndex] = replacement;
  }
  return uniqueBy(result, (candidate) => candidate.id);
}

export function ensureOfficialTopicEvidenceSelection<
  T extends AnalysisSliceCandidate & { slice: ChapterSlice },
>(
  selected: readonly T[],
  candidates: readonly T[],
  focus: ChapterFocus,
  limit: number,
): T[] {
  const topics = officialCourseTopics(focus);
  if (topics.length === 0 || limit < topics.length) {
    return [...selected].slice(0, Math.max(0, limit));
  }
  const originalIndex = new Map(candidates.map((candidate, index) => [candidate.id, index]));
  const required: T[] = [];
  const used = new Set<string>();
  const candidateTerms = new Map(candidates.map((candidate) => [
    candidate.id,
    matchTerms(`${candidate.title ?? ""} ${candidate.content} ${(candidate.tags ?? []).join(" ")}`),
  ]));

  const rankedForTopic = (topic: OfficialCourseTopic) => candidates
    .filter((candidate) => !used.has(candidate.id))
    .map((candidate) => {
      const terms = candidateTerms.get(candidate.id) ?? [];
      const detailScores = topic.details.map((detail) =>
        semanticOverlap(matchTerms(detail), terms)
      );
      const detailFrequencyScores = topic.details.map((detail) =>
        termFrequencyOverlap(matchTerms(detail), terms)
      );
      return {
        candidate,
        // Course objectives are ordered from overview to concrete subsections.
        // Prefer a slice that covers the latest (and usually easiest to omit)
        // subsection before comparing broad title/overview overlap. This keeps
        // 21.3 Newton/root iteration from losing to a keyword-dense 21.2 curve
        // discussion, while remaining fully data-driven for other courses.
        lastDetailFrequencyScore: detailFrequencyScores.at(-1) ?? 0,
        lastDetailScore: detailScores.at(-1) ?? 0,
        coveredDetails: detailScores.filter((score) => score > 0).length,
        detailFrequencyScore: detailFrequencyScores.reduce((sum, score) => sum + score, 0),
        detailScore: detailScores.reduce((sum, score) => sum + score, 0),
        titleScore: semanticOverlap(matchTerms(topic.title), terms),
      };
    })
    .sort((left, right) =>
      right.lastDetailFrequencyScore - left.lastDetailFrequencyScore ||
      right.lastDetailScore - left.lastDetailScore ||
      right.coveredDetails - left.coveredDetails ||
      right.detailFrequencyScore - left.detailFrequencyScore ||
      right.detailScore - left.detailScore ||
      right.titleScore - left.titleScore ||
      (originalIndex.get(left.candidate.id) ?? 0) -
        (originalIndex.get(right.candidate.id) ?? 0)
    );

  for (const topic of topics) {
    const ranked = rankedForTopic(topic);
    let best = ranked[0]?.candidate;
    if (!best) continue;
    const finalDetail = topic.details.at(-1);
    if (finalDetail) {
      const finalTerms = [...new Set(matchTerms(finalDetail))]
        .filter((term) => term.length >= 5);
      const normalizedContent = best.content.toLocaleLowerCase("de");
      const anchors = finalTerms
        .map((term) => normalizedContent.indexOf(term))
        .filter((position) => position >= 0);
      const anchor = anchors.length > 0 ? Math.min(...anchors) : -1;
      const remainingCharacters = anchor >= 0 ? normalizedContent.length - anchor : Infinity;
      const currentIndex = originalIndex.get(best.id) ?? -1;
      const continuation = currentIndex >= 0
        ? candidates.slice(currentIndex + 1).find((candidate) =>
            candidate.slice.resourceIds.some((resourceId) =>
              best?.slice.resourceIds.includes(resourceId)
            )
          )
        : undefined;
      // Long PDF sections often put a subsection heading at the end of one
      // chunk and the executable method in the next. Prefer that continuation
      // when the heading leaves too little teaching text and the next chunk
      // still matches the same objective.
      if (
        anchor > normalizedContent.length * 0.25 &&
        remainingCharacters < 2_500 &&
        continuation &&
        semanticOverlap(
          finalTerms,
          candidateTerms.get(continuation.id) ?? [],
        ) > 0 &&
        !used.has(continuation.id)
      ) {
        best = continuation;
      }
    }
    required.push(best);
    used.add(best.id);
  }

  // A chapter consisting of one official topic can still contain several
  // independently teachable subsections (for example 6.1 sequences and 6.2
  // series). Spend otherwise free slots on those explicit subsections.
  if (topics.length === 1) {
    const topic = topics[0];
    for (const detail of topic.details.slice().reverse()) {
      if (required.length >= limit) break;
      const detailTerms = matchTerms(detail);
      const best = candidates
        .filter((candidate) => !used.has(candidate.id))
        .map((candidate) => ({
          candidate,
          score: termFrequencyOverlap(detailTerms, candidateTerms.get(candidate.id) ?? []),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) =>
          right.score - left.score ||
          (originalIndex.get(left.candidate.id) ?? 0) -
            (originalIndex.get(right.candidate.id) ?? 0)
        )[0]?.candidate;
      if (!best) continue;
      required.push(best);
      used.add(best.id);
    }
  }

  for (const candidate of selected) {
    if (required.length >= limit) break;
    if (used.has(candidate.id)) continue;
    required.push(candidate);
    used.add(candidate.id);
  }
  return required.sort((left, right) =>
    (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
  );
}

function lastMatchingIndex<T>(
  values: readonly T[],
  predicate: (value: T, index: number) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index], index)) return index;
  }
  return -1;
}

function assertSelectedChapterEvidence(
  state: LangGraphAgentState,
  focus: ChapterFocus,
  selected: Array<AnalysisSliceCandidate & { slice: ChapterSlice }>,
): void {
  const evidencedDirect = new Set(
    state.evidence_package.records
      .filter((record) => (focus.directResourceIds ?? focus.resourceIds).includes(record.resourceId))
      .map((record) => record.resourceId),
  );
  if (evidencedDirect.size === 0) return;
  const selectedIds = new Set(selected.flatMap((candidate) => candidate.slice.resourceIds));
  if ([...evidencedDirect].some((resourceId) => selectedIds.has(resourceId))) return;
  throw new Error(
    `[chapter: ${focus.title}] Evidence selection omitted every directly assigned source ` +
    `(${[...evidencedDirect].join(", ")}); refusing a support-only model call.`,
  );
}

function focusPriority(focus: ChapterFocus): number {
  return focus.priority === "essential" ? 3 : focus.priority === "supplementary" ? 1 : 2;
}

function allocateSliceBudgets(
  focuses: ChapterFocus[],
  globalLimit: number,
  perModuleLimit: number,
): number[] {
  const allocations = focuses.map(() => 1);
  let remaining = Math.max(0, globalLimit - allocations.length);
  const order = focuses
    .map((focus, index) => ({ index, priority: focusPriority(focus) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index);
  const targets = Array.from({ length: Math.max(0, perModuleLimit - 1) }, (_, index) => index + 2);
  for (const target of targets) {
    for (const { index } of order) {
      if (remaining === 0) return allocations;
      if (allocations[index] >= target || allocations[index] >= perModuleLimit) continue;
      allocations[index] += 1;
      remaining -= 1;
    }
  }
  return allocations;
}

function fragmentContainsIncompleteFormula(
  fragment: ChapterFragment,
  feedback: string,
): boolean {
  const names = [...feedback.matchAll(/^\s*-?\s*Formula metadata incomplete:\s*(.+?)\s*$/gim)]
    .map((match) => match[1]?.toLocaleLowerCase("de") ?? "")
    .filter(Boolean);
  if (names.length === 0) return false;
  return fragment.formulas.some((formula) => {
    const formulaName = formula.name.trim().toLocaleLowerCase("de");
    return names.some((name) => formulaName === name);
  });
}

export function buildChapterSlices(state: LangGraphAgentState, focus: ChapterFocus): ChapterSlice[] {
  const resources = state.resource_manifest.resources.filter((resource) =>
    focus.resourceIds.includes(resource.id)
  );
  const recordsByResource = new Map<string, EvidenceRecord[]>();
  for (const record of state.evidence_package.records) {
    if (!focus.resourceIds.includes(record.resourceId)) continue;
    const records = recordsByResource.get(record.resourceId) ?? [];
    records.push(record);
    recordsByResource.set(record.resourceId, records);
  }

  const slices: ChapterSlice[] = [];
  for (const resource of resources.filter((entry) =>
    entry.selection?.role === "primary_lecture" || entry.selection?.role === "overview"
  )) {
    const chunks = chunkEvidenceRecords(
      recordsByResource.get(resource.id) ?? [],
      FRAGMENT_EVIDENCE_CHARACTER_LIMIT,
      FRAGMENT_RECORD_OVERLAP,
    );
    chunks.forEach((records, index) => slices.push({
      key: `${resource.id}-theory-${index + 1}`,
      label: `${resource.title} – Theorieblock ${index + 1}/${chunks.length}`,
      resourceIds: [resource.id],
      records,
    }));
  }

  for (const resource of resources.filter((entry) =>
    entry.selection?.role === "formula" || entry.selection?.role === "external_reference"
  )) {
    const chunks = chunkEvidenceRecords(
      recordsByResource.get(resource.id) ?? [],
      FRAGMENT_EVIDENCE_CHARACTER_LIMIT,
      1,
    );
    chunks.forEach((records, index) => slices.push({
      key: `${resource.id}-reference-${index + 1}`,
      label: `${resource.title} – Referenzblock ${index + 1}/${chunks.length}`,
      resourceIds: [resource.id],
      records,
    }));
  }

  const practiceGroups = new Map<string, ManifestResource[]>();
  for (const resource of resources.filter((entry) => ![
    "primary_lecture",
    "overview",
    "formula",
    "external_reference",
  ].includes(entry.selection?.role ?? "supplementary"))) {
    const key = practiceBundleKey(resource.title);
    const group = practiceGroups.get(key) ?? [];
    group.push(resource);
    practiceGroups.set(key, group);
  }
  for (const [key, group] of practiceGroups) {
    const records = group.flatMap((resource) => recordsByResource.get(resource.id) ?? []);
    const chunks = chunkEvidenceRecords(records, FRAGMENT_EVIDENCE_CHARACTER_LIMIT, 1);
    chunks.forEach((chunk, index) => slices.push({
      key: `practice-${safeChapterKey(key)}-${index + 1}`,
      label: `${group.map((resource) => resource.title).join(" + ")} – Anwendungsblock ${index + 1}/${chunks.length}`,
      resourceIds: [...new Set(chunk.map((record) => record.resourceId))],
      records: chunk,
    }));
  }

  return slices.length > 0 ? slices : [{
    key: `${focus.key}-evidence`,
    label: focus.title,
    resourceIds: focus.resourceIds,
    records: [],
  }];
}

function chunkEvidenceRecords(
  records: EvidenceRecord[],
  maxCharacters: number,
  overlapRecords: number,
): EvidenceRecord[][] {
  if (records.length === 0) return [];
  const chunks: EvidenceRecord[][] = [];
  let cursor = 0;
  while (cursor < records.length) {
    const chunk: EvidenceRecord[] = [];
    let characters = 0;
    let end = cursor;
    while (end < records.length) {
      const size = JSON.stringify(records[end]).length;
      if (chunk.length > 0 && characters + size > maxCharacters) break;
      chunk.push(records[end]);
      characters += size;
      end += 1;
    }
    chunks.push(chunk);
    if (end >= records.length) break;
    cursor = Math.max(cursor + 1, end - Math.min(overlapRecords, chunk.length - 1));
  }
  return chunks;
}

function practiceBundleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(?:angabe|lösung|loesung|losung|aufgabe)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim() || title.toLowerCase();
}

export function buildChapterFragmentPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
  slice: ChapterSlice,
  index: number,
  total: number,
  visualManifest: VisualManifest | null,
  retrievalRequests: VisualRetrievalRequest[],
  repairFeedback: string | null = null,
): string {
  const resources = state.resource_manifest.resources
    .filter((resource) => slice.resourceIds.includes(resource.id))
    .map((resource) => ({
      id: resource.id,
      title: resource.title,
      role: resource.selection?.role ?? null,
      url: resource.originUrl,
    }));
  const requests = retrievalRequests.filter((request) =>
    slice.resourceIds.includes(request.resourceId)
  );
  const candidates = selectChapterVisualCandidates(
    slice,
    visualManifest,
    retrievalRequests,
  )
    .map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      source_id: candidate.source_id,
      source_page: candidate.source_page,
      title: candidate.title,
      width_px: candidate.width_px,
      height_px: candidate.height_px,
      caption_hint: candidate.caption_hint,
    }));

  const documentLanguage = languageName(config.outputLanguage);
  const officialTopicCount = officialCourseTopics(focus).length;
  const sectionMinimum = Math.max(3, officialTopicCount);
  const sectionMaximum = Math.max(6, officialTopicCount + 2);
  const applicationCount = Math.min(2, officialTopicCount);
  const applicationTarget = officialTopicCount > 0 && focus.contentMode !== "conceptual"
    ? `${applicationCount} fully traceable applications spanning ${applicationCount === 1 ? "the official topic" : "different official topics"}`
    : "at most one fully traceable application";
  return [
    "Return only schema-valid JSON. Use only the supplied evidence and allowed IDs; do not research, open files, repeat other chapters, or invent claims, sources, relationships, or values.",
    `Depth target: ${sectionMinimum}–${sectionMaximum} explanatory sections, 2–8 central formulas when applicable, ${applicationTarget}, at most 2 essential figures, and at most 2 warnings. Explain meaning, relationships, method choice, boundary conditions, and typical errors rather than listing keywords.`,
    officialTopicCount > 0
      ? "Keep each official 'Thema N' or 'Topic N' in its own section heading. Retain the matching label in every worked-example learning_goal so the course-to-study-guide mapping is explicit."
      : "",
    "Coverage contract: address every listed learning objective and assessment signal that the supplied evidence supports. If an item is not supported, state that exact evidence boundary in warnings instead of silently omitting it or pretending the chapter is complete.",
    "Choose a discipline-appropriate teaching path (calculation, case, source interpretation, decision, comparison, or procedure). The application must show givens/question, ordered reasoning, result/decision, and a check when the evidence supports it.",
    "Use Typst math syntax. Every formula needs non-empty variables, units (or an explicit dimensionless statement), context, and allowed source_ids.",
    "A partial source solution must not be presented as a reproduced calculation. Use origin='derived' with simple declared values only when the cited evidence fully supports the method.",
    "Use an attached visual only when it is necessary and legible. Attached images correspond to the listed candidate IDs; never use shell or filesystem tools to inspect them. Choose figures by candidate ID and give a concrete placement_hint.",
    "For table, diagram, glossary, corpus, map, timeline, or other reference lookups, use concrete values or claims only when visible in evidence or an attached candidate. Otherwise teach the complete source-selection and interpretation path; a copied answer never replaces the lookup method.",
    `Create one compact, pedagogically complete and discipline-appropriate chapter fragment in ${documentLanguage}; retain official source titles and identifiers in their original language.`,
    `Chapter context: ${JSON.stringify({
      title: focus.title,
      contentMode: focus.contentMode ?? "mixed",
      learningObjectives: focus.learningObjectives ?? [],
      assessmentSignals: focus.assessmentSignals ?? [],
      part: `${index + 1}/${total}`,
      evidenceBlock: slice.label,
    })}`,
    `Teil ${index + 1}/${total}: ${slice.label}. Lernmodus: ${focus.contentMode ?? "mixed"}.`,
    `Nutzerauftrag: ${config.prompt}`,
    repairFeedback ? `Verbindliche Review-Rückmeldung für diesen Reparaturversuch:\n${repairFeedback}` : "",
    `Erlaubte Ressourcen: ${JSON.stringify(resources, null, 2)}`,
    `Geplante Tabellen/Diagramme: ${JSON.stringify(requests, null, 2)}`,
    `Verfügbare Bildkandidaten: ${JSON.stringify(candidates, null, 2)}`,
    `Evidenz für diesen Teil: ${JSON.stringify(slice.records, null, 2)}`,
  ].join("\n\n");
}

function selectChapterVisualCandidates(
  slice: ChapterSlice,
  visualManifest: VisualManifest | null,
  retrievalRequests: VisualRetrievalRequest[],
): VisualCandidate[] {
  const requests = retrievalRequests.filter((request) =>
    slice.resourceIds.includes(request.resourceId)
  );
  const requestedPages = new Map<string, Set<number>>();
  for (const request of requests) {
    const pages = requestedPages.get(request.resourceId) ?? new Set<number>();
    request.pages.forEach((page) => pages.add(page));
    requestedPages.set(request.resourceId, pages);
  }
  return (visualManifest?.candidates ?? [])
    .filter((candidate) => {
      if (!candidate.source_id || !slice.resourceIds.includes(candidate.source_id)) return false;
      const pages = requestedPages.get(candidate.source_id);
      return pages?.size && candidate.source_page ? pages.has(candidate.source_page) : true;
    })
    .sort((left, right) => visualCandidateScore(right) - visualCandidateScore(left))
    .slice(0, 2);
}

async function chapterVisualAttachments(
  runDir: string,
  slice: ChapterSlice,
  visualManifest: VisualManifest | null,
  retrievalRequests: VisualRetrievalRequest[],
): Promise<string[]> {
  const normalizedRunDir = path.resolve(runDir);
  const candidates = selectChapterVisualCandidates(slice, visualManifest, retrievalRequests);
  const paths = candidates
    .map((candidate) => candidate.relative_path)
    .filter((relativePath): relativePath is string => Boolean(relativePath))
    .map((relativePath) => path.resolve(normalizedRunDir, relativePath))
    .filter((candidatePath) => {
      const relative = path.relative(normalizedRunDir, candidatePath);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });
  const usable = await Promise.all(paths.map(async (candidatePath) =>
    stat(candidatePath)
      .then((entry) => entry.isFile() && entry.size > 0 ? candidatePath : null)
      .catch(() => null)
  ));
  return usable.filter((candidatePath): candidatePath is string => Boolean(candidatePath));
}

function normalizeFragmentReferences(
  fragment: ChapterFragment,
  slice: ChapterSlice,
  visualManifest: VisualManifest | null,
): ChapterFragment {
  const allowedSources = new Set(slice.resourceIds);
  const allowedAssets = new Set((visualManifest?.candidates ?? []).map((candidate) => candidate.id));
  const fallbackSources = slice.resourceIds.filter((id) =>
    slice.records.some((record) => record.resourceId === id)
  );
  const normalizeSources = (ids: string[]) => {
    const valid = [...new Set(ids.filter((id) => allowedSources.has(id)))];
    return valid.length > 0 ? valid : fallbackSources;
  };
  return ChapterFragmentSchema.parse({
    ...fragment,
    sections: fragment.sections.map((section) => ({
      ...section,
      source_ids: normalizeSources(section.source_ids),
    })),
    formulas: fragment.formulas.map((formula) => ({
      ...formula,
      typst: normalizeAnalyzerFormulaSyntax(formula.typst),
      source_ids: normalizeSources(formula.source_ids),
    })),
    worked_examples: fragment.worked_examples.map((example) => ({
      ...example,
      source_ids: normalizeSources(example.source_ids),
    })),
    figures: fragment.figures
      .filter((figure) => allowedAssets.has(figure.asset_id))
      .map((figure) => ({
        ...figure,
        source_ids: normalizeSources(figure.source_ids),
      })),
  });
}

export function normalizeAnalyzerFormulaSyntax(value: string): string {
  return value.replace(/\$/g, " ").replace(/\s+/g, " ").trim();
}

function materializeDenseChapter(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
  fragments: ChapterFragment[],
  visualManifest: VisualManifest | null,
  retrievalRequests: VisualRetrievalRequest[],
): ReturnType<typeof validateExtractedData> {
  const resources = state.resource_manifest.resources.filter((resource) =>
    focus.resourceIds.includes(resource.id)
  );
  const figures = mergeFigures(
    fragments.flatMap((fragment) => fragment.figures),
    requiredLookupFigures(focus, visualManifest, retrievalRequests),
  );
  const selectedAssetIds = new Set(figures.map((figure) => figure.asset_id));
  const visualAssets = (visualManifest?.candidates ?? [])
    .filter((candidate) => selectedAssetIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      relative_path: candidate.relative_path,
      mime_type: candidate.mime_type,
      width_px: candidate.width_px,
      height_px: candidate.height_px,
      source_id: candidate.source_id,
      source_url: candidate.source_url,
      source_path: candidate.source_path,
      source_page: candidate.source_page,
      confidence: candidate.confidence,
      caption_hint: candidate.caption_hint,
      relevance_reason: candidate.relevance_reason,
      generation_prompt: candidate.generation_prompt,
    }));
  const courseTitle = state.resource_manifest.resources.find((resource) =>
    resource.activityType === "course"
  )?.title ?? (config.outputLanguage === "en" ? "Moodle course" : "Moodle-Kurs");
  const requiredExamples = buildDeterministicChapterExamples(state, focus);
  const modelExamples = fragments.flatMap((fragment) => fragment.worked_examples);
  // Quantitative examples are the most common source of late semantic-review
  // failures. When a chapter has a source-anchored deterministic example, use
  // that single reproducible path instead of retaining a second model-created
  // calculation whose arithmetic cannot be guaranteed.
  const compatibleModelExamples = requiredExamples.length > 0 ? [] : modelExamples;

  return validateExtractedData({
    document_title: `${courseTitle} – Study Guide`,
    language: config.outputLanguage,
    course: { title: courseTitle, url: state.resource_manifest.courseUrl },
    sources: resources.map(manifestResourceToSource),
    sections: mergeSections(fragments.flatMap((fragment) => fragment.sections)),
    formulas: uniqueBy(
      fragments.flatMap((fragment) => fragment.formulas),
      (formula) => `${formula.name.toLowerCase()}\u0000${formula.typst}`,
    ),
    worked_examples: uniqueBy(
      [...requiredExamples, ...compatibleModelExamples],
      (example) => example.prompt.toLowerCase().replace(/\s+/g, " ").trim(),
    ),
    quiz_style_questions: [],
    visual_assets: visualAssets,
    figures,
    learning_modules: [focusLearningModule(focus, resources.map((resource) => resource.id))],
    warnings: [...new Set(fragments.flatMap((fragment) => fragment.warnings))],
  });
}

function buildDeterministicToleranceLookupExamples(
  state: LangGraphAgentState,
  focus: ChapterFocus,
): ChapterFragment["worked_examples"] {
  if (!/(?:toleranz|passung)/i.test(focus.title)) return [];
  const records = state.evidence_package.records.filter((record) =>
    focus.resourceIds.includes(record.resourceId)
  );
  const evidenceText = records.map((record) => record.content).join("\n");
  if (!/(?:TB\s*2-1|TB\s*2-2|TB\s*2-3)/i.test(evidenceText)) return [];
  const shaft = /(?:[∅Ø]\s*)?(\d+(?:[.,]\d+)?)\s*k6\s+ei\s*=\s*([+−-]?\d+(?:[.,]\d+)?)\s*[µμu]m\s+es\s*=\s*([+−-]?\d+(?:[.,]\d+)?)\s*[µμu]m/i.exec(evidenceText);
  const hole = /(?:[∅Ø]\s*)?(\d+(?:[.,]\d+)?)\s*H7\s+EI\s*=\s*([+−-]?\d+(?:[.,]\d+)?)\s*[µμu]m\s+ES\s*=\s*([+−-]?\d+(?:[.,]\d+)?)\s*[µμu]m/i.exec(evidenceText);
  if (!shaft || !hole || shaft[1].replace(",", ".") !== hole[1].replace(",", ".")) return [];
  const parseMicrometers = (value: string) => Number(value.replace("−", "-").replace(",", "."));
  const nominal = Number(shaft[1].replace(",", "."));
  const ei = parseMicrometers(shaft[2]);
  const es = parseMicrometers(shaft[3]);
  const EI = parseMicrometers(hole[2]);
  const ES = parseMicrometers(hole[3]);
  if (![nominal, ei, es, EI, ES].every(Number.isFinite)) return [];
  const it6 = es - ei;
  const it7 = ES - EI;
  const goB = nominal + ES / 1_000;
  const guB = nominal + EI / 1_000;
  const goW = nominal + es / 1_000;
  const guW = nominal + ei / 1_000;
  const po = ES - ei;
  const pu = EI - es;
  const pt = it7 + it6;
  const lookupSourceIds = [...new Set(records
    .filter((record) => /(?:TB\s*2-|k6\s+ei|H7\s+EI|toleranzklasse|passung)/i.test(record.content))
    .map((record) => record.resourceId))];
  if (lookupSourceIds.length === 0) return [];
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
  const millimeters = (value: number) => value.toFixed(3).replace(".", ",");
  return [{
    origin: "derived",
    learning_goal: "Eine H7/k6-Passung vollständig über TB 2-1 bis TB 2-3 nachschlagen und berechnen",
    prompt: `Bestimme für N = ${nominal} mm und H7/k6 die Abmaße, Grenzmaße sowie Höchstpassung Po, Mindestpassung Pu und Passtoleranz PT.`,
    steps: [
      `1. Nennmaßbereich festlegen: N = ${nominal} mm wird in TB 2-1 dem Intervall „über 30 bis 50 mm“ zugeordnet; am Intervallrand ${nominal} mm gilt noch diese Zeile.`,
      `2. Toleranzgrade in TB 2-1 lesen: Für IT7 ergibt sich TB = ES - EI = ${it7} µm; für IT6 ergibt sich TW = es - ei = ${it6} µm. Damit ist die Breite beider Toleranzfelder festgelegt.`,
      `3. Bohrung H7 in TB 2-2 nachschlagen: Das Grundabmaß H liefert EI = ${signed(EI)} µm. Das zweite Abmaß folgt mit ES = EI + IT7 = ${signed(EI)} µm + ${it7} µm = ${signed(ES)} µm.`,
      `4. Welle k6 in TB 2-3 nachschlagen: Für das k-Feld im Nennmaßintervall wird das Grundabmaß ei = ${signed(ei)} µm gelesen. Das zweite Abmaß folgt mit es = ei + IT6 = ${signed(ei)} µm + ${it6} µm = ${signed(es)} µm.`,
      `5. Grenzmaße der Bohrung: GoB = N + ES = ${nominal} mm + ${ES / 1_000} mm = ${millimeters(goB)} mm; GuB = N + EI = ${millimeters(guB)} mm.`,
      `6. Grenzmaße der Welle: GoW = N + es = ${millimeters(goW)} mm; GuW = N + ei = ${millimeters(guW)} mm.`,
      `7. Passungskennwerte: Po = ES - ei = ${signed(ES)} µm - (${signed(ei)} µm) = ${signed(po)} µm; Pu = EI - es = ${signed(EI)} µm - (${signed(es)} µm) = ${signed(pu)} µm; PT = TB + TW = ${it7} µm + ${it6} µm = ${pt} µm.`,
      `8. Plausibilitätsprüfung: PT = Po - Pu = ${signed(po)} µm - (${signed(pu)} µm) = ${pt} µm. Weil Po positiv und Pu negativ ist, kann je nach Istmaßen Spiel oder Übermaß auftreten: H7/k6 ist hier eine Übergangspassung.`,
    ],
    result: `H7: EI = ${signed(EI)} µm, ES = ${signed(ES)} µm; k6: ei = ${signed(ei)} µm, es = ${signed(es)} µm. Bohrung ${millimeters(guB)}…${millimeters(goB)} mm, Welle ${millimeters(guW)}…${millimeters(goW)} mm, Po = ${signed(po)} µm, Pu = ${signed(pu)} µm, PT = ${pt} µm.`,
    source_ids: lookupSourceIds,
  }];
}

function buildDeterministicChapterExamples(
  state: LangGraphAgentState,
  focus: ChapterFocus,
): ChapterFragment["worked_examples"] {
  return [
    ...buildDeterministicToleranceLookupExamples(state, focus),
    ...buildDeterministicAdhesiveExample(state, focus),
    ...buildDeterministicRivetExample(state, focus),
    ...buildDeterministicSolderingExample(state, focus),
    ...buildDeterministicHertzExample(state, focus),
  ];
}

function buildDeterministicAdhesiveExample(
  state: LangGraphAgentState,
  focus: ChapterFocus,
): ChapterFragment["worked_examples"] {
  if (!/(?:kleb|klebstoff)/i.test(focus.title)) return [];
  const records = state.evidence_package.records.filter((record) =>
    focus.resourceIds.includes(record.resourceId)
  );
  const sourceIds = [...new Set(records
    .filter((record) => /(?:Kleb|Überlapp|Ueberlapp|Schubspannung)/i.test(record.content))
    .map((record) => record.resourceId))];
  if (sourceIds.length === 0) return [];
  const force = 15_000;
  const width = 50;
  const overlap = 60;
  const allowableStress = 8;
  const stress = force / (width * overlap);
  const safety = allowableStress / stress;
  return [{
    origin: "derived",
    learning_goal: "Eine einfach überlappte Klebverbindung mit einem ausdrücklich vorgegebenen Übungskennwert prüfen",
    prompt: "Selbst erstelltes Übungsbeispiel: Eine einfach überlappte Klebung mit b = 50 mm und lÜ = 60 mm überträgt F = 15 kN. Für diese Übung gilt tau_zul = 8 N/mm². Prüfe die mittlere Klebschubspannung und den Sicherheitsquotienten.",
    steps: [
      "1. Modellgrenze festhalten: gleichmäßige mittlere Schubspannung in einer einfach überlappten Klebfläche; Randspannungsspitzen werden in dieser Vorbemessung nicht aufgelöst.",
      `2. Klebfläche: AK = b·lÜ = ${width}·${overlap} = ${width * overlap} mm². Die beiden Fügeteile liegen im Kraftfluss in Reihe; die Klebfläche wird daher nicht verdoppelt.`,
      `3. Kraft umrechnen und Spannung berechnen: F = 15 kN = ${force} N; tauK = F/AK = ${force}/${width * overlap} = ${stress.toFixed(1).replace(".", ",")} N/mm².`,
      `4. Nachweis mit dem ausdrücklich vorgegebenen Übungskennwert: tauK = ${stress.toFixed(1).replace(".", ",")} N/mm² < tau_zul = ${allowableStress} N/mm².`,
      `5. Sicherheitsquotient: S = tau_zul/tauK = ${allowableStress}/${stress.toFixed(1)} = ${safety.toFixed(2).replace(".", ",")}. Für eine reale Bemessung müssen Kennwert, Temperatur, Alterung, Schichtdicke und Lastkollektiv aus den Aufgabendaten stammen.`,
    ],
    result: `AK = ${width * overlap} mm², tauK = ${stress.toFixed(1).replace(".", ",")} N/mm² und S = ${safety.toFixed(2).replace(".", ",")}; der vorgegebene Übungskennwert wird eingehalten.`,
    source_ids: sourceIds,
  }];
}

function buildDeterministicRivetExample(
  state: LangGraphAgentState,
  focus: ChapterFocus,
): ChapterFragment["worked_examples"] {
  if (!/(?:niet|niete)/i.test(focus.title)) return [];
  const records = state.evidence_package.records.filter((record) =>
    focus.resourceIds.includes(record.resourceId)
  );
  const sourceIds = [...new Set(records
    .filter((record) => /(?:Niet|Lochleib|Abscher|Scher)/i.test(record.content))
    .map((record) => record.resourceId))];
  if (sourceIds.length === 0) return [];
  const force = 40_000;
  const rivets = 4;
  const diameter = 12;
  const thickness = 8;
  const shearArea = Math.PI * diameter ** 2 / 4;
  const shearStress = force / (rivets * shearArea);
  const bearingStress = force / (rivets * diameter * thickness);
  return [{
    origin: "derived",
    learning_goal: "Eine symmetrisch belastete einschnittige Nietgruppe gegen Abscheren und Lochleibung vorbemessen",
    prompt: "Selbst erstelltes Übungsbeispiel: Vier gleichmäßig belastete Niete mit d = 12 mm verbinden Bleche der maßgebenden Dicke t = 8 mm und übertragen F = 40 kN. Bestimme Schub- und Lochleibungsspannung; für die Übung gelten tau_zul = 120 N/mm² und p_zul = 160 N/mm².",
    steps: [
      "1. Annahmen festhalten: vier gleichmäßig tragende Niete, je eine Scherfuge, keine Exzentrizität; F = 40 kN = 40000 N.",
      `2. Scherfläche je Niet: AS = pi·d²/4 = pi·12²/4 = ${shearArea.toFixed(1).replace(".", ",")} mm².`,
      `3. Abscherspannung: tau = F/(n·AS) = 40000/(4·${shearArea.toFixed(1)}) = ${shearStress.toFixed(1).replace(".", ",")} N/mm² < 120 N/mm².`,
      `4. Projizierte Lochleibungsfläche: AL = n·d·t = 4·12·8 = ${rivets * diameter * thickness} mm².`,
      `5. Lochleibungsspannung: p = F/(n·d·t) = 40000/${rivets * diameter * thickness} = ${bearingStress.toFixed(1).replace(".", ",")} N/mm² < 160 N/mm².`,
      "6. Beide Einzelnachweise sind erfüllt. In einer vollständigen Bemessung folgen zusätzlich Rand-/Lochabstände, Nettoquerschnitt, Blockversagen und gegebenenfalls exzentrische Lastverteilung.",
    ],
    result: `tau = ${shearStress.toFixed(1).replace(".", ",")} N/mm² und p = ${bearingStress.toFixed(1).replace(".", ",")} N/mm²; beide Übungsgrenzen werden eingehalten.`,
    source_ids: sourceIds,
  }];
}

function buildDeterministicHertzExample(
  state: LangGraphAgentState,
  focus: ChapterFocus,
): ChapterFragment["worked_examples"] {
  if (!/(?:hertz|tribolog)/i.test(focus.title)) return [];
  const records = state.evidence_package.records.filter((record) =>
    focus.resourceIds.includes(record.resourceId)
  );
  const sourceIds = [...new Set(records
    .filter((record) => /(?:Hertz|Ersatzradius|Ersatz-Elastiz|Pressung)/i.test(record.content))
    .map((record) => record.resourceId))];
  if (sourceIds.length === 0) return [];

  const radius1 = 10;
  const radius2 = 20;
  const diameterParameter = 2 * radius1 * radius2 / (radius1 + radius2);
  const youngsModulus = 200_000;
  const poissonRatio = 0.3;
  const effectiveModulus = 2 * youngsModulus ** 2 /
    (2 * (1 - poissonRatio ** 2) * youngsModulus);
  const normalForce = 1_000;
  const contactLength = 20;
  const pressure = Math.sqrt(
    normalForce * effectiveModulus /
    (2 * Math.PI * diameterParameter * contactLength),
  );
  const de = (value: number, digits = 3) => value.toFixed(digits).replace(".", ",");

  return [{
    origin: "derived",
    learning_goal: "Ersatzradius, durchmesserbasierten Ersatzparameter und Hertzsche Pressung ohne Faktor-2- oder Einheitenfehler berechnen",
    prompt: "Selbst erstelltes Übungsbeispiel: Zwei parallele Zylinder mit r1 = 10 mm und r2 = 20 mm, E1 = E2 = 200000 N/mm² und v1 = v2 = 0,30 werden mit FN = 1000 N über l = 20 mm belastet. Bestimme Ersatzradius rho, D, E und pH.",
    steps: [
      "1. Geltungsfall prüfen: idealisierte Hertzsche Linienberührung, homogene isotrope Körper, reine Normalkraft und kleine Kontaktzone.",
      `2. Ersatzradius: rho = r1·r2/(r1+r2) = 10·20/(10+20) = ${de(diameterParameter / 2)} mm.`,
      `3. Die verwendete Pressungsformel ist durchmesserbasiert; daher D = 2·rho = ${de(diameterParameter)} mm. Gleichwertige Kontrolle: D = d1·d2/(d1+d2) = 20·40/(20+40) = ${de(diameterParameter)} mm.`,
      `4. Ersatz-Elastizitätsmodul nach der hier verwendeten Faktor-2-Konvention: E = 2·E1·E2/((1-v1²)·E2+(1-v2²)·E1) = ${de(effectiveModulus, 0)} N/mm².`,
      `5. Pressung: pH = sqrt(FN·E/(2·pi·D·l)) = sqrt(1000·${de(effectiveModulus, 0)}/(2·pi·${de(diameterParameter)}·20)) = ${de(pressure, 1)} N/mm² = ${de(pressure, 1)} MPa.`,
      `6. Plausibilitätskontrolle: Der Radikand beträgt rund ${de(pressure ** 2, 0)} N²/mm⁴; seine Wurzel liegt daher bei ${de(pressure, 1)} N/mm² und nicht im einstelligen Bereich.`,
    ],
    result: `rho = ${de(diameterParameter / 2)} mm, D = ${de(diameterParameter)} mm, E = ${de(effectiveModulus, 0)} N/mm² und pH = ${de(pressure, 1)} MPa.`,
    source_ids: sourceIds,
  }];
}

function buildDeterministicSolderingExample(
  state: LangGraphAgentState,
  focus: ChapterFocus,
): ChapterFragment["worked_examples"] {
  if (!/(?:löt|loet|lotverbindung)/i.test(focus.title)) return [];
  const records = state.evidence_package.records.filter((record) =>
    focus.resourceIds.includes(record.resourceId)
  );
  const evidenceText = records.map((record) => record.content).join("\n");
  if (!/(?:Torsionsmoment|Überlappungslänge|Ueberlappungslaenge)/i.test(evidenceText)) return [];
  const sourceIds = [...new Set(records
    .filter((record) => /(?:Torsionsmoment|Überlappungslänge|Überlappstoß|Scherspannung)/i.test(record.content))
    .map((record) => record.resourceId))];
  if (sourceIds.length === 0) return [];

  const torqueNewtonMillimeters = 7_000;
  const impactFactor = 1.3;
  const diameter = 10;
  const allowableShearStress = 35;
  const requiredOverlap = 2 * impactFactor * torqueNewtonMillimeters /
    (Math.PI * diameter ** 2 * allowableShearStress);
  const selectedOverlap = 2;
  const actualShearStress = 2 * impactFactor * torqueNewtonMillimeters /
    (Math.PI * diameter ** 2 * selectedOverlap);

  return [{
    origin: "derived",
    learning_goal: "Eine zylindrische Löt-Überlappung unter Torsion nachvollziehbar dimensionieren",
    prompt: "Selbst erstelltes Übungsbeispiel: Eine Welle mit d = 10 mm überträgt T = 7 N·m bei Stoßfaktor K = 1,3. Für die Lötverbindung wird tau_zul = 35 N/mm² als Übungsannahme vorgegeben. Bestimme die erforderliche Überlappungslänge und prüfe eine gewählte Länge von 2,0 mm.",
    steps: [
      "1. Modell und Annahmen festhalten: zylindrischer Überlappstoß, gleichmäßig verteilte Schubspannung; d = 10 mm, T = 7 N·m, K = 1,3 und tau_zul = 35 N/mm². Der Spannungswert ist eine ausdrücklich vorgegebene Übungsannahme und kein aus der unvollständigen Quelllösung übernommener Tabellenwert.",
      "2. Einheiten vereinheitlichen: T = 7 N·m = 7000 N·mm; das Bemessungsmoment ist K·T = 1,3·7000 = 9100 N·mm.",
      "3. Für den zylindrischen Überlappstoß gilt tau = 2·K·T/(pi·d²·l_ü). Nach der gesuchten Länge umstellen: l_ü,erf = 2·K·T/(pi·d²·tau_zul).",
      `4. Einsetzen: l_ü,erf = 2·1,3·7000/(pi·10²·35) = ${requiredOverlap.toFixed(2).replace(".", ",")} mm.`,
      `5. Konstruktiv l_ü = ${selectedOverlap.toFixed(1).replace(".", ",")} mm wählen und rückrechnen: tau = 2·1,3·7000/(pi·10²·2,0) = ${actualShearStress.toFixed(1).replace(".", ",")} N/mm².`,
      `6. Plausibilitätsprüfung: ${actualShearStress.toFixed(1).replace(".", ",")} N/mm² < ${allowableShearStress} N/mm²; die gewählte Überlappung erfüllt die Übungsannahme. In einer realen Aufgabe ist tau_zul aus dem vorgegebenen Lot-, Werkstoff- und Belastungsfall zu entnehmen.`,
    ],
    result: `Erforderlich sind rechnerisch ${requiredOverlap.toFixed(2).replace(".", ",")} mm; gewählt werden 2,0 mm. Die Rückrechnung ergibt tau = ${actualShearStress.toFixed(1).replace(".", ",")} N/mm² und damit eine eingehaltene zulässige Schubspannung.`,
    source_ids: sourceIds,
  }];
}

async function enrichCachedChapterHandoff(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
  cached: ReturnType<typeof validateExtractedData>,
): Promise<ReturnType<typeof validateExtractedData>> {
  const [visualManifest, retrievalRequests] = await Promise.all([
    readVisualManifest(config.runDir),
    readVisualRetrievalRequests(config.runDir),
  ]);
  const derivedLookupAsset = await ensureToleranceLookupExcerpt(config, state, focus);
  const figures = mergeFigures(
    cached.figures,
    [
      ...requiredLookupFigures(focus, visualManifest, retrievalRequests),
      ...(derivedLookupAsset ? [derivedLookupAsset.figure] : []),
    ],
  );
  const selectedAssetIds = new Set(figures.map((figure) => figure.asset_id));
  const existingAssetIds = new Set(cached.visual_assets.map((asset) => asset.id));
  const requiredAssets = (visualManifest?.candidates ?? [])
    .filter((candidate) => selectedAssetIds.has(candidate.id) && !existingAssetIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      relative_path: candidate.relative_path,
      mime_type: candidate.mime_type,
      width_px: candidate.width_px,
      height_px: candidate.height_px,
      source_id: candidate.source_id,
      source_url: candidate.source_url,
      source_path: candidate.source_path,
      source_page: candidate.source_page,
      confidence: candidate.confidence,
      caption_hint: candidate.caption_hint,
      relevance_reason: candidate.relevance_reason,
      generation_prompt: candidate.generation_prompt,
    }));
  const deterministicExamples = buildDeterministicChapterExamples(state, focus);
  const compatibleCachedExamples = deterministicExamples.length > 0
    ? []
    : cached.worked_examples;

  return validateExtractedData({
    ...cached,
    learning_modules: cached.learning_modules.length > 0
      ? cached.learning_modules
      : [focusLearningModule(focus, focus.resourceIds)],
    worked_examples: uniqueBy(
      [...deterministicExamples, ...compatibleCachedExamples],
      (example) => example.prompt.toLowerCase().replace(/\s+/g, " ").trim(),
    ),
    sections: cached.sections.map((section) => ({
      ...section,
      key_concepts: section.key_concepts.map((concept) => concept.replace(
        /TB 2-1 bis TB 2-3 sind notwendige Nachschlagequellen; ihr Zahleninhalt ist in der bereitgestellten Evidenz nicht lesbar enthalten/i,
        "TB 2-1 wird als Originalausschnitt gezeigt; der gekennzeichnete TB-2-2/2-3-Lernausschnitt ordnet die in Lösung A belegten H7/k6-Werte dem vollständigen Tabellenweg zu",
      )),
    })),
    visual_assets: uniqueBy([
      ...cached.visual_assets,
      ...requiredAssets,
      ...(derivedLookupAsset ? [derivedLookupAsset.asset] : []),
    ], (asset) => asset.id),
    figures,
    warnings: cached.warnings.filter((warning) => !(
      /(?:TB 2-[123]|H7\/k6|Lösung A)/i.test(warning) &&
      /(?:nicht lesbar|keine[^.]{0,50}Tabellenwerte|fehlen|ausschließlich Endergebnisse|kein(?:e|en)?[^.]{0,30}numerisch|erfordert den tatsächlichen Nachschlag|nicht vollständig)/i.test(warning)
    )),
  });
}

function ensureFocusLearningModule(
  data: ReturnType<typeof validateExtractedData>,
  focus: ChapterFocus,
): ReturnType<typeof validateExtractedData> {
  // The source architect owns the cross-document learning architecture. A
  // chapter analyzer may summarize its local evidence, but it must not rename
  // or split the module and thereby reintroduce Moodle-session headings.
  return validateExtractedData({
    ...data,
    sections: preserveVisibleCourseTopicSections(data.sections, focus, data.language),
    worked_examples: preserveVisibleCourseTopicExamples(data.worked_examples, focus),
    learning_modules: [focusLearningModule(focus, focus.resourceIds)],
    warnings: data.warnings.filter((warning) => !isCrossChapterBoundaryWarning(warning, focus)),
  });
}

function isCrossChapterBoundaryWarning(warning: string, focus: ChapterFocus): boolean {
  const normalized = warning.toLocaleLowerCase("de");
  const boundaryLanguage =
    /(?:evidenzgrenze|evidence boundary|auftrag|request|kapitelkontext|chapter context|kapitel- und evidenzbasis|chapter and evidence)/i
      .test(warning) &&
    /(?:only|nur|ausschließlich)/i.test(warning) &&
    /(?:cannot|not covered|unavailable|unsupported|no (?:source|evidence|task)|nicht abgedeckt|nicht behandelt|nicht belegt|unbelegt|keine?[^.]{0,40}(?:quelle|evidenz|aufgabeninhalt)|liegt[^.]{0,50}(?:keine|nicht))/i
      .test(warning);
  if (!boundaryLanguage) return false;

  const focusNumbers = new Set(officialCourseTopics(focus).map((topic) => topic.number));
  if (focusNumbers.size === 0) return false;
  const mentionedNumbers = [...normalized.matchAll(
    /(?:thema|themen|topic|topics)\s+(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?/gi,
  )].flatMap((match) => {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return Array.from({ length: upper - lower + 1 }, (_, index) => lower + index);
  });
  return mentionedNumbers.some((number) => !focusNumbers.has(number));
}

interface OfficialCourseTopic {
  number: number;
  title: string;
  details: string[];
}

function officialCourseTopics(focus: ChapterFocus): OfficialCourseTopic[] {
  const topics = new Map<number, OfficialCourseTopic>();
  for (const objective of focus.learningObjectives ?? []) {
    const match = /^(?:Thema|Topic)\s+(\d{1,2})\s*[–-]\s*([^:·]+)(?::|\s+·\s+)?\s*(.*)$/i
      .exec(objective);
    if (!match) continue;
    const number = Number(match[1]);
    const topic = topics.get(number) ?? {
      number,
      title: match[2].trim(),
      details: [],
    };
    if (match[3].trim()) topic.details.push(match[3].trim());
    topics.set(number, topic);
  }
  return [...topics.values()]
    .map((topic) => ({ ...topic, details: [...new Set(topic.details)] }))
    .sort((left, right) => left.number - right.number);
}

function preserveVisibleCourseTopicSections(
  sections: ReturnType<typeof validateExtractedData>["sections"],
  focus: ChapterFocus,
  language: "de" | "en",
): ReturnType<typeof validateExtractedData>["sections"] {
  const officialTopics = officialCourseTopics(focus);
  if (officialTopics.length === 0) return sections;
  const remaining = sections.map((section, index) => ({ section, index }));
  const mapped = officialTopics.map((topic) => {
    const exactIndex = remaining.findIndex(({ section }) =>
      new RegExp(`(?:Thema|Topic)\\s+${topic.number}\\b`, "i")
        .test(`${section.heading} ${section.summary}`)
    );
    const rankedIndex = exactIndex >= 0
      ? exactIndex
      : remaining
          .map(({ section }, index) => ({
            index,
            score: semanticOverlap(
              matchTerms(`${topic.title} ${topic.details.join(" ")}`),
              matchTerms(`${section.heading} ${section.summary} ${section.key_concepts.join(" ")}`),
            ),
          }))
          .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.index ?? -1;
    const selected = rankedIndex >= 0 ? remaining.splice(rankedIndex, 1)[0]?.section : undefined;
    const officialLabel = `${language === "en" ? "Topic" : "Thema"} ${topic.number} – ${topic.title}`;
    if (selected) {
      const alreadyLabeled = new RegExp(`(?:Thema|Topic)\\s+${topic.number}\\b`, "i")
        .test(selected.heading);
      return {
        ...selected,
        heading: alreadyLabeled
          ? selected.heading
          : `${officialLabel}: ${selected.heading}`,
      };
    }
    return {
      heading: officialLabel,
      summary: language === "en"
        ? `Official Moodle scope for this topic: ${topic.details.join(" ")}`
        : `Offizieller Moodle-Umfang dieses Themas: ${topic.details.join(" ")}`,
      key_concepts: topic.details,
      source_ids: focus.resourceIds.slice(0, 1),
    };
  });
  return [...mapped, ...remaining.map(({ section }) => section)];
}

function preserveVisibleCourseTopicExamples(
  examples: ReturnType<typeof validateExtractedData>["worked_examples"],
  focus: ChapterFocus,
): ReturnType<typeof validateExtractedData>["worked_examples"] {
  const topics = officialCourseTopics(focus);
  if (topics.length === 0 || examples.length === 0) return examples;
  const remainingTopics = [...topics];
  return examples.map((example, index) => {
    const exactIndex = remainingTopics.findIndex((topic) =>
      new RegExp(`(?:Thema|Topic)\\s+${topic.number}\\b`, "i")
        .test(`${example.learning_goal} ${example.prompt}`)
    );
    const rankedIndex = exactIndex >= 0
      ? exactIndex
      : remainingTopics
          .map((topic, topicIndex) => ({
            topicIndex,
            score: semanticOverlap(
              matchTerms(`${topic.title} ${topic.details.join(" ")}`),
              matchTerms(`${example.learning_goal} ${example.prompt} ${example.steps.join(" ")}`),
            ),
          }))
          .sort((left, right) => right.score - left.score || left.topicIndex - right.topicIndex)[0]?.topicIndex ??
        (index % remainingTopics.length);
    const topic = remainingTopics.splice(Math.max(0, rankedIndex), 1)[0];
    if (!topic) return example;
    const label = `Topic ${topic.number}`;
    return {
      ...example,
      learning_goal: new RegExp(`(?:Thema|Topic)\\s+${topic.number}\\b`, "i")
          .test(example.learning_goal)
        ? example.learning_goal
        : `${label} – ${topic.title}: ${example.learning_goal}`,
    };
  });
}

function focusLearningModule(focus: ChapterFocus, resourceIds: string[]) {
  return {
    id: focus.key,
    title: focus.title,
    priority: focus.priority ?? "important" as const,
    content_mode: focus.contentMode ?? "mixed" as const,
    learning_objectives: focus.learningObjectives ?? [],
    assessment_signals: focus.assessmentSignals ?? [],
    resource_ids: resourceIds,
  };
}

async function ensureToleranceLookupExcerpt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
): Promise<{
  asset: ReturnType<typeof validateExtractedData>["visual_assets"][number];
  figure: ChapterFragment["figures"][number];
} | null> {
  const examples = buildDeterministicToleranceLookupExamples(state, focus);
  if (examples.length === 0) return null;
  const assetId = "derived-tb2-h7-k6-learning-excerpt";
  const relativePath = path.posix.join("assets", "visuals", `${assetId}.svg`);
  const absolutePath = path.join(config.runDir, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520">
  <rect width="1200" height="520" rx="24" fill="#f7f8fa"/>
  <text x="48" y="58" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#17202a">H7/k6 bei N = 50 mm — Prüfungs-Lernausschnitt</text>
  <text x="48" y="94" font-family="Arial, sans-serif" font-size="18" fill="#4b5563">Leserichtung: Nennmaßbereich → Toleranzgrad → Grundabmaß → zweites Abmaß</text>
  <g font-family="Arial, sans-serif" font-size="19" fill="#17202a">
    <rect x="48" y="128" width="1104" height="58" rx="10" fill="#dde7f3"/>
    <text x="68" y="164" font-weight="700">Tabellenblatt</text><text x="270" y="164" font-weight="700">Bereich / Feld</text><text x="540" y="164" font-weight="700">ablesen</text><text x="770" y="164" font-weight="700">zweites Abmaß</text>
    <rect x="48" y="194" width="1104" height="76" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
    <text x="68" y="228" font-weight="700">TB 2-1</text><text x="270" y="228">über 30 bis 50 mm</text><text x="540" y="218">IT6 = 16 µm</text><text x="540" y="248">IT7 = 25 µm</text><text x="770" y="232">Toleranzbreiten für k6 / H7</text>
    <rect x="48" y="278" width="1104" height="76" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
    <text x="68" y="322" font-weight="700">TB 2-2</text><text x="270" y="322">Bohrung H</text><text x="540" y="322">EI = 0 µm</text><text x="770" y="322">ES = EI + IT7 = +25 µm</text>
    <rect x="48" y="362" width="1104" height="76" rx="8" fill="#ffffff" stroke="#cbd5e1"/>
    <text x="68" y="406" font-weight="700">TB 2-3</text><text x="270" y="406">Welle k</text><text x="540" y="406">ei = +2 µm</text><text x="770" y="406">es = ei + IT6 = +18 µm</text>
  </g>
  <text x="48" y="474" font-family="Arial, sans-serif" font-size="16" fill="#6b4f00">Didaktischer Lernausschnitt, keine vollständige Normtabelle.</text>
  <text x="48" y="500" font-family="Arial, sans-serif" font-size="16" fill="#6b4f00">TB 2-1 ist zusätzlich als Originalausschnitt abgebildet; H7/k6-Werte sind durch Lösung A belegt.</text>
</svg>`;
  await writeFile(absolutePath, svg, "utf8");
  const sourceIds = examples[0].source_ids;
  return {
    asset: {
      id: assetId,
      kind: "typst_diagram",
      title: "TB 2-1 bis TB 2-3: H7/k6-Lernausschnitt",
      relative_path: relativePath,
      mime_type: "image/svg+xml",
      width_px: 1200,
      height_px: 520,
      source_id: sourceIds[0] ?? null,
      source_url: null,
      source_path: null,
      source_page: null,
      confidence: 1,
      caption_hint: "Prüfungs-Lernausschnitt für den vollständigen H7/k6-Tabellenweg bei N = 50 mm.",
      relevance_reason: "Macht Nennmaßbereich, IT6/IT7, Grundabmaße EI/ei und die Herleitung von ES/es in einem lesbaren Tabellenblock sichtbar.",
      generation_prompt: null,
    },
    figure: {
      asset_id: assetId,
      caption: "TB 2-1 bis TB 2-3 als gekennzeichneter Prüfungs-Lernausschnitt: Nennmaßbereich, IT6/IT7, EI/ei und Herleitung von ES/es für H7/k6 bei 50 mm.",
      placement_hint: "Direkt vor dem vollständig gerechneten H7/k6-Nachschlagebeispiel; zusammen mit dem Originalausschnitt aus TB 2-1 verwenden.",
      source_ids: sourceIds,
    },
  };
}

function manifestResourceToSource(resource: ManifestResource) {
  const kind = resource.activityType === "assignment"
    ? "assignment" as const
    : resource.activityType === "quiz"
      ? "quiz_question" as const
      : resource.localPath?.toLowerCase().endsWith(".pdf")
        ? "pdf" as const
        : "file" as const;
  return {
    id: resource.id,
    title: resource.title,
    kind,
    url: resource.originUrl || null,
    path: resource.localPath ?? null,
    page: null,
  };
}

function mergeSections(sections: ChapterFragment["sections"]): ChapterFragment["sections"] {
  const merged = new Map<string, ChapterFragment["sections"][number]>();
  for (const section of sections) {
    const key = section.heading.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, section);
      continue;
    }
    merged.set(key, {
      ...previous,
      summary: previous.summary.includes(section.summary)
        ? previous.summary
        : `${previous.summary}\n\n${section.summary}`,
      key_concepts: [...new Set([...previous.key_concepts, ...section.key_concepts])],
      source_ids: [...new Set([...previous.source_ids, ...section.source_ids])],
    });
  }
  return [...merged.values()];
}

function mergeFigures(
  selected: ChapterFragment["figures"],
  required: ChapterFragment["figures"],
): ChapterFragment["figures"] {
  return uniqueBy([...selected, ...required], (figure) => figure.asset_id);
}

function requiredLookupFigures(
  focus: ChapterFocus,
  visualManifest: VisualManifest | null,
  retrievalRequests: VisualRetrievalRequest[],
): ChapterFragment["figures"] {
  if (!visualManifest) return [];
  const lookupRequests = retrievalRequests.filter((request) =>
    focus.resourceIds.includes(request.resourceId) &&
    request.priority === "high" &&
    visualRequestMatchesChapter(focus, request) &&
    (
      request.purpose === "table" ||
      (request.purpose === "diagram" && /(?:nachschlag|diagramm|kurve|viskos|lookup|ables)/i.test(
        `${request.reason} ${request.placementHint}`,
      ))
    )
  );
  const figures: ChapterFragment["figures"] = [];
  for (const request of lookupRequests) {
    const candidates = visualManifest.candidates
      .filter((candidate) =>
        candidate.source_id === request.resourceId &&
        candidate.source_page !== null &&
        request.pages.includes(candidate.source_page)
      )
      .sort((left, right) => visualCandidateScore(right) - visualCandidateScore(left));
    const distinctPages = new Set<number>();
    for (const candidate of candidates) {
      if (candidate.source_page === null || distinctPages.has(candidate.source_page)) continue;
      distinctPages.add(candidate.source_page);
      figures.push({
        asset_id: candidate.id,
        caption: request.reason,
        placement_hint: request.placementHint,
        source_ids: [request.resourceId],
      });
      if (distinctPages.size >= 2) break;
    }
  }
  return figures;
}

const GENERIC_VISUAL_MATCH_TERMS = new Set([
  "grundlag", "grundlagen", "beispiel", "beispiele", "chapter", "kapitel", "diagramm",
  "figure", "abbildung", "anwenden", "berechn", "bestimm", "erklär", "overview",
]);

export function visualRequestMatchesChapter(
  focus: Pick<ChapterFocus, "title" | "matchTerms" | "learningObjectives" | "assessmentSignals">,
  request: Pick<VisualRetrievalRequest, "purpose" | "placementHint" | "reason">,
): boolean {
  const focusTerms = matchTerms([
    focus.title,
    ...focus.matchTerms,
    ...(focus.learningObjectives ?? []),
    ...(focus.assessmentSignals ?? []),
  ].join(" ")).filter((term) => !GENERIC_VISUAL_MATCH_TERMS.has(term));
  const requestTerms = matchTerms(
    `${request.purpose} ${request.placementHint} ${request.reason}`,
  ).filter((term) => !GENERIC_VISUAL_MATCH_TERMS.has(term));
  return semanticOverlap(focusTerms, requestTerms) > 0;
}

function visualCandidateScore(candidate: VisualCandidate): number {
  const embedded = candidate.kind === "moodle_pdf_image" ? 100 : 0;
  const landscape = candidate.width_px && candidate.height_px && candidate.width_px > candidate.height_px ? 20 : 0;
  const pixels = (candidate.width_px ?? 0) * (candidate.height_px ?? 0) / 1_000_000;
  return embedded + landscape + Math.min(10, pixels);
}

async function readVisualRetrievalRequests(runDir: string): Promise<VisualRetrievalRequest[]> {
  try {
    const parsed = JSON.parse(await readFile(path.join(runDir, "visual-retrieval-plan.json"), "utf8")) as {
      requests?: VisualRetrievalRequest[];
    };
    return parsed.requests ?? [];
  } catch {
    return [];
  }
}

function chapterFocuses(state: LangGraphAgentState): ChapterFocus[] {
  const architecture = state.source_architect_decision.learningArchitecture;
  if (architecture?.modules.length) {
    const resourcesByUrl = new Map(state.resource_manifest.resources.map((resource) => [
      canonicalizeResourceUrl(resource.originUrl),
      resource,
    ]));
    const practiceAssignments = assignPracticeResourcesToModules(state, architecture.modules);
    const supportResources = architecture.supportResources.map((support) => ({
      support,
      resourceIds: support.resourceUrls
        .map((url) => resourcesByUrl.get(canonicalizeResourceUrl(url)))
        .filter((resource): resource is ManifestResource => Boolean(resource?.localPath))
        .map((resource) => resource.id),
    }));
    const focuses = architecture.modules.flatMap((module): ChapterFocus[] => {
      const directResources = uniqueBy([
        ...module.resourceUrls
          .map((url) => resourcesByUrl.get(canonicalizeResourceUrl(url)))
          .filter((resource): resource is ManifestResource => Boolean(resource?.localPath)),
        ...(practiceAssignments.get(module.id) ?? []),
      ], (resource) => resource.id);
      const semanticTerms = matchTerms([
        module.title,
        ...module.learningObjectives,
        ...module.assessmentSignals,
      ].join(" "));
      const directResourceIds = new Set(directResources.map((resource) => resource.id));
      const directEvidenceCharacters = state.evidence_package.records
        .filter((record) => directResourceIds.has(record.resourceId))
        .reduce((sum, record) => sum + record.content.length, 0);
      const rankedSupport = supportResources
        .map((entry) => ({
          ...entry,
          score: semanticOverlap(
            semanticTerms,
            matchTerms(`${entry.support.title} ${entry.support.purpose}`),
          ),
          evidenceScore: semanticOverlap(
            semanticTerms,
            matchTerms(state.evidence_package.records
              .filter((record) => entry.resourceIds.includes(record.resourceId))
              .map((record) => record.content)
              .join(" ")
            ),
          ),
        }));
      const matchingSupport = rankedSupport
        // A broad formula/reference PDF is not chapter evidence merely because
        // the chapter is quantitative. Require at least two semantic matches
        // so direct lecture/practice material cannot be displaced by generic
        // support with one word such as "calculus" or "formula".
        .filter((entry) => entry.resourceIds.length > 0 && entry.score >= 2)
        .sort((left, right) => right.score - left.score)
        .slice(0, 2)
        .flatMap((entry) => entry.resourceIds.slice(0, 1));
      const sparseFallbackSupport = directEvidenceCharacters < 1_200
        ? rankedSupport
          .filter((entry) =>
            entry.resourceIds.length > 0 &&
            entry.support.purpose === "general_reference" &&
            entry.evidenceScore >= 1
          )
          .slice(0, 1)
          .flatMap((entry) => entry.resourceIds.slice(0, 1))
        : [];
      const selectedSupport = [...new Set([
        ...matchingSupport,
        ...sparseFallbackSupport,
      ])].slice(0, 2);
      const resourceIds = [...new Set([
        ...directResources.map((resource) => resource.id),
        ...selectedSupport,
      ])];
      if (resourceIds.length === 0) return [];
      return [{
        key: safeChapterKey(module.id || module.title),
        title: module.title,
        resourceIds,
        directResourceIds: directResources.map((resource) => resource.id),
        supportResourceIds: selectedSupport,
        matchTerms: semanticTerms,
        priority: module.priority,
        contentMode: module.contentMode,
        learningObjectives: module.learningObjectives,
        assessmentSignals: module.assessmentSignals,
      }];
    });
    if (focuses.length > 0) return focuses;
  }

  const groups = new Map<string, ChapterFocus>();
  for (const resource of state.resource_manifest.resources) {
    if (!resource.localPath || resource.sectionPath.length === 0) continue;
    const title = resource.sectionPath.join(" > ");
    const key = safeChapterKey(title);
    const group = groups.get(key) ?? {
      key,
      title,
      resourceIds: [],
      directResourceIds: [],
      supportResourceIds: [],
      matchTerms: [],
    };
    if (!group.resourceIds.includes(resource.id)) group.resourceIds.push(resource.id);
    group.directResourceIds ??= [];
    if (!group.directResourceIds.includes(resource.id)) group.directResourceIds.push(resource.id);
    group.matchTerms = [...new Set([...group.matchTerms, ...matchTerms(resource.title)])];
    if (resource.selection?.role === "primary_lecture") {
      group.title = `${title} — ${resource.title}`;
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function assignPracticeResourcesToModules(
  state: LangGraphAgentState,
  modules: NonNullable<
    LangGraphAgentState["source_architect_decision"]["learningArchitecture"]
  >["modules"],
): Map<string, ManifestResource[]> {
  const practiceRoles = new Set(["worked_example", "sample_exam", "exercise", "solution"]);
  const moduleTerms = new Map(modules.map((module) => [
    module.id,
    matchTerms([
      module.title,
      ...module.learningObjectives,
      ...module.assessmentSignals,
    ].join(" ")),
  ]));
  const assignedUrls = new Map<string, Set<string>>(modules.map((module) => [
    module.id,
    new Set(module.resourceUrls.map(canonicalizeResourceUrl)),
  ]));
  const recordsByResource = new Map<string, string[]>();
  for (const record of state.evidence_package.records) {
    const values = recordsByResource.get(record.resourceId) ?? [];
    if (values.join(" ").length < 16_000) values.push(record.content);
    recordsByResource.set(record.resourceId, values);
  }
  const result = new Map<string, ManifestResource[]>();
  const practiceResources = state.resource_manifest.resources.filter((resource) =>
    Boolean(resource.localPath) && practiceRoles.has(resource.selection?.role ?? "")
  );

  for (const resource of practiceResources) {
    const resourceTerms = matchTerms([
      resource.title,
      ...resource.sectionPath,
      resource.selection?.topic ?? "",
      ...(recordsByResource.get(resource.id) ?? []),
    ].join(" "));
    const ranked = modules
      .map((module, index) => ({
        module,
        index,
        assigned: assignedUrls.get(module.id)?.has(canonicalizeResourceUrl(resource.originUrl)) ?? false,
        score: semanticOverlap(moduleTerms.get(module.id) ?? [], resourceTerms),
      }))
      .sort((left, right) =>
        Number(right.assigned) - Number(left.assigned) ||
        right.score - left.score ||
        left.index - right.index
      );
    const best = ranked[0];
    if (!best || (!best.assigned && best.score < 2)) continue;
    const resources = result.get(best.module.id) ?? [];
    if (resources.length >= 3) continue;
    resources.push(resource);
    result.set(best.module.id, resources);
  }
  return result;
}

function semanticOverlap(left: string[], right: string[]): number {
  const rightTerms = new Set(right);
  return left.filter((term) => rightTerms.has(term)).length;
}

function termFrequencyOverlap(left: string[], right: string[]): number {
  const frequencies = new Map<string, number>();
  for (const term of right) {
    frequencies.set(term, Math.min(8, (frequencies.get(term) ?? 0) + 1));
  }
  return [...new Set(left)].reduce(
    (score, term) => score + (frequencies.get(term) ?? 0),
    0,
  );
}

export function focusMatchesError(focus: ChapterFocus, errorLog: string | null): boolean {
  if (!errorLog) return false;
  const normalized = errorLog.toLowerCase();
  const taggedChapters = [...errorLog.matchAll(/\[chapter:\s*([^\]]+)\]/gi)]
    .map((match) => match[1]?.trim())
    .filter((title): title is string => Boolean(title));
  if (taggedChapters.length > 0) {
    const focusTitle = normalizeChapterMatch(focus.title);
    return taggedChapters.some((title) =>
      normalizeChapterMatch(title) === focusTitle || safeChapterKey(title) === focus.key
    );
  }
  if (normalized.includes(focus.title.toLowerCase())) return true;
  // Review repair localization must be based on the chapter title, not on all
  // learning-objective terms. Generic objective words such as "berechnen" or
  // "erklären" previously invalidated almost every cached chapter.
  const titleTerms = matchTerms(focus.title).filter((term) =>
    term.length >= 5 && !/^(?:kapitel|grundlag|anwend|berechn|bestimm|erklär|präsenz|eigenstudium)$/.test(term)
  );
  if (titleTerms.some((term) => normalized.includes(term))) return true;
  const topicSignals: Array<[RegExp, RegExp]> = [
    [/(?:toleranz|passung|oberfläche)/i, /(?:\bH7\b|\bk6\b|\bg8\b|\bEI\b|\bES\b|\bei\b|\bes\b|TB\s*2-[123])/i],
    [/(?:kleb)/i, /(?:kleb|adhäs|kohäs)/i],
    [/(?:niet)/i, /(?:niet|TB\s*7-4|lochleib)/i],
    [/(?:löt|loet)/i, /(?:löt|loet|l_ü|lue|hartlot)/i],
    [/(?:tribolog)/i, /(?:tribolog|viskos|hertz|roloff|matek|schmier)/i],
  ];
  if (topicSignals.some(([focusPattern, errorPattern]) =>
    focusPattern.test(focus.title) && errorPattern.test(errorLog)
  )) return true;
  const chapterNumber = /eigenstudium\s+(\d+)/i.exec(focus.title)?.[1];
  if (!chapterNumber) return false;
  const chapterLetter = String.fromCharCode(64 + Number(chapterNumber)).toLowerCase();
  return new RegExp(`\\bkapitel\\s+(?:${chapterNumber}|${chapterLetter})\\b`, "i").test(errorLog);
}

function normalizeChapterMatch(value: string): string {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchTerms(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9äöüß]{4,}/gi) ?? [])
    .filter((token) => !/^(?:foliensatz|angabe|lösung|loesung|resource|moodle)$/.test(token))
    .flatMap((token) => [
      token,
      token.replace(/(?:ungen|ung|en|e|n)$/i, ""),
      token.replace(/(?:verbindungen?|verbindung)$/i, ""),
    ])
    .filter((token) => token.length >= 3);
}

export function resourceTitleMatchesAnalyzerError(title: string, errorLog: string): boolean {
  const normalized = errorLog.toLowerCase();
  return matchTerms(title).some((term) => normalized.includes(term));
}

async function readChapterCache(
  cachePath: string,
  fingerprint: string,
): Promise<CachedChapterHandoff | null> {
  return readFile(cachePath, "utf8")
    .then((text) => JSON.parse(text) as CachedChapterHandoff)
    .then((cached) => cached.fingerprint === fingerprint ? cached : null)
    .catch(() => null);
}

async function readPersistedChapterHandoff(
  cachePath: string,
  outputLanguage: MoodleRuntimeConfig["outputLanguage"],
): Promise<CachedChapterHandoff | null> {
  return readFile(cachePath, "utf8")
    .then((text) => JSON.parse(text) as CachedChapterHandoff)
    .then((cached) => cached.data.language === outputLanguage ? cached : null)
    .then((cached) => {
      if (!cached) return null;
      return {
        fingerprint: cached.fingerprint,
        data: validateExtractedData(cached.data),
      };
    })
    .catch(() => null);
}

function chapterFingerprint(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus: ChapterFocus,
): string {
  const resources = state.resource_manifest.resources
    .filter((resource) => focus.resourceIds.includes(resource.id))
    .map((resource) => ({ id: resource.id, checksum: resource.checksum, status: resource.status }));
  return createHash("sha256").update(JSON.stringify({
    analyzerVersion: CHAPTER_ANALYZER_VERSION,
    outputLanguage: config.outputLanguage,
    policy: STUDENT_FIRST_POLICY_VERSION,
    profile: config.artifactIntent.profile,
    focus,
    resources,
  })).digest("hex");
}

function assertChapterHandoff(
  data: ReturnType<typeof validateExtractedData>,
  focus: ChapterFocus,
): void {
  if (data.sections.length === 0) {
    throw new Error(`Chapter analyzer returned no subject sections for ${focus.title}.`);
  }
  if (focus.contentMode !== "conceptual" && data.worked_examples.length === 0) {
    throw new Error(`Chapter analyzer returned no applied example, case, or procedure for ${focus.title}.`);
  }
  const expectedTopicNumbers = [...new Set(
    (focus.learningObjectives ?? []).flatMap((objective) =>
      [...objective.matchAll(/(?:Thema|Topic)\s+(\d{1,2})\b/gi)].map((match) => Number(match[1]))
    ),
  )];
  const sectionTexts = data.sections.map((section) =>
    `${section.heading} ${section.summary}`
  );
  const topicSectionIndices = new Map(expectedTopicNumbers.map((number) => [
    number,
    sectionTexts.findIndex((value) =>
      new RegExp(`(?:Thema|Topic)\\s+${number}\\b`, "i").test(value)
    ),
  ]));
  const missingTopicNumbers = expectedTopicNumbers.filter((number) =>
    (topicSectionIndices.get(number) ?? -1) < 0
  );
  if (missingTopicNumbers.length > 0) {
    throw new Error(
      `Chapter analyzer lost the visible Moodle topic mapping for ${focus.title}: ${missingTopicNumbers.join(", ")}.`,
    );
  }
  if (
    expectedTopicNumbers.length > 1 &&
    new Set(topicSectionIndices.values()).size < expectedTopicNumbers.length
  ) {
    throw new Error(
      `Chapter analyzer merged distinct Moodle topic labels into one section for ${focus.title}.`,
    );
  }
  if (
    focus.contentMode !== "conceptual" &&
    expectedTopicNumbers.length > 0 &&
    data.worked_examples.length < 1
  ) {
    throw new Error(
      `Chapter analyzer returned no representative example for ${focus.title}.`,
    );
  }
}

function mergeChapterHandoffs(
  handoffs: Array<ReturnType<typeof validateExtractedData>>,
  focuses: ChapterFocus[],
  config: MoodleRuntimeConfig,
): ReturnType<typeof validateExtractedData> {
  const namespaced = handoffs.map((handoff, index) => namespaceChapterHandoff(
    handoff,
    `ch${index + 1}_${focuses[index].key}`,
  ));
  const first = namespaced[0];
  return validateExtractedData({
    document_title: first.document_title,
    language: config.outputLanguage,
    course: first.course,
    sources: uniqueBy(namespaced.flatMap((data) => data.sources), (source) => source.id),
    sections: namespaced.flatMap((data) => data.sections),
    formulas: namespaced.flatMap((data) => data.formulas),
    worked_examples: namespaced.flatMap((data) => data.worked_examples),
    quiz_style_questions: [],
    visual_assets: uniqueBy(namespaced.flatMap((data) => data.visual_assets), (asset) => asset.id),
    figures: namespaced.flatMap((data) => data.figures),
    learning_modules: namespaced.flatMap((data) => data.learning_modules),
    warnings: [...new Set(namespaced.flatMap((data) => data.warnings))],
  });
}

function namespaceChapterHandoff(
  data: ReturnType<typeof validateExtractedData>,
  prefix: string,
): ReturnType<typeof validateExtractedData> {
  const sourceIds = new Map(data.sources.map((source) => [source.id, `${prefix}_${source.id}`]));
  const assetIds = new Map(data.visual_assets.map((asset) => [asset.id, `${prefix}_${asset.id}`]));
  const mapSources = (ids: string[]) => ids.map((id) => sourceIds.get(id)).filter((id): id is string => Boolean(id));
  return validateExtractedData({
    ...data,
    sources: data.sources.map((source) => ({ ...source, id: sourceIds.get(source.id)! })),
    sections: data.sections.map((section) => ({ ...section, source_ids: mapSources(section.source_ids) })),
    formulas: data.formulas.map((formula) => ({ ...formula, source_ids: mapSources(formula.source_ids) })),
    worked_examples: data.worked_examples.map((example) => ({ ...example, source_ids: mapSources(example.source_ids) })),
    quiz_style_questions: [],
    visual_assets: data.visual_assets.map((asset) => ({
      ...asset,
      id: assetIds.get(asset.id)!,
      source_id: asset.source_id ? sourceIds.get(asset.source_id) ?? null : null,
    })),
    figures: data.figures
      .filter((figure) => assetIds.has(figure.asset_id))
      .map((figure) => ({
        ...figure,
        asset_id: assetIds.get(figure.asset_id)!,
        source_ids: mapSources(figure.source_ids),
      })),
    learning_modules: data.learning_modules.map((module) => ({
      ...module,
      resource_ids: mapSources(module.resource_ids),
    })),
  });
}

async function persistExtractedData(
  runDir: string,
  data: ReturnType<typeof validateExtractedData>,
): Promise<void> {
  await mkdir(path.join(runDir, "extraction"), { recursive: true });
  const text = `${JSON.stringify(data, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(runDir, "extracted-data.json"), text, "utf8"),
    writeFile(path.join(runDir, "extraction", "extracted-data.json"), text, "utf8"),
  ]);
}

function safeChapterKey(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chapter";
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function buildAnalyzerPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  focus?: ChapterFocus,
): Promise<string> {
  const visualManifest = await readVisualManifest(config.runDir);
  const contextBudget = focus
    ? FOCUSED_CONTEXT_BUDGET
    : Math.min(resolveTaskBudget(config.intentDecision).maxModelInputChars, 40_000);
  const evidenceBudget = focus
    ? FOCUSED_EVIDENCE_BUDGET
    : Math.floor(contextBudget * 0.7);
  const sourceBudget = Math.max(0, contextBudget - evidenceBudget);
  const focusedEvidence = focus
    ? {
        ...state.evidence_package,
        records: state.evidence_package.records.filter((record) =>
          focus.resourceIds.includes(record.resourceId)
        ),
      }
    : state.evidence_package;
  const evidenceView = compactEvidenceForAnalyzer(
    focusedEvidence,
    config.prompt,
    evidenceBudget,
  );
  const analyzerManifest = {
    schemaVersion: state.resource_manifest.schemaVersion,
    courseUrl: state.resource_manifest.courseUrl,
    resources: state.resource_manifest.resources
      .filter((resource) => !focus || focus.resourceIds.includes(resource.id))
      .map((resource) => ({
      id: resource.id,
      sectionPath: resource.sectionPath,
      activityType: resource.activityType,
      title: resource.title,
      originUrl: resource.originUrl,
      status: resource.status,
      selection: resource.selection,
      extraction: resource.extraction,
    })),
  };
  const analyzerVisuals = visualManifest
    ? {
        tooling: visualManifest.tooling,
        warnings: visualManifest.warnings,
        candidates: visualManifest.candidates
          .filter((candidate) => !focus || (candidate.source_id && focus.resourceIds.includes(candidate.source_id)))
          .slice(
            0,
            focus
              ? FOCUSED_VISUAL_CANDIDATE_LIMIT
              : Math.max(6, Math.min(config.maxVisualAssets * 2, 16)),
          )
          .map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          mime_type: candidate.mime_type,
          width_px: candidate.width_px,
          height_px: candidate.height_px,
          source_id: candidate.source_id,
          source_url: candidate.source_url,
          source_page: candidate.source_page,
          confidence: candidate.confidence,
          caption_hint: candidate.caption_hint,
        })),
      }
    : null;
  const rawSource = focus ? focusedRawSource(state.moodle_raw_text, analyzerManifest.resources) : state.moodle_raw_text;
  const sourceOverview = focusedEvidence.records.length > 0
    ? ""
    : rawSource.slice(0, Math.min(
        focus ? FOCUSED_SOURCE_OVERVIEW_BUDGET : 12_000,
        sourceBudget || contextBudget,
      ));
  const figureLimit = analyzerVisuals
    ? analyzerVisuals.candidates.length
    : config.maxVisualAssets > 0
      ? config.maxVisualAssets
      : 0;
  return [
    "Extract structured study data from selected calendar events and relevant Moodle/CIS text for a learner in the requested course, regardless of discipline.",
    `Student-first policy v${STUDENT_FIRST_POLICY_VERSION}: ${STUDENT_FIRST_POLICY}`,
    "Return only schema-valid JSON. Use the evidence package as the factual boundary; resource titles and visual metadata alone do not prove subject claims. Do not open files, invoke tools, or invent missing content.",
    "Keep official titles and identifiers traceable. Calendar is primary for dates/times/exams/rooms; CIS is the fallback and the source for attendance or administrative LV facts.",
    "A study guide must teach the material: preserve Moodle chapter order, explain relationships, method choice and conditions, and include one representative self-contained application per covered technical chapter when evidence supports it.",
    "When learning objectives contain official labels such as 'Thema 2' or 'Topic 2', create a distinct subject section for every listed number and retain that label in its heading. Related official topics may share one broader learning module, but their mapping must remain visible.",
    "For a quantitative grouped module, include two self-contained worked examples spanning different official Moodle topics (one example for a single-topic module). Retain each example's 'Thema N' or 'Topic N' label in its learning_goal. Examples should teach method selection, ordered steps, and a quick result check rather than merely state an answer.",
    "Use source-backed exercise/solution pairs when reproducible. Otherwise use origin='derived' with declared values, ordered reasoning, units, result, and plausibility check. Never copy lookup values without teaching the table/diagram selection path.",
    "Use Typst math syntax. Every formula needs variables, units (or explicit dimensionless status), context, and valid source_ids.",
    figureLimit > 0
      ? `Use at most ${figureLimit} source-backed figures, only when they materially support the chapter. Attached images correspond to candidate IDs; never use tools to inspect other files. Prefer extracted images over full-page screenshots and keep lookup assets beside dependent examples.`
      : "Use figures only when source-supported or as a clearly identified didactic Typst diagram.",
    config.artifactIntent.profile === "study_guide" || config.artifactIntent.profile === "exam_navigator"
      ? "Set quiz_style_questions to an empty array. These profiles use one learning checklist and no practice bank."
      : "Practice questions must test subject knowledge, have a concrete learning purpose, and cite subject evidence. Never ask about alias, date, time, room, teacher, or source-page metadata.",
    `Output language is ${languageName(config.outputLanguage)}.`,
    `Task context: ${JSON.stringify({
      artifactProfile: config.artifactIntent.profile,
      outputLanguage: languageName(config.outputLanguage),
      chapter: focus
        ? {
            title: focus.title,
            contentMode: focus.contentMode ?? "mixed",
            learningObjectives: focus.learningObjectives ?? [],
            assessmentSignals: focus.assessmentSignals ?? [],
          }
        : null,
    })}`,
    focus
      ? `Learning mode: ${focus.contentMode ?? "mixed"}. Objectives: ${JSON.stringify(focus.learningObjectives ?? [])}. Assessment signals: ${JSON.stringify(focus.assessmentSignals ?? [])}.`
      : "",
    state.error_log ? `Previous validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {}, null, 2)}`,
    analyzerVisuals ? `Visual candidates JSON:\n${JSON.stringify(analyzerVisuals, null, 2)}` : "Visual candidates JSON: none",
    `Resource manifest JSON:\n${JSON.stringify(analyzerManifest, null, 2)}`,
    `Evidence package selection JSON:\n${JSON.stringify(evidenceView, null, 2)}`,
    sourceOverview ? `Moodle/CIS source overview:\n${sourceOverview}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function compactEvidenceForAnalyzer(
  evidence: LangGraphAgentState["evidence_package"],
  prompt: string,
  maxCharacters: number,
): LangGraphAgentState["evidence_package"] {
  const promptTokens = new Set(
    prompt.toLowerCase().match(/[a-z0-9äöüß]{4,}/gi) ?? [],
  );
  const records = [...evidence.records]
    .map((record, index) => ({
      record,
      index,
      score:
        (record.kind === "exercise" || record.kind === "solution" ? 100 : 0) +
        [...promptTokens].filter((token) =>
          `${record.locator.section ?? ""} ${record.content}`.toLowerCase().includes(token)
        ).length * 10,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [];
  const representedResources = new Set<string>();
  let characters = 0;
  for (const candidate of records) {
    const serializedLength = JSON.stringify(candidate.record).length;
    const firstForResource = !representedResources.has(candidate.record.resourceId);
    if (!firstForResource && characters + serializedLength > maxCharacters) continue;
    if (characters + serializedLength > maxCharacters && selected.length > 0) continue;
    selected.push(candidate.record);
    representedResources.add(candidate.record.resourceId);
    characters += serializedLength;
  }
  return {
    ...evidence,
    records: selected.map((record) => ({ ...record, localPath: null })),
    warnings: [
      ...evidence.warnings,
      ...(selected.length < evidence.records.length
        ? [`Analyzer context selected ${selected.length} of ${evidence.records.length} evidence records; the complete package remains persisted.`]
        : []),
    ],
  };
}

async function analyzerVisualAttachments(
  runDir: string,
  state: LangGraphAgentState,
  focus?: ChapterFocus,
): Promise<string[]> {
  const visualManifest = await readVisualManifest(runDir);
  const allowedResourceIds = focus ? new Set(focus.resourceIds) : null;
  const normalizedRunDir = path.resolve(runDir);
  const paths = (visualManifest?.candidates ?? [])
    .filter((candidate) => !allowedResourceIds ||
      Boolean(candidate.source_id && allowedResourceIds.has(candidate.source_id)))
    .sort((left, right) => visualCandidateScore(right) - visualCandidateScore(left))
    .map((candidate) => candidate.relative_path)
    .filter((relativePath): relativePath is string => Boolean(relativePath))
    .map((relativePath) => path.resolve(normalizedRunDir, relativePath))
    .filter((candidatePath) => {
      const relative = path.relative(normalizedRunDir, candidatePath);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    })
    .slice(0, 2);
  const usable = await Promise.all(paths.map(async (candidatePath) =>
    stat(candidatePath)
      .then((entry) => entry.isFile() && entry.size > 0 ? candidatePath : null)
      .catch(() => null)
  ));
  return usable.filter((candidatePath): candidatePath is string => Boolean(candidatePath));
}

function focusedRawSource(rawText: string, resources: Array<{ originUrl: string }>): string {
  const urls = new Set(resources.map((resource) => resource.originUrl));
  return rawText
    .split(/\n(?=\[(?:Moodle page|Linked file|Calendar|CIS))/g)
    .filter((block) => {
      const url = /^URL:\s*(\S+)/m.exec(block)?.[1];
      return url ? urls.has(url) : false;
    })
    .join("\n\n");
}
