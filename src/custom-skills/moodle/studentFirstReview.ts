import { stat } from "node:fs/promises";
import {
  ReviewReportSchema,
  type CoverageAssessment,
  type EvidencePackage,
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
  evidence?: EvidencePackage,
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
  if (model.profile === "study_guide") {
    for (const chapter of model.courseChapters.filter((entry) => entry.status === "covered")) {
      const topics = model.topics.filter((topic) => topic.chapterId === chapter.id);
      if (topics.length === 0) {
        findings.push(error(
          "student_value",
          "chapter-content-missing",
          `Covered chapter has no source-backed subject content: ${chapter.title}`,
        ));
      }
    }
    if (evidence) validateIncludedLookupDependencies(model, manifest, evidence, findings);
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

function validateIncludedLookupDependencies(
  model: StudyModel,
  manifest: ResourceManifest,
  evidence: EvidencePackage,
  findings: ReviewFinding[],
): void {
  const dependencyResourceIds = new Set(
    evidence.records
      .filter((record) => hasTableLookupDependency(record.content))
      .map((record) => record.resourceId),
  );
  const checkedChapters = new Set<string>();
  for (const resourceId of dependencyResourceIds) {
    const resource = manifest.resources.find((entry) => entry.id === resourceId);
    const chapter = model.courseChapters.find((entry) => entry.resourceIds.includes(resourceId));
    if (!resource || !chapter || chapter.status === "missing" || checkedChapters.has(chapter.id)) continue;
    checkedChapters.add(chapter.id);

    const examples = model.workedExamples.filter((example) => example.chapterId === chapter.id);
    if (examples.length === 0) continue;
    const hasLookupMethod = examples.some((example) =>
      /(?:tabelle|tabellenzeile|tabellenspalte|nennmaßbereich|nennmassbereich|toleranzgrad|grundabmaß|grundabmass|ablesen|nachschlagen|TB\s*\d)/i.test(
        `${example.learningGoal} ${example.prompt} ${example.steps.join(" ")} ${example.result}`,
      )
    );
    if (!hasLookupMethod) {
      findings.push(error(
        "student_value",
        "lookup-method-missing",
        `An included worked example uses a table lookup but skips the lookup method and starts from pre-read values: ${chapter.title}`,
      ));
    }
  }
}

function hasTableLookupDependency(text: string): boolean {
  return /(?:mit\s+den\s+werten\s+der\s+tabellen|tabellen?\s*TB\s*\d|TB\s*\d+\s*[-–]\s*\d+|nach\s+(?:der\s+)?tabelle|aus\s+(?:der\s+)?tabelle|tabellenbuch)/i.test(text);
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
