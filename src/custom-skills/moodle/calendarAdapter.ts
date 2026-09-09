import { resolveTemporalRequest, temporalRange, type TemporalRequest } from "./temporalRequest.js";
import { writeFile } from "node:fs/promises";
import type { SupportedLanguage } from "../shared/languagePolicy.js";
import path from "node:path";
import ICAL from "ical.js";
import {
  extractCourseTargetHint,
  hasUnrecognizedNamedCourseTarget,
} from "./courseTargeting.js";
import { assertPublicHttpsUrl } from "./urlSecurity.js";
import { classifyObligationDiscovery } from "./obligationDiscovery.js";

export const CALENDAR_TIMEOUT_MS = 15_000;
export const CALENDAR_MAX_BYTES = 5 * 1024 * 1024;
export const CALENDAR_DEFAULT_HORIZON_DAYS = 400;
export const CALENDAR_MAX_EVENTS = 10;
export const CALENDAR_TIME_ZONE = "Europe/Vienna";

export interface CalendarEvent {
  source: "calendar_event";
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  recurring: boolean;
}

export interface CalendarSelection {
  status: "success" | "empty" | "failed";
  events: CalendarEvent[];
  complete: boolean;
  missingFields: string[];
  needsCisFallback: boolean;
  detail: string;
  requestedRange?: { start: string; end: string };
  totalMatches?: number;
  truncated?: boolean;
}

