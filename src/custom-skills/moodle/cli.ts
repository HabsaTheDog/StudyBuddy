#!/usr/bin/env node
import { Command } from "commander";
import { runMoodleGraph } from "./graph.js";
import { runInteractiveMoodleGraph } from "./interactive/graph.js";
import { loadApprovedQuizPermission } from "./interactive/quizPermissions.js";
import { loadApprovedAssignmentPermission } from "./interactive/assignmentPermissions.js";
import {
  parseExecutionProfile,
  parseModelPolicyOverrides,
  parseReasoningEffort,
  resolveTaskModelPolicy,
} from "./modelPolicy.js";
import { parseCodexPreflightMode } from "./config.js";
import { acquireRunLease } from "../shared/runLease.js";
import { publishStudyBuddyDeliverables } from "../shared/deliverables.js";
import type { OutputLanguagePreference } from "../shared/languagePolicy.js";

const program = new Command()
  .name("moodle-agent")
  .description("Run the quarantined Moodle-to-Typst LangGraph skill.")
  .argument("<prompt>", "User request for the Moodle agent")
  .option(
    "--original-user-prompt <prompt>",
    "Exact untranslated user request used to lock the response/artifact language",
  )
  .requiredOption("--url <url>", "Moodle URL to inspect")
  .option("--out <path>", "Deprecated alias for --deliver-to")
  .option("--deliver-to <path>", "Publish validated user-facing files outside study-buddy-data")
  .option("--request-name <slug>", "Request-specific output directory name")
  .option("--run-dir <path>", "Explicit run directory")
  .option("--max-depth <number>", "Maximum same-domain crawl depth", parseNumber, 2)
  .option("--max-pages <number>", "Maximum Moodle pages to inspect", parseNumber, 8)
  .option("--cis-url <url>", "CIS URL to inspect; repeat for multiple pages", collect, [])
  .option("--calendar-url <url>", "Private personal university iCalendar feed URL")
  .option("--max-cis-pages <number>", "Maximum CIS pages to inspect", parseNumber, 4)
  .option("--browser-backend <backend>", "Browser backend: playwright or agent-browser")
  .option("--browser-headed", "Show the browser window for Moodle/CIS scraping")
  .option("--diagnostic-only", "Only test login, page access, source discovery, and diagnostics")
  .option("--auto-answer", "Accepted for quiz compatibility; final quiz submission is never allowed")
  .option("--max-runtime-ms <number>", "Hard maximum runtime in milliseconds", parseNumber)
  .option("--idle-timeout-ms <number>", "Maximum idle time in milliseconds", parseNumber)
  .option("--stage <stage>", "Pipeline stage: all, extract, or render", parseStage, "all")
  .option("--source-run-dir <path>", "Successful extraction run consumed by the render stage")
  .option("--resume-extraction-run-dir <path>", "Re-run extraction normalization and quality gates from an existing persisted handoff without crawling")
  .option("--source-mode <mode>", "Source mode: auto, moodle, cis, or both", parseSourceMode, "auto")
  .option("--download-concurrency <number>", "Parallel source-file downloads, clamped to 1..4", parseNumber)
  .option("--typst-validation <mode>", "Typst validation mode: strict or balanced", parseTypstValidation, "balanced")
  .option("--render-strategy <strategy>", "Render strategy: auto, deterministic, or llm_formatter", parseRenderStrategy, "auto")
  .option("--language <language>", "Artifact language: auto, de, or en", parseOutputLanguage, "auto")
  .option("--artifact-profile <profile>", "Artifact profile: study_guide, exam_navigator, interactive_learning, practice_pack, or source_audit", parseArtifactProfile)
  .option("--format <format>", "Output format; repeat for html and pdf", collectFormat, [])
  .option("--visual-mode <mode>", "Visual mode: off, deferred, or inline", parseVisualMode)
  .option("--visual-crop-mode <mode>", "Visual extraction: auto, focused, context, or original")
  .option("--fast-first", "Prioritize validated text extraction and first render before optional visuals")
  .option("--no-visuals", "Skip visual planning and visual asset extraction")
  .option("--max-visual-assets <number>", "Maximum visual candidates to pass through; 0 means automatic budget", parseNumber)
  .option("--visual-min-confidence <number>", "Minimum visual candidate confidence from 0 to 1", parseConfidence)
  .option("--codex-model <model>", "Codex model slug for Study Buddy LLM calls")
  .option("--codex-reasoning-effort <effort>", "Global Codex effort override: none/minimal, low, medium, high, or xhigh", parseReasoningEffort)
  .option("--codex-path <path>", "Explicit Codex executable override; bundled runtime is the default")
  .option("--codex-fallback-model <model>", "Compatibility fallback for policy-selected models")
  .option("--codex-preflight <mode>", "Codex preflight: full, version-only, or off", parseCodexPreflightMode)
  .option("--execution-profile <profile>", "Execution profile: auto, fast, balanced, quality, or custom", parseExecutionProfile, "auto")
  .option("--profile-overrides-json <json>", "Custom model policy overrides as JSON", parseModelPolicyOverrides)
  .option(
    "--approve-quiz-request <path>",
    "Resume the exact quiz described by a native Study Buddy permission request",
  )
  .option("--assignment-file <path>", "File to upload; repeat for multiple files", collect, [])
  .option(
    "--approve-assignment-request <path>",
    "Submit the exact assignment and files described by a native permission request",
  )
  .option("--no-cis", "Disable CIS for this run even when CIS_URLS is configured")
  .option("--no-downloads", "Do not capture linked files as run artifacts")
  .option("--json", "Print machine-readable JSON result")
  .parse(process.argv);

