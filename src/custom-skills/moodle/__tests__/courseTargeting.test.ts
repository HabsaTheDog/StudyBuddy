import { describe, expect, it } from "vitest";
import {
  extractCourseTargetHint,
  extractResolvedCourseIdentity,
  hasUnrecognizedNamedCourseTarget,
  rawTextContainsRequestedCourse,
  resolveRequestedCourseCode,
  resolveCourseTargetsFromLinks,
} from "../courseTargeting.js";

describe("courseTargeting", () => {
  it("extracts MEL from prompts", () => {
    expect(extractCourseTargetHint("MEL Prüfung morgen").requestedCodes).toContain("MEL");
  });

  it("maps the common MAES shorthand to MAES2", () => {
    const hint = extractCourseTargetHint("Erstelle einen Study Guide für MAES");

    expect(hint.requestedCodes).toEqual(expect.arrayContaining(["MAES", "MAES2"]));
  });

  it("ignores a course mentioned only as a negative mismatch guard", () => {
    const hint = extractCourseTargetHint("Verwechsle MAES nicht mit MEL oder einem anderen Kurs");

    expect(hint.requestedCodes).toEqual(expect.arrayContaining(["MAES", "MAES2"]));
    expect(hint.requestedCodes).not.toContain("MEL");
  });

  it("maps the singular user wording Anwendung der Dynamik to DYN2", () => {
    expect(
      extractCourseTargetHint("Study Guide für Anwendung der Dynamik").requestedCodes,
    ).toContain("DYN2");
  });

  it("resolves generic Dynamik against the acquired DYN2 corpus in a multi-course comparison", () => {
    expect(resolveRequestedCourseCode(
      "Erstelle einen PDF-Study-Guide für Dynamik.",
      "Starte Runs bei MEL und Dynamik, damit ich die Kurse vergleichen kann.",
      "Kurs: Anwendungen der Dynamik\nZusammenfassung-DYN2.pdf",
    )).toBe("DYN2");
  });

  it("does not hard-code a generic math description to one course", () => {
    expect(extractCourseTargetHint("Create a guide for my math exam")).toMatchObject({
      requestedCodes: [],
      requestedNames: [],
    });
  });

  it("reads a persisted unknown course identity without an alias table", () => {
    expect(extractResolvedCourseIdentity([
      "[Moodle course resolution]",
      "Selected: HUM-204 World Literature",
      "Course title: World Literature: Modernism and Memory",
      "URL: https://learn.example.edu/course/view.php?id=204",
      "Confidence: high",
      "Method: model_evidence",
    ].join("\n"))).toEqual({
      title: "World Literature: Modernism and Memory",
      url: "https://learn.example.edu/course/view.php?id=204",
      confidence: "high",
    });
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

  it("resolves MAES shorthand to MAES2 instead of a negatively named MEL course", () => {
    const result = resolveCourseTargetsFromLinks("Verwechsle MAES nicht mit MEL", [
      {
        href: "https://moodle.example/course/view.php?id=32274",
        label: "BMR-VZ-2-SS2026-MAES2-DE Mathematik für Engineering Science 2",
      },
      {
        href: "https://moodle.example/course/view.php?id=32280",
        label: "BMR-VZ-2-SS2026-MEL1-DE Maschinenelemente 1",
      },
    ]);

    expect(result.status).toBe("resolved");
    expect(result.selectedUrls).toEqual(["https://moodle.example/course/view.php?id=32274"]);
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

  it.each([
    "Wann ist die Prüfung in Technisches Zeichnen?",
    "Wann ist die Prüfung in Grundlagen des technischen Zeichnens?",
  ])("maps the TEZEI name in %s", (prompt) => {
    const hint = extractCourseTargetHint(prompt);

    expect(hint.requestedCodes).toContain("TEZEI");
    expect(hint.requestedNames).toEqual(expect.arrayContaining([
      "Technisches Zeichnen",
      "Grundlagen des technischen Zeichnens",
    ]));
  });

  it("resolves a TEZEI Moodle course while preserving exact course targeting", () => {
    const result = resolveCourseTargetsFromLinks("Technisches Zeichnen Prüfung", [
      {
        href: "https://moodle.example/course/view.php?id=33001",
        label: "BMR-VZ-2-SS2026-TEZEI-DE Grundlagen des technischen Zeichnens",
      },
      {
        href: "https://moodle.example/course/view.php?id=32280",
        label: "BMR-VZ-2-SS2026-MEL1-DE Maschinenelemente 1",
      },
    ]);

    expect(result.status).toBe("resolved");
    expect(result.selectedUrls).toEqual(["https://moodle.example/course/view.php?id=33001"]);
  });

  it("distinguishes an unknown named course from a general exam request", () => {
    expect(hasUnrecognizedNamedCourseTarget("Wann ist die Prüfung für Thermodynamik?")).toBe(true);
    expect(hasUnrecognizedNamedCourseTarget("Welche Prüfung habe ich als Nächstes?")).toBe(false);
    expect(hasUnrecognizedNamedCourseTarget("Wann ist die TEZEI Prüfung?")).toBe(false);
  });
});
