/** One immutable time boundary shared by calendar, acquisition and quiz selection. */
export interface TemporalRequest {
  readonly resolvedAt: string;
  readonly timeZone: string;
  readonly status: "none" | "resolved" | "unresolved";
  readonly relation: "on" | "until" | "range";
  readonly start?: string;
  readonly end?: string;
  readonly reason?: string;
}

export const DEFAULT_STUDY_TIME_ZONE = "Europe/Vienna";

export function resolveTemporalRequest(
  prompt: string,
  now = new Date(),
  timeZone = DEFAULT_STUDY_TIME_ZONE,
): TemporalRequest {
  const months = ["jan(?:uar|uary)?|jänner|jaenner", "feb(?:ruar|ruary)?", "märz|maerz|march|mar|mär", "apr(?:il)?", "mai|may", "jun(?:i|e)?", "jul(?:i|y)?", "aug(?:ust)?", "sep(?:tember|t)?", "okt(?:ober)?|oct(?:ober)?", "nov(?:ember)?", "dez(?:ember)?|dec(?:ember)?"];
  // Explicit ranges may share a month/year: "vom 8. bis 9. September".
  // Expand the omitted suffix before validating dates; never infer it for
  // unrelated numbers or silently drop the first endpoint.
  const rangePrefix = "(\\b(?:vom|von|zwischen|from|between)\\s+)(\\d{1,2})\\.?\\s+((?:bis|und|to|and)(?:\\s+(?:einschließlich|including))?\\s+)(\\d{1,2})";
  const text = prompt.toLocaleLowerCase("de")
    .replace(new RegExp(`${rangePrefix}\\.?(\\s*(?:${months.join("|")})\\.?(?:\\s+\\d{4})?\\b)`, "g"), "$1$2.$5 $3$4.$5")
    .replace(new RegExp(`${rangePrefix}(\\.\\d{1,2}\\.(?:\\d{4}\\b)?)`, "g"), "$1$2$5 $3$4$5");
  const today = dateKey(now, timeZone);
  let until = /\b(?:bis(?:\s+einschließlich)?|spätestens|spaetestens|nicht später als|no later than|until|through|up to)\b/i.test(text);
  const bindDeadline = (position: number) => {
    // "by" must introduce the parsed date, not an author elsewhere in the prompt.
    if (/\bby\s+(?:(?:the\s+)?end\s+of\s+)?(?:the\s+)?$/.test(text.slice(0, position))) until = true;
  };
  const base = { resolvedAt: now.toISOString(), timeZone, relation: until ? "until" as const : "on" as const };
  const resolved = (first: string, last = first): TemporalRequest => Object.freeze({
    ...base, status: "resolved", relation: until ? "until" : first === last ? "on" : "range",
    start: zonedMidnight(until ? today : first, timeZone).toISOString(),
    end: new Date(zonedMidnight(addDays(last, 1), timeZone).getTime() - 1).toISOString(),
  });
  const invalid = (reason: string): TemporalRequest => Object.freeze({ ...base, status: "unresolved", reason });
  const dates: Array<{ key: string; position: number }> = [];
  const year = Number(today.slice(0, 4));
  const addDate = (y: number, m: number, d: number, position: number) => {
    const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== key) return false;
    bindDeadline(position);
    dates.push({ key, position }); return true;
  };
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    if (!addDate(+match[1], +match[2], +match[3], match.index!)) return invalid("Invalid calendar date");
  }
  for (const match of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(?:(\d{4})\b)?/g)) {
    if (!addDate(match[3] ? +match[3] : year, +match[2], +match[1], match.index!)) return invalid("Invalid calendar date");
  }
  for (const [index, names] of months.entries()) {
    const patterns = [
      new RegExp(`\\b(\\d{1,2})\\.?\\s*(?:${names})\\.?(?:\\s+(\\d{4}))?\\b`, "g"),
      new RegExp(`\\b(?:${names})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "g"),
    ];
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
      if (!addDate(match[2] ? +match[2] : year, index + 1, +match[1], match.index!)) return invalid("Invalid calendar date");
    }
  }
  const relative = /\b(?:übermorgen|uebermorgen|day after tomorrow)\b/.test(text) ? addDays(today, 2)
    : /\b(?:morgen|morgig\w*|tomorrow)\b/.test(text) ? addDays(today, 1)
    : /\b(?:heute|heutig\w*|today)\b/.test(text) ? today : null;
  if (relative) {
    const match = text.match(/\b(?:übermorgen|uebermorgen|day after tomorrow|morgen|morgig\w*|tomorrow|heute|heutig\w*|today)\b/);
    if (match) bindDeadline(match.index!);
  }
  const unique = [...new Set(dates.sort((a, b) => a.position - b.position).map(d => d.key))];
  if (unique.length > 1) {
    if (/\b(?:vom|von|zwischen|from|between)\b/.test(text) && /\b(?:bis|und|to|and)\b/.test(text) && unique[0] <= unique[1] && unique.length === 2) {
      const range = resolved(unique[0], unique[1]);
      return Object.freeze({ ...range, relation: "range", start: zonedMidnight(unique[0], timeZone).toISOString() });
    }
    return invalid("Multiple conflicting dates");
  }
  if (unique.length) {
    if (relative && relative !== unique[0]) return invalid("Relative and absolute dates disagree");
    return resolved(unique[0]);
  }
  if (relative) return resolved(relative);
  if (/\b(?:diese[rsn]? woche|this week|nächste[rsn]? woche|naechste[rsn]? woche|kommende[rsn]? woche|next week)\b/.test(text)) {
    const day = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const next = /nächste|naechste|kommende|next/.test(text) ? 7 : 0;
    const monday = addDays(today, 1 - day + next);
    const match = text.match(/\b(?:this week|next week)\b/);
    if (match) bindDeadline(match.index!);
    return resolved(monday, addDays(monday, 6));
  }
  if (/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
    const names = ["sonntag|sunday", "montag|monday", "dienstag|tuesday", "mittwoch|wednesday", "donnerstag|thursday", "freitag|friday", "samstag|saturday"];
    const wanted = names.findIndex(name => new RegExp(`\\b(?:${name})\\b`).test(text));
    const match = text.match(new RegExp(`\\b(?:(?:next|this)\\s+)?(?:${names[wanted]})\\b`));
    if (match) bindDeadline(match.index!);
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    let delta = (wanted - day + 7) % 7;
    if (delta === 0 && /nächste|naechste|next/.test(text)) delta = 7;
    return resolved(addDays(today, delta));
  }
  return Object.freeze({ ...base, status: "none" });
}

export function requestTimeBoundary(original: string, operational: string, now = new Date()): TemporalRequest {
  const originalTime = resolveTemporalRequest(original, now);
  return originalTime.status !== "none" ? originalTime : resolveTemporalRequest(operational, now);
}

export function temporalRange(request: TemporalRequest, horizonDays = 400): { start: Date; end: Date } {
  if (request.status === "unresolved") throw new Error(`Unresolved request date: ${request.reason}`);
  return request.status === "resolved"
    ? { start: new Date(request.start!), end: new Date(request.end!) }
    : { start: new Date(request.resolvedAt), end: new Date(new Date(request.resolvedAt).getTime() + horizonDays * 86_400_000) };
}

export function timestampMatchesRequest(value: string | null | undefined, request: TemporalRequest): boolean {
  if (!value || request.status !== "resolved") return false;
  const stamp = Date.parse(value);
  return stamp >= Date.parse(request.start!) && stamp <= Date.parse(request.end!);
}

function dateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedMidnight(key: string, timeZone: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    guess += target - Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  }
  return new Date(guess);
}
