import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adaptiveStudyModelSchema,
  buildAdaptiveStudyModel,
  questionBankSchema,
} from "../adaptiveStudyModel.js";
import { composeAssessment } from "../assessmentComposer.js";
import type { AssessmentArchitecturePlan } from "../assessmentArchitecturePlan.js";
import type { AssessmentSolutionSet } from "../assessmentSolutions.js";
import type { StudyGuideContent } from "../studyGuideContent.js";

describe("adaptive Study Builder model", () => {
  it("consumes a verified architecture plan without re-inferring it from course text", () => {
    const plan = assessmentPlanFixture({
      title: "Evidence-defined assessment",
      sections: [{
        title: "Written response",
        questionTypes: ["open-response"],
        deliveryMode: "self-assessed",
        learningObjectiveIds: ["tolerances-objective-1"],
        evidenceExcerpt: "Documented written response task.",
      }],
    });
    const model = buildWithAssessmentPlan(
      contentFixture(),
      "Documented written response task.",
      "de",
      plan,
    );

    expect(adaptiveStudyModelSchema.parse(model)).toEqual(model);
    expect(model.courseBlueprint.modules.map((module) => module.title))
      .toEqual(["Toleranzen", "Verbindungen"]);
    expect(model.assessmentBlueprint).toMatchObject({
      mode: "documented",
      title: "Evidence-defined assessment",
      confidence: "high",
      durationMinutes: 60,
      maxPoints: 100,
      passingPoints: 50,
    });
    expect(model.assessmentBlueprint.sections.map((section) => section.title))
      .toEqual(["Written response"]);
    expect(model.questionBank.items).toHaveLength(9);
    expect(model.questionBank.items.filter((item) => !item.assessmentSectionId).every((item) =>
      item.learningObjectiveIds.length >= 1 &&
      item.review.status === "pending" &&
      item.contentHash.length === 64 &&
      item.referenceSolution?.completeness === "complete" &&
      item.referenceSolution.review.status === "approved" &&
      item.referenceSolution.steps.length >= 2 &&
      item.referenceSolution.finalAnswer.length > 0
    )).toBe(true);
    expect(model.questionBank.items.filter((item) => item.assessmentSectionId))
      .toHaveLength(1);
    expect(model.questionBank.items.map((item) => item.origin))
      .toEqual(expect.arrayContaining([
        "course_original",
        "course_variant",
        "study_buddy_generated",
      ]));
    expect(model.questionBank.coverage.missingObjectiveIds).toEqual([]);
  });

  it("uses a transparent mode=none without a verified plan", () => {
    const model = buildAdaptiveStudyModel(contentFixture(), "Ordinary course material without an exam description.", "en");

    expect(model.assessmentBlueprint.mode).toBe("none");
    expect(model.assessmentBlueprint.title).toBe("No documented assessment architecture");
    expect(model.assessmentBlueprint.durationMinutes).toBeNull();
    expect(model.assessmentBlueprint.maxPoints).toBeNull();
    expect(model.assessmentBlueprint.allowedAids).toEqual([]);
    expect(model.assessmentBlueprint.sections).toEqual([]);
    expect(model.courseBlueprint.learningStages.some((stage) => stage.intent === "assessment"))
      .toBe(false);
  });

  it("does not materialize a documented assessment source item without a stable extraction evidence reference", () => {
    const plan = assessmentPlanFixture({
      withEvidenceRefs: false,
      sections: [{
        title: "Documented response",
        questionTypes: ["open-response"],
        deliveryMode: "self-assessed",
        learningObjectiveIds: ["tolerances-objective-1"],
        evidenceExcerpt: "Documented response task.",
      }],
    });
    const model = buildWithAssessmentPlan(contentFixture(), "Documented response task.", "en", plan);
    expect(model.assessmentBlueprint.mode).toBe("documented");
    expect(model.questionBank.items.some((item) => item.assessmentSectionId)).toBe(false);
  });

  it("binds every explicitly evidenced objective and seals the stable evidence capsule", () => {
    const model = buildAdaptiveStudyModel(contentFixture(), "Course evidence.", "en");
    const item = model.questionBank.items.find((candidate) => candidate.legacyExerciseId === "tolerance-app")!;

    expect(item.learningObjectiveIds).toEqual([
      "tolerances-objective-1",
      "tolerances-objective-2",
    ]);
    expect(item.scopeBasis.learningObjectives).toEqual([
      "Grenzmaße unterscheiden",
      "Passungen berechnen",
    ]);
    expect(item.scopeBasis.evidenceRefs).toEqual([{
      sourceIds: ["course"],
      sectionIndex: 0,
      sectionHeading: "Toleranzen",
      learningGoalIndexes: [0, 1],
    }]);
    expect(item.scopeBasis.evidenceHash).toMatch(/^[a-f0-9]{64}$/);

    const tampered = structuredClone(model.questionBank);
    tampered.items.find((candidate) => candidate.id === item.id)!
      .scopeBasis.evidenceRefs![0]!.sectionHeading = "Unrelated section";
    expect(() => questionBankSchema.parse(tampered)).toThrow(/evidence hash/i);
  });

  it("does not invent retrieval provenance when no evidence capsule was generated", () => {
    const content = contentFixture();
    content.topics[0]!.retrieval[0]!.evidenceRefs = undefined;
    const model = buildAdaptiveStudyModel(content, "Course evidence.", "en");
    expect(model.questionBank.items.some((item) => item.legacyExerciseId === "tolerances-retrieval-1"))
      .toBe(false);
  });

  it("does not promote a mere assessment mention or course name without a plan", () => {
    const model = buildAdaptiveStudyModel(
      contentFixture(),
      "Im Moodle-Kurs wird eine Musterprüfung erwähnt, aber Aufbau, Teile und Aufgabenanzahl sind nicht dokumentiert.",
      "de",
    );

    expect(model.assessmentBlueprint.mode).toBe("none");
    expect(model.assessmentBlueprint.title).toBe("Keine dokumentierte Prüfungsarchitektur");
    expect(model.assessmentBlueprint.confidence).toBe("low");
    expect(model.assessmentBlueprint.sections).toEqual([]);
  });

  it("keeps the explicit plan stable when only the course name changes", () => {
    const plan = assessmentPlanFixture({
      sections: [{
        title: "Open response",
        questionTypes: ["open-response"],
        deliveryMode: "self-assessed",
        learningObjectiveIds: ["tolerances-objective-1"],
        evidenceExcerpt: "Write the documented response.",
      }],
    });
    const first = buildWithAssessmentPlan(contentFixture(), "Write the documented response.", "en", plan);
    const renamed = contentFixture();
    renamed.courseTitle = "A completely different discipline label";
    renamed.courseCode = "OTHER";
    const second = buildWithAssessmentPlan(renamed, "Write the documented response.", "en", plan);
    expect(second.assessmentBlueprint).toEqual(first.assessmentBlueprint);
  });

  it("composes contract-authorized inferred practice from normal bank items without synthetic source tasks", () => {
    const plan = assessmentPlanFixture({
      mode: "inferred_practice",
      sections: [{
        title: "Objective-aligned selection practice",
        questionTypes: ["selection"],
        deliveryMode: "interactive",
        learningObjectiveIds: ["tolerances-objective-1"],
        evidenceExcerpt: "Grenzmaße unterscheiden",
      }],
    });
    const model = buildWithAssessmentPlan(contentFixture(), "No documented assessment.", "de", plan);
    const composition = composeAssessment(model.assessmentBlueprint, model.questionBank);
    expect(model.questionBank.items.some((item) => item.assessmentSectionId)).toBe(false);
    expect(composition.simulationKind).toBe("exercise_simulation");
    expect(composition.sections[0]?.items.some((item) => item.type === "cross")).toBe(true);
  });

  it("leaves unsupported evaluator-authored types as visible coverage gaps", () => {
    const plan = assessmentPlanFixture({
      sections: [{
        title: "Custom response",
        questionTypes: ["open-response", "custom-demonstration"],
        deliveryMode: "self-assessed",
        learningObjectiveIds: ["tolerances-objective-1"],
        evidenceExcerpt: "Perform the documented custom demonstration.",
      }],
    });
    const model = buildWithAssessmentPlan(contentFixture(), "Perform the documented custom demonstration.", "en", plan);
    const composition = composeAssessment(model.assessmentBlueprint, model.questionBank);
    expect(model.questionBank.items.some((item) => item.assessmentSectionId)).toBe(false);
    expect(composition.sections[0]?.uncoveredQuestionTypes).toContain("custom-demonstration");
  });

  it("fails closed when a plan is tampered after binding", () => {
    const plan = assessmentPlanFixture({
      sections: [{
        title: "Original title",
        questionTypes: ["open-response"],
        deliveryMode: "self-assessed",
        learningObjectiveIds: ["tolerances-objective-1"],
        evidenceExcerpt: "Write the documented response.",
      }],
    });
    const tampered = structuredClone(plan);
    tampered.sections[0]!.title = "Tampered title";
    expect(() => buildWithAssessmentPlan(contentFixture(), "Write the documented response.", "en", tampered))
      .toThrow(/content hash mismatch/i);
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

  it("preserves evaluator-authored cross-discipline question types and capabilities losslessly", () => {
    const variants = [
      { type: "calculation", mode: "interactive" as const },
      { type: "oral-presentation", mode: "external-performance" as const },
      { type: "essay", mode: "self-assessed" as const },
      { type: "vocabulary-recall", mode: "interactive" as const },
      { type: "case-or-lab-response", mode: "self-assessed" as const },
    ];
    for (const [index, variant] of variants.entries()) {
      const evidenceExcerpt = `Documented assessment task ${index + 1}.`;
      const plan = assessmentPlanFixture({
        title: `Architecture ${index + 1}`,
        sections: [{
          title: `Section ${index + 1}`,
          questionTypes: [variant.type],
          deliveryMode: variant.mode,
          learningObjectiveIds: ["tolerances-objective-1"],
          evidenceExcerpt,
        }],
      });
      const model = buildWithAssessmentPlan(contentFixture(), evidenceExcerpt, "en", plan);
      expect(model.assessmentBlueprint.sections[0]).toMatchObject({
        questionTypes: [variant.type],
        deliveryMode: variant.mode,
      });
    }
  });

  it("turns documented sample-exam tasks into authentic assessment items instead of metadata trivia", () => {
    const calculationTask = "Für eine Welle sind Go = 50,030 mm und Gu = 49,990 mm gegeben. Bestimmen Sie die Maßtoleranz mit Rechenweg und Einheit.";
    const responseTask = "Analysieren Sie die belastete Verbindung und begründen Sie den maßgebenden Nachweis nachvollziehbar.";
    const plan = assessmentPlanFixture({
      sections: [
        {
          title: "Toleranzrechnung",
          questionTypes: ["calculation"],
          deliveryMode: "interactive",
          learningObjectiveIds: ["tolerances-objective-1"],
          evidenceExcerpt: calculationTask,
        },
        {
          title: "Verbindungsanalyse",
          questionTypes: ["open-response"],
          deliveryMode: "self-assessed",
          learningObjectiveIds: ["connections-objective-1"],
          evidenceExcerpt: responseTask,
        },
      ],
    });
    const model = buildWithAssessmentPlan(contentFixture(), `${calculationTask}\n${responseTask}`, "de", plan, {
      schemaVersion: 1,
      items: [1, 2].map((index) => ({
        legacyExerciseId: `assessment-source-task-assessment-section-${String(index).padStart(20, "0")}`,
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
      item.stageIntent === "minimum" &&
      item.difficulty === "standard" &&
      item.origin === "course_original" &&
      item.referenceSolution?.completeness === "complete" &&
      item.referenceSolution.review.status === "approved"
    )).toBe(true);
    expect(sourceTasks.map((item) => item.type)).toEqual([
      "calculation",
      "application",
    ]);
    expect(sourceTasks.map((item) => item.exercise.prompt).join(" "))
      .not.toMatch(/welche.*themen.*musterprüfung/i);
    expect(sourceTasks[0].exercise.type === "calculation" &&
      sourceTasks[0].exercise.givens.join(" ")).toContain("50,030 mm");
    expect(sourceTasks[0].exercise.type === "calculation" &&
      sourceTasks[0].exercise.steps.join(" ")).toContain("Ausgangsbeziehung");
    expect(sourceTasks[1].exercise.type).toBe("application");
    expect(sourceTasks[1].exercise).not.toHaveProperty("givens");
    expect(sourceTasks[1].exercise).not.toHaveProperty("unit");
    expect(sourceTasks[1].exercise).not.toHaveProperty("steps");
  });

  it("preserves calculation versus English external open-response semantics", () => {
    const calculationTask = "Calculate the documented result, show the governing relation, and report its unit.";
    const presentationTask = "Deliver a coherent presentation supported by course evidence and respond to audience questions.";
    const plan = assessmentPlanFixture({
      sections: [
        {
          title: "Force calculation",
          questionTypes: ["calculation"],
          deliveryMode: "interactive",
          learningObjectiveIds: ["tolerances-objective-1"],
          evidenceExcerpt: calculationTask,
        },
        {
          title: "Pecha Kucha presentation",
          questionTypes: ["open-response"],
          deliveryMode: "external-performance",
          learningObjectiveIds: ["connections-objective-1"],
          evidenceExcerpt: presentationTask,
        },
      ],
    });
    const model = buildWithAssessmentPlan(contentFixture(), `${calculationTask}\n${presentationTask}`, "en", plan, {
      schemaVersion: 1,
      items: [{
        legacyExerciseId: "assessment-source-task-assessment-section-00000000000000000001",
        completeness: "complete",
        summary: "Complete calculation solution.",
        steps: ["Write the governing relation.", "Substitute the documented values."],
        finalAnswer: "Documented final result.",
        assumptions: [],
        evidenceBasis: [calculationTask],
        missingEvidence: [],
        solutionOrigin: "study_buddy_generated",
        review: { status: "approved", findings: [] },
      }],
    });
    const sourceTasks = model.questionBank.items.filter((item) =>
      item.legacyExerciseId.startsWith("assessment-source-task-")
    );

    expect(model.assessmentBlueprint.sections.map((section) => ({
      types: section.questionTypes,
      deliveryMode: section.deliveryMode,
    }))).toEqual([
      { types: ["calculation"], deliveryMode: "interactive" },
      { types: ["open-response"], deliveryMode: "external-performance" },
    ]);
    expect(sourceTasks.map((item) => item.type)).toEqual(["calculation"]);
    const calculation = sourceTasks[0]!;
    expect(calculation.exercise.type).toBe("calculation");
    expect(calculation.exercise).toHaveProperty("givens");

    const composition = composeAssessment(model.assessmentBlueprint, model.questionBank);
    expect(composition.excludedSections.map((section) => section.title))
      .toContain("Pecha Kucha presentation");
    expect(composition.sections.flatMap((section) => section.items).map((item) => item.id))
      .not.toContain(expect.stringContaining("presentation"));
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

function buildWithAssessmentPlan(
  content: StudyGuideContent,
  sourceText: string,
  language: "de" | "en",
  plan: AssessmentArchitecturePlan,
  solutions?: AssessmentSolutionSet,
) {
  return buildAdaptiveStudyModel(
    content,
    sourceText,
    language,
    solutions,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    plan,
  );
}

function assessmentPlanFixture(input: {
  title?: string;
  mode?: "documented" | "inferred_practice";
  withEvidenceRefs?: boolean;
  sections: Array<{
    title: string;
    questionTypes: string[];
    deliveryMode: "interactive" | "self-assessed" | "external-performance";
    learningObjectiveIds: string[];
    evidenceExcerpt: string;
  }>;
}): AssessmentArchitecturePlan {
  const hash = "a".repeat(64);
  const mode = input.mode ?? "documented";
  const content = {
    title: input.title ?? "Documented assessment",
    mode,
    confidence: mode === "documented" ? "high" as const : "medium" as const,
    durationMinutes: mode === "documented" ? 60 : null,
    maxPoints: mode === "documented" ? 100 : null,
    passingPoints: mode === "documented" ? 50 : null,
    allowedAids: [],
    prohibitedAids: [],
    basisRequirementIds: mode === "inferred_practice" ? ["interactive-preparation"] : [],
    rationale: mode === "documented"
      ? "The evaluator retained only the explicitly documented assessment architecture."
      : "This is contract-authorized Study Buddy practice rather than an official assessment structure.",
    sections: input.sections.map((section, index) => ({
      ...section,
      id: `assessment-section-${String(index + 1).padStart(20, "0")}`,
      evidenceLevel: mode === "documented" ? "explicit" as const : "derived" as const,
      taskCount: mode === "documented" ? 1 : null,
      points: null,
      weight: null,
      durationMinutes: null,
      ...(mode === "documented" && input.withEvidenceRefs !== false
        ? {
            evidenceRefs: [{
              sourceIds: ["course"],
              sectionIndex: index,
              sectionHeading: `Evidence section ${index + 1}`,
              learningGoalIndexes: [0],
            }],
          }
        : {}),
    })),
  };
  return {
    schemaVersion: 1,
    binding: {
      cacheVersion: "assessment-architecture-v1-open-contract",
      contractHash: hash,
      originalPromptHash: hash,
      courseHash: hash,
      evidenceHash: hash,
      semanticCacheKey: hash,
    },
    contentHash: createHash("sha256").update(canonicalJson(content)).digest("hex"),
    ...content,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentFixture(): StudyGuideContent {
  const source = (provenance: "source" | "adapted" | "derived", task: string) => ({
    label: "Kursunterlagen",
    sourceTask: task,
    provenance,
  });
  const evidence = (sectionIndex: number, sectionHeading: string, learningGoalIndexes: number[]) => [{
    sourceIds: ["course"],
    sectionIndex,
    sectionHeading,
    learningGoalIndexes,
  }];
  return {
    courseTitle: "Cross-course Test",
    courseCode: "CCT",
    scopeNote: "Only the supplied course objectives are in scope.",
    topics: [
      {
        id: "tolerances",
        title: "Toleranzen",
        evidenceRefs: evidence(0, "Toleranzen", [0, 1]),
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
            evidenceRefs: evidence(0, "Toleranzen", [0]),
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
            evidenceRefs: evidence(0, "Toleranzen", [1]),
          },
          {
            id: "tolerance-app",
            type: "application",
            prompt: "Begründe, wie eine Passung anhand ihrer Grenzmaße beurteilt wird.",
            instructions: ["Vergleiche Bohrung und Welle.", "Begründe die mögliche Passungsart."],
            sampleAnswer: "Die kleinsten und größten möglichen Maße werden paarweise verglichen.",
            selfCheck: ["Grenzfälle genannt", "Passungsart begründet"],
            source: source("derived", "Abgeleitet aus Skript Kapitel 1: Passungsarten"),
            evidenceRefs: evidence(0, "Toleranzen", [0, 1]),
          },
        ],
        retrieval: [{ prompt: "Was ist eine Toleranz?", answer: "Die Differenz der Grenzmaße.", evidenceRefs: evidence(0, "Toleranzen", [0]) }],
      },
      {
        id: "connections",
        title: "Verbindungen",
        evidenceRefs: evidence(1, "Verbindungen", [0]),
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
            evidenceRefs: evidence(1, "Verbindungen", [0]),
          },
          {
            id: "connection-app-1",
            type: "application",
            prompt: "Vergleiche eine lösbare und eine unlösbare Verbindung.",
            instructions: ["Nenne je ein Beispiel.", "Erkläre den Unterschied."],
            sampleAnswer: "Eine Schraube ist lösbar, eine Nietverbindung in der Regel nicht zerstörungsfrei.",
            selfCheck: ["Beispiele korrekt", "Unterschied erklärt"],
            source: source("derived", "Abgeleitet aus Skript Kapitel 2: Verbindungsarten"),
            evidenceRefs: evidence(1, "Verbindungen", [0]),
          },
          {
            id: "connection-app-2",
            type: "application",
            prompt: "Wähle für einen Wartungsfall eine geeignete Verbindung und begründe.",
            instructions: ["Berücksichtige Wartung.", "Begründe die Auswahl."],
            sampleAnswer: "Eine lösbare Schraubverbindung unterstützt wiederholte Demontage.",
            selfCheck: ["Wartung berücksichtigt", "Auswahl begründet"],
            source: source("derived", "Abgeleitet aus Lernziel Verbindungswahl"),
            evidenceRefs: evidence(1, "Verbindungen", [0]),
          },
        ],
        retrieval: [{ prompt: "Was bedeutet lösbar?", answer: "Demontage ohne Zerstörung.", evidenceRefs: evidence(1, "Verbindungen", [0]) }],
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
