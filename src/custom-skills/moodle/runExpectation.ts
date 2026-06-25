// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalConsole:off
// @effect-diagnostics globalDate:off
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceCoverage } from "./runDiagnostics.js";
import type { MoodleRuntimeConfig } from "./types.js";

export const STUDY_BUDDY_EXPECTATION_MARKER = "STUDY_BUDDY_RUN_EXPECTATION ";

export type StudyBuddyRunStatus =
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "timeout"
  | "canceled";

export type StudyBuddyRunPhase =
  | "planning"
  | "reading_sources"
  | "analyzing"
  | "writing"
  | "rendering"
  | "finalizing";

export type StudyBuddyTaskKind =
  | "quick_answer"
  | "schedule_answer"
  | "material_summary"
  | "study_pdf"
  | "quiz_review"
  | "diagnostic"
  | "unknown";

export interface StudyBuddyTaskShape {
  kind: StudyBuddyTaskKind;
  usesMoodle: boolean;
  usesCis: boolean;
  downloadsFiles: boolean;
  rendersPdf: boolean;
  hasDirectUrl: boolean;
  maxPagesBucket: "0-2" | "3-8" | "9+";
}

export interface StudyBuddyRunExpectation {
  schemaVersion: 2;
  kind: "run_expectation";
  runId: string;
  runDir: string;
  requestName: string;
  status: StudyBuddyRunStatus;
  phase: StudyBuddyRunPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  elapsedMs: number;
  expectation: {
    available: boolean;
    minMs?: number;
    maxMs?: number;
    confidence: "low" | "medium";
    basis: "defaults" | "history" | "mixed" | "unavailable";
    label: string;
    checkBackLabel?: string;
    staleLabel?: string;
  };
  taskShape: StudyBuddyTaskShape;
  artifacts?: {
    pdfPath?: string;
    runSummaryPath?: string;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}

export interface RunExpectationUpdate {
  status?: StudyBuddyRunStatus;
  phase?: StudyBuddyRunPhase;
  sourceCoverage?: SourceCoverage;
  artifacts?: {
    pdfPath?: string;
    runSummaryPath?: string;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}

interface HistoryRecord {
  schemaVersion: 1;
  completedAt: string;
  durationMs: number;
  status: "success" | "partial" | "failed" | "timeout";
  taskShape: StudyBuddyTaskShape;
}

const MIN_MS = 60_000;
const MAX_MS = 45 * 60_000;

const DEFAULT_RANGES: Record<StudyBuddyTaskKind, readonly [number, number]> = {
  quick_answer: [1, 4],
  schedule_answer: [2, 6],
  material_summary: [3, 8],
  study_pdf: [6, 15],
  quiz_review: [5, 15],
  diagnostic: [1, 3],
  unknown: [10, 30],
};

export async function writeRunExpectation(
  config: MoodleRuntimeConfig,
  update: RunExpectationUpdate = {},
): Promise<StudyBuddyRunExpectation> {
  const previous = await readExpectation(config.runDir);
  const now = new Date();
  const status = update.status ?? previous?.status ?? "running";
  const phase = update.phase ?? previous?.phase ?? "planning";
  const startedAt = previous?.startedAt ?? now.toISOString();
  const completedAt = terminalStatus(status)
    ? (previous?.completedAt ?? now.toISOString())
    : undefined;
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(startedAt));
  const taskShape = classifyTaskShape(config, update.sourceCoverage);
  const expectation = await buildExpectation(config, taskShape, elapsedMs, status, now);
  const artifacts = {
    ...(previous?.artifacts ?? {}),
    ...(update.artifacts ?? {}),
    runSummaryPath:
      update.artifacts?.runSummaryPath ??
      previous?.artifacts?.runSummaryPath ??
      config.diagnostics?.runSummaryPath ??
      path.join(config.runDir, "run-summary.md"),
  };

