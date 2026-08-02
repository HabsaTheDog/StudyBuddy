#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { z } from "zod";
import { loadInteractiveEvalCorpus } from "./corpus.js";
import { evaluateInteractiveRun, type InteractiveEvalResult } from "./evaluate.js";
import { loadVNextBenchmarkManifest } from "./vnextBenchmark.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORPUS = path.join(MODULE_DIR, "corpus", "portability.json");
const DEFAULT_VNEXT_MANIFEST = path.resolve(
  MODULE_DIR,
  "../../../../docs/study-builder-vnext/benchmark-manifest.json",
);
const ReplayManifestSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(z.object({
    caseId: z.string().min(1),
    runDir: z.string().min(1),
    trial: z.number().int().positive().optional(),
  })),
});

interface ReportEntry {
  caseId: string;
  trial: number;
  result: InteractiveEvalResult;
}

interface ConsistencyEntry {
  caseId: string;
  trials: number;
  passRate: number;
  topicRange: number;
  exerciseRange: number;
  applicationRange: number;
  vNext?: {
    courseModuleRange: number;
    learningObjectiveRange: number;
    questionBankItemRange: number;
    learningStageRange: number;
    assessmentSectionRange: number;
  };
}

interface InteractiveBenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  corpus: { id: string; version: string };
  mode: "existing-run" | "replay-manifest" | "plan";
  plannedCases: Array<{
    id: string;
    enabled: boolean;
    prompt: string;
    moodleUrl?: string;
    tags: string[];
  }>;
  results: ReportEntry[];
  consistency: ConsistencyEntry[];
}

const program = new Command()
  .name("interactive-benchmark")
  .description("Plan or replay Study Buddy interactive website reliability, quality, and efficiency benchmarks.")
  .option("--corpus <path>", "Versioned interactive benchmark corpus", DEFAULT_CORPUS)
  .option("--vnext-manifest <path>", "Adaptive Study Builder vNext hard-gate manifest", DEFAULT_VNEXT_MANIFEST)
  .option("--case <id>", "Case to include; repeatable", collect, [])
  .option("--evaluate-run <path>", "Evaluate one existing workflow or web-layout run without Moodle/model calls")
  .option("--runs-manifest <path>", "Evaluate multiple existing workflows from a replay manifest")
  .option("--out-dir <path>", "Report directory")
  .option("--json", "Print the full report")
  .parse(process.argv);

const options = program.opts<{
  corpus: string;
  vnextManifest: string;
  case: string[];
  evaluateRun?: string;
  runsManifest?: string;
  outDir?: string;
  json?: boolean;
}>();
if (options.evaluateRun && options.runsManifest) throw new Error("Use either --evaluate-run or --runs-manifest.");
const corpus = await loadInteractiveEvalCorpus(path.resolve(options.corpus));
const vNextManifest = await loadVNextBenchmarkManifest(path.resolve(options.vnextManifest));
const selected = options.case.length === 0
  ? corpus.cases
  : corpus.cases.filter((entry) => options.case.includes(entry.id));
const missing = options.case.filter((id) => !corpus.cases.some((entry) => entry.id === id));
if (missing.length > 0) throw new Error(`Unknown benchmark case(s): ${missing.join(", ")}`);

const results: ReportEntry[] = [];
if (options.evaluateRun) {
  const evalCase = selected.length === 1 ? selected[0] : undefined;
  results.push({
    caseId: evalCase?.id ?? "existing-run",
    trial: 1,
    result: await evaluateInteractiveRun(options.evaluateRun, evalCase, vNextManifest),
  });
} else if (options.runsManifest) {
  const manifestPath = path.resolve(options.runsManifest);
  const manifest = ReplayManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  for (const [index, entry] of manifest.runs.entries()) {
    const evalCase = corpus.cases.find((candidate) => candidate.id === entry.caseId);
    if (!evalCase) throw new Error(`Replay manifest references unknown case: ${entry.caseId}`);
    results.push({
      caseId: entry.caseId,
      trial: entry.trial ?? index + 1,
      result: await evaluateInteractiveRun(
        path.resolve(path.dirname(manifestPath), entry.runDir),
        evalCase,
        vNextManifest,
      ),
    });
  }
}

