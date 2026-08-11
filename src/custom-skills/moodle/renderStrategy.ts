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
  return {
    strategy: "llm_formatter",
    reason: "Auto mode delegates document pattern and component selection to the contract-aware formatter; deterministic rendering requires an explicit override.",
  };
}
