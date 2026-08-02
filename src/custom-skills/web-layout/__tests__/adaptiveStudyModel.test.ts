import { describe, expect, it } from "vitest";
import {
  adaptiveStudyModelSchema,
  buildAdaptiveStudyModel,
} from "../adaptiveStudyModel.js";
import type { StudyGuideContent } from "../studyGuideContent.js";

describe("adaptive Study Builder model", () => {
  it("derives traceable blueprints and a reviewed question bank", () => {
    const model = buildAdaptiveStudyModel(contentFixture(), [
      "Musterprüfung",
      "Dauer: 60 min",
      "Erlaubt sind: Taschenrechner, Stifte, Lineal",
      "Keine Verwendung von Unterlagen oder elektronischen Hilfsmitteln",
      "Maximal sind auf diese Klausur 100 Punkte erreichbar.",
      "Die Klausur ist ab 50 Punkten positiv bewertet.",
      "Aufgabe 1: Toleranzrechnung (40 Punkte)",
      "Aufgabe 2: Theorieteil (60 Punkte)",
    ].join("\n"), "de");

    expect(adaptiveStudyModelSchema.parse(model)).toEqual(model);
    expect(model.courseBlueprint.modules.map((module) => module.title))
      .toEqual(["Toleranzen", "Verbindungen"]);
    expect(model.assessmentBlueprint).toMatchObject({
      mode: "explicit",
      title: "Prüfungssimulation",
      confidence: "high",
      durationMinutes: 60,
      maxPoints: 100,
      passingPoints: 50,
    });
    expect(model.assessmentBlueprint.sections.map((section) => section.title))
      .toEqual(["Toleranzrechnung", "Theorieteil"]);
    expect(model.questionBank.items).toHaveLength(8);
    expect(model.questionBank.items.every((item) =>
      item.learningObjectiveIds.length === 1 &&
      item.review.status === "approved" &&
      item.contentHash.length === 64 &&
      item.referenceSolution?.completeness === "complete" &&
      item.referenceSolution.review.status === "approved" &&
      item.referenceSolution.steps.length >= 2 &&
      item.referenceSolution.finalAnswer.length > 0
    )).toBe(true);
    expect(model.questionBank.items.map((item) => item.origin))
      .toEqual(expect.arrayContaining([
        "course_original",
        "course_variant",
        "study_buddy_generated",
      ]));
    expect(model.questionBank.coverage.missingObjectiveIds).toEqual([]);
  });

  it("uses a transparent inferred exercise simulation without assessment evidence", () => {
    const model = buildAdaptiveStudyModel(contentFixture(), "Ordinary course material without an exam description.", "en");

    expect(model.assessmentBlueprint.mode).toBe("inferred");
    expect(model.assessmentBlueprint.title).toBe("Exercise simulation based on course structure");
    expect(model.assessmentBlueprint.durationMinutes).toBeNull();
    expect(model.assessmentBlueprint.maxPoints).toBeNull();
    expect(model.assessmentBlueprint.allowedAids).toEqual([]);
    expect(model.assessmentBlueprint.sections.map((section) => section.questionTypes))
      .toEqual([["selection"], ["calculation"], ["open-response"]]);
    expect(model.courseBlueprint.learningStages.some((stage) => stage.intent === "assessment"))
      .toBe(false);
  });

  it("does not promote a mere assessment mention without evidenced sections", () => {
    const model = buildAdaptiveStudyModel(
      contentFixture(),
      "Im Moodle-Kurs wird eine Musterprüfung erwähnt, aber Aufbau, Teile und Aufgabenanzahl sind nicht dokumentiert.",
      "de",
    );

    expect(model.assessmentBlueprint.mode).toBe("inferred");
    expect(model.assessmentBlueprint.title).toBe("Übungssimulation nach Kursstruktur");
    expect(model.assessmentBlueprint.confidence).toBe("low");
    expect(model.assessmentBlueprint.sections.every((section) =>
      section.evidenceLevel === "derived"
    )).toBe(true);
  });

  it("attaches reviewed course visuals to modules and ordinary bank items", () => {
    const visual = {
      dataUri: "data:image/png;base64,iVBORw0KGgo=",
      alt: "A labelled tolerance-field diagram",
      sourceLabel: "Course reader",
      sourceTask: "Tolerance fields",
      kind: "diagram_crop" as const,
      origin: "course_original" as const,
      width: 640,
      height: 360,
    };
    const model = buildAdaptiveStudyModel(
      contentFixture(),
      "Ordinary course evidence.",
      "en",
      undefined,
      {
        schemaVersion: 1,
        modules: { tolerances: visual },
        questions: { "tolerance-calc": visual },
      },
    );

    expect(model.courseBlueprint.modules[0]?.theoryVisual).toEqual(visual);
    expect(model.questionBank.items.find((item) =>
      item.legacyExerciseId === "tolerance-calc"
    )?.visual).toEqual(visual);
    expect(model.questionBank.items.find((item) =>
      item.legacyExerciseId === "connection-app-1"
    )?.visual).toBeUndefined();
  });

  it("recognizes natural-language section evidence without relying on a sample-exam heading", () => {
    const german = buildAdaptiveStudyModel(
      contentFixture(),
      "Die Prüfung besteht aus einem Theorieteil und einem Rechenteil. Erlaubt sind: Taschenrechner.",
      "de",
    );
    const english = buildAdaptiveStudyModel(
      contentFixture(),
      "The exam includes a vocabulary part and a writing section.",
      "en",
    );

    expect(german.assessmentBlueprint.mode).toBe("explicit");
    expect(german.assessmentBlueprint.sections.map((section) => section.questionTypes))
      .toEqual(expect.arrayContaining([["selection", "open-response"], ["calculation"]]));
    expect(english.assessmentBlueprint.mode).toBe("explicit");
    expect(english.assessmentBlueprint.sections.map((section) => section.questionTypes))
      .toEqual(expect.arrayContaining([["flashcard"], ["open-response"]]));
  });

  it("reconstructs a weighted Business English repeat-exam structure from course evidence", () => {
    const model = buildAdaptiveStudyModel(
      contentFixture(),
      [
        "Repeat Exam",
        "The repeat exam will require knowledge of everything covered during the semester.",
        "It will consist of a Pecha Kucha presentation (60%) and content questions to be answered orally (30%) and a vocabulary test (10%).",
      ].join("\n"),
      "en",
    );

    expect(model.assessmentBlueprint).toMatchObject({
      mode: "explicit",
      confidence: "high",
    });
    expect(model.assessmentBlueprint.sections.map((section) => ({
      title: section.title,
      weight: section.weight,
      types: section.questionTypes,
      deliveryMode: section.deliveryMode,
      taskCount: section.taskCount,
    }))).toEqual([
      { title: "Pecha Kucha presentation", weight: 0.6, types: ["open-response"], deliveryMode: "external-performance", taskCount: null },
      { title: "content questions to be answered orally", weight: 0.3, types: ["open-response"], deliveryMode: "external-performance", taskCount: null },
      { title: "vocabulary test", weight: 0.1, types: ["flashcard"], deliveryMode: "interactive", taskCount: null },
    ]);
  });

  it("classifies arbitrary weighted assessment parts by how the offline page can actually practise them", () => {
    const model = buildAdaptiveStudyModel(
      contentFixture(),
      "Assessment consists of written cell identification (50%), laboratory specimen demonstration (30%), and case analysis (20%).",
      "en",
    );

    expect(model.assessmentBlueprint.mode).toBe("explicit");
    expect(model.assessmentBlueprint.sections.map((section) => ({
      title: section.title,
      weight: section.weight,
      deliveryMode: section.deliveryMode,
    }))).toEqual([
      { title: "written cell identification", weight: 0.5, deliveryMode: "interactive" },
      { title: "laboratory specimen demonstration", weight: 0.3, deliveryMode: "external-performance" },
      { title: "case analysis", weight: 0.2, deliveryMode: "self-assessed" },
    ]);
  });

  it("turns documented sample-exam tasks into authentic assessment items instead of metadata trivia", () => {
    const sourceText = [
      "Musterprüfung",
      "Dauer: 60 min",
      "Aufgabe 1: Toleranzrechnung (40 Punkte)",
      "Für eine Welle sind das Höchstmaß Go = 50,030 mm und das Mindestmaß Gu = 49,990 mm gegeben.",
      "Bestimmen Sie die Maßtoleranz, dokumentieren Sie die Ausgangsformel und geben Sie das Ergebnis mit Einheit an.",
      "Aufgabe 2: Verbindungsanalyse (60 Punkte)",
      "Eine belastete Verbindung ist anhand der im Kurs behandelten Beanspruchungsarten zu analysieren.",
      "Ordnen Sie die Lasten zu, begründen Sie den maßgebenden Nachweis und dokumentieren Sie Ihre Annahmen nachvollziehbar.",
    ].join("\n");
    const model = buildAdaptiveStudyModel(contentFixture(), sourceText, "de", {
      schemaVersion: 1,
      items: [1, 2].map((index) => ({
        legacyExerciseId: `assessment-source-task-${index}`,
        completeness: "complete" as const,
        summary: `Vollständige Lösung für Aufgabe ${index}.`,
        steps: [
          "Die belegte Ausgangsbeziehung wird notiert.",
          "Die gegebenen Werte werden eingesetzt und nachvollziehbar ausgewertet.",
        ],
        finalAnswer: `Alle Teilfragen von Aufgabe ${index} sind beantwortet.`,
        assumptions: [],
        evidenceBasis: [`Musterprüfung Aufgabe ${index}`],
        missingEvidence: [],
        solutionOrigin: "study_buddy_generated" as const,
        review: { status: "approved" as const, findings: [] },
      })),
    });
    const sourceTasks = model.questionBank.items.filter((item) =>
      item.legacyExerciseId.startsWith("assessment-source-task-")
    );

    expect(model.assessmentBlueprint.sections.map((section) => section.taskCount))
      .toEqual([1, 1]);
    expect(sourceTasks).toHaveLength(2);
    expect(sourceTasks.every((item) =>
      item.stageIntent === "assessment" &&
      item.difficulty === "assessment" &&
      item.origin === "course_original" &&
      item.type === "calculation" &&
      item.exercise.type === "calculation" &&
      item.exercise.acceptedAnswers.includes("__self_check__") &&
      item.referenceSolution?.completeness === "complete" &&
      item.referenceSolution.review.status === "approved"
    )).toBe(true);
    expect(sourceTasks.map((item) => item.exercise.prompt).join(" "))
      .not.toMatch(/welche.*themen.*musterprüfung/i);
    expect(sourceTasks[0].exercise.type === "calculation" &&
      sourceTasks[0].exercise.givens.join(" ")).toContain("50,030 mm");
    expect(sourceTasks[0].exercise.type === "calculation" &&
      sourceTasks[0].exercise.steps.join(" ")).toContain(
        "Maßtoleranz, dokumentieren Sie die Ausgangsformel",
      );
  });

  it("does not publish assessment metadata recall as question-bank items", () => {
    const content = contentFixture();
    content.topics[1].exercises.push({
      id: "exam-topics-meta",
      type: "application",
      prompt: "Welche drei technischen Themen umfasst die Musterprüfung?",
      instructions: [
        "Liste die Überschriften der Aufgaben auf.",
        "Übernimm ausschließlich die Prüfungsübersicht.",
      ],
      sampleAnswer: "Toleranzrechnung, Verbindungsanalyse und Festigkeitsnachweis.",
      selfCheck: [
        "Alle Überschriften genannt.",
        "Keine technische Aufgabe gelöst.",
      ],
      source: {
        label: "Musterprüfung",
        sourceTask: "Übersicht der Aufgaben in der Musterprüfung",
        provenance: "source",
      },
    });

    const model = buildAdaptiveStudyModel(content, [
      "Musterprüfung",
      "Aufgabe 1: Toleranzrechnung (40 Punkte)",
      "Berechne aus Go = 50,03 mm und Gu = 50,00 mm die Toleranz.",
    ].join("\n"), "de");

    expect(model.questionBank.items.map((item) => item.legacyExerciseId))
      .not.toContain("exam-topics-meta");
    expect(model.questionBank.items.some((item) =>
      item.legacyExerciseId === "tolerance-calc"
    )).toBe(true);
  });

  it("keeps question IDs stable when unrelated items are inserted", () => {
    const original = contentFixture();
    const before = buildAdaptiveStudyModel(original, "", "de");
    const inserted = structuredClone(original);
    inserted.topics[0].exercises.splice(1, 0, {
      ...inserted.topics[0].exercises[0],
      id: "tolerance-inserted",
      prompt: "Welche zusätzliche Toleranzaussage ist im belegten Kapitel korrekt?",
    });
    const after = buildAdaptiveStudyModel(inserted, "", "de");
    const beforeByLegacyId = new Map(before.questionBank.items.map((item) => [
      item.legacyExerciseId,
      item.id,
    ]));
    for (const item of after.questionBank.items.filter((candidate) =>
      beforeByLegacyId.has(candidate.legacyExerciseId)
    )) {
      expect(item.id).toBe(beforeByLegacyId.get(item.legacyExerciseId));
    }
  });
});

