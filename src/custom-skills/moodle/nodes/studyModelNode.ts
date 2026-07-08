import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { validateExtractedData } from "../validation.js";
import { buildStudyModel } from "../studyModel.js";

export function createStudyModelNode(config: MoodleRuntimeConfig) {
  return async function studyModelNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const studyModel = buildStudyModel(
        config,
        validateExtractedData(state.extracted_data),
        state.resource_manifest,
        state.coverage_assessment,
      );
      await writeFile(
        path.join(config.runDir, "study-model.json"),
        `${JSON.stringify(studyModel, null, 2)}\n`,
        "utf8",
      );
      return { study_model: studyModel, error_log: null };
    } catch (error) {
      return {
        error_log: `Study model failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}
