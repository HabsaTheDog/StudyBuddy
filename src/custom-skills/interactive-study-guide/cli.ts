#!/usr/bin/env node
import { Command } from "commander";
import { installCliBrokenPipeGuard } from "../shared/cliErrorGuard.js";
import type { OutputLanguagePreference } from "../shared/languagePolicy.js";
import { parseExecutionProfile, parseModelPolicyOverrides, parseReasoningEffort, type StudyBuddyModelPolicyOverrides } from "../shared/modelPolicy.js";
import { runInteractiveStudyGuideWorkflow } from "./workflow.js";

installCliBrokenPipeGuard();

const program = new Command()
  .name("interactive-study-guide")
  .description("Run the canonical Moodle extraction-to-interactive-HTML Study Buddy workflow.")
  .argument("<prompt>", "Exact user request")
  .option("--url <url>", "Moodle URL used for evidence discovery", process.env.STUDY_BUDDY_MOODLE_URL ?? "https://moodle.technikum-wien.at/my/")
  .option("--request-name <slug>", "Request-specific workflow directory name")
  .option("--run-dir <path>", "Explicit workflow directory")
  .option("--resume-run-dir <path>", "Resume an existing workflow from its latest persisted extraction checkpoint")
  .option("--deliver-to <path>", "Publish validated HTML outside study-buddy-data")
  .option("--language <language>", "Language: auto, de, or en", parseLanguage, "auto")
  .option("--browser-headed", "Show browser windows during extraction and validation")
  .option("--max-runtime-ms <number>", "Per-stage hard runtime", parseNumber)
  .option("--idle-timeout-ms <number>", "Per-stage idle timeout", parseNumber)
  .option("--max-pages <number>", "Maximum Moodle pages for the initial extraction", parseNumber, 12)
  .option("--max-extraction-attempts <number>", "Initial extraction plus bounded checkpoint recoveries", parseNumber, 3)
  .option("--codex-model <model>", "Explicit global Codex model override")
  .option("--codex-reasoning-effort <effort>", "Explicit global reasoning effort", parseReasoningEffort)
  .option("--execution-profile <profile>", "Execution profile", parseExecutionProfile, "quality")
  .option("--profile-overrides-json <json>", "Custom task model policy overrides", parseModelPolicyOverrides)
  .option("--json", "Print machine-readable result")
  .parse(process.argv);

const options = program.opts<{
  url: string;
  requestName?: string;
  runDir?: string;
  resumeRunDir?: string;
  deliverTo?: string;
  language: OutputLanguagePreference;
  browserHeaded?: boolean;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  maxPages: number;
  maxExtractionAttempts: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  executionProfile: "auto" | "fast" | "balanced" | "quality" | "custom";
  profileOverridesJson?: StudyBuddyModelPolicyOverrides;
  json?: boolean;
}>();

const result = await runInteractiveStudyGuideWorkflow({
  prompt: program.args.join(" "),
  moodleUrl: options.url,
  requestName: options.requestName,
  runDir: options.runDir,
  resumeRunDir: options.resumeRunDir,
  deliverTo: options.deliverTo,
  language: options.language,
  browserHeaded: options.browserHeaded,
  maxRuntimeMs: options.maxRuntimeMs,
  idleTimeoutMs: options.idleTimeoutMs,
  maxPages: options.maxPages,
  maxExtractionAttempts: options.maxExtractionAttempts,
  codexModel: options.codexModel,
  codexReasoningEffort: options.codexReasoningEffort,
  executionProfile: options.executionProfile,
  modelPolicyOverrides: options.profileOverridesJson,
});

if (options.json) console.log(JSON.stringify(result, null, 2));
else if (result.ok) {
  console.log(`Workflow directory: ${result.runDir}`);
  console.log(`Extraction handoff: ${result.sourceRunDir}`);
  console.log(`Canonical HTML: ${result.outputPath}`);
  for (const deliverable of result.publishedDeliverables) console.log(`Published deliverable: ${deliverable.publishedPath}`);
  console.log(`Workflow summary: ${result.summaryPath}`);
} else {
  console.error(result.error ?? "Interactive Study Guide workflow failed.");
  console.error(`Workflow directory: ${result.runDir}`);
  console.error(`Workflow summary: ${result.summaryPath}`);
  process.exitCode = 1;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, got ${value}`);
  return parsed;
}

function parseLanguage(value: string): OutputLanguagePreference {
  if (value === "auto" || value === "de" || value === "en") return value;
  throw new Error(`Expected language to be auto, de, or en, got ${value}`);
}
