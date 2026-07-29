import type { WebLayoutState } from "./state.js";
import type {
  StudyBuddyExecutionProfile,
  StudyBuddyModelPolicyOverrides,
} from "../shared/modelPolicy.js";
import type { OutputLanguagePreference } from "../shared/languagePolicy.js";
import type { ExecutionTelemetry } from "../moodle/executionTelemetry.js";

export type WebLayoutKind =
  | "auto"
  | "study-guide"
  | "flashcards"
  | "concept-visualization"
  | "simulation"
  | "exam-practice"
  | "quiz"
  | "worksheet"
  | "reference";

export type WebLayoutSourceMode = "prompt" | "text-file" | "moodle-handoff";

export interface WebLayoutInput {
  prompt: string;
  /** Exact, untranslated user request. Language is resolved from this boundary value. */
  originalUserPrompt?: string;
  kind?: WebLayoutKind;
  requestName?: string;
  runDir?: string;
  outputPath?: string;
  sourceFiles?: string[];
  assetFiles?: string[];
  sourceRunDir?: string;
  resumeRunDir?: string;
  language?: OutputLanguagePreference;
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  browserHeaded?: boolean;
  skipBrowserValidation?: boolean;
  maxArtifactBytes?: number;
  maxImageWidth?: number;
  webpQuality?: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  executionProfile?: StudyBuddyExecutionProfile;
  modelPolicyOverrides?: StudyBuddyModelPolicyOverrides;
}

export interface WebLayoutResult {
  ok: boolean;
  outputPath?: string;
  runDir: string;
  runSummaryPath: string;
  state: WebLayoutState;
  error?: string;
  validationReportPath?: string;
  screenshotPaths?: string[];
  metricsPath?: string;
}

export interface WebLayoutRuntimeConfig {
  prompt: string;
  originalUserPrompt: string;
  kind: WebLayoutKind;
  requestName: string;
  runDir: string;
  outputPath: string;
  sourceFiles: string[];
  assetFiles: string[];
  sourceRunDir?: string;
  resumeRunDir?: string;
  sourceMode: WebLayoutSourceMode;
  language: "de" | "en";
  maxRuntimeMs: number;
  idleTimeoutMs: number;
  browserHeaded: boolean;
  skipBrowserValidation: boolean;
  maxArtifactBytes: number;
  maxImageWidth: number;
  webpQuality: number;
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  executionProfile: StudyBuddyExecutionProfile;
  modelPolicyOverrides?: StudyBuddyModelPolicyOverrides;
  abortSignal?: AbortSignal;
  diagnostics?: WebLayoutDiagnosticsLike;
  executionTelemetry?: ExecutionTelemetry;
}

export interface WebLayoutDiagnosticsLike {
  runSummaryPath: string;
  lastActivityAt: number;
  init(): Promise<void>;
  log(level: "info" | "warn" | "error", phase: WebLayoutRunPhase, message: string, data?: Record<string, unknown>): Promise<void>;
  writeSummary(input: WebLayoutRunSummaryInput): Promise<void>;
}

export type WebLayoutRunPhase =
  | "config"
  | "source"
  | "planner"
  | "generator"
  | "assets"
  | "bundle"
  | "validator"
  | "browser"
  | "disk"
  | "cleanup";

export interface WebLayoutRunSummaryInput {
  status: "running" | "success" | "failed" | "timeout";
  prompt: string;
  taskPrompt?: string;
  outputPath?: string;
  validationReportPath?: string;
  screenshotPaths?: string[];
  sourceBundlePath?: string;
  mediaManifestPath?: string;
  artifactBytes?: number;
  embeddedAssetBytes?: number;
  estimatedDecodedImageBytes?: number;
  metricsPath?: string;
  error?: string;
  stateHasSource: boolean;
  stateHasLayoutSpec: boolean;
  stateHasHtml: boolean;
}
