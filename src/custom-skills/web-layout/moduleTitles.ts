export const MODULE_DISPLAY_TITLE_MAX = 64;

const modulePrefix = /^(self[- ]study|class|chapter|kapitel|unit|module|modul|theme|thema|lecture|vorlesung|week|woche|lesson|session)\s+[a-z0-9ivx.-]+\s*[:–—-]\s*/i;
const moduleLabel = /^(self[- ]study|class|chapter|kapitel|unit|module|modul|theme|thema|lecture|vorlesung|week|woche|lesson|session)\s+[a-z0-9ivx.-]+/i;

export function deriveModuleDisplayTitle(fullTitle: string): string {
  const normalized = normalizeSpace(fullTitle);
  const fragments = normalized
    .split(/\s+\+\s+/)
    .flatMap((part) => compactModulePart(part).split(/\s*[;,]\s*/))
    .map(compactModuleFragment)
    .map(normalizeSpace)
    .filter(Boolean);
  const distinct: string[] = [];
  const covered = new Set<string>();
  for (const fragment of fragments) {
    const tokens = meaningfulTokens(fragment);
    if (!tokens.length) continue;
    const duplicate = distinct.findIndex((candidate) => {
      const candidateTokens = meaningfulTokens(candidate);
      return candidateTokens.length === tokens.length &&
        candidateTokens.every((token) => tokens.includes(token));
    });
    if (duplicate >= 0) {
      if (fragment.length < distinct[duplicate]!.length) distinct[duplicate] = fragment;
      tokens.forEach((token) => covered.add(token));
      continue;
    }
    const words = fragment.split(/\s+/);
    while (words.length > 1 && covered.has(normalizeToken(words[0]!))) words.shift();
    const candidate = cleanJoinArtifacts(words.join(" "));
    if (!candidate || meaningfulTokens(candidate).every((token) => covered.has(token))) continue;
    distinct.push(candidate);
    meaningfulTokens(candidate).forEach((token) => covered.add(token));
  }
  const selected = (distinct.length ? distinct : [compactModulePart(normalized)]).slice(0, 4);
  const joined = selected.join(" · ");
  if (joined.length <= MODULE_DISPLAY_TITLE_MAX) return joined;
  if (selected.length === 1) return shortenWords(selected[0]!, MODULE_DISPLAY_TITLE_MAX, true);
  const separatorLength = 3 * (selected.length - 1);
  const perFragment = Math.max(13, Math.floor((MODULE_DISPLAY_TITLE_MAX - separatorLength) / selected.length));
  return selected
    .map((fragment) => shortenWords(fragment, perFragment, false))
    .filter(Boolean)
    .join(" · ")
    .slice(0, MODULE_DISPLAY_TITLE_MAX);
}

export function deriveModuleContextLabel(fullTitle: string): string {
  const labels = fullTitle
    .split(/\s+\+\s+/)
    .map((part) => normalizeSpace(part).match(moduleLabel)?.[0])
    .filter((value): value is string => Boolean(value));
  return [...new Set(labels)].join(" · ");
}

export function moduleDisplayTitlePreservesHierarchy(fullTitle: string, displayTitle: string): boolean {
  const sourceTokens = hierarchyTokens(deriveModuleDisplayTitle(fullTitle));
  if (sourceTokens.length === 0) return true;
  const displayTokens = hierarchyTokens(displayTitle);
  return sourceTokens.some((source) => displayTokens.some((display) =>
    source === display ||
    (Math.min(source.length, display.length) >= 5 && (source.includes(display) || display.includes(source)))
  ));
}

export function moduleNavigationLayout(
  modules: Array<{ title: string; displayTitle?: string }>,
): "compact" | "rail" {
  return modules.length > 6 || modules.some((module) =>
    module.title.length > 72 || (module.displayTitle ?? deriveModuleDisplayTitle(module.title)).length > 42
  )
    ? "rail"
    : "compact";
}

function compactModulePart(value: string): string {
  return cleanJoinArtifacts(normalizeSpace(value)
    .replace(modulePrefix, "")
    .replace(/\bpart\s*\([ivx\d]+\)/gi, "")
    .replace(/\s*\([ivx\d]+\)\s*$/i, "")
    .replace(/\b([A-ZÄÖÜ]{2,})\s*\([^)]{6,}\)/g, "$1")
    .replace(/^(?:the\s+)?presentation\s+of\s+/i, "")
    .replace(/^(?:providing|introduction\s+to|einführung\s+in)\s+/i, "")
    .replace(/\byour\b/gi, "")
    .replace(/\s+(?:and|und|&)\s+/gi, " & "));
}

function compactModuleFragment(value: string): string {
  return cleanJoinArtifacts(value
    .replace(/^(?:the\s+)?presentation\s+of\s+/i, "")
    .replace(/^(?:providing|introduction\s+to|einführung\s+in)\s+/i, ""));
}

function meaningfulTokens(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u)
    .map(normalizeToken)
    .filter((token) => token.length > 1 && !["the", "der", "die", "das", "of"].includes(token));
}

function hierarchyTokens(value: string): string[] {
  const structural = new Set([
    "self", "study", "class", "chapter", "kapitel", "unit", "module", "modul",
    "theme", "thema", "topic", "lecture", "vorlesung", "week", "woche", "lesson",
    "session", "part", "teil", "eigenstudium", "prasenz", "praesenz",
  ]);
  return meaningfulTokens(value)
    .filter((token) => !structural.has(token) && !/^\d+$|^[ivx]+$/.test(token));
}

function normalizeToken(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function shortenWords(value: string, maximum: number, mark: boolean): string {
  if (value.length <= maximum) return value;
  const suffix = mark ? "…" : "";
  const words = value.split(/\s+/);
  while (words.length > 1 && words.join(" ").length + suffix.length > maximum) words.pop();
  return cleanJoinArtifacts(`${words.join(" ")}${suffix}`);
}

function cleanJoinArtifacts(value: string): string {
  return normalizeSpace(value)
    .replace(/^(?:the|der|die|das)\s+/i, "")
    .replace(/(?:\s+[&·])+$|^[&·]\s+/g, "")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
