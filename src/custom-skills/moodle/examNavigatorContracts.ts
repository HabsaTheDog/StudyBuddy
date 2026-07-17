import { z } from "zod";

export const ARTIFACT_PROFILES = [
  "study_guide",
  "exam_navigator",
  "interactive_learning",
  "practice_pack",
  "source_audit",
] as const;

export const OUTPUT_FORMATS = ["html", "pdf"] as const;
export const PUBLICATION_STATUSES = ["complete", "partial", "blocked"] as const;
export const RESOURCE_STATUSES = [
  "discovered",
  "acquired",
  "metadata_only",
  "stale",
  "unauthorized",
  "not_found",
  "unsupported",
  "transient_failure",
  "tls_failure",
  "failed",
  "skipped",
] as const;
export const RESOURCE_FAILURE_KINDS = [
  "tls",
  "timeout",
  "auth",
  "not_found",
  "stale_resource",
  "unexpected_content",
  "unsupported",
  "network",
  "http",
  "unknown",
] as const;

export type ArtifactProfile = (typeof ARTIFACT_PROFILES)[number];
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export type SourcePolicy = "course_only" | "course_first" | "open_research";
export type LinkPolicy = "local_preview_and_origin" | "origin_only";

export const ResourceNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  sectionPath: z.array(z.string()),
  activityType: z.string().min(1),
  title: z.string().min(1),
  originUrl: z.string().min(1),
  resolvedUrl: z.string().nullable(),
  localPath: z.string().nullable(),
  previewPath: z.string().nullable(),
  status: z.enum(RESOURCE_STATUSES),
  checksum: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  examRelevance: z.enum(["confirmed", "inferred", "unknown"]),
  failureReason: z.string().nullable(),
  canonicalUrl: z.string().nullable().optional(),
  locators: z.array(z.string()).optional(),
  contentType: z.string().nullable().optional(),
  failureKind: z.enum(RESOURCE_FAILURE_KINDS).nullable().optional(),
  recommendedAction: z.string().nullable().optional(),
});

export const ResourceManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  courseUrl: z.string().nullable(),
  generatedAt: z.string(),
  resources: z.array(ResourceNodeSchema),
});

export const EvidenceRecordSchema = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  kind: z.enum([
    "claim",
    "definition",
    "formula",
    "table",
    "figure",
    "exercise",
    "solution",
  ]),
  locator: z.object({
    page: z.number().int().positive().optional(),
    section: z.string().optional(),
    timestamp: z.string().optional(),
  }),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  pairId: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  localPath: z.string().nullable(),
});

export const EvidencePackageSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string(),
  records: z.array(EvidenceRecordSchema),
  warnings: z.array(z.string()),
});

export const CoverageAssessmentSchema = z.object({
  status: z.enum(PUBLICATION_STATUSES),
  detail: z.string(),
  criticalMissing: z.array(z.string()),
  omittedTopics: z.array(z.string()),
  retryActions: z.array(z.string()),
  discoveredResources: z.number().int().nonnegative(),
  acquiredResources: z.number().int().nonnegative(),
  failedResources: z.number().int().nonnegative(),
  usableEvidenceRecords: z.number().int().nonnegative(),
  resourceIssues: z.array(z.object({
    status: z.enum(RESOURCE_STATUSES),
    count: z.number().int().positive(),
    titles: z.array(z.string()),
    explanation: z.string(),
    retryable: z.boolean(),
  })).optional(),
});

export const StudySourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  originUrl: z.string().nullable(),
  localPath: z.string().nullable(),
  previewPath: z.string().nullable(),
  kind: z.string().min(1),
});

export const StudyTopicSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().nullable().default(null),
  title: z.string().min(1),
  summary: z.string().min(1),
  priority: z.enum(["essential", "important", "supplementary"]),
  scopeStatus: z.enum(["confirmed", "inferred", "unknown"]),
  learningGoals: z.array(z.string().min(1)),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const StudyFormulaSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().nullable().default(null),
  name: z.string().min(1),
  expression: z.string().min(1),
  variables: z.array(z.string().min(1)).min(1),
  units: z.array(z.string().min(1)).min(1),
  assumptions: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const StudyExampleSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().nullable().default(null),
  prompt: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  result: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const PracticeItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["question", "flashcard", "exercise"]),
  prompt: z.string().min(1),
  answer: z.string().min(1),
  learningGoal: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
});

