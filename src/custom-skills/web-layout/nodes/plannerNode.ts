import { layoutSpecJsonSchema, layoutSpecSchema } from "../schemas.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";

export function createPlannerNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function plannerNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const response = await codex.run(buildPlannerPrompt(config, state), {
        outputSchema: layoutSpecJsonSchema,
        task: "artifact_planner",
        attempt: state.retry_count + 1,
      });
      const parsed = layoutSpecSchema.parse(JSON.parse(stripJsonFence(response))) as JsonObject;
      await config.diagnostics?.log("info", "planner", "Validated layout spec.");
      return {
        layout_spec: parsed,
        error_log: null,
      };
    } catch (error) {
      const message = `Layout planner failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "planner", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

export function buildPlannerPrompt(config: WebLayoutRuntimeConfig, state: Pick<LangGraphWebLayoutState, "source_text" | "error_log">): string {
  return [
    "Create a JSON-only implementation plan for a Study Buddy offline interactive HTML learning tool.",
    `Requested kind: ${config.kind}`,
    `Language: ${config.language}`,
    "Return exactly this schema with no Markdown fences and no prose:",
    JSON.stringify(layoutSpecJsonSchema, null, 2),
    state.error_log ? `Previous error to repair:\n${state.error_log}` : "",
    `Source text:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}
