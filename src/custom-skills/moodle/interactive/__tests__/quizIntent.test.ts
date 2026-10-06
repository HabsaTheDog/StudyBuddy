import { describe, expect, it } from "vitest";
import {
  extractAssignmentUrl,
  extractQuizUrl,
  extractQuizUrls,
  normalizeQuizUrl,
  promptWantsQuizAttempt,
  isAssignmentSubmissionPrompt,
  isQuizPrompt,
} from "../quizIntent.js";

describe("quizIntent", () => {
  it("routes German minitest prompts to the quiz path", () => {
    expect(
      isQuizPrompt("kannst du bitte den kommenden minitest in Anwendung der Dynamik machen"),
    ).toBe(true);
  });

  it("routes German selfcheck prompts to the quiz path", () => {
    expect(isQuizPrompt("bearbeite bitte die Selbstchecks in Elektrotechnik 2")).toBe(true);
  });

  it("routes an English quiz-filling prompt to the quiz path", () => {
    expect(isQuizPrompt("Fill in the next Moodle quiz, but do not submit it")).toBe(true);
  });

  it("routes an English self quiz request to the quiz path", () => {
    expect(isQuizPrompt("can you do the first self quiz in Elektrotechnik 2 for me.")).toBe(true);
  });

  it("does not route ordinary schedule questions as quiz attempts", () => {
    expect(isQuizPrompt("was machen wir heute im fachlabor und in welchem raum")).toBe(false);
  });

  it("extracts direct Moodle quiz URLs", () => {
    expect(extractQuizUrl("mach https://moodle.technikum-wien.at/mod/quiz/view.php?id=123.")).toBe(
      "https://moodle.technikum-wien.at/mod/quiz/view.php?id=123",
    );
  });

  it("shares execution recognition and does not start discovery requests", () => {
    expect(isQuizPrompt("Bitte beide Mini-Tests erledigen")).toBe(true);
    expect(promptWantsQuizAttempt("Bitte beide Mini-Tests erledigen")).toBe(true);
    expect(promptWantsQuizAttempt("Find all open quizzes")).toBe(false);
    expect(promptWantsQuizAttempt("Welche Tests muss ich machen?")).toBe(false);
  });

  it("finds every explicit quiz after unrelated links and deduplicates navigation parameters", () => {
    expect(extractQuizUrls("Bearbeite https://example.org/info und (https://moodle.example/mod/quiz/view.php?id=1&lang=de), https://moodle.example/mod/quiz/view.php?id=2. https://moodle.example/mod/quiz/view.php?id=1")).toEqual([
      "https://moodle.example/mod/quiz/view.php?id=1",
      "https://moodle.example/mod/quiz/view.php?id=2",
    ]);
  });

  it.each([
    "https://moodle.example/mod/quiz/startattempt.php?id=1",
    "https://moodle.example/mod/quiz/processattempt.php?attempt=1",
    "https://moodle.example/mod/quiz/view.php",
    "https://moodle.example/mod/quiz/view.php?id=0",
    "https://user:secret@moodle.example/mod/quiz/view.php?id=1",
    "--help",
  ])("rejects invalid or action URLs: %s", url => {
    expect(normalizeQuizUrl(url)).toBeNull();
  });

  it("routes assignment submission separately from quizzes", () => {
    const prompt = "upload und abgeben https://moodle.example/mod/assign/view.php?id=42";
    expect(isAssignmentSubmissionPrompt(prompt)).toBe(true);
    expect(isQuizPrompt(prompt)).toBe(false);
    expect(extractAssignmentUrl(prompt)).toBe("https://moodle.example/mod/assign/view.php?id=42");
  });
});
