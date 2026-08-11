import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type {
  BrowserBackend,
  MoodleGraphInput,
  MoodleRuntimeConfig,
  RenderStrategyMode,
  SourceMode,
  TypstValidationMode,
  VisualCropMode,
  VisualMode,
} from "./types.js";
import { resolveVerifiedMoodleSource } from "./sourceHints.js";
import { clampConcurrency } from "./downloadQueue.js";
import { createQuizPolicy, isMoodleQuizAttemptUrl } from "./quizPolicy.js";
import { createQuizSafetyPolicy } from "./interactive/config.js";
import { classifyStudyBuddyIntent } from "./taskIntent.js";
import { classifyArtifactIntent } from "./studentFirstPolicy.js";
import {
  parseExecutionProfile,
  parseReasoningEffort,
  resolveTaskModelPolicy,
  type StudyBuddyExecutionProfile,
  type StudyBuddyReasoningEffort,
} from "./modelPolicy.js";
import { resolveTaskBudget } from "./taskBudget.js";
import type { CodexPreflightMode } from "./codexRuntime.js";
import {
  ensureStudyBuddyWorkspaceData,
  ensurePrivateDirectorySync,
  resolveStudyBuddyWorkspaceDataPaths,
  resolveStudyBuddyWorkspacePath,
} from "../shared/workspaceData.js";
import { resolveOutputLanguage } from "../shared/languagePolicy.js";
import {
  dashboardUrlForMoodle,
  extractMoodleUrlFromText,
  isMoodleDashboardUrl,
  normalizeMoodleDashboardUrl,
} from "./moodleSite.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDY_BUDDY_ROOT = path.resolve(MODULE_DIR, "../../..");
const DEFAULT_BROWSER_BACKEND = "agent-browser";
const DEFAULT_MOODLE_URL = "https://moodle.technikum-wien.at/my/";
const DEFAULT_CIS_URL = "https://cis.technikum-wien.at/cis.php/";
const DEFAULT_QUICK_MAX_RUNTIME_MS = 12 * 60_000;
const DEFAULT_ARTIFACT_MAX_RUNTIME_MS = 15 * 60_000;
const DEFAULT_EXTRACTION_MAX_RUNTIME_MS = 14 * 60_000;
const DEFAULT_QUICK_IDLE_TIMEOUT_MS = 8 * 60_000;
const DEFAULT_ARTIFACT_IDLE_TIMEOUT_MS = 5 * 60_000;

loadEnvFiles();

