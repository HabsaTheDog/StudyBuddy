import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isNonRetryableCodexError, type CodexClient } from "../codexClient.js";
import { extractedDataJsonSchema } from "../schemas.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";
import { readVisualManifest } from "../visualAssets.js";
import {
  STUDENT_FIRST_POLICY,
  STUDENT_FIRST_POLICY_VERSION,
} from "../studentFirstPolicy.js";
import { resolveTaskBudget } from "../taskBudget.js";

const ANALYZER_RETRY_LIMIT = 3;
const CHAPTER_ANALYZER_VERSION = "2026-07-18.2";
const FOCUSED_CONTEXT_BUDGET = 45_000;
const FOCUSED_EVIDENCE_BUDGET = 34_000;
const FOCUSED_SOURCE_OVERVIEW_BUDGET = 8_000;
const FOCUSED_VISUAL_CANDIDATE_LIMIT = 14;

export function createAnalyzerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function analyzerNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const validated = shouldAnalyzeByChapter(config, state)
        ? await analyzeCourseChapters(config, state, codex)
        : await analyzeWholeRequest(config, state, codex);
      await persistExtractedData(config.runDir, validated);
      await config.diagnostics?.log("info", "analyzer", "Validated and persisted extracted study data.");
      return {
        extracted_data: validated,
        error_log: null,
      };
    } catch (error) {
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
  return validateExtractedData(parseJsonObjectOrArray(response));
}

interface ChapterFocus {
  key: string;
  title: string;
  resourceIds: string[];
  matchTerms: string[];
}

interface CachedChapterHandoff {
  fingerprint: string;
  data: ReturnType<typeof validateExtractedData>;
}

function shouldAnalyzeByChapter(config: MoodleRuntimeConfig, state: LangGraphAgentState): boolean {
  return config.artifactIntent.profile === "study_guide" && chapterFocuses(state).length > 1;
}

async function analyzeCourseChapters(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  codex: CodexClient,
) {
  const focuses = chapterFocuses(state);
  const cacheDir = path.join(config.runDir, "chapter-handoffs");
  const sharedCacheDir = path.join(config.runtimeCacheDir, "chapter-handoffs");
  await Promise.all([
    mkdir(cacheDir, { recursive: true }),
    mkdir(sharedCacheDir, { recursive: true }),
  ]);
  const mentioned = focuses.filter((focus) =>
    focusMatchesError(focus, state.error_log)
  );
  const invalidKeys = new Set(
    state.error_log && mentioned.length === 0
      ? focuses.map((focus) => focus.key)
      : mentioned.map((focus) => focus.key),
  );
  const results = new Array<ReturnType<typeof validateExtractedData>>(focuses.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < focuses.length) {
      const index = cursor++;
      const focus = focuses[index];
      const fingerprint = chapterFingerprint(config, state, focus);
      const cachePath = path.join(cacheDir, `${focus.key}.json`);
      const sharedCachePath = path.join(sharedCacheDir, `${fingerprint}.json`);
      const cached = invalidKeys.has(focus.key)
        ? null
        : await readChapterCache(cachePath, fingerprint) ??
          await readChapterCache(sharedCachePath, fingerprint);
      if (cached) {
        results[index] = cached.data;
        await writeFile(cachePath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
        await config.diagnostics?.log("info", "analyzer", `Reused validated chapter handoff: ${focus.title}`);
        continue;
      }
      await config.diagnostics?.log("info", "analyzer", `Analyzing chapter independently: ${focus.title}`);
      const response = await codex.run(await buildAnalyzerPrompt(config, state, focus), {
        outputSchema: extractedDataJsonSchema,
        task: "content_analyzer",
        attempt: state.retry_count + 1,
      });
      const data = validateExtractedData(parseJsonObjectOrArray(response));
      assertChapterHandoff(data, focus);
      const serialized = `${JSON.stringify({ fingerprint, data }, null, 2)}\n`;
      await Promise.all([
        writeFile(cachePath, serialized, "utf8"),
        writeFile(sharedCachePath, serialized, "utf8"),
      ]);
      results[index] = data;
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, focuses.length) }, () => worker()));
  return mergeChapterHandoffs(results, focuses);
}

function chapterFocuses(state: LangGraphAgentState): ChapterFocus[] {
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

function focusMatchesError(focus: ChapterFocus, errorLog: string | null): boolean {
  if (!errorLog) return false;
  const normalized = errorLog.toLowerCase();
  return focus.matchTerms.some((term) => normalized.includes(term));
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
  if (data.worked_examples.length === 0) {
    throw new Error(`Chapter analyzer returned no worked example for ${focus.title}.`);
  }
}

function mergeChapterHandoffs(
  handoffs: Array<ReturnType<typeof validateExtractedData>>,
  focuses: ChapterFocus[],
): ReturnType<typeof validateExtractedData> {
  const namespaced = handoffs.map((handoff, index) => namespaceChapterHandoff(
    handoff,
    `ch${index + 1}_${focuses[index].key}`,
  ));
  const first = namespaced[0];
  return validateExtractedData({
    document_title: first.document_title,
    language: first.language,
    course: first.course,
    sources: uniqueBy(namespaced.flatMap((data) => data.sources), (source) => source.id),
    sections: namespaced.flatMap((data) => data.sections),
    formulas: namespaced.flatMap((data) => data.formulas),
    worked_examples: namespaced.flatMap((data) => data.worked_examples),
    quiz_style_questions: [],
    visual_assets: uniqueBy(namespaced.flatMap((data) => data.visual_assets), (asset) => asset.id),
    figures: namespaced.flatMap((data) => data.figures),
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

async function buildAnalyzerPrompt(
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
    "Extract structured study data from selected calendar events and relevant Moodle/CIS text for a mechatronics/engineering student.",
    `Student-first policy v${STUDENT_FIRST_POLICY_VERSION}: ${STUDENT_FIRST_POLICY}`,
    `Artifact profile: ${config.artifactIntent.profile}.`,
    focus
      ? `Chapter handoff: analyze only "${focus.title}". Return complete learning material for this chapter and do not summarize or mention other chapters.`
      : "Analyze the complete requested scope.",
    "Return only JSON matching the requested schema. Do not include Markdown fences.",
    "Preserve German source language unless the user asks otherwise.",
    "Represent formulas in Typst math syntax where possible.",
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
    "- For multi-chapter engineering guides, distribute figures across the covered Moodle chapters. Select at least one suitable source figure for each covered chapter when candidates exist; never spend the visual budget on the first chapter alone.",
    "- Use two to three figures in a chapter when separate diagrams, tables, worked-example sketches, or formula reference tables materially improve learning.",
    "- A figure must be assigned to the chapter supported by its source_id/source_url and placement_hint.",
    "- Include visuals when they materially help the topic, especially circuits, measurement setups, block diagrams, lab workflows, plots, formula tables, tolerance tables, example sketches, and engineering mechanisms.",
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
