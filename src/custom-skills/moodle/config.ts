import { mkdirSync } from "node:fs";
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
} from "./types.js";
import { resolveVerifiedMoodleSource } from "./sourceHints.js";
import { clampConcurrency } from "./downloadQueue.js";
import { createQuizPolicy, isMoodleQuizAttemptUrl } from "./quizPolicy.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDY_BUDDY_ROOT = path.resolve(MODULE_DIR, "../../..");
const DEFAULT_BROWSER_BACKEND = "agent-browser";
const DEFAULT_MOODLE_URL = "https://moodle.technikum-wien.at/my/";
const DEFAULT_CIS_URL = "https://cis.technikum-wien.at/cis.php/";

loadEnvFiles();

export function createRuntimeConfig(input: MoodleGraphInput): MoodleRuntimeConfig {
  if (!input.prompt.trim()) {
    throw new Error("prompt is required.");
  }
  if (!input.moodleUrl.trim()) {
    throw new Error("moodleUrl is required.");
  }

  const requestName = safeSlug(input.requestName || inferRequestName(input.prompt));
  const workspaceRoot = resolveWorkspaceRoot();
  const outputRoot = path.join(workspaceRoot, "output", requestName);
  const explicitRunDir = input.runDir ? resolveWorkspacePath(input.runDir, workspaceRoot) : null;
  const explicitOutputPath = input.outputPath ? resolveWorkspacePath(input.outputPath, workspaceRoot) : null;
  const runDir = explicitRunDir || (explicitOutputPath ? path.dirname(explicitOutputPath) : path.resolve(outputRoot, timestampSlug()));
  mkdirSync(runDir, { recursive: true });
  const includeCis = input.includeCis ?? true;
  const cisUrls = includeCis
    ? input.cisUrls?.length
      ? input.cisUrls
      : parseUrlList(process.env.CIS_URLS)
    : [];

  const requestedMoodleUrl = input.moodleUrl || process.env.STUDY_BUDDY_MOODLE_URL || DEFAULT_MOODLE_URL;
  const promptMoodleUrl = extractMoodleUrlFromPrompt(input.prompt);
  const selectedMoodleUrl = shouldPreferPromptMoodleUrl(requestedMoodleUrl, promptMoodleUrl)
    ? promptMoodleUrl
    : requestedMoodleUrl;
  const moodleUrl = resolveVerifiedMoodleSource(input.prompt, selectedMoodleUrl);
  const isDirectQuizAttempt = isMoodleQuizAttemptUrl(moodleUrl);
  const quizPolicy = createQuizPolicy({ requestedAutoAnswer: input.autoAnswer });

  return {
    prompt: input.prompt,
    moodleUrl,
    requestName,
    outputPath: explicitOutputPath || path.resolve(path.join(runDir, "document.typ")),
    runDir,
    maxDepth: input.maxDepth ?? (isDirectQuizAttempt ? 0 : 2),
    maxPages: input.maxPages ?? (isDirectQuizAttempt ? 1 : 8),
    maxCisPages: input.maxCisPages ?? parsePositiveInteger(process.env.CIS_MAX_PAGES, 4),
    allowFileDownloads: input.allowFileDownloads ?? true,
    baseUrl: process.env.MOODLE_BASE_URL || new URL(moodleUrl).origin,
    dashboardUrl: process.env.MOODLE_DASHBOARD_URL || input.moodleUrl,
    username: process.env.MOODLE_USERNAME,
    password: process.env.MOODLE_PASSWORD,
    storageState: process.env.MOODLE_STORAGE_STATE || undefined,
    cisUrls,
    cisBaseUrl: process.env.CIS_BASE_URL || inferBaseUrl(cisUrls[0]),
    cisDashboardUrl: process.env.CIS_DASHBOARD_URL || cisUrls[0] || DEFAULT_CIS_URL,
    cisUsername: process.env.CIS_USERNAME || process.env.MOODLE_USERNAME,
    cisPassword: process.env.CIS_PASSWORD || process.env.MOODLE_PASSWORD,
    cisStorageState: process.env.CIS_STORAGE_STATE || undefined,
    headless: input.browserHeaded ? false : process.env.MOODLE_HEADLESS !== "false",
    browserBackend: parseBrowserBackend(input.browserBackend || process.env.MOODLE_BROWSER_BACKEND),
    diagnosticOnly: input.diagnosticOnly ?? false,
    autoAnswer: quizPolicy.requestedAutoAnswer,
    quizPolicy,
    maxRuntimeMs: input.maxRuntimeMs ?? parsePositiveInteger(process.env.MOODLE_MAX_RUNTIME_MS, 12 * 60_000),
    idleTimeoutMs: input.idleTimeoutMs ?? parsePositiveInteger(process.env.MOODLE_IDLE_TIMEOUT_MS, 8 * 60_000),
    stage: input.stage ?? "all",
    sourceRunDir: input.sourceRunDir
      ? resolveWorkspacePath(input.sourceRunDir, workspaceRoot)
      : undefined,
    includeCis,
    sourceMode: parseSourceMode(input.sourceMode || process.env.STUDY_BUDDY_SOURCE_MODE),
    downloadConcurrency: clampConcurrency(
      input.downloadConcurrency ?? parsePositiveInteger(process.env.STUDY_BUDDY_DOWNLOAD_CONCURRENCY, 3),
    ),
    typstValidationMode: parseTypstValidationMode(
      input.typstValidationMode || process.env.STUDY_BUDDY_TYPST_VALIDATION,
    ),
    renderStrategy: parseRenderStrategy(input.renderStrategy || process.env.STUDY_BUDDY_RENDER_STRATEGY),
    visualsEnabled: input.visualsEnabled ?? process.env.STUDY_BUDDY_VISUALS_DISABLE !== "true",
    maxVisualAssets: input.maxVisualAssets ?? parsePositiveInteger(process.env.STUDY_BUDDY_VISUALS_MAX, 3),
    visualMinConfidence: input.visualMinConfidence ??
      parseConfidence(process.env.STUDY_BUDDY_VISUALS_MIN_CONFIDENCE, 0.65),
  };
}

