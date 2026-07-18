import type { CodexClient } from "../../codexClient.js";
import type { ExtractedData } from "../../schemas.js";
import type { LangGraphAgentState } from "../../state.js";
import type { MoodleRuntimeConfig } from "../../types.js";
import {
  emptyCoverageAssessment,
  emptyEvidencePackage,
  emptyResourceManifest,
  emptyReviewReport,
  emptyStudyModel,
} from "../../examNavigatorContracts.js";
import { emptySourceArchitectDecision } from "../../sourceArchitect.js";
import { classifyArtifactIntent } from "../../studentFirstPolicy.js";

export function moodleTestConfig(overrides: Partial<MoodleRuntimeConfig> = {}): MoodleRuntimeConfig {
  return {
    prompt: "make compact notes",
    moodleUrl: "https://moodle.example/course",
    outputPath: "/tmp/document.typ",
    requestName: "test",
    runDir: "/tmp",
    maxDepth: 0,
    maxPages: 1,
    maxCisPages: 1,
    allowFileDownloads: false,
    baseUrl: "https://moodle.example",
    dashboardUrl: "https://moodle.example/my",
    cisUrls: [],
    cisBaseUrl: "https://cis.example",
    cisDashboardUrl: "https://cis.example/cis.php",
    headless: true,
    browserBackend: "playwright",
    diagnosticOnly: false,
    autoAnswer: false,
    quizPolicy: {
      requestedAutoAnswer: false,
      settingAutoAnswer: false,
      requireManualReview: true,
      blockFinalSubmit: true,
      draftOnly: true,
      allowAttemptOpen: false,
      allowTimedQuiz: false,
      allowLimitedAttemptQuiz: false,
      allowQuestionRead: true,
      allowAnswerFill: false,
      allowAnswerChange: false,
      allowSaveOrMovePage: false,
      allowFinalSubmit: false,
    },
    maxRuntimeMs: 60_000,
    idleTimeoutMs: 30_000,
    stage: "all",
    includeCis: false,
    sourceMode: "auto",
    downloadConcurrency: 3,
    typstValidationMode: "balanced",
    renderStrategy: "auto",
    visualsEnabled: true,
    visualMode: "inline",
    visualCropMode: "auto",
    maxVisualAssets: 3,
    visualMinConfidence: 0.65,
    artifactIntent: classifyArtifactIntent("make compact notes"),
    codexPreflightMode: "off",
    codexModelExplicit: false,
    runtimeCacheDir: "/tmp/study-buddy-runtime-cache",
    executionProfile: "auto",
    ...overrides,
  };
}

export function moodleTestState(overrides: Partial<LangGraphAgentState> = {}): LangGraphAgentState {
  return {
    moodle_raw_text: "",
    extracted_data: {},
    final_document: "",
    error_log: null,
    retry_count: 0,
    resource_manifest: emptyResourceManifest(),
    evidence_package: emptyEvidencePackage(),
    coverage_assessment: emptyCoverageAssessment(),
    study_model: emptyStudyModel(),
    review_report: emptyReviewReport(),
    artifact_bundle: null,
    source_architect_decision: emptySourceArchitectDecision(),
    ...overrides,
  };
}

export function moodleExtractedData(overrides: Partial<ExtractedData> = {}): ExtractedData {
  return {
    document_title: "DYN2",
    language: "de",
    course: { title: "Dynamik", url: "https://moodle.example/course" },
    sources: [],
    sections: [],
    formulas: [],
    worked_examples: [],
    quiz_style_questions: [],
    visual_assets: [],
    figures: [],
    learning_modules: [],
    warnings: [],
    ...overrides,
  };
}

export function sequenceCodex(outputs: string[]): CodexClient {
  let index = 0;
  return {
    async run() {
      const output = outputs[index];
      index += 1;
      if (output === undefined) {
        throw new Error("No mock Codex output left.");
      }
      return output;
    },
  };
}

export function studyBuddyTypstDocument(body = "= DYN2"): string {
  return `#import "study-buddy-components.typ": *

#sb-document(
  title: "DYN2 Lernzettel",
  short-title: "DYN2",
  course: "Dynamik",
  kind: "Lernzettel",
  semester: "SS 2026",
  status: "Erstellt",
  date: "07.06.2026",
  body: [
    ${body}
  ],
)
`;
}
