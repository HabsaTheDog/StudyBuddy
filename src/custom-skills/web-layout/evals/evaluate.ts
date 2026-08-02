import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ExecutionMetricsSnapshot } from "../../moodle/executionTelemetry.js";
import { studyGuideContentSchema, validateStudyGuideContentQuality } from "../studyGuideContent.js";
import { deriveStudyGuideRequirements } from "../studyGuideProfile.js";
import { validateSingleFileHtml } from "../validation.js";
import type { InteractiveEvalCase } from "./corpus.js";
import { evaluateVNextArtifacts, type VNextEvalResult } from "./vnextEvaluate.js";
import type { VNextBenchmarkManifest } from "./vnextBenchmark.js";

export interface InteractiveEvalCheck {
  id: string;
  category: "reliability" | "quality" | "efficiency";
  passed: boolean;
  actual: string | number | boolean;
  expected: string | number | boolean;
}

export interface InteractiveEvalResult {
  runDir: string;
  webLayoutRunDir: string;
  reliabilityPassed: boolean;
  qualityPassed: boolean;
  efficiencyPassed: boolean;
  passed: boolean;
  checks: InteractiveEvalCheck[];
  structure: {
    language: string;
    topics: number;
    exercises: number;
    selectionExercises: number;
    calculationExercises: number;
    applicationExercises: number;
    workedExamples: number;
    formulas: number;
    sources: number;
  };
  efficiency: {
    wallMs: number;
    inputTokens: number;
    cachedInputTokens: number;
    freshInputTokens: number;
    outputTokens: number;
    cacheHitRate: number;
    modelCalls: number;
    retries: number;
    leafToolPolicyViolations: number;
    artifactBytes: number;
  };
  vNext?: VNextEvalResult;
}

