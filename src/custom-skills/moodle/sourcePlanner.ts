import type { MoodleRuntimeConfig, SourceMode } from "./types.js";
import { requiresCisDirectly } from "./calendarAdapter.js";

export type SourceTarget = "moodle" | "cis" | "calendar";

export interface SourcePlan {
  targets: SourceTarget[];
  confidence: "low" | "medium" | "high";
  reason: string;
  needsCurrentScheduleData: boolean;
  needsCourseMaterial: boolean;
  needsFiles: boolean;
  needsQuizOrAssignment: boolean;
  allowFollowUpCrawl: boolean;
}

export function planSources(config: MoodleRuntimeConfig): SourcePlan {
  if (config.intentDecision) {
    return planSourcesForIntent(config);
  }
  return planSourcesForPrompt(config.prompt, {
    sourceMode: config.sourceMode,
    includeCis: config.includeCis,
    hasCisUrls: config.cisUrls.length > 0,
    hasCalendarUrl: Boolean(config.calendarUrl),
    isRenderStage: config.stage === "render",
  });
}

function planSourcesForIntent(config: MoodleRuntimeConfig): SourcePlan {
  const intent = config.intentDecision;
  if (!intent) {
    return planSourcesForPrompt(config.prompt);
  }
  if (config.stage === "render") {
    return planSourcesForPrompt(config.prompt, {
      sourceMode: config.sourceMode,
      includeCis: config.includeCis,
      hasCisUrls: config.cisUrls.length > 0,
      hasCalendarUrl: Boolean(config.calendarUrl),
      isRenderStage: true,
    });
  }
  if (config.sourceMode !== "auto") {
    return planFromOverride(config.sourceMode, {
      cisAllowed: config.includeCis && config.cisUrls.length > 0,
      currentSchedule: intent.needsCis,
      courseMaterial: intent.needsCourseMaterial,
      needsFiles: intent.needsDownloadedFiles,
      needsQuizOrAssignment: intent.wantsQuizAssistance,
    });
  }
  if (intent.intent === "schedule_answer") {
    const cisAllowed = config.includeCis && config.cisUrls.length > 0;
    const calendarAllowed = Boolean(config.calendarUrl) && !requiresCisDirectly(config.prompt);
    const targets: SourceTarget[] = [];
    if (intent.needsCourseMaterial) targets.push("moodle");
    if (calendarAllowed) {
      targets.push("calendar");
    } else if (requiresCisDirectly(config.prompt)) {
      if (cisAllowed) targets.push("cis");
    } else {
      if (!targets.includes("moodle")) targets.push("moodle");
      if (cisAllowed) targets.push("cis");
    }
    return {
      targets,
      confidence: "high",
      reason: calendarAllowed
        ? "Schedule lookup starts with the personal calendar and uses bounded Moodle/CIS fallbacks only when needed."
        : "Schedule lookup uses bounded Moodle and CIS probes because no complete calendar source is available.",
      needsCurrentScheduleData: true,
      needsCourseMaterial: intent.needsCourseMaterial,
      needsFiles: intent.needsDownloadedFiles,
      needsQuizOrAssignment: false,
      allowFollowUpCrawl: true,
    };
  }
  const targets: SourceTarget[] = [];
  if (intent.needsMoodle) targets.push("moodle");
  if (intent.needsCalendar && config.calendarUrl && !requiresCisDirectly(config.prompt)) {
    targets.push("calendar");
  } else if (intent.needsCis && config.includeCis && config.cisUrls.length > 0) {
    targets.push("cis");
  }
  return {
    targets,
    confidence: "high",
    reason: intent.reason,
    needsCurrentScheduleData: intent.needsCis,
    needsCourseMaterial: intent.needsCourseMaterial,
    needsFiles: intent.needsDownloadedFiles,
    needsQuizOrAssignment: intent.wantsQuizAssistance,
    allowFollowUpCrawl: intent.intent !== "render" && intent.intent !== "diagnostic",
  };
}

