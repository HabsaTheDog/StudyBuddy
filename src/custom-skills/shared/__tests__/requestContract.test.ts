import { describe, expect, it } from "vitest";
import { minimalRequestContract, RequestContractSchema } from "../requestContract.js";

describe("RequestContract", () => {
  it("binds a degraded fallback to every requested deliverable without guessing semantics", () => {
    const prompt = "Erstelle ein PDF und einen interaktiven Study Guide.";
    const contract = minimalRequestContract(prompt, ["pdf", "html"]);

    expect(contract.evaluationStatus).toBe("degraded");
    expect(contract.originalPrompt).toBe(prompt);
    expect(contract.requirements[0]?.appliesTo).toEqual(["deliverable-1", "deliverable-2"]);
    expect(contract.notRequired).toEqual([]);
    expect(contract.forbidden).toEqual([]);
  });

  it("rejects evidence-derived must requirements", () => {
    const contract = minimalRequestContract("Create a guide", ["html"]);
    expect(() => RequestContractSchema.parse({
      ...contract,
      evaluationStatus: "evaluated",
      requirements: [{
        ...contract.requirements[0],
        origin: "evidence_derived",
        priority: "must",
      }],
    })).toThrow(/Evidence-derived requirements may only be recommendations/);
  });

  it("rejects dangling deliverable and reviewer references", () => {
    const contract = minimalRequestContract("Create a guide", ["html"]);
    expect(() => RequestContractSchema.parse({
      ...contract,
      evaluationStatus: "evaluated",
      requirements: [{ ...contract.requirements[0], appliesTo: ["missing-deliverable"] }],
      reviewAssignments: [{ owner: "content", requirementIds: ["missing-requirement"], checks: ["Review it"] }],
    })).toThrow(/Unknown (?:deliverable|requirement) ID/);
  });
});
