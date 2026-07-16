import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ExecutionMetricsSnapshot } from "../executionTelemetry.js";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import type { StudyBuddyEvalCase } from "./corpus.js";

export interface EvalCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface EvalRunResult {
  workflowDir: string;
  profile: string;
  passed: boolean;
  score: number;
  wallMs: number;
  modelDurationMs: number;
  tokens: {
    input: number;
    cached: number;
    output: number;
    reasoning: number;
  };
  checks: EvalCheck[];
}

export async function evaluateWorkflow(
  workflowDir: string,
  profile: string,
  evalCase?: StudyBuddyEvalCase,
): Promise<EvalRunResult> {
  const extractionDir = path.join(workflowDir, "extraction");
  const renderDir = path.join(workflowDir, "render");
  const renderMetrics = await readMetrics(renderDir);
  const extractionMetrics = await readMetrics(extractionDir);
  const metrics = [extractionMetrics, renderMetrics].filter(
    (value): value is ExecutionMetricsSnapshot => value !== null,
  );
  const typstPath = path.join(renderDir, "document.typ");
  const pdfPath = path.join(renderDir, "document.pdf");
  const errorPath = path.join(renderDir, "error.log");
  const summaryPath = path.join(renderDir, "run-summary.md");
  const typst = await readFile(typstPath, "utf8").catch(() => "");
  const summary = await readFile(summaryPath, "utf8").catch(() => "");
  const error = await readFile(errorPath, "utf8").catch(() => "");
  const structure = typst ? validateStudyBuddyDocumentStructure(typst) : { ok: false, errors: ["missing Typst"] };
  const checks: EvalCheck[] = [
    check("terminal-summary", /Run status:\s*(success|partial)/i.test(summary), "render summary is terminal"),
    check("empty-error-log", error.trim().length === 0, "render error.log is empty"),
    check("typst", await nonEmpty(typstPath), "document.typ exists and is non-empty"),
    check("pdf", await nonEmpty(pdfPath), "document.pdf exists and is non-empty"),
    check("typst-structure", structure.ok, structure.ok ? "Study Buddy document structure is valid" : structure.errors.join("; ")),
  ];

  if (evalCase?.expected.requireCompleteCoverage) {
    const extractionSummary = await readFile(path.join(extractionDir, "run-summary.md"), "utf8").catch(() => "");
    checks.push(check("coverage", /Run status:\s*success/i.test(extractionSummary), "extraction coverage is complete"));
  }
  for (const term of evalCase?.expected.requiredTerms ?? []) {
    checks.push(check(`term:${term}`, typst.toLowerCase().includes(term.toLowerCase()), `document contains ${term}`));
  }

  const wallMs = metrics.reduce((sum, value) => sum + value.wallMs, 0);
  if (evalCase?.expected.maxWallMs !== undefined) {
    checks.push(check("latency-budget", wallMs <= evalCase.expected.maxWallMs, `${wallMs}ms <= ${evalCase.expected.maxWallMs}ms`));
  }
  const passedCount = checks.filter((value) => value.passed).length;
  return {
    workflowDir,
    profile,
    passed: checks.every((value) => value.passed),
    score: checks.length === 0 ? 0 : passedCount / checks.length,
    wallMs,
    modelDurationMs: metrics.reduce((sum, value) => sum + value.totals.modelDurationMs, 0),
    tokens: {
      input: metrics.reduce((sum, value) => sum + value.totals.inputTokens, 0),
      cached: metrics.reduce((sum, value) => sum + value.totals.cachedInputTokens, 0),
      output: metrics.reduce((sum, value) => sum + value.totals.outputTokens, 0),
      reasoning: metrics.reduce((sum, value) => sum + value.totals.reasoningOutputTokens, 0),
    },
    checks,
  };
}

function check(id: string, passed: boolean, detail: string): EvalCheck {
  return { id, passed, detail };
}

async function nonEmpty(filePath: string): Promise<boolean> {
  return stat(filePath).then((value) => value.isFile() && value.size > 0).catch(() => false);
}

async function readMetrics(runDir: string): Promise<ExecutionMetricsSnapshot | null> {
  const text = await readFile(path.join(runDir, "run-metrics.json"), "utf8").catch(() => "");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as ExecutionMetricsSnapshot;
  } catch {
    return null;
  }
}
