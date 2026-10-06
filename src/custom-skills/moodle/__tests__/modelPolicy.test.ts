import { describe, expect, it } from "vitest";
import {
  parseExecutionProfile,
  parseModelPolicyOverrides,
  parseReasoningEffort,
  resolveTaskModelPolicy,
  taskModelPolicySource,
} from "../modelPolicy.js";

describe("modelPolicy", () => {
  it("substitutes only incompatible models without flattening task policies", () => {
    const input = { profile: "balanced", task: "content_analyzer", operation: "solution_generation", compatibilityFallbacks: { "gpt-6.1-sol": "gpt-compatible" } } as const;
    expect(resolveTaskModelPolicy(input).model).toBe("gpt-compatible");
    expect(resolveTaskModelPolicy({ ...input, attempt: 2 }).model).toBe("gpt-6-sol");
    expect(resolveTaskModelPolicy({ ...input, globalModel: "gpt-operator" }).model).toBe("gpt-operator");
    expect(taskModelPolicySource(input)).toBe("compatibility:gpt-6.1-sol;built-in:balanced");
  });

  it("keeps each built-in worker matrix role-specific", () => {
    const cases = [
      ["fast", "source_search", "gpt-6-luna", "medium", "gpt-6.1-sol", "medium"],
      ["fast", "content_repair", "gpt-6.1-sol", "high", "gpt-6-sol", "high"],
      ["fast", "artifact_repair", "gpt-6.1-sol", "high", "gpt-6-sol", "high"],
      ["fast", "content_analyzer", "gpt-6-luna", "medium", "gpt-6.1-sol", "high"],
      ["fast", "quiz_solver", "gpt-6-luna", "high", "gpt-6.1-sol", "high"],
      ["fast", "artifact_planner", "gpt-6-luna", "high", "gpt-6.1-sol", "high"],
      ["fast", "artifact_builder", "gpt-6-luna", "high", "gpt-6.1-sol", "high"],
      ["fast", "quality_reviewer", "gpt-6.1-sol", "high", "gpt-6-sol", "medium"],
      ["balanced", "source_search", "gpt-6-luna", "medium", "gpt-6.1-sol", "medium"],
      ["balanced", "content_repair", "gpt-6.1-sol", "high", "gpt-6-sol", "medium"],
      ["balanced", "artifact_repair", "gpt-6.1-sol", "high", "gpt-6-sol", "xhigh"],
      ["balanced", "content_analyzer", "gpt-6.1-sol", "medium", "gpt-6-sol", "medium"],
      ["balanced", "quiz_solver", "gpt-6.1-sol", "high", "gpt-6-sol", "high"],
      ["balanced", "artifact_planner", "gpt-6.1-sol", "medium", "gpt-6-sol", "medium"],
      ["balanced", "artifact_builder", "gpt-6.1-sol", "medium", "gpt-6-sol", "high"],
      ["balanced", "quality_reviewer", "gpt-6.1-sol", "medium", "gpt-6-sol", "medium"],
      ["quality", "source_search", "gpt-6-luna", "medium", "gpt-6.1-sol", "medium"],
      ["quality", "content_repair", "gpt-6-astra", "high", "gpt-6.1-sol", "xhigh"],
      ["quality", "artifact_repair", "gpt-6-astra", "high", "gpt-6.1-sol", "xhigh"],
      ["quality", "content_analyzer", "gpt-6.1-sol", "high", "gpt-6-astra", "medium"],
      ["quality", "quiz_solver", "gpt-6-astra", "high", "gpt-6.1-sol", "xhigh"],
      ["quality", "artifact_planner", "gpt-6-astra", "high", "gpt-6.1-sol", "xhigh"],
      ["quality", "artifact_builder", "gpt-6-astra", "high", "gpt-6.1-sol", "xhigh"],
      ["quality", "quality_reviewer", "gpt-6-astra", "medium", "gpt-6.1-sol", "high"],
    ] as const;

    for (const [profile, task, model, effort, retryModel, retryEffort] of cases) {
      expect(resolveTaskModelPolicy({ profile, task, attempt: 1 })).toMatchObject({
        model,
        reasoningEffort: effort,
      });
      expect(resolveTaskModelPolicy({ profile, task, attempt: 2 })).toMatchObject({
        model: retryModel,
        reasoningEffort: retryEffort,
      });
    }
  });

  it("routes balanced work to task-specific current Sol models", () => {
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "artifact_planner" })).toMatchObject({
      model: "gpt-6.1-sol",
      reasoningEffort: "medium",
    });
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "content_analyzer" })).toMatchObject({
      model: "gpt-6.1-sol",
      reasoningEffort: "medium",
    });
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "quiz_solver" })).toMatchObject({
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
    });
  });

  it("escalates only after a failed validation attempt", () => {
    const first = resolveTaskModelPolicy({ profile: "fast", task: "content_analyzer", attempt: 1 });
    const retry = resolveTaskModelPolicy({ profile: "fast", task: "content_analyzer", attempt: 2 });
    expect(first.model).toBe("gpt-6-luna");
    expect(retry).toMatchObject({
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
      timeoutMs: 90_000,
    });
  });

  it("gives slower escalation models a dedicated retry timeout", () => {
    const primary = resolveTaskModelPolicy({
      profile: "balanced",
      task: "content_analyzer",
      attempt: 1,
    });
    const retry = resolveTaskModelPolicy({
      profile: "balanced",
      task: "content_analyzer",
      attempt: 2,
    });

    expect(primary).toMatchObject({ model: "gpt-6.1-sol", timeoutMs: 120_000 });
    expect(retry).toMatchObject({ model: "gpt-6-sol", timeoutMs: 180_000 });
  });

  it("uses the quality matrix when no explicit profile is selected", () => {
    for (const task of [
      "artifact_planner",
      "content_analyzer",
      "content_repair",
      "quiz_solver",
      "artifact_builder",
      "artifact_repair",
      "quality_reviewer",
    ] as const) {
      expect(resolveTaskModelPolicy({ profile: "auto", task })).toEqual(
        resolveTaskModelPolicy({ profile: "quality", task }),
      );
    }
  });

  it("keeps explicit global overrides stable across retries", () => {
    expect(resolveTaskModelPolicy({
      profile: "auto",
      task: "artifact_builder",
      attempt: 3,
      globalModel: "gpt-explicit",
      globalReasoningEffort: "low",
    })).toMatchObject({ model: "gpt-explicit", reasoningEffort: "low" });
  });

  it("parses custom role and retry overrides", () => {
    expect(parseModelPolicyOverrides(JSON.stringify({
      quality_reviewer: {
        model: "gpt-review",
        reasoningEffort: "high",
        retryModel: "gpt-review-retry",
        retryReasoningEffort: "xhigh",
      },
    }))).toMatchObject({
      quality_reviewer: {
        model: "gpt-review",
        reasoningEffort: "high",
        escalationModel: "gpt-review-retry",
        escalationEffort: "xhigh",
      },
    });
  });

  it("applies a custom Quiz Solver role and its retry policy", () => {
    const overrides = parseModelPolicyOverrides(JSON.stringify({
      quiz_solver: {
        model: "gpt-quiz",
        reasoningEffort: "medium",
        retryModel: "gpt-quiz-retry",
        retryReasoningEffort: "high",
      },
    }));

    expect(resolveTaskModelPolicy({
      profile: "custom",
      task: "quiz_solver",
      attempt: 1,
      overrides,
    })).toMatchObject({ model: "gpt-quiz", reasoningEffort: "medium" });
    expect(resolveTaskModelPolicy({
      profile: "custom",
      task: "quiz_solver",
      attempt: 2,
      overrides,
    })).toMatchObject({ model: "gpt-quiz-retry", reasoningEffort: "high" });
  });

  it("normalizes public profile and effort values", () => {
    expect(parseExecutionProfile("QUALITY")).toBe("quality");
    expect(parseReasoningEffort("none")).toBe("minimal");
    expect(() => parseExecutionProfile("turbo")).toThrow("Expected execution profile");
  });
});

