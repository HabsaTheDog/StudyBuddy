import { describe, expect, it } from "vitest";
import type {
  AssessmentBlueprint,
  QuestionBank,
} from "../adaptiveStudyModel.js";
import { composeAssessment } from "../assessmentComposer.js";

describe("assessment composer", () => {
  it("preserves documented structure and values while selecting each item at most once", () => {
    const blueprint = blueprintFixture();
    const result = composeAssessment(blueprint, bankFixture());

    expect(result.simulationKind).toBe("exam_simulation");
    expect(result.documented).toEqual({
      durationMinutes: 60,
      maxPoints: 100,
      passingPoints: 50,
      allowedAids: ["calculator"],
      prohibitedAids: ["notes"],
    });
    expect(result.sections.map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      documented: section.documented,
    }))).toEqual([
      {
        id: "theory",
        title: "Theory",
        order: 0,
        documented: { taskCount: null, points: 40, weight: 0.4, durationMinutes: 20 },
      },
      {
        id: "calculation",
        title: "Calculation",
        order: 1,
        documented: { taskCount: null, points: 60, weight: 0.6, durationMinutes: 40 },
      },
    ]);
    const selectedIds = result.sections.flatMap((section) =>
      section.items.map((item) => item.id)
    );
    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    expect(selectedIds).toEqual(expect.arrayContaining([
      "q-selection-assessment",
      "q-calc-assessment",
    ]));
    expect(result.insufficiency).toContain(
      "At least one assessment section has no documented task count; a bounded representative practice selection is inferred and is not presented as an official count.",
    );
  });

  it("is deterministic across question-bank input order and prioritizes assessment-stage items", () => {
    const blueprint = blueprintFixture();
    const bank = bankFixture();
    const forward = composeAssessment(blueprint, bank);
    const reverse = composeAssessment(blueprint, {
      ...bank,
      items: [...bank.items].reverse(),
    });
    const ids = (result: ReturnType<typeof composeAssessment>) =>
      result.sections.map((section) => section.items.map((item) => item.id));

    expect(ids(reverse)).toEqual(ids(forward));
    expect(forward.sections[0].items[0].id).toBe("q-selection-assessment");
  });

  it("keeps incompatible items unassigned and reports section insufficiency transparently", () => {
    const blueprint = blueprintFixture();
    blueprint.sections.push({
      id: "flashcards",
      title: "Vocabulary",
      order: 2,
      evidenceLevel: "derived",
      deliveryMode: "interactive",
      points: null,
      weight: null,
      durationMinutes: null,
      questionTypes: ["flashcard"],
      learningObjectiveIds: ["objective-missing"],
    });
    const bank = bankFixture();
    bank.items.push(questionItem("q-unrelated", "application", "objective-other", "application"));

    const result = composeAssessment(blueprint, bank);
    const flashcards = result.sections.find((section) => section.id === "flashcards")!;
    expect(result.support).toBe("insufficient");
    expect(flashcards.items).toEqual([]);
    expect(flashcards.uncoveredQuestionTypes).toEqual(["flashcard"]);
    expect(flashcards.uncoveredLearningObjectiveIds).toEqual(["objective-missing"]);
    expect(flashcards.insufficiency).toEqual([
      "No compatible approved question-bank item is available.",
      "Missing response types: flashcard.",
      "Missing learning objectives: objective-missing.",
    ]);
    expect(result.unassignedQuestionIds).toContain("q-unrelated");
  });

  it("does not expose an empty assessment surface when no approved item can be composed", () => {
    const result = composeAssessment(blueprintFixture(), {
      ...bankFixture(),
      items: [],
    });

    expect(result.simulationKind).toBe("none");
    expect(result.support).toBe("insufficient");
    expect(result.sections.every((section) => section.items.length === 0)).toBe(true);
    expect(result.evidenceNotes).toContain(
      "No compatible approved item is available for a separate assessment surface; ordinary reviewed practice remains available in the course topics and question catalogue.",
    );
  });

  it("never upgrades inferred or low-confidence structure to an exam claim", () => {
    const inferred = blueprintFixture();
    inferred.mode = "inferred_practice";
    inferred.title = "Exercise simulation based on course structure";
    inferred.durationMinutes = null;
    inferred.maxPoints = null;
    inferred.passingPoints = null;
    inferred.allowedAids = [];
    inferred.prohibitedAids = [];
    inferred.sections = inferred.sections.map((section) => ({
      ...section,
      evidenceLevel: "derived",
      points: null,
      weight: null,
      durationMinutes: null,
    }));
    const inferredResult = composeAssessment(inferred, bankFixture());
    expect(inferredResult.simulationKind).toBe("exercise_simulation");
    expect(inferredResult.documented).toMatchObject({
      durationMinutes: null,
      maxPoints: null,
      passingPoints: null,
      allowedAids: [],
      prohibitedAids: [],
    });
    expect(inferredResult.evidenceNotes).toContain(
      "This is contract-authorized Study Buddy practice derived from course objectives, not an official assessment structure.",
    );

    const lowConfidence = blueprintFixture();
    lowConfidence.confidence = "low";
    const lowResult = composeAssessment(lowConfidence, bankFixture());
    expect(lowResult.simulationKind).toBe("exercise_simulation");
    expect(lowResult.evidenceNotes).toContain(
      "Explicit assessment evidence has low confidence; official exam status is not claimed.",
    );
  });

  it("uses objective and response-type constraints rather than section names", () => {
    const blueprint = blueprintFixture();
    blueprint.sections = [
      {
        id: "opaque-b",
        title: "Teil B",
        order: 1,
        evidenceLevel: "explicit",
        deliveryMode: "self-assessed",
        points: null,
        weight: null,
        durationMinutes: null,
        questionTypes: ["open-response"],
        learningObjectiveIds: ["objective-2"],
      },
      {
        id: "opaque-a",
        title: "Teil A",
        order: 0,
        evidenceLevel: "explicit",
        deliveryMode: "interactive",
        points: null,
        weight: null,
        durationMinutes: null,
        questionTypes: ["calculation"],
        learningObjectiveIds: ["objective-1"],
      },
    ];
    const result = composeAssessment(blueprint, bankFixture());
    expect(result.sections.map((section) => section.id)).toEqual(["opaque-a", "opaque-b"]);
    expect(result.sections[0].items.every((item) =>
      item.type === "calculation" &&
      item.learningObjectiveIds.includes("objective-1")
    )).toBe(true);
    expect(result.sections[1].items.every((item) =>
      item.type === "application" &&
      item.learningObjectiveIds.includes("objective-2")
    )).toBe(true);
  });

  it("does not duplicate questions even when section IDs collide", () => {
    const blueprint = blueprintFixture();
    blueprint.sections[1].id = blueprint.sections[0].id;
    const result = composeAssessment(blueprint, bankFixture());
    const selectedIds = result.sections.flatMap((section) =>
      section.items.map((item) => item.id)
    );
    expect(new Set(selectedIds).size).toBe(selectedIds.length);
  });

  it("never uses questions about exam metadata as simulated exam tasks", () => {
    const blueprint = blueprintFixture();
    const bank = bankFixture();
    const meta = bank.items.find((item) => item.id === "q-selection-assessment")!;
    meta.exercise = {
      ...meta.exercise,
      prompt: "Welche drei Themen umfasst die Musterprüfung?",
    };
    meta.scopeBasis.sourceTask = "Übersicht der Musterprüfung";

    const result = composeAssessment(blueprint, bank);
    const selectedIds = result.sections.flatMap((section) =>
      section.items.map((item) => item.id)
    );

    expect(selectedIds).not.toContain("q-selection-assessment");
    expect(selectedIds).toContain("q-selection");
  });

  it("honors documented task counts instead of filling the exam with every compatible item", () => {
    const blueprint = blueprintFixture();
    blueprint.sections = blueprint.sections.map((section) => ({
      ...section,
      taskCount: 1,
    }));

    const result = composeAssessment(blueprint, bankFixture());

    expect(result.sections.every((section) => section.items.length === 1)).toBe(true);
    expect(result.insufficiency).not.toContain(
      "At least one assessment section has no documented task count; a bounded representative practice selection is inferred and is not presented as an official count.",
    );
  });

  it("bounds inferred practice sessions instead of loading the complete question bank", () => {
    const blueprint = blueprintFixture();
    blueprint.mode = "inferred_practice";
    blueprint.confidence = "low";
    blueprint.durationMinutes = null;
    blueprint.sections = blueprint.sections.map((section) => ({
      ...section,
      evidenceLevel: "derived",
      taskCount: null,
      durationMinutes: null,
    }));
    const bank = bankFixture();
    bank.items = Array.from({ length: 40 }, (_, index) =>
      questionItem(
        `q-${index}`,
        index % 2 === 0 ? "cross" : "calculation",
        "objective-1",
        index % 3 === 0 ? "assessment" : "application",
      )
    );

    const result = composeAssessment(blueprint, bank);

    expect(result.sections).toHaveLength(2);
    expect(result.sections.every((section) =>
      section.selectionLimit === 1 &&
      section.selectionLimitBasis === "inferred_practice_session" &&
      section.items.length <= section.selectionLimit
    )).toBe(true);
    expect(result.sections.flatMap((section) => section.items)).toHaveLength(2);
    expect(result.unassignedQuestionIds).toHaveLength(38);
  });

  it("does not derive unknown task counts from assessment weight or duration", () => {
    const baseline = composeAssessment(blueprintFixture(), bankFixture());
    const altered = blueprintFixture();
    altered.durationMinutes = 600;
    altered.sections = altered.sections.map((section, index) => ({
      ...section,
      weight: index === 0 ? 0.99 : 0.01,
      durationMinutes: index === 0 ? 599 : 1,
    }));

    const ids = (result: ReturnType<typeof composeAssessment>) =>
      result.sections.map((section) => section.items.map((item) => item.id));
    expect(ids(composeAssessment(altered, bankFixture()))).toEqual(ids(baseline));
    expect(composeAssessment(altered, bankFixture()).sections.map((section) => section.selectionLimit))
      .toEqual(baseline.sections.map((section) => section.selectionLimit));
  });

  it("excludes externally judged performance and normalizes the useful online test", () => {
    const blueprint = blueprintFixture();
    blueprint.sections = [
      {
        id: "presentation",
        title: "Pecha Kucha presentation",
        order: 0,
        evidenceLevel: "explicit",
        deliveryMode: "external-performance",
        points: null,
        weight: 0.6,
        durationMinutes: null,
        questionTypes: ["open-response"],
        learningObjectiveIds: ["objective-2"],
      },
      {
        id: "oral",
        title: "Content questions answered orally",
        order: 1,
        evidenceLevel: "explicit",
        deliveryMode: "external-performance",
        points: null,
        weight: 0.3,
        durationMinutes: null,
        questionTypes: ["open-response"],
        learningObjectiveIds: ["objective-2"],
      },
      {
        id: "vocabulary",
        title: "Vocabulary test",
        order: 2,
        evidenceLevel: "explicit",
        deliveryMode: "interactive",
        points: null,
        weight: 0.1,
        durationMinutes: null,
        questionTypes: ["flashcard"],
        learningObjectiveIds: ["objective-1"],
      },
    ];
    const bank = bankFixture();
    bank.items = Array.from({ length: 14 }, (_, index) =>
      questionItem(`vocab-${index}`, "vocabulary", "objective-1", "assessment")
    );

    const result = composeAssessment(blueprint, bank);

    expect(result.sections.map((section) => section.id)).toEqual(["vocabulary"]);
    expect(result.sections[0].selectionLimit).toBe(14);
    expect(result.sections[0].items).toHaveLength(14);
    expect(result.excludedSections.map((section) => section.id)).toEqual(["presentation", "oral"]);
    expect(result.sections.flatMap((section) => section.items).every((item) =>
      item.type === "vocabulary"
    )).toBe(true);
  });
});

