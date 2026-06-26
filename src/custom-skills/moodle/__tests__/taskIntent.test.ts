import { describe, expect, it } from "vitest";
import { classifyStudyBuddyIntent } from "../taskIntent.js";

const melPrompt = "Finde die naechste kommende MEL Pruefung in Moodle und CIS. Nenne nur den naechsten Termin mit exactem Datum, Uhrzeit, Raum und pruefungsrelevanten Lernunterlagen aus dem zugehoerigen MEL Moodle-Kurs.";

describe("Study Buddy task intent", () => {
  it("classifies the MEL next-exam prompt as a schedule answer", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: melPrompt,
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
    });

    expect(intent).toMatchObject({
      intent: "schedule_answer",
      wantsPdf: false,
      wantsTypstDocument: false,
      wantsQuickAnswer: true,
      wantsQuizAssistance: false,
      needsMoodle: true,
      needsCis: true,
      needsCourseMaterial: true,
      needsDownloadedFiles: false,
    });
  });

  it("classifies explicit PDF course overview prompts as study PDFs", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Erstelle eine Kursübersicht für MEL als PDF",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
    });

    expect(intent.intent).toBe("study_pdf");
    expect(intent.wantsPdf).toBe(true);
  });

  it("classifies explicit minitest prompts as quiz assistance", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Bearbeite den nächsten MEL Minitest",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
    });

    expect(intent.intent).toBe("quiz_assist");
  });

  it("does not let autoAnswer alone turn the MEL schedule prompt into a quiz", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: melPrompt,
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: true,
      includeCis: true,
      hasCisUrls: true,
    });

    expect(intent.intent).toBe("schedule_answer");
    expect(intent.wantsQuizAssistance).toBe(false);
  });
});
