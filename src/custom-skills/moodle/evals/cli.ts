#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { z } from "zod";
import { loadEvalCorpus, type StudyBuddyEvalCase, type StudyBuddyEvalCorpus } from "./corpus.js";
import { evaluateWorkflow, type EvalRunResult } from "./evaluate.js";
import { rankEvalProfiles, type RankedEvalProfile } from "./ranking.js";
import { parseExecutionProfile, type StudyBuddyExecutionProfile } from "../modelPolicy.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = path.join(MODULE_DIR, "corpus", "baseline.json");
const DEFAULT_WRAPPER = process.env.STUDY_BUDDY_WRAPPER ?? path.resolve(
  MODULE_DIR,
  "../../../../scripts/study_buddy_task.sh",
);

const ReplayManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(z.object({
    caseId: z.string().min(1),
    profile: z.string().min(1).default("existing"),
    workflowDir: z.string().min(1),
    trial: z.number().int().positive().optional(),
  })),
});

interface EvalResultEntry {
  caseId: string;
  trial: number;
  result: EvalRunResult;
}

const program = new Command()
  .name("moodle-benchmark")
  .description("Plan, execute, replay, or compare Study Buddy reliability and efficiency benchmarks.")
  .option("--corpus <path>", "Versioned benchmark corpus JSON", DEFAULT_CORPUS)
  .option("--case <id>", "Case to include; repeatable", collectString, [])
  .option("--profile <profile>", "Execution profile; repeatable", collectProfile, [])
  .option("--repeat <n>", "Sequential trials per live case/profile", positiveInteger, 1)
  .option("--execute", "Execute selected corpus cases through the official staged document wrapper")
  .option("--prompt <text>", "Ad-hoc benchmark prompt; requires --execute and --url")
  .option("--original-user-prompt <text>", "Exact latest user message for live Study Buddy provenance")
  .option("--url <url>", "Direct Moodle URL for the ad-hoc case")
  .option("--language <language>", "Output language for an ad-hoc case (de or en)", "de")
  .option("--evaluate-run <path>", "Score one existing staged workflow without model or Moodle calls")
  .option("--runs-manifest <path>", "Score multiple existing workflows from a replay manifest")
  .option("--baseline-report <path>", "Compare aggregate results with an earlier report.json")
  .option("--out-dir <path>", "Benchmark report directory")
  .option("--json", "Print the JSON report")
  .parse(process.argv);

const options = program.opts<{
  corpus: string;
  case: string[];
  profile: StudyBuddyExecutionProfile[];
  repeat: number;
  execute?: boolean;
  prompt?: string;
  originalUserPrompt?: string;
  url?: string;
  language: string;
  evaluateRun?: string;
  runsManifest?: string;
  baselineReport?: string;
  outDir?: string;
  json?: boolean;
}>();

if (options.evaluateRun && options.runsManifest) {
  throw new Error("Use either --evaluate-run or --runs-manifest, not both.");
}
if (options.execute && (options.evaluateRun || options.runsManifest)) {
  throw new Error("--execute cannot be combined with replay options.");
}

const profiles = options.profile.length > 0 ? [...new Set(options.profile)] : ["balanced"] as const;
const loadedCorpus = options.prompt
  ? adHocCorpus(options.prompt, options.url, parseLanguage(options.language))
  : await loadEvalCorpus(path.resolve(options.corpus));
const corpus = selectCases(loadedCorpus, options.case);
const reportDir = path.resolve(
  options.outDir ?? path.join(process.cwd(), "output", "evals", corpus.id, timestampSlug()),
);
await mkdir(reportDir, { recursive: true });
const corpusSnapshot = `${JSON.stringify(corpus, null, 2)}\n`;
await writeFile(path.join(reportDir, "corpus-snapshot.json"), corpusSnapshot, "utf8");

