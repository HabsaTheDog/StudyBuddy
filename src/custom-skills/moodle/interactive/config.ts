import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type {
  MoodleGraphInput,
  MoodleRuntimeConfig,
  QuizAccessMode,
  QuizSafetyPolicy,
} from "./types.js";
import { assertApprovedQuizTarget } from "./quizPermissions.js";
import { assertApprovedAssignmentTarget } from "./assignmentPermissions.js";

const DEFAULT_BROWSER_BACKEND = "playwright";
const DEFAULT_BROWSER_MAX_OUTPUT = 50_000;
const DEFAULT_BROWSER_ALLOWED_DOMAINS = [
  "moodle.technikum-wien.at",
  "cis.technikum-wien.at",
  "*.technikum-wien.at",
];
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDY_BUDDY_ROOT = path.resolve(MODULE_DIR, "../../../..");

export function createRuntimeConfig(input: MoodleGraphInput): MoodleRuntimeConfig {
  if (!input.prompt.trim()) {
    throw new Error("prompt is required.");
  }
  if (!input.moodleUrl.trim()) {
    throw new Error("moodleUrl is required.");
  }

  const environment = loadEnvFiles(defaultEnvFileCandidates(process.env), process.env);
  const accessMode = parseQuizAccessMode(environment.MOODLE_QUIZ_ACCESS_MODE);
  const workspaceRoot = resolveWorkspaceRoot(environment);
  const outputRoot = path.join(workspaceRoot, "output", requestSlug(input.prompt));
  const explicitOutputPath = input.outputPath
    ? resolveWorkspacePath(input.outputPath, workspaceRoot)
    : null;
  const explicitRunDir = input.runDir ? resolveWorkspacePath(input.runDir, workspaceRoot) : null;
  const runDir =
    explicitRunDir ??
    (explicitOutputPath
      ? path.dirname(explicitOutputPath)
      : path.resolve(outputRoot, timestampSlug()));
  mkdirSync(runDir, { recursive: true });
  const runSlug = path.basename(runDir).replace(/[^a-z0-9_-]+/gi, "-") || "run";
  const requestedBrowserBackend = parseBrowserBackend(
    input.browserBackend || environment.MOODLE_BROWSER_BACKEND,
  );
  const requestedCisBrowserBackend = parseBrowserBackend(
    input.cisBrowserBackend || environment.CIS_BROWSER_BACKEND || "playwright",
  );
  // Credential values must never cross the agent-browser CLI argv boundary.
  // Authenticated runs are forced through the in-process Playwright broker.
  const browserBackend = environment.MOODLE_PASSWORD ? "playwright" : requestedBrowserBackend;
  const cisBrowserBackend =
    environment.CIS_PASSWORD || environment.MOODLE_PASSWORD
      ? "playwright"
      : requestedCisBrowserBackend;
  if (input.approvedQuizPermission) {
    assertApprovedQuizTarget(input.approvedQuizPermission, input.moodleUrl);
  }
  if (input.approvedAssignmentPermission) {
    assertApprovedAssignmentTarget(input.approvedAssignmentPermission, input.moodleUrl);
    if (accessMode !== "full-study-assist") {
      throw new Error("Assignment submission requires Full study assist mode.");
    }
  }
  const quizSafetyPolicy = createQuizSafetyPolicy(
    input.approvedQuizPermission
      ? {
          ...input.quizSafetyPolicy,
          allowStartingOrContinuingAttempts: true,
          allowReadingQuestions: true,
          allowSuggestingAnswers: true,
          allowFillingAnswers: true,
          allowChangingExistingAnswers: true,
          allowSavingMovingNext: true,
          askBeforeStartingOrContinuingAttempts: false,
          askBeforeTimedQuizzes: false,
          askBeforeLimitedAttemptQuizzes: false,
          askBeforeFillingAnswers: false,
          askBeforeChangingExistingAnswers: false,
        }
      : input.quizSafetyPolicy,
    environment,
  );

  return {
    prompt: input.prompt,
    moodleUrl: input.moodleUrl,
    outputPath: explicitOutputPath || path.resolve(path.join(runDir, "document.typ")),
    runDir,
    maxDepth: input.maxDepth ?? 1,
    maxPages: input.maxPages ?? 12,
    maxCisPages: input.maxCisPages ?? parsePositiveInteger(environment.CIS_MAX_PAGES, 8),
    allowFileDownloads: input.allowFileDownloads ?? true,
    baseUrl: environment.MOODLE_BASE_URL || new URL(input.moodleUrl).origin,
    dashboardUrl: environment.MOODLE_DASHBOARD_URL || input.moodleUrl,
    username: environment.MOODLE_USERNAME,
    password: environment.MOODLE_PASSWORD,
    storageState: environment.MOODLE_STORAGE_STATE || undefined,
    cisUrls: input.cisUrls?.length ? input.cisUrls : parseUrlList(environment.CIS_URLS),
    calendarUrl: input.calendarUrl?.trim() || environment.CIS_CALENDAR_URL?.trim() || undefined,
    cisBaseUrl:
      environment.CIS_BASE_URL ||
      inferBaseUrl(input.cisUrls?.[0] || parseUrlList(environment.CIS_URLS)[0], environment),
    cisDashboardUrl:
      environment.CIS_DASHBOARD_URL ||
      input.cisUrls?.[0] ||
      parseUrlList(environment.CIS_URLS)[0] ||
      "",
    cisUsername: environment.CIS_USERNAME || environment.MOODLE_USERNAME,
    cisPassword: environment.CIS_PASSWORD || environment.MOODLE_PASSWORD,
    cisStorageState: environment.CIS_STORAGE_STATE || undefined,
    headless: input.browserHeaded ? false : environment.MOODLE_HEADLESS !== "false",
    browserBackend,
    cisBrowserBackend,
    agentBrowserBin: environment.AGENT_BROWSER_BIN || undefined,
    browserSession: environment.MOODLE_BROWSER_SESSION || `study-buddy-${runSlug}`,
    browserSessionName: environment.MOODLE_BROWSER_SESSION_NAME || "study-buddy-technikum",
    browserAllowedDomains: deriveBrowserAllowedDomains(input, environment),
    moodleLoginAllowedOrigins: parseAllowedOrigins(environment.MOODLE_LOGIN_ALLOWED_ORIGINS),
    cisLoginAllowedOrigins: parseAllowedOrigins(environment.CIS_LOGIN_ALLOWED_ORIGINS),
    browserActionPolicyPath:
      environment.MOODLE_BROWSER_ACTION_POLICY ||
      path.resolve(path.join(MODULE_DIR, "config", "agent-browser.policy.json")),
    browserMaxOutput:
      input.browserMaxOutput ??
      parsePositiveInteger(environment.MOODLE_BROWSER_MAX_OUTPUT, DEFAULT_BROWSER_MAX_OUTPUT),
    keepBrowserOpen: input.keepBrowserOpen ?? environment.MOODLE_BROWSER_KEEP_OPEN === "true",
    autoAnswer: input.autoAnswer ?? quizSafetyPolicy.allowFillingAnswers,
    quizSafetyPolicy,
    approvedQuizPermission: input.approvedQuizPermission,
    assignmentFiles: (input.assignmentFiles ?? []).map((file) =>
      resolveWorkspacePath(file, workspaceRoot),
    ),
    approvedAssignmentPermission: input.approvedAssignmentPermission,
    codexModel: trimOptional(input.codexModel) ?? trimOptional(environment.STUDY_BUDDY_CODEX_MODEL),
    quizSolverModelPolicy: createQuizSolverModelPolicy(input),
  };
}

