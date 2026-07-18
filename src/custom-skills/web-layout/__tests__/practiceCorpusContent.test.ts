import { describe, expect, it } from "vitest";
import { buildContentFromPracticeCorpus } from "../practiceCorpusContent.js";
import { renderStandardStudyGuide } from "../standardStudyGuideRenderer.js";

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
});
