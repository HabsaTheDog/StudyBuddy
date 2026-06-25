import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import {
  discoverVisualCandidates,
  formatVisualCandidatesForAnalyzer,
} from "../visualAssets.js";

export function createVisualDiscoveryNode(config: MoodleRuntimeConfig) {
  return async function visualDiscoveryNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    if (!config.visualsEnabled) {
      await config.diagnostics?.log("info", "diagnostic", "Visual discovery skipped because visuals are disabled.");
      return { error_log: null };
    }

    try {
      await config.diagnostics?.log("info", "diagnostic", "Discovering visual candidates from Moodle/CIS artifacts.");
      const manifest = await discoverVisualCandidates(config, state);
      await config.diagnostics?.log(
        "info",
        "diagnostic",
        `Visual discovery found ${manifest.candidates.length} candidate(s).`,
      );
      const visualText = formatVisualCandidatesForAnalyzer(manifest);
      return {
        moodle_raw_text: [state.moodle_raw_text, visualText]
          .filter((part) => part.trim())
          .join("\n\n"),
        error_log: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await config.diagnostics?.log("warn", "diagnostic", `Visual discovery skipped after failure: ${message}`);
      return { error_log: null };
    }
  };
}
