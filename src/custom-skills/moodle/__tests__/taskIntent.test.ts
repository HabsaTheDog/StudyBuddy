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

  it("does not treat exam-ready wording as a schedule or CIS request", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Erstelle einen ausführlichen prüfungstauglichen Study Guide für MEL als PDF",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
      hasCalendarUrl: true,
    });

    expect(intent.intent).toBe("study_pdf");
    expect(intent.needsCis).toBe(false);
    expect(intent.needsCalendar).toBe(false);
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

  it("treats a test-date question as calendar schedule intent, not quiz assistance", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Wann und wo ist der MEL1 Test?",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
      hasCalendarUrl: true,
    });

    expect(intent.intent).toBe("schedule_answer");
    expect(intent.needsCalendar).toBe(true);
    expect(intent.wantsQuizAssistance).toBe(false);
  });

  it("keeps open quiz discovery on the Moodle quiz route despite availability and time-limit words", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Scan my Moodle courses for quizzes and self-checks that are still open today. Include time limits and rank harder options.",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
      hasCalendarUrl: true,
    });

    expect(intent).toMatchObject({
      intent: "quiz_assist",
      wantsQuizAssistance: true,
      wantsQuizDiscovery: true,
      wantsQuickAnswer: true,
      needsMoodle: true,
      needsCis: false,
      needsCalendar: false,
    });
  });

  it("treats Moodle as a requested schedule source without enabling course-material ingestion", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Find the next TEZEI exam date and check Moodle and CIS if the calendar is empty.",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: true,
      hasCisUrls: true,
      hasCalendarUrl: true,
    });

    expect(intent).toMatchObject({
      intent: "schedule_answer",
      needsMoodle: true,
      needsCis: true,
      needsCalendar: true,
      needsCourseMaterial: false,
      needsDownloadedFiles: false,
    });
  });

  it("recognizes a standard Moodle URL on an arbitrary institutional hostname", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "What is the deadline shown at https://campus.example.org/mod/assign/view.php?id=71?",
      stage: "all",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: false,
      hasCisUrls: false,
      hasCalendarUrl: false,
    });

    expect(intent).toMatchObject({
      intent: "schedule_answer",
      needsMoodle: true,
      needsCourseMaterial: false,
      needsDownloadedFiles: false,
    });
  });

  it("preserves course-material and download requirements in the extraction stage", () => {
    const intent = classifyStudyBuddyIntent({
      prompt: "Erstelle einen Study Guide als PDF aus allen Moodle-Folien und Rechenaufgaben",
      stage: "extract",
      diagnosticOnly: false,
      autoAnswer: false,
      includeCis: false,
      hasCisUrls: false,
    });

    expect(intent).toMatchObject({
      intent: "extraction",
      needsMoodle: true,
      needsCourseMaterial: true,
      needsDownloadedFiles: true,
    });
  });
});
