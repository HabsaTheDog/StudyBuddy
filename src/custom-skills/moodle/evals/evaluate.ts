import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ExecutionMetricsSnapshot, ModelCallMetric } from "../executionTelemetry.js";
import {
  resolveModelPromptCharacterBudget,
} from "../codexClient.js";
import type { StudyBuddyModelTask } from "../modelPolicy.js";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import type { StudyBuddyEvalCase } from "./corpus.js";

export interface EvalCheck {
  id: string;
  category: "reliability" | "efficiency";
  passed: boolean;
  detail: string;
}

export interface EvalRunResult {
  workflowDir: string;
  profile: string;
  passed: boolean;
  reliabilityPassed: boolean;
  efficiencyPassed: boolean;
  score: number;
  efficiencyScore: number;
  wallMs: number;
  modelDurationMs: number;
  tokens: {
    input: number;
    cached: number;
    fresh: number;
    output: number;
    reasoning: number;
    billableProxy: number;
    cacheHitRate: number;
  };
  operations: {
    modelCalls: number;
    retries: number;
    toolCalls: number;
    leafToolPolicyViolations: number;
    maxInputAmplification: number;
    amplificationObservedCalls: number;
    selectedResources: number;
    resourceAttempts: number;
    promptBudgetViolations: number;
  };
  content: {
    topics: number;
    formulas: number;
    workedExamples: number;
    sources: number;
    courseChapters: number;
    coveredChapters: number;
    officialTopicMappings: number;
    officialTopicNumbers: number[];
    practiceTopicMappings: number;
    practiceTopicNumbers: number[];
    chapterRoadmaps: number;
    chaptersWithMultipleTopics: number;
    chaptersWithWorkedExamples: number;
    contentModes: string[];
    structureFingerprint: string;
  };
  tasks: Array<{
    task: string;
    calls: number;
    retries: number;
    durationMs: number;
    inputTokens: number;
    cachedInputTokens: number;
    freshInputTokens: number;
    outputTokens: number;
    maxRequestCharacters: number;
    maxInputAmplification: number;
    amplificationObservedCalls: number;
  }>;
  checks: EvalCheck[];
}

