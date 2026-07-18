import { describe, expect, it } from "vitest";
import { resolveOutputLanguage } from "../languagePolicy.js";

describe("output language policy", () => {
  it.each([
    ["Make me a PDF about dynamics", "en"],
    ["Could you prepare notes about machine elements?", "en"],
    ["Please make this in English", "en"],
    ["Erstelle einen Lernzettel für Dynamik", "de"],
    ["Bitte fasse meinen Moodle-Kurs zusammen", "de"],
  ] as const)("follows the user language for %s", (prompt, language) => {
    expect(resolveOutputLanguage({ prompt })).toMatchObject({ language });
  });

  it("lets an explicit artifact language override the surrounding prompt", () => {
    expect(resolveOutputLanguage({
      prompt: "Erstelle einen Lernzettel, but write the PDF in English.",
    })).toEqual({ language: "en", reason: "explicit_prompt" });
    expect(resolveOutputLanguage({
      prompt: "Create a concise guide",
      preference: "de",
    })).toEqual({ language: "de", reason: "explicit_option" });
  });

  it("uses the configured fallback only when the prompt is genuinely ambiguous", () => {
    expect(resolveOutputLanguage({ prompt: "MAES2 PDF", fallback: "de" }))
      .toEqual({ language: "de", reason: "fallback" });
  });
});