const results: EvalResultEntry[] = [];
let abortedReason: string | undefined;
if (options.evaluateRun) {
  const selectedCase = options.case.length === 1
    ? corpus.cases.find((entry) => entry.id === options.case[0])
    : undefined;
  results.push({
    caseId: selectedCase?.id ?? "existing-run",
    trial: 1,
    result: await evaluateWorkflow(path.resolve(options.evaluateRun), profiles[0], selectedCase),
  });
} else if (options.runsManifest) {
  const manifestPath = path.resolve(options.runsManifest);
  const manifest = ReplayManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  for (const [index, run] of manifest.runs.entries()) {
    const evalCase = corpus.cases.find((entry) => entry.id === run.caseId);
    if (!evalCase) throw new Error(`Replay manifest references unknown case: ${run.caseId}`);
    const workflowDir = path.resolve(path.dirname(manifestPath), run.workflowDir);
    results.push({
      caseId: run.caseId,
      trial: run.trial ?? index + 1,
      result: await evaluateWorkflow(workflowDir, run.profile, evalCase),
    });
  }
} else if (options.execute) {
  const enabledCases = corpus.cases.filter((entry) => entry.enabled);
  if (enabledCases.length === 0) {
    throw new Error("The selected corpus has no enabled cases.");
  }
  liveRuns:
  for (const evalCase of enabledCases) {
    if (!evalCase.moodleUrl) {
      throw new Error(`Case ${evalCase.id} needs a direct moodleUrl before it can run live.`);
    }
    for (let trial = 1; trial <= options.repeat; trial += 1) {
      const rotatedProfiles = rotate(profiles, (trial - 1) % profiles.length);
      for (const profile of rotatedProfiles) {
        const execution = await executeCase(
          evalCase,
          profile,
          options.originalUserPrompt ?? evalCase.prompt,
        );
        results.push({
          caseId: evalCase.id,
          trial,
          result: await evaluateWorkflow(execution.workflowDir, profile, evalCase),
        });
        if (execution.exitCode !== 0) {
          abortedReason = `Live worker exited with ${execution.exitCode}; remaining trials were not started.`;
          break liveRuns;
        }
      }
    }
  }
}

const recommendations = rankEvalProfiles(results);
const comparison = options.baselineReport
  ? compareWithBaseline(
      recommendations,
      JSON.parse(await readFile(path.resolve(options.baselineReport), "utf8")) as unknown,
    )
  : [];
const report = {
  schemaVersion: 2,
  corpus: { id: corpus.id, version: corpus.version, hash: sha256(corpusSnapshot) },
  generatedAt: new Date().toISOString(),
  mode: options.evaluateRun
    ? "existing-run"
    : options.runsManifest
      ? "replay-manifest"
      : options.execute
        ? "execute"
        : "plan",
  profiles,
  repeat: options.repeat,
  abortedReason,
  selectedCases: corpus.cases.map((entry) => entry.id),
  plannedCases: corpus.cases.filter((entry) => entry.enabled).map((entry) => entry.id),
  results,
  recommendations,
  comparison,
};
await writeFile(path.join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(reportDir, "report.md"), renderMarkdown(report), "utf8");

if (options.json) console.log(JSON.stringify({ reportDir, ...report }, null, 2));
else {
  console.log(`Benchmark report: ${path.join(reportDir, "report.md")}`);
  console.log(`Corpus snapshot: ${path.join(reportDir, "corpus-snapshot.json")}`);
  if (!options.execute && !options.evaluateRun && !options.runsManifest) {
    console.log("Plan only: no Moodle or model calls were made. Add --execute for a controlled live run.");
  }
}

function collectProfile(value: string, previous: StudyBuddyExecutionProfile[]): StudyBuddyExecutionProfile[] {
  return [...previous, parseExecutionProfile(value)];
}

function collectString(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

async function executeCase(
  evalCase: StudyBuddyEvalCase,
  profile: StudyBuddyExecutionProfile,
  originalUserPrompt: string,
): Promise<{ workflowDir: string; exitCode: number }> {
  const args = [
    "doc",
    evalCase.prompt,
    "--original-user-prompt",
    originalUserPrompt,
    "--language",
    evalCase.language,
    "--execution-profile",
    profile,
  ];
  if (evalCase.moodleUrl) args.push("--url", evalCase.moodleUrl);
  const execution = await runProcess(DEFAULT_WRAPPER, args);
  const output = execution.output;
  const match = output.match(/^Workflow directory:\s*(.+)$/m);
  if (!match?.[1]) throw new Error(`Study Buddy wrapper did not report its workflow directory.\n${output}`);
  return { workflowDir: match[1].trim(), exitCode: execution.exitCode };
}

function runProcess(command: string, args: string[]): Promise<{ output: string; exitCode: number }> {
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
    child.once("exit", (code) => resolve({ output, exitCode: code ?? 1 }));
  });
}

