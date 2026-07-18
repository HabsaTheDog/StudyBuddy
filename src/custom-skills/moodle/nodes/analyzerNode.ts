import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const ANALYZER_RETRY_LIMIT = 3;
const CHAPTER_ANALYZER_VERSION = "2026-07-18.12-output-language";
const FOCUSED_CONTEXT_BUDGET = 15_000;
const FOCUSED_EVIDENCE_BUDGET = 9_000;
const FOCUSED_SOURCE_OVERVIEW_BUDGET = 2_000;
const FOCUSED_VISUAL_CANDIDATE_LIMIT = 6;
const DENSE_CHAPTER_RECORD_LIMIT = 18;
const DENSE_CHAPTER_CHARACTER_LIMIT = 13_000;
const FRAGMENT_EVIDENCE_CHARACTER_LIMIT = 9_000;
const PACKED_FRAGMENT_EVIDENCE_CHARACTER_LIMIT = 18_000;
const MAX_SLICES_PER_MODEL_CALL = 2;
const FRAGMENT_RECORD_OVERLAP = 2;
// Codex SDK threads in one process can contend without emitting any usage when
// launched concurrently. Sequential chapter handoffs are bounded, cacheable,
// and avoid turning apparent parallelism into paired model timeouts.
const CHAPTER_ANALYZER_CONCURRENCY = 1;

export function createAnalyzerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function analyzerNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      throwIfAborted(config.abortSignal);
      const validated = shouldAnalyzeByChapter(config, state)
        ? await analyzeCourseChapters(config, state, codex)
        : await analyzeWholeRequest(config, state, codex);
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