function contentFixture(): StudyGuideContent {
  const source = (provenance: "source" | "adapted" | "derived", task: string) => ({
    label: "Kursunterlagen",
    sourceTask: task,
    provenance,
  });
  return {
    courseTitle: "Cross-course Test",
    courseCode: "CCT",
    scopeNote: "Only the supplied course objectives are in scope.",
    topics: [
      {
        id: "tolerances",
        title: "Toleranzen",
        learningGoals: ["Grenzmaße unterscheiden", "Passungen berechnen"],
        theory: {
          summary: "Tolerances describe permitted dimensional variation and fits combine hole and shaft limits in a traceable calculation.".repeat(2),
          keyIdeas: ["Grenzmaße beschreiben zulässige Grenzen.", "Passungen kombinieren Bohrung und Welle."],
          formulas: [{ expression: "T = Go - Gu", meaning: "Toleranzbreite" }],
        },
        workedExamples: [{
          title: "Passung",
          prompt: "Bestimme die Toleranz.",
          steps: ["Notiere die Grenzmaße.", "Bilde die Differenz."],
          answer: "0,03 mm",
          source: source("source", "Skript Kapitel 1, Beispiel 1"),
        }],
        exercises: [
          {
            id: "tolerance-cross",
            type: "cross",
            prompt: "Welche Aussage beschreibt die Toleranzbreite fachlich korrekt?",
            selectionMode: "single",
            options: [
              { text: "Differenz der Grenzmaße", correct: true, feedback: "Richtig." },
              { text: "Summe der Grenzmaße", correct: false, feedback: "Falsch." },
              { text: "Nennmaß ohne Abmaß", correct: false, feedback: "Falsch." },
            ],
            explanation: "Die Toleranz ist die Differenz zwischen oberem und unterem Grenzmaß.",
            source: source("source", "Moodle Quiz 1, Frage 1"),
          },
          {
            id: "tolerance-calc",
            type: "calculation",
            prompt: "Berechne die Toleranz für Go = 50,03 mm und Gu = 50,00 mm.",
            givens: ["Go = 50,03 mm", "Gu = 50,00 mm"],
            acceptedAnswers: ["0,03 mm"],
            unit: "mm",
            steps: ["Verwende T = Go - Gu.", "Setze die Grenzmaße ein."],
            commonMistake: "Die Grenzmaße werden nicht addiert.",
            source: source("adapted", "Skript Kapitel 1, Beispiel 1"),
          },
          {
            id: "tolerance-app",
            type: "application",
            prompt: "Begründe, wie eine Passung anhand ihrer Grenzmaße beurteilt wird.",
            instructions: ["Vergleiche Bohrung und Welle.", "Begründe die mögliche Passungsart."],
            sampleAnswer: "Die kleinsten und größten möglichen Maße werden paarweise verglichen.",
            selfCheck: ["Grenzfälle genannt", "Passungsart begründet"],
            source: source("derived", "Abgeleitet aus Skript Kapitel 1: Passungsarten"),
          },
        ],
        retrieval: [{ prompt: "Was ist eine Toleranz?", answer: "Die Differenz der Grenzmaße." }],
      },
      {
        id: "connections",
        title: "Verbindungen",
        learningGoals: ["Verbindungsarten vergleichen"],
        theory: {
          summary: "Mechanical connections are selected from load, material, manufacturing, and service requirements with explicit assumptions.".repeat(2),
          keyIdeas: ["Last und Werkstoff beeinflussen die Auswahl.", "Lösbare und unlösbare Verbindungen unterscheiden sich."],
          formulas: [],
        },
        workedExamples: [{
          title: "Auswahl",
          prompt: "Wähle eine Verbindung.",
          steps: ["Prüfe die Last.", "Vergleiche die Verfahren."],
          answer: "Begründete Auswahl",
          source: source("source", "Skript Kapitel 2, Beispiel 1"),
        }],
        exercises: [
          {
            id: "connection-cross",
            type: "cross",
            prompt: "Welche Anforderung beeinflusst die Wahl einer Verbindung direkt?",
            selectionMode: "single",
            options: [
              { text: "Belastung", correct: true, feedback: "Richtig." },
              { text: "Seitennummer", correct: false, feedback: "Falsch." },
              { text: "Dateiname", correct: false, feedback: "Falsch." },
            ],
            explanation: "Die Belastung ist eine technische Auswahlbedingung.",
            source: source("source", "Moodle Quiz 2, Frage 1"),
          },
          {
            id: "connection-app-1",
            type: "application",
            prompt: "Vergleiche eine lösbare und eine unlösbare Verbindung.",
            instructions: ["Nenne je ein Beispiel.", "Erkläre den Unterschied."],
            sampleAnswer: "Eine Schraube ist lösbar, eine Nietverbindung in der Regel nicht zerstörungsfrei.",
            selfCheck: ["Beispiele korrekt", "Unterschied erklärt"],
            source: source("derived", "Abgeleitet aus Skript Kapitel 2: Verbindungsarten"),
          },
          {
            id: "connection-app-2",
            type: "application",
            prompt: "Wähle für einen Wartungsfall eine geeignete Verbindung und begründe.",
            instructions: ["Berücksichtige Wartung.", "Begründe die Auswahl."],
            sampleAnswer: "Eine lösbare Schraubverbindung unterstützt wiederholte Demontage.",
            selfCheck: ["Wartung berücksichtigt", "Auswahl begründet"],
            source: source("derived", "Abgeleitet aus Lernziel Verbindungswahl"),
          },
        ],
        retrieval: [{ prompt: "Was bedeutet lösbar?", answer: "Demontage ohne Zerstörung." }],
      },
    ],
    sources: [{
      id: "course",
      label: "Kursunterlagen",
      url: "",
      coverage: "Toleranzen und Verbindungen",
    }],
  };
}