const consistency: ConsistencyEntry[] = [...new Set(results.map((entry) => entry.caseId))].map((caseId) => {
  const sameCase = results.filter((entry) => entry.caseId === caseId);
  const values = (key: keyof InteractiveEvalResult["structure"]) =>
    sameCase.map((entry) => entry.result.structure[key]).filter((value): value is number => typeof value === "number");
  const range = (numbers: number[]) => numbers.length ? Math.max(...numbers) - Math.min(...numbers) : 0;
  const vNextResults = sameCase.flatMap((entry) => entry.result.vNext ? [entry.result.vNext] : []);
  const vNextRange = (key: keyof NonNullable<InteractiveEvalResult["vNext"]>["structure"]) =>
    range(vNextResults.map((entry) => entry.structure[key]));
  return {
    caseId,
    trials: sameCase.length,
    passRate: sameCase.filter((entry) => entry.result.passed).length / Math.max(1, sameCase.length),
    topicRange: range(values("topics")),
    exerciseRange: range(values("exercises")),
    applicationRange: range(values("applicationExercises")),
    ...(vNextResults.length > 0
      ? {
          vNext: {
            courseModuleRange: vNextRange("courseModules"),
            learningObjectiveRange: vNextRange("learningObjectives"),
            questionBankItemRange: vNextRange("questionBankItems"),
            learningStageRange: vNextRange("learningStages"),
            assessmentSectionRange: vNextRange("assessmentSections"),
          },
        }
      : {}),
  };
});
const report: InteractiveBenchmarkReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpus: { id: corpus.id, version: corpus.version },
  mode: options.evaluateRun ? "existing-run" : options.runsManifest ? "replay-manifest" : "plan",
  plannedCases: selected.map((entry) => ({
    id: entry.id,
    enabled: entry.enabled,
    prompt: entry.prompt,
    moodleUrl: entry.moodleUrl,
    tags: entry.tags,
  })),
  results,
  consistency,
};
const outDir = path.resolve(options.outDir ?? path.join(process.cwd(), "output", "evals", corpus.id, timestamp()));
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "corpus-snapshot.json"), `${JSON.stringify({ ...corpus, cases: selected }, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "vnext-manifest-snapshot.json"), `${JSON.stringify(vNextManifest, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(path.join(outDir, "report.md"), renderMarkdown(report), "utf8");

if (options.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Interactive benchmark mode: ${report.mode}`);
  console.log(`Cases: ${selected.map((entry) => entry.id).join(", ")}`);
  console.log(`Results: ${results.length}; report: ${path.join(outDir, "report.md")}`);
}
if (results.some((entry) => !entry.result.passed)) process.exitCode = 1;

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function renderMarkdown(report: InteractiveBenchmarkReport): string {
  const lines = [
    "# Interactive Study Buddy benchmark",
    "",
    `Mode: ${report.mode}`,
    `Corpus: ${report.corpus.id} ${report.corpus.version}`,
    "",
  ];
  if (report.results.length === 0) {
    lines.push("## Planned cases", "", ...report.plannedCases.map((entry) => `- ${entry.id}: ${entry.prompt}`), "");
  } else {
    lines.push(
      "## Results",
      "",
      "| Case | Trial | Reliability | Quality | Efficiency | Fresh input | Cache | Wall time |",
      "|---|---:|---:|---:|---:|---:|---:|---:|",
      ...report.results.map(({ caseId, trial, result }) =>
        `| ${caseId} | ${trial} | ${mark(result.reliabilityPassed)} | ${mark(result.qualityPassed)} | ${mark(result.efficiencyPassed)} | ${result.efficiency.freshInputTokens} | ${(result.efficiency.cacheHitRate * 100).toFixed(1)}% | ${(result.efficiency.wallMs / 1_000).toFixed(1)} s |`
      ),
      "",
      "## Consistency",
      "",
      "| Case | Trials | Pass rate | Topic range | Exercise range | Application range |",
      "|---|---:|---:|---:|---:|---:|",
      ...report.consistency.map((entry) =>
        `| ${entry.caseId} | ${entry.trials} | ${(entry.passRate * 100).toFixed(0)}% | ${entry.topicRange} | ${entry.exerciseRange} | ${entry.applicationRange} |`
      ),
      "",
    );
    const vNextResults = report.results.filter((entry) => entry.result.vNext);
    if (vNextResults.length > 0) {
      lines.push(
        "## vNext artifacts",
        "",
        "| Case | Trial | Hard gates | Modules | Objectives | Questions | Stages | Assessment sections | ID | Objective | Response | Origin | Scope | Review |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ...vNextResults.map(({ caseId, trial, result }) => {
          const vNext = result.vNext!;
          const q = vNext.quality;
          return `| ${caseId} | ${trial} | ${mark(vNext.hardGatesPassed)} | ${vNext.structure.courseModules} | ${vNext.structure.learningObjectives} | ${vNext.structure.questionBankItems} | ${vNext.structure.learningStages} | ${vNext.structure.assessmentSections} | ${percent(q.questionsWithStableIdRatio)} | ${percent(q.questionsWithObjectiveRatio)} | ${percent(q.questionsWithResponseContractRatio)} | ${percent(q.questionsWithOriginRatio)} | ${percent(q.questionsWithScopeBasisRatio)} | ${percent(q.questionsWithPassingReviewRatio)} |`;
        }),
        "",
      );
      for (const { caseId, trial, result } of vNextResults) {
        const failed = result.vNext!.hardChecks.filter((check) => !check.passed);
        lines.push(
          `### ${caseId} trial ${trial} hard checks`,
          "",
          ...(failed.length === 0
            ? ["All configured vNext hard checks passed."]
            : failed.map((check) =>
                `- ${check.id}: actual ${String(check.actual)}, expected ${String(check.expected)} (${check.evidence})`
              )),
          "",
        );
      }
      const vNextConsistency = report.consistency.filter((entry) => entry.vNext);
      lines.push(
        "## vNext consistency",
        "",
        "| Case | Module range | Objective range | Question range | Stage range | Assessment-section range |",
        "|---|---:|---:|---:|---:|---:|",
        ...vNextConsistency.map((entry) =>
          `| ${entry.caseId} | ${entry.vNext!.courseModuleRange} | ${entry.vNext!.learningObjectiveRange} | ${entry.vNext!.questionBankItemRange} | ${entry.vNext!.learningStageRange} | ${entry.vNext!.assessmentSectionRange} |`
        ),
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function mark(value: boolean): string {
  return value ? "pass" : "fail";
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
