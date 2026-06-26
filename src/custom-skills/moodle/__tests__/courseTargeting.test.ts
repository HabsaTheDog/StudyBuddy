import { describe, expect, it } from "vitest";
import {
  extractCourseTargetHint,
  rawTextContainsRequestedCourse,
  resolveCourseTargetsFromLinks,
} from "../courseTargeting.js";

describe("courseTargeting", () => {
  it("extracts MEL from prompts", () => {
    expect(extractCourseTargetHint("MEL Prüfung morgen").requestedCodes).toContain("MEL");
  });

  it("resolves MEL to an MEL1 Moodle course label", () => {
    const result = resolveCourseTargetsFromLinks("MEL Prüfung", [
      {
        href: "https://moodle.example/course/view.php?id=32280",
        label: "BMR-VZ-2-SS2026-MEL1-DE Maschinenelemente 1",
      },
    ]);

    expect(result.status).toBe("resolved");
    expect(result.selectedUrls).toEqual(["https://moodle.example/course/view.php?id=32280"]);
  });

  it("does not resolve DYN2 as MEL", () => {
    const result = resolveCourseTargetsFromLinks("MEL Prüfung", [
      {
        href: "https://moodle.example/course/view.php?id=32844",
        label: "BMR-VZ-2-SS2026-DYN2-DE Anwendungen der Dynamik",
      },
    ]);

    expect(result.status).toBe("not_found");
  });

  it("checks raw text for requested course evidence", () => {
    expect(rawTextContainsRequestedCourse("MEL Prüfung", "Maschinenelemente 1")).toBe(true);
    expect(rawTextContainsRequestedCourse("MEL Prüfung", "Anwendungen der Dynamik")).toBe(false);
  });
});
