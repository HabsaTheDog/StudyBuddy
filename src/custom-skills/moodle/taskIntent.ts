import type { PipelineStage } from "./types.js";
import { extractMoodleUrlFromText, isLikelyMoodleUrl } from "./moodleSite.js";

export type StudyBuddyIntent =
  | "quick_answer"
  | "schedule_answer"
  | "document"
  | "study_pdf"
  | "quiz_assist"
  | "extraction"
  | "render"
  | "diagnostic";

export interface StudyBuddyIntentDecision {
  intent: StudyBuddyIntent;
  wantsPdf: boolean;
  wantsTypstDocument: boolean;
  wantsQuickAnswer: boolean;
  wantsQuizAssistance: boolean;
  wantsQuizDiscovery?: boolean;
  needsMoodle: boolean;
  needsCis: boolean;
  needsCalendar: boolean;
  needsCourseMaterial: boolean;
  needsDownloadedFiles: boolean;
  reason: string;
}

export function classifyStudyBuddyIntent(input: {
  prompt: string;
  stage: PipelineStage;
  diagnosticOnly: boolean;
  autoAnswer: boolean;
  includeCis: boolean;
  hasCisUrls: boolean;
  hasCalendarUrl?: boolean;
}): StudyBuddyIntentDecision {
  const prompt = input.prompt;
  const cisAvailable = input.includeCis && input.hasCisUrls;
  const calendarAvailable = Boolean(input.hasCalendarUrl);

  if (input.diagnosticOnly) {
    return decision("diagnostic", "Diagnostic-only runs only probe source access.", {
      needsMoodle: true,
      needsCis: cisAvailable,
      needsCalendar: calendarAvailable,
    });
  }
  if (input.stage === "extract") {
    const semanticIntent = classifyStudyBuddyIntent({
      ...input,
      stage: "all",
    });
    return {
      ...semanticIntent,
      intent: "extraction",
      wantsPdf: false,
      wantsTypstDocument: false,
      wantsQuickAnswer: false,
      reason: `Extraction handoff for ${semanticIntent.intent}: ${semanticIntent.reason}`,
    };
  }
  if (input.stage === "render") {
    return decision("render", "Render stage consumes an existing extraction handoff.", {
      needsMoodle: false,
      needsCis: false,
    });
  }

  const wantsQuizDiscovery = isQuizDiscoveryIntent(prompt);
  const hasQuizIntent = explicitQuizIntent(prompt);
  const wantsPdf = /\b(?:pdfs?|lernzettel|formelsammlung|skript|typst|dokument|document|study guide|worksheet|cheat sheet)\b/i
    .test(prompt);
  const wantsDocument = wantsPdf ||
    /\b(?:kursübersicht|kursuebersicht|stoffübersicht|stoffuebersicht|zusammenfassung|vorbereitung|lernunterlagen|kursunterlagen|prüfungsrelevante unterlagen|pruefungsrelevante unterlagen)\b/i
      .test(prompt);
  const onlyShortAnswer = /\b(?:nenne nur|nur den termin|kurz|nur kurz|nur datum|nur die antwort)\b/i.test(prompt);
  const scheduleSignal = /\b(?:termin|prüfung|pruefung|test|klausur|raum|räume|raeume|uhrzeit|heute|morgen|deadline|frist|wann|wo|schedule|timetable|exam|room|today|tomorrow|anwesenheit|attendance|lv-info|administrativ)\b/i
    .test(prompt);
  const explicitMoodleUrl = extractMoodleUrlFromText(prompt);
  const explicitMoodleSource = /\bmoodle\b/i.test(prompt) ||
    Boolean(explicitMoodleUrl && isLikelyMoodleUrl(explicitMoodleUrl));
  const courseMaterial = /\b(?:lernunterlagen|kursunterlagen|unterlagen|prüfungsrelevante|pruefungsrelevante|materialien|skript|folie|folien|pdf|datei|kursmaterial|fachlabor|laborinhalt)\b|was machen wir|what are we doing/i
    .test(prompt);
  const needsDownloadedFiles = wantsPdf ||
    /\b(?:download|herunterlad\w*|pdfs?|dateien?|files?|folien?|slides?|skript|screenshots?)\b/i.test(prompt);

  if (hasQuizIntent) {
    return decision("quiz_assist", "The prompt explicitly asks for quiz/test assistance.", {
      wantsQuizAssistance: true,
      wantsQuizDiscovery,
      wantsQuickAnswer: wantsQuizDiscovery,
      needsMoodle: true,
      needsCis: false,
      needsCourseMaterial: true,
      needsDownloadedFiles: false,
    });
  }

  if (wantsPdf) {
    return decision("study_pdf", "The prompt explicitly requests a PDF/Typst study artifact.", {
      wantsPdf: true,
      wantsTypstDocument: true,
      needsMoodle: true,
      needsCis: scheduleSignal && cisAvailable,
      needsCalendar: scheduleSignal && calendarAvailable,
      needsCourseMaterial: true,
      needsDownloadedFiles,
    });
  }

  if (scheduleSignal && !wantsPdf) {
    return decision("schedule_answer", "The prompt asks for schedule/date/room facts without a document request.", {
      wantsQuickAnswer: true,
      needsMoodle: courseMaterial || explicitMoodleSource,
      needsCis: cisAvailable,
      needsCalendar: calendarAvailable,
      needsCourseMaterial: courseMaterial,
      needsDownloadedFiles: false,
    });
  }

  if (wantsDocument && !onlyShortAnswer) {
    return decision("document", "The prompt asks for a course/material overview suited to a study artifact.", {
      wantsTypstDocument: true,
      needsMoodle: true,
      needsCis: scheduleSignal && cisAvailable,
      needsCalendar: scheduleSignal && calendarAvailable,
      needsCourseMaterial: true,
      needsDownloadedFiles,
    });
  }

  return decision("quick_answer", "The prompt is a factual request without explicit PDF or quiz intent.", {
    wantsQuickAnswer: true,
    needsMoodle: true,
    needsCis: scheduleSignal && cisAvailable,
    needsCalendar: scheduleSignal && calendarAvailable,
    needsCourseMaterial: courseMaterial,
    needsDownloadedFiles: false,
  });
}

