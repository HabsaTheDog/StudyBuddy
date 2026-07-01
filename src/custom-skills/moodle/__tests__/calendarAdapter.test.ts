import { describe, expect, it, vi } from "vitest";
import {
  fetchCalendarText,
  filterCalendarEvents,
  normalizeCalendarUrl,
  parseCalendarEvents,
  readCalendarEvents,
} from "../calendarAdapter.js";

const NOW = new Date("2026-06-27T10:00:00.000Z");

describe("calendar adapter", () => {
  it("selects a MEL exam with Vienna summer time, time, and room", async () => {
    const selection = await readCalendarEvents(
      "webcal://calendar.example/private-token",
      "Wann und in welchem Raum ist die MEL1 Prüfung?",
      {
        now: NOW,
        fetchImpl: vi.fn(async () => response(calendar([
          event({
            uid: "mel-exam",
            start: "DTSTART;TZID=Europe/Vienna:20260701T090000",
            end: "DTEND;TZID=Europe/Vienna:20260701T103000",
            summary: "MEL1 Prüfung",
            location: "A1.01",
          }),
        ]))),
      },
    );

    expect(selection.complete).toBe(true);
    expect(selection.events).toHaveLength(1);
    expect(selection.events[0]).toMatchObject({
      source: "calendar_event",
      title: "MEL1 Prüfung",
      start: "2026-07-01T07:00:00.000Z",
      location: "A1.01",
    });
  });

  it("expands recurrences and applies EXDATE, changed exceptions, and cancellations", () => {
    const events = parseCalendarEvents(calendar([
      [
        "BEGIN:VEVENT",
        "UID:mel-series",
        "DTSTART;TZID=Europe/Vienna:20260701T090000",
        "DTEND;TZID=Europe/Vienna:20260701T100000",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;TZID=Europe/Vienna:20260708T090000",
        "SUMMARY:MEL1 Vorlesung",
        "LOCATION:B2.04",
        "END:VEVENT",
      ].join("\r\n"),
      [
        "BEGIN:VEVENT",
        "UID:mel-series",
        "RECURRENCE-ID;TZID=Europe/Vienna:20260715T090000",
        "DTSTART;TZID=Europe/Vienna:20260715T110000",
        "DTEND;TZID=Europe/Vienna:20260715T120000",
        "SUMMARY:MEL1 Vorlesung verschoben",
        "LOCATION:C3.01",
        "END:VEVENT",
      ].join("\r\n"),
      [
        "BEGIN:VEVENT",
        "UID:mel-series",
        "RECURRENCE-ID;TZID=Europe/Vienna:20260722T090000",
        "DTSTART;TZID=Europe/Vienna:20260722T090000",
        "DTEND;TZID=Europe/Vienna:20260722T100000",
        "STATUS:CANCELLED",
        "SUMMARY:MEL1 Vorlesung",
        "END:VEVENT",
      ].join("\r\n"),
    ]), NOW);

    expect(events.map((entry) => [entry.title, entry.start, entry.location])).toEqual([
      ["MEL1 Vorlesung", "2026-07-01T07:00:00.000Z", "B2.04"],
      ["MEL1 Vorlesung verschoben", "2026-07-15T09:00:00.000Z", "C3.01"],
    ]);
  });

  it("keeps all-day events but reports a missing explicitly requested time", async () => {
    const selection = await readCalendarEvents("https://calendar.example/token", "Wann ist der MEL Termin, welche Uhrzeit?", {
      now: NOW,
      fetchImpl: vi.fn(async () => response(calendar([
        event({
          uid: "all-day",
          start: "DTSTART;VALUE=DATE:20260702",
          end: "DTEND;VALUE=DATE:20260703",
          summary: "MEL1 Abgabefrist",
        }),
      ]))),
    });

    expect(selection.events[0]?.allDay).toBe(true);
    expect(selection.complete).toBe(false);
    expect(selection.missingFields).toEqual(["time"]);
    expect(selection.needsCisFallback).toBe(true);
  });

  it("filters relative periods and returns no more than ten events", () => {
    const events = Array.from({ length: 14 }, (_, index) => ({
      source: "calendar_event" as const,
      uid: String(index),
      title: `MEL1 Termin ${index}`,
      start: new Date(`2026-06-28T${String(index % 10).padStart(2, "0")}:00:00.000Z`).toISOString(),
      end: new Date(`2026-06-28T${String((index % 10) + 1).padStart(2, "0")}:00:00.000Z`).toISOString(),
      allDay: false,
      recurring: false,
    }));

    expect(filterCalendarEvents(events, "MEL1 morgen", NOW)).toHaveLength(10);
    expect(filterCalendarEvents(events, "MEL1 heute", NOW)).toHaveLength(0);
  });

  it("rejects invalid, oversized, and unreachable feeds without exposing their URL", async () => {
    await expect(fetchCalendarText("http://calendar.example/token")).rejects.toThrow("HTTPS");
    const invalid = await readCalendarEvents("https://calendar.example/token", "MEL Prüfung", {
      fetchImpl: vi.fn(async () => response("not an ical feed")),
    });
    expect(invalid.status).toBe("failed");
    await expect(fetchCalendarText("https://calendar.example/token", {
      fetchImpl: vi.fn(async () => response("x", {
        headers: { "content-length": String(5 * 1024 * 1024 + 1) },
      })),
    })).rejects.toThrow("5 MiB");

    const selection = await readCalendarEvents("https://calendar.example/private-token", "MEL Prüfung", {
      fetchImpl: vi.fn(async () => {
        throw new Error("network failed for https://calendar.example/private-token");
      }),
    });
    expect(selection.status).toBe("failed");
    expect(selection.detail).not.toContain("private-token");
  });

  it("normalizes webcal and preserves HTTPS", () => {
    expect(normalizeCalendarUrl("webcal://calendar.example/a")).toBe("https://calendar.example/a");
    expect(normalizeCalendarUrl("https://calendar.example/a")).toBe("https://calendar.example/a");
  });
});

function response(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

function event(input: {
  uid: string;
  start: string;
  end: string;
  summary: string;
  location?: string;
}): string {
  return [
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    input.start,
    input.end,
    `SUMMARY:${input.summary}`,
    input.location ? `LOCATION:${input.location}` : "",
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}

function calendar(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Study Buddy Test//EN",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Vienna",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
