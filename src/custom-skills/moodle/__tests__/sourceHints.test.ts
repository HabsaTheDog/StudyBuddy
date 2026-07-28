import { describe, expect, it } from "vitest";
import {
  expectsDownloadedSourceEvidence,
  hasRequiredTopicEvidence,
  resolveVerifiedMoodleSource,
} from "../sourceHints.js";

describe("verified Moodle source hints", () => {
  it("leaves dashboard course discovery site-agnostic instead of using a hard-coded course", () => {
    expect(
      resolveVerifiedMoodleSource(
        "Erstelle ein PDF zum DC-DC-Wandler-Labor",
        "https://moodle.technikum-wien.at/my/",
      ),
    ).toBe("https://moodle.technikum-wien.at/my/");
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
    expect(expectsDownloadedSourceEvidence("prüfungsrelevante Lernunterlagen")).toBe(true);
    expect(expectsDownloadedSourceEvidence("Ermittle den Abgabetermin und Raum")).toBe(false);
  });

  it("requires generic target-course evidence", () => {
    expect(hasRequiredTopicEvidence("MEL Prüfung", "DYN2 Test beginnt")).toBe(false);
    expect(hasRequiredTopicEvidence("MEL Prüfung", "Maschinenelemente 1")).toBe(true);
  });
});