export function createRuntimeConfig(input: MoodleGraphInput): MoodleRuntimeConfig {
  if (!input.prompt.trim()) {
    throw new Error("prompt is required.");
  }
  if (input.originalUserPrompt !== undefined && !input.originalUserPrompt.trim()) {
    throw new Error("originalUserPrompt must not be empty when provided.");
  }
  if (!input.moodleUrl.trim()) {
    throw new Error("moodleUrl is required.");
  }

  const originalUserPrompt = input.originalUserPrompt ?? input.prompt;
  const requestContextPrompt = originalUserPrompt === input.prompt
    ? input.prompt
    : `${originalUserPrompt}\n${input.prompt}`;

  const requestName = safeSlug(input.requestName || inferRequestName(input.prompt));
  const workspaceData = ensureStudyBuddyWorkspaceData(resolveStudyBuddyWorkspaceDataPaths());
  const workspaceRoot = workspaceData.workspaceRoot;
  const outputRoot = path.join(workspaceData.runsRoot, requestName);
  const explicitRunDir = input.runDir ? resolveStudyBuddyWorkspacePath(input.runDir, workspaceRoot) : null;
  const explicitOutputPath = input.outputPath ? resolveStudyBuddyWorkspacePath(input.outputPath, workspaceRoot) : null;
  const runDir = explicitRunDir || (explicitOutputPath ? path.dirname(explicitOutputPath) : path.resolve(outputRoot, timestampSlug()));
  ensurePrivateDirectorySync(runDir);
  const includeCis = input.includeCis ?? true;
  const cisUrls = includeCis
    ? input.cisUrls?.length
      ? input.cisUrls
      : parseUrlList(process.env.CIS_URLS)
    : [];

  const requestedMoodleUrl = input.moodleUrl || process.env.STUDY_BUDDY_MOODLE_URL || DEFAULT_MOODLE_URL;
  const promptMoodleUrl = extractMoodleUrlFromText(requestContextPrompt);
  const preferPromptMoodleUrl = shouldPreferPromptMoodleUrl(requestedMoodleUrl, promptMoodleUrl);
  const selectedMoodleUrl = preferPromptMoodleUrl
    ? promptMoodleUrl
    : requestedMoodleUrl;
  const moodleUrl = resolveVerifiedMoodleSource(requestContextPrompt, selectedMoodleUrl);
  const isDirectQuizAttempt = isMoodleQuizAttemptUrl(moodleUrl);
  let quizPolicy = createQuizPolicy({ requestedAutoAnswer: input.autoAnswer });
  const stage = input.stage ?? "all";
  const evidenceHandoffOnly = input.evidenceHandoffOnly ?? false;
  const quizSafetyPolicy = createQuizSafetyPolicy(
    input.quizSafetyPolicy,
    process.env,
  );
  const intentDecision = classifyStudyBuddyIntent({
    prompt: requestContextPrompt,
    stage,
    diagnosticOnly: input.diagnosticOnly ?? false,
    autoAnswer: quizPolicy.requestedAutoAnswer,
    includeCis,
    hasCisUrls: cisUrls.length > 0,
    hasCalendarUrl: Boolean(input.calendarUrl?.trim() || process.env.CIS_CALENDAR_URL?.trim()),
  });
  if (intentDecision.wantsQuizDiscovery || evidenceHandoffOnly) {
    quizPolicy = {
      ...quizPolicy,
      requestedAutoAnswer: false,
      allowAttemptOpen: false,
      allowTimedQuiz: false,
      allowLimitedAttemptQuiz: false,
      allowAnswerFill: false,
      allowAnswerChange: false,
      allowSaveOrMovePage: false,
    };
  }
  const calendarUrl = input.calendarUrl?.trim() || process.env.CIS_CALENDAR_URL?.trim() || undefined;
  const artifactIntent = classifyArtifactIntent(requestContextPrompt, {
    profile: input.artifactProfile,
    formats: input.formats,
    sourcePolicy: input.sourcePolicy,
    linkPolicy: input.linkPolicy,
  });
  const visualMode = parseVisualMode(
    input.visualMode || process.env.STUDY_BUDDY_VISUAL_MODE,
    input.visualsEnabled,
    !intentDecision.wantsQuickAnswer,
  );
  const visualsEnabled = visualMode === "inline" || (stage === "render" && visualMode === "deferred");
  const codexModel = trimOptional(input.codexModel) ?? trimOptional(process.env.STUDY_BUDDY_CODEX_MODEL);
  const outputLanguage = resolveOutputLanguage({
    prompt: originalUserPrompt,
    preference: input.outputLanguage,
  });
  const executionProfile = parseExecutionProfile(
    input.executionProfile ?? process.env.STUDY_BUDDY_EXECUTION_PROFILE,
  );
  const codexReasoningEffort =
    input.codexReasoningEffort ?? parseReasoningEffort(process.env.STUDY_BUDDY_CODEX_REASONING_EFFORT);

  return {
    prompt: input.prompt,
    originalUserPrompt,
    outputLanguage: outputLanguage.language,
    outputLanguageReason: outputLanguage.reason,
    moodleUrl,
    requestName,
    outputPath: explicitOutputPath || path.resolve(path.join(runDir, "document.typ")),
    runDir,
    maxDepth: input.maxDepth ?? (isDirectQuizAttempt ? 0 : 2),
    maxPages: input.maxPages ?? (isDirectQuizAttempt ? 1 : 8),
    maxCisPages: input.maxCisPages ?? parsePositiveInteger(process.env.CIS_MAX_PAGES, 4),
    allowFileDownloads: input.allowFileDownloads ?? true,
    baseUrl: process.env.MOODLE_BASE_URL || new URL(moodleUrl).origin,
    dashboardUrl: normalizeMoodleDashboardUrl(
      process.env.MOODLE_DASHBOARD_URL ||
        (preferPromptMoodleUrl ? dashboardUrlForMoodle(moodleUrl) : input.moodleUrl),
    ),
    username: process.env.MOODLE_USERNAME,
    password: process.env.MOODLE_PASSWORD,
    moodleLoginAllowedOrigins: parseUrlList(process.env.MOODLE_LOGIN_ALLOWED_ORIGINS),
    storageState: process.env.MOODLE_STORAGE_STATE || undefined,
    cisUrls,
    calendarUrl,
    cisBaseUrl: process.env.CIS_BASE_URL || inferBaseUrl(cisUrls[0]),
    cisDashboardUrl: process.env.CIS_DASHBOARD_URL || cisUrls[0] || DEFAULT_CIS_URL,
    cisUsername: process.env.CIS_USERNAME || process.env.MOODLE_USERNAME,
    cisPassword: process.env.CIS_PASSWORD || process.env.MOODLE_PASSWORD,
    cisLoginAllowedOrigins: parseUrlList(process.env.CIS_LOGIN_ALLOWED_ORIGINS),
    cisStorageState: process.env.CIS_STORAGE_STATE || undefined,
    headless: input.browserHeaded ? false : process.env.MOODLE_HEADLESS !== "false",
    // Credentials must never be passed through the agent-browser CLI argv boundary.
    browserBackend: process.env.MOODLE_PASSWORD
      ? "playwright"
      : parseBrowserBackend(input.browserBackend || process.env.MOODLE_BROWSER_BACKEND),
    diagnosticOnly: input.diagnosticOnly ?? false,
    autoAnswer: quizPolicy.requestedAutoAnswer,
    quizPolicy,
    quizSafetyPolicy,
    maxRuntimeMs: input.maxRuntimeMs ?? parseMaxRuntimeMs(
      stage,
      intentDecision.wantsQuickAnswer,
      executionProfile,
      codexModel,
      codexReasoningEffort,
      input.modelPolicyOverrides,
    ),
    idleTimeoutMs: input.idleTimeoutMs ?? parseIdleTimeoutMs(stage, intentDecision.wantsQuickAnswer),
    stage,
    sourceRunDir: input.sourceRunDir
      ? resolveStudyBuddyWorkspacePath(input.sourceRunDir, workspaceRoot)
      : undefined,
    resumeExtractionRunDir: input.resumeExtractionRunDir
      ? resolveStudyBuddyWorkspacePath(input.resumeExtractionRunDir, workspaceRoot)
      : undefined,
    evidenceHandoffOnly,
    includeCis,
    sourceMode: parseSourceMode(input.sourceMode || process.env.STUDY_BUDDY_SOURCE_MODE),
    downloadConcurrency: clampConcurrency(
      input.downloadConcurrency ?? parsePositiveInteger(process.env.STUDY_BUDDY_DOWNLOAD_CONCURRENCY, 3),
    ),
    typstValidationMode: parseTypstValidationMode(
      input.typstValidationMode || process.env.STUDY_BUDDY_TYPST_VALIDATION,
    ),
    renderStrategy: parseRenderStrategy(input.renderStrategy || process.env.STUDY_BUDDY_RENDER_STRATEGY),
    visualsEnabled,
    visualMode,
    visualCropMode: parseVisualCropMode(
      input.visualCropMode || process.env.STUDY_BUDDY_VISUAL_CROP_MODE,
    ),
    maxVisualAssets: input.maxVisualAssets ?? parseNonNegativeInteger(process.env.STUDY_BUDDY_VISUALS_MAX, 0),
    visualMinConfidence: input.visualMinConfidence ??
      parseConfidence(process.env.STUDY_BUDDY_VISUALS_MIN_CONFIDENCE, 0.65),
    intentDecision,
    artifactIntent,
    codexModel,
    codexReasoningEffort,
    codexPath: trimOptional(input.codexPath) ?? trimOptional(process.env.STUDY_BUDDY_CODEX_PATH),
    codexCompatibilityFallbackModel:
      trimOptional(input.codexCompatibilityFallbackModel) ??
      trimOptional(process.env.STUDY_BUDDY_CODEX_COMPATIBILITY_FALLBACK_MODEL),
    codexPreflightMode: parseCodexPreflightMode(
      input.codexPreflightMode ?? process.env.STUDY_BUDDY_CODEX_PREFLIGHT,
    ),
    codexModelExplicit: Boolean(codexModel),
    runtimeCacheDir: workspaceData.cacheRoot,
    executionProfile,
    modelPolicyOverrides: input.modelPolicyOverrides,
  };
}

