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

export type BrowserBackend = "playwright" | "agent-browser";
export type PipelineStage = "all" | "extract" | "render";
export type SourceMode = "auto" | "moodle" | "cis" | "both";
export type TypstValidationMode = "strict" | "balanced";
export type RenderStrategyMode = "auto" | "deterministic" | "llm_formatter";
export type VisualMode = "off" | "deferred" | "inline";

export interface MoodleGraphInput {
  prompt: string;
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
  includeCis?: boolean;
  sourceMode?: SourceMode;
  downloadConcurrency?: number;
  typstValidationMode?: TypstValidationMode;
  renderStrategy?: RenderStrategyMode;
  visualsEnabled?: boolean;
  visualMode?: VisualMode;
  maxVisualAssets?: number;
  visualMinConfidence?: number;
  artifactProfile?: ArtifactProfile;
  formats?: OutputFormat[];
  sourcePolicy?: SourcePolicy;
  linkPolicy?: LinkPolicy;
  codexModel?: string;
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
}

export interface MoodleRuntimeConfig {
  prompt: string;
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
  includeCis: boolean;
  sourceMode: SourceMode;
  downloadConcurrency: number;
  typstValidationMode: TypstValidationMode;
  renderStrategy: RenderStrategyMode;
  visualsEnabled: boolean;
  visualMode: VisualMode;
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
}
