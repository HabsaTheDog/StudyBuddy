import { describe, expect, it } from "vitest";
import {
  expectsDownloadedSourceEvidence,
  hasRequiredTopicEvidence,
  resolveVerifiedMoodleSource,
} from "../sourceHints.js";

describe("verified Moodle source hints", () => {
  it("resolves dashboard DC-DC requests to the verified laboratory course", () => {
    expect(
      resolveVerifiedMoodleSource(
        "Erstelle ein PDF zum DC-DC-Wandler-Labor",
        "https://moodle.technikum-wien.at/my/",
      ),
    ).toBe("https://moodle.technikum-wien.at/course/view.php?id=32320");
  });

  it("preserves explicit activity and resource URLs", () => {
    const resource = "https://moodle.technikum-wien.at/mod/resource/view.php?id=2189329";
    expect(resolveVerifiedMoodleSource("DC-DC Lernzettel", resource)).toBe(resource);
  });

  it("requires concrete DC-DC evidence before document generation", () => {
    const prompt = "DC-DC-Wandler Laborvorbereitung";
    expect(hasRequiredTopicEvidence(prompt, "Grundlagen des technischen Zeichnens")).toBe(false);
    expect(hasRequiredTopicEvidence(prompt, "Versuch 5: Tiefsetzsteller mit LM2575")).toBe(true);
  });

  it("detects prompts that require downloaded Moodle files or slides", () => {
    expect(expectsDownloadedSourceEvidence("Suche konkrete Folien und PDF-Dateien")).toBe(true);
    expect(expectsDownloadedSourceEvidence("Ermittle den Abgabetermin und Raum")).toBe(false);
  });
});