export function sanitizeConfig(config: MoodleRuntimeConfig) {
  return {
    prompt: config.prompt,
    originalUserPrompt: config.originalUserPrompt,
    outputLanguage: config.outputLanguage,
    outputLanguageReason: config.outputLanguageReason,
    moodleUrl: config.moodleUrl,
    outputPath: config.outputPath,
    requestName: config.requestName,
    runDir: config.runDir,
    maxDepth: config.maxDepth,
    maxPages: config.maxPages,
    maxCisPages: config.maxCisPages,
    allowFileDownloads: config.allowFileDownloads,
    baseUrl: config.baseUrl,
    dashboardUrl: config.dashboardUrl,
    hasUsername: Boolean(config.username),
    hasPassword: Boolean(config.password),
    hasStorageState: Boolean(config.storageState),
    cisUrls: config.cisUrls,
    cisBaseUrl: config.cisBaseUrl,
    cisDashboardUrl: config.cisDashboardUrl,
    hasCisUsername: Boolean(config.cisUsername),
    hasCisPassword: Boolean(config.cisPassword),
    hasCisStorageState: Boolean(config.cisStorageState),
    hasCalendarUrl: Boolean(config.calendarUrl),
    headless: config.headless,
    browserBackend: config.browserBackend,
    diagnosticOnly: config.diagnosticOnly,
    autoAnswer: config.autoAnswer,
    quizPolicy: config.quizPolicy,
    quizSafetyPolicy: config.quizSafetyPolicy,
    maxRuntimeMs: config.maxRuntimeMs,
    idleTimeoutMs: config.idleTimeoutMs,
    stage: config.stage,
    sourceRunDir: config.sourceRunDir,
    resumeExtractionRunDir: config.resumeExtractionRunDir,
    includeCis: config.includeCis,
    sourceMode: config.sourceMode,
    downloadConcurrency: config.downloadConcurrency,
    typstValidationMode: config.typstValidationMode,
    renderStrategy: config.renderStrategy,
    sourcePlan: config.sourcePlan,
    renderStrategyDecision: config.renderStrategyDecision,
    intentDecision: config.intentDecision,
    taskBudget: resolveTaskBudget(config.intentDecision),
    targetCourseUrls: config.targetCourseUrls,
    visualsEnabled: config.visualsEnabled,
    maxVisualAssets: config.maxVisualAssets,
    visualMinConfidence: config.visualMinConfidence,
    visualMode: config.visualMode,
    visualCropMode: config.visualCropMode,
    artifactIntent: config.artifactIntent,
    codexModel: config.codexModel,
    codexReasoningEffort: config.codexReasoningEffort,
    codexBinarySource: config.codexPath ? "override" : "bundled",
    codexCompatibilityFallbackModel: config.codexCompatibilityFallbackModel,
    codexPreflightMode: config.codexPreflightMode,
    codexModelExplicit: config.codexModelExplicit,
    executionProfile: config.executionProfile,
    modelPolicyOverrides: config.modelPolicyOverrides,
  };
}

