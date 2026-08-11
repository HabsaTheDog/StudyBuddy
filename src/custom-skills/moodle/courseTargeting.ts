export interface CourseTargetHint {
  requestedCodes: string[];
  requestedNames: string[];
  canonicalLabel?: string;
}

export interface ResolvedCourseTarget {
  status: "resolved" | "ambiguous" | "not_found";
  requested: CourseTargetHint;
  selectedUrls: string[];
  matchedLabels: string[];
  warnings: string[];
}

export interface ResolvedCourseIdentity {
  title: string;
  url?: string;
  confidence: "high" | "medium" | "low" | "direct";
}

interface CourseAlias {
  code: string;
  aliases: string[];
  /** Subject stems that may appear inside German exam/course compounds. */
  compoundTerms?: string[];
}

const COURSE_ALIASES: CourseAlias[] = [
  { code: "MEL", aliases: ["MEL", "MEL1", "Maschinenelemente", "Maschinenelemente 1"], compoundTerms: ["maschinenelemente"] },
  { code: "DYN2", aliases: ["DYN2", "Anwendung der Dynamik", "Anwendungen der Dynamik"], compoundTerms: ["dynamik"] },
  { code: "PHDYN", aliases: ["PHDYN", "Physikalische Grundlagen der Dynamik"], compoundTerms: ["dynamik"] },
  { code: "MAES2", aliases: ["MAES", "MAES2", "Mathematik für Engineering Science 2"], compoundTerms: ["mathematik"] },
  { code: "ETLB2", aliases: ["ETLB2", "Elektrotechnik Labor 2"] },
  { code: "TEZEI", aliases: ["TEZEI", "Technisches Zeichnen", "Grundlagen des technischen Zeichnens"] },
];

const GENERIC_CODE_STOPWORDS = new Set(["PDF", "CIS", "URL", "FH", "LV", "SS", "WS", "DC"]);

export function extractCourseTargetHint(prompt: string): CourseTargetHint {
  const requestedCodes = explicitCourseCodesFromText(prompt);
  const requestedNames = new Set<string>();
  let canonicalLabel: string | undefined;

  for (const course of COURSE_ALIASES) {
    if (
      requestedCodes.includes(course.code) ||
      course.aliases.some((alias) =>
        alias.length > 3 &&
        textIncludesPhrase(prompt, alias) &&
        !mentionIsNegated(prompt, alias)
      ) ||
      course.compoundTerms?.some((term) =>
        textIncludesKnownCourseCompound(prompt, term) &&
        !mentionIsNegated(prompt, term)
      )
    ) {
      canonicalLabel ??= `${course.code} / ${course.aliases[course.aliases.length - 1]}`;
      for (const alias of course.aliases) {
        if (!/^[A-Z]{2,8}\d{0,3}$/.test(alias)) {
          requestedNames.add(alias);
        }
      }
      if (!requestedCodes.includes(course.code)) {
        requestedCodes.push(course.code);
      }
    }
  }

  return {
    requestedCodes: [...new Set(requestedCodes)],
    requestedNames: [...requestedNames],
    canonicalLabel,
  };
}

const COURSE_COMPOUND_SUFFIXES = [
  "prüfung",
  "pruefung",
  "klausur",
  "test",
  "kurs",
  "vorlesung",
];

function textIncludesKnownCourseCompound(text: string, subject: string): boolean {
  const normalizedSubject = subject.toLowerCase();
  return textTokens(text).some((token) =>
    COURSE_COMPOUND_SUFFIXES.some((suffix) => token === `${normalizedSubject}${suffix}`)
  );
}

/**
 * Resolve one requested course for an already acquired course corpus.
 *
 * Original user prompts may mention several courses ("compare MEL and
 * Dynamik"), while the normalized workflow prompt and Moodle evidence belong
 * to only one run. Prefer a requested code corroborated by the acquired
 * corpus, then the normalized single-course prompt, and only then an
 * unambiguous request-only code. A generic course word such as "Dynamik" may
 * identify a corpus candidate when exactly one known Moodle course matches it.
 */
export function resolveRequestedCourseCode(
  normalizedPrompt: string,
  originalPrompt = "",
  sourceText = "",
): string | undefined {
  const normalized = extractCourseTargetHint(normalizedPrompt);
  const original = extractCourseTargetHint(originalPrompt);
  const requestedCodes = [...new Set([
    ...normalized.requestedCodes,
    ...original.requestedCodes,
  ])];
  const sourceCodes = knownCourseCodesFromText(sourceText);

  const corroborated = requestedCodes.filter((code) => sourceCodes.includes(code));
  if (corroborated.length === 1) return corroborated[0];

  const requestText = `${normalizedPrompt}\n${originalPrompt}`;
  const inferredFromCorpus = sourceCodes.filter((code) => {
    const course = COURSE_ALIASES.find((entry) => entry.code === code);
    return course?.aliases.some((alias) =>
      courseIdentityTerms(alias).some((term) => textIncludesPhrase(requestText, term))
    );
  });
  if (inferredFromCorpus.length === 1) return inferredFromCorpus[0];

  if (normalized.requestedCodes.length === 1) {
    return normalized.requestedCodes[0];
  }
  if (requestedCodes.length === 1) {
    return requestedCodes[0];
  }
  return undefined;
}