export function planSourcesForPrompt(
  prompt: string,
  options: {
    sourceMode?: SourceMode;
    includeCis?: boolean;
    hasCisUrls?: boolean;
    hasCalendarUrl?: boolean;
    isRenderStage?: boolean;
  } = {},
): SourcePlan {
  const sourceMode = options.sourceMode ?? "auto";
  const includeCis = options.includeCis ?? true;
  const hasCisUrls = options.hasCisUrls ?? true;
  const hasCalendarUrl = options.hasCalendarUrl ?? false;
  const normalized = prompt.toLowerCase();
  const currentSchedule = hasAny(normalized, [
    "heute",
    "morgen",
    "diese woche",
    "stundenplan",
    "raum",
    "räume",
    "anwesenheit",
    "termin",
    "deadline",
    "frist",
    "nächste einheit",
    "naechste einheit",
    "was machen wir",
    "fachlabor",
    "laborslot",
    "lv-info",
    "administrativ",
  ]) || /\b(?:prüfung|pruefung|test|klausur|exam|wann|wo|uhrzeit)\b/i.test(normalized);
  const courseMaterial = hasAny(normalized, [
    "lernzettel",
    "unterlagen",
    "kursunterlagen",
    "folie",
    "folien",
    "skript",
    "pdf",
    "datei",
    "moodle",
    "kursmaterial",
    "formelsammlung",
    "übungsblatt",
    "uebungsblatt",
    "dc-dc",
    "dcdc",
    "gleichspannungswandler",
    "wandler",
    "zusammenfassung",
    "vokabelliste",
    "was machen wir",
    "what are we doing",
    "fachlabor",
    "laborinhalt",
  ]) || /https:\/\/[^\s]+\/(?:course\/view\.php|mod\/|pluginfile\.php|my\/?)/i.test(prompt);
  const needsFiles = hasAny(normalized, [
    "pdf",
    "folie",
    "folien",
    "skript",
    "datei",
    "download",
    "unterlagen",
    "screenshot",
  ]);
  const needsQuizOrAssignment = hasAny(normalized, [
    "quiz",
    "moodle-quiz",
    "assignment",
    "aufgabe",
    "aufgabenstellung",
    "abgabe",
  ]);
  const materialSignals = courseMaterial || needsFiles || needsQuizOrAssignment;
  const cisAllowed = includeCis && hasCisUrls;
  const calendarAllowed = hasCalendarUrl && !requiresCisDirectly(prompt);

  if (options.isRenderStage) {
    return {
      targets: [],
      confidence: "high",
      reason: "Render stage consumes an existing extraction run and does not crawl sources.",
      needsCurrentScheduleData: false,
      needsCourseMaterial: false,
      needsFiles: false,
      needsQuizOrAssignment: false,
      allowFollowUpCrawl: false,
    };
  }

  if (sourceMode !== "auto") {
    return planFromOverride(sourceMode, {
      cisAllowed,
      currentSchedule,
      courseMaterial: materialSignals,
      needsFiles,
      needsQuizOrAssignment,
    });
  }

  if (currentSchedule && materialSignals) {
    return {
      targets: calendarAllowed ? ["moodle", "calendar"] : cisAllowed ? ["moodle", "cis"] : ["moodle"],
      confidence: "high",
      reason: calendarAllowed
        ? "The request combines current schedule/exam facts with course material; calendar is primary."
        : cisAllowed
          ? "The request combines current schedule/exam facts with course material."
        : "The request combines schedule and material facts, but CIS is disabled or unavailable.",
      needsCurrentScheduleData: true,
      needsCourseMaterial: true,
      needsFiles,
      needsQuizOrAssignment,
      allowFollowUpCrawl: true,
    };
  }

  if (currentSchedule) {
    return {
      targets: calendarAllowed ? ["calendar"] : cisAllowed ? ["cis"] : [],
      confidence: calendarAllowed || cisAllowed ? "high" : "medium",
      reason: calendarAllowed
        ? "The request is about schedule, room, exam, or deadline facts; calendar is primary."
        : cisAllowed
          ? "The request is about schedule, room, exam, deadline, or administrative facts."
        : "The request asks for CIS-style facts, but CIS is disabled or unavailable.",
      needsCurrentScheduleData: true,
      needsCourseMaterial: false,
      needsFiles: false,
      needsQuizOrAssignment: false,
      allowFollowUpCrawl: true,
    };
  }

  if (materialSignals) {
    return {
      targets: ["moodle"],
      confidence: "high",
      reason: "The request is about Moodle course material, files, quizzes, or assignments.",
      needsCurrentScheduleData: false,
      needsCourseMaterial: true,
      needsFiles,
      needsQuizOrAssignment,
      allowFollowUpCrawl: true,
    };
  }

  return {
    targets: cisAllowed ? ["moodle", "cis"] : ["moodle"],
    confidence: "low",
    reason: cisAllowed
      ? "The request is ambiguous; conservative routing keeps both source families available."
      : "The request is ambiguous; CIS is disabled or unavailable, so Moodle is used.",
    needsCurrentScheduleData: cisAllowed,
    needsCourseMaterial: true,
    needsFiles: false,
    needsQuizOrAssignment: false,
    allowFollowUpCrawl: true,
  };
}

function planFromOverride(
  sourceMode: Exclude<SourceMode, "auto">,
  signals: {
    cisAllowed: boolean;
    currentSchedule: boolean;
    courseMaterial: boolean;
    needsFiles: boolean;
    needsQuizOrAssignment: boolean;
  },
): SourcePlan {
  const targets: SourceTarget[] = sourceMode === "both"
    ? signals.cisAllowed ? ["moodle", "cis"] : ["moodle"]
    : sourceMode === "cis"
      ? signals.cisAllowed ? ["cis"] : []
      : ["moodle"];
  return {
    targets,
    confidence: "high",
    reason: `Explicit source mode override: ${sourceMode}.`,
    needsCurrentScheduleData: sourceMode === "cis" || sourceMode === "both" || signals.currentSchedule,
    needsCourseMaterial: sourceMode === "moodle" || sourceMode === "both" || signals.courseMaterial,
    needsFiles: signals.needsFiles,
    needsQuizOrAssignment: signals.needsQuizOrAssignment,
    allowFollowUpCrawl: false,
  };
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}
