import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { reviewStudyModel } from "../studentFirstReview.js";
import { ReviewReportSchema, StudyModelSchema } from "../examNavigatorContracts.js";
import { validateExtractedData } from "../validation.js";

export function createReviewNode(config: MoodleRuntimeConfig) {
  return async function reviewNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    let reviewReport = await reviewStudyModel(
      state.study_model,
      state.coverage_assessment,
      state.resource_manifest,
      state.evidence_package,
    );
    const partial = !reviewReport.ok && state.retry_count >= 2
      ? await finalizeDegradableChapterGaps(state, reviewReport)
      : null;
    if (partial) reviewReport = partial.reviewReport;
    await writeFile(
      path.join(config.runDir, "review-report.json"),
      `${JSON.stringify(reviewReport, null, 2)}\n`,
      "utf8",
    );
    return {
      review_report: reviewReport,
      ...(partial
        ? {
            study_model: partial.studyModel,
            extracted_data: partial.extractedData,
          }
        : {}),
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

async function finalizeDegradableChapterGaps(
  state: LangGraphAgentState,
  report: Awaited<ReturnType<typeof reviewStudyModel>>,
) {
  const blocking = report.findings.filter((finding) => finding.severity === "error");
  if (
    blocking.length === 0 ||
    blocking.some((finding) =>
      finding.code !== "chapter-too-shallow" && finding.code !== "chapter-example-missing"
    )
  ) return null;

  const chapterTitles = state.study_model.courseChapters
    .filter((chapter) => blocking.some((finding) => finding.message.includes(chapter.title)))
    .map((chapter) => chapter.title);
  if (chapterTitles.length === 0) return null;

  const english = state.study_model.language === "en";
  const warnings = chapterTitles.map((title) => english
    ? `Chapter ${title} is not fully covered: after three targeted repair attempts, no sufficiently validated depth or representative application could be retained. Existing validated material remains available.`
    : `Kapitel ${title} ist nicht vollständig abgedeckt: Nach drei gezielten Reparaturversuchen konnte keine ausreichend validierte Vertiefung oder repräsentative Anwendung beibehalten werden. Bereits validiertes Material bleibt erhalten.`
  );
  const extracted = validateExtractedData(state.extracted_data);
  const extractedData = validateExtractedData({
    ...extracted,
    warnings: [...new Set([...extracted.warnings, ...warnings])],
  });
  const studyModel = StudyModelSchema.parse({
    ...state.study_model,
    publicationStatus: "partial",
    scopeNote: warnings.join(" "),
    courseChapters: state.study_model.courseChapters.map((chapter) =>
      chapterTitles.includes(chapter.title)
        ? { ...chapter, status: "partial" }
        : chapter
    ),
    warnings: [...new Set([...state.study_model.warnings, ...warnings])],
  });
  const rechecked = await reviewStudyModel(
    studyModel,
    state.coverage_assessment,
    state.resource_manifest,
    state.evidence_package,
  );
  if (!rechecked.ok) return null;
  const reviewReport = ReviewReportSchema.parse({
    ...rechecked,
    findings: [
      ...rechecked.findings,
      ...chapterTitles.map((title) => ({
        gate: "student_value" as const,
        severity: "warning" as const,
        code: "chapter-partial-after-repair",
        message: english
          ? `Published validated partial coverage for ${title}; the unresolved local learning-object gap is disclosed.`
          : `Validierte Teilabdeckung für ${title} veröffentlicht; die ungelöste lokale Lernobjekt-Lücke wird offengelegt.`,
      })),
    ],
  });
  return { extractedData, studyModel, reviewReport };
}
