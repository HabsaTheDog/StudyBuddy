import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildResourceManifest,
  RESOURCE_MANIFEST_FILE,
  verifyResourceLinks,
} from "../resourceManifest.js";

export function createResourceManifestNode(config: MoodleRuntimeConfig) {
  return async function resourceManifestNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const discovered = await buildResourceManifest(config.runDir, state.moodle_raw_text);
      const resourceManifest = await verifyResourceLinks(discovered, {
        enabled: process.env.STUDY_BUDDY_VERIFY_LINKS !== "false",
      });
      await writeFile(
        path.join(config.runDir, RESOURCE_MANIFEST_FILE),
        `${JSON.stringify(resourceManifest, null, 2)}\n`,
        "utf8",
      );
      await config.diagnostics?.log(
        "info",
        "analyzer",
        `Built resource graph with ${resourceManifest.resources.length} node(s).`,
      );
      return { resource_manifest: resourceManifest, error_log: null };
    } catch (error) {
      return {
        error_log: `Resource discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}