export function sanitizeConfig(config: MoodleRuntimeConfig) {
  return {
    prompt: config.prompt,
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
    headless: config.headless,
    browserBackend: config.browserBackend,
    diagnosticOnly: config.diagnosticOnly,
    autoAnswer: config.autoAnswer,
    quizPolicy: config.quizPolicy,
    maxRuntimeMs: config.maxRuntimeMs,
    idleTimeoutMs: config.idleTimeoutMs,
    stage: config.stage,
    sourceRunDir: config.sourceRunDir,
    includeCis: config.includeCis,
    sourceMode: config.sourceMode,
    downloadConcurrency: config.downloadConcurrency,
    typstValidationMode: config.typstValidationMode,
    renderStrategy: config.renderStrategy,
    sourcePlan: config.sourcePlan,
    renderStrategyDecision: config.renderStrategyDecision,
    visualsEnabled: config.visualsEnabled,
    maxVisualAssets: config.maxVisualAssets,
    visualMinConfidence: config.visualMinConfidence,
  };
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveWorkspaceRoot(): string {
  return path.resolve(
    process.env.STUDY_BUDDY_WORKSPACE ||
      process.env.T3CODE_CWD ||
      process.cwd(),
  );
}

function resolveWorkspacePath(value: string, workspaceRoot: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function inferRequestName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .match(/[a-z0-9äöüß_-]{3,}/gi);
  return (words ?? ["moodle-run"]).slice(0, 6).join("-");
}

function extractMoodleUrlFromPrompt(prompt: string): string | null {
  const match = prompt.match(/https:\/\/moodle\.technikum-wien\.at\/[^\s<>)"']+/i);
  return match ? match[0].replace(/[.,;:!?]+$/g, "") : null;
}

function shouldPreferPromptMoodleUrl(requestedUrl: string, promptUrl: string | null): promptUrl is string {
  if (!promptUrl) {
    return false;
  }
  const requested = new URL(requestedUrl);
  return requested.hostname === "moodle.technikum-wien.at" && MOODLE_DASHBOARD_PATHS.has(requested.pathname);
}

const MOODLE_DASHBOARD_PATHS = new Set(["/", "/my", "/my/"]);

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
