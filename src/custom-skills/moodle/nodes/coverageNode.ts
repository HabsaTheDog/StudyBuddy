import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { assessExamNavigatorCoverage } from "../coveragePolicy.js";

export function createCoverageNode(config: MoodleRuntimeConfig) {
  return async function coverageNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const coverageAssessment = assessExamNavigatorCoverage(
      config,
      state.resource_manifest,
      state.evidence_package,
    );
    await writeFile(
      path.join(config.runDir, "coverage-report.json"),
      `${JSON.stringify(coverageAssessment, null, 2)}\n`,
      "utf8",
    );
    await config.diagnostics?.log(
      coverageAssessment.status === "blocked" ? "warn" : "info",
      "analyzer",
      `Student-first coverage: ${coverageAssessment.status}. ${coverageAssessment.detail}`,
    );
    return {
      coverage_assessment: coverageAssessment,
      error_log:
        coverageAssessment.status === "blocked"
          ? `Student-first coverage blocked publication: ${coverageAssessment.detail}`
          : null,
    };
  };
}