export function parseCodexPreflightMode(value: string | undefined): CodexPreflightMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "full") return "full";
  if (normalized === "version-only" || normalized === "off") return normalized;
  throw new Error(`Expected Codex preflight mode full, version-only, or off, got ${value}`);
}

function parseVisualMode(
  value: string | undefined,
  legacyVisualsEnabled: boolean | undefined,
  artifactRequest: boolean,
): VisualMode {
  if (legacyVisualsEnabled === false) {
    return "off";
  }
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "deferred" || normalized === "inline") {
    return normalized;
  }
  if (legacyVisualsEnabled === true) {
    return "inline";
  }
  if (process.env.STUDY_BUDDY_VISUALS_DISABLE === "true") {
    return "off";
  }
  if (
    process.env.STUDY_BUDDY_VISUALS_MAX !== undefined ||
    process.env.STUDY_BUDDY_VISUALS_MIN_CONFIDENCE !== undefined
  ) {
    return "inline";
  }
  return artifactRequest ? "inline" : "off";
}

export function parseVisualCropMode(value: string | undefined): VisualCropMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "auto";
  if (
    normalized === "auto" ||
    normalized === "focused" ||
    normalized === "context" ||
    normalized === "original"
  ) {
    return normalized;
  }
  throw new Error(`Expected visual crop mode auto, focused, context, or original, got ${value}`);
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function inferRequestName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .match(/[a-z0-9äöüß_-]{3,}/gi);
  return (words ?? ["moodle-run"]).slice(0, 6).join("-");
}

function shouldPreferPromptMoodleUrl(requestedUrl: string, promptUrl: string | null): promptUrl is string {
  if (!promptUrl) {
    return false;
  }
  return isMoodleDashboardUrl(requestedUrl);
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "moodle-run";
}