function adHocCorpus(
  prompt: string,
  moodleUrl: string | undefined,
  language: "de" | "en",
): StudyBuddyEvalCorpus {
  if (!moodleUrl) throw new Error("--prompt requires a direct --url for reproducible source targeting.");
  return {
    schemaVersion: 1,
    id: "ad-hoc",
    version: new Date().toISOString(),
    description: "Explicit local ad-hoc benchmark case.",
    cases: [{
      id: "ad-hoc-1",
      revision: 1,
      enabled: true,
      prompt,
      language,
      moodleUrl,
      tags: ["ad-hoc"],
      expected: {
        requirePdf: true,
        requireCompleteCoverage: false,
        requireQualityReview: true,
        requiredOfficialTopicNumbers: [],
        requiredPracticeTopicNumbers: [],
        requiredContentModes: [],
        requiredTerms: [],
        forbiddenTerms: [],
      },
    }],
  };
}

function parseLanguage(value: string): "de" | "en" {
  if (value === "de" || value === "en") return value;
  throw new Error(`Unsupported benchmark language: ${value}`);
}

function selectCases(corpus: StudyBuddyEvalCorpus, selectedIds: string[]): StudyBuddyEvalCorpus {
  if (selectedIds.length === 0) return corpus;
  const selected = new Set(selectedIds);
  const cases = corpus.cases.filter((entry) => selected.has(entry.id));
  const missing = [...selected].filter((id) => !cases.some((entry) => entry.id === id));
  if (missing.length > 0) throw new Error(`Unknown benchmark case(s): ${missing.join(", ")}`);
  return { ...corpus, cases };
}

function rotate<T>(values: readonly T[], offset: number): T[] {
  return [...values.slice(offset), ...values.slice(0, offset)];
}

interface BaselineComparison {
  caseId: string;
  profile: string;
  reliabilityPassRateDelta: number;
  wallMsDeltaPercent: number;
  freshInputTokensDeltaPercent: number;
  regression: boolean;
  reasons: string[];
}

function compareWithBaseline(current: RankedEvalProfile[], rawBaseline: unknown): BaselineComparison[] {
  const baseline = recordValue(rawBaseline);
  const entries = Array.isArray(baseline?.recommendations)
    ? baseline.recommendations.filter((entry): entry is RankedEvalProfile => recordValue(entry) !== null)
    : [];
  return current.flatMap((entry) => {
    const prior = entries.find((candidate) =>
      candidate.caseId === entry.caseId && candidate.profile === entry.profile);
    if (!prior) return [];
    const reliabilityPassRateDelta = entry.reliabilityPassRate - numberValue(prior.reliabilityPassRate, Number(prior.passed));
    const wallMsDeltaPercent = percentDelta(entry.wallMs, numberValue(prior.wallMs));
    const freshInputTokensDeltaPercent = percentDelta(
      entry.freshInputTokens,
      numberValue(prior.freshInputTokens, numberValue(prior.totalTokens)),
    );
    const reasons = [
      ...(reliabilityPassRateDelta < 0 ? ["reliability pass rate decreased"] : []),
      ...(wallMsDeltaPercent > 15 ? ["median wall time increased by more than 15%"] : []),
      ...(freshInputTokensDeltaPercent > 15 ? ["median fresh input tokens increased by more than 15%"] : []),
    ];
    return [{
      caseId: entry.caseId,
      profile: entry.profile,
      reliabilityPassRateDelta,
      wallMsDeltaPercent,
      freshInputTokensDeltaPercent,
      regression: reasons.length > 0,
      reasons,
    }];
  });
}