export async function evaluateWorkflow(
  workflowDir: string,
  profile: string,
  evalCase?: StudyBuddyEvalCase,
): Promise<EvalRunResult> {
  const extractionDir = path.join(workflowDir, "extraction");
  const renderDir = path.join(workflowDir, "render");
  const renderMetrics = await readMetrics(renderDir);
  const extractionMetrics = await readMetrics(extractionDir);
  const metrics = [extractionMetrics, renderMetrics].filter(
    (value): value is ExecutionMetricsSnapshot => value !== null,
  );
  const typstPath = path.join(renderDir, "document.typ");
  const pdfPath = path.join(renderDir, "document.pdf");
  const typst = await readFile(typstPath, "utf8").catch(() => "");
  const renderSummary = await readFile(path.join(renderDir, "run-summary.md"), "utf8").catch(() => "");
  const extractionSummary = await readFile(path.join(extractionDir, "run-summary.md"), "utf8").catch(() => "");
  const renderError = await readFile(path.join(renderDir, "error.log"), "utf8").catch(() => "");
  const extractionError = await readFile(path.join(extractionDir, "error.log"), "utf8").catch(() => "");
  const studyModel = await readJson<Record<string, unknown>>(path.join(renderDir, "study-model.json"));
  const qualityReview = await readJson<Record<string, unknown>>(path.join(extractionDir, "quality-review.json"));
  const structure = typst
    ? validateStudyBuddyDocumentStructure(typst)
    : { ok: false, errors: ["missing Typst"] };
  const expected = evalCase?.expected;
  const reliabilityChecks: EvalCheck[] = [
    reliability("extraction-terminal", isTerminal(extractionSummary), "extraction summary is terminal"),
    reliability("render-terminal", isTerminal(renderSummary), "render summary is terminal"),
    reliability("extraction-error-log", extractionError.trim().length === 0, "extraction error.log is empty"),
    reliability("render-error-log", renderError.trim().length === 0, "render error.log is empty"),
  ];

  if (expected?.requirePdf ?? true) {
    reliabilityChecks.push(
      reliability("typst", await nonEmpty(typstPath), "document.typ exists and is non-empty"),
      reliability("pdf", await nonEmpty(pdfPath), "document.pdf exists and is non-empty"),
      reliability(
        "typst-structure",
        structure.ok,
        structure.ok ? "Study Buddy document structure is valid" : structure.errors.join("; "),
      ),
    );
  }

  if (expected?.requireCompleteCoverage) {
    reliabilityChecks.push(
      reliability("coverage", /Run status:\s*success/i.test(extractionSummary), "extraction coverage is complete"),
    );
  }
  if (expected?.requireQualityReview ?? true) {
    const blockingFindings = arrayValue(qualityReview?.blocking_findings);
    reliabilityChecks.push(
      reliability(
        "quality-review",
        qualityReview?.ok === true && blockingFindings.length === 0,
        qualityReview
          ? `quality review ok=${String(qualityReview.ok)}, blocking findings=${blockingFindings.length}`
          : "quality-review.json is missing or invalid",
      ),
    );
  }

  const contentCounts = {
    topics: arrayValue(studyModel?.topics).length,
    formulas: arrayValue(studyModel?.formulas).length,
    workedExamples: arrayValue(studyModel?.workedExamples).length,
    sources: arrayValue(studyModel?.sources).length,
  };
  const chapters = arrayValue(studyModel?.courseChapters)
    .map(recordValue)
    .filter((value): value is Record<string, unknown> => value !== null);
  const topics = arrayValue(studyModel?.topics)
    .map(recordValue)
    .filter((value): value is Record<string, unknown> => value !== null);
  const workedExamples = arrayValue(studyModel?.workedExamples)
    .map(recordValue)
    .filter((value): value is Record<string, unknown> => value !== null);
  const officialTopicNumbers = officialCourseTopicNumbers(chapters, topics);
  const practiceTopicNumbers = officialPracticeTopicNumbers(chapters);
  const topicCountsByChapter = countByStringField(topics, "chapterId");
  const exampleCountsByChapter = countByStringField(workedExamples, "chapterId");
  const content = {
    ...contentCounts,
    courseChapters: chapters.length,
    coveredChapters: chapters.filter((chapter) => chapter.status === "covered").length,
    officialTopicMappings: officialTopicNumbers.length,
    officialTopicNumbers,
    practiceTopicMappings: practiceTopicNumbers.length,
    practiceTopicNumbers,
    chapterRoadmaps: (typst.match(/study-buddy:chapter-roadmap/g) ?? []).length,
    chaptersWithMultipleTopics: chapters.filter((chapter) =>
      (topicCountsByChapter.get(stringValue(chapter.id)) ?? 0) >= 2
    ).length,
    chaptersWithWorkedExamples: chapters.filter((chapter) =>
      (exampleCountsByChapter.get(stringValue(chapter.id)) ?? 0) >= 1
    ).length,
    contentModes: [...new Set(chapters.map((chapter) => stringValue(chapter.contentMode)).filter(Boolean))]
      .sort(),
    structureFingerprint: semanticStructureFingerprint(studyModel, contentCounts),
  };
  addMinimumCheck(reliabilityChecks, "topics", content.topics, expected?.minTopics);
  addMinimumCheck(reliabilityChecks, "formulas", content.formulas, expected?.minFormulas);
  addReliabilityMaximumCheck(reliabilityChecks, "formulas-max", content.formulas, expected?.maxFormulas);
  addMinimumCheck(reliabilityChecks, "worked-examples", content.workedExamples, expected?.minWorkedExamples);
  addReliabilityMaximumCheck(
    reliabilityChecks,
    "worked-examples-max",
    content.workedExamples,
    expected?.maxWorkedExamples,
  );
  addMinimumCheck(reliabilityChecks, "sources", content.sources, expected?.minSources);
  addMinimumCheck(reliabilityChecks, "course-chapters", content.courseChapters, expected?.minCourseChapters);
  addReliabilityMaximumCheck(reliabilityChecks, "course-chapters-max", content.courseChapters, expected?.maxCourseChapters);
  addMinimumCheck(reliabilityChecks, "covered-chapters", content.coveredChapters, expected?.minCoveredChapters);
  addMinimumCheck(
    reliabilityChecks,
    "official-topic-mappings",
    content.officialTopicMappings,
    expected?.minOfficialTopicMappings,
  );
  addMinimumCheck(
    reliabilityChecks,
    "chapter-roadmaps",
    content.chapterRoadmaps,
    expected?.minChapterRoadmaps,
  );
  addMinimumCheck(
    reliabilityChecks,
    "chapters-with-multiple-topics",
    content.chaptersWithMultipleTopics,
    expected?.minChaptersWithMultipleTopics,
  );
  addMinimumCheck(
    reliabilityChecks,
    "chapters-with-worked-examples",
    content.chaptersWithWorkedExamples,
    expected?.minChaptersWithWorkedExamples,
  );
  if ((expected?.requiredOfficialTopicNumbers ?? []).length > 0) {
    const missing = expected!.requiredOfficialTopicNumbers.filter((number) =>
      !content.officialTopicNumbers.includes(number)
    );
    reliabilityChecks.push(reliability(
      "official-topic-sequence",
      missing.length === 0,
      missing.length === 0
        ? `all required Moodle topic numbers are mapped: ${content.officialTopicNumbers.join(", ")}`
        : `missing Moodle topic numbers: ${missing.join(", ")}`,
    ));
  }
  if ((expected?.requiredPracticeTopicNumbers ?? []).length > 0) {
    const missing = expected!.requiredPracticeTopicNumbers.filter((number) =>
      !content.practiceTopicNumbers.includes(number)
    );
    reliabilityChecks.push(reliability(
      "official-topic-practice-route",
      missing.length === 0,
      missing.length === 0
        ? `every required Moodle topic has a mapped practice route: ${content.practiceTopicNumbers.join(", ")}`
        : `practice route is missing Moodle topic numbers: ${missing.join(", ")}`,
    ));
  }
  if (expected?.requiredCourseLabel) {
    const requiredLabel = expected.requiredCourseLabel.toLowerCase();
    const modelCourseTitle = typeof studyModel?.courseTitle === "string"
      ? studyModel.courseTitle
      : "";
    const titleBlock = typst.slice(0, 1_000);
    reliabilityChecks.push(
      reliability(
        "course-title",
        modelCourseTitle.toLowerCase().includes(requiredLabel) &&
          titleBlock.toLowerCase().includes(requiredLabel),
        `study model and PDF title identify ${expected.requiredCourseLabel}`,
      ),
    );
  }
  if (expected?.requiredLanguage) {
    const modelLanguage = typeof studyModel?.language === "string" ? studyModel.language : "";
    reliabilityChecks.push(reliability(
      "artifact-language",
      modelLanguage === expected.requiredLanguage,
      `study model language is ${expected.requiredLanguage}`,
    ));
  }
  for (const mode of expected?.requiredContentModes ?? []) {
    reliabilityChecks.push(reliability(
      `content-mode:${mode}`,
      content.contentModes.includes(mode),
      `course architecture contains ${mode} learning`,
    ));
  }

  const searchableDocument = `${typst}\n${JSON.stringify(studyModel ?? {})}`.toLowerCase();
  for (const term of expected?.requiredTerms ?? []) {
    reliabilityChecks.push(
      reliability(`term:${term}`, searchableDocument.includes(term.toLowerCase()), `document contains ${term}`),
    );
  }
  for (const term of expected?.forbiddenTerms ?? []) {
    reliabilityChecks.push(
      reliability(`forbidden-term:${term}`, !searchableDocument.includes(term.toLowerCase()), `document excludes ${term}`),
    );
  }
  if (studyModel) {
    const citationStats = citationIntegrity(studyModel);
    reliabilityChecks.push(
      reliability(
        "source-integrity",
        citationStats.invalid === 0 && citationStats.uncited === 0,
        `${citationStats.checked} evidence-bearing items checked; ${citationStats.uncited} uncited; ${citationStats.invalid} invalid source references`,
      ),
    );
  } else {
    reliabilityChecks.push(reliability("study-model", false, "render/study-model.json is missing or invalid"));
  }

  const wallMs = metrics.reduce((sum, value) => sum + value.wallMs, 0);
  const tokens = {
    input: metrics.reduce((sum, value) => sum + numberValue(value.totals.inputTokens), 0),
    cached: metrics.reduce((sum, value) => sum + numberValue(value.totals.cachedInputTokens), 0),
    fresh: metrics.reduce(
      (sum, value) =>
        sum +
        numberValue(
          value.totals.freshInputTokens,
          Math.max(0, numberValue(value.totals.inputTokens) - numberValue(value.totals.cachedInputTokens)),
        ),
      0,
    ),
    output: metrics.reduce((sum, value) => sum + numberValue(value.totals.outputTokens), 0),
    reasoning: metrics.reduce((sum, value) => sum + numberValue(value.totals.reasoningOutputTokens), 0),
    billableProxy: 0,
    cacheHitRate: 0,
  };
  tokens.billableProxy = tokens.fresh + tokens.output;
  tokens.cacheHitRate = tokens.input > 0 ? tokens.cached / tokens.input : 0;
  const modelCalls = metrics.flatMap((value) => value.modelCalls);
  const operations = {
    modelCalls: metrics.reduce((sum, value) => sum + numberValue(value.totals.modelCalls), 0),
    retries: metrics.reduce((sum, value) => sum + numberValue(value.totals.retries), 0),
    toolCalls: metrics.reduce((sum, value) => sum + numberValue(value.totals.toolCalls), 0),
    leafToolPolicyViolations: metrics.reduce(
      (sum, value) => sum + numberValue(value.totals.leafToolPolicyViolations),
      0,
    ),
    maxInputAmplification: maxAmplification(modelCalls),
    amplificationObservedCalls: metrics
      .flatMap((value) => value.modelCalls)
      .filter(hasAmplificationObservation).length,
    selectedResources: metrics.reduce(
      (maximum, value) => Math.max(maximum, numberValue(value.resources.selected)),
      0,
    ),
    resourceAttempts: metrics.reduce((sum, value) => sum + numberValue(value.resources.started), 0),
    promptBudgetViolations: modelCalls.filter((call) =>
      isModelTask(call.task) &&
      numberValue(call.requestCharacters) + numberValue(call.schemaCharacters) >
        resolveModelPromptCharacterBudget(call.task)
    ).length,
  };
  const tasks = taskBreakdown(modelCalls);
  const efficiencyChecks: EvalCheck[] = [];
  addMaximumCheck(efficiencyChecks, "wall-time", wallMs, expected?.maxWallMs, "ms");
  addMaximumCheck(
    efficiencyChecks,
    "fresh-input-tokens",
    tokens.fresh,
    expected?.maxFreshInputTokens,
    "tokens",
  );
  addMaximumCheck(efficiencyChecks, "model-calls", operations.modelCalls, expected?.maxModelCalls, "calls");
  addMaximumCheck(efficiencyChecks, "retries", operations.retries, expected?.maxRetries, "retries");
  addMaximumCheck(efficiencyChecks, "tool-calls", operations.toolCalls, expected?.maxToolCalls, "calls");
  addMaximumCheck(
    efficiencyChecks,
    "leaf-tool-policy-violations",
    operations.leafToolPolicyViolations,
    expected?.maxLeafToolPolicyViolations,
    "violations",
  );
  if (expected?.maxInputAmplification !== undefined) {
    efficiencyChecks.push(
      efficiency(
        "input-amplification-observability",
        operations.amplificationObservedCalls === operations.modelCalls,
        `${operations.amplificationObservedCalls}/${operations.modelCalls} model calls include prompt-size telemetry`,
      ),
    );
    addMaximumCheck(
      efficiencyChecks,
      "input-amplification",
      operations.maxInputAmplification,
      expected.maxInputAmplification,
      "x",
      2,
    );
  }
  addMaximumCheck(
    efficiencyChecks,
    "selected-resources",
    operations.selectedResources,
    expected?.maxSelectedResources,
    "resources",
  );
  addMaximumCheck(
    efficiencyChecks,
    "resource-attempts",
    operations.resourceAttempts,
    expected?.maxResourceAttempts,
    "attempts",
  );
  efficiencyChecks.push(
    efficiency(
      "prompt-budgets",
      operations.promptBudgetViolations === 0,
      `${operations.promptBudgetViolations} completed model call(s) exceeded the hard task budget`,
    ),
  );

  const reliabilityPassed = reliabilityChecks.every((value) => value.passed);
  const efficiencyPassed = efficiencyChecks.every((value) => value.passed);
  return {
    workflowDir,
    profile,
    passed: reliabilityPassed && efficiencyPassed,
    reliabilityPassed,
    efficiencyPassed,
    score: fractionPassed(reliabilityChecks),
    efficiencyScore: fractionPassed(efficiencyChecks),
    wallMs,
    modelDurationMs: metrics.reduce((sum, value) => sum + numberValue(value.totals.modelDurationMs), 0),
    tokens,
    operations,
    content,
    tasks,
    checks: [...reliabilityChecks, ...efficiencyChecks],
  };
}

