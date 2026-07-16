import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunEvent, SourceCoverage } from "./runDiagnostics.js";
import type { SourcePlan, SourceTarget } from "./sourcePlanner.js";
import type { MoodleRuntimeConfig } from "./types.js";
import type { ExecutionMetricsSnapshot } from "./executionTelemetry.js";

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
  | "reading_calendar"
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
  schemaVersion: 2;
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
  progressRatio: number | null;
  sourcePlan: SourcePlan;
  sourceCoverage: SourceCoverage;
  publicSteps: StudyBuddyPublicStep[];
  technicalEventsTail: RunEvent[];
  artifacts: {
    extractedDataPath?: string;
    typstPath?: string;
    pdfPath?: string;
    answerPath?: string;
    answerJsonPath?: string;
    runSummaryPath: string;
  };
  error?: {
    message: string;
    retryable: boolean;
  };
  execution?: ExecutionMetricsSnapshot;
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
    answerPath?: string;
    answerJsonPath?: string;
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
  reading_calendar: 0.18,
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
  reading_calendar: "Kalender wird geprüft",
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
  reading_calendar: "Ich prüfe den persönlichen Uni-Kalender.",
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
  options: { transitionTelemetry?: boolean } = {},
): Promise<StudyBuddyRunProgress> {
  const previous = await readProgress(config.runDir);
  const startedAt = previous?.startedAt ?? STARTED_AT.get(config.runDir) ?? new Date().toISOString();
  STARTED_AT.set(config.runDir, startedAt);
  const sourcePlan = update.sourcePlan ?? config.sourcePlan ?? previous?.sourcePlan ?? DEFAULT_SOURCE_PLAN;
  const reportedCoverage = config.diagnostics?.getCoverage() ?? previous?.sourceCoverage;
  const sourceCoverage: SourceCoverage = reportedCoverage ? {
    ...reportedCoverage,
    calendar: reportedCoverage.calendar ?? {
      status: "not_requested",
      detail: "Personal calendar was not queried.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
  } : {
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
    calendar: {
      status: "not_requested",
      detail: "Personal calendar was not queried.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
  };
  const phase = update.phase ?? previous?.phase ?? "planning_sources";
  const status = update.status ?? previous?.status ?? "running";
  const elapsedMs = Math.max(0, Date.now() - Date.parse(startedAt));
  const progressRatio = terminalStatus(status) ? 1 : PHASE_PROGRESS[phase] ?? null;
  const now = new Date().toISOString();
  if (options.transitionTelemetry !== false) {
    await config.executionTelemetry?.transitionPhase(phase, now);
  }
  const artifacts = {
    extractedDataPath: update.artifacts?.extractedDataPath ?? previous?.artifacts.extractedDataPath,
    typstPath: update.artifacts?.typstPath ?? previous?.artifacts.typstPath,
    pdfPath: update.artifacts?.pdfPath ?? previous?.artifacts.pdfPath,
    answerPath: update.artifacts?.answerPath ?? previous?.artifacts.answerPath,
    answerJsonPath: update.artifacts?.answerJsonPath ?? previous?.artifacts.answerJsonPath,
    runSummaryPath: config.diagnostics?.runSummaryPath ?? previous?.artifacts.runSummaryPath ?? path.join(config.runDir, "run-summary.md"),
  };
  const progress: StudyBuddyRunProgress = {
    schemaVersion: 2,
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
    progressRatio,
    sourcePlan,
    sourceCoverage,
    publicSteps: buildPublicSteps(config, sourcePlan, sourceCoverage, phase, update.followUpTargets ?? []),
    technicalEventsTail: await readEventsTail(config.runDir, 20),
    artifacts,
    error: update.error ?? previous?.error,
    execution: config.executionTelemetry?.getSnapshot() ?? previous?.execution,
  };
  await atomicWriteJson(path.join(config.runDir, "run-progress.json"), progress);
  return progress;
}

function buildPublicSteps(
  config: MoodleRuntimeConfig,
  plan: SourcePlan,
  coverage: SourceCoverage,
  phase: StudyBuddyUserPhase,
  followUpTargets: SourceTarget[],
): StudyBuddyPublicStep[] {
  const steps: StudyBuddyPublicStep[] = [
    { id: "plan", label: "Quellen planen", status: stepStatus(phase, ["planning_sources"], true) },
    {
      id: "calendar",
      label: "Kalender prüfen",
      status: sourceStepStatus("calendar", plan.targets, coverage.calendar.status),
    },
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
  const answerRoute = config.intentDecision?.wantsQuickAnswer === true;
  const deterministicCalendarAnswer =
    answerRoute &&
    config.intentDecision?.needsCourseMaterial === false &&
    config.calendarSelection?.complete === true;
  steps.push({
    id: "analyze",
    label: "Inhalte auswerten",
    status: deterministicCalendarAnswer
      ? "skipped"
      : stepStatus(phase, ["analyzing"], hasReached(phase, answerRoute ? "finalizing" : "writing_document")),
  });
  steps.push({
    id: "write",
    label: answerRoute ? "Antwort schreiben" : "Dokument schreiben",
    status: stepStatus(phase, answerRoute ? ["finalizing"] : ["writing_document"], answerRoute ? phase === "finalizing" : hasReached(phase, "rendering_pdf")),
  });
  steps.push({
    id: "pdf",
    label: "PDF erstellen",
    status: answerRoute ? "skipped" : stepStatus(phase, ["rendering_pdf", "finalizing"], false),
  });
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
  if (value.schemaVersion !== 2 || !value.runDir || !value.requestName || !value.phase || !value.status) {
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