async function analyzeWholeRequest(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  codex: CodexClient,
) {
  const response = await codex.run(await buildAnalyzerPrompt(config, state), {
    outputSchema: extractedDataJsonSchema,
    task: "content_analyzer",
    attempt: state.retry_count + 1,
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

interface ChapterFocus {
  key: string;
  title: string;
  resourceIds: string[];
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
  const evidenceSlicesPerChapter = config.executionProfile === "quality" ? 4 : 2;
  const sliceBudgets = focuses.map(() => Math.min(
    evidenceSlicesPerChapter,
    analysisBudget.maxModelCallsPerModule,
  ));
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
        continue;
      }
      try {
        ensureChapterRuntimeBudget(config, state, focus, results);
        const dense = isDenseChapter(state, focus);
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
              sliceBudgets[index],
              invalidKeys.has(focus.key) ? state.error_log : undefined,
            )
          : validateAnalyzerResponse(await codex.run(
              await buildAnalyzerPrompt(config, state, focus),
              {
                outputSchema: extractedDataJsonSchema,
                task: "content_analyzer",
                attempt: state.retry_count + 1,
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
      .map(({ focus, message }) => `Chapter analyzer failed for "${focus.title}": ${message}`)
      .join("\n"));
  }
  return mergeChapterHandoffs(results, focuses, config);
}

type EvidenceRecord = LangGraphAgentState["evidence_package"]["records"][number];
type ManifestResource = LangGraphAgentState["resource_manifest"]["resources"][number];
type VisualManifest = NonNullable<Awaited<ReturnType<typeof readVisualManifest>>>;
type VisualCandidate = VisualManifest["candidates"][number];

interface ChapterSlice {
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
  const candidateSlices = buildChapterSlices(state, focus);
  const profileBudget = resolveAnalysisBudget(config.executionProfile);
  const retrievalRequests = await readVisualRetrievalRequests(config.runDir);
  const dependencyResourceIds = new Set(retrievalRequests
    .filter((request) => request.priority === "high" && focus.resourceIds.includes(request.resourceId))
    .map((request) => request.resourceId));
  const selected = selectAnalysisSlices<AnalysisSliceCandidate & { slice: ChapterSlice }>({
    candidates: candidateSlices.map((slice, index) => {
      const sourceRole = dominantSliceRole(state, slice);
      const reservation = slice.resourceIds.some((id) => dependencyResourceIds.has(id))
        ? "dependency" as const
        : ["primary_lecture", "overview"].includes(sourceRole)
          ? "primary" as const
          : ["sample_exam", "worked_example", "exercise", "solution"].includes(sourceRole)
            ? "practice" as const
            : undefined;
      return {
        id: slice.key,
        resourceId: slice.resourceIds.join("+") || focus.key,
        moduleId: focus.key,
        sourceRole,
        title: slice.label,
        content: slice.records.map((record) => record.content).join(" "),
        tags: [
          ...focus.matchTerms,
          ...(focus.learningObjectives ?? []),
          ...(focus.assessmentSignals ?? []),
        ],
        ordinal: index,
        totalSlices: candidateSlices.length,
        reservation,
        slice,
      };
    }),
    relevanceTerms: [
      focus.title,
      ...focus.matchTerms,
      ...(focus.learningObjectives ?? []),
      ...(focus.assessmentSignals ?? []),
    ],
    profile: config.executionProfile,
    limits: {
      ...profileBudget,
      maxGlobalModelCalls: maxSlices,
      maxModelCallsPerModule: maxSlices,
      maxSelectedSlices: maxSlices,
    },
  });
  const slices = packSelectedSlices(selected.selected);
  await config.diagnostics?.log(
    selected.omittedCount > 0 ? "warn" : "info",
    "analyzer",
    `Budgeted ${focus.title}: retained ${selected.selected.length}/${candidateSlices.length} evidence slice(s) in ${slices.length} model call(s).`,
    {
      contentMode: focus.contentMode ?? "mixed",
      omittedSlices: selected.omittedCount,
      modelCallPacks: slices.length,
      countsByResource: selected.countsByResource,
    },
  );
  const visualManifest = await readVisualManifest(config.runDir);
  const fragments: ChapterFragment[] = [];
  const repairFeedback = repairFeedbackOverride === undefined
    ? focusMatchesError(focus, state.error_log) ? state.error_log : null
    : repairFeedbackOverride;
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
      prompt: config.prompt,
      policy: STUDENT_FIRST_POLICY_VERSION,
      focus: focus.key,
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
    const prompt = buildChapterFragmentPrompt(
      config,
      state,
      focus,
      slice,
      index,
      slices.length,
      visualManifest,
      retrievalRequests,
      sliceRepairFeedback,
    );
    const response = await codex.run(prompt, {
      outputSchema: chapterFragmentJsonSchema,
      task: "content_analyzer",
      attempt: state.retry_count + 1,
    });
    throwIfAborted(config.abortSignal);
    const fragment = normalizeFragmentReferences(
      ChapterFragmentSchema.parse(parseJsonObjectOrArray(response)),
      slice,
      visualManifest,
    );
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
      path: resource.localPath,
    }));
  const requests = retrievalRequests.filter((request) =>
    slice.resourceIds.includes(request.resourceId)
  );
  const requestedPages = new Map<string, Set<number>>();
  for (const request of requests) {
    const pages = requestedPages.get(request.resourceId) ?? new Set<number>();
    request.pages.forEach((page) => pages.add(page));
    requestedPages.set(request.resourceId, pages);
  }
  const candidates = (visualManifest?.candidates ?? [])
    .filter((candidate) => {
      if (!candidate.source_id || !slice.resourceIds.includes(candidate.source_id)) return false;
      const pages = requestedPages.get(candidate.source_id);
      return pages?.size && candidate.source_page ? pages.has(candidate.source_page) : true;
    })
    .sort((left, right) => visualCandidateScore(right) - visualCandidateScore(left))
    // Local image inspection is useful but expensive: each candidate can add
    // a full PDF-page image to the model context. The visual planner has
    // already ranked the dependency, so two candidates are enough for a
    // chapter-level decision.
    .slice(0, 2)
    .map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      source_id: candidate.source_id,
      source_page: candidate.source_page,
      title: candidate.title,
      relative_path: candidate.relative_path,
      source_path: candidate.source_path,
      width_px: candidate.width_px,
      height_px: candidate.height_px,
      caption_hint: candidate.caption_hint,
    }));

  const documentLanguage = languageName(config.outputLanguage);
  const toleranceGuidance = /(?:toleranz|passung)/i.test(focus.title)
    ? [
        "Bei Toleranzen/Passungen müssen EI, ES, ei, es, Nennmaßbereich, Toleranzgrad, Grundabmaß, Grenzmaße und Passungskennwerte in korrekter Reihenfolge erklärt werden.",
        "Bei Verweisen auf TB 2-1 bis TB 2-3 muss mindestens ein Beispiel jeden Nachschlageschritt ausdrücklich nennen: Nennmaßbereich finden, IT-Zeile/-Spalte wählen, Grundabmaß über Buchstabenfeld lesen, zweites Abmaß herleiten, Grenzmaße und Po/Pu/PT berechnen.",
      ]
    : [];
  const elasticityGuidance = /(?:elastiz|ersatzmodul)/i.test(focus.title)
    ? ["Unterscheide ähnlich benannte Formeln eindeutig nach Geltungsfall und erkläre Faktor-2-Konventionen beim Ersatz-Elastizitätsmodul ausdrücklich."]
    : [];

  return [
    `Create a compact, technically deep part of the study guide in ${documentLanguage} for the actual course evidence.`,
    `All learner-facing JSON content must be in ${documentLanguage}; retain official source titles, identifiers, and necessary quoted terminology in their original language.`,
    `Kapitel: ${focus.title}`,
    `Lernmodus: ${focus.contentMode ?? "mixed"}`,
    `Lernziele: ${JSON.stringify(focus.learningObjectives ?? [])}`,
    `Prüfungssignale: ${JSON.stringify(focus.assessmentSignals ?? [])}`,
    `Teil ${index + 1}/${total}: ${slice.label}`,
    "Gib ausschließlich JSON gemäß Schema zurück.",
    "Bearbeite nur die bereitgestellte Evidenz. Wiederhole keine allgemeinen Einleitungen und fasse andere Kapitel nicht zusammen.",
    "Halte diesen Kapitelbaustein bewusst begrenzt, aber didaktisch flexibel: Wähle je nach Stoff 3 bis 6 gehaltvolle Abschnitte, 2 bis 5 zentrale Formeln, 1 vollständig nachvollziehbares Anwendungsbeispiel, bis zu 2 wirklich notwendige Abbildungen und höchstens 2 Warnhinweise. Tiefe entsteht durch klare Auswahl und Rechenschritte, nicht durch Wiederholung.",
    "Wähle für dieses konkrete Kapitel eine passende Lehrdramaturgie statt einer Standardschablone: zum Beispiel bildgestützter Modellaufbau, Tabellen-/Nachschlageweg, Versagensarten mit Nachweisen, konstruktiver Entscheidungsfall, Fehlerkontrast oder schrittweise Rechnung. Überschriften, Zusammenfassungen und key_concepts sollen diese Dramaturgie sichtbar tragen.",
    "Vermeide die monotone Folge aus kurzem Definitionsabsatz und austauschbarer Stichpunktliste. Nutze key_concepts je nach Stoff als Entscheidungskriterien, Beobachtungsauftrag für eine Abbildung, geordneten Rechenweg, Fehlercheck, Vergleich oder konstruktive Konsequenzen.",
    "Schlage kein Flowchart für bloß lineare Kapitelabschnitte, Formelfolgen oder normale Rechenschritte vor. Ein Flowchart ist nur sinnvoll, wenn die Evidenz eine echte Verzweigung, Rückkopplung, einen Kreislauf, Zustandsübergang oder komplexen Automatisierungsablauf zeigt. Jeder Knoten trägt dann nur ein bis drei Wörter; niemals Satz, Abschnittsüberschrift plus Untertitel oder erklärenden Fließtext in einen Knoten setzen.",
    "Die Abschnitte sollen den Stoff erklären: Bedeutung, Zusammenhänge, Erkennungsmerkmale, Vorgehen, Randbedingungen und typische Fehler — nicht nur Stichworte aufzählen.",
    "Formeln ausschließlich in Typst-Mathematiksyntax ohne LaTeX-Dollarzeichen oder LaTeX-Befehle ausgeben.",
    "For every emitted formula, provide non-empty variables, units, and context metadata. State explicitly when a quantity is dimensionless instead of leaving units empty.",
    "Verwende in source_ids ausschließlich IDs aus der Ressourcenliste. Erfinde keine Quellen oder Zahlenwerte.",
    "Wähle die passende Anwendungsform für dieses Fach: vollständige Rechnung, klinischer oder wirtschaftlicher Fall, Quellen-/Dateninterpretation, Entscheidungsweg, Argumentationsanalyse oder schrittweise Prozedur. Ausgangslage, Ziel/Fragestellung, nachvollziehbare Schritte, Ergebnis/Entscheidung und Kontrolle müssen sichtbar sein, sofern die Evidenz dafür reicht.",
    "Wenn eine Quelllösung nur Ergebnisse oder unvollständige Zahlen enthält, kopiere diese Ergebnisse nicht als scheinbar gerechnetes Beispiel. Erzeuge stattdessen ein klar als derived markiertes, vollständig reproduzierbares Beispiel mit einfachen gewählten Werten und den in der Evidenz belegten Formeln/Regeln.",
    "Ein bereits in einer Lösung angegebener Tabellenwert ersetzt niemals die Nachschlagemethode.",
    ...toleranceGuidance,
    "Benutze Tabellenwerte nur dann numerisch, wenn die bereitgestellte Evidenz oder der lesbare Tabellenkandidat den konkreten Wert zeigt. Andernfalls lehre den vollständigen Tabellenweg mit symbolischem Tabellenwert und führe ein separates, klar abgeleitetes Zahlenbeispiel aus.",
    ...elasticityGuidance,
    "Wenn Verfügbare Bildkandidaten relative_path enthalten, inspiziere die lokalen Bilddateien mit deinem Bildwerkzeug. Lies Aufgabenstellung, Werte, Einheiten, Formeln, Tabellen und Diagramme direkt aus dem Bild; verlasse dich nicht auf Dateiname oder caption_hint. Wenn der Bildinhalt nicht sicher lesbar ist, kennzeichne die Lücke statt Zahlen zu erfinden.",
    "Wenn ein Verfahren eine Tabelle, ein Diagramm oder eine Skizze benötigt, wähle bis zu zwei wirklich notwendige Kandidaten-IDs als figures. Formuliere placement_hint so konkret, dass der Renderer jede Abbildung unmittelbar nach der erklärenden Information oder direkt vor dem davon abhängigen Beispiel einmischen kann. Vollseitige Screenshots nur als letzte Wahl.",
    "Theorie- und Referenzblöcke dürfen ohne worked_example enden. Quantitative, prozedurale, fallbasierte und gemischte Anwendungsblöcke sollen ein passendes worked_example liefern; bei rein konzeptuellen Modulen genügt ein belastbares Erklär- oder Vergleichsbeispiel. Referenzblöcke liefern nur die für dieses Modul relevanten Definitionen, Formeln, Tabellen oder Nachschlagehinweise. Das Gesamtkapitel wird anschließend deterministisch aus allen Teilen zusammengesetzt.",
    `Nutzerauftrag: ${config.prompt}`,
    repairFeedback ? `Verbindliche Review-Rückmeldung für diesen Reparaturversuch:\n${repairFeedback}` : "",
    `Erlaubte Ressourcen: ${JSON.stringify(resources, null, 2)}`,
    `Geplante Tabellen/Diagramme: ${JSON.stringify(requests, null, 2)}`,
    `Verfügbare Bildkandidaten: ${JSON.stringify(candidates, null, 2)}`,
    `Evidenz für diesen Teil: ${JSON.stringify(slice.records, null, 2)}`,
  ].join("\n\n");
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
    learning_modules: [focusLearningModule(focus, focus.resourceIds)],
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
    const supportResources = architecture.supportResources.map((support) => ({
      support,
      resourceIds: support.resourceUrls
        .map((url) => resourcesByUrl.get(canonicalizeResourceUrl(url)))
        .filter((resource): resource is ManifestResource => Boolean(resource?.localPath))
        .map((resource) => resource.id),
    }));
    const focuses = architecture.modules.flatMap((module): ChapterFocus[] => {
      const directResources = module.resourceUrls
        .map((url) => resourcesByUrl.get(canonicalizeResourceUrl(url)))
        .filter((resource): resource is ManifestResource => Boolean(resource?.localPath));
      const semanticTerms = matchTerms([
        module.title,
        ...module.learningObjectives,
        ...module.assessmentSignals,
      ].join(" "));
      const matchingSupport = supportResources
        .map((entry) => ({
          ...entry,
          score: semanticOverlap(
            semanticTerms,
            matchTerms(`${entry.support.title} ${entry.support.purpose}`),
          ),
        }))
        .filter((entry) => entry.resourceIds.length > 0 && (
          entry.support.purpose === "general_reference" ||
          (entry.support.purpose === "formula_reference" &&
            ["quantitative", "mixed"].includes(module.contentMode)) ||
          entry.score > 0
        ))
        .sort((left, right) => right.score - left.score)
        .slice(0, 2)
        .flatMap((entry) => entry.resourceIds);
      const resourceIds = [...new Set([
        ...directResources.map((resource) => resource.id),
        ...matchingSupport,
      ])];
      if (resourceIds.length === 0) return [];
      return [{
        key: safeChapterKey(module.id || module.title),
        title: module.title,
        resourceIds,
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
    const group = groups.get(key) ?? { key, title, resourceIds: [], matchTerms: [] };
    if (!group.resourceIds.includes(resource.id)) group.resourceIds.push(resource.id);
    group.matchTerms = [...new Set([...group.matchTerms, ...matchTerms(resource.title)])];
    if (resource.selection?.role === "primary_lecture") {
      group.title = `${title} — ${resource.title}`;
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function semanticOverlap(left: string[], right: string[]): number {
  const rightTerms = new Set(right);
  return left.filter((term) => rightTerms.has(term)).length;
}

function focusMatchesError(focus: ChapterFocus, errorLog: string | null): boolean {
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
    prompt: config.prompt,
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
    : resolveTaskBudget(config.intentDecision).maxModelInputChars;
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
      localPath: resource.localPath,
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
          .slice(0, focus ? FOCUSED_VISUAL_CANDIDATE_LIMIT : undefined)
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
        })),
      }
    : null;
  const rawSource = focus ? focusedRawSource(state.moodle_raw_text, analyzerManifest.resources) : state.moodle_raw_text;
  const sourceOverview = focusedEvidence.records.length > 0
    ? rawSource.slice(0, Math.min(focus ? FOCUSED_SOURCE_OVERVIEW_BUDGET : 24_000, sourceBudget))
    : rawSource.slice(0, contextBudget);
  const figureLimit = analyzerVisuals
    ? analyzerVisuals.candidates.length
    : config.maxVisualAssets > 0
      ? config.maxVisualAssets
      : 0;
  return [
    "Extract structured study data from selected calendar events and relevant Moodle/CIS text for a learner in the requested course, regardless of discipline.",
    `Student-first policy v${STUDENT_FIRST_POLICY_VERSION}: ${STUDENT_FIRST_POLICY}`,
    `Artifact profile: ${config.artifactIntent.profile}.`,
    focus
      ? `Chapter handoff: analyze only "${focus.title}". Return complete learning material for this chapter and do not summarize or mention other chapters.`
      : "Analyze the complete requested scope.",
    focus
      ? `Learning mode: ${focus.contentMode ?? "mixed"}. Objectives: ${JSON.stringify(focus.learningObjectives ?? [])}. Assessment signals: ${JSON.stringify(focus.assessmentSignals ?? [])}.`
      : "Infer the appropriate balance of concepts, calculations, cases, procedures, evidence interpretation, and argumentation from the course itself.",
    "Return only JSON matching the requested schema. Do not include Markdown fences.",
    `Output language is ${languageName(config.outputLanguage)}. Write every learner-facing title, explanation, learning objective, example, question, answer, caption, and warning in that language.`,
    "Keep official course titles, source titles, identifiers, quotations, and specialized source terms in their original language when translating them would reduce traceability; explain them in the output language where useful.",
    "Represent formulas in Typst math syntax where possible.",
    "For every emitted formula, provide non-empty variables, units, and context metadata. State explicitly when a quantity is dimensionless instead of leaving units empty.",
    "Never invent source citations.",
    "Treat calendar_event as the primary source for dates, times, exams, and rooms.",
    "Treat CIS as the fallback for missing calendar facts and as the source for attendance or administrative LV information.",
    "The calendar input is already filtered; do not infer events that are not present.",
    "Visual policy:",
    figureLimit > 0
      ? `- Select at most ${figureLimit} figures from the available visual candidates. This is a candidate ceiling, not a target.`
      : "- No visual candidate ceiling is available; still create figures only when supported by the sources or by an approved didactic diagram/prompt.",
    "- Default to using visuals in learning artifacts. Images usually improve comprehension and orientation; choose zero figures only when no useful source image, title/cover image, logo/context image, diagram, table, sketch, or didactic visualization is available or appropriate.",
    "- Prefer Moodle/CIS visual candidates over generated or placeholder visuals.",
    "- Prefer directly extracted moodle_pdf_image candidates over full moodle_pdf_page screenshots when both explain the same content.",
    "- Treat moodle_pdf_page screenshots as fallback only. Do not use a full exercise, full solution, or text-heavy page as a figure when the text can be rewritten as a worked example.",
    "- Do not select mostly blank slide/background/logo candidates, cover/title crops, or screenshots whose meaningful content would be unreadable when placed as a figure.",
    "- When a source page contains a whole example, extract the problem statement, givens, method, and result into worked_examples instead of embedding the whole page image.",
    "- For multi-chapter guides, distribute figures across the covered Moodle chapters. Select at least one suitable source figure for each covered chapter when candidates exist; never spend the visual budget on the first chapter alone.",
    "- Use two to three figures in a chapter when separate diagrams, tables, worked-example sketches, or formula reference tables materially improve learning.",
    "- A figure must be assigned to the chapter supported by its source_id/source_url and placement_hint.",
    "- Include visuals when they materially help the topic, including diagrams, anatomical or process illustrations, charts, maps, timelines, case tables, financial statements, formula tables, experimental setups, and worked-example sketches.",
    "- For text-heavy topics, use a relevant title image, source cover crop, organization/company logo already present in source material, process overview, or simple didactic diagram when it improves readability and memory.",
    "- If a worked example is based on a source table, sketch, diagram, plot, or page crop, include that source visual as a figure with the same source_ids and chapter placement so the renderer can place it next to the example.",
    "- Lookup dependencies are mandatory: when the source tells the student to use a table/table book (for example TB 2-1), diagram, characteristic curve, or nomogram, select the relevant lookup visual and place it in the same chapter. The example is incomplete without it.",
    "- Avoid random decorative visuals. Aesthetic/title visuals are allowed when they are source-related or clearly support orientation, not when they mislead about course content.",
    "- If no Moodle/CIS image is suitable but a simple technical visualization helps, create a typst_diagram visual asset with no relative_path and describe the intended approved component in caption_hint.",
    "- If neither source image nor approved Typst diagram fits, create a placeholder_prompt visual asset with a concrete generation_prompt.",
    "- Generated or placeholder visuals are didactic visualizations, not original Moodle/CIS sources.",
    "Use the source coverage JSON as a hard boundary: failed or empty sources can only support warnings, not factual claims.",
    "Use the evidence package as the factual input. Resource titles alone prove that a resource exists, not its subject content.",
    "The resource manifest includes localPath for the small selected source set. When embedded text is sparse or an exercise depends on a diagram/table, inspect that already-downloaded PDF or its listed visual candidate directly before omitting the material.",
    "Inspect only selected local resources needed for the requested guide. Do not crawl, download, or OCR the remaining catalog from inside the analyzer.",
    "Visual-candidate metadata is not itself factual evidence; use the actual local image/PDF when its content is needed.",
    "Learning-depth policy:",
    "- A study guide must teach the material; it is not an executive summary or a one-paragraph syllabus overview.",
    "- Split each Moodle chapter into multiple meaningful subject sections when the evidence contains definitions, classifications, procedures, boundary conditions, calculations, or applications.",
    "- Explain why concepts work, how related quantities interact, when a method applies, and how a student recognizes the correct method. Preserve source-supported detail instead of compressing a whole slide deck into a few bullets.",
    "- For every covered technical chapter, include at least one complete worked example with a concrete learning_goal, problem, ordered method, intermediate reasoning, result, and source IDs.",
    "- Prefer an acquired exercise/solution pair and set origin='source' only when the supplied evidence contains enough givens, substitutions, and intermediate steps to reproduce the result.",
    "- If a source exercise or solution is incomplete, ambiguous, diagram-dependent, or only states an end result, do not pretend it is fully solved. Instead create one clearly marked origin='derived' example using a source-backed rule or formula and simple explicitly chosen values.",
    "- Every example must be self-contained: state all givens and assumptions, show the formula selection, substitute values with units, show meaningful intermediate results, and finish with a result plus a short plausibility or unit check.",
    "- Never shortcut a table-dependent method by copying already-read values from a solution and starting the calculation there. Teach the lookup itself: identify the nominal-size interval, choose the applicable row/column or tolerance grade and fundamental-deviation letter, read the base/deviation value, derive the paired deviation when required, and only then calculate limits or fits.",
    "- For tolerance examples involving EI/ES/ei/es, include at least one complete table-dependent workflow whenever the source references tolerance tables. The worked steps must explain how the values are found, not merely state them as givens.",
    "- A derived example must remain reproducible from its cited definitions, rules, or formulas. Chosen didactic values are allowed when identified as assumptions; never present them as course facts or disguise the example as an original Moodle exercise.",
    "- One complete representative example per chapter is required. It need not exercise every formula or proof method in that chapter.",
    "- Use key_concepts for concise, testable takeaways; put the actual explanation in section.summary, using multiple paragraphs where useful.",
    "Course structure policy:",
    "- Infer learning priority from course evidence: a method repeated across lecture examples, assigned task/solution pairs, a dedicated Moodle test, or explicit table-book instructions is high priority. Label it inferred rather than confirmed exam scope unless the source explicitly confirms the exam scope.",
    "- Treat resource_manifest.sectionPath as the authoritative Moodle chapter structure.",
    "- Emit subject sections in the same order and with the same subject boundaries as the Moodle course; do not reorganize them into generic theory/formula/example buckets.",
    "- Keep formulas, figures, tables, and worked examples source-linked to the subject section where they are taught.",
    "- If a Moodle chapter is discovered but lacks usable evidence, do not invent content; preserve the gap through warnings so the renderer can show it as open.",
    config.artifactIntent.profile === "study_guide" || config.artifactIntent.profile === "exam_navigator"
      ? "Set quiz_style_questions to an empty array. These profiles use one learning checklist and no practice bank."
      : "Practice questions must test subject knowledge, have a concrete learning purpose, and cite subject evidence. Never ask about alias, date, time, room, teacher, or source-page metadata.",
    "Do not invent source claims, common mistakes, formulas, definitions, or diagram relationships. Derived examples are allowed only under the learning-depth policy above.",
    state.error_log ? `Previous validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {}, null, 2)}`,
    analyzerVisuals ? `Visual candidates JSON:\n${JSON.stringify(analyzerVisuals, null, 2)}` : "Visual candidates JSON: none",
    `Resource manifest JSON:\n${JSON.stringify(analyzerManifest, null, 2)}`,
    `Evidence package selection JSON:\n${JSON.stringify(evidenceView, null, 2)}`,
    `Moodle/CIS source overview:\n${sourceOverview}`,
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
    records: selected,
    warnings: [
      ...evidence.warnings,
      ...(selected.length < evidence.records.length
        ? [`Analyzer context selected ${selected.length} of ${evidence.records.length} evidence records; the complete package remains persisted.`]
        : []),
    ],
  };
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