function semanticStructureFingerprint(
  studyModel: Record<string, unknown> | null,
  content: Pick<EvalRunResult["content"], "topics" | "formulas" | "workedExamples" | "sources">,
): string {
  const chapters = arrayValue(studyModel?.courseChapters)
    .map(recordValue)
    .filter((value): value is Record<string, unknown> => value !== null)
    .map((chapter) => ({
      title: normalizeFingerprintText(chapter.title),
      status: normalizeFingerprintText(chapter.status),
      mode: normalizeFingerprintText(chapter.contentMode),
      priority: normalizeFingerprintText(chapter.priority),
    }));
  const fallbackTopics = chapters.length === 0
    ? arrayValue(studyModel?.topics)
        .map(recordValue)
        .filter((value): value is Record<string, unknown> => value !== null)
        .map((topic) => normalizeFingerprintText(topic.title))
        .sort()
    : [];
  return createHash("sha256").update(JSON.stringify({
    chapters,
    fallbackTopics,
    counts: content,
  })).digest("hex");
}

function normalizeFingerprintText(value: unknown): string {
  return typeof value === "string"
    ? value.toLocaleLowerCase("de").normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim()
    : "";
}

function isModelTask(value: string): value is StudyBuddyModelTask {
  return [
    "artifact_planner",
    "content_analyzer",
    "content_repair",
    "quality_reviewer",
    "quiz_solver",
    "artifact_builder",
    "artifact_repair",
  ].includes(value);
}

