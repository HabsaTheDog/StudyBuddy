import { validateExtractedData } from "../validation.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { copyRenderVisualAssets } from "../visualAssets.js";

export function createVisualAssetResolverNode(config: MoodleRuntimeConfig) {
  return async function visualAssetResolverNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    if (!config.visualsEnabled) {
      return { error_log: null };
    }
    if (!config.sourceRunDir) {
      return { error_log: "Visual asset resolver failed: render stage requires --source-run-dir." };
    }
    try {
      const data = validateExtractedData(state.extracted_data);
      await copyRenderVisualAssets(config.sourceRunDir, config.runDir, data);
      const assetCount = data.visual_assets.filter((asset) => asset.relative_path).length;
      if (assetCount > 0) {
        await config.diagnostics?.log("info", "diagnostic", `Copied ${assetCount} visual asset(s) into render run.`);
      }
      return { error_log: null };
    } catch (error) {
      return {
        error_log: `Visual asset resolver failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}
