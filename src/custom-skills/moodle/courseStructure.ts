export interface NumberedCourseTopic {
  number: number;
  title: string;
  overview: string;
  subtopics: string[];
  practiceLabels: string[];
}

interface TopicCandidate extends NumberedCourseTopic {
  score: number;
}

const TOPIC_HEADING =
  /^(?:#{1,6}\s*)?(?:THEMA|Thema|TOPIC|Topic)\s+(\d{1,2})\s*:\s*(.+?)\s*$/;

/**
 * Extracts the explicit numbered teaching sequence from Moodle page text.
 *
 * Moodle snapshots often repeat the navigation outline in German and English.
 * We keep the richest block for each number and require a contiguous sequence,
 * so a stray "Thema 2" inside a PDF cannot become the course architecture.
 */
export function extractNumberedCourseTopics(rawText: string): NumberedCourseTopic[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const headings = lines.flatMap((line, index) => {
    const match = TOPIC_HEADING.exec(line);
    return match
      ? [{ index, number: Number(match[1]), title: normalizeOfficialTitle(match[2]) }]
      : [];
  });
  const candidates = new Map<number, TopicCandidate[]>();
  for (const [headingIndex, heading] of headings.entries()) {
    const next = headings[headingIndex + 1]?.index ?? lines.length;
    const block = lines.slice(heading.index + 1, next);
    const candidate = topicCandidate(heading.number, heading.title, block);
    const values = candidates.get(heading.number) ?? [];
    values.push(candidate);
    candidates.set(heading.number, values);
  }

  const selected = [...candidates.entries()]
    .map(([number, values]) =>
      values.sort((left, right) => right.score - left.score)[0] ?? null
    )
    .filter((value): value is TopicCandidate => Boolean(value))
    .sort((left, right) => left.number - right.number);
  if (selected.length < 3) return [];
  const contiguous = selected.every((topic, index) =>
    topic.number === selected[0].number + index
  );
  if (!contiguous || selected[0].number !== 1) return [];
  return selected.map(({ score: _score, ...topic }) => topic);
}

function topicCandidate(
  number: number,
  title: string,
  block: string[],
): TopicCandidate {
  const overview = block.find((line) =>
    /(?:selbststudienphase|self-study phase|in dieser.*lernen|this session.*learn)/i.test(line)
  ) ?? "";
  const subtopics = unique(block
    .filter((line) =>
      /^\d{1,2}(?:\.\d{1,2})+\s+\S/.test(line) ||
      /^\d{1,2}\s+(?:Lineare|Separierbare|Richtungsfelder|Anwendungen|Linear|Separable|Direction fields|Applications)\b/i
        .test(line)
    )
    .map((line) =>
      line
        .replace(/,\s*(?:bis|ab|from|up to)\b.*$/i, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length >= 5 && line.length <= 180));
  const practiceLabels = unique(block
    .filter((line) =>
      new RegExp(
        `(?:Minitest|Mini-test|Übungsaufgaben|Uebungsaufgaben|Exercises?|Kreuzerliste|Kreuzerlliste).*?(?:Thema|Topic)?\\s*${number}\\b`,
        "i",
      ).test(line)
    )
    .map((line) => line.replace(/\s*\[[^\]]+\]\s*$/, "").trim())
    .filter((line) => line.length <= 180));
  const overviewBonus = overview ? Math.min(300, overview.length) : 0;
  return {
    number,
    title,
    overview,
    subtopics,
    practiceLabels,
    score: overviewBonus + subtopics.length * 120 + practiceLabels.length * 80,
  };
}

function normalizeOfficialTitle(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned !== cleaned.toLocaleUpperCase("de")) return cleaned;
  const lowerWords = new Set([
    "und", "oder", "der", "die", "das", "des", "den", "dem",
    "erster", "ersten", "zweiter", "zweiten", "mit", "von", "zur",
  ]);
  return cleaned.toLocaleLowerCase("de").replace(
    /(^|[\s:–-])([\p{L}])/gu,
    (match, prefix: string, letter: string, offset: number) => {
      const rest = cleaned.toLocaleLowerCase("de").slice(offset + prefix.length);
      const word = rest.match(/^[\p{L}]+/u)?.[0] ?? "";
      if (offset > 0 && lowerWords.has(word)) return `${prefix}${letter}`;
      return `${prefix}${letter.toLocaleUpperCase("de")}`;
    },
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
