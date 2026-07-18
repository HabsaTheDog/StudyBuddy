export type SupportedLanguage = "de" | "en";
export type OutputLanguagePreference = "auto" | SupportedLanguage;
export type LanguageResolutionReason = "explicit_option" | "explicit_prompt" | "prompt_language" | "fallback";

export interface OutputLanguageDecision {
  language: SupportedLanguage;
  reason: LanguageResolutionReason;
}

const ENGLISH_EXPLICIT = [
  /\b(?:in|into|auf)\s+english\b/i,
  /\benglish[- ]language\b/i,
  /\b(?:write|answer|respond|reply|output|artifact|document|pdf)\b.{0,32}\benglish\b/i,
];

const GERMAN_EXPLICIT = [
  /\b(?:auf|in)\s+(?:deutsch|german)\b/i,
  /\bgerman[- ]language\b/i,
  /\bdeutschsprachig(?:e|en|er|es)?\b/i,
  /\b(?:schreib|antworte|ausgabe|artefakt|dokument|pdf)\b.{0,32}\bdeutsch\b/i,
];

const ENGLISH_WORDS = new Set([
  "a", "about", "all", "an", "and", "answer", "are", "as", "at", "be", "build", "can",
  "chapter", "could", "course", "create", "detailed", "do", "document", "english", "exam",
  "explain", "for", "from", "generate", "guide", "how", "i", "in", "is", "it", "learn",
  "make", "me", "my", "notes", "of", "on", "pdf", "please", "prepare", "should", "study",
  "summarize", "summary", "the", "this", "to", "what", "with", "would", "you",
]);

const GERMAN_WORDS = new Set([
  "alle", "als", "antworte", "auf", "aus", "ausführlich", "bitte", "das", "dem", "den", "der",
  "deutsch", "die", "dies", "diese", "dieser", "dokument", "ein", "eine", "einen", "erkläre",
  "erstelle", "für", "generiere", "ich", "im", "in", "ist", "kapitel", "kann", "kurs", "lernzettel",
  "mach", "mein", "meine", "mit", "pdf", "prüfung", "schreibe", "soll", "über", "und", "von", "was",
  "wie", "wir", "zu", "zum", "zusammenfassung",
]);

export function resolveOutputLanguage(input: {
  prompt: string;
  preference?: OutputLanguagePreference;
  fallback?: SupportedLanguage;
}): OutputLanguageDecision {
  if (input.preference && input.preference !== "auto") {
    return { language: input.preference, reason: "explicit_option" };
  }

  const explicit = explicitPromptLanguage(input.prompt);
  if (explicit) {
    return { language: explicit, reason: "explicit_prompt" };
  }

  const detected = detectPromptLanguage(input.prompt);
  if (detected) {
    return { language: detected, reason: "prompt_language" };
  }

  return { language: input.fallback ?? "de", reason: "fallback" };
}

export function languageName(language: SupportedLanguage): "German" | "English" {
  return language === "en" ? "English" : "German";
}

function explicitPromptLanguage(prompt: string): SupportedLanguage | null {
  const english = ENGLISH_EXPLICIT.some((pattern) => pattern.test(prompt));
  const german = GERMAN_EXPLICIT.some((pattern) => pattern.test(prompt));
  if (english !== german) return english ? "en" : "de";
  return null;
}

function detectPromptLanguage(prompt: string): SupportedLanguage | null {
  const tokens = prompt
    .toLocaleLowerCase("de-AT")
    .normalize("NFKC")
    .match(/[a-zäöüß]+/g) ?? [];
  let english = 0;
  let german = 0;
  for (const token of tokens) {
    if (ENGLISH_WORDS.has(token)) english += 1;
    if (GERMAN_WORDS.has(token)) german += 1;
  }
  if (/[äöüß]/i.test(prompt)) german += 2;
  if (english === german) return null;
  return english > german ? "en" : "de";
}