function parseUrlList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferBaseUrl(url: string | undefined): string {
  return url ? new URL(url).origin : "https://cis.technikum-wien.at";
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMaxRuntimeMs(
  stage: MoodleRuntimeConfig["stage"],
  wantsQuickAnswer: boolean,
  executionProfile: StudyBuddyExecutionProfile,
  globalModel: string | undefined,
  globalReasoningEffort: StudyBuddyReasoningEffort | undefined,
  overrides: MoodleRuntimeConfig["modelPolicyOverrides"],
): number {
  const stageOverride = stage === "extract"
    ? process.env.MOODLE_TEXT_EXTRACT_MAX_RUNTIME_MS || process.env.MOODLE_EXTRACT_MAX_RUNTIME_MS
    : stage === "render"
      ? process.env.MOODLE_RENDER_MAX_RUNTIME_MS
      : !wantsQuickAnswer
        ? process.env.MOODLE_ARTIFACT_MAX_RUNTIME_MS
        : undefined;
  const fallback = stage === "extract"
    ? DEFAULT_EXTRACTION_MAX_RUNTIME_MS
    : stage === "render"
      ? resolveDefaultRenderMaxRuntimeMs(
          executionProfile,
          globalModel,
          globalReasoningEffort,
          overrides,
        )
      : wantsQuickAnswer
        ? DEFAULT_QUICK_MAX_RUNTIME_MS
        : DEFAULT_ARTIFACT_MAX_RUNTIME_MS;
  return parsePositiveInteger(stageOverride || process.env.MOODLE_MAX_RUNTIME_MS, fallback);
}

function resolveDefaultRenderMaxRuntimeMs(
  profile: StudyBuddyExecutionProfile,
  globalModel: string | undefined,
  globalReasoningEffort: StudyBuddyReasoningEffort | undefined,
  overrides: MoodleRuntimeConfig["modelPolicyOverrides"],
): number {
  const policy = (task: "artifact_builder" | "artifact_repair" | "quality_reviewer", attempt: number) =>
    resolveTaskModelPolicy({
      profile,
      task,
      attempt,
      globalModel,
      globalReasoningEffort,
      overrides,
    }).timeoutMs;
  const formatterCapacity = policy("artifact_builder", 1) + 2 * policy("artifact_repair", 2);
  const visualReviewCapacity = 3 * 3 * policy("quality_reviewer", 1);
  return formatterCapacity + visualReviewCapacity + 2 * 60_000;
}

function parseIdleTimeoutMs(
  stage: MoodleRuntimeConfig["stage"],
  wantsQuickAnswer: boolean,
): number {
  const stageOverride = stage === "extract"
    ? process.env.MOODLE_TEXT_EXTRACT_IDLE_TIMEOUT_MS || process.env.MOODLE_EXTRACT_IDLE_TIMEOUT_MS
    : stage === "render"
      ? process.env.MOODLE_RENDER_IDLE_TIMEOUT_MS
      : !wantsQuickAnswer
        ? process.env.MOODLE_ARTIFACT_IDLE_TIMEOUT_MS
        : undefined;
  const fallback = wantsQuickAnswer
    ? DEFAULT_QUICK_IDLE_TIMEOUT_MS
    : DEFAULT_ARTIFACT_IDLE_TIMEOUT_MS;
  return parsePositiveInteger(stageOverride || process.env.MOODLE_IDLE_TIMEOUT_MS, fallback);
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseConfidence(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function parseBrowserBackend(value: string | undefined): BrowserBackend {
  if (!value) {
    return DEFAULT_BROWSER_BACKEND;
  }
  if (value === "playwright" || value === "agent-browser") {
    return value;
  }
  throw new Error(`Expected browser backend to be playwright or agent-browser, got ${value}`);
}

function parseSourceMode(value: string | undefined): SourceMode {
  if (!value) {
    return "auto";
  }
  if (value === "auto" || value === "moodle" || value === "cis" || value === "both") {
    return value;
  }
  throw new Error(`Expected source mode to be auto, moodle, cis, or both, got ${value}`);
}

function parseTypstValidationMode(value: string | undefined): TypstValidationMode {
  if (!value) {
    return "balanced";
  }
  if (value === "strict" || value === "balanced") {
    return value;
  }
  throw new Error(`Expected Typst validation mode to be strict or balanced, got ${value}`);
}

function parseRenderStrategy(value: string | undefined): RenderStrategyMode {
  if (!value) {
    return "auto";
  }
  if (value === "auto" || value === "deterministic" || value === "llm_formatter") {
    return value;
  }
  throw new Error(`Expected render strategy to be auto, deterministic, or llm_formatter, got ${value}`);
}

export function loadEnvFiles(candidates = defaultEnvFileCandidates()): void {
  for (const envPath of new Set(candidates)) {
    dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

function defaultEnvFileCandidates(): string[] {
  return [
    path.resolve(process.cwd(), ".env.local"),
    path.join(STUDY_BUDDY_ROOT, ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.join(STUDY_BUDDY_ROOT, ".env"),
  ];
}
