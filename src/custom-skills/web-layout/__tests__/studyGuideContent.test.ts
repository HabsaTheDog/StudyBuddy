import { describe, expect, it } from "vitest";
import { buildStudyGuideContentPrompt } from "../nodes/studyGuideContentNode.js";
import { validateStudyGuideContentQuality, type StudyGuideContent } from "../studyGuideContent.js";

describe("study-guide canonical content bank", () => {
  it("rejects a small generic task bank before HTML generation", () => {
    const content = {
      courseTitle: "MAES2",
      scopeNote: "Test",
      topics: [{
        id: "t1",
        title: "Folgen",
        learningGoals: ["Folgen berechnen"],
        theory: { summary: "x".repeat(90), keyIdeas: ["A", "B"], formulas: [] },
        workedExamples: [{ title: "B", prompt: "Berechne den Folgenwert.", steps: ["A", "B"], answer: "1", source: { label: "M1", sourceTask: "Aufgabe 1", provenance: "source" } }],
        exercises: [{ id: "x1", type: "cross", prompt: "Welche Aussage trifft zu?", selectionMode: "single", options: [{ text: "A", correct: true, feedback: "A" }, { text: "B", correct: false, feedback: "B" }, { text: "C", correct: false, feedback: "C" }], explanation: "Eine konkrete Erklärung.", source: { label: "M1", sourceTask: "Aufgabe 1", provenance: "source" } }],
        retrieval: [{ prompt: "A?", answer: "B" }],
      }],
      sources: [{ id: "m1", label: "M1", url: "", coverage: "Folgen" }],
    } as StudyGuideContent;
    expect(validateStudyGuideContentQuality(content).join("\n")).toContain("at least 50");
    expect(validateStudyGuideContentQuality(content).join("\n")).toContain("at least 30 Kreuzerl");
  });

  it("forces concrete source-bound exercises in the model prompt", () => {
    const prompt = buildStudyGuideContentPrompt({
      kind: "study-guide", language: "de",
    } as never, {
      source_text: "Minitest 1 Aufgabe 1",
      layout_spec: {},
      error_log: null,
    });
    expect(prompt).toContain("sourceTask must identify the concrete source task");
    expect(prompt).toContain("at least 50 exercises");
    expect(prompt).toContain("Do not describe layouts");
  });
});
