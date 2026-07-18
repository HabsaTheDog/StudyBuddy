import { describe, expect, it } from "vitest";
import {
  extractAssignmentUrl,
  extractQuizUrl,
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

  it("does not route ordinary schedule questions as quiz attempts", () => {
    expect(isQuizPrompt("was machen wir heute im fachlabor und in welchem raum")).toBe(false);
  });

  it("extracts direct Moodle quiz URLs", () => {
    expect(extractQuizUrl("mach https://moodle.technikum-wien.at/mod/quiz/view.php?id=123.")).toBe(
      "https://moodle.technikum-wien.at/mod/quiz/view.php?id=123",
    );
  });

  it("routes assignment submission separately from quizzes", () => {
    const prompt = "upload und abgeben https://moodle.example/mod/assign/view.php?id=42";
    expect(isAssignmentSubmissionPrompt(prompt)).toBe(true);
    expect(isQuizPrompt(prompt)).toBe(false);
    expect(extractAssignmentUrl(prompt)).toBe("https://moodle.example/mod/assign/view.php?id=42");
  });
});
