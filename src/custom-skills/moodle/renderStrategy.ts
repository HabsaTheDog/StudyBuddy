import type { MoodleRuntimeConfig } from "./types.js";

export type RenderStrategy = "deterministic" | "llm_formatter";

export interface RenderStrategyDecision {
  strategy: RenderStrategy;
  reason: string;
}

export function decideRenderStrategy(config: MoodleRuntimeConfig): RenderStrategyDecision {
  if (config.renderStrategy === "deterministic") {
    return { strategy: "deterministic", reason: "Explicit render strategy override: deterministic." };
  }
  if (config.renderStrategy === "llm_formatter") {
    return { strategy: "llm_formatter", reason: "Explicit render strategy override: llm_formatter." };
  }
  if (config.stage === "render" && config.artifactIntent.profile === "study_guide") {
    return {
      strategy: "deterministic",
      reason: "Validated study-guide handoffs use the standardized deterministic renderer.",
    };
  }

  const prompt = config.prompt.toLowerCase();
  if (/(?:laborvorbereitung|formelsammlung|prüfungsfertig|pruefungsfertig|schönes pdf|schoenes pdf|ausführlich|ausfuehrlich|komplex|diagramm|abbildung|tabelle|viele formeln|standardisiert)/i.test(prompt)) {
    return {
      strategy: "llm_formatter",
      reason: "The request asks for complex, polished, formula-heavy, or lab-style document layout.",
    };
  }
  if (/(?:kurzer lernzettel|kurze übersicht|kurze uebersicht|einfache zusammenfassung|vokabelliste|simple summary|quick notes|quizfragen|antworten)/i.test(prompt)) {
    return {
      strategy: "deterministic",
      reason: "The request is a standardized simple summary, vocabulary list, or compact quiz-style extraction.",
    };
  }
  return {
    strategy: "llm_formatter",
    reason: "Auto mode defaults to the LLM formatter unless the prompt is clearly simple and standardized.",
  };
}
