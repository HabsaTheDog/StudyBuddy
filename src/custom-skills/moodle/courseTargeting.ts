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

interface CourseAlias {
  code: string;
  aliases: string[];
}

const COURSE_ALIASES: CourseAlias[] = [
  { code: "MEL", aliases: ["MEL", "MEL1", "Maschinenelemente", "Maschinenelemente 1"] },
  { code: "DYN2", aliases: ["DYN2", "Anwendungen der Dynamik"] },
  { code: "PHDYN", aliases: ["PHDYN", "Physikalische Grundlagen der Dynamik"] },
  { code: "MAES2", aliases: ["MAES2", "Mathematik für Engineering Science 2"] },
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
      course.aliases.some((alias) => alias.length > 3 && textIncludesPhrase(prompt, alias))
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
  return [...new Set(codes.filter((code) => !GENERIC_CODE_STOPWORDS.has(code)))];
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

function textTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9äöüß]+/gi) ?? [];
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}