describe("task policy inheritance", () => {
  const worker = (model: string) => ({ model, reasoningEffort: "low", retryModel: `${model}-retry`, retryReasoningEffort: "high" });
  const overrides = parseModelPolicyOverrides(JSON.stringify({
    content_analyzer: worker("gpt-default"),
    solution_generation: worker("gpt-solution"),
    content_repair: worker("gpt-repair"),
    learning_content_repair: worker("gpt-learning-repair"),
  }));

  it("selects an operation override without changing sibling work or retry budgets", () => {
    const input = { profile: "custom" as const, task: "content_analyzer" as const, operation: "solution_generation" as const, overrides };
    expect(resolveTaskModelPolicy(input)).toMatchObject({ model: "gpt-solution", timeoutMs: 120_000 });
    expect(resolveTaskModelPolicy({ ...input, attempt: 2 })).toMatchObject({ model: "gpt-solution-retry", reasoningEffort: "high", timeoutMs: 180_000 });
    expect(resolveTaskModelPolicy({ ...input, operation: "content_extraction" })).toMatchObject({ model: "gpt-default" });
    expect(taskModelPolicySource(input)).toBe("task:solution_generation");
    expect(resolveTaskModelPolicy({ ...input, attempt: 2, globalModel: "gpt-global" }).model).toBe("gpt-global");
  });

  it("inherits repair/search roles and supports a specialized repair override", () => {
    expect(resolveTaskModelPolicy({ profile: "custom", task: "source_search", operation: "source_selection", overrides }).model).toBe("gpt-default");
    expect(resolveTaskModelPolicy({ profile: "custom", task: "content_repair", operation: "content_extraction_repair", overrides }).model).toBe("gpt-repair");
    expect(resolveTaskModelPolicy({ profile: "custom", task: "content_repair", operation: "learning_content_repair", overrides }).model).toBe("gpt-learning-repair");
  });

  it("rejects unknown policy keys and mismatched operations instead of silently ignoring them", () => {
    expect(() => parseModelPolicyOverrides(JSON.stringify({ typo: worker("gpt-test") }))).toThrow("Unknown model task");
    expect(() => resolveTaskModelPolicy({ profile: "balanced", task: "artifact_builder", operation: "solution_generation" })).toThrow("mismatched");
  });
});
