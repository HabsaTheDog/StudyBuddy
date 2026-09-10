export type ObligationScope = "targeted" | "all_relevant";

export interface ObligationDiscoveryIntent {
  requested: boolean;
  temporal: boolean;
  exhaustive: boolean;
  deep: boolean;
  calendarFirst: boolean;
  scope: ObligationScope;
}

export interface ObligationCourseResolution {
  selectedUrls: string[];
  unmatchedHints: string[];
}

const OBLIGATION_SIGNAL = /\b(?:haus(?:ü|ue)bung(?:en)?|homework|assignments?|aufgaben?|to[- ]?dos?|abgaben?|submission(?:s)?|erledigen|machen\s+muss|machen\s+soll)\b/i;
const PREPARATION_QUESTION = /\b(?:what|which)\s+(?:(?:do|should|must)\s+i|i\s+(?:must|should|need\s+to|have\s+to))\s+(?:(?:need|have)\s+to\s+)?(?:prepare|complete)\b|\bwas\s+(?:muss|soll)\s+ich\b[^.!?]{0,48}\bvorbereiten\b/i;
const DUE_LIST_SIGNAL = /\b(?:was|welche[rsn]?|what|which)\b.{0,48}\b(?:fällig|faellig|due)\b/i;
const TEMPORAL_SIGNAL = /\b(?:heute|morgen|diese[rsn]?\s+woche|nächste[rsn]?\s+woche|naechste[rsn]?\s+woche|kommende[rsn]?\s+woche|today|tomorrow|this\s+week|next\s+week|deadline|frist|fällig|faellig|due)\b/i;
const EXHAUSTIVE_SIGNAL = /\b(?:alles|alle[rsn]?|sämtliche[rsn]?|saemtliche[rsn]?|vollständig(?:e[rsn]?)?|vollstaendig(?:e[rsn]?)?|wirklich\s+alles|everything|all|complete(?:ly)?|every\s+course)\b/i;
const DEEP_SIGNAL = /\b(?:tiefer|gründlich|gruendlich|alle[rsn]?\s+(?:kursseiten|abschnitte|aktivitäten|aktivitaeten)|vollständig|vollstaendig|details?|anforderungen?|deep(?:ly)?|thorough(?:ly)?|all\s+(?:course\s+pages|sections|activities))\b/i;
const NAMED_COURSE_SIGNAL = /\b(?:kurs|course|fach|modul)\s+(?:["“„'][^"”’']+["”’']|[A-ZÄÖÜ][\p{L}\d_-]{1,})/iu;

/** Generic policy classifier; it intentionally knows no institution or course names. */
export function classifyObligationDiscovery(prompt: string): ObligationDiscoveryIntent {
  // Redundant semantic signals tolerate typos in one noun without fuzzy course matching.
  const listQuestion = /\b(?:welche\w*|was|alle\w*|what|which|all|list|show|zeige\w*)\b/i.test(prompt);
  const gradedOrDue = /\b(?:benotet\w*|bewertet\w*|graded|deadlines?|frist\w*|abgeben|fällig|faellig|due)\b/i.test(prompt);
  const requested = OBLIGATION_SIGNAL.test(prompt) || PREPARATION_QUESTION.test(prompt) || DUE_LIST_SIGNAL.test(prompt) ||
    (listQuestion && gradedOrDue && !/\/mod\/(?:assign|quiz)\/view\.php/.test(prompt));
  const temporal = requested && TEMPORAL_SIGNAL.test(prompt);
  const namedCourse = requested && (NAMED_COURSE_SIGNAL.test(prompt) || /\/mod\/(?:assign|quiz)\/view\.php/.test(prompt));
  const exhaustive = requested && (EXHAUSTIVE_SIGNAL.test(prompt) || !namedCourse);
  return {
    requested,
    temporal,
    exhaustive,
    deep: requested && (DEEP_SIGNAL.test(prompt) || exhaustive),
    calendarFirst: requested && temporal,
    scope: namedCourse && !exhaustive ? "targeted" : "all_relevant",
  };
}

export function isObligationActivityLink(link: { href: string; label?: string }): boolean {
  let pathname = "";
  try {
    pathname = new URL(link.href).pathname;
  } catch {
    return false;
  }
  if (/\/mod\/(?:assign|workshop|choice|feedback|checklist)\/view\.php$/i.test(pathname)) {
    return true;
  }
  // A quiz landing page is safe to read. Attempt/review actions remain blocked
  // by the existing quiz permission policy in the scraper.
  if (/\/mod\/quiz\/view\.php$/i.test(pathname)) return true;
  return /\b(?:haus(?:ü|ue)bung|homework|assignment|aufgabe|abgabe|submission|deadline|fällig|faellig|due|vorbereitung|prepare|pflicht|task|to[- ]?do)\b/i
    .test(link.label ?? "");
}