const options = program.opts<{
  url: string;
  originalUserPrompt?: string;
  out?: string;
  deliverTo?: string;
  requestName?: string;
  runDir?: string;
  maxDepth: number;
  maxPages: number;
  cisUrl: string[];
  calendarUrl?: string;
  maxCisPages: number;
  browserBackend?: "playwright" | "agent-browser";
  browserHeaded?: boolean;
  diagnosticOnly?: boolean;
  autoAnswer?: boolean;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  downloads: boolean;
  json?: boolean;
  stage: "all" | "extract" | "render";
  sourceRunDir?: string;
  resumeExtractionRunDir?: string;
  sourceMode: "auto" | "moodle" | "cis" | "both";
  downloadConcurrency?: number;
  typstValidation: "strict" | "balanced";
  renderStrategy: "auto" | "deterministic" | "llm_formatter";
  language: OutputLanguagePreference;
  cis: boolean;
  artifactProfile?: "study_guide" | "exam_navigator" | "interactive_learning" | "practice_pack" | "source_audit";
  format: Array<"html" | "pdf">;
  visualMode?: "off" | "deferred" | "inline";
  visualCropMode?: "auto" | "focused" | "context" | "original";
  fastFirst?: boolean;
  visuals: boolean;
  maxVisualAssets?: number;
  visualMinConfidence?: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  codexPath?: string;
  codexFallbackModel?: string;
  codexPreflight?: "full" | "version-only" | "off";
  executionProfile: "auto" | "fast" | "balanced" | "quality" | "custom";
  profileOverridesJson?: import("./modelPolicy.js").StudyBuddyModelPolicyOverrides;
  approveQuizRequest?: string;
  assignmentFile: string[];
  approveAssignmentRequest?: string;
}>();

const prompt = program.args.join(" ");
const intentPrompt = options.originalUserPrompt
  ? `${options.originalUserPrompt}\n${prompt}`
  : prompt;
const visualsEnabled = program.getOptionValueSource("visuals") === "cli"
  ? options.visuals
  : undefined;
const visualMode =
  program.getOptionValueSource("visualMode") === "cli"
    ? options.visualMode
    : options.fastFirst
      ? "deferred"
      : undefined;

const interactiveRequest =
  options.approveQuizRequest ||
  options.approveAssignmentRequest ||
  (options.autoAnswer && isQuizExecutionPrompt(intentPrompt)) ||
  isAssignmentExecutionPrompt(intentPrompt);

