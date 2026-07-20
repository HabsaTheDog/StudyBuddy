import { describe, expect, it } from "vitest";
import { buildContentFromPracticeCorpus } from "../practiceCorpusContent.js";
import { matchesCalculationAnswer, renderStandardStudyGuide } from "../standardStudyGuideRenderer.js";

describe("practice-corpus source links", () => {
  it("preserves direct Moodle activity URLs and renders safe new-tab links", () => {
    const extractedData = {
      sources: [
        { id: "t1", url: "https://moodle.technikum-wien.at/mod/resource/view.php?id=2185127" },
        { id: "ode", url: "https://moodle.technikum-wien.at/mod/resource/view.php?id=2185259" },
        { id: "ode2", url: "https://moodle.technikum-wien.at/mod/resource/view.php?id=2185258" },
      ],
    };
    const practice = [1, 2, 3, 4, 5].map((number) => [
      `### Practice source: targeted-${number}-Minitest-${number}---Loesungen.extracted.txt`,
      `1. Single Choice: Welche Aussage ist für Minitest ${number} richtig?`,
      "A. Richtig",
      "B. Falsch",
      "Lösung ist A",
    ].join("\n")).join("\n\n");
    const sourceText = `## Extracted data\n\n${JSON.stringify(extractedData)}\n\n## Full extracted practice corpus\n\n${practice}`;

    const content = buildContentFromPracticeCorpus(sourceText, { title: "MAES2 – Test" });

    expect(content?.sources.find((source) => source.id === "mt1")?.url)
      .toBe("https://moodle.technikum-wien.at/mod/resource/view.php?id=2185127");
    expect(content?.sources.find((source) => source.id === "ode")?.url)
      .toBe("https://moodle.technikum-wien.at/mod/resource/view.php?id=2185259");
    for (const topic of content?.topics ?? []) {
      while (topic.exercises.length < 3) {
        topic.exercises.push({ ...topic.exercises[0], id: `${topic.id}-test-${topic.exercises.length}` });
      }
    }
    const html = renderStandardStudyGuide(content as never, "de");
    expect(html).toContain('href="https://moodle.technikum-wien.at/mod/resource/view.php?id=2185127"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("In Moodle öffnen");
  });

  it("renders named engineering subscripts as deterministic mathematical markup", () => {
    const exercise = {
      id: "mel-math-1",
      type: "calculation",
      prompt: "Bestimme l_m, A_K und F_v,Rd; wähle max(n_a,n_1).",
      givens: ["s_m = 2 mm", "R_m = 400 MPa"],
      acceptedAnswers: ["1"],
      unit: "mm",
      steps: ["Berechne A_S.", "Prüfe T_a."],
      commonMistake: "A_l wird nicht mit A_K verwechselt.",
      source: { label: "MEL", sourceTask: "Kapitel Toleranzen mit n_z und t_m", provenance: "derived" },
    };
    const html = renderStandardStudyGuide({
      courseTitle: "Maschinenelemente 1",
      courseCode: "MEL1",
      scopeNote: "Test",
      topics: [{
        id: "mel",
        title: "Toleranzen",
        learningGoals: ["l_m bestimmen"],
        theory: { summary: "Eine ausreichend lange, fachlich klare Zusammenfassung für den Renderer-Test. ".repeat(2), keyIdeas: ["A_K", "F_v,Rd"], formulas: [
          { expression: "A_K = l_m · s_m", meaning: "Klebefläche" },
          { expression: "ηHonig/ηWasser≈10⁴", meaning: "Viskositätsverhältnis" },
        ] },
        workedExamples: [{ title: "Beispiel", prompt: "Berechne A_K.", steps: ["Setze l_m ein.", "Multipliziere mit s_m."], answer: "A_K = 1", source: exercise.source }],
        exercises: [exercise, { ...exercise, id: "mel-math-2" }, { ...exercise, id: "mel-math-3" }],
        retrieval: [{ prompt: "Was bedeutet A_K?", answer: "Klebefläche" }],
      }],
      sources: [{ id: "mel", label: "MEL", url: "", coverage: "Toleranzen" }],
    } as never, "de");

    expect(html).toContain("<var>l</var><sub>m</sub>");
    expect(html).toContain("<var>A</var><sub>K</sub>");
    expect(html).toContain("<var>F</var><sub>v,Rd</sub>");
    expect(html).toContain("max(<var>n</var><sub>a</sub>,<var>n</var><sub>1</sub>)");
    expect(html).not.toContain("<sub>a,n</sub>_1");
    expect(html).toContain("<var>T</var><sub>a</sub>");
    expect(html).toContain("Kapitel Toleranzen mit <var>n</var><sub>z</sub> und <var>t</var><sub>m</sub>");
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" aria-label="ηHonig/ηWasser≈10⁴"><mrow><mfrac><msub><mi>η</mi><mi>Honig</mi></msub><msub><mi>η</mi><mi>Wasser</mi></msub></mfrac><mo>≈</mo><msup><mn>10</mn><mn>4</mn></msup></mrow></math>');
    expect(html).toContain("study-buddy-guide-mel1-maschinenelemente-1-v1");
  });

  it("accepts a target value inside a traceable multi-result calculation answer", () => {
    const accepted = ["0,03", "0.03", "T_a = 0,03", "T_a = 0.03"];
    expect(matchesCalculationAnswer(accepted, "a_min = 29,00 mm; a_max = 29,03 mm; T_a = 0,03 mm")).toBe(true);
    expect(matchesCalculationAnswer(["1"], "10")).toBe(false);
    expect(matchesCalculationAnswer(["1,5"], "Ergebnis: 1.5 mm")).toBe(true);
  });
});
