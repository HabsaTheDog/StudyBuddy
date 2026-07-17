import {
  explicitCourseCodesFromText,
  extractCourseTargetHint,
  rawTextContainsRequestedCourse,
} from "./courseTargeting.js";

export interface ScheduleEvidence {
  answer: string;
  complete: boolean;
  missing: string[];
}

const DATE_PATTERN = /(?:\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?=\D)|\b\d{1,2}[.]\d{1,2}[.](?:20)?\d{2}\b)/;
const TIME_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:[01]?\d|2[0-3])[.][0-5]\d\s*uhr\b/i;
const EXAM_PATTERN = /\b(?:prüfung|pruefung|klausur|exam|prüfungstermin|pruefungstermin|testtermin)\b/i;
const ROOM_PATTERN = /\b(?:raum|room|hörsaal|hoersaal|hs[_\s-]?[a-z0-9._-]+)\b/i;

export function extractScheduleEvidence(
  prompt: string,
  rawText: string,
  now = new Date(),
): ScheduleEvidence {
  const asksTime = /\b(?:uhrzeit|time|wann|prüfung|pruefung|exam)\b/i.test(prompt);
  const asksRoom = /\b(?:raum|room|wo)\b/i.test(prompt);
  const target = extractCourseTargetHint(prompt);
  const targetRequested = target.requestedCodes.length > 0 || target.requestedNames.length > 0;
  const candidates = sourceChunks(rawText).flatMap((chunk) => {
    const title = /^Title:\s*(.+)$/im.exec(chunk)?.[1]?.trim() ?? "";
    const titleMatchesTarget = targetRequested && rawTextContainsRequestedCourse(prompt, title);
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.flatMap((line, index) => {
      if (!DATE_PATTERN.test(line)) return [];
      const window = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 5));
      const text = window.filter(isAnswerLine).join(" · ");
      const conflictingCodes = explicitCourseCodesFromText(line)
        .filter((code) => !target.requestedCodes.includes(code));
      if (targetRequested && conflictingCodes.length > 0) return [];
      const windowMatchesTarget = !targetRequested || rawTextContainsRequestedCourse(prompt, text);
      if (targetRequested && !titleMatchesTarget && !windowMatchesTarget) return [];
      const date = firstDate(text);
      if (date && date.getTime() < startOfDay(now).getTime()) return [];
      const hasTime = TIME_PATTERN.test(text);
      const hasRoom = ROOM_PATTERN.test(text);
      const score = 50 +
        (titleMatchesTarget ? 80 : 0) +
        (windowMatchesTarget && targetRequested ? 100 : 0) +
        (EXAM_PATTERN.test(text) ? 40 : 0) +
        (hasTime ? 20 : 0) +
        (hasRoom ? 20 : 0);
      return [{ text, hasTime, hasRoom, score, date: date?.getTime() ?? Number.MAX_SAFE_INTEGER }];
    });
  }).sort((left, right) => right.score - left.score || left.date - right.date);

  const selected = candidates[0];
  if (!selected) {
    return {
      answer: "",
      complete: false,
      missing: [`${target.canonicalLabel ?? (target.requestedCodes.join(" / ") || "Target")} direct sources did not expose a future Prüfungstermin`],
    };
  }

  const missing = [
    ...(asksTime && !selected.hasTime ? ["Uhrzeit"] : []),
    ...(asksRoom && !selected.hasRoom ? ["Raum"] : []),
  ];
  return {
    answer: selected.text,
    complete: missing.length === 0,
    missing,
  };
}

function sourceChunks(rawText: string): string[] {
  return rawText
    .split(/(?=\[(?:Calendar event|Moodle page|CIS page|Linked file)\])/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function isAnswerLine(line: string): boolean {
  return !/^\[(?:Calendar event|Moodle page|CIS page|Linked file)\]$/i.test(line) &&
    !/^(?:URL|Saved path):/i.test(line);
}

function firstDate(text: string): Date | null {
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = /\b(\d{1,2})[.](\d{1,2})[.]((?:20)?\d{2})\b/.exec(text);
  if (!dmy) return null;
  const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  return new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
