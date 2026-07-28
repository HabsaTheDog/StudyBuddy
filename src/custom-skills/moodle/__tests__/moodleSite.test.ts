import { describe, expect, it } from "vitest";
import {
  dashboardUrlForMoodle,
  deriveMoodleBrowserDomains,
  extractMoodleUrlFromText,
  isExternalToMoodle,
  isLikelyMoodleUrl,
  normalizeMoodleCourseTitle,
} from "../moodleSite.js";

describe("generic Moodle site handling", () => {
  it("extracts standard Moodle URLs without requiring moodle in the hostname", () => {
    expect(extractMoodleUrlFromText(
      "Use https://learn.example.edu/course/view.php?id=42 for this guide.",
    )).toBe("https://learn.example.edu/course/view.php?id=42");
    expect(isLikelyMoodleUrl(
      "https://virtual-campus.example.org/pluginfile.php/9/mod_resource/content/1/reading.pdf",
    )).toBe(true);
  });

  it("derives dashboard and browser boundaries from the configured installation", () => {
    expect(dashboardUrlForMoodle(
      "https://learn.example.edu/course/view.php?id=42",
    )).toBe("https://learn.example.edu/my/");
    expect(deriveMoodleBrowserDomains(
      "https://learn.example.edu",
      ["https://sso.example.edu/login", "https://learn.example.edu/my/"],
    )).toEqual(["learn.example.edu", "sso.example.edu"]);
  });

  it("preserves a Moodle installation path when deriving its dashboard", () => {
    expect(dashboardUrlForMoodle(
      "https://portal.example.edu/learning/moodle/course/view.php?id=42",
    )).toBe("https://portal.example.edu/learning/moodle/my/");
    expect(dashboardUrlForMoodle(
      "https://portal.example.edu/learning/moodle/my",
    )).toBe("https://portal.example.edu/learning/moodle/my/");
  });

  it("classifies origins relative to the selected Moodle site", () => {
    expect(isExternalToMoodle(
      "https://learn.example.edu/mod/resource/view.php?id=1",
      "https://learn.example.edu",
    )).toBe(false);
    expect(isExternalToMoodle(
      "https://publisher.example/book",
      "https://learn.example.edu",
    )).toBe(true);
  });

  it("normalizes standard Moodle course page titles without assuming an institution", () => {
    expect(normalizeMoodleCourseTitle(
      "Course: World Literature: Modernism | University Virtual Campus",
    )).toBe("World Literature: Modernism");
  });
});
