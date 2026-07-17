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

const program = new Command()
  .name("web-layout-agent")
  .description("Generate a self-contained offline Study Buddy interactive HTML learning tool.")
  .argument("<prompt>", "User request for the web layout agent")
  .option("--kind <kind>", "Layout kind: auto, flashcards, concept-visualization, simulation, exam-practice, quiz, worksheet, reference", "auto")
  .option("--source-file <path>", "UTF-8 source text file; repeat for multiple files", collect, [])
  .option("--source-run-dir <path>", "Successful Moodle extraction run directory to consume")
  .option("--out <path>", "Output .html path")
  .option("--request-name <slug>", "Request-specific output directory name")
  .option("--run-dir <path>", "Explicit run directory")
  .option("--language <language>", "Language: de or en", parseLanguage, "de")
  .option("--browser-headed", "Show browser window during Playwright validation")
  .option("--skip-browser-validation", "Skip Playwright validation")
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
  sourceRunDir?: string;
  out?: string;
  requestName?: string;
  runDir?: string;
  language: "de" | "en";
  browserHeaded?: boolean;
  skipBrowserValidation?: boolean;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  executionProfile: "auto" | "fast" | "balanced" | "quality" | "custom";
  profileOverridesJson?: StudyBuddyModelPolicyOverrides;
  json?: boolean;
}>();

const prompt = program.args.join(" ");
const result = await runWebLayoutGraph({
  prompt,
  kind: options.kind,
  sourceFiles: options.sourceFile,
  sourceRunDir: options.sourceRunDir,
  outputPath: options.out,
  requestName: options.requestName,
  runDir: options.runDir,
  language: options.language,
  browserHeaded: options.browserHeaded,
  skipBrowserValidation: options.skipBrowserValidation,
  maxRuntimeMs: options.maxRuntimeMs,
  idleTimeoutMs: options.idleTimeoutMs,
  codexModel: options.codexModel,
  codexReasoningEffort: options.codexReasoningEffort,
  executionProfile: options.executionProfile,
  modelPolicyOverrides: options.profileOverridesJson,
});

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Run directory: ${result.runDir}`);
  console.log(`Wrote HTML document: ${result.outputPath}`);
  console.log(`Run summary: ${result.runSummaryPath}`);
} else {
  console.error(result.error || "Web layout graph failed.");
  console.error(`Run directory: ${result.runDir}`);
  console.error(`Run summary: ${result.runSummaryPath}`);
  process.exitCode = 1;
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

function parseLanguage(value: string): "de" | "en" {
  if (value === "de" || value === "en") {
    return value;
  }
  throw new Error(`Expected language to be de or en, got ${value}`);
}