const releaseRunLease = await acquireRunLease(options.runDir);
let releaseRecoverySourceLease: () => Promise<void> = async () => {};
try {
if (options.resumeExtractionRunDir) {
  releaseRecoverySourceLease = await acquireRunLease(options.resumeExtractionRunDir);
}
if (interactiveRequest) {
  await runNativeQuizWorkflow({
    prompt,
    originalUserPrompt: options.originalUserPrompt,
    outputLanguage: options.language,
    url: options.url,
    runDir: options.runDir,
    maxDepth: options.maxDepth,
    maxPages: options.maxPages,
    maxCisPages: options.maxCisPages,
    browserBackend: options.browserBackend,
    browserHeaded: options.browserHeaded,
    autoAnswer: options.autoAnswer,
    downloads: options.downloads,
    codexModel: options.codexModel,
    executionProfile: options.executionProfile,
    codexReasoningEffort: options.codexReasoningEffort,
    profileOverrides: options.profileOverridesJson,
    approveQuizRequest: options.approveQuizRequest,
    assignmentFiles: options.assignmentFile,
    approveAssignmentRequest: options.approveAssignmentRequest,
    json: options.json,
  });
} else {
  const result = await runMoodleGraph({
  prompt,
  originalUserPrompt: options.originalUserPrompt,
  moodleUrl: options.url,
  requestName: options.requestName,
  runDir: options.runDir,
  maxDepth: options.maxDepth,
  maxPages: options.maxPages,
  cisUrls: options.cisUrl,
  calendarUrl: options.calendarUrl,
  maxCisPages: options.maxCisPages,
  allowFileDownloads: options.downloads,
  browserBackend: options.browserBackend,
  browserHeaded: options.browserHeaded,
  diagnosticOnly: options.diagnosticOnly,
  autoAnswer: options.autoAnswer,
  maxRuntimeMs: options.maxRuntimeMs,
  idleTimeoutMs: options.idleTimeoutMs,
  stage: options.stage,
  sourceRunDir: options.sourceRunDir,
  resumeExtractionRunDir: options.resumeExtractionRunDir,
  sourceMode: options.sourceMode,
  downloadConcurrency: options.downloadConcurrency,
  typstValidationMode: options.typstValidation,
  renderStrategy: options.renderStrategy,
  outputLanguage: options.language,
  includeCis: options.cis,
  artifactProfile: options.artifactProfile,
  formats: options.format.length ? options.format : undefined,
  visualsEnabled,
  visualMode,
  visualCropMode: options.visualCropMode,
  maxVisualAssets: options.maxVisualAssets,
  visualMinConfidence: options.visualMinConfidence,
  codexModel: options.codexModel,
  codexReasoningEffort: options.codexReasoningEffort,
  codexPath: options.codexPath,
  codexCompatibilityFallbackModel: options.codexFallbackModel,
  codexPreflightMode: options.codexPreflight,
  executionProfile: options.executionProfile,
  modelPolicyOverrides: options.profileOverridesJson,
});

  const publishedDeliverables = result.ok
    ? await publishStudyBuddyDeliverables({
        prompt,
        runDir: result.runDir,
        sourcePaths: [result.pdfPath, result.htmlPath],
        deliverTo: options.deliverTo ?? options.out,
      })
    : [];

  if (options.json) {
    console.log(JSON.stringify({ ...result, publishedDeliverables }, null, 2));
  } else if (result.ok) {
    console.log(`Run directory: ${result.runDir}`);
    if (result.outputPath) {
      console.log(`Wrote Typst document: ${result.outputPath}`);
    }
    if (result.answerPath) {
      console.log(`Wrote answer: ${result.answerPath}`);
    }
    if (result.answerJsonPath) {
      console.log(`Wrote answer data: ${result.answerJsonPath}`);
    }
    if (result.extractedDataPath) {
      console.log(`Wrote extracted data: ${result.extractedDataPath}`);
    }
    if (result.pdfPath) {
      console.log(`Wrote PDF document: ${result.pdfPath}`);
    }
    if (result.htmlPath) {
      console.log(`Wrote HTML navigator: ${result.htmlPath}`);
    }
    for (const deliverable of publishedDeliverables) {
      console.log(`Published deliverable: ${deliverable.publishedPath}`);
    }
    console.log(`Run metrics: ${result.metricsPath}`);
    console.log(`Run summary: ${result.runSummaryPath}`);
  } else {
    console.error(result.error || "Moodle graph failed.");
    console.error(`Run directory: ${result.runDir}`);
    console.error(`Run summary: ${result.runSummaryPath}`);
    process.exitCode = 1;
  }
}
} finally {
  await releaseRecoverySourceLease();
  await releaseRunLease();
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}`);
  }
  return parsed;
}

function parseConfidence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a number from 0 to 1, got ${value}`);
  }
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseStage(value: string): "all" | "extract" | "render" {
  if (value === "all" || value === "extract" || value === "render") {
    return value;
  }
  throw new Error(`Expected pipeline stage to be all, extract, or render, got ${value}`);
}

function parseSourceMode(value: string): "auto" | "moodle" | "cis" | "both" {
  if (value === "auto" || value === "moodle" || value === "cis" || value === "both") {
    return value;
  }
  throw new Error(`Expected source mode to be auto, moodle, cis, or both, got ${value}`);
}

function parseTypstValidation(value: string): "strict" | "balanced" {
  if (value === "strict" || value === "balanced") {
    return value;
  }
  throw new Error(`Expected Typst validation mode to be strict or balanced, got ${value}`);
}

function parseRenderStrategy(value: string): "auto" | "deterministic" | "llm_formatter" {
  if (value === "auto" || value === "deterministic" || value === "llm_formatter") {
    return value;
  }
  throw new Error(`Expected render strategy to be auto, deterministic, or llm_formatter, got ${value}`);
}

function parseOutputLanguage(value: string): OutputLanguagePreference {
  if (value === "auto" || value === "de" || value === "en") return value;
  throw new Error(`Expected language to be auto, de, or en, got ${value}`);
}

function parseVisualMode(value: string): "off" | "deferred" | "inline" {
  if (value === "off" || value === "deferred" || value === "inline") {
    return value;
  }
  throw new Error(`Invalid visual mode: ${value}`);
}