/** Resolve every calendar course hint independently; unmatched hints remain explicit gaps. */
export function resolveObligationCoursesFromCalendar(
  links: Array<{ href: string; label: string }>,
  hints: string[],
): ObligationCourseResolution {
  const uniqueCourses = new Map<string, { href: string; label: string }>();
  for (const link of links) {
    const identity = courseIdentity(link.href);
    if (!identity) continue;
    const current = uniqueCourses.get(identity);
    if (!current || link.label.length > current.label.length) {
      uniqueCourses.set(identity, { ...link, href: identity });
    }
  }
  const courses = [...uniqueCourses.values()];
  const documentFrequency = new Map<string, number>();
  const courseTokens = courses.map((course) => {
    const tokens = new Set(courseMatchTokens(course.label));
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    return { course, tokens };
  });
  const selected = new Set<string>();
  const unmatchedHints: string[] = [];
  for (const hint of [...new Set(hints.map((value) => value.trim()).filter(Boolean))]) {
    const tokens = courseMatchTokens(hint);
    const ranked = courseTokens
      .map(({ course, tokens: labelTokens }) => ({
        course,
        score: tokens.reduce((sum, token) => {
          if (!labelTokens.has(token)) return sum;
          const frequency = documentFrequency.get(token) ?? courses.length;
          return sum + (frequency === 1 ? 5 : frequency <= 3 ? 2 : 0.25);
        }, 0),
      }))
      .sort((left, right) => right.score - left.score);
    if (ranked[0] && ranked[0].score >= 2 && ranked[0].score > (ranked[1]?.score ?? 0)) {
      selected.add(ranked[0].course.href);
    } else {
      unmatchedHints.push(hint);
    }
  }
  return { selectedUrls: [...selected], unmatchedHints };
}

export function compactObligationRawSource(raw: string, maxCharacters: number): string {
  if (maxCharacters <= 0) return "";
  const blockMap = new Map<string, string>();
  for (const [index, block] of raw.split(/\n\n(?=\[(?:Moodle page|Calendar event)\])/g).entries()) {
    const sourceUrl = /^URL:\s*(\S+)/m.exec(block)?.[1];
    const key = sourceUrl ? normalizeObligationUrl(sourceUrl) : `block:${index}`;
    const current = blockMap.get(key);
    if (!current || block.length > current.length) blockMap.set(key, block);
  }
  const blocks = [...blockMap.values()];
  const obligationLine = /(?:haus(?:ü|ue)bung|homework|assignment|aufgabe|abgabe|submission|deadline|fällig|faellig|due|vorbereit|selbstcheck|screencast|lesen sie|arbeiten sie|lösen sie|loesen sie|machen sie|prüf|pruef|test|termin|start:|end:)/i;
  const compacted = blocks.map((block, index) => {
    const lines = block.split("\n");
    const header = lines.slice(0, 4);
    const selected = new Set<number>();
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!obligationLine.test(lines[lineIndex])) continue;
      for (let offset = -1; offset <= 2; offset += 1) {
        const candidate = lineIndex + offset;
        if (candidate >= 4 && candidate < lines.length) selected.add(candidate);
      }
    }
    const body = [...selected].sort((left, right) => left - right).map((lineIndex) => lines[lineIndex]);
    const isCalendar = block.includes("[Calendar event]");
    const isAssignment = /\/mod\/(?:assign|workshop)\/view\.php/i.test(block);
    const isQuiz = /\/mod\/(?:quiz|feedback)\/view\.php/i.test(block);
    const isCourse = /\/course\/(?:view|section)\.php/i.test(block);
    const blockLimit = isCalendar ? 800 : isAssignment ? 1_500 : isQuiz ? 1_000 : isCourse ? 3_000 : 1_200;
    const excerpt = [...header, ...body].join("\n").slice(0, blockLimit);
    const score = (isAssignment ? 5_000 : isCalendar ? 4_000 : isCourse ? 3_000 : isQuiz ? 2_000 : 0) +
      body.length * 10 - index / 1_000;
    return { excerpt, score, index };
  }).filter((entry) => entry.excerpt.trim().length > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: typeof compacted = [];
  let used = 0;
  for (const entry of compacted) {
    if (used + entry.excerpt.length > maxCharacters && selected.length > 0) continue;
    selected.push(entry);
    used += entry.excerpt.length + 2;
    if (used >= maxCharacters) break;
  }
  return selected.sort((left, right) => left.index - right.index)
    .map((entry) => entry.excerpt)
    .join("\n\n")
    .slice(0, maxCharacters);
}

export function normalizeObligationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    const id = url.searchParams.get("id");
    if (id && /\/mod\/[^/]+\/view\.php$/i.test(url.pathname)) {
      url.search = "";
      url.searchParams.set("id", id);
      return url.toString();
    }
    for (const key of ["time", "forcedownload", "lang", "notifyeditingon", "rownum", "useridlistid", "action", "sesskey"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function courseMatchTokens(value: string): string[] {
  return [...new Set(
    value.toLocaleLowerCase("de")
      .replace(/[^a-z0-9äöüß]+/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
      .filter((token) => !/^(?:de|en|ilv|exa|ueb|hs|edv|vz|ws|ss|kurs|course|ihre|rolle|teilnehmerin|lektorin|lektorinnen)$/.test(token)),
  )];
}

function courseIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (!url.pathname.endsWith("/course/view.php")) return null;
    const id = url.searchParams.get("id");
    return id ? `${url.origin}${url.pathname}?id=${encodeURIComponent(id)}` : null;
  } catch {
    return null;
  }
}
