import { describe, expect, it } from "vitest";
import { minimalRequestContract } from "../../shared/requestContract.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { buildPlannerPrompt } from "../nodes/plannerNode.js";
import { layoutSpecJsonSchema } from "../schemas.js";

describe("layout planner prompt budget", () => {
  it("preserves the exact request and contract while bounding a large course handoff", () => {
    const originalUserPrompt = "Create an adaptive guide from the complete supplied course evidence.";
    const requestContract = minimalRequestContract(originalUserPrompt, ["interactive-study-guide"]);
    const config = createWebLayoutRuntimeConfig({
      prompt: originalUserPrompt,
      originalUserPrompt,
      kind: "study-guide",
      runDir: "/tmp/layout-planner-budget-test",
    });
    const sourceText = Array.from({ length: 1_200 }, (_, index) =>
      `Evidence section ${index}: ${"source-grounded course detail ".repeat(12)}`
    ).join("\n");

    const prompt = buildPlannerPrompt(config, {
      source_text: sourceText,
      request_contract: requestContract,
      error_log: null,
    });

    expect(prompt).toContain(`Exact original user request:\n${originalUserPrompt}`);
    expect(prompt).toContain(JSON.stringify(requestContract, null, 2));
    expect(prompt).toContain("balanced excerpt 1/4");
    expect(prompt).toContain("balanced excerpt 4/4");
    expect(prompt.length + JSON.stringify(layoutSpecJsonSchema).length).toBeLessThan(60_000);
  });
});
