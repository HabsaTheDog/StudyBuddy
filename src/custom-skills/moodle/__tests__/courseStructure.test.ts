import { describe, expect, it } from "vitest";
import { extractNumberedCourseTopics } from "../courseStructure.js";

describe("numbered Moodle course structure", () => {
  it("prefers rich teaching blocks over repeated navigation headings", () => {
    const topics = extractNumberedCourseTopics(`
THEMA 1: FOLGEN UND REIHEN
Vorbereitung
THEMA 2: GRUNDLAGEN DER DIFFERENTIALRECHNUNG 1
Vorbereitung
THEMA 3: GRUNDLAGEN DER DIFFERENTIALRECHNUNG 2
Vorbereitung

### Thema 1: Folgen und Reihen
In dieser Selbststudienphase lernen Sie Folgen und Konvergenz kennen.
6.1 Folgen
6.2 Reihen
Minitest zu Thema 1
Übungsaufgaben zu Thema 1

### Thema 2: Grundlagen der Differentialrechnung 1
In dieser Selbststudienphase beschäftigen Sie sich mit Grenzwerten und Stetigkeit.
20.1 Grenzwert und Stetigkeit einer Funktion
20.2 Die Ableitung einer Funktion
Übungsaufgaben zu Thema 2

### Thema 3: Grundlagen der Differentialrechnung 2
In dieser Selbststudienphase frischen Sie die Regeln des Differenzierens auf.
20.3 Berechnung von Ableitungen, bis exklusive Satz 20.22
Minitest zu Thema 3
`);

    expect(topics).toHaveLength(3);
    expect(topics[0]).toMatchObject({
      number: 1,
      title: "Folgen und Reihen",
      subtopics: ["6.1 Folgen", "6.2 Reihen"],
      practiceLabels: ["Minitest zu Thema 1", "Übungsaufgaben zu Thema 1"],
    });
    expect(topics[1].subtopics).toEqual([
      "20.1 Grenzwert und Stetigkeit einer Funktion",
      "20.2 Die Ableitung einer Funktion",
    ]);
  });

  it("rejects isolated non-contiguous topic mentions", () => {
    expect(extractNumberedCourseTopics("Thema 2: Ableitungen\n2.1 Regeln"))
      .toEqual([]);
  });
});