function createQuizSolverModelPolicy(
  input: MoodleGraphInput,
): MoodleRuntimeConfig["quizSolverModelPolicy"] {
  const model = trimOptional(input.quizSolverModel);
  const retryModel = trimOptional(input.quizSolverRetryModel);
  const configuredValues = [
    model,
    input.quizSolverReasoningEffort,
    retryModel,
    input.quizSolverRetryReasoningEffort,
  ];
  if (configuredValues.every((value) => value === undefined)) {
    return undefined;
  }
  if (
    !model ||
    !input.quizSolverReasoningEffort ||
    !retryModel ||
    !input.quizSolverRetryReasoningEffort
  ) {
    throw new Error("Quiz Solver model policy requires primary and retry model/effort values.");
  }
  return {
    model,
    reasoningEffort: input.quizSolverReasoningEffort,
    retryModel,
    retryReasoningEffort: input.quizSolverRetryReasoningEffort,
  };
}

function deriveBrowserAllowedDomains(
  input: MoodleGraphInput,
  environment: NodeJS.ProcessEnv,
): string[] {
  const configured = parseUrlList(environment.MOODLE_BROWSER_ALLOWED_DOMAINS);
  if (configured.length > 0) return configured;

  const candidateUrls = [
    input.moodleUrl,
    environment.MOODLE_BASE_URL,
    environment.MOODLE_DASHBOARD_URL,
    ...(input.cisUrls ?? []),
    ...parseUrlList(environment.CIS_URLS),
    environment.CIS_BASE_URL,
    environment.CIS_DASHBOARD_URL,
  ];
  const inferredHosts = candidateUrls.flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(value).hostname];
    } catch {
      return [];
    }
  });
  return [...new Set([...DEFAULT_BROWSER_ALLOWED_DOMAINS, ...inferredHosts])];
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function createQuizSafetyPolicy(
  overrides: Partial<QuizSafetyPolicy> = {},
  environment: NodeJS.ProcessEnv = loadEnvFiles(defaultEnvFileCandidates(process.env), process.env),
): QuizSafetyPolicy {
  const accessMode = parseQuizAccessMode(environment.MOODLE_QUIZ_ACCESS_MODE);
  const basePolicy = accessMode
    ? quizAccessModePolicy(accessMode)
    : legacyQuizSafetyPolicy(environment);
  return {
    ...basePolicy,
    minimumTimeLimitMinutes: parseNonNegativeNumber(
      environment.MOODLE_QUIZ_MIN_TIME_LIMIT_MINUTES,
      basePolicy.minimumTimeLimitMinutes,
    ),
    minimumAttemptsLeft: parseNonNegativeNumber(
      environment.MOODLE_QUIZ_MIN_ATTEMPTS_LEFT,
      basePolicy.minimumAttemptsLeft,
    ),
    fillConfidenceThreshold: parseBoundedNumber(
      environment.MOODLE_QUIZ_FILL_CONFIDENCE_THRESHOLD,
      basePolicy.fillConfidenceThreshold,
      0,
      1,
    ),
    ...overrides,
    finalSubmissionBlocked: true,
  };
}

