import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  assessmentBlueprintSchema,
  courseBlueprintSchema,
  questionBankSchema,
} from "../adaptiveStudyModel.js";
import type { InteractiveEvalCheck } from "./evaluate.js";
import {
  DEFAULT_VNEXT_HARD_GATES,
  type VNextBenchmarkManifest,
  type VNextHardGates,
} from "./vnextBenchmark.js";

type JsonRecord = Record<string, unknown>;

export interface VNextArtifactStatus {
  present: boolean;
  valid: boolean;
  issues: string[];
}

export interface VNextQualityRatios {
  questionsWithStableIdRatio: number;
  questionsWithObjectiveRatio: number;
  questionsWithResponseContractRatio: number;
  questionsWithOriginRatio: number;
  questionsWithScopeBasisRatio: number;
  questionsWithPassingReviewRatio: number;
}

export interface VNextHardCheck {
  id: keyof VNextHardGates;
  passed: boolean;
  actual: boolean | number;
  expected: boolean | number;
  evidence: string;
}

export interface VNextEvalResult {
  detected: true;
  artifacts: {
    courseBlueprint: VNextArtifactStatus;
    assessmentBlueprint: VNextArtifactStatus;
    questionBank: VNextArtifactStatus;
    errorLog: VNextArtifactStatus;
    interactionAudit: VNextArtifactStatus;
  };
  structure: {
    courseModules: number;
    learningObjectives: number;
    questionBankItems: number;
    learningStages: number;
    assessmentSections: number;
    coveredObjectives: number;
    uncoveredObjectives: number;
    generatedQuestions: number;
  };
  quality: VNextQualityRatios;
  hardChecks: VNextHardCheck[];
  hardGatesPassed: boolean;
}

export interface VNextEvaluationContext {
  html: string;
  summary: string;
  qualityReview: JsonRecord | undefined;
}

