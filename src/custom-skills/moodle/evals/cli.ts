#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadEvalCorpus, type StudyBuddyEvalCase, type StudyBuddyEvalCorpus } from "./corpus.js";
import { evaluateWorkflow, type EvalRunResult } from "./evaluate.js";
import { rankEvalProfiles } from "./ranking.js";
import { parseExecutionProfile, type StudyBuddyExecutionProfile } from "../modelPolicy.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = path.join(MODULE_DIR, "corpus", "baseline.json");
const DEFAULT_WRAPPER = path.join(
  process.env.HOME ?? "",
  ".agents",
  "skills",
  "study-buddy",
  "scripts",
  "study_buddy_task.sh",
);

const program = new Command()
  .name("moodle-eval")
  .description("Plan, execute, or score Study Buddy model-policy evaluations.")
  .option("--corpus <path>", "Versioned evaluation corpus JSON", DEFAULT_CORPUS)
  .option("--profile <profile>", "Profile to compare; repeatable", collectProfile, [])
  .option("--execute", "Execute enabled corpus cases through the official staged document wrapper")
  .option("--prompt <text>", "Ad-hoc evaluation prompt; requires --execute")
  .option("--url <url>", "Direct Moodle URL for the ad-hoc case")
  .option("--evaluate-run <path>", "Score an existing staged workflow directory")
  .option("--out-dir <path>", "Evaluation report directory")
  .option("--json", "Print the JSON report")
  .parse(process.argv);

const options = program.opts<{
  corpus: string;
  profile: StudyBuddyExecutionProfile[];
  execute?: boolean;
  prompt?: string;
  url?: string;
  evaluateRun?: string;
  outDir?: string;
  json?: boolean;
}>();

const profiles = options.profile.length > 0 ? [...new Set(options.profile)] : ["fast", "balanced"] as const;
const corpus = options.prompt
  ? adHocCorpus(options.prompt, options.url)
  : await loadEvalCorpus(path.resolve(options.corpus));
const reportDir = path.resolve(
  options.outDir ?? path.join(process.cwd(), "output", "evals", corpus.id, timestampSlug()),
);
await mkdir(reportDir, { recursive: true });
const corpusSnapshot = `${JSON.stringify(corpus, null, 2)}\n`;
await writeFile(path.join(reportDir, "corpus-snapshot.json"), corpusSnapshot, "utf8");

const results: Array<{ caseId: string; result: EvalRunResult }> = [];
if (options.evaluateRun) {
  results.push({
    caseId: "existing-run",
    result: await evaluateWorkflow(path.resolve(options.evaluateRun), "existing"),
  });
} else if (options.execute) {
  const enabledCases = corpus.cases.filter((entry) => entry.enabled);
  if (enabledCases.length === 0) {
    throw new Error("The corpus has no enabled cases. Enable a reviewed case or pass --prompt and --url.");
  }
  for (const evalCase of enabledCases) {
    for (const profile of profiles) {
      const workflowDir = await executeCase(evalCase, profile);
      results.push({ caseId: evalCase.id, result: await evaluateWorkflow(workflowDir, profile, evalCase) });
    }
  }
}

const report = {
  schemaVersion: 1,
  corpus: { id: corpus.id, version: corpus.version, hash: sha256(corpusSnapshot) },
  generatedAt: new Date().toISOString(),
  mode: options.evaluateRun ? "existing-run" : options.execute ? "execute" : "plan",
  profiles,
  plannedCases: corpus.cases.filter((entry) => entry.enabled).map((entry) => entry.id),
  results,
  recommendations: rankEvalProfiles(results),
};
await writeFile(path.join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(reportDir, "report.md"), renderMarkdown(report), "utf8");

if (options.json) console.log(JSON.stringify({ reportDir, ...report }, null, 2));
else {
  console.log(`Evaluation report: ${path.join(reportDir, "report.md")}`);
  console.log(`Corpus snapshot: ${path.join(reportDir, "corpus-snapshot.json")}`);
  if (!options.execute && !options.evaluateRun) {
    console.log("Plan only. Add --execute to run the enabled cases sequentially.");
  }
}

function collectProfile(value: string, previous: StudyBuddyExecutionProfile[]): StudyBuddyExecutionProfile[] {
  return [...previous, parseExecutionProfile(value)];
}

async function executeCase(evalCase: StudyBuddyEvalCase, profile: StudyBuddyExecutionProfile): Promise<string> {
  const args = ["doc", evalCase.prompt, "--execution-profile", profile];
  if (evalCase.moodleUrl) args.push("--url", evalCase.moodleUrl);
  const output = await runProcess(DEFAULT_WRAPPER, args);
  const match = output.match(/^Workflow directory:\s*(.+)$/m);
  if (!match?.[1]) throw new Error(`Study Buddy wrapper did not report its workflow directory.\n${output}`);
  return match[1].trim();
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      output += text;
      process.stderr.write(text);
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`Evaluation worker exited with ${code}.`)));
  });
}

function adHocCorpus(prompt: string, moodleUrl: string | undefined): StudyBuddyEvalCorpus {
  if (!moodleUrl) throw new Error("--prompt requires a direct --url for reproducible source targeting.");
  return {
    schemaVersion: 1,
    id: "ad-hoc",
    version: new Date().toISOString(),
    description: "Explicit local ad-hoc evaluation case.",
    cases: [{
      id: "ad-hoc-1",
      revision: 1,
      enabled: true,
      prompt,
      moodleUrl,
      tags: ["ad-hoc"],
      expected: { requirePdf: true, requireCompleteCoverage: false, requiredTerms: [] },
    }],
  };
}

function renderMarkdown(report: {
  corpus: { id: string; version: string; hash: string };
  mode: string;
  profiles: readonly string[];
  plannedCases: string[];
  results: Array<{ caseId: string; result: EvalRunResult }>;
  recommendations: ReturnType<typeof rankEvalProfiles>;
}): string {
  const lines = [
    "# Study Buddy Evaluation",
    "",
    `- Corpus: ${report.corpus.id} ${report.corpus.version}`,
    `- Snapshot: ${report.corpus.hash}`,
    `- Mode: ${report.mode}`,
    `- Profiles: ${report.profiles.join(", ")}`,
    `- Cases: ${report.plannedCases.join(", ") || "none"}`,
    "",
  ];
  if (report.results.length === 0) return `${lines.join("\n")}\n`;
  lines.push("| Case | Profile | Pass | Score | Wall | Tokens in/out/reasoning |", "|---|---:|---:|---:|---:|---:|");
  for (const entry of report.results) {
    const result = entry.result;
    lines.push(`| ${entry.caseId} | ${result.profile} | ${result.passed ? "yes" : "no"} | ${(result.score * 100).toFixed(0)}% | ${(result.wallMs / 1000).toFixed(1)}s | ${result.tokens.input}/${result.tokens.output}/${result.tokens.reasoning} |`);
  }
  lines.push("");
  const recommended = report.recommendations.filter((entry) => entry.recommended);
  if (recommended.length > 0) {
    lines.push("## Recommended passing profiles", "");
    for (const entry of recommended) {
      lines.push(
        `- ${entry.caseId}: ${entry.profile} (${(entry.qualityScore * 100).toFixed(0)}% checks, ${(entry.wallMs / 1000).toFixed(1)}s, ${entry.totalTokens} tokens)`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