function legacyQuizSafetyPolicy(environment: NodeJS.ProcessEnv): QuizSafetyPolicy {
  return {
    accessMode: "review-only",
    allowOpeningQuizPages: parseBoolean(environment.MOODLE_QUIZ_ALLOW_OPEN, true),
    allowStartingOrContinuingAttempts: parseBoolean(environment.MOODLE_QUIZ_ALLOW_ATTEMPT, false),
    minimumTimeLimitMinutes: 10,
    minimumAttemptsLeft: 2,
    allowReadingQuestions: parseBoolean(environment.MOODLE_QUIZ_ALLOW_READ_QUESTIONS, true),
    allowSuggestingAnswers: parseBoolean(environment.MOODLE_QUIZ_ALLOW_SUGGEST_ANSWERS, false),
    allowFillingAnswers: parseBoolean(environment.MOODLE_QUIZ_ALLOW_FILL_ANSWERS, false),
    allowChangingExistingAnswers: parseBoolean(
      environment.MOODLE_QUIZ_ALLOW_CHANGE_EXISTING_ANSWERS,
      false,
    ),
    allowSavingMovingNext: parseBoolean(environment.MOODLE_QUIZ_ALLOW_SAVE_NEXT, false),
    askBeforeStartingOrContinuingAttempts: parseBoolean(
      environment.MOODLE_QUIZ_ASK_BEFORE_ATTEMPT,
      true,
    ),
    askBeforeTimedQuizzes: parseBoolean(environment.MOODLE_QUIZ_ASK_BEFORE_TIMED, true),
    askBeforeLimitedAttemptQuizzes: parseBoolean(
      environment.MOODLE_QUIZ_ASK_BEFORE_LIMITED_ATTEMPTS,
      true,
    ),
    askBeforeFillingAnswers: parseBoolean(environment.MOODLE_QUIZ_ASK_BEFORE_FILL, true),
    askBeforeChangingExistingAnswers: parseBoolean(
      environment.MOODLE_QUIZ_ASK_BEFORE_CHANGE_EXISTING,
      true,
    ),
    fillConfidenceThreshold: 0.85,
    finalSubmissionBlocked: true,
  };
}

