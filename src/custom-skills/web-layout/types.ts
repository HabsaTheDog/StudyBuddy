import type { WebLayoutState } from "./state.js";

export type WebLayoutKind =
  | "auto"
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
  kind?: WebLayoutKind;
  requestName?: string;
  runDir?: string;
  outputPath?: string;
  sourceFiles?: string[];
  sourceRunDir?: string;
  language?: "de" | "en";
  maxRuntimeMs?: number;
  idleTimeoutMs?: number;
  browserHeaded?: boolean;
  skipBrowserValidation?: boolean;
  codexModel?: string;
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
}

export interface WebLayoutRuntimeConfig {
  prompt: string;
  kind: WebLayoutKind;
  requestName: string;
  runDir: string;
  outputPath: string;
  sourceFiles: string[];
  sourceRunDir?: string;
  sourceMode: WebLayoutSourceMode;
  language: "de" | "en";
  maxRuntimeMs: number;
  idleTimeoutMs: number;
  browserHeaded: boolean;
  skipBrowserValidation: boolean;
  codexModel?: string;
  abortSignal?: AbortSignal;
  diagnostics?: WebLayoutDiagnosticsLike;
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
  | "validator"
  | "browser"
  | "disk"
  | "cleanup";

export interface WebLayoutRunSummaryInput {
  status: "running" | "success" | "failed" | "timeout";
  prompt: string;
  outputPath?: string;
  validationReportPath?: string;
  screenshotPaths?: string[];
  error?: string;
  stateHasSource: boolean;
  stateHasLayoutSpec: boolean;
  stateHasHtml: boolean;
}
