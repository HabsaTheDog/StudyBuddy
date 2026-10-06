import { isExplicitQuizExecutionIntent, isQuizDiscoveryIntent, QUIZ_NOUN } from "../taskIntent.js";

export function isQuizPrompt(prompt: string): boolean {
  return isExplicitQuizExecutionIntent(prompt) || isQuizDiscoveryIntent(prompt) ||
    (QUIZ_NOUN.test(prompt) && /\b(?:review|inspect|anschauen|ansehen|prüfen|pruefen)\b/i.test(prompt));
}

export function promptWantsQuizAttempt(prompt: string): boolean {
  return isExplicitQuizExecutionIntent(prompt) &&
    !/\b(review|inspect|prüf|pruef|nur schauen)\b/i.test(prompt);
}

export function extractQuizUrl(prompt: string): string | null {
  return extractQuizUrls(prompt)[0] ?? null;
}

/** Only navigable landing/attempt pages; never start, review, or submit URLs. */
export function normalizeQuizUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const key = /\/mod\/quiz\/view\.php$/.test(url.pathname) ? "id"
      : /\/mod\/quiz\/attempt\.php$/.test(url.pathname) ? "attempt" : null;
    if (!key || !/^[1-9]\d*$/.test(url.searchParams.get(key) ?? "")) return null;
    const id = url.searchParams.get(key)!;
    url.hash = "";
    url.search = "";
    url.searchParams.set(key, id);
    return url.toString();
  } catch {
    return null;
  }
}

export function extractQuizUrls(prompt: string): string[] {
  const urls = [...prompt.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map(match => normalizeQuizUrl(match[0].replace(/[),.;!?\]}]+$/g, "")))
    .filter((url): url is string => url !== null);
  return [...new Set(urls)];
}

const ASSIGNMENT_TERMS = [
  "assignment",
  "submission",
  "abgabe",
  "aufgabe",
  "übungsabgabe",
  "uebungsabgabe",
];

const ASSIGNMENT_ACTION_TERMS = [
  "submit",
  "turn in",
  "upload",
  "abgeben",
  "einreichen",
  "hochladen",
  "füge",
  "fuege",
];

export function isAssignmentSubmissionPrompt(prompt: string): boolean {
  const lower = prompt.toLocaleLowerCase("de-AT");
  if (/\b(?:nichts?|nicht|keine?\w*|never|do not|don.t)\s+(?:abgeben|einreichen|hochladen|submit|upload)\b|\b(?:nur lesen|read.only)\b/i.test(lower)) return false;
  if (/\b(?:welche\w*|was|wann|what|which|when)\b/.test(lower) && /\b(?:muss|soll|fällig|faellig|due|need|have to)\b/.test(lower)) return false;
  return (ASSIGNMENT_TERMS.some(term => lower.includes(term)) || extractAssignmentUrl(prompt) !== null) &&
    ASSIGNMENT_ACTION_TERMS.some(term => new RegExp(`\\b${term}\\b`, "i").test(lower));
}

export function extractAssignmentUrl(prompt: string): string | null {
  for (const match of prompt.matchAll(/https?:\/\/\S+/gi)) {
    const url = match[0].replace(/[),.]+$/g, "");
    if (url.includes("/mod/assign/")) return url;
  }
  return null;
}
