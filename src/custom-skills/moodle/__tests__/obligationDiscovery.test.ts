import { describe, expect, it } from "vitest";
import {
  classifyObligationDiscovery,
  isObligationActivityLink,
  normalizeObligationUrl,
  resolveObligationCoursesFromCalendar,
} from "../obligationDiscovery.js";

describe("generic obligation discovery policy", () => {
  it.each(["Complete an explanation of osmosis", "Prepare a summary of chapter 2", "Eine Zusammenfassung vorbereiten"])("keeps ordinary study requests out of obligation discovery: %s", prompt => {
    expect(classifyObligationDiscovery(prompt).requested).toBe(false);
  });
  it.each(["Which assignments must I complete?", "What must I prepare for tomorrow?", "Was muss ich morgen vorbereiten?"])("retains actual obligation questions: %s", prompt => {
    expect(classifyObligationDiscovery(prompt).requested).toBe(true);
  });
  it("resolves every calendar course hint independently without a fixed shortlist", () => {
    const courses = [
      { href: "https://moodle.example/course/view.php?id=1", label: "WS2026 AT1 Automatisierungstechnik" },
      { href: "https://moodle.example/course/view.php?id=2", label: "WS2026 KINET Higher Kinetics" },
      { href: "https://moodle.example/course/view.php?id=3", label: "WS2026 RW Accounting" },
      { href: "https://moodle.example/course/view.php?id=4", label: "SS2026 unrelated course" },
      { href: "https://moodle.example/course/view.php?id=1&lang=en", label: "WS2026 AT1 Automatisierungstechnik" },
    ];

    expect(resolveObligationCoursesFromCalendar(courses, [
      "AT1-ILV Group A",
      "KINET-ILV Group A",
      "RW-ILV Group A",
      "UNKNOWN-ILV Group A",
    ])).toEqual({
      selectedUrls: courses.slice(0, 3).map((course) => course.href),
      unmatchedHints: ["UNKNOWN-ILV Group A"],
    });
  });

  it("treats inherently actionable activities as deep targets but not every lecture link", () => {
    expect(isObligationActivityLink({ href: "https://moodle.example/mod/assign/view.php?id=1" })).toBe(true);
    expect(isObligationActivityLink({ href: "https://moodle.example/mod/quiz/view.php?id=2" })).toBe(true);
    expect(isObligationActivityLink({ href: "https://moodle.example/mod/page/view.php?id=3", label: "Homework details" })).toBe(true);
    expect(isObligationActivityLink({ href: "https://moodle.example/mod/page/view.php?id=4", label: "Lecture notes" })).toBe(false);
    expect(isObligationActivityLink({ href: "https://moodle.example/mod/quiz/attempt.php?attempt=5" })).toBe(false);
  });

  it("distinguishes one deadline lookup from an exhaustive to-do request", () => {
    expect(classifyObligationDiscovery("What is the deadline at /mod/assign/view.php?id=1?").requested).toBe(false);
    expect(classifyObligationDiscovery("What is due next week in all courses?")).toMatchObject({
      requested: true,
      temporal: true,
      exhaustive: true,
      calendarFirst: true,
    });
  });

  it("canonicalizes Moodle activity decorations to one stable read URL", () => {
    expect(normalizeObligationUrl(
      "https://moodle.example/mod/assign/view.php?id=42&nonjscomment=1&comment_itemid=99&sesskey=secret",
    )).toBe("https://moodle.example/mod/assign/view.php?id=42");
  });
});
