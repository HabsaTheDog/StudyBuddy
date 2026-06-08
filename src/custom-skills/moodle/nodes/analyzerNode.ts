import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { extractedDataJsonSchema } from "../schemas.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";

export function createAnalyzerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function analyzerNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const response = await codex.run(buildAnalyzerPrompt(config, state), {
        outputSchema: extractedDataJsonSchema,
      });
      const parsed = parseJsonObjectOrArray(response);
      const validated = validateExtractedData(parsed);
      await writeFile(
        path.join(config.runDir, "extracted-data.json"),
        `${JSON.stringify(validated, null, 2)}\n`,
        "utf8",
      );
      await config.diagnostics?.log("info", "analyzer", "Validated and persisted extracted study data.");
      return {
        extracted_data: validated,
        error_log: null,
      };
    } catch (error) {
      return {
        error_log: `Analyzer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

function buildAnalyzerPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): string {
  return [
    "Extract structured study data from Moodle text for a mechatronics/engineering student.",
    "Return only JSON matching the requested schema. Do not include Markdown fences.",
    "Preserve German source language unless the user asks otherwise.",
    "Represent formulas in Typst math syntax where possible.",
    "Never invent source citations.",
    "Use the source coverage JSON as a hard boundary: failed or empty sources can only support warnings, not factual claims.",
    state.error_log ? `Previous validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {}, null, 2)}`,
    `Moodle source text:\n${state.moodle_raw_text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
