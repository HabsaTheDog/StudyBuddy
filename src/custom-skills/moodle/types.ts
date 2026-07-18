import type { AgentState } from "./state.js";
import type { RunDiagnostics, SourceCoverage } from "./runDiagnostics.js";
import type { SourcePlan } from "./sourcePlanner.js";
import type { RenderStrategyDecision } from "./renderStrategy.js";
import type { QuizPolicy } from "./quizPolicy.js";
import type { StudyBuddyIntent, StudyBuddyIntentDecision } from "./taskIntent.js";
import type { CalendarSelection } from "./calendarAdapter.js";
import type {
  ArtifactBundle,
  ArtifactProfile,
  LinkPolicy,
  OutputFormat,
  SourcePolicy,
} from "./examNavigatorContracts.js";
import type { ArtifactIntent } from "./studentFirstPolicy.js";
import type { ExecutionTelemetry } from "./executionTelemetry.js";
import type {
  StudyBuddyExecutionProfile,
  StudyBuddyModelPolicyOverrides,
  StudyBuddyReasoningEffort,
} from "./modelPolicy.js";
import type { CodexPreflightMode, CodexRuntimeReport } from "./codexRuntime.js";
import type {
  LanguageResolutionReason,
  OutputLanguagePreference,
  SupportedLanguage,
} from "../shared/languagePolicy.js";

export type BrowserBackend = "playwright" | "agent-browser";
export type PipelineStage = "all" | "extract" | "render";
export type SourceMode = "auto" | "moodle" | "cis" | "both";
export type TypstValidationMode = "strict" | "balanced";
export type RenderStrategyMode = "auto" | "deterministic" | "llm_formatter";
export type VisualMode = "off" | "deferred" | "inline";
export type VisualCropMode = "auto" | "focused" | "context" | "original";

export interface MoodleGraphInput {
  prompt: string;
  /** Exact, untranslated user request. Language is resolved from this boundary value. */
  originalUserPrompt?: string;
  moodleUrl: string;
  outputPath?: string;
  requestName?: string;
  runDir?: string;
  maxDepth?: number;
  maxPages?: number;
  allowFileDownloads?: boolean;
  cisUrls?: string[];
  calendarUrl?: string;
  maxCisPages?: number;
  browserBackend?: BrowserBackend;
  browserHeaded?: boolean;
  diagnosticOnly?: boolean;
  autoAnswer?: boolean;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  stage?: PipelineStage;
  sourceRunDir?: string;
  /** Re-run normalization and extraction quality gates from a persisted handoff without crawling sources. */
  resumeExtractionRunDir?: string;
  includeCis?: boolean;
  sourceMode?: SourceMode;
  downloadConcurrency?: number;
  typstValidationMode?: TypstValidationMode;
  renderStrategy?: RenderStrategyMode;
  visualsEnabled?: boolean;
  visualMode?: VisualMode;
  visualCropMode?: VisualCropMode;
  maxVisualAssets?: number;
  visualMinConfidence?: number;
  artifactProfile?: ArtifactProfile;
  formats?: OutputFormat[];
  sourcePolicy?: SourcePolicy;
  linkPolicy?: LinkPolicy;
  codexModel?: string;
  codexReasoningEffort?: StudyBuddyReasoningEffort;
  codexPath?: string;
  codexCompatibilityFallbackModel?: string;
  codexPreflightMode?: CodexPreflightMode;
  executionProfile?: StudyBuddyExecutionProfile;
  modelPolicyOverrides?: StudyBuddyModelPolicyOverrides;
  outputLanguage?: OutputLanguagePreference;
}

export interface MoodleGraphResult {
  ok: boolean;
  coverageComplete: boolean;
  outputPath?: string;
  pdfPath?: string;
  answerPath?: string;
  answerJsonPath?: string;
  route: StudyBuddyIntent;
  runDir: string;
  runSummaryPath: string;
  state: AgentState;
  sourceCoverage: SourceCoverage;
  error?: string;
  extractedDataPath?: string;
  htmlPath?: string;
  artifactBundle?: ArtifactBundle;
  metricsPath: string;
  codexRuntime?: CodexRuntimeReport;
}

export interface MoodleRuntimeConfig {
  prompt: string;
  originalUserPrompt: string;
  moodleUrl: string;
  outputPath: string;
  requestName: string;
  runDir: string;
  maxDepth: number;
  maxPages: number;
  maxCisPages: number;
  allowFileDownloads: boolean;
  baseUrl: string;
  dashboardUrl: string;
  username?: string;
  password?: string;
  storageState?: string;
  cisUrls: string[];
  calendarUrl?: string;
  cisBaseUrl: string;
  cisDashboardUrl: string;
  cisUsername?: string;
  cisPassword?: string;
  cisStorageState?: string;
  headless: boolean;
  browserBackend: BrowserBackend;
  diagnosticOnly: boolean;
  autoAnswer: boolean;
  quizPolicy: QuizPolicy;
  maxRuntimeMs: number;
  idleTimeoutMs: number;
  stage: PipelineStage;
  sourceRunDir?: string;
  resumeExtractionRunDir?: string;
  includeCis: boolean;
  sourceMode: SourceMode;
  downloadConcurrency: number;
  typstValidationMode: TypstValidationMode;
  renderStrategy: RenderStrategyMode;
  visualsEnabled: boolean;
  visualMode: VisualMode;
  visualCropMode: VisualCropMode;
  maxVisualAssets: number;
  visualMinConfidence: number;
  artifactIntent: ArtifactIntent;
  abortSignal?: AbortSignal;
  diagnostics?: RunDiagnostics;
  sourcePlan?: SourcePlan;
  renderStrategyDecision?: RenderStrategyDecision;
  intentDecision?: StudyBuddyIntentDecision;
  targetCourseUrls?: string[];
  calendarSelection?: CalendarSelection;
  codexModel?: string;
  codexReasoningEffort?: StudyBuddyReasoningEffort;
  codexPath?: string;
  codexCompatibilityFallbackModel?: string;
  codexPreflightMode: CodexPreflightMode;
  codexModelExplicit: boolean;
  runtimeCacheDir: string;
  executionProfile: StudyBuddyExecutionProfile;
  modelPolicyOverrides?: StudyBuddyModelPolicyOverrides;
  outputLanguage: SupportedLanguage;
  outputLanguageReason: LanguageResolutionReason;
  executionTelemetry?: ExecutionTelemetry;
}
