import { describe, expect, it } from "vitest";
import {
  parseExecutionProfile,
  parseModelPolicyOverrides,
  parseReasoningEffort,
  resolveTaskModelPolicy,
} from "../modelPolicy.js";

describe("modelPolicy", () => {
  it("keeps each built-in worker matrix role-specific", () => {
    const cases = [
      ["fast", "artifact_planner", "gpt-5.6-luna", "high", "gpt-5.6-terra", "high"],
      ["fast", "content_analyzer", "gpt-5.6-luna", "high", "gpt-5.6-terra", "high"],
      ["fast", "quiz_solver", "gpt-5.6-luna", "high", "gpt-5.6-terra", "high"],
      ["fast", "artifact_builder", "gpt-5.6-luna", "high", "gpt-5.6-terra", "high"],
      ["fast", "quality_reviewer", "gpt-5.6-terra", "high", "gpt-5.6-sol", "medium"],
      ["balanced", "artifact_planner", "gpt-5.6-terra", "medium", "gpt-5.6-sol", "medium"],
      ["balanced", "content_analyzer", "gpt-5.6-terra", "high", "gpt-5.6-sol", "high"],
      ["balanced", "quiz_solver", "gpt-5.6-terra", "high", "gpt-5.6-sol", "high"],
      ["balanced", "artifact_builder", "gpt-5.6-sol", "medium", "gpt-5.6-sol", "high"],
      ["balanced", "quality_reviewer", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
      ["quality", "artifact_planner", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
      ["quality", "content_analyzer", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
      ["quality", "quiz_solver", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
      ["quality", "artifact_builder", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
      ["quality", "quality_reviewer", "gpt-5.6-sol", "high", "gpt-5.6-sol", "xhigh"],
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

  it("routes balanced work to task-specific GPT-5.6 models", () => {
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "artifact_planner" })).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "content_analyzer" })).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "quiz_solver" })).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
  });

  it("escalates only after a failed validation attempt", () => {
    const first = resolveTaskModelPolicy({ profile: "fast", task: "content_analyzer", attempt: 1 });
    const retry = resolveTaskModelPolicy({ profile: "fast", task: "content_analyzer", attempt: 2 });
    expect(first.model).toBe("gpt-5.6-luna");
    expect(retry).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 6 * 60_000,
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

    expect(primary).toMatchObject({ model: "gpt-5.6-terra", timeoutMs: 6 * 60_000 });
    expect(retry).toMatchObject({ model: "gpt-5.6-sol", timeoutMs: 10 * 60_000 });
  });

  it("keeps auto aligned with the balanced production policy", () => {
    for (const task of [
      "artifact_planner",
      "content_analyzer",
      "quiz_solver",
      "artifact_builder",
      "quality_reviewer",
    ] as const) {
      expect(resolveTaskModelPolicy({ profile: "auto", task })).toEqual(
        resolveTaskModelPolicy({ profile: "balanced", task }),
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
