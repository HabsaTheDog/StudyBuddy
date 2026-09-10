import { describe, expect, it } from "vitest";
import { requestTimeBoundary, resolveTemporalRequest, temporalRange } from "../temporalRequest.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { isAssignmentSubmissionPrompt } from "../interactive/quizIntent.js";

const now = new Date("2026-09-08T17:56:31Z");
describe("reported request boundaries", () => {
  it.each(["What room is the lecture on 15 September 2027 taught by Smith?", "By Smith: lecture on 15 September 2027"])("does not treat authorship as a deadline: %s", prompt => {
    expect(resolveTemporalRequest(prompt, now)).toMatchObject({ relation: "on", start: "2027-09-14T22:00:00.000Z", end: "2027-09-15T21:59:59.999Z" });
  });
  it.each(["by tomorrow, 9 September 2026", "by Wednesday", "by the end of this week"])("binds by to an actual relative date: %s", prompt => {
    expect(resolveTemporalRequest(prompt, now)).toMatchObject({ status: "resolved", relation: "until", start: "2026-09-07T22:00:00.000Z" });
  });
  it.each([
    "welche minitests und benoteten aufagebn muss ich alle bis morgen abgeben.",
    "Welche benoteten Aufgaben muss ich bis morgen abgeben?",
    "Which graded quizzes are due by tomorrow?",
  ])("recognizes obligation scope without depending on a single noun: %s", prompt => {
    expect(classifyStudyBuddyIntent({ prompt, stage: "all", diagnosticOnly: false, autoAnswer: false, includeCis: true, hasCisUrls: true, hasCalendarUrl: true }))
      .toMatchObject({ needsMoodle: true, obligationDiscovery: { requested: true, exhaustive: true } });
    expect(isAssignmentSubmissionPrompt(prompt)).toBe(false);
  });
  it("does not interpret a negated submission as an action", () => {
    expect(isAssignmentSubmissionPrompt("Finde die Abgabe bis einschließlich 9. September 2026. Nichts abgeben.")).toBe(false);
    expect(isAssignmentSubmissionPrompt("Lade die Datei zur Abgabe hoch und einreichen")).toBe(true);
  });
  it.each(["bis morgen", "bis einschließlich 9. September 2026", "by September 9, 2026", "bis 09.09.2026", "by 2026-09-09"])("keeps today's obligations in an inclusive deadline window: %s", prompt => {
    expect(resolveTemporalRequest(prompt, now)).toMatchObject({ status: "resolved", start: "2026-09-07T22:00:00.000Z", end: "2026-09-09T21:59:59.999Z", relation: "until" });
  });
  it("binds the original date across an operational rewrite", () => {
    const request = requestTimeBoundary("kannst du den morgigen minitest für mathe machen?", "bearbeite Quiz 2", now);
    expect(request).toMatchObject({ status: "resolved", start: "2026-09-08T22:00:00.000Z", end: "2026-09-09T21:59:59.999Z" });
    expect(Object.isFrozen(request)).toBe(true);
  });
  it.each(["23.Sep 2025", "23. Sep. 2025", "23 Sept 2025", "Sep. 23, 2025"])("parses source month abbreviations without changing the year: %s", value => {
    expect(resolveTemporalRequest(value, now)).toMatchObject({ status: "resolved", start: "2025-09-22T22:00:00.000Z", end: "2025-09-23T21:59:59.999Z" });
  });
  it.each([
    ["2026-03-28T12:00:00Z", "2026-03-28T23:00:00.000Z", "2026-03-29T21:59:59.999Z"],
    ["2026-10-24T12:00:00Z", "2026-10-24T22:00:00.000Z", "2026-10-25T22:59:59.999Z"],
  ])("uses local calendar days across DST: %s", (stamp, start, end) => {
    expect(resolveTemporalRequest("morgen", new Date(stamp))).toMatchObject({ start, end });
  });
  it("rejects invalid or conflicting dates instead of using a broad horizon", () => {
    for (const prompt of ["31.02.2026", "morgen, 15. September 2026"]) {
      const request = resolveTemporalRequest(prompt, now);
      expect(request.status).toBe("unresolved");
      expect(() => temporalRange(request)).toThrow("Unresolved request date");
    }
  });
});

it("treats spätestens morgen as an inclusive deadline window", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  expect(resolveTemporalRequest("Abgabe spätestens morgen", now)).toEqual(resolveTemporalRequest("Abgabe bis morgen", now));
});

it.each([
  'vom 8. bis einschließlich 9. September 2026',
  'von 8. bis 9.9.2026',
  'between 8 and 9 September 2026',
  'from 8 to 9 Sep 2026',
])('preserves both explicit shared-month endpoints even when the first is before today: %s', prompt => {
  expect(resolveTemporalRequest(prompt, new Date('2026-09-09T04:00:00Z'))).toMatchObject({ status: 'resolved', relation: 'range', start: '2026-09-07T22:00:00.000Z', end: '2026-09-09T21:59:59.999Z' });
});
it('orders range endpoints by source position across years and mixed formats', () => {
  for (const prompt of ['vom 31. Dezember 2026 bis 2. Januar 2027', 'from 31.12.2026 to 2027-01-02']) {
    expect(resolveTemporalRequest(prompt, now)).toMatchObject({ status: 'resolved', relation: 'range', start: '2026-12-30T23:00:00.000Z', end: '2027-01-02T22:59:59.999Z' });
  }
});
it('rejects invalid, reversed or conflicting shared-month ranges', () => {
  for (const prompt of ['vom 31. bis 32. September 2026', 'vom 10. bis 9. September 2026', 'vom 8. bis 9. September 2026 und 12. September 2026']) {
    expect(resolveTemporalRequest(prompt, now).status).toBe('unresolved');
  }
});
