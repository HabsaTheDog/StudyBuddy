import type { AgentState } from "./state.js";
import type { RunDiagnostics, SourceCoverage } from "./runDiagnostics.js";

export type BrowserBackend = "playwright" | "agent-browser";
export type PipelineStage = "all" | "extract" | "render";

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
}

export interface MoodleGraphResult {
  ok: boolean;
  coverageComplete: boolean;
  outputPath?: string;
  pdfPath?: string;
  runDir: string;
  runSummaryPath: string;
  state: AgentState;
  sourceCoverage: SourceCoverage;
  error?: string;
  extractedDataPath?: string;
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
  cisBaseUrl: string;
  cisDashboardUrl: string;
  cisUsername?: string;
  cisPassword?: string;
  cisStorageState?: string;
  headless: boolean;
  browserBackend: BrowserBackend;
  diagnosticOnly: boolean;
  autoAnswer: boolean;
  maxRuntimeMs: number;
  idleTimeoutMs: number;
  stage: PipelineStage;
  sourceRunDir?: string;
  includeCis: boolean;
  abortSignal?: AbortSignal;
  diagnostics?: RunDiagnostics;
}