export async function evaluateVNextArtifacts(
  runDir: string,
  context: VNextEvaluationContext,
  manifest?: VNextBenchmarkManifest,
): Promise<{ result?: VNextEvalResult; checks: InteractiveEvalCheck[] }> {
  const artifactPaths = {
    courseBlueprint: path.join(runDir, "course-blueprint.json"),
    assessmentBlueprint: path.join(runDir, "assessment-blueprint.json"),
    questionBank: path.join(runDir, "question-bank.json"),
  };
  const artifactPresence = await Promise.all(Object.values(artifactPaths).map(exists));
  if (!artifactPresence.some(Boolean)) return { checks: [] };

  const [
    courseValue,
    assessmentValue,
    bankValue,
    errorLogRead,
    interactionAuditRead,
  ] = await Promise.all([
    readJsonArtifact(artifactPaths.courseBlueprint),
    readJsonArtifact(artifactPaths.assessmentBlueprint),
    readJsonArtifact(artifactPaths.questionBank),
    readTextArtifact(path.join(runDir, "error.log")),
    readJsonArtifact(path.join(runDir, "interaction-audit.json")),
  ]);
  const courseParsed = courseBlueprintSchema.safeParse(courseValue.value);
  const assessmentParsed = assessmentBlueprintSchema.safeParse(assessmentValue.value);
  const bankParsed = questionBankSchema.safeParse(bankValue.value);
  const audit = isRecord(interactionAuditRead.value) ? interactionAuditRead.value : undefined;
  const course = courseParsed.success ? courseParsed.data : undefined;
  const assessment = assessmentParsed.success ? assessmentParsed.data : undefined;
  const bank = bankParsed.success ? bankParsed.data : undefined;
  const rawItems = bank?.items ?? arrayAt(bankValue.value, "items");
  const quality = questionQualityRatios(rawItems);
  const objectiveCount = course?.modules.reduce(
    (total, module) => total + module.learningObjectives.length,
    0,
  ) ?? 0;
  const structure = {
    courseModules: course?.modules.length ?? 0,
    learningObjectives: objectiveCount,
    questionBankItems: rawItems.length,
    learningStages: course?.learningStages.length ?? 0,
    assessmentSections: assessment?.sections.length ?? 0,
    coveredObjectives: bank?.coverage.coveredObjectiveIds.length ?? 0,
    uncoveredObjectives: bank?.coverage.missingObjectiveIds.length ?? objectiveCount,
    generatedQuestions: rawItems.filter((item) =>
      isRecord(item) && item.origin === "study_buddy_generated"
    ).length,
  };
  const artifacts = {
    courseBlueprint: artifactStatus(courseValue.present, courseParsed),
    assessmentBlueprint: artifactStatus(assessmentValue.present, assessmentParsed),
    questionBank: artifactStatus(bankValue.present, bankParsed),
    errorLog: {
      present: errorLogRead.present,
      valid: errorLogRead.present && errorLogRead.value.trim().length === 0,
      issues: errorLogRead.present && errorLogRead.value.trim().length === 0
        ? []
        : [errorLogRead.present ? "error.log is not empty" : "error.log is missing"],
    },
    interactionAudit: {
      present: interactionAuditRead.present,
      valid: interactionAuditRead.present && audit !== undefined,
      issues: interactionAuditRead.present && audit
        ? []
        : [interactionAuditRead.present ? "interaction-audit.json is invalid JSON" : "interaction-audit.json is missing"],
    },
  };
  const expected = manifest?.hardGates ?? DEFAULT_VNEXT_HARD_GATES;
  const requiredScenarios = manifest?.learnerStateScenarios ?? [];
  const derivedUnsupportedClaims = inferredOfficialAssessmentClaims(assessmentValue.value);
  const auditedUnsupportedClaims = auditNumber(audit, "unsupportedOfficialAssessmentClaims");
  const actual: Record<keyof VNextHardGates, boolean | number> = {
    terminalArtifact: context.html.length > 0 && /Run status:\s*success/i.test(context.summary),
    emptyErrorLog: artifacts.errorLog.valid,
    qualityReviewPassed: context.qualityReview?.ok === true,
    permissionViolations: auditNumber(audit, "permissionViolations"),
    finalQuizSubmissions: auditNumber(audit, "finalQuizSubmissions"),
    runtimeNetworkRequests: auditNumber(audit, "runtimeNetworkRequests"),
    blockingBrowserIssues: auditNumber(audit, "failureCount"),
    ...quality,
    generatedQuestionsOutsideScope: generatedQuestionsOutsideScope(rawItems),
    unsupportedOfficialAssessmentClaims: Number.isFinite(auditedUnsupportedClaims)
      ? Math.max(derivedUnsupportedClaims, auditedUnsupportedClaims)
      : derivedUnsupportedClaims,
    requiredLearnerStateScenariosPassed: learnerStateScenariosPassed(audit, requiredScenarios),
  };
  const evidence: Record<keyof VNextHardGates, string> = {
    terminalArtifact: "document.html and terminal run-summary.md",
    emptyErrorLog: "error.log",
    qualityReviewPassed: "quality-review.json",
    permissionViolations: "interaction-audit.json permission audit",
    finalQuizSubmissions: "interaction-audit.json permission audit",
    runtimeNetworkRequests: "interaction-audit.json browser audit",
    blockingBrowserIssues: "interaction-audit.json failureCount",
    questionsWithStableIdRatio: "question-bank.json items",
    questionsWithObjectiveRatio: "question-bank.json items",
    questionsWithResponseContractRatio: "question-bank.json items",
    questionsWithOriginRatio: "question-bank.json items",
    questionsWithScopeBasisRatio: "question-bank.json items",
    questionsWithPassingReviewRatio: "question-bank.json items",
    generatedQuestionsOutsideScope: "question-bank.json generated item review",
    unsupportedOfficialAssessmentClaims: "assessment-blueprint.json and interaction audit",
    requiredLearnerStateScenariosPassed: "interaction-audit.json learner-state scenarios",
  };
  const hardChecks = (Object.keys(expected) as Array<keyof VNextHardGates>).map((id) => ({
    id,
    passed: hardGatePassed(id, actual[id], expected[id]),
    actual: actual[id],
    expected: expected[id],
    evidence: evidence[id],
  }));
  const checks: InteractiveEvalCheck[] = [];
  addArtifactCheck(checks, "vnext-course-blueprint", artifacts.courseBlueprint);
  addArtifactCheck(checks, "vnext-assessment-blueprint", artifacts.assessmentBlueprint);
  addArtifactCheck(checks, "vnext-question-bank", artifacts.questionBank);
  addArtifactCheck(checks, "vnext-interaction-audit", artifacts.interactionAudit);
  for (const hardCheck of hardChecks) {
    checks.push({
      id: `vnext:${hardCheck.id}`,
      category: qualityGate(hardCheck.id) ? "quality" : "reliability",
      passed: hardCheck.passed,
      actual: hardCheck.actual,
      expected: hardCheck.expected,
    });
  }
  const toolboxSelectionPassed = course !== undefined && bank !== undefined &&
    course.modules.every((module) => {
      const kinds = new Set(module.learningBlocks.map((block) => block.kind));
      const moduleItems = bank.items.filter((item) => item.topicId === module.id);
      if (!kinds.has("theory") || !kinds.has("worked-example")) return false;
      if (kinds.has("vocabulary-recall") && !moduleItems.some((item) => item.type === "vocabulary")) return false;
      if (kinds.has("calculation-practice") && !moduleItems.some((item) => item.type === "calculation")) return false;
      if (kinds.has("selection-practice") && !moduleItems.some((item) => item.type === "cross")) return false;
      if (kinds.has("open-response") && !moduleItems.some((item) => item.type === "application")) return false;
      return true;
    });
  const assessmentComposition = embeddedJson(context.html, "assessment-composition");
  const excludedIds = new Set(
    arrayAt(assessmentComposition, "excludedSections")
      .flatMap((entry) => isRecord(entry) && nonEmptyString(entry.id) ? [entry.id] : []),
  );
  const externalSections = assessment?.sections.filter((section) =>
    section.deliveryMode === "external-performance"
  ) ?? [];
  const honestAssessmentCompositionPassed = assessment !== undefined &&
    assessment.sections.every((section) => Boolean(section.deliveryMode)) &&
    externalSections.every((section) => excludedIds.has(section.id));
  checks.push(
    {
      id: "vnext:evidenceDrivenToolboxSelection",
      category: "quality",
      passed: toolboxSelectionPassed,
      actual: toolboxSelectionPassed,
      expected: true,
    },
    {
      id: "vnext:honestAssessmentComposition",
      category: "quality",
      passed: honestAssessmentCompositionPassed,
      actual: honestAssessmentCompositionPassed,
      expected: true,
    },
  );
  const result: VNextEvalResult = {
    detected: true,
    artifacts,
    structure,
    quality,
    hardChecks,
    hardGatesPassed: hardChecks.every((check) => check.passed) &&
      toolboxSelectionPassed &&
      honestAssessmentCompositionPassed &&
      Object.values(artifacts).every((artifact) => artifact.valid),
  };
  return { result, checks };
}

