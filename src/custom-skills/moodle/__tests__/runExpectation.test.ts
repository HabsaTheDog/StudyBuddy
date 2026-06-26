import { describe, expect, it } from "vitest";
import { classifyTaskShape } from "../runExpectation.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

const melPrompt = "Finde die naechste kommende MEL Pruefung in Moodle und CIS. Nenne nur den naechsten Termin mit exactem Datum, Uhrzeit, Raum und pruefungsrelevanten Lernunterlagen aus dem zugehoerigen MEL Moodle-Kurs.";

describe("run expectation task shape", () => {
  it("does not classify autoAnswer schedule prompts as quiz/PDF runs", () => {
    const config = moodleTestConfig({
      prompt: melPrompt,
      autoAnswer: true,
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
      intentDecision: classifyStudyBuddyIntent({
        prompt: melPrompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: true,
        includeCis: true,
        hasCisUrls: true,
      }),
    });

    expect(classifyTaskShape(config)).toMatchObject({
      kind: "schedule_answer",
      rendersPdf: false,
      downloadsFiles: false,
      usesMoodle: true,
      usesCis: true,
    });
  });

  it("does not treat Moodle dashboard URLs as direct URLs", () => {
    const shape = classifyTaskShape(moodleTestConfig({
      prompt: "Was ist morgen?",
      moodleUrl: "https://moodle.technikum-wien.at/my/",
    }));

    expect(shape.hasDirectUrl).toBe(false);
  });

  it("treats direct course URLs as direct URLs", () => {
    const shape = classifyTaskShape(moodleTestConfig({
      prompt: "Was ist im Kurs?",
      moodleUrl: "https://moodle.technikum-wien.at/course/view.php?id=32280",
    }));

    expect(shape.hasDirectUrl).toBe(true);
  });
});
