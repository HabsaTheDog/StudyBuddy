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
    expect(resolveCodexModelSelection({ ...config, codexModel: undefined }, "quiz_solver", 1)).toEqual({
      model: "gpt-quiz",
      reasoningEffort: "medium",
    });
  });

  it("uses the Quiz Solver retry model after a failed answer", () => {
    expect(resolveCodexModelSelection({ ...config, codexModel: undefined }, "quiz_solver", 2)).toEqual({
      model: "gpt-quiz-retry",
      reasoningEffort: "high",
    });
  });

  it("honors an explicit operator override over legacy quiz defaults on every attempt", () => {
    for (const attempt of [1, 2]) expect(resolveCodexModelSelection({ ...config, codexReasoningEffort: "minimal" }, "quiz_solver", attempt))
      .toEqual({ model: "gpt-global", reasoningEffort: "minimal" });
  });

  it("leaves non-quiz calls on the legacy model selection", () => {
    expect(resolveCodexModelSelection(config)).toEqual({ model: "gpt-global" });
  });
});

describe("interactive task overrides", () => {
  it("uses the selected profile for search and separate answer/review tasks", () => {
    const worker = (model: string) => ({ model, reasoningEffort: "low" as const, escalationModel: `${model}-retry`, escalationEffort: "high" as const });
    const config = {
      executionProfile: "custom" as const,
      modelPolicyOverrides: { source_search: worker("gpt-search"), quiz_answer: worker("gpt-answer"), quiz_verification: worker("gpt-review") },
    };
    expect(resolveCodexModelSelection(config, "source_search", 1, "source_selection")).toEqual({ model: "gpt-search", reasoningEffort: "low" });
    expect(resolveCodexModelSelection(config, "quiz_solver", 1, "quiz_answer").model).toBe("gpt-answer");
    expect(resolveCodexModelSelection(config, "quiz_solver", 2, "quiz_verification").model).toBe("gpt-review-retry");
    expect(resolveCodexModelSelection({ ...config, codexModel: "gpt-global" }, "quiz_solver", 2, "quiz_verification").model).toBe("gpt-global");
  });
});
