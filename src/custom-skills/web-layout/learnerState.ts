import type { QuestionBank } from "./adaptiveStudyModel.js";

export const LEARNER_STATE_SCHEMA_VERSION = 1 as const;
export const LEARNER_STATE_STORAGE_PREFIX = "study-buddy:study-builder";

const MAX_SAVED_QUESTIONS = 10_000;
const MAX_DRAFT_LENGTH = 20_000;
const unsafeRecordKeys = new Set(["__proto__", "constructor", "prototype"]);

export interface LearnerQuestionState {
  seen?: true;
  learned?: true;
  review?: true;
  starred?: true;
  draft?: string;
}

export interface LearnerState {
  schemaVersion: typeof LEARNER_STATE_SCHEMA_VERSION;
  questions: Record<string, LearnerQuestionState>;
}

export type LearnerStateAction =
  | { type: "question/open"; questionId: string }
  | { type: "question/answer"; questionId: string; draft: string }
  | {
      type: "question/evaluated";
      questionId: string;
      outcome: "correct" | "incorrect";
      draft?: string;
    }
  | { type: "question/learned"; questionId: string; value: boolean }
  | { type: "question/review"; questionId: string; value: boolean }
  | { type: "question/starred"; questionId: string; value: boolean }
  | { type: "question/reset"; questionId: string }
  | { type: "guide/reset" };

export type QuestionPool =
  | "all"
  | "continue"
  | "review"
  | "starred"
  | "learned"
  | "minimum"
  | "depth"
  | "assessment";

export interface QuestionFilter {
  pool?: QuestionPool;
  topicIds?: readonly string[];
  learningObjectiveIds?: readonly string[];
  stageIndexes?: readonly number[];
}

export interface LearnerStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyLearnerState(): LearnerState {
  return {
    schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
    questions: {},
  };
}

export function learnerStateStorageKey(courseId: string, artifactId: string): string {
  return [
    LEARNER_STATE_STORAGE_PREFIX,
    `v${LEARNER_STATE_SCHEMA_VERSION}`,
    encodeURIComponent(courseId),
    encodeURIComponent(artifactId),
  ].join(":");
}

export function learnerStateReducer(
  state: LearnerState,
  action: LearnerStateAction,
): LearnerState {
  if (action.type === "guide/reset") return emptyLearnerState();
  if (!isSafeQuestionId(action.questionId)) return state;

  if (action.type === "question/reset") {
    if (!(action.questionId in state.questions)) return state;
    const questions = { ...state.questions };
    delete questions[action.questionId];
    return { schemaVersion: LEARNER_STATE_SCHEMA_VERSION, questions };
  }

  const previous = state.questions[action.questionId] ?? {};
  const next: LearnerQuestionState = { ...previous, seen: true };

  switch (action.type) {
    case "question/open":
      break;
    case "question/answer":
      setDraft(next, action.draft);
      break;
    case "question/evaluated":
      if (action.draft !== undefined) setDraft(next, action.draft);
      if (action.outcome === "incorrect") {
        delete next.learned;
        next.review = true;
      } else {
        delete next.review;
      }
      break;
    case "question/learned":
      if (action.value) {
        next.learned = true;
        delete next.review;
      } else {
        delete next.learned;
      }
      break;
    case "question/review":
      if (action.value) {
        next.review = true;
        delete next.learned;
      } else {
        delete next.review;
      }
      break;
    case "question/starred":
      if (action.value) next.starred = true;
      else delete next.starred;
      break;
  }

  return {
    schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
    questions: {
      ...state.questions,
      [action.questionId]: next,
    },
  };
}

export function parseLearnerState(
  value: string | unknown,
  validQuestionIds?: Iterable<string>,
): LearnerState {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return emptyLearnerState();
    }
  }
  if (!isRecord(candidate) ||
      candidate.schemaVersion !== LEARNER_STATE_SCHEMA_VERSION ||
      !isRecord(candidate.questions)) {
    return emptyLearnerState();
  }

  const allowed = validQuestionIds
    ? new Set([...validQuestionIds].filter(isSafeQuestionId))
    : null;
  const questions: Record<string, LearnerQuestionState> = {};
  for (const [questionId, raw] of Object.entries(candidate.questions).slice(0, MAX_SAVED_QUESTIONS)) {
    if (!isSafeQuestionId(questionId) || (allowed && !allowed.has(questionId)) || !isRecord(raw)) {
      continue;
    }
    const question = normalizeQuestionState(raw);
    if (question) questions[questionId] = question;
  }
  return {
    schemaVersion: LEARNER_STATE_SCHEMA_VERSION,
    questions,
  };
}