  const payload: StudyBuddyRunExpectation = {
    schemaVersion: 2,
    kind: "run_expectation",
    runId: path.basename(config.runDir),
    runDir: config.runDir,
    requestName: config.requestName,
    status,
    phase,
    startedAt,
    updatedAt: now.toISOString(),
    ...(completedAt ? { completedAt } : {}),
    elapsedMs,
    expectation,
    taskShape,
    artifacts,
    ...(update.error ? { error: update.error } : previous?.error ? { error: previous.error } : {}),
  };

  await mkdir(config.runDir, { recursive: true });
  await atomicWriteJson(path.join(config.runDir, "run-expectation.json"), payload);
  if (terminalStatus(status) && previous?.completedAt === undefined) {
    await appendHistory(payload);
  }
  emitExpectationLine(payload);
  return payload;
}

export function classifyTaskShape(
  config: MoodleRuntimeConfig,
  sourceCoverage?: SourceCoverage,
): StudyBuddyTaskShape {
  const prompt = config.prompt.toLowerCase();
  const usesCis = config.includeCis ||
    config.sourceMode === "cis" ||
    config.sourceMode === "both" ||
    config.cisUrls.length > 0 ||
    config.sourcePlan?.targets.includes("cis") === true ||
    sourceCoverage?.cis.status === "success" ||
    /\b(cis|schedule|timetable|exam|room|today|tomorrow|deadline|termin|prüfung|raum|morgen|heute)\b/i.test(
      config.prompt,
    );
  const downloadsFiles = config.allowFileDownloads || config.sourcePlan?.needsFiles === true;
  const rendersPdf = !config.diagnosticOnly && config.stage !== "extract";
  const maxPagesBucket = maxPagesBucketFor(config.maxPages);
  const hasDirectUrl = /https?:\/\/\S+/i.test(config.prompt) || /https?:\/\/\S+/i.test(config.moodleUrl);
  const kind = classifyKind(prompt, {
    autoAnswer: config.autoAnswer,
    diagnosticOnly: config.diagnosticOnly,
    rendersPdf,
    downloadsFiles,
    usesCis,
    maxPagesBucket,
  });

  return {
    kind,
    usesMoodle: config.sourceMode !== "cis",
    usesCis,
    downloadsFiles,
    rendersPdf,
    hasDirectUrl,
    maxPagesBucket,
  };
}

async function buildExpectation(
  config: MoodleRuntimeConfig,
  taskShape: StudyBuddyTaskShape,
  elapsedMs: number,
  status: StudyBuddyRunStatus,
  now: Date,
): Promise<StudyBuddyRunExpectation["expectation"]> {
  const defaults = defaultEstimate(taskShape);
  const history = await historyEstimate(taskShape, defaults);
  const estimate = history ?? defaults;
  const isUncertain = taskShape.kind === "unknown" || estimate.confidence === "low";
  const stale = !terminalStatus(status) && elapsedMs > estimate.maxMs;
  const rounded = {
    minMs: roundToMinute(estimate.minMs),
    maxMs: roundToMinute(estimate.maxMs),
  };

  if (stale) {
    return {
      available: true,
      ...rounded,
      confidence: "low",
      basis: estimate.basis,
      label: "Taking longer than usual",
      staleLabel: "Taking longer than usual",
    };
  }

  return {
    available: true,
    ...rounded,
    confidence: estimate.confidence,
    basis: estimate.basis,
    label: isUncertain
      ? `Timing can vary; broad Moodle/CIS runs often take ${minutesRangeLabel(rounded.minMs, rounded.maxMs)}`
      : `Usually ${minutesRangeLabel(rounded.minMs, rounded.maxMs)}`,
    ...(isUncertain ? {} : { checkBackLabel: checkBackLabel(now, rounded.minMs, rounded.maxMs) }),
  };
}

function defaultEstimate(taskShape: StudyBuddyTaskShape): {
  minMs: number;
  maxMs: number;
  confidence: "low" | "medium";
  basis: "defaults";
} {
  const [baseMin, baseMax] = DEFAULT_RANGES[taskShape.kind];
  let minMinutes = baseMin;
  let maxMinutes = baseMax;

  if (taskShape.usesCis && taskShape.kind !== "study_pdf") {
    minMinutes += 1;
    maxMinutes += 4;
  }
  if (taskShape.downloadsFiles && taskShape.kind !== "study_pdf" && taskShape.kind !== "quiz_review") {
    minMinutes += 3;
    maxMinutes += 8;
  }
  if (taskShape.rendersPdf && taskShape.kind === "material_summary") {
    minMinutes += 3;
    maxMinutes += 7;
  }
  if (!taskShape.hasDirectUrl && (taskShape.kind === "unknown" || taskShape.maxPagesBucket === "9+")) {
    minMinutes += 3;
    maxMinutes += 10;
  }
  if (taskShape.maxPagesBucket === "9+" && taskShape.kind !== "unknown") {
    minMinutes += 3;
    maxMinutes += 8;
  }

  return {
    minMs: clampMs(minMinutes * 60_000),
    maxMs: clampMs(maxMinutes * 60_000),
    confidence: taskShape.kind === "unknown" ? "low" : "medium",
    basis: "defaults",
  };
}

async function historyEstimate(
  taskShape: StudyBuddyTaskShape,
  defaults: { minMs: number; maxMs: number },
): Promise<{
  minMs: number;
  maxMs: number;
  confidence: "low" | "medium";
  basis: "history";
} | null> {
  const records = await readHistory();
  const durations = records
    .filter((record) =>
      (record.status === "success" || record.status === "partial") &&
      compatibleTaskKey(record.taskShape) === compatibleTaskKey(taskShape),
    )
    .map((record) => record.durationMs)
    .filter((duration) => Number.isFinite(duration) && duration > 0)
    .sort((left: number, right: number) => left - right);

  if (durations.length < 5) {
    return null;
  }

  const minMs = clampMs(percentile(durations, 0.25) * 0.8);
  const maxMs = clampMs(percentile(durations, 0.8) * 1.25);
  const differsTooMuch = minMs > defaults.minMs * 2 ||
    defaults.minMs > minMs * 2 ||
    maxMs > defaults.maxMs * 2 ||
    defaults.maxMs > maxMs * 2;

  return {
    minMs,
    maxMs: Math.max(minMs, maxMs),
    confidence: differsTooMuch ? "low" : "medium",
    basis: "history",
  };
}

async function appendHistory(expectation: StudyBuddyRunExpectation): Promise<void> {
  if (
    expectation.status !== "success" &&
    expectation.status !== "partial" &&
    expectation.status !== "failed" &&
    expectation.status !== "timeout"
  ) {
    return;
  }
  const historyPath = resolveHistoryPath();
  if (!historyPath) {
    return;
  }
  const record: HistoryRecord = {
    schemaVersion: 1,
    completedAt: expectation.completedAt ?? expectation.updatedAt,
    durationMs: expectation.elapsedMs,
    status: expectation.status,
    taskShape: expectation.taskShape,
  };
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

async function readHistory(): Promise<HistoryRecord[]> {
  const historyPath = resolveHistoryPath();
  if (!historyPath) {
    return [];
  }
  try {
    const text = await readFile(historyPath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return isHistoryRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function classifyKind(
  prompt: string,
  flags: {
    autoAnswer: boolean;
    diagnosticOnly: boolean;
    rendersPdf: boolean;
    downloadsFiles: boolean;
    usesCis: boolean;
    maxPagesBucket: StudyBuddyTaskShape["maxPagesBucket"];
  },
): StudyBuddyTaskKind {
  if (flags.diagnosticOnly) {
    return "diagnostic";
  }
  if (flags.autoAnswer || /\b(quiz|test|mcq|multiple choice|antworten ausfüllen)\b/i.test(prompt)) {
    return "quiz_review";
  }
  if (/\b(pdf|lernzettel|formelsammlung|study guide|document|typst|worksheet|skript)\b/i.test(prompt)) {
    return "study_pdf";
  }
  if (/\b(summary|summarize|prepare|exam prep|exam preparation|material|notes|zusammenfassung|vorbereitung|stoff)\b/i.test(prompt)) {
    return flags.downloadsFiles || flags.rendersPdf ? "material_summary" : "quick_answer";
  }
  if (/\b(schedule|timetable|exam|room|today|tomorrow|deadline|termin|prüfung|raum|morgen|heute|wann|wo)\b/i.test(prompt)) {
    return "schedule_answer";
  }
  if (flags.maxPagesBucket === "0-2" && !flags.downloadsFiles && !flags.usesCis) {
    return "quick_answer";
  }
  return "unknown";
}

function emitExpectationLine(expectation: StudyBuddyRunExpectation): void {
  if (
    process.env.STUDY_BUDDY_EXPECTATION_STDOUT === "false" ||
    process.env.STUDY_BUDDY_PROGRESS_STDOUT === "false"
  ) {
    return;
  }
  console.log(`${STUDY_BUDDY_EXPECTATION_MARKER}${JSON.stringify(expectation)}`);
}

function maxPagesBucketFor(maxPages: number): StudyBuddyTaskShape["maxPagesBucket"] {
  if (maxPages <= 2) return "0-2";
  if (maxPages <= 8) return "3-8";
  return "9+";
}

function compatibleTaskKey(taskShape: StudyBuddyTaskShape): string {
  return [
    taskShape.kind,
    taskShape.usesCis ? "cis" : "no-cis",
    taskShape.downloadsFiles ? "downloads" : "no-downloads",
    taskShape.rendersPdf ? "pdf" : "no-pdf",
    taskShape.maxPagesBucket,
  ].join("|");
}

function checkBackLabel(now: Date, minMs: number, maxMs: number): string {
  return `Good time to check back: ${clockLabel(new Date(now.getTime() + minMs))}-${clockLabel(
    new Date(now.getTime() + maxMs),
  )}`;
}

function minutesRangeLabel(minMs: number, maxMs: number): string {
  const min = Math.max(1, Math.round(minMs / 60_000));
  const max = Math.max(min, Math.round(maxMs / 60_000));
  return `${min}-${max} min`;
}

function clockLabel(value: Date): string {
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function percentile(values: number[], target: number): number {
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * target)));
  return values[index] ?? values[values.length - 1] ?? 0;
}

function roundToMinute(ms: number): number {
  return clampMs(Math.round(ms / 60_000) * 60_000);
}

function clampMs(ms: number): number {
  return Math.max(MIN_MS, Math.min(MAX_MS, Math.round(ms)));
}

function terminalStatus(status: StudyBuddyRunStatus): boolean {
  return status === "success" ||
    status === "partial" ||
    status === "failed" ||
    status === "timeout" ||
    status === "canceled";
}

function resolveHistoryPath(): string | null {
  const root = process.env.T3CODE_HOME;
  return root ? path.join(root, "study-buddy", "run-history.jsonl") : null;
}

async function readExpectation(runDir: string): Promise<StudyBuddyRunExpectation | null> {
  try {
    const text = await readFile(path.join(runDir, "run-expectation.json"), "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isStudyBuddyRunExpectation(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function atomicWriteJson(filePath: string, value: StudyBuddyRunExpectation): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function isStudyBuddyRunExpectation(value: unknown): value is StudyBuddyRunExpectation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudyBuddyRunExpectation>;
  return candidate.schemaVersion === 2 &&
    candidate.kind === "run_expectation" &&
    typeof candidate.runDir === "string" &&
    typeof candidate.requestName === "string" &&
    typeof candidate.startedAt === "string";
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HistoryRecord>;
  return candidate.schemaVersion === 1 &&
    typeof candidate.completedAt === "string" &&
    typeof candidate.durationMs === "number" &&
    typeof candidate.status === "string" &&
    candidate.taskShape !== undefined;
}
