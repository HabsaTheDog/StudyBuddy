import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildResourceManifest,
  RESOURCE_MANIFEST_FILE,
  verifyResourceLinks,
} from "../resourceManifest.js";
import { summarizeManifestAcquisition } from "../coveragePolicy.js";

export function createResourceManifestNode(config: MoodleRuntimeConfig) {
  return async function resourceManifestNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const preferredCourseUrls = [
        ...(config.targetCourseUrls ?? []),
        ...(config.moodleUrl.includes("/course/") ? [config.moodleUrl] : []),
      ];
      const discovered = await buildResourceManifest(config.runDir, state.moodle_raw_text, {
        preferredCourseUrls,
      });
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
      const acquisition = summarizeManifestAcquisition(resourceManifest);
      const currentCoverage = config.diagnostics?.getCoverage().moodle;
      const sourceFailed = currentCoverage && [
        "failed",
        "failed_auth",
        "timeout",
      ].includes(currentCoverage.status);
      if (!sourceFailed) {
        await config.diagnostics?.updateCoverage("moodle", {
          status: acquisition.partial
            ? "partial"
            : currentCoverage?.status === "partial"
              ? "partial"
              : "success",
          detail: acquisition.detail,
        });
      }
      await config.diagnostics?.log(
        acquisition.partial ? "warn" : "info",
        "analyzer",
        acquisition.detail,
        acquisition.data,
      );
      return { resource_manifest: resourceManifest, error_log: null };
    } catch (error) {
      return {
        error_log: `Resource discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}