function renderMarkdown(report: {
  corpus: { id: string; version: string; hash: string };
  mode: string;
  profiles: readonly string[];
  repeat: number;
  abortedReason?: string;
  selectedCases: string[];
  plannedCases: string[];
  results: EvalResultEntry[];
  recommendations: RankedEvalProfile[];
  comparison: BaselineComparison[];
}): string {
  const lines = [
    "# Study Buddy Benchmark",
    "",
    `- Corpus: ${report.corpus.id} ${report.corpus.version}`,
    `- Snapshot: ${report.corpus.hash}`,
    `- Mode: ${report.mode}`,
    `- Profiles: ${report.profiles.join(", ")}`,
    `- Planned trials per case/profile: ${report.repeat}`,
    `- Selected cases: ${report.selectedCases.join(", ") || "none"}`,
    `- Enabled live cases: ${report.plannedCases.join(", ") || "none"}`,
    ...(report.abortedReason ? [`- Aborted: ${report.abortedReason}`] : []),
    "",
  ];
  if (report.results.length === 0) return `${lines.join("\n")}\n`;
  lines.push(
    "| Case | Trial | Profile | Reliable | Efficient | Wall/model | Fresh/cached input | Cache hit | Calls/retries | Max amp. |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const entry of report.results) {
    const result = entry.result;
    lines.push(
      `| ${entry.caseId} | ${entry.trial} | ${result.profile} | ${result.reliabilityPassed ? "yes" : "no"} | ${result.efficiencyPassed ? "yes" : "no"} | ${formatDuration(result.wallMs)}/${formatDuration(result.modelDurationMs)} | ${result.tokens.fresh}/${result.tokens.cached} | ${(result.tokens.cacheHitRate * 100).toFixed(1)}% | ${result.operations.modelCalls}/${result.operations.retries} | ${formatAmplification(result.operations.maxInputAmplification, result.operations.amplificationObservedCalls)} |`,
    );
  }
  lines.push("", "## Aggregate", "");
  lines.push(
    "| Case | Profile | Trials | Pass rate | Consistency | Quality | Median wall | Median fresh input | Cache hit | Recommended |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const entry of report.recommendations) {
    lines.push(
      `| ${entry.caseId} | ${entry.profile} | ${entry.trials} | ${(entry.passRate * 100).toFixed(0)}% | ${(entry.consistencyRate * 100).toFixed(0)}% | ${(entry.qualityScore * 100).toFixed(0)}% | ${formatDuration(entry.wallMs)} | ${entry.freshInputTokens} | ${(entry.cacheHitRate * 100).toFixed(1)}% | ${entry.recommended ? "yes" : "no"} |`,
    );
  }
  for (const result of report.results) {
    const failed = result.result.checks.filter((entry) => !entry.passed);
    if (failed.length === 0) continue;
    lines.push("", `### Failed gates: ${result.caseId}, ${result.result.profile}, trial ${result.trial}`, "");
    for (const check of failed) lines.push(`- [${check.category}] ${check.id}: ${check.detail}`);
  }
  for (const entry of report.results) {
    if (entry.result.tasks.length === 0) continue;
    lines.push("", `### Model tasks: ${entry.caseId}, ${entry.result.profile}, trial ${entry.trial}`, "");
    lines.push(
      "| Task | Calls/retries | Model time | Fresh/cached input | Output | Max request | Max amp. |",
      "|---|---:|---:|---:|---:|---:|---:|",
    );
    for (const task of entry.result.tasks) {
      lines.push(
        `| ${task.task} | ${task.calls}/${task.retries} | ${formatDuration(task.durationMs)} | ${task.freshInputTokens}/${task.cachedInputTokens} | ${task.outputTokens} | ${task.maxRequestCharacters} chars | ${formatAmplification(task.maxInputAmplification, task.amplificationObservedCalls)} |`,
      );
    }
  }
  if (report.comparison.length > 0) {
    lines.push("", "## Baseline comparison", "");
    for (const entry of report.comparison) {
      lines.push(
        `- ${entry.caseId}/${entry.profile}: ${entry.regression ? `REGRESSION — ${entry.reasons.join("; ")}` : "no regression"}; wall ${formatPercent(entry.wallMsDeltaPercent)}, fresh input ${formatPercent(entry.freshInputTokensDeltaPercent)}, reliability ${formatPercent(entry.reliabilityPassRateDelta * 100)}.`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function percentDelta(current: number, baseline: number): number {
  return baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatDuration(value: number): string {
  return `${(value / 1000).toFixed(1)}s`;
}

function formatAmplification(value: number, observedCalls: number): string {
  return observedCalls > 0 ? `${value.toFixed(2)}x (${observedCalls} calls)` : "n/a";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
