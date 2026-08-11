import { writeFile } from "node:fs/promises";
import path from "node:path";
import { layoutSpecJsonSchema, layoutSpecSchema } from "../schemas.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";
import { adaptiveLearningInteractionGuidance } from "../learningInteractionGuidance.js";
import { studyGuideBlockGuidance } from "../studyGuideBlockContract.js";
import { balancedExcerpt } from "../modelText.js";

const PLANNER_PROMPT_TARGET_CHARS = 50_000;

export function createPlannerNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function plannerNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const response = await codex.run(buildPlannerPrompt(config, state), {
        outputSchema: layoutSpecJsonSchema,
        task: "artifact_planner",
        attempt: state.retry_count + 1,
      });
      const parsed = layoutSpecSchema.parse(JSON.parse(stripJsonFence(response))) as JsonObject;
      // A later generator or quality-review failure must not make a validated
      // plan disappear. Resume runs can use this checkpoint without starting
      // another planner model call.
      await writeFile(
        path.join(config.runDir, "layout-spec.json"),
        `${JSON.stringify(parsed, null, 2)}\n`,
        "utf8",
      );
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
        planner_retry_count: state.planner_retry_count + 1,
      };
    }
  };
}

export function buildPlannerPrompt(config: WebLayoutRuntimeConfig, state: Pick<LangGraphWebLayoutState, "source_text" | "request_contract" | "error_log">): string {
  const fixedPrompt = [
    "Create a JSON-only implementation plan for a Study Buddy offline interactive HTML learning tool.",
    `Requested kind: ${config.kind}`,
    `Language: ${config.language}`,
    "Use the evaluated request contract as the semantic authority. Keep scope proportional to it; choose learning interactions from its requirements and the course evidence, never from a fixed subject or study-guide template.",
    "Optional components mentioned under notRequired are allowed but cannot become acceptance blockers. Components under forbidden must not appear. Preserve every explicit must requirement and treat should requirements as evidence-backed recommendations.",
    adaptiveLearningInteractionGuidance(),
    config.kind === "study-guide" ? studyGuideBlockGuidance() : "",
    "Do not invent authoring systems, editable content builders, imports, exports, source search/filter interfaces, or modal source browsers unless the user explicitly requested them.",
    config.sourceMode === "prompt"
      ? "Only the user prompt is available. Plan a clearly labelled demo without course-specific factual claims, citations, or source-management UI."
      : "Plan source-aware citations only for sources actually present in the supplied handoff or files.",
    "Return JSON matching the supplied Structured Output schema, with no Markdown fences and no prose.",
    state.error_log ? `Previous error to repair:\n${balancedExcerpt(state.error_log, 4_000)}` : "",
    `Exact original user request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract, null, 2)}`,
  ].filter(Boolean).join("\n\n");
  const sourceHeader = "\n\nSource text:\n";
  const sourceBudget = Math.max(
    0,
    Math.min(40_000, PLANNER_PROMPT_TARGET_CHARS - fixedPrompt.length - sourceHeader.length),
  );
  if (sourceBudget === 0 && state.source_text.trim()) {
    throw new Error(
      `Layout planner request contract and instructions exceed the ${PLANNER_PROMPT_TARGET_CHARS}-character planning budget before source evidence can be represented.`,
    );
  }
  const sourceExcerpt = sourceBudget > 0
    ? balancedExcerpt(state.source_text, sourceBudget)
    : "";
  return `${fixedPrompt}${sourceHeader}${sourceExcerpt}`;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}
