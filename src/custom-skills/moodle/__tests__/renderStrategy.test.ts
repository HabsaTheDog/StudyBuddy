import { describe, expect, it } from "vitest";
import { decideRenderStrategy } from "../renderStrategy.js";
import { classifyArtifactIntent } from "../studentFirstPolicy.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

describe("renderStrategy", () => {
  it("respects explicit output-format exclusions", () => {
    expect(classifyArtifactIntent(
      "Erstelle bitte nur das PDF, keinen interaktiven HTML Study Guide.",
    ).formats).toEqual(["pdf"]);
    expect(classifyArtifactIntent(
      "Erstelle nur eine interaktive HTML-Datei, kein PDF.",
    ).formats).toEqual(["html"]);
  });

  it("keeps semantic content choices out of the routing intent", () => {
    const overview = classifyArtifactIntent(
      "Erstelle ein kompaktes PDF mit wichtigen Rechenarten und notwendigen Formelherleitungen.",
      { profile: "study_guide", formats: ["pdf"] },
    );
    const examples = classifyArtifactIntent(
      "Erstelle ein PDF mit vollständig nachvollziehbaren Rechenbeispielen.",
      { profile: "study_guide", formats: ["pdf"] },
    );

    expect(overview).toEqual(examples);
    expect(Object.keys(overview)).not.toContain("wantsCalculations");
    expect(Object.keys(overview)).not.toContain("wantsWorkedExamples");
  });

  it("does not infer renderer semantics from simple-summary wording", () => {
    const decision = decideRenderStrategy(moodleTestConfig({
      prompt: "Erstelle eine einfache Zusammenfassung als kurzer Lernzettel",
    }));
    expect(decision.strategy).toBe("llm_formatter");
  });

  it("chooses the LLM formatter for complex lab documents", () => {
    const decision = decideRenderStrategy(moodleTestConfig({
      prompt: "Erstelle eine ausführliche Laborvorbereitung mit Formelsammlung und Tabellen",
    }));
    expect(decision.strategy).toBe("llm_formatter");
  });

  it("keeps validated study-guide render stages contract-adaptive by default", () => {
    const prompt = "Erstelle einen ausführlichen Study Guide mit Tabellen";
    const decision = decideRenderStrategy(moodleTestConfig({
      prompt,
      stage: "render",
      artifactIntent: classifyArtifactIntent(prompt, { profile: "study_guide" }),
    }));
    expect(decision.strategy).toBe("llm_formatter");
  });

  it("honors an explicit deterministic renderer override", () => {
    const decision = decideRenderStrategy(moodleTestConfig({
      renderStrategy: "deterministic",
    }));
    expect(decision.strategy).toBe("deterministic");
  });
});
