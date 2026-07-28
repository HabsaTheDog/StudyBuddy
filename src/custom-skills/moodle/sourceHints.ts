import { extractCourseTargetHint, rawTextContainsRequestedCourse } from "./courseTargeting.js";

export function resolveVerifiedMoodleSource(_prompt: string, requestedUrl: string): string {
  // Course discovery owns dashboard-to-course resolution. Keeping a
  // site/course-specific redirect table here made an otherwise portable
  // Moodle pipeline silently jump to one institution's course.
  return requestedUrl;
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