function embeddedJson(html: string, id: string): unknown {
  const match = new RegExp(`<script[^>]+id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i").exec(html);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

function questionQualityRatios(items: unknown[]): VNextQualityRatios {
  const idCounts = new Map<string, number>();
  for (const item of items) {
    if (!isRecord(item) || !nonEmptyString(item.id)) continue;
    idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
  }
  return {
    questionsWithStableIdRatio: ratio(items, (item) =>
      isRecord(item) && nonEmptyString(item.id) && idCounts.get(item.id) === 1
    ),
    questionsWithObjectiveRatio: ratio(items, (item) =>
      isRecord(item) && nonEmptyStringArray(item.learningObjectiveIds)
    ),
    questionsWithResponseContractRatio: ratio(items, hasResponseContract),
    questionsWithOriginRatio: ratio(items, (item) =>
      isRecord(item) &&
      ["course_original", "course_variant", "study_buddy_generated"].includes(String(item.origin))
    ),
    questionsWithScopeBasisRatio: ratio(items, (item) => {
      if (!isRecord(item) || !isRecord(item.scopeBasis)) return false;
      return nonEmptyString(item.scopeBasis.topicTitle) &&
        nonEmptyStringArray(item.scopeBasis.learningObjectives) &&
        nonEmptyString(item.scopeBasis.sourceLabel) &&
        nonEmptyString(item.scopeBasis.sourceTask);
    }),
    questionsWithPassingReviewRatio: ratio(items, passingReview),
  };
}

function hasResponseContract(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (isRecord(value.responseContract)) return Object.keys(value.responseContract).length > 0;
  const exercise = isRecord(value.exercise) ? value.exercise : value;
  if (exercise.type === "cross") {
    return Array.isArray(exercise.options) &&
      exercise.options.some((option) => isRecord(option) && option.correct === true);
  }
  if (exercise.type === "calculation") return nonEmptyStringArray(exercise.acceptedAnswers);
  if (exercise.type === "application") {
    return nonEmptyString(exercise.sampleAnswer) && nonEmptyStringArray(exercise.selfCheck);
  }
  if (exercise.type === "vocabulary") {
    return nonEmptyString(exercise.term) &&
      nonEmptyStringArray(exercise.acceptedAnswers) &&
      nonEmptyString(exercise.context);
  }
  return false;
}

function passingReview(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.review) || value.review.status !== "approved") return false;
  if (!isRecord(value.review.checks)) return false;
  return ["schema", "scope", "answer", "provenance", "rendering"].every(
    (key) => value.review && isRecord(value.review) &&
      isRecord(value.review.checks) && value.review.checks[key] === true,
  );
}

function generatedQuestionsOutsideScope(items: unknown[]): number {
  return items.filter((item) => {
    if (!isRecord(item) || item.origin !== "study_buddy_generated") return false;
    return !isRecord(item.review) ||
      !isRecord(item.review.checks) ||
      item.review.checks.scope !== true;
  }).length;
}

function inferredOfficialAssessmentClaims(value: unknown): number {
  if (!isRecord(value) || value.mode !== "inferred_practice") return 0;
  const officialFields = ["durationMinutes", "maxPoints", "passingPoints"];
  const claimsOfficialValue = officialFields.some((field) => value[field] !== null && value[field] !== undefined);
  const officialTitle = /(?:exam simulation|prüfungssimulation|official|offiziell)/i.test(String(value.title ?? ""));
  return claimsOfficialValue || officialTitle ? 1 : 0;
}

function learnerStateScenariosPassed(audit: JsonRecord | undefined, required: string[]): boolean {
  const value = nestedValue(audit, ["learnerStateScenarios"], ["learnerState"]);
  if (value === true) return true;
  if (required.length === 0) {
    return audit?.requiredLearnerStateScenariosPassed === true;
  }
  if (Array.isArray(value)) {
    const passed = new Set(value.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (isRecord(entry) && entry.passed === true && nonEmptyString(entry.id)) return [entry.id];
      return [];
    }));
    return required.every((id) => passed.has(id));
  }
  if (isRecord(value)) return required.every((id) => value[id] === true);
  return false;
}

function auditNumber(
  audit: JsonRecord | undefined,
  key: string,
  fallback = Number.POSITIVE_INFINITY,
): number {
  const value = nestedValue(audit, [key], ["hardGates", key], ["permissionAudit", key], ["browserAudit", key]);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nestedValue(root: JsonRecord | undefined, ...paths: string[][]): unknown {
  for (const keys of paths) {
    let value: unknown = root;
    for (const key of keys) value = isRecord(value) ? value[key] : undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

function artifactStatus(
  present: boolean,
  parsed: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } },
): VNextArtifactStatus {
  if (!present) return { present: false, valid: false, issues: ["artifact is missing"] };
  if (parsed.success) return { present: true, valid: true, issues: [] };
  return {
    present: true,
    valid: false,
    issues: (parsed.error?.issues ?? []).slice(0, 12).map((issue) =>
      `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`
    ),
  };
}

function addArtifactCheck(
  checks: InteractiveEvalCheck[],
  id: string,
  artifact: VNextArtifactStatus,
): void {
  checks.push({
    id,
    category: "reliability",
    passed: artifact.valid,
    actual: artifact.valid,
    expected: true,
  });
}

function qualityGate(id: keyof VNextHardGates): boolean {
  return id === "qualityReviewPassed" ||
    id.startsWith("questionsWith") ||
    id === "generatedQuestionsOutsideScope" ||
    id === "unsupportedOfficialAssessmentClaims";
}

function hardGatePassed(
  id: keyof VNextHardGates,
  actual: boolean | number,
  expected: boolean | number,
): boolean {
  if (typeof expected === "boolean") return actual === expected;
  if (id.startsWith("questionsWith")) return typeof actual === "number" && actual >= expected;
  return typeof actual === "number" && actual <= expected;
}

function ratio(items: unknown[], predicate: (item: unknown) => boolean): number {
  if (items.length === 0) return 0;
  return items.filter(predicate).length / items.length;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function arrayAt(value: unknown, key: string): unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then((value) => value.isFile()).catch(() => false);
}

async function readTextArtifact(filePath: string): Promise<{ present: boolean; value: string }> {
  try {
    return { present: true, value: await readFile(filePath, "utf8") };
  } catch {
    return { present: false, value: "" };
  }
}

async function readJsonArtifact(filePath: string): Promise<{ present: boolean; value: unknown }> {
  const text = await readTextArtifact(filePath);
  if (!text.present) return { present: false, value: undefined };
  try {
    return { present: true, value: JSON.parse(text.value) };
  } catch {
    return { present: true, value: undefined };
  }
}
