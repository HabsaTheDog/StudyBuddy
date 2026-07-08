import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { buildEvidencePackage } from "../evidencePackage.js";

export function createEvidenceNode(config: MoodleRuntimeConfig) {
  return async function evidenceNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const evidencePackage = await buildEvidencePackage(
        config.runDir,
        state.moodle_raw_text,
        state.resource_manifest,
      );
      await config.diagnostics?.log(
        "info",
        "analyzer",
        `Built evidence package with ${evidencePackage.records.length} record(s).`,
      );
      return { evidence_package: evidencePackage, error_log: null };
    } catch (error) {
      return {
        error_log: `Evidence extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}
