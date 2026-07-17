import { stat } from "node:fs/promises";
import {
  ReviewReportSchema,
  type CoverageAssessment,
  type ResourceManifest,
  type ReviewFinding,
  type ReviewReport,
  type StudyModel,
} from "./examNavigatorContracts.js";
import { isResourceFailureStatus } from "./resourceAcquisition.js";

export async function reviewStudyModel(
  model: StudyModel,
  coverage: CoverageAssessment,
  manifest: ResourceManifest,
): Promise<ReviewReport> {
  const findings: ReviewFinding[] = [];
  if (coverage.status === "blocked") {
    findings.push(error("resource", "coverage-blocked", coverage.detail));
  } else if (coverage.status === "partial") {
    findings.push(warning("resource", "coverage-partial", coverage.detail));
  }

  const sourceIds = new Set(model.sources.map((source) => source.id));
  for (const topic of model.topics) {
    if (!topic.sourceIds.every((sourceId) => sourceIds.has(sourceId))) {
      findings.push(error("citation", "topic-source-missing", `Topic without valid source: ${topic.title}`));
    }
  }
  for (const formula of model.formulas) {
    if (
      formula.variables.length === 0 ||
      formula.units.length === 0 ||
      !formula.assumptions.trim()
    ) {
      findings.push(error("math", "formula-metadata", `Formula metadata incomplete: ${formula.name}`));
    }
  }
  if (model.profile === "study_guide" && model.practiceItems.length > 0) {
    findings.push(error("student_value", "study-guide-practice", "Study guides must not contain practice items."));
  }
  if (model.profile === "study_guide") {
    for (const chapter of model.courseChapters.filter((entry) => entry.status === "covered")) {
      const topics = model.topics.filter((topic) => topic.chapterId === chapter.id);
      const learningCharacters = topics.reduce(
        (total, topic) => total + topic.summary.length + topic.learningGoals.join(" ").length,
        0,
      );
      if (learningCharacters < 1_200) {
        findings.push(error(
          "student_value",
          "chapter-too-shallow",
          `Chapter is too shallow to learn from (${learningCharacters}/1200 learning characters): ${chapter.title}`,
        ));
      }
      if (!model.workedExamples.some((example) => example.chapterId === chapter.id)) {
        findings.push(error(
          "student_value",
          "chapter-example-missing",
          `Covered technical chapter has no worked example: ${chapter.title}`,
        ));
      }
    }
  }
  if (new Set(model.checklist).size !== model.checklist.length) {
    findings.push(error("student_value", "duplicate-checklist", "The learning checklist contains duplicates."));
  }
  if (
    model.topics.length === 0 &&
    model.profile !== "source_audit" &&
    manifest.resources.length > 0
  ) {
    findings.push(error("student_value", "no-subject-topics", "No supported subject-matter topic remains."));
  }

  for (const source of model.sources) {
    if (source.originUrl && !isSafeOriginUrl(source.originUrl)) {
      findings.push(error("link", "unsafe-origin", `Unsafe source URL: ${source.originUrl}`));
    }
    if (source.previewPath) {
      const previewStat = await stat(source.previewPath).catch(() => null);
      if (!previewStat?.isFile()) {
        findings.push(warning("link", "missing-preview", `Local preview is missing: ${source.title}`));
      }
    }
  }
  if (
    manifest.resources.some(
      (resource) => isResourceFailureStatus(resource.status) && !resource.failureReason,
    )
  ) {
    findings.push(warning("resource", "failure-without-reason", "A resource failed without a recorded reason."));
  }

  return ReviewReportSchema.parse({
    schemaVersion: "1.0",
    ok: !findings.some((finding) => finding.severity === "error"),
    generatedAt: new Date().toISOString(),
    findings,
  });
}

function isSafeOriginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function error(
  gate: ReviewFinding["gate"],
  code: string,
  message: string,
): ReviewFinding {
  return { gate, severity: "error", code, message };
}

function warning(
  gate: ReviewFinding["gate"],
  code: string,
  message: string,
): ReviewFinding {
  return { gate, severity: "warning", code, message };
}