export const CourseChapterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  order: z.number().int().nonnegative(),
  status: z.enum(["covered", "partial", "missing"]),
  topicIds: z.array(z.string().min(1)),
  resourceIds: z.array(z.string().min(1)),
});

export const StudyFigureSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().nullable().default(null),
  kind: z.enum([
    "moodle_pdf_image",
    "moodle_pdf_page",
    "moodle_page_screenshot",
    "cis_page_screenshot",
    "typst_diagram",
    "placeholder_prompt",
  ]),
  title: z.string().min(1),
  caption: z.string().min(1),
  relativePath: z.string().nullable(),
  sourcePage: z.number().int().positive().nullable(),
  widthPx: z.number().int().positive().nullable().default(null),
  heightPx: z.number().int().positive().nullable().default(null),
  sourceIds: z.array(z.string().min(1)),
  generationPrompt: z.string().nullable(),
});

export const StudyModelSchema = z.object({
  schemaVersion: z.literal("1.0"),
  profile: z.enum(ARTIFACT_PROFILES),
  language: z.enum(["de", "en"]),
  title: z.string().min(1),
  courseTitle: z.string().min(1),
  courseUrl: z.string().nullable(),
  publicationStatus: z.enum(PUBLICATION_STATUSES),
  scopeNote: z.string(),
  courseChapters: z.array(CourseChapterSchema).default([]),
  topics: z.array(StudyTopicSchema),
  formulas: z.array(StudyFormulaSchema),
  workedExamples: z.array(StudyExampleSchema),
  figures: z.array(StudyFigureSchema).default([]),
  checklist: z.array(z.string().min(1)),
  practiceItems: z.array(PracticeItemSchema),
  sources: z.array(StudySourceSchema),
  warnings: z.array(z.string()),
});

export const ReviewFindingSchema = z.object({
  gate: z.enum([
    "resource",
    "citation",
    "student_value",
    "math",
    "diagram",
    "link",
    "ux",
    "adversarial",
  ]),
  severity: z.enum(["info", "warning", "error"]),
  code: z.string().min(1),
  message: z.string().min(1),
});

export const ReviewReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  ok: z.boolean(),
  generatedAt: z.string(),
  findings: z.array(ReviewFindingSchema),
});

export const ArtifactBundleSchema = z.object({
  status: z.enum(PUBLICATION_STATUSES),
  htmlPath: z.string().optional(),
  pdfPath: z.string().optional(),
  sourceMapPath: z.string(),
  evidencePath: z.string(),
  coverageReportPath: z.string(),
  reviewReportPath: z.string(),
});

export type ResourceNode = z.infer<typeof ResourceNodeSchema>;
export type ResourceManifest = z.infer<typeof ResourceManifestSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;
export type CoverageAssessment = z.infer<typeof CoverageAssessmentSchema>;
export type CourseChapter = z.infer<typeof CourseChapterSchema>;
export type StudyFigure = z.infer<typeof StudyFigureSchema>;
export type StudyModel = z.infer<typeof StudyModelSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewReport = z.infer<typeof ReviewReportSchema>;
export type ArtifactBundle = z.infer<typeof ArtifactBundleSchema>;

export const emptyResourceManifest = (): ResourceManifest => ({
  schemaVersion: "1.0",
  courseUrl: null,
  generatedAt: new Date(0).toISOString(),
  resources: [],
});

export const emptyEvidencePackage = (): EvidencePackage => ({
  schemaVersion: "1.0",
  generatedAt: new Date(0).toISOString(),
  records: [],
  warnings: [],
});

export const emptyCoverageAssessment = (): CoverageAssessment => ({
  status: "blocked",
  detail: "Coverage has not been assessed.",
  criticalMissing: [],
  omittedTopics: [],
  retryActions: [],
  discoveredResources: 0,
  acquiredResources: 0,
  failedResources: 0,
  usableEvidenceRecords: 0,
});

export const emptyStudyModel = (): StudyModel => ({
  schemaVersion: "1.0",
  profile: "study_guide",
  language: "de",
  title: "Study Buddy Lernunterlage",
  courseTitle: "Unbekannter Kurs",
  courseUrl: null,
  publicationStatus: "blocked",
  scopeNote: "",
  courseChapters: [],
  topics: [],
  formulas: [],
  workedExamples: [],
  figures: [],
  checklist: [],
  practiceItems: [],
  sources: [],
  warnings: [],
});

export const emptyReviewReport = (): ReviewReport => ({
  schemaVersion: "1.0",
  ok: false,
  generatedAt: new Date(0).toISOString(),
  findings: [],
});