function reliability(id: string, passed: boolean, detail: string): EvalCheck {
  return { id, category: "reliability", passed, detail };
}

function efficiency(id: string, passed: boolean, detail: string): EvalCheck {
  return { id, category: "efficiency", passed, detail };
}

function isTerminal(summary: string): boolean {
  return /Run status:\s*(success|partial)/i.test(summary);
}

function fractionPassed(checks: EvalCheck[]): number {
  return checks.length === 0 ? 1 : checks.filter((value) => value.passed).length / checks.length;
}

function addMinimumCheck(
  checks: EvalCheck[],
  id: string,
  actual: number,
  minimum: number | undefined,
): void {
  if (minimum === undefined) return;
  checks.push(reliability(id, actual >= minimum, `${actual} >= ${minimum}`));
}

function addMaximumCheck(
  checks: EvalCheck[],
  id: string,
  actual: number,
  maximum: number | undefined,
  unit: string,
  precision = 0,
): void {
  if (maximum === undefined) return;
  checks.push(
    efficiency(
      id,
      actual <= maximum,
      `${actual.toFixed(precision)}${unit === "x" ? unit : ` ${unit}`} <= ${maximum}${unit === "x" ? unit : ` ${unit}`}`,
    ),
  );
}

function addReliabilityMaximumCheck(
  checks: EvalCheck[],
  id: string,
  actual: number,
  maximum: number | undefined,
): void {
  if (maximum === undefined) return;
  checks.push(reliability(id, actual <= maximum, `${actual} <= ${maximum}`));
}

