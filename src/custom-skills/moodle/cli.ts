#!/usr/bin/env node
import { Command } from "commander";
import { runMoodleGraph } from "./graph.js";

const program = new Command()
  .name("moodle-agent")
  .description("Run the quarantined Moodle-to-Typst LangGraph skill.")
  .argument("<prompt>", "User request for the Moodle agent")
  .requiredOption("--url <url>", "Moodle URL to inspect")
  .option("--out <path>", "Output .typ path")
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
  .option("--source-mode <mode>", "Source mode: auto, moodle, cis, or both", parseSourceMode, "auto")
  .option("--download-concurrency <number>", "Parallel source-file downloads, clamped to 1..4", parseNumber)
  .option("--typst-validation <mode>", "Typst validation mode: strict or balanced", parseTypstValidation, "balanced")
  .option("--render-strategy <strategy>", "Render strategy: auto, deterministic, or llm_formatter", parseRenderStrategy, "auto")
  .option("--no-cis", "Disable CIS for this run even when CIS_URLS is configured")
  .option("--no-downloads", "Do not capture linked files as run artifacts")
  .option("--json", "Print machine-readable JSON result")
  .parse(process.argv);

const options = program.opts<{
  url: string;
  out?: string;
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
  sourceMode: "auto" | "moodle" | "cis" | "both";
  downloadConcurrency?: number;
  typstValidation: "strict" | "balanced";
  renderStrategy: "auto" | "deterministic" | "llm_formatter";
  cis: boolean;
}>();

const prompt = program.args.join(" ");
const result = await runMoodleGraph({
  prompt,
  moodleUrl: options.url,
  outputPath: options.out,
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
  sourceMode: options.sourceMode,
  downloadConcurrency: options.downloadConcurrency,
  typstValidationMode: options.typstValidation,
  renderStrategy: options.renderStrategy,
  includeCis: options.cis,
});

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
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
  console.log(`Run summary: ${result.runSummaryPath}`);
} else {
  console.error(result.error || "Moodle graph failed.");
  console.error(`Run directory: ${result.runDir}`);
  console.error(`Run summary: ${result.runSummaryPath}`);
  process.exitCode = 1;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}`);
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
