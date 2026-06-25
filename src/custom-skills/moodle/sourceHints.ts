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
  if (!isDcDcRequest(prompt)) {
    return true;
  }
  return /\b(?:dc[\s_-]?dc|dcdc|gleichspannungswandler|tiefsetzsteller|hochsetzsteller|buck|boost)\b/i
    .test(sourceText);
}

export function expectsDownloadedSourceEvidence(prompt: string): boolean {
  return /\b(?:pdfs?|folien?|slides?|slide\s*decks?|dateien?|files?|unterlagen|skripten?|worksheet|arbeitsblatt|vorlage|template|herunterlad\w*|download\w*|screenshots?)\b/i
    .test(prompt);
}

export function isDcDcRequest(prompt: string): boolean {
  return /\b(?:dc[\s_-]?dc|dcdc|gleichspannungswandler|tiefsetzsteller|hochsetzsteller|buck|boost)\b/i
    .test(prompt);
}