function officialCourseTopicNumbers(
  chapters: Record<string, unknown>[],
  topics: Record<string, unknown>[],
): number[] {
  const values = [
    ...chapters.flatMap((chapter) => [
      stringValue(chapter.title),
      ...arrayValue(chapter.learningObjectives).filter((value): value is string =>
        typeof value === "string"
      ),
      ...arrayValue(chapter.assessmentSignals).filter((value): value is string =>
        typeof value === "string"
      ),
    ]),
    ...topics.flatMap((topic) => [stringValue(topic.title), stringValue(topic.summary)]),
  ];
  return [...new Set(values.flatMap((value) =>
    [...value.matchAll(/(?:Thema|Topic)\s+(\d{1,2})\b/gi)].map((match) => Number(match[1]))
  ))].sort((left, right) => left - right);
}

function officialPracticeTopicNumbers(
  chapters: Record<string, unknown>[],
): number[] {
  return [...new Set(chapters.flatMap((chapter) =>
    arrayValue(chapter.assessmentSignals)
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) =>
        [...value.matchAll(/(?:Thema|Topic)\s+(\d{1,2})\b/gi)]
          .map((match) => Number(match[1]))
      )
  ))].sort((left, right) => left - right);
}

function countByStringField(
  values: Record<string, unknown>[],
  field: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = stringValue(value[field]);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function citationIntegrity(studyModel: Record<string, unknown>): {
  checked: number;
  uncited: number;
  invalid: number;
} {
  const sourceIds = new Set(
    arrayValue(studyModel.sources)
      .map((source) => recordValue(source)?.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const entries = [
    ...arrayValue(studyModel.topics),
    ...arrayValue(studyModel.formulas),
    ...arrayValue(studyModel.workedExamples),
  ];
  let checked = 0;
  let uncited = 0;
  let invalid = 0;
  for (const value of entries) {
    const entry = recordValue(value);
    if (!entry) continue;
    checked += 1;
    const refs = arrayValue(entry.sourceIds).filter((id): id is string => typeof id === "string");
    if (refs.length === 0) uncited += 1;
    invalid += refs.filter((id) => !sourceIds.has(id)).length;
  }
  return { checked, uncited, invalid };
}

function maxAmplification(calls: ModelCallMetric[]): number {
  return calls.reduce((maximum, call) => {
    const observed = numberValue(call.inputAmplification, -1);
    if (observed >= 0) return Math.max(maximum, observed);
    const promptEstimate = numberValue(call.estimatedPromptTokens) ||
      Math.ceil((numberValue(call.requestCharacters) + numberValue(call.schemaCharacters)) / 4);
    if (promptEstimate <= 0) return maximum;
    return Math.max(maximum, numberValue(call.inputTokens) / promptEstimate);
  }, 0);
}

function hasAmplificationObservation(call: ModelCallMetric): boolean {
  return numberValue(call.inputAmplification, -1) >= 0 ||
    numberValue(call.estimatedPromptTokens) > 0 ||
    numberValue(call.requestCharacters) + numberValue(call.schemaCharacters) > 0;
}

function taskBreakdown(calls: ModelCallMetric[]): EvalRunResult["tasks"] {
  const grouped = new Map<string, EvalRunResult["tasks"][number]>();
  for (const call of calls) {
    const current = grouped.get(call.task) ?? {
      task: call.task,
      calls: 0,
      retries: 0,
      durationMs: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      freshInputTokens: 0,
      outputTokens: 0,
      maxRequestCharacters: 0,
      maxInputAmplification: 0,
      amplificationObservedCalls: 0,
    };
    current.calls += 1;
    if (call.attempt > 1) current.retries += 1;
    current.durationMs += numberValue(call.durationMs);
    current.inputTokens += numberValue(call.inputTokens);
    current.cachedInputTokens += numberValue(call.cachedInputTokens);
    current.freshInputTokens += numberValue(
      call.freshInputTokens,
      Math.max(0, numberValue(call.inputTokens) - numberValue(call.cachedInputTokens)),
    );
    current.outputTokens += numberValue(call.outputTokens);
    current.maxRequestCharacters = Math.max(
      current.maxRequestCharacters,
      numberValue(call.requestCharacters) + numberValue(call.schemaCharacters),
    );
    current.maxInputAmplification = Math.max(current.maxInputAmplification, maxAmplification([call]));
    if (hasAmplificationObservation(call)) current.amplificationObservedCalls += 1;
    grouped.set(call.task, current);
  }
  return [...grouped.values()].sort(
    (left, right) => right.freshInputTokens - left.freshInputTokens || right.durationMs - left.durationMs,
  );
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function nonEmpty(filePath: string): Promise<boolean> {
  return stat(filePath).then((value) => value.isFile() && value.size > 0).catch(() => false);
}

async function readMetrics(runDir: string): Promise<ExecutionMetricsSnapshot | null> {
  return readJson<ExecutionMetricsSnapshot>(path.join(runDir, "run-metrics.json"));
}

async function readJson<T>(filePath: string): Promise<T | null> {
  const text = await readFile(filePath, "utf8").catch(() => "");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
