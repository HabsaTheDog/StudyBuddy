import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { assessExamNavigatorCoverage } from "../coveragePolicy.js";
import { repairResourceManifestCourseScope } from "../resourceManifest.js";

export function createCoverageNode(config: MoodleRuntimeConfig) {
  return async function coverageNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const repair = repairResourceManifestCourseScope(
      state.resource_manifest,
      state.evidence_package.records.map((record) => record.resourceId),
    );
    const coverageAssessment = assessExamNavigatorCoverage(
      config,
      repair.manifest,
      state.evidence_package,
    );
    const selectedUsable = repair.manifest.resources.filter((resource) =>
      resource.selection?.selected === true &&
      resource.status === "acquired" &&
      Boolean(resource.localPath) &&
      resource.extraction?.status !== "unusable"
    );
    const consistencyError = selectedUsable.length > 0 && coverageAssessment.acquiredResources === 0
      ? `Coverage consistency failure: ${selectedUsable.length} selected acquired resource(s) exist, but the assessment counted none.`
      : null;
    await writeFile(
      path.join(config.runDir, "source-map.json"),
      `${JSON.stringify(repair.manifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(config.runDir, "coverage-report.json"),
      `${JSON.stringify(coverageAssessment, null, 2)}\n`,
      "utf8",
    );
    if (repair.repairedResourceIds.length > 0) {
      await writeFile(
        path.join(config.runDir, "coverage-recovery.json"),
        `${JSON.stringify({
          status: consistencyError ? "failed" : "repaired",
          method: "deterministic-course-scope-reconciliation",
          repairedResourceIds: repair.repairedResourceIds,
          acquiredResources: coverageAssessment.acquiredResources,
          usableEvidenceRecords: coverageAssessment.usableEvidenceRecords,
          performedNetworkAccess: false,
          performedModelCall: false,
        }, null, 2)}\n`,
        "utf8",
      );
      await config.diagnostics?.log(
        consistencyError ? "error" : "info",
        "analyzer",
        consistencyError ??
          `Repaired target-course ownership for ${repair.repairedResourceIds.length} resource(s) without crawling or model calls.`,
      );
    }
    await config.diagnostics?.log(
      coverageAssessment.status === "blocked" ? "warn" : "info",
      "analyzer",
      `Student-first coverage: ${coverageAssessment.status}. ${coverageAssessment.detail}`,
    );
    return {
      resource_manifest: repair.manifest,
      coverage_assessment: coverageAssessment,
      error_log:
        consistencyError ?? (coverageAssessment.status === "blocked"
          ? `Student-first coverage blocked publication: ${coverageAssessment.detail}`
          : null),
    };
  };
}
