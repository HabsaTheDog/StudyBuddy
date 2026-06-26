import { extractCourseTargetHint, rawTextContainsRequestedCourse } from "./courseTargeting.js";

const MOODLE_DASHBOARD_PATHS = new Set(["/", "/my", "/my/"]);

const VERIFIED_TOPIC_SOURCES = [
  {
    matches: (prompt: string) => isDcDcRequest(prompt),
    url: "https://moodle.technikum-wien.at/course/view.php?id=32320",
  },
];

export function resolveVerifiedMoodleSource(prompt: string, requestedUrl: string): string {
  const url = new URL(requestedUrl);
  if (!MOODLE_DASHBOARD_PATHS.has(url.pathname)) {
    return requestedUrl;
  }
  return VERIFIED_TOPIC_SOURCES.find((source) => source.matches(prompt))?.url ?? requestedUrl;
}

export function hasRequiredTopicEvidence(prompt: string, sourceText: string): boolean {
  const target = extractCourseTargetHint(prompt);
  if (target.requestedCodes.length > 0 || target.requestedNames.length > 0) {
    return rawTextContainsRequestedCourse(prompt, sourceText);
  }
  if (!isDcDcRequest(prompt)) {
    return true;
  }
  return /\b(?:dc[\s_-]?dc|dcdc|gleichspannungswandler|tiefsetzsteller|hochsetzsteller|buck|boost)\b/i
    .test(sourceText);
}

export function expectsDownloadedSourceEvidence(prompt: string): boolean {
  return /\b(?:pdfs?|folien?|slides?|slide\s*decks?|dateien?|files?|lernunterlagen|kursunterlagen|prüfungsrelevante\s+unterlagen|pruefungsrelevante\s+unterlagen|pruefungsunterlagen|prüfungsunterlagen|materialien|unterlagen\w*|\w*unterlagen|skripten?|worksheet|arbeitsblatt|vorlage|template|herunterlad\w*|download\w*|screenshots?)\b/i
    .test(prompt);
}

export function isDcDcRequest(prompt: string): boolean {
  return /\b(?:dc[\s_-]?dc|dcdc|gleichspannungswandler|tiefsetzsteller|hochsetzsteller|buck|boost)\b/i
    .test(prompt);
}
