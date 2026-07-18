import { describe, expect, it } from "vitest";
import { decideRenderStrategy } from "../renderStrategy.js";
import { classifyArtifactIntent } from "../studentFirstPolicy.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

describe("renderStrategy", () => {
  it("chooses deterministic rendering for simple summaries", () => {
    const decision = decideRenderStrategy(moodleTestConfig({
      prompt: "Erstelle eine einfache Zusammenfassung als kurzer Lernzettel",
    }));
    expect(decision.strategy).toBe("deterministic");
  });

  it("chooses the LLM formatter for complex lab documents", () => {
    const decision = decideRenderStrategy(moodleTestConfig({
      prompt: "Erstelle eine ausführliche Laborvorbereitung mit Formelsammlung und Tabellen",
    }));
    expect(decision.strategy).toBe("llm_formatter");
  });

  it("uses deterministic rendering for validated study-guide render stages", () => {
    const prompt = "Erstelle einen ausführlichen Study Guide mit Tabellen";
    const decision = decideRenderStrategy(moodleTestConfig({
      prompt,
      stage: "render",
      artifactIntent: classifyArtifactIntent(prompt, { profile: "study_guide" }),
    }));
    expect(decision.strategy).toBe("deterministic");
  });
});
