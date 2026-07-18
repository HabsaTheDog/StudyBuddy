import { describe, expect, it } from "vitest";
import { resolveCodexModelSelection } from "../codexClient.js";

describe("Quiz Solver model selection", () => {
  const config = {
    codexModel: "gpt-global",
    quizSolverModelPolicy: {
      model: "gpt-quiz",
      reasoningEffort: "medium" as const,
      retryModel: "gpt-quiz-retry",
      retryReasoningEffort: "high" as const,
    },
  };

  it("uses the Quiz Solver primary model for the first answer attempt", () => {
    expect(resolveCodexModelSelection(config, "quiz_solver", 1)).toEqual({
      model: "gpt-quiz",
      reasoningEffort: "medium",
    });
  });

  it("uses the Quiz Solver retry model after a failed answer", () => {
    expect(resolveCodexModelSelection(config, "quiz_solver", 2)).toEqual({
      model: "gpt-quiz-retry",
      reasoningEffort: "high",
    });
  });

  it("leaves non-quiz calls on the legacy model selection", () => {
    expect(resolveCodexModelSelection(config)).toEqual({ model: "gpt-global" });
  });
});
