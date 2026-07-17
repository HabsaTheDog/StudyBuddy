import { describe, expect, it } from "vitest";
import {
  parseExecutionProfile,
  parseModelPolicyOverrides,
  parseReasoningEffort,
  resolveTaskModelPolicy,
} from "../modelPolicy.js";

describe("modelPolicy", () => {
  it("routes balanced work to task-specific GPT-5.6 models", () => {
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "artifact_planner" })).toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
    });
    expect(resolveTaskModelPolicy({ profile: "balanced", task: "content_analyzer" })).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
  });

  it("escalates only after a failed validation attempt", () => {
    const first = resolveTaskModelPolicy({ profile: "fast", task: "content_analyzer", attempt: 1 });
    const retry = resolveTaskModelPolicy({ profile: "fast", task: "content_analyzer", attempt: 2 });
    expect(first.model).toBe("gpt-5.6-luna");
    expect(retry).toMatchObject({ model: "gpt-5.6-terra", reasoningEffort: "medium" });
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

  it("normalizes public profile and effort values", () => {
    expect(parseExecutionProfile("QUALITY")).toBe("quality");
    expect(parseReasoningEffort("none")).toBe("minimal");
    expect(() => parseExecutionProfile("turbo")).toThrow("Expected execution profile");
  });
});
