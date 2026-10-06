import type { PipelineStage } from "./types.js";
import { extractMoodleUrlFromText, isLikelyMoodleUrl } from "./moodleSite.js";
import { classifyObligationDiscovery, type ObligationDiscoveryIntent } from "./obligationDiscovery.js";

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
  obligationDiscovery?: ObligationDiscoveryIntent;
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
  const obligationDiscovery = classifyObligationDiscovery(prompt);

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
  const wantsPdf = /\b(?:pdfs?|lernzettel|formelsammlung|skript|typst|dokument|document|study guide|worksheet|cheat sheet)\b/i
    .test(prompt);
  const hasQuizIntent = explicitQuizIntent(prompt) &&
    (!wantsPdf || input.autoAnswer || wantsQuizDiscovery);
  const wantsInteractiveStudyArtifact =
    /\b(?:study buddy|interaktive[rsn]?\s+study guide|interactive\s+study guide|lernumgebung|lernseite)\b/i
      .test(prompt);
  const wantsDocument = wantsPdf ||
    wantsInteractiveStudyArtifact ||
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

  if (obligationDiscovery.requested && !wantsPdf && !isExplicitQuizExecutionIntent(prompt)) {
    return decision(
      obligationDiscovery.temporal ? "schedule_answer" : "quick_answer",
      "The prompt asks for actionable course obligations and requires adaptive Moodle coverage.",
      {
        wantsQuickAnswer: true,
        needsMoodle: true,
        needsCis: false,
        needsCalendar: obligationDiscovery.calendarFirst && calendarAvailable,
        needsCourseMaterial: true,
        needsDownloadedFiles,
        obligationDiscovery,
      },
    );
  }

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

  if (scheduleSignal && !wantsPdf && !wantsInteractiveStudyArtifact) {
    return decision("schedule_answer", "The prompt asks for schedule/date/room facts without a document request.", {
      wantsQuickAnswer: true,
      needsMoodle: courseMaterial || explicitMoodleSource,
      needsCis: cisAvailable,
      needsCalendar: calendarAvailable,
      needsCourseMaterial: courseMaterial,
      needsDownloadedFiles: false,
    });
  }

  if (wantsDocument && (!onlyShortAnswer || wantsInteractiveStudyArtifact)) {
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
  return isExplicitQuizExecutionIntent(prompt);
}

export const QUIZ_NOUN = /\b(?:quiz(?:zes)?|tests?|mini[ -]?tests?|kurz[ -]?tests?|moodle[ -]?tests?|testblocks?|multiple choice|self[ -]?(?:checks?|quiz(?:zes)?)|selbst[ -]?(?:tests?|checks?|kontrollen?))\b/i;

export function isExplicitQuizExecutionIntent(prompt: string): boolean {
  if (
    /\b(?:pdfs?|lernzettel|formelsammlung|skript|typst|dokument|document|study guide|worksheet|cheat sheet)\b/i
      .test(prompt)
  ) {
    return false;
  }
  const normalized = prompt.replace(/[‐‑–—]/g, "-");
  if (!QUIZ_NOUN.test(normalized)) return false;
  const executionAction = /\b(?:bearbeit\w*|mach(?:e|en)?|erledig\w*|start\w*|füll\w*|fuell\w*|ausfüll\w*|ausfuell\w*|lös\w*|loes\w*|solve\w*|fill\w*|answer\w*|complete\w*|hilf\w*|help\w*|do)\b/i;
  let quizMentioned = false;
  // Keep the noun's context across sentences, e.g. "I have two quizzes in
  // accounting. Can you complete both?" A character-distance cutoff loses it.
  for (const sentence of normalized.replace(/https?:\/\/\S+/gi, " quiz ").split(/[.!?;\n]+/)) {
    const hasQuiz = QUIZ_NOUN.test(sentence);
    const refersToQuiz = hasQuiz || (quizMentioned && /\b(?:sie|die|diese|beide|alle|das|them|both|these|those|it)\b/i.test(sentence));
    quizMentioned ||= hasQuiz;
    if (!refersToQuiz || !executionAction.test(sentence)) continue;
    if (/\b(?:was|welche\w*|wann|what|which|when|show|list|zeige\w*|liste\w*)\b.*\b(?:muss|müssen|muessen|soll\w*|should|must|need to|have to|to complete|zu erledigen)\b/i.test(sentence)) continue;
    if (/\b(?:nicht|keine?|never|do not|don.t)\s+(?:(?:die|den|das|these|the)\s+)?(?:quiz\w*|test\w*)?\s*(?:bearbeit\w*|mach\w*|erledig\w*|start\w*|ausfüll\w*|ausfuell\w*|lös\w*|loes\w*|solve\w*|fill\w*|answer\w*|complete\w*)\b/i.test(sentence)) continue;
    return true;
  }
  return false;
}

export function isQuizDiscoveryIntent(prompt: string): boolean {
  const discoveryAction = /\b(?:find|list|scan|look through|show|search|discover|available|attemptable|still open|currently open|offen|verfügbar|verfuegbar|durchsuch|auflist|anzeig|finde|suche)\w*\b/i;
  return QUIZ_NOUN.test(prompt) && discoveryAction.test(prompt);
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