function parseArtifactProfile(
  value: string,
): "study_guide" | "exam_navigator" | "interactive_learning" | "practice_pack" | "source_audit" {
  if (
    value === "study_guide" ||
    value === "exam_navigator" ||
    value === "interactive_learning" ||
    value === "practice_pack" ||
    value === "source_audit"
  ) {
    return value;
  }
  throw new Error(`Unknown artifact profile: ${value}`);
}

function collectFormat(
  value: string,
  previous: Array<"html" | "pdf">,
): Array<"html" | "pdf"> {
  if (value !== "html" && value !== "pdf") {
    throw new Error(`Expected html or pdf, got ${value}`);
  }
  return [...previous, value];
}

function isQuizExecutionPrompt(value: string): boolean {
  return /\b(?:quiz|test|minitest|kurztest|testblock|selbstcheck|selbsttest|selfcheck|self[ -]?quiz)\b/i.test(value);
}

function isAssignmentExecutionPrompt(value: string): boolean {
  return (
    (/\b(?:assignment|submission|abgabe|aufgabe|übungsabgabe|uebungsabgabe)\b/i.test(value) ||
      /\/mod\/assign\//i.test(value)) &&
    /\b(?:submit|turn in|upload|abgeben|einreichen|hochladen)\b/i.test(value)
  );
}

async function runNativeQuizWorkflow(input: {
  prompt: string;
  originalUserPrompt?: string;
  outputLanguage: OutputLanguagePreference;
  url: string;
  runDir?: string;
  maxDepth: number;
  maxPages: number;
  maxCisPages: number;
  browserBackend?: "playwright" | "agent-browser";
  browserHeaded?: boolean;
  autoAnswer?: boolean;
  downloads: boolean;
  codexModel?: string;
  executionProfile: "auto" | "fast" | "balanced" | "quality" | "custom";
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  profileOverrides?: import("./modelPolicy.js").StudyBuddyModelPolicyOverrides;
  approveQuizRequest?: string;
  assignmentFiles: string[];
  approveAssignmentRequest?: string;
  json?: boolean;
}): Promise<void> {
  const approvedQuizPermission = input.approveQuizRequest
    ? await loadApprovedQuizPermission(input.approveQuizRequest)
    : undefined;
  const approvedAssignmentPermission = input.approveAssignmentRequest
    ? await loadApprovedAssignmentPermission(input.approveAssignmentRequest)
    : undefined;
  if (approvedQuizPermission && approvedAssignmentPermission) {
    throw new Error("Quiz and assignment approvals cannot be combined.");
  }
  const primaryQuizSolver = resolveTaskModelPolicy({
    profile: input.executionProfile,
    task: "quiz_solver",
    attempt: 1,
    globalModel: input.codexModel,
    globalReasoningEffort: input.codexReasoningEffort,
    overrides: input.profileOverrides,
  });
  const retryQuizSolver = resolveTaskModelPolicy({
    profile: input.executionProfile,
    task: "quiz_solver",
    attempt: 2,
    globalModel: input.codexModel,
    globalReasoningEffort: input.codexReasoningEffort,
    overrides: input.profileOverrides,
  });
  const result = await runInteractiveMoodleGraph({
    prompt: input.prompt,
    originalUserPrompt: input.originalUserPrompt,
    outputLanguage: input.outputLanguage,
    moodleUrl:
      approvedQuizPermission?.targetUrl ?? approvedAssignmentPermission?.targetUrl ?? input.url,
    runDir: input.runDir,
    maxDepth: input.maxDepth,
    maxPages: input.maxPages,
    maxCisPages: input.maxCisPages,
    browserBackend: input.browserBackend,
    browserHeaded: input.browserHeaded,
    autoAnswer: input.autoAnswer,
    allowFileDownloads: input.downloads,
    codexModel: input.codexModel,
    quizSolverModel: primaryQuizSolver.model,
    quizSolverReasoningEffort: primaryQuizSolver.reasoningEffort,
    quizSolverRetryModel: retryQuizSolver.model,
    quizSolverRetryReasoningEffort: retryQuizSolver.reasoningEffort,
    approvedQuizPermission,
    assignmentFiles:
      approvedAssignmentPermission?.files.map((file) => file.path) ?? input.assignmentFiles,
    approvedAssignmentPermission,
  });
  if (input.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Run directory: ${result.runDir}`);
    console.log(`Workflow status: ${result.workflowStatus}`);
    if (result.permissionRequestPath) {
      console.log(`Permission request: ${result.permissionRequestPath}`);
    }
    if (!result.ok) console.error(result.error || "Moodle interaction failed.");
    if (result.quizUrl) {
      console.log(`\n[Quiz in Moodle öffnen](${result.quizUrl})`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}