function blueprintFixture(): AssessmentBlueprint {
  return {
    schemaVersion: 1,
    mode: "documented",
    title: "Exam simulation",
    confidence: "high",
    durationMinutes: 60,
    maxPoints: 100,
    passingPoints: 50,
    allowedAids: ["calculator"],
    prohibitedAids: ["notes"],
    sections: [
      {
        id: "calculation",
        title: "Calculation",
        order: 1,
        evidenceLevel: "explicit",
        deliveryMode: "interactive",
        points: 60,
        weight: 0.6,
        durationMinutes: 40,
        questionTypes: ["calculation"],
        learningObjectiveIds: ["objective-1"],
      },
      {
        id: "theory",
        title: "Theory",
        order: 0,
        evidenceLevel: "explicit",
        deliveryMode: "interactive",
        points: 40,
        weight: 0.4,
        durationMinutes: 20,
        questionTypes: ["selection", "open-response"],
        learningObjectiveIds: ["objective-1", "objective-2"],
      },
    ],
    evidence: [{
      level: "explicit",
      label: "Exam instructions",
      excerpt: "60 minutes, 100 points, theory followed by calculation.",
    }],
  };
}

function bankFixture(): QuestionBank {
  const items = [
    questionItem("q-selection", "cross", "objective-1", "foundation"),
    questionItem("q-selection-assessment", "cross", "objective-2", "assessment"),
    questionItem("q-open", "application", "objective-2", "depth"),
    questionItem("q-calc", "calculation", "objective-1", "application"),
    questionItem("q-calc-assessment", "calculation", "objective-1", "assessment"),
  ];
  return {
    schemaVersion: 1,
    courseId: "course",
    items,
    coverage: {
      objectiveIds: ["objective-1", "objective-2"],
      coveredObjectiveIds: ["objective-1", "objective-2"],
      missingObjectiveIds: [],
      stageCounts: {},
    },
  };
}

