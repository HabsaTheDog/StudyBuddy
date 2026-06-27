import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { extractedDataJsonSchema } from "../schemas.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";
import { readVisualManifest } from "../visualAssets.js";

export function createAnalyzerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function analyzerNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const response = await codex.run(await buildAnalyzerPrompt(config, state), {
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

async function buildAnalyzerPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): Promise<string> {
  const visualManifest = await readVisualManifest(config.runDir);
  return [
    "Extract structured study data from selected calendar events and relevant Moodle/CIS text for a mechatronics/engineering student.",
    "Return only JSON matching the requested schema. Do not include Markdown fences.",
    "Preserve German source language unless the user asks otherwise.",
    "Represent formulas in Typst math syntax where possible.",
    "Never invent source citations.",
    "Treat calendar_event as the primary source for dates, times, exams, and rooms.",
    "Treat CIS as the fallback for missing calendar facts and as the source for attendance or administrative LV information.",
    "The calendar input is already filtered; do not infer events that are not present.",
    "Visual policy:",
    `- Select at most ${config.maxVisualAssets} figures.`,
    "- Prefer Moodle/CIS visual candidates over generated or placeholder visuals.",
    "- Include visuals when they materially help the topic, especially circuits, measurement setups, block diagrams, lab workflows, plots, and engineering mechanisms.",
    "- Avoid decorative visuals and avoid visuals for prose/language-heavy topics unless the request makes them useful.",
    "- If no Moodle/CIS image is suitable but a simple technical visualization helps, create a typst_diagram visual asset with no relative_path and describe the intended approved component in caption_hint.",
    "- If neither source image nor approved Typst diagram fits, create a placeholder_prompt visual asset with a concrete generation_prompt.",
    "- Generated or placeholder visuals are didactic visualizations, not original Moodle/CIS sources.",
    "Use the source coverage JSON as a hard boundary: failed or empty sources can only support warnings, not factual claims.",
    state.error_log ? `Previous validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {}, null, 2)}`,
    visualManifest ? `Visual candidates JSON:\n${JSON.stringify(visualManifest, null, 2)}` : "Visual candidates JSON: none",
    `Moodle source text:\n${state.moodle_raw_text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
