import { describe, expect, it } from "vitest";
import type { QuestionBank } from "../adaptiveStudyModel.js";
import {
  emptyLearnerState,
  learnerStateReducer,
  learnerStateStorageKey,
  loadLearnerState,
  parseLearnerState,
  pruneLearnerState,
  resetLearnerStateNamespace,
  saveLearnerState,
  selectQuestionPool,
  selectQuestions,
} from "../learnerState.js";

describe("learner state", () => {
  it("applies the exact answer and mastery transitions without history", () => {
    let state = emptyLearnerState();
    state = learnerStateReducer(state, {
      type: "question/evaluated",
      questionId: "q1",
      outcome: "incorrect",
      draft: "first answer",
    });
    expect(state.questions.q1).toEqual({
      seen: true,
      review: true,
      draft: "first answer",
    });

    state = learnerStateReducer(state, {
      type: "question/evaluated",
      questionId: "q1",
      outcome: "correct",
      draft: "revised answer",
    });
    expect(state.questions.q1).toEqual({
      seen: true,
      draft: "revised answer",
    });

    state = learnerStateReducer(state, {
      type: "question/learned",
      questionId: "q1",
      value: true,
    });
    state = learnerStateReducer(state, {
      type: "question/evaluated",
      questionId: "q1",
      outcome: "correct",
    });
    expect(state.questions.q1.learned).toBe(true);

    state = learnerStateReducer(state, {
      type: "question/evaluated",
      questionId: "q1",
      outcome: "incorrect",
    });
    expect(state.questions.q1).toMatchObject({ review: true });
    expect(state.questions.q1.learned).toBeUndefined();
  });

  it("keeps learned and review exclusive while star remains independent", () => {
    let state = emptyLearnerState();
    state = learnerStateReducer(state, {
      type: "question/starred",
      questionId: "q1",
      value: true,
    });
    state = learnerStateReducer(state, {
      type: "question/review",
      questionId: "q1",
      value: true,
    });
    state = learnerStateReducer(state, {
      type: "question/learned",
      questionId: "q1",
      value: true,
    });
    expect(state.questions.q1).toEqual({
      seen: true,
      learned: true,
      starred: true,
    });

    state = learnerStateReducer(state, {
      type: "question/review",
      questionId: "q1",
      value: true,
    });
    expect(state.questions.q1).toEqual({
      seen: true,
      review: true,
      starred: true,
    });
  });

  it("resets exactly one question or the complete state", () => {
    let state = emptyLearnerState();
    for (const questionId of ["q1", "q2"]) {
      state = learnerStateReducer(state, {
        type: "question/answer",
        questionId,
        draft: `draft-${questionId}`,
      });
    }
    state = learnerStateReducer(state, { type: "question/reset", questionId: "q1" });
    expect(state.questions.q1).toBeUndefined();
    expect(state.questions.q2).toBeDefined();
    expect(learnerStateReducer(state, { type: "guide/reset" })).toEqual(emptyLearnerState());
  });

  it("safely parses, normalizes, and prunes persisted state", () => {
    expect(parseLearnerState("{broken", ["q1"])).toEqual(emptyLearnerState());
    expect(parseLearnerState({ schemaVersion: 2, questions: {} }, ["q1"]))
      .toEqual(emptyLearnerState());
    expect(parseLearnerState({
      schemaVersion: 1,
      questions: {
        q1: {
          seen: false,
          learned: true,
          review: true,
          starred: true,
          draft: "answer",
          attemptHistory: [1, 2, 3],
        },
        removed: { seen: true },
        q2: "bad",
      },
    }, ["q1", "q2"])).toEqual({
      schemaVersion: 1,
      questions: {
        q1: {
          seen: true,
          review: true,
          starred: true,
          draft: "answer",
        },
      },
    });
    expect(pruneLearnerState({
      schemaVersion: 1,
      questions: { q1: { seen: true }, q2: { review: true } },
    }, ["q2"])).toEqual({
      schemaVersion: 1,
      questions: { q2: { seen: true, review: true } },
    });
  });

  it("uses one stable namespace and removes only that namespace on reset", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const key = learnerStateStorageKey("course/a", "artifact 1");
    const otherKey = learnerStateStorageKey("course/a", "artifact 2");
    values.set(otherKey, "keep");
    saveLearnerState(storage, key, {
      schemaVersion: 1,
      questions: { q1: { seen: true, starred: true }, stale: { review: true } },
    }, ["q1"]);

    expect(loadLearnerState(storage, key, ["q1"])).toEqual({
      schemaVersion: 1,
      questions: { q1: { seen: true, starred: true } },
    });
    expect(resetLearnerStateNamespace(storage, key)).toEqual(emptyLearnerState());
    expect(values.has(key)).toBe(false);
    expect(values.get(otherKey)).toBe("keep");
  });

  it("selects state, route, objective, topic, and stage pools in bank order", () => {
    const bank = bankFixture();
    const state = parseLearnerState({
      schemaVersion: 1,
      questions: {
        q1: { seen: true, learned: true },
        q2: { seen: true, review: true, starred: true },
        q4: { seen: true, starred: true },
      },
    });
    expect(selectQuestionPool(bank, state, "continue").map((item) => item.id))
      .toEqual(["q2", "q3", "q4"]);
    expect(selectQuestionPool(bank, state, "review").map((item) => item.id)).toEqual(["q2"]);
    expect(selectQuestionPool(bank, state, "starred").map((item) => item.id)).toEqual(["q2", "q4"]);
    expect(selectQuestionPool(bank, state, "learned").map((item) => item.id)).toEqual(["q1"]);
    expect(selectQuestionPool(bank, state, "minimum").map((item) => item.id)).toEqual(["q1"]);
    expect(selectQuestionPool(bank, state, "depth").map((item) => item.id)).toEqual(["q3"]);
    expect(selectQuestionPool(bank, state, "assessment").map((item) => item.id)).toEqual(["q4"]);
    expect(selectQuestions(bank, state, {
      pool: "continue",
      topicIds: ["topic-b"],
      learningObjectiveIds: ["objective-2"],
      stageIndexes: [3, 4],
    }).map((item) => item.id)).toEqual(["q3", "q4"]);

    bank.items[1].stageIntent = "minimum";
    expect(selectQuestionPool(bank, state, "minimum").map((item) => item.id)).toEqual(["q2"]);
  });
});