function quizAccessModePolicy(accessMode: QuizAccessMode): QuizSafetyPolicy {
  const common = {
    accessMode,
    minimumTimeLimitMinutes: 10,
    minimumAttemptsLeft: 2,
    fillConfidenceThreshold: 0.85,
    finalSubmissionBlocked: true,
  } as const;
  switch (accessMode) {
    case "review-only":
      return {
        ...common,
        allowOpeningQuizPages: true,
        allowStartingOrContinuingAttempts: false,
        allowReadingQuestions: true,
        allowSuggestingAnswers: false,
        allowFillingAnswers: false,
        allowChangingExistingAnswers: false,
        allowSavingMovingNext: false,
        askBeforeStartingOrContinuingAttempts: true,
        askBeforeTimedQuizzes: true,
        askBeforeLimitedAttemptQuizzes: true,
        askBeforeFillingAnswers: true,
        askBeforeChangingExistingAnswers: true,
      };
    case "ask-before-attempt":
      return {
        ...common,
        allowOpeningQuizPages: true,
        allowStartingOrContinuingAttempts: true,
        allowReadingQuestions: true,
        allowSuggestingAnswers: true,
        allowFillingAnswers: true,
        allowChangingExistingAnswers: true,
        allowSavingMovingNext: true,
        askBeforeStartingOrContinuingAttempts: true,
        askBeforeTimedQuizzes: true,
        askBeforeLimitedAttemptQuizzes: true,
        askBeforeFillingAnswers: true,
        askBeforeChangingExistingAnswers: true,
      };
    case "quiz-assist":
      return {
        ...common,
        allowOpeningQuizPages: true,
        allowStartingOrContinuingAttempts: true,
        allowReadingQuestions: true,
        allowSuggestingAnswers: true,
        allowFillingAnswers: true,
        allowChangingExistingAnswers: true,
        allowSavingMovingNext: true,
        askBeforeStartingOrContinuingAttempts: false,
        askBeforeTimedQuizzes: false,
        askBeforeLimitedAttemptQuizzes: false,
        askBeforeFillingAnswers: false,
        askBeforeChangingExistingAnswers: false,
      };
    case "full-study-assist":
      return {
        ...common,
        allowOpeningQuizPages: true,
        allowStartingOrContinuingAttempts: true,
        allowReadingQuestions: true,
        allowSuggestingAnswers: true,
        allowFillingAnswers: true,
        allowChangingExistingAnswers: true,
        allowSavingMovingNext: true,
        askBeforeStartingOrContinuingAttempts: false,
        askBeforeTimedQuizzes: false,
        askBeforeLimitedAttemptQuizzes: false,
        askBeforeFillingAnswers: false,
        askBeforeChangingExistingAnswers: false,
      };
  }
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveWorkspaceRoot(environment: NodeJS.ProcessEnv): string {
  return path.resolve(environment.STUDY_BUDDY_WORKSPACE || environment.T3CODE_CWD || process.cwd());
}

function resolveWorkspacePath(value: string, workspaceRoot: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function requestSlug(prompt: string): string {
  return (
    prompt
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[^a-z0-9äöüß_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "moodle-run"
  );
}

function parseUrlList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseAllowedOrigins(value: string | undefined): string[] {
  return parseUrlList(value).flatMap((entry) => {
    try {
      const parsed = new URL(entry);
      return parsed.protocol === "https:" ? [parsed.origin] : [];
    } catch {
      return [];
    }
  });
}

function inferBaseUrl(url: string | undefined, environment: NodeJS.ProcessEnv): string {
  if (!url) {
    return environment.CIS_BASE_URL || "https://cis.technikum-wien.at";
  }
  return new URL(url).origin;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseBrowserBackend(value: string | undefined): "agent-browser" | "playwright" {
  if (!value) {
    return DEFAULT_BROWSER_BACKEND;
  }
  if (value === "agent-browser" || value === "playwright") {
    return value;
  }
  throw new Error(
    `Expected MOODLE_BROWSER_BACKEND to be agent-browser or playwright, got ${value}`,
  );
}

function parseQuizAccessMode(value: string | undefined): QuizAccessMode | null {
  if (value === "info-only") {
    return "review-only";
  }
  if (value === "full-study-assist") {
    return "full-study-assist";
  }
  if (value === "review-only" || value === "ask-before-attempt" || value === "quiz-assist") {
    return value;
  }
  return null;
}

export function loadEnvFiles(
  candidates = defaultEnvFileCandidates(process.env),
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
  for (const envPath of new Set(candidates)) {
    try {
      const parsed = dotenv.parse(readFileSync(envPath, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (environment[key] === undefined) environment[key] = value;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return environment;
}

function defaultEnvFileCandidates(environment: NodeJS.ProcessEnv): string[] {
  return [
    ...(environment.STUDY_BUDDY_ROOT
      ? [path.join(environment.STUDY_BUDDY_ROOT, ".env.local")]
      : []),
    path.resolve(process.cwd(), ".env.local"),
    path.join(STUDY_BUDDY_ROOT, ".env.local"),
    ...(environment.STUDY_BUDDY_ROOT ? [path.join(environment.STUDY_BUDDY_ROOT, ".env")] : []),
    path.resolve(process.cwd(), ".env"),
    path.join(STUDY_BUDDY_ROOT, ".env"),
  ];
}
