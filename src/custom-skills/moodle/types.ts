import type { AgentState } from "./state.js";

export interface MoodleGraphInput {
  prompt: string;
  moodleUrl: string;
  outputPath?: string;
  maxDepth?: number;
  maxPages?: number;
  allowFileDownloads?: boolean;
}

export interface MoodleGraphResult {
  ok: boolean;
  outputPath?: string;
  state: AgentState;
  error?: string;
}

export interface MoodleRuntimeConfig {
  prompt: string;
  moodleUrl: string;
  outputPath: string;
  runDir: string;
  maxDepth: number;
  maxPages: number;
  allowFileDownloads: boolean;
  baseUrl: string;
  dashboardUrl: string;
  username?: string;
  password?: string;
  storageState?: string;
  headless: boolean;
}
