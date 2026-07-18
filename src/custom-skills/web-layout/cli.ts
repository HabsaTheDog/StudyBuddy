#!/usr/bin/env node
import { Command } from "commander";
import { runWebLayoutGraph } from "./graph.js";
import type { WebLayoutKind } from "./types.js";
import {
  parseExecutionProfile,
  parseModelPolicyOverrides,
  parseReasoningEffort,
  type StudyBuddyModelPolicyOverrides,
} from "../shared/modelPolicy.js";
import { acquireRunLease } from "../shared/runLease.js";
import { installCliBrokenPipeGuard } from "../shared/cliErrorGuard.js";
import { publishStudyBuddyDeliverables } from "../shared/deliverables.js";
import type { OutputLanguagePreference } from "../shared/languagePolicy.js";

installCliBrokenPipeGuard();

const program = new Command()
  .name("web-layout-agent")
  .description("Generate a self-contained offline Study Buddy interactive HTML learning tool.")
  .argument("<prompt>", "User request for the web layout agent")
  .option("--kind <kind>", "Layout kind: auto, study-guide, flashcards, concept-visualization, simulation, exam-practice, quiz, worksheet, reference", "auto")
  .option("--source-file <path>", "UTF-8 source text file; repeat for multiple files", collect, [])
  .option("--asset <path>", "Local image asset; repeat for multiple files", collect, [])
  .option("--source-run-dir <path>", "Successful Moodle extraction run directory to consume")
  .option("--resume-run-dir <path>", "Resume from a prior web-layout run with a validated build")
  .option("--out <path>", "Deprecated alias for --deliver-to")
  .option("--deliver-to <path>", "Publish the validated HTML outside study-buddy-data")
  .option("--request-name <slug>", "Request-specific output directory name")
  .option("--run-dir <path>", "Explicit run directory")
  .option("--language <language>", "Language: auto, de, or en", parseLanguage, "auto")
  .option("--browser-headed", "Show browser window during Playwright validation")
  .option("--skip-browser-validation", "Skip Playwright validation")
  .option("--max-artifact-mb <number>", "Maximum final HTML size in decimal MB (1-250)", parseArtifactMegabytes, 100)
  .option("--max-image-width <number>", "Maximum optimized raster width in pixels", parseNumber, 2000)
  .option("--webp-quality <number>", "Lossy WebP quality from 1 to 100", parseQuality, 84)
  .option("--max-runtime-ms <number>", "Hard maximum runtime in milliseconds", parseNumber)
  .option("--idle-timeout-ms <number>", "Maximum idle time in milliseconds", parseNumber)
  .option("--codex-model <model>", "Codex model slug for Study Buddy LLM calls")
  .option("--codex-reasoning-effort <effort>", "Global Codex reasoning effort", parseReasoningEffort)
  .option("--execution-profile <profile>", "Execution profile: fast, balanced, quality, or custom", parseExecutionProfile, "balanced")
  .option("--profile-overrides-json <json>", "Custom model policy overrides as JSON", parseModelPolicyOverrides)
  .option("--json", "Print machine-readable JSON result")
  .parse(process.argv);

const options = program.opts<{
  kind: WebLayoutKind;
  sourceFile: string[];
  asset: string[];
  sourceRunDir?: string;
  resumeRunDir?: string;
  out?: string;
  deliverTo?: string;
  requestName?: string;
  runDir?: string;
  language: OutputLanguagePreference;
  browserHeaded?: boolean;
  skipBrowserValidation?: boolean;
  maxArtifactMb: number;
  maxImageWidth: number;
  webpQuality: number;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  executionProfile: "auto" | "fast" | "balanced" | "quality" | "custom";
  profileOverridesJson?: StudyBuddyModelPolicyOverrides;
  json?: boolean;
}>();

const prompt = program.args.join(" ");
const releaseRunLease = await acquireRunLease(options.runDir ?? options.resumeRunDir);
try {
const result = await runWebLayoutGraph({
  prompt,
  kind: options.kind,
  sourceFiles: options.sourceFile,
  assetFiles: options.asset,
  sourceRunDir: options.sourceRunDir,
  resumeRunDir: options.resumeRunDir,
  requestName: options.requestName,
  runDir: options.runDir,
  language: options.language,
  browserHeaded: options.browserHeaded,
  skipBrowserValidation: options.skipBrowserValidation,
  maxArtifactBytes: options.maxArtifactMb * 1_000_000,
  maxImageWidth: options.maxImageWidth,
  webpQuality: options.webpQuality,
  maxRuntimeMs: options.maxRuntimeMs,
  idleTimeoutMs: options.idleTimeoutMs,
  codexModel: options.codexModel,
  codexReasoningEffort: options.codexReasoningEffort,
  executionProfile: options.executionProfile,
  modelPolicyOverrides: options.profileOverridesJson,
});

const publishedDeliverables = result.ok
  ? await publishStudyBuddyDeliverables({
      prompt,
      runDir: result.runDir,
      sourcePaths: [result.outputPath],
      deliverTo: options.deliverTo ?? options.out,
    })
  : [];

if (options.json) {
  console.log(JSON.stringify({ ...result, publishedDeliverables }, null, 2));
} else if (result.ok) {
  console.log(`Run directory: ${result.runDir}`);
  console.log(`Wrote HTML document: ${result.outputPath}`);
  for (const deliverable of publishedDeliverables) {
    console.log(`Published deliverable: ${deliverable.publishedPath}`);
  }
  console.log(`Run summary: ${result.runSummaryPath}`);
} else {
  console.error(result.error || "Web layout graph failed.");
  console.error(`Run directory: ${result.runDir}`);
  console.error(`Run summary: ${result.runSummaryPath}`);
  process.exitCode = 1;
}
} finally {
  await releaseRunLease();
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}`);
  }
  return parsed;
}

function parseArtifactMegabytes(value: string): number {
  const parsed = parseNumber(value);
  if (parsed < 1 || parsed > 250) {
    throw new Error(`Expected artifact size from 1 to 250 MB, got ${value}`);
  }
  return parsed;
}

function parseQuality(value: string): number {
  const parsed = parseNumber(value);
  if (parsed < 1 || parsed > 100) {
    throw new Error(`Expected WebP quality from 1 to 100, got ${value}`);
  }
  return parsed;
}

function parseLanguage(value: string): OutputLanguagePreference {
  if (value === "auto" || value === "de" || value === "en") {
    return value;
  }
  throw new Error(`Expected language to be auto, de, or en, got ${value}`);
}