function bankFixture(): QuestionBank {
  const item = (
    id: string,
    topicId: string,
    objectiveId: string,
    stageIndex: number,
    stageIntent: QuestionBank["items"][number]["stageIntent"],
  ): QuestionBank["items"][number] => ({
    id,
    legacyExerciseId: id,
    contentHash: "a".repeat(64),
    topicId,
    learningObjectiveIds: [objectiveId],
    type: "application",
    stageIndex,
    stageIntent,
    stageLabel: stageIntent,
    difficulty: "standard",
    estimatedMinutes: 5,
    origin: "study_buddy_generated",
    scopeBasis: {
      topicTitle: topicId,
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
        rendering: false,
      },
      findings: [],
    },
    exercise: {
      id,
      type: "application",
      prompt: "Prompt",
      instructions: ["Instruction"],
      sampleAnswer: "Answer",
      selfCheck: ["Check"],
      source: { label: "source", sourceTask: "task", provenance: "derived" },
    },
  });
  return {
    schemaVersion: 1,
    courseId: "course",
    items: [
      item("q1", "topic-a", "objective-1", 1, "foundation"),
      item("q2", "topic-a", "objective-1", 2, "application"),
      item("q3", "topic-b", "objective-2", 3, "depth"),
      item("q4", "topic-b", "objective-2", 4, "assessment"),
    ],
    coverage: {
      objectiveIds: ["objective-1", "objective-2"],
      coveredObjectiveIds: ["objective-1", "objective-2"],
      missingObjectiveIds: [],
      stageCounts: { foundation: 1, application: 1, depth: 1, assessment: 1 },
    },
  };
}