export async function evaluateInteractiveRun(
  requestedRunDir: string,
  evalCase?: InteractiveEvalCase,
  vNextManifest?: VNextBenchmarkManifest,
): Promise<InteractiveEvalResult> {
  const runDir = path.resolve(requestedRunDir);
  const webLayoutRunDir = await resolveWebLayoutRunDir(runDir);
  const [html, summary, validation, quality, contentValue, sourceText, metrics, artifact] = await Promise.all([
    readText(path.join(webLayoutRunDir, "document.html")),
    readText(path.join(webLayoutRunDir, "run-summary.md")),
    readJson<Record<string, unknown>>(path.join(webLayoutRunDir, "validation-report.json")),
    readJson<Record<string, unknown>>(path.join(webLayoutRunDir, "quality-review.json")),
    readJson<unknown>(path.join(webLayoutRunDir, "study-guide-content.json")),
    readText(path.join(webLayoutRunDir, "source.txt")),
    loadWorkflowMetrics(runDir, webLayoutRunDir),
    stat(path.join(webLayoutRunDir, "document.html")).catch(() => undefined),
  ]);
  const parsedContent = studyGuideContentSchema.safeParse(contentValue);
  const content = parsedContent.success ? parsedContent.data : undefined;
  const exercises = content?.topics.flatMap((topic) => topic.exercises) ?? [];
  const language = html.match(/<html\b[^>]*\blang=["']([^"']+)/i)?.[1]?.toLowerCase() ?? "unknown";
  const structure = {
    language,
    topics: content?.topics.length ?? 0,
    exercises: exercises.length,
    selectionExercises: exercises.filter((exercise) => exercise.type === "cross").length,
    calculationExercises: exercises.filter((exercise) => exercise.type === "calculation").length,
    applicationExercises: exercises.filter((exercise) => exercise.type === "application").length,
    workedExamples: content?.topics.reduce((sum, topic) => sum + topic.workedExamples.length, 0) ?? 0,
    formulas: content?.topics.reduce((sum, topic) => sum + topic.theory.formulas.length, 0) ?? 0,
    sources: content?.sources.length ?? 0,
  };
  const inputTokens = sum(metrics, (entry) => entry.totals.inputTokens);
  const cachedInputTokens = sum(metrics, (entry) => entry.totals.cachedInputTokens);
  const efficiency = {
    wallMs: sum(metrics, (entry) => entry.wallMs),
    inputTokens,
    cachedInputTokens,
    freshInputTokens: sum(metrics, (entry) => entry.totals.freshInputTokens),
    outputTokens: sum(metrics, (entry) => entry.totals.outputTokens),
    cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : metrics.length > 0 ? 1 : 0,
    modelCalls: sum(metrics, (entry) => entry.totals.modelCalls),
    retries: sum(metrics, (entry) => entry.totals.retries),
    leafToolPolicyViolations: sum(metrics, (entry) => entry.totals.leafToolPolicyViolations),
    artifactBytes: artifact?.size ?? 0,
  };
  const expected = evalCase?.expected;
  const checks: InteractiveEvalCheck[] = [];
  add(checks, "terminal-status", "reliability", /Run status:\s*success/i.test(summary), /Run status:\s*success/i.test(summary), true);
  add(checks, "html-present", "reliability", html.length > 0, html.length, "> 0 bytes");
  add(checks, "validation", "reliability", validation?.ok === true, validation?.ok === true, true);
  add(checks, "quality-review", "reliability", quality?.ok === true, quality?.ok === true, true);
  add(checks, "content-contract", "reliability", parsedContent.success, parsedContent.success, true);
  const staticValidation = html ? validateSingleFileHtml(html, "study-guide") : { ok: false, issues: [] };
  add(checks, "offline-single-file", "reliability", staticValidation.ok, staticValidation.issues.length, 0);
  const renderer = html.match(/name=["']study-buddy-renderer["'][^>]*content=["']([^"']+)/i)?.[1] ?? "";
  add(
    checks,
    "supported-renderer",
    "quality",
    renderer === "standard-study-guide-v1" || renderer === "adaptive-study-guide-v2",
    renderer,
    "standard-study-guide-v1 | adaptive-study-guide-v2",
  );
  add(checks, "course-navigation", "quality", /data-sb-course-tabs/i.test(html) && /role=["']tablist["']/i.test(html), /data-sb-course-tabs/i.test(html), true);
  if (content) {
    const contentIssues = validateStudyGuideContentQuality(
      content,
      sourceText ? deriveStudyGuideRequirements(sourceText) : undefined,
    );
    add(checks, "content-quality-contract", "quality", contentIssues.length === 0, contentIssues.length, 0);
  }
  addMinimum(checks, "topics", "quality", structure.topics, expected?.minTopics);
  addMinimum(checks, "exercises", "quality", structure.exercises, expected?.minExercises);
  addMinimum(checks, "applications", "quality", structure.applicationExercises, expected?.minApplications);
  addMinimum(checks, "worked-examples", "quality", structure.workedExamples, expected?.minWorkedExamples);
  addMinimum(checks, "sources", "quality", structure.sources, expected?.minSources);
  addMaximum(checks, "formulas", "quality", structure.formulas, expected?.maxFormulas);
  if (expected?.requiredLanguage) {
    add(checks, "language", "quality", language === expected.requiredLanguage, language, expected.requiredLanguage);
  }
  const searchable = `${html}\n${JSON.stringify(contentValue ?? {})}`.toLocaleLowerCase();
  for (const term of expected?.requiredTerms ?? []) {
    add(checks, `required-term:${term}`, "quality", searchable.includes(term.toLocaleLowerCase()), term, "present");
  }
  for (const term of expected?.forbiddenTerms ?? []) {
    add(checks, `forbidden-term:${term}`, "quality", !searchable.includes(term.toLocaleLowerCase()), term, "absent");
  }
  add(checks, "execution-metrics", "efficiency", metrics.length > 0, metrics.length, ">= 1 metrics file");
  addMaximum(checks, "wall-ms", "efficiency", efficiency.wallMs, expected?.maxWallMs);
  addMaximum(checks, "fresh-input-tokens", "efficiency", efficiency.freshInputTokens, expected?.maxFreshInputTokens);
  addMaximum(checks, "model-calls", "efficiency", efficiency.modelCalls, expected?.maxModelCalls);
  addMaximum(checks, "retries", "efficiency", efficiency.retries, expected?.maxRetries);
  addMaximum(checks, "leaf-tool-policy-violations", "efficiency", efficiency.leafToolPolicyViolations, expected?.maxLeafToolPolicyViolations);
  addMinimum(checks, "cache-hit-rate", "efficiency", efficiency.cacheHitRate, expected?.minCacheHitRate);
  addMaximum(checks, "artifact-bytes", "efficiency", efficiency.artifactBytes, expected?.maxArtifactBytes);
  const vNextEvaluation = await evaluateVNextArtifacts(webLayoutRunDir, {
    html,
    summary,
    qualityReview: quality,
  }, vNextManifest);
  checks.push(...vNextEvaluation.checks);

  const reliabilityPassed = categoryPassed(checks, "reliability");
  const qualityPassed = categoryPassed(checks, "quality");
  const efficiencyPassed = categoryPassed(checks, "efficiency");
  return {
    runDir,
    webLayoutRunDir,
    reliabilityPassed,
    qualityPassed,
    efficiencyPassed,
    passed: reliabilityPassed && qualityPassed && efficiencyPassed,
    checks,
    structure,
    efficiency,
    ...(vNextEvaluation.result ? { vNext: vNextEvaluation.result } : {}),
  };
}

async function resolveWebLayoutRunDir(runDir: string): Promise<string> {
  if (await exists(path.join(runDir, "document.html"))) return runDir;
  if (await exists(path.join(runDir, "web-layout", "document.html"))) return path.join(runDir, "web-layout");
  throw new Error(`No interactive document.html found in ${runDir} or its web-layout subdirectory.`);
}

async function loadWorkflowMetrics(runDir: string, webLayoutRunDir: string): Promise<ExecutionMetricsSnapshot[]> {
  const directories = new Set<string>([webLayoutRunDir]);
  if (webLayoutRunDir !== runDir) {
    directories.add(path.join(runDir, "extraction"));
    for (let index = 1; index <= 4; index += 1) directories.add(path.join(runDir, `extraction-recovery-${index}`));
  }
  const values = await Promise.all([...directories].map((directory) =>
    readJson<ExecutionMetricsSnapshot>(path.join(directory, "run-metrics.json"))
  ));
  return values.filter((value): value is ExecutionMetricsSnapshot => value !== undefined);
}

function add(
  checks: InteractiveEvalCheck[],
  id: string,
  category: InteractiveEvalCheck["category"],
  passed: boolean,
  actual: InteractiveEvalCheck["actual"],
  expected: InteractiveEvalCheck["expected"],
): void {
  checks.push({ id, category, passed, actual, expected });
}

function addMinimum(
  checks: InteractiveEvalCheck[],
  id: string,
  category: InteractiveEvalCheck["category"],
  actual: number,
  minimum: number | undefined,
): void {
  if (minimum !== undefined) add(checks, id, category, actual >= minimum, actual, `>= ${minimum}`);
}

function addMaximum(
  checks: InteractiveEvalCheck[],
  id: string,
  category: InteractiveEvalCheck["category"],
  actual: number,
  maximum: number | undefined,
): void {
  if (maximum !== undefined) add(checks, id, category, actual <= maximum, actual, `<= ${maximum}`);
}

function categoryPassed(checks: InteractiveEvalCheck[], category: InteractiveEvalCheck["category"]): boolean {
  return checks.filter((check) => check.category === category).every((check) => check.passed);
}

function sum(values: ExecutionMetricsSnapshot[], read: (value: ExecutionMetricsSnapshot) => number): number {
  return values.reduce((total, value) => total + (read(value) || 0), 0);
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true).catch(() => false);
}

async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8").catch(() => "");
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  const value = await readText(filePath);
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
