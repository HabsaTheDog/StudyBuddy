import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunEvent, SourceCoverage } from "./runDiagnostics.js";
import type { SourcePlan, SourceTarget } from "./sourcePlanner.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { writeRunExpectation, type StudyBuddyRunPhase } from "./runExpectation.js";

export type StudyBuddyRunStatus =
  | "queued"
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "timeout"
  | "canceled";

export type StudyBuddyUserPhase =
  | "planning_sources"
  | "reading_sources"
  | "reading_moodle"
  | "reading_cis"
  | "downloading_sources"
  | "checking_missing_sources"
  | "analyzing"
  | "writing_document"
  | "rendering_pdf"
  | "finalizing";

export interface StudyBuddyPublicStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
}

export interface StudyBuddyRunProgress {
  schemaVersion: 1;
  runDir: string;
  requestName: string;
  status: StudyBuddyRunStatus;
  phase: StudyBuddyUserPhase;
  phaseLabel: string;
  studentMessage: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  elapsedMs: number;
  estimatedTotalMs: number | null;
  estimatedRemainingMs: number | null;
  etaLabel: string;
  etaConfidence: "low" | "medium" | "high";
  progressRatio: number | null;
  sourcePlan: SourcePlan;
  sourceCoverage: SourceCoverage;
  publicSteps: StudyBuddyPublicStep[];
  technicalEventsTail: RunEvent[];
  artifacts: {
    extractedDataPath?: string;
    typstPath?: string;
    pdfPath?: string;
    runSummaryPath: string;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
}

export interface RunProgressUpdate {
  status?: StudyBuddyRunStatus;
  phase?: StudyBuddyUserPhase;
  sourcePlan?: SourcePlan;
  followUpTargets?: SourceTarget[];
  error?: { message: string; retryable: boolean };
  artifacts?: {
    extractedDataPath?: string;
    typstPath?: string;
    pdfPath?: string;
  };
}

const DEFAULT_SOURCE_PLAN: SourcePlan = {
  targets: ["moodle"],
  confidence: "low",
  reason: "Source planning has not completed yet.",
  needsCurrentScheduleData: false,
  needsCourseMaterial: true,
  needsFiles: false,
  needsQuizOrAssignment: false,
  allowFollowUpCrawl: true,
};

const PHASE_PROGRESS: Record<StudyBuddyUserPhase, number> = {
  planning_sources: 0.08,
  reading_sources: 0.22,
  reading_moodle: 0.22,
  reading_cis: 0.22,
  downloading_sources: 0.35,
  checking_missing_sources: 0.45,
  analyzing: 0.58,
  writing_document: 0.76,
  rendering_pdf: 0.9,
  finalizing: 0.98,
};

const PHASE_LABELS: Record<StudyBuddyUserPhase, string> = {
  planning_sources: "Quellen werden geplant",
  reading_sources: "Moodle und CIS werden gelesen",
  reading_moodle: "Moodle-Unterlagen werden gelesen",
  reading_cis: "CIS-Informationen werden gelesen",
  downloading_sources: "Dateien werden gelesen",
  checking_missing_sources: "Fehlende Quellen werden geprüft",
  analyzing: "Inhalte werden ausgewertet",
  writing_document: "Dokument wird geschrieben",
  rendering_pdf: "PDF wird erstellt",
  finalizing: "Ergebnis wird geprüft",
};

const STUDENT_MESSAGES: Record<StudyBuddyUserPhase, string> = {
  planning_sources: "Ich entscheide, welche Quellen für deine Anfrage nötig sind.",
  reading_sources: "Ich lese Moodle und CIS parallel und grenze die relevanten Kurse ein.",
  reading_moodle: "Ich lese die relevanten Moodle-Unterlagen.",
  reading_cis: "Ich prüfe aktuelle CIS-Informationen.",
  downloading_sources: "Ich lade relevante Dateien als Quellen für diesen Run.",
  checking_missing_sources: "Ich prüfe noch eine fehlende Quelle.",
  analyzing: "Ich strukturiere die gefundenen Inhalte.",
  writing_document: "Ich schreibe daraus die Lernunterlage.",
  rendering_pdf: "Ich erstelle und prüfe das PDF.",
  finalizing: "Ich sichere die Ergebnisse und Quellenhinweise.",
};

const STARTED_AT = new Map<string, string>();

export async function writeRunProgress(
  config: MoodleRuntimeConfig,
  update: RunProgressUpdate = {},
): Promise<StudyBuddyRunProgress> {
  const previous = await readProgress(config.runDir);
  const startedAt = previous?.startedAt ?? STARTED_AT.get(config.runDir) ?? new Date().toISOString();
  STARTED_AT.set(config.runDir, startedAt);
  const sourcePlan = update.sourcePlan ?? config.sourcePlan ?? previous?.sourcePlan ?? DEFAULT_SOURCE_PLAN;
  const sourceCoverage = config.diagnostics?.getCoverage() ?? previous?.sourceCoverage ?? {
    moodle: {
      status: "not_requested",
      detail: "Moodle was not queried.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
    cis: {
      status: "not_requested",
      detail: "CIS was not queried.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
  };
  const phase = update.phase ?? previous?.phase ?? "planning_sources";
  const status = update.status ?? previous?.status ?? "running";
  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const estimate = estimateRunTimeMs(config, sourcePlan, update.followUpTargets ?? []);
  const progressRatio = terminalStatus(status) ? 1 : PHASE_PROGRESS[phase] ?? null;
  const estimatedRemainingMs = estimate === null || progressRatio === null
    ? null
    : Math.max(0, estimate - elapsedMs);
  const now = new Date().toISOString();
  const artifacts = {
    extractedDataPath: update.artifacts?.extractedDataPath ?? previous?.artifacts.extractedDataPath,
    typstPath: update.artifacts?.typstPath ?? previous?.artifacts.typstPath,
    pdfPath: update.artifacts?.pdfPath ?? previous?.artifacts.pdfPath,
    runSummaryPath: config.diagnostics?.runSummaryPath ?? previous?.artifacts.runSummaryPath ?? path.join(config.runDir, "run-summary.md"),
  };
  const progress: StudyBuddyRunProgress = {
    schemaVersion: 1,
    runDir: config.runDir,
    requestName: config.requestName,
    status,
    phase,
    phaseLabel: PHASE_LABELS[phase],
    studentMessage: STUDENT_MESSAGES[phase],
    startedAt,
    updatedAt: now,
    completedAt: terminalStatus(status) ? now : previous?.completedAt,
    elapsedMs,
    estimatedTotalMs: estimate,
    estimatedRemainingMs,
    etaLabel: etaLabel(estimatedRemainingMs),
    etaConfidence: etaConfidence(sourcePlan, update.followUpTargets ?? []),
    progressRatio,
    sourcePlan,
    sourceCoverage,
    publicSteps: buildPublicSteps(sourcePlan, sourceCoverage, phase, update.followUpTargets ?? []),
    technicalEventsTail: await readEventsTail(config.runDir, 20),
    artifacts,
    error: update.error ?? previous?.error,
  };
  await atomicWriteJson(path.join(config.runDir, "run-progress.json"), progress);
  await writeRunExpectation(config, {
    status: status === "queued" ? "running" : status,
    phase: expectationPhase(phase),
    sourceCoverage,
    artifacts: {
      pdfPath: artifacts.pdfPath,
      runSummaryPath: artifacts.runSummaryPath,
    },
    error: progress.error,
  });
  emitProgressLine(progress);
  return progress;
}

function expectationPhase(phase: StudyBuddyUserPhase): StudyBuddyRunPhase {
  switch (phase) {
    case "planning_sources":
      return "planning";
    case "reading_sources":
    case "reading_moodle":
    case "reading_cis":
    case "downloading_sources":
    case "checking_missing_sources":
      return "reading_sources";
    case "analyzing":
      return "analyzing";
    case "writing_document":
      return "writing";
    case "rendering_pdf":
      return "rendering";
    case "finalizing":
      return "finalizing";
  }
}

function emitProgressLine(progress: StudyBuddyRunProgress): void {
  if (process.env.STUDY_BUDDY_PROGRESS_STDOUT === "false") {
    return;
  }
  const compact = {
    schemaVersion: progress.schemaVersion,
    runDir: progress.runDir,
    requestName: progress.requestName,
    status: progress.status,
    phase: progress.phase,
    phaseLabel: progress.phaseLabel,
    studentMessage: progress.studentMessage,
    startedAt: progress.startedAt,
    updatedAt: progress.updatedAt,
    completedAt: progress.completedAt,
    elapsedMs: progress.elapsedMs,
    estimatedTotalMs: progress.estimatedTotalMs,
    estimatedRemainingMs: progress.estimatedRemainingMs,
    etaLabel: progress.etaLabel,
    etaConfidence: progress.etaConfidence,
    progressRatio: progress.progressRatio,
    sourcePlan: progress.sourcePlan,
    sourceCoverage: {
      moodle: {
        status: progress.sourceCoverage.moodle.status,
        detail: progress.sourceCoverage.moodle.detail,
        pages: progress.sourceCoverage.moodle.pages,
        artifacts: progress.sourceCoverage.moodle.artifacts.length,
      },
      cis: {
        status: progress.sourceCoverage.cis.status,
        detail: progress.sourceCoverage.cis.detail,
        pages: progress.sourceCoverage.cis.pages,
        artifacts: progress.sourceCoverage.cis.artifacts.length,
      },
    },
    publicSteps: progress.publicSteps,
    artifacts: progress.artifacts,
    error: progress.error,
  };
  console.log(`STUDY_BUDDY_RUN_PROGRESS ${JSON.stringify(compact)}`);
}

function buildPublicSteps(
  plan: SourcePlan,
  coverage: SourceCoverage,
  phase: StudyBuddyUserPhase,
  followUpTargets: SourceTarget[],
): StudyBuddyPublicStep[] {
  const steps: StudyBuddyPublicStep[] = [
    { id: "plan", label: "Quellen planen", status: stepStatus(phase, ["planning_sources"], true) },
    {
      id: "moodle",
      label: "Moodle lesen",
      status: sourceStepStatus("moodle", plan.targets, coverage.moodle.status),
    },
    {
      id: "cis",
      label: "CIS prüfen",
      status: sourceStepStatus("cis", plan.targets, coverage.cis.status),
    },
  ];
  if (followUpTargets.length > 0 || phase === "checking_missing_sources") {
    steps.push({
      id: "follow_up",
      label: "Zusätzliche Quelle prüfen",
      status: phase === "checking_missing_sources" ? "running" : "done",
    });
  }
  steps.push(
    { id: "analyze", label: "Inhalte auswerten", status: stepStatus(phase, ["analyzing"], hasReached(phase, "writing_document")) },
    { id: "write", label: "Dokument schreiben", status: stepStatus(phase, ["writing_document"], hasReached(phase, "rendering_pdf")) },
    { id: "pdf", label: "PDF erstellen", status: stepStatus(phase, ["rendering_pdf", "finalizing"], false) },
  );
  return steps;
}

function sourceStepStatus(
  target: SourceTarget,
  plannedTargets: SourceTarget[],
  status: SourceCoverage["moodle"]["status"],
): StudyBuddyPublicStep["status"] {
  if (!plannedTargets.includes(target)) {
    return "skipped";
  }
  if (status === "success" || status === "partial" || status === "empty") {
    return "done";
  }
  if (status === "failed" || status === "failed_auth" || status === "timeout") {
    return "failed";
  }
  if (status === "attempted") {
    return "running";
  }
  return "pending";
}

function stepStatus(
  phase: StudyBuddyUserPhase,
  runningPhases: StudyBuddyUserPhase[],
  done: boolean,
): StudyBuddyPublicStep["status"] {
  if (done) {
    return "done";
  }
  return runningPhases.includes(phase) ? "running" : "pending";
}

function hasReached(phase: StudyBuddyUserPhase, target: StudyBuddyUserPhase): boolean {
  return PHASE_PROGRESS[phase] >= PHASE_PROGRESS[target];
}

function estimateRunTimeMs(
  config: MoodleRuntimeConfig,
  sourcePlan: SourcePlan,
  followUpTargets: SourceTarget[],
): number | null {
  let estimate = 45_000;
  if (sourcePlan.targets.includes("moodle")) {
    estimate += Math.min(config.maxPages, 8) * 14_000;
  }
  if (sourcePlan.targets.includes("cis")) {
    estimate += Math.min(config.maxCisPages, 6) * 10_000;
  }
  if (config.allowFileDownloads && sourcePlan.needsFiles) {
    estimate += 60_000;
  }
  if (followUpTargets.length > 0) {
    estimate += followUpTargets.length * 70_000;
  }
  if (config.stage === "extract") {
    estimate -= 45_000;
  }
  if (config.renderStrategyDecision?.strategy === "deterministic" || config.renderStrategy === "deterministic") {
    estimate -= 35_000;
  }
  if (config.typstValidationMode === "strict") {
    estimate += 25_000;
  }
  return Math.max(30_000, estimate);
}

function etaLabel(remainingMs: number | null): string {
  if (remainingMs === null) {
    return "Zeit wird neu geschätzt";
  }
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes <= 1) {
    return "noch etwa 1 min";
  }
  if (minutes <= 5) {
    return `noch etwa ${Math.max(2, minutes - 1)}-${minutes + 1} min`;
  }
  if (minutes <= 10) {
    return `noch etwa ${minutes}-${minutes + 2} min`;
  }
  return "dauert wahrscheinlich länger als 10 min";
}

function etaConfidence(sourcePlan: SourcePlan, followUpTargets: SourceTarget[]): "low" | "medium" | "high" {
  if (followUpTargets.length > 0 || sourcePlan.confidence === "low") {
    return "low";
  }
  return sourcePlan.confidence;
}

async function readEventsTail(runDir: string, limit: number): Promise<RunEvent[]> {
  const text = await readFile(path.join(runDir, "run-events.jsonl"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RunEvent];
      } catch {
        return [];
      }
    });
}

