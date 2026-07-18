import { describe, expect, it } from "vitest";

import { classifyQuizQuestionResponse } from "../quizQuestionAdapters.js";

describe("quiz question response adapters", () => {
  it("supports unknown third-party qtypes when they expose complete native controls", () => {
    expect(
      classifyQuizQuestionResponse({
        question_type: "formulas",
        controls: [
          { control_id: "answer-x", type: "text", disabled: false },
          { control_id: "answer-unit", type: "select-one", disabled: false },
        ],
      }),
    ).toMatchObject({
      adapter: "native-control-plan",
      support: "supported",
      controlCount: 2,
    });
  });

  it.each([
    ["ddwtos", "drag-drop-text"],
    ["ddimageortext", "drag-drop-image"],
    ["ddmarker", "drag-drop-marker"],
    ["ordering", "ordering"],
  ] as const)("routes %s to its specialized adapter", (questionType, adapter) => {
    expect(
      classifyQuizQuestionResponse({ question_type: questionType, controls: [] }),
    ).toMatchObject({ adapter, support: "adapter_required" });
  });

  it("fails closed for an unknown canvas widget instead of guessing", () => {
    expect(
      classifyQuizQuestionResponse({
        question_type: "geogebra",
        controls: [],
        interaction_hints: { canvases: 1, code_editors: 0, rich_text_editors: 0 },
      }),
    ).toMatchObject({ adapter: "custom-widget", support: "adapter_required" });
  });
});
