import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { ensureInside } from "../validation.js";

export function createDiskWriterNode(config: MoodleRuntimeConfig) {
  return async function diskWriterNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    if (!state.final_document.trim()) {
      return {
        error_log: "Disk writer failed: final_document is empty.",
      };
    }
    const outputPath = ensureInside(config.runDir, config.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, state.final_document, "utf8");
    return { error_log: null };
  };
}