export interface CalendarAdapterOptions {
  now?: Date;
  temporalRequest?: TemporalRequest;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

const COURSE_ALIASES: Record<string, string[]> = {
  MEL: ["mel", "mel1", "maschinenelemente", "maschinenelemente 1"],
  DYN2: ["dyn2", "anwendungen der dynamik"],
  PHDYN: ["phdyn", "physikalische grundlagen der dynamik"],
  MAES2: ["maes2", "mathematik für engineering science 2", "mathematik"],
  ETLB2: ["etlb2", "elektrotechnik labor 2"],
  TEZEI: ["tezei", "technisches zeichnen", "grundlagen des technischen zeichnens"],
};

const EXAM_SIGNAL = /\b(?:prüfung|pruefung|test|exam|klausur)\b/i;
const ADMIN_SIGNAL =
  /\b(?:anwesenheit|attendance|lv-info|lv information|lehrveranstaltungsinformation|administrativ|ects|lehrende|dozent|syllabus)\b/i;
const SCHEDULE_SIGNAL =
  /\b(?:termin|prüfung|pruefung|test|exam|klausur|uhrzeit|raum|räume|raeume|wann|wo|heute|morgen|diese woche|nächste[rsn]? woche|naechste[rsn]? woche|kommende[rsn]? woche|next week|nächste[rsn]? termin|naechste[rsn]? termin|deadline|frist|stundenplan|schedule|timetable|today|tomorrow|room)\b/i;
const MATERIAL_SIGNAL =
  /\b(?:moodle|unterlagen|kursmaterial|folie|folien|skript|pdf|datei|lernzettel|formelsammlung|übungsblatt|uebungsblatt|quiz|assignment|aufgabenstellung|fachlabor|laborinhalt)\b|was machen wir|what are we doing/i;

export function isCalendarRequest(prompt: string): boolean {
  return SCHEDULE_SIGNAL.test(prompt);
}

export function requiresCisDirectly(prompt: string): boolean {
  return ADMIN_SIGNAL.test(prompt);
}

export function isPureScheduleRequest(prompt: string): boolean {
  return isCalendarRequest(prompt) && !MATERIAL_SIGNAL.test(prompt) && !requiresCisDirectly(prompt);
}

export async function readCalendarEvents(
  calendarUrl: string,
  prompt: string,
  options: CalendarAdapterOptions = {},
): Promise<CalendarSelection> {
  const now = options.now ?? (options.temporalRequest ? new Date(options.temporalRequest.resolvedAt) : new Date());
  try {
    const normalizedUrl = normalizeCalendarUrl(calendarUrl);
    const ics = await fetchCalendarText(normalizedUrl, options);
    const parsedEvents = parseCalendarEvents(ics, now);
    const allMatches = filterCalendarEvents(parsedEvents, prompt, now, false, options.temporalRequest);
    const exhaustive = classifyObligationDiscovery(prompt).exhaustive;
    const events = exhaustive ? allMatches : allMatches.slice(0, CALENDAR_MAX_EVENTS);
    const range = options.temporalRequest ? temporalRange(options.temporalRequest) : resolveRequestedTimeRange(prompt, now);
    const truncated = events.length < allMatches.length;
    const missingFields = requiredMissingFields(prompt, events[0]);
    const complete = events.length > 0 && missingFields.length === 0;
    return {
      status: events.length > 0 ? "success" : "empty",
      events,
      complete: complete && !truncated,
      missingFields,
      needsCisFallback: !complete || truncated,
      detail: events.length > 0
        ? `Selected ${events.length} relevant calendar event(s)${truncated ? ` of ${allMatches.length}` : ""}.`
        : "Calendar was readable, but no matching event was found.",
      requestedRange: { start: range.start.toISOString(), end: range.end.toISOString() },
      totalMatches: allMatches.length,
      truncated,
    };
  } catch (error) {
    return {
      status: "failed",
      events: [],
      complete: false,
      missingFields: [],
      needsCisFallback: true,
      detail: safeCalendarError(error),
    };
  }
}

export function normalizeCalendarUrl(value: string): string {
  const trimmed = value.trim();
  const httpsValue = trimmed.replace(/^webcal:\/\//i, "https://");
  const parsed = new URL(httpsValue);
  if (parsed.protocol !== "https:") {
    throw new Error("Calendar feed must use HTTPS or webcal.");
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

export async function fetchCalendarText(
  url: string,
  options: CalendarAdapterOptions = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CALENDAR_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? CALENDAR_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = normalizeCalendarUrl(url);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await assertPublicHttpsUrl(
        currentUrl,
        options.resolveHostname ?? (options.fetchImpl ? async () => ["8.8.8.8"] : undefined),
      );
      const response = await fetchImpl(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { accept: "text/calendar, text/plain;q=0.9" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) {
          throw new Error("Calendar feed redirect could not be followed.");
        }
        currentUrl = normalizeCalendarUrl(new URL(location, currentUrl).toString());
        continue;
      }
      if (!response.ok) {
        throw new Error(`Calendar feed request failed with HTTP ${response.status}.`);
      }
      const declaredLength = Number(response.headers.get("content-length") || "0");
      if (declaredLength > maxBytes) {
        throw new Error("Calendar feed exceeds the 5 MiB limit.");
      }
      if (!response.body) {
        throw new Error("Calendar feed response has no body.");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error("Calendar feed exceeds the 5 MiB limit.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    }
    throw new Error("Calendar feed redirect limit exceeded.");
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Calendar feed request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseCalendarEvents(
  ics: string,
  now = new Date(),
  horizonDays = CALENDAR_DEFAULT_HORIZON_DAYS,
): CalendarEvent[] {
  let calendar: InstanceType<typeof ICAL.Component>;
  try {
    calendar = new ICAL.Component(ICAL.parse(ics));
  } catch {
    throw new Error("Calendar feed is not valid iCalendar data.");
  }
  if (calendar.name !== "vcalendar") {
    throw new Error("Calendar feed does not contain a VCALENDAR.");
  }

  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const components = calendar.getAllSubcomponents("vevent");
  const masters = components
    .map((component) => new ICAL.Event(component))
    .filter((event) => !event.isRecurrenceException());
  const result: CalendarEvent[] = [];

  for (const event of masters) {
    if (isCancelled(event)) continue;
    if (!event.isRecurring()) {
      pushOccurrence(result, event, event.startDate, event.endDate, false, windowStart, windowEnd);
      continue;
    }
    const iterator = event.iterator();
    let occurrence: InstanceType<typeof ICAL.Time> | null;
    let safety = 0;
    while ((occurrence = iterator.next()) && safety < 20_000) {
      safety += 1;
      const details = event.getOccurrenceDetails(occurrence);
      const occurrenceStart = details.startDate.toJSDate();
      if (occurrenceStart > windowEnd) break;
      if (isCancelled(details.item)) continue;
      pushOccurrence(
        result,
        details.item,
        details.startDate,
        details.endDate,
        true,
        windowStart,
        windowEnd,
      );
    }
  }

  return deduplicateEvents(result).sort(compareEvents);
}

export function filterCalendarEvents(
  events: CalendarEvent[],
  prompt: string,
  now = new Date(),
  applyLimit = true,
  request?: TemporalRequest,
): CalendarEvent[] {
  const timeRange = request ? temporalRange(request) : resolveRequestedTimeRange(prompt, now);
  const courseTerms = requestedCourseTerms(prompt);
  const examOnly = EXAM_SIGNAL.test(prompt);

  if (courseTerms.length === 0 && hasUnrecognizedNamedCourseTarget(prompt)) {
    return [];
  }

  const selected = events
    .filter((event) => {
      const start = new Date(event.start);
      return start >= timeRange.start && start <= timeRange.end;
    })
    .filter((event) => courseTerms.length === 0 || courseTerms.some((term) => eventText(event).includes(term)))
    .filter((event) => !examOnly || EXAM_SIGNAL.test(eventText(event)))
    .sort(compareEvents);
  return applyLimit ? selected.slice(0, CALENDAR_MAX_EVENTS) : selected;
}

export function formatCalendarEventsForWorkflow(events: CalendarEvent[]): string {
  if (events.length === 0) return "";
  return events.map((event) => [
    "[Calendar event]",
    `Source kind: ${event.source}`,
    `Title: ${event.title}`,
    `Start: ${event.start}`,
    `End: ${event.end}`,
    `All day: ${event.allDay ? "yes" : "no"}`,
    event.location ? `Location: ${event.location}` : "",
    event.description ? `Description: ${event.description}` : "",
    `Recurring: ${event.recurring ? "yes" : "no"}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export function formatCalendarAnswer(
  events: CalendarEvent[],
  language: SupportedLanguage = "de",
): string {
  if (events.length === 0) {
    return language === "en"
      ? "No matching event was found in the personal university calendar."
      : "Kein passender Termin im persönlichen Uni-Kalender gefunden.";
  }
  return events.map((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const date = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-AT", {
      timeZone: CALENDAR_TIME_ZONE,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(start);
    const time = event.allDay
      ? language === "en" ? "all day" : "ganztägig"
      : language === "en"
        ? `${formatTime(start)}–${formatTime(end)}`
        : `${formatTime(start)}–${formatTime(end)} Uhr`;
    return `${event.title}: ${date}, ${time}${event.location ? `, ${event.location}` : ""}`;
  }).join("\n");
}

export async function writeFilteredCalendarArtifact(
  runDir: string,
  events: CalendarEvent[],
): Promise<string> {
  const artifactPath = path.join(runDir, "calendar-events.json");
  await writeFile(artifactPath, `${JSON.stringify(events, null, 2)}\n`, "utf8");
  return artifactPath;
}

function pushOccurrence(
  target: CalendarEvent[],
  event: InstanceType<typeof ICAL.Event>,
  startTime: InstanceType<typeof ICAL.Time>,
  endTime: InstanceType<typeof ICAL.Time>,
  recurring: boolean,
  windowStart: Date,
  windowEnd: Date,
): void {
  const start = startTime.toJSDate();
  const end = endTime.toJSDate();
  if (end < windowStart || start > windowEnd) return;
  const title = event.summary?.trim() || "Termin";
  target.push({
    source: "calendar_event",
    uid: event.uid || `${title}-${start.toISOString()}`,
    title,
    ...(event.description?.trim() ? { description: event.description.trim() } : {}),
    ...(event.location?.trim() ? { location: event.location.trim() } : {}),
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: startTime.isDate,
    recurring,
  });
}

function isCancelled(event: InstanceType<typeof ICAL.Event>): boolean {
  return String(event.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";
}

function requestedCourseTerms(prompt: string): string[] {
  const hint = extractCourseTargetHint(prompt);
  const terms = new Set<string>();
  for (const code of hint.requestedCodes) {
    terms.add(code.toLowerCase());
    for (const alias of COURSE_ALIASES[code] ?? []) terms.add(alias);
  }
  for (const name of hint.requestedNames) terms.add(name.toLowerCase());
  return [...terms];
}

export function resolveRequestedTimeRange(prompt: string, now: Date): { start: Date; end: Date } {
  return temporalRange(resolveTemporalRequest(prompt, now), CALENDAR_DEFAULT_HORIZON_DAYS);
}

function requiredMissingFields(prompt: string, event: CalendarEvent | undefined): string[] {
  if (!event) return [];
  const missing: string[] = [];
  if (!event.start) missing.push("date");
  if ((/\b(?:uhrzeit|time|wann)\b/i.test(prompt) || EXAM_SIGNAL.test(prompt)) && event.allDay) {
    missing.push("time");
  }
  if (/\b(?:raum|räume|raeume|room|wo)\b/i.test(prompt) && !event.location) missing.push("room");
  return missing;
}

function eventText(event: CalendarEvent): string {
  return `${event.title} ${event.description ?? ""} ${event.location ?? ""}`.toLowerCase();
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  return left.start.localeCompare(right.start) ||
    left.title.localeCompare(right.title, "de") ||
    left.uid.localeCompare(right.uid);
}

function deduplicateEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.uid}\0${event.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("de-AT", {
    timeZone: CALENDAR_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function safeCalendarError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:webcal|https):\/\/\S+/gi, "[redacted calendar URL]");
}
