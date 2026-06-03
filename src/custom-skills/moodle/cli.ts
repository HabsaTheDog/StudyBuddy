#!/usr/bin/env node
import { Command } from "commander";
import { runMoodleGraph } from "./graph.js";

const program = new Command()
  .name("moodle-agent")
  .description("Run the quarantined Moodle-to-Typst LangGraph skill.")
  .argument("<prompt>", "User request for the Moodle agent")
  .requiredOption("--url <url>", "Moodle URL to inspect")
  .option("--out <path>", "Output .typ path")
  .option("--max-depth <number>", "Maximum same-domain crawl depth", parseNumber, 1)
  .option("--max-pages <number>", "Maximum Moodle pages to inspect", parseNumber, 12)
  .option("--no-downloads", "Do not capture linked files as run artifacts")
  .option("--json", "Print machine-readable JSON result")
  .parse(process.argv);

const options = program.opts<{
  url: string;
  out?: string;
  maxDepth: number;
  maxPages: number;
  downloads: boolean;
  json?: boolean;
}>();

const prompt = program.args.join(" ");
const result = await runMoodleGraph({
  prompt,
  moodleUrl: options.url,
  outputPath: options.out,
  maxDepth: options.maxDepth,
  maxPages: options.maxPages,
  allowFileDownloads: options.downloads,
});

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Wrote Typst document: ${result.outputPath}`);
} else {
  console.error(result.error || "Moodle graph failed.");
  process.exitCode = 1;
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${value}`);
  }
  return parsed;
}