function questionItem(
  id: string,
  type: QuestionBank["items"][number]["type"],
  objectiveId: string,
  stageIntent: QuestionBank["items"][number]["stageIntent"],
): QuestionBank["items"][number] {
  const exercise = type === "cross"
    ? {
        id,
        type: "cross" as const,
        prompt: "Prompt",
        selectionMode: "single" as const,
        options: [
          { text: "Correct", correct: true, feedback: "Correct" },
          { text: "Wrong", correct: false, feedback: "Wrong" },
        ],
        explanation: "Explanation",
        source: { label: "source", sourceTask: "task", provenance: "source" as const },
      }
    : type === "vocabulary"
      ? {
          id,
          type: "vocabulary" as const,
          prompt: "Translate or explain the course term.",
          direction: "term-to-meaning" as const,
          term: `term-${id}`,
          acceptedAnswers: [`meaning-${id}`],
          context: "The term appears in the supported business course context.",
          explanation: "This meaning is supported by the selected course topic.",
          source: { label: "source", sourceTask: "course vocabulary", provenance: "derived" as const },
        }
      : type === "calculation"
      ? {
          id,
          type: "calculation" as const,
          prompt: "Prompt",
          givens: ["x = 1"],
          acceptedAnswers: ["1"],
          unit: "",
          steps: ["Calculate"],
          commonMistake: "None",
          source: { label: "source", sourceTask: "task", provenance: "adapted" as const },
        }
      : {
          id,
          type: "application" as const,
          prompt: "Prompt",
          instructions: ["Explain"],
          sampleAnswer: "Answer",
          selfCheck: ["Check"],
          source: { label: "source", sourceTask: "task", provenance: "derived" as const },
        };
  return {
    id,
    legacyExerciseId: id,
    contentHash: "a".repeat(64),
    topicId: "topic",
    learningObjectiveIds: [objectiveId],
    type,
    stageIndex: stageIntent === "assessment" ? 4 : stageIntent === "depth" ? 3 : stageIntent === "application" ? 2 : 1,
    stageIntent,
    stageLabel: stageIntent,
    difficulty: stageIntent === "assessment" ? "assessment" : "standard",
    estimatedMinutes: 5,
    origin: "course_original",
    scopeBasis: {
      topicTitle: "Topic",
      learningObjectives: [objectiveId],
      sourceLabel: "source",
      sourceTask: "task",
    },
    review: {
      status: "pending",
      checks: {
        schema: false,
        scope: false,
        answer: false,
        provenance: false,
        rendering: false, selfContained: false, feedback: false,
      },
      findings: [],
    },
    exercise,
  };
}