function explicitQuizIntent(prompt: string): boolean {
  // Discovery is a Moodle activity lookup even when the user also asks for
  // availability, dates, or time limits. Those words must not demote the
  // request to the schedule/calendar route.
  if (isQuizDiscoveryIntent(prompt)) {
    return true;
  }
  if (
    /\b(?:wann|wo|termin|uhrzeit|raum|schedule|date|time)\b/i.test(prompt) &&
    !/\b(?:bearbeite|mach|starte|fülle|fuelle|ausfüllen|ausfuellen|solve|fill|answer)\b/i.test(prompt)
  ) {
    return false;
  }
  return (
    /\/mod\/quiz\//i.test(prompt) ||
    /\b(?:quiz|test|minitest|kurztest|moodle-test|testblock|multiple choice)\b/i.test(prompt) ||
    /\b(?:bearbeite|mach|starte|fülle|fuelle|ausfüllen|ausfuellen|solve|fill|answer)\b.{0,40}\b(?:quiz|test|minitest|kurztest)\b/i
      .test(prompt) ||
    /\b(?:antworten ausfüllen|antworten ausfuellen|answer this quiz|fill this quiz|solve this quiz)\b/i.test(prompt)
  );
}

function isQuizDiscoveryIntent(prompt: string): boolean {
  const quizNoun = /\b(?:quiz(?:zes)?|tests?|minitests?|kurztests?|moodle-tests?|testblocks?|self[ -]?checks?|selbsttests?|selbstkontrollen?)\b/i;
  const discoveryAction = /\b(?:find|list|scan|look through|show|search|discover|available|attemptable|still open|currently open|offen|verfügbar|verfuegbar|durchsuch|auflist|anzeig|finde|suche)\w*\b/i;
  return quizNoun.test(prompt) && discoveryAction.test(prompt);
}

function decision(
  intent: StudyBuddyIntent,
  reason: string,
  overrides: Partial<Omit<StudyBuddyIntentDecision, "intent" | "reason">> = {},
): StudyBuddyIntentDecision {
  return {
    intent,
    wantsPdf: false,
    wantsTypstDocument: false,
    wantsQuickAnswer: false,
    wantsQuizAssistance: false,
    wantsQuizDiscovery: false,
    needsMoodle: true,
    needsCis: false,
    needsCalendar: false,
    needsCourseMaterial: false,
    needsDownloadedFiles: false,
    ...overrides,
    reason,
  };
}
