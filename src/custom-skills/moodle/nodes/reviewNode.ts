import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { reviewStudyModel } from "../studentFirstReview.js";

export function createReviewNode(config: MoodleRuntimeConfig) {
  return async function reviewNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const reviewReport = await reviewStudyModel(
      state.study_model,
      state.coverage_assessment,
      state.resource_manifest,
    );
    await writeFile(
      path.join(config.runDir, "review-report.json"),
      `${JSON.stringify(reviewReport, null, 2)}\n`,
      "utf8",
    );
    return {
      review_report: reviewReport,
      error_log: reviewReport.ok
        ? null
        : `Student-first review failed:\n${reviewReport.findings
            .filter((finding) => finding.severity === "error")
            .map((finding) => `- ${finding.message}`)
            .join("\n")}`,
      retry_count: reviewReport.ok ? state.retry_count : state.retry_count + 1,
    };
  };
}