async function readProgress(runDir: string): Promise<StudyBuddyRunProgress | null> {
  const text = await readFile(path.join(runDir, "run-progress.json"), "utf8").catch(() => "");
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as StudyBuddyRunProgress;
  } catch {
    return null;
  }
}

async function atomicWriteJson(filePath: string, value: StudyBuddyRunProgress): Promise<void> {
  validateProgress(value);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const tmpStat = await stat(tmpPath);
  if (!tmpStat.isFile() || tmpStat.size === 0) {
    throw new Error(`Refusing to write malformed progress file: ${filePath}`);
  }
  await rename(tmpPath, filePath);
}

function validateProgress(value: StudyBuddyRunProgress): void {
  if (value.schemaVersion !== 1 || !value.runDir || !value.requestName || !value.phase || !value.status) {
    throw new Error("Malformed Study Buddy run progress payload.");
  }
  if (
    value.progressRatio !== null &&
    (!Number.isFinite(value.progressRatio) || value.progressRatio < 0 || value.progressRatio > 1)
  ) {
    throw new Error("Malformed Study Buddy run progress ratio.");
  }
}

function terminalStatus(status: StudyBuddyRunStatus): boolean {
  return status === "success" || status === "partial" || status === "failed" || status === "timeout" || status === "canceled";
}
