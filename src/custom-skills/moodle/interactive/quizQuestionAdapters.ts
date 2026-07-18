import type { QuizQuestion } from "./nodes/quizReviewNode.js";

export type QuizQuestionAdapter =
  | "native-control-plan"
  | "drag-drop-text"
  | "drag-drop-image"
  | "drag-drop-marker"
  | "ordering"
  | "code-editor"
  | "rich-text"
  | "custom-widget"
  | "no-response";

export interface QuizQuestionResponseModel {
  adapter: QuizQuestionAdapter;
  support: "supported" | "adapter_required" | "no_response";
  questionType: string;
  controlCount: number;
  controlTypes: string[];
  reason: string;
}

const TYPE_ADAPTERS: Readonly<Record<string, QuizQuestionAdapter>> = {
  ddwtos: "drag-drop-text",
  ddimageortext: "drag-drop-image",
  ddmarker: "drag-drop-marker",
  ordering: "ordering",
  description: "no-response",
};

/**
 * Classify by the actual response surface first and Moodle's qtype class second.
 * This lets third-party types such as Formulas, STACK, Wiris, and CodeRunner use
 * the generic atomic control plan when they ultimately render native controls,
 * without pretending that arbitrary canvas/drag widgets are safe to manipulate.
 */
export function classifyQuizQuestionResponse(
  question: Pick<QuizQuestion, "question_type" | "controls" | "interaction_hints">,
): QuizQuestionResponseModel {
  const questionType = normalizeType(question.question_type);
  const editableControls = question.controls.filter((control) => control.disabled !== true);
  const controlTypes = [
    ...new Set(
      editableControls.map((control) =>
        String(control.type ?? control.tag ?? "unknown").toLowerCase(),
      ),
    ),
  ];
  const controlsHaveStableIds = editableControls.every(
    (control) =>
      (typeof control.control_id === "string" && control.control_id.trim().length > 0) ||
      (typeof control.id === "string" && control.id.trim().length > 0),
  );
  if (editableControls.length > 0 && controlsHaveStableIds) {
    return {
      adapter: "native-control-plan",
      support: "supported",
      questionType,
      controlCount: editableControls.length,
      controlTypes,
      reason: "complete-native-control-surface",
    };
  }

  const knownAdapter = TYPE_ADAPTERS[questionType];
  if (knownAdapter === "no-response") {
    return {
      adapter: knownAdapter,
      support: "no_response",
      questionType,
      controlCount: editableControls.length,
      controlTypes,
      reason: "moodle-description-has-no-response",
    };
  }
  if (knownAdapter) {
    return {
      adapter: knownAdapter,
      support: "adapter_required",
      questionType,
      controlCount: editableControls.length,
      controlTypes,
      reason: "specialized-moodle-interaction",
    };
  }

  const hints = question.interaction_hints;
  if (Number(hints?.code_editors ?? 0) > 0) {
    return adapterRequired("code-editor", questionType, editableControls.length, controlTypes);
  }
  if (Number(hints?.rich_text_editors ?? 0) > 0) {
    return adapterRequired("rich-text", questionType, editableControls.length, controlTypes);
  }
  return adapterRequired("custom-widget", questionType, editableControls.length, controlTypes);
}

function adapterRequired(
  adapter: QuizQuestionAdapter,
  questionType: string,
  controlCount: number,
  controlTypes: string[],
): QuizQuestionResponseModel {
  return {
    adapter,
    support: "adapter_required",
    questionType,
    controlCount,
    controlTypes,
    reason: "no-complete-native-control-surface",
  };
}

function normalizeType(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^qtype_/, "") || "unknown"
  );
}