export function pruneLearnerState(
  state: LearnerState,
  validQuestionIds: Iterable<string>,
): LearnerState {
  return parseLearnerState(state, validQuestionIds);
}

export function serializeLearnerState(state: LearnerState): string {
  return JSON.stringify(parseLearnerState(state));
}

export function loadLearnerState(
  storage: LearnerStateStorage,
  storageKey: string,
  validQuestionIds: Iterable<string>,
): LearnerState {
  return parseLearnerState(storage.getItem(storageKey), validQuestionIds);
}

export function saveLearnerState(
  storage: LearnerStateStorage,
  storageKey: string,
  state: LearnerState,
  validQuestionIds: Iterable<string>,
): void {
  storage.setItem(storageKey, serializeLearnerState(pruneLearnerState(state, validQuestionIds)));
}

export function resetLearnerStateNamespace(
  storage: LearnerStateStorage,
  storageKey: string,
): LearnerState {
  storage.removeItem(storageKey);
  return emptyLearnerState();
}

export function selectQuestionPool(
  questionBank: QuestionBank,
  learnerState: LearnerState,
  pool: QuestionPool,
): QuestionBank["items"] {
  return selectQuestions(questionBank, learnerState, { pool });
}

export function selectQuestions(
  questionBank: QuestionBank,
  learnerState: LearnerState,
  filter: QuestionFilter = {},
): QuestionBank["items"] {
  const topicIds = filter.topicIds ? new Set(filter.topicIds) : null;
  const objectiveIds = filter.learningObjectiveIds
    ? new Set(filter.learningObjectiveIds)
    : null;
  const stageIndexes = filter.stageIndexes ? new Set(filter.stageIndexes) : null;
  const minimumStageIndex = Math.min(...questionBank.items.map((item) => item.stageIndex));
  const hasMinimumStage = questionBank.items.some((item) => item.stageIntent === "minimum");

  return questionBank.items.filter((item) => {
    const state = learnerState.questions[item.id];
    if (!matchesPool(
      item,
      state,
      filter.pool ?? "all",
      minimumStageIndex,
      hasMinimumStage,
    )) return false;
    if (topicIds && !topicIds.has(item.topicId)) return false;
    if (objectiveIds && !item.learningObjectiveIds.some((id) => objectiveIds.has(id))) {
      return false;
    }
    return !stageIndexes || stageIndexes.has(item.stageIndex);
  });
}

function matchesPool(
  item: QuestionBank["items"][number],
  state: LearnerQuestionState | undefined,
  pool: QuestionPool,
  minimumStageIndex: number,
  hasMinimumStage: boolean,
): boolean {
  switch (pool) {
    case "all":
      return true;
    case "continue":
      return state?.learned !== true;
    case "review":
      return state?.review === true;
    case "starred":
      return state?.starred === true;
    case "learned":
      return state?.learned === true;
    case "minimum":
      return hasMinimumStage
        ? item.stageIntent === "minimum"
        : item.stageIndex === minimumStageIndex;
    case "depth":
      return item.stageIntent === "depth";
    case "assessment":
      return item.stageIntent === "assessment";
  }
}

function normalizeQuestionState(raw: Record<string, unknown>): LearnerQuestionState | null {
  const question: LearnerQuestionState = {};
  if (raw.seen === true) question.seen = true;
  if (raw.learned === true) question.learned = true;
  if (raw.review === true) question.review = true;
  if (raw.starred === true) question.starred = true;
  if (typeof raw.draft === "string" &&
      raw.draft.length > 0 &&
      raw.draft.length <= MAX_DRAFT_LENGTH) {
    question.draft = raw.draft;
  }

  if (question.learned && question.review) delete question.learned;
  if (question.learned || question.review || question.starred || question.draft !== undefined) {
    question.seen = true;
  }
  return Object.keys(question).length > 0 ? question : null;
}

function setDraft(state: LearnerQuestionState, value: string): void {
  if (value.length > 0 && value.length <= MAX_DRAFT_LENGTH) state.draft = value;
  else delete state.draft;
}

function isSafeQuestionId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !unsafeRecordKeys.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
