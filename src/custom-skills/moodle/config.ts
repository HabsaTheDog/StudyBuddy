import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { BrowserBackend, MoodleGraphInput, MoodleRuntimeConfig } from "./types.js";
import { resolveVerifiedMoodleSource } from "./sourceHints.js";

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
  const outputRoot = resolveStudyBuddyPath(process.env.MOODLE_OUTPUT_DIR || path.join("output", requestName));
  const explicitRunDir = input.runDir ? resolveStudyBuddyPath(input.runDir) : null;
  const explicitOutputPath = input.outputPath ? resolveStudyBuddyPath(input.outputPath) : null;
  const runDir = explicitRunDir || (explicitOutputPath ? path.dirname(explicitOutputPath) : path.resolve(outputRoot, timestampSlug()));
  mkdirSync(runDir, { recursive: true });
  const includeCis = input.includeCis ?? true;
  const cisUrls = includeCis
    ? input.cisUrls?.length
      ? input.cisUrls
      : parseUrlList(process.env.CIS_URLS)
    : [];

  const moodleUrl = resolveVerifiedMoodleSource(
    input.prompt,
    input.moodleUrl || process.env.STUDY_BUDDY_MOODLE_URL || DEFAULT_MOODLE_URL,
  );

  return {
    prompt: input.prompt,
    moodleUrl,
    requestName,
    outputPath: explicitOutputPath || path.resolve(path.join(runDir, "document.typ")),
    runDir,
    maxDepth: input.maxDepth ?? 2,
    maxPages: input.maxPages ?? 8,
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
    autoAnswer: input.autoAnswer ?? false,
    maxRuntimeMs: input.maxRuntimeMs ?? parsePositiveInteger(process.env.MOODLE_MAX_RUNTIME_MS, 12 * 60_000),
    idleTimeoutMs: input.idleTimeoutMs ?? parsePositiveInteger(process.env.MOODLE_IDLE_TIMEOUT_MS, 8 * 60_000),
    stage: input.stage ?? "all",
    sourceRunDir: input.sourceRunDir ? resolveStudyBuddyPath(input.sourceRunDir) : undefined,
    includeCis,
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
    maxRuntimeMs: config.maxRuntimeMs,
    idleTimeoutMs: config.idleTimeoutMs,
    stage: config.stage,
    sourceRunDir: config.sourceRunDir,
    includeCis: config.includeCis,
  };
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveStudyBuddyPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(STUDY_BUDDY_ROOT, value);
}

function inferRequestName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .match(/[a-z0-9äöüß_-]{3,}/gi);
  return (words ?? ["moodle-run"]).slice(0, 6).join("-");
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

function parseBrowserBackend(value: string | undefined): BrowserBackend {
  if (!value) {
    return DEFAULT_BROWSER_BACKEND;
  }
  if (value === "playwright" || value === "agent-browser") {
    return value;
  }
  throw new Error(`Expected browser backend to be playwright or agent-browser, got ${value}`);
}

export function loadEnvFiles(candidates = defaultEnvFileCandidates()): void {
  for (const envPath of new Set(candidates)) {
    dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

function defaultEnvFileCandidates(): string[] {
  return [
    path.resolve(process.cwd(), ".env"),
    path.join(STUDY_BUDDY_ROOT, ".env"),
  ];
}