export function extractResolvedCourseIdentity(sourceText: string): ResolvedCourseIdentity | undefined {
  const resolutionBlock = /\[Moodle course resolution\]([\s\S]*?)(?=\n\[|$)/i.exec(sourceText)?.[1] ?? "";
  const selected = /^Selected:\s*(.+)$/im.exec(resolutionBlock)?.[1]?.trim();
  const explicitTitle = /^Course title:\s*(.+)$/im.exec(resolutionBlock)?.[1]?.trim();
  const url = /^URL:\s*(https?:\/\/\S+)$/im.exec(resolutionBlock)?.[1]?.trim();
  const confidenceValue = /^Confidence:\s*(high|medium|low)$/im.exec(resolutionBlock)?.[1]
    ?.toLowerCase();
  if (selected && selected.toLowerCase() !== "none") {
    return {
      title: explicitTitle || selected,
      ...(url ? { url } : {}),
      confidence: confidenceValue === "high" || confidenceValue === "medium" || confidenceValue === "low"
        ? confidenceValue
        : "medium",
    };
  }

  // Evidence-first recovery stores the course-resolution record as compact
  // JSON. In that representation the originally line-oriented fields are
  // flattened into one `content` string, for example
  // "Selected: ... Course title: DYN2 – Anwendungen der Dynamik". Preserve
  // the canonical probed title instead of falling back to the short request
  // code during zero-crawl recovery.
  const compactCourseTitle = /\bCourse title:\s*(.+?)(?=\s+(?:URL|Confidence|Method):|["}\]]|$)/i
    .exec(sourceText)?.[1]?.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  const compactCourseUrl = /\bsourceUrl["']?\s*:\s*["'](https?:\/\/[^"']+)/i
    .exec(sourceText)?.[1]?.trim();
  if (compactCourseTitle) {
    return {
      title: compactCourseTitle,
      ...(compactCourseUrl ? { url: compactCourseUrl } : {}),
      confidence: "high",
    };
  }

  const evidenceSectionTitle = /["']section["']\s*:\s*["'](?:Course|Kurs)\s*:\s*([^|"']+?)(?:\s*\||["'])/i
    .exec(sourceText)?.[1]?.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  if (evidenceSectionTitle) {
    return {
      title: evidenceSectionTitle,
      ...(compactCourseUrl ? { url: compactCourseUrl } : {}),
      confidence: "high",
    };
  }

  const pageTitle = /^(?:Title:\s*)?(?:Course|Kurs)\s*:\s*([^|\n]+)(?:\s*\||$)/im
    .exec(sourceText)?.[1]?.replace(/\s+/g, " ").trim();
  return pageTitle
    ? { title: pageTitle, confidence: "direct" }
    : undefined;
}

export function resolveCourseTargetsFromLinks(
  prompt: string,
  links: Array<{ href: string; label: string }>,
): ResolvedCourseTarget {
  const requested = extractCourseTargetHint(prompt);
  if (requested.requestedCodes.length === 0 && requested.requestedNames.length === 0) {
    return {
      status: "not_found",
      requested,
      selectedUrls: [],
      matchedLabels: [],
      warnings: ["No specific course target was requested."],
    };
  }

  const scored = links
    .filter((link) => link.href.includes("/course/view.php"))
    .map((link) => ({ ...link, score: scoreCourseTargetLabel(link.label, requested) }))
    .filter((link) => link.score >= 900)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return {
      status: "not_found",
      requested,
      selectedUrls: [],
      matchedLabels: [],
      warnings: [`No Moodle course link matched ${requested.canonicalLabel ?? requested.requestedCodes.join(", ")}.`],
    };
  }

  const best = scored[0];
  const selected = scored.filter((link) => best.score - link.score < 300).slice(0, 4);
  return {
    status: selected.length > 1 ? "ambiguous" : "resolved",
    requested,
    selectedUrls: selected.map((link) => normalizeUrl(link.href)),
    matchedLabels: selected.map((link) => link.label),
    warnings: selected.length > 1 ? ["Multiple Moodle course links matched the requested target."] : [],
  };
}

export function rawTextContainsRequestedCourse(prompt: string, rawText: string): boolean {
  const hint = extractCourseTargetHint(prompt);
  if (hint.requestedCodes.length === 0 && hint.requestedNames.length === 0) {
    return true;
  }
  const rawTokens = new Set(textTokens(rawText));
  for (const code of hint.requestedCodes) {
    if (rawTokens.has(code.toLowerCase())) {
      return true;
    }
    const course = COURSE_ALIASES.find((entry) => entry.code === code);
    if (course?.aliases.some((alias) => textIncludesPhrase(rawText, alias))) {
      return true;
    }
  }
  return hint.requestedNames.some((name) => textIncludesPhrase(rawText, name));
}

export function explicitCourseCodesFromText(text: string): string[] {
  const codes = text.match(/\b[A-ZÄÖÜ]{2,8}\d{0,3}\b/g) ?? [];
  return [...new Set(codes.filter((code) =>
    !GENERIC_CODE_STOPWORDS.has(code) && !mentionIsNegated(text, code)
  ))];
}

/**
 * Identifies prompts that explicitly name a course but whose name/code is not
 * known yet. Calendar callers use this to avoid treating an unresolved course
 * request as a request for every upcoming exam.
 */
export function hasUnrecognizedNamedCourseTarget(prompt: string): boolean {
  const hint = extractCourseTargetHint(prompt);
  if (hint.requestedCodes.length > 0 || hint.requestedNames.length > 0) {
    return false;
  }

  return [
    /\b(?:kurs|course|lehrveranstaltung|fach)\s+(?:namens\s+)?["“”']?[\p{L}\p{N}]/iu,
    /\b(?:prüfung|pruefung|klausur|exam|test)\s+(?:für|fuer|zu|in|of|for)\s+(?:den\s+|die\s+|das\s+)?["“”']?[\p{L}\p{N}]/iu,
    /\b(?:für|fuer|for)\s+(?:den\s+|die\s+|das\s+)?(?:kurs|course|lehrveranstaltung|fach)\s+["“”']?[\p{L}\p{N}]/iu,
  ].some((pattern) => pattern.test(prompt));
}

export function scoreCourseTargetLabel(label: string, requested: CourseTargetHint): number {
  const labelTokens = new Set(textTokens(label));
  let score = 0;
  for (const code of requested.requestedCodes) {
    const lowerCode = code.toLowerCase();
    if (labelTokens.has(lowerCode)) {
      score += 1_500;
      continue;
    }
    if ([...labelTokens].some((token) => token.startsWith(lowerCode) && /\d$/.test(token))) {
      score += 1_400;
    }
  }
  for (const name of requested.requestedNames) {
    if (textIncludesPhrase(label, name)) {
      score += 1_200;
    }
  }
  return score;
}

function textIncludesPhrase(text: string, phrase: string): boolean {
  const textWords = textTokens(text);
  const phraseWords = textTokens(phrase);
  if (phraseWords.length === 0) {
    return false;
  }
  for (let index = 0; index <= textWords.length - phraseWords.length; index += 1) {
    if (phraseWords.every((word, offset) => textWords[index + offset] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Course prompts often contain an exclusion such as "Verwechsle MAES nicht
 * mit MEL". Treating the excluded course as a second positive target can make
 * an exact-but-wrong dashboard match beat the requested course. Keep the
 * heuristic deliberately local to the mention so ordinary negation elsewhere
 * in the prompt does not suppress a valid target.
 */
function mentionIsNegated(text: string, phrase: string): boolean {
  const textWords = textTokens(text);
  const phraseWords = textTokens(phrase);
  if (phraseWords.length === 0) return false;

  for (let index = 0; index <= textWords.length - phraseWords.length; index += 1) {
    if (!phraseWords.every((word, offset) => textWords[index + offset] === word)) continue;
    const prefix = textWords.slice(Math.max(0, index - 8), index);
    const last = prefix.at(-1) ?? "";
    const previous = prefix.at(-2) ?? "";
    const hasNegatingInstruction = prefix.some((word) =>
      ["nicht", "not", "never", "exclude", "excluding", "ohne"].includes(word) ||
      word.startsWith("kein")
    );
    const comparisonMarker = ["mit", "als", "with", "as"].includes(last);
    const directNegation = ["nicht", "not", "never", "ohne"].includes(last) || last.startsWith("kein");
    const pairedNegation = ["nicht", "not"].includes(previous) && comparisonMarker;
    if (directNegation || pairedNegation || (comparisonMarker && hasNegatingInstruction)) {
      return true;
    }
  }
  return false;
}

function textTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9äöüß]+/gi) ?? [];
}

function knownCourseCodesFromText(text: string): string[] {
  if (!text.trim()) return [];
  return COURSE_ALIASES
    .filter((course) =>
      textTokens(text).includes(course.code.toLowerCase()) ||
      course.aliases.some((alias) => alias.length > 3 && textIncludesPhrase(text, alias))
    )
    .map((course) => course.code);
}

function courseIdentityTerms(alias: string): string[] {
  const stopwords = new Set([
    "anwendung",
    "anwendungen",
    "der",
    "die",
    "des",
    "für",
    "grundlagen",
  ]);
  return textTokens(alias).filter((term) => term.length >= 4 && !stopwords.has(term));
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}
