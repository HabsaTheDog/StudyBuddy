import { mkdirSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { MoodleGraphInput, MoodleRuntimeConfig } from "./types.js";

dotenv.config();

const DEFAULT_OUTPUT_ROOT = "output/moodle-runs";

export function createRuntimeConfig(input: MoodleGraphInput): MoodleRuntimeConfig {
  if (!input.prompt.trim()) {
    throw new Error("prompt is required.");
  }
  if (!input.moodleUrl.trim()) {
    throw new Error("moodleUrl is required.");
  }

  const outputRoot = process.env.MOODLE_OUTPUT_DIR || DEFAULT_OUTPUT_ROOT;
  const explicitOutputPath = input.outputPath ? path.resolve(input.outputPath) : null;
  const runDir = explicitOutputPath ? path.dirname(explicitOutputPath) : path.resolve(outputRoot, timestampSlug());
  mkdirSync(runDir, { recursive: true });

  return {
    prompt: input.prompt,
    moodleUrl: input.moodleUrl,
    outputPath: explicitOutputPath || path.resolve(path.join(runDir, "document.typ")),
    runDir,
    maxDepth: input.maxDepth ?? 1,
    maxPages: input.maxPages ?? 12,
    allowFileDownloads: input.allowFileDownloads ?? true,
    baseUrl: process.env.MOODLE_BASE_URL || new URL(input.moodleUrl).origin,
    dashboardUrl: process.env.MOODLE_DASHBOARD_URL || input.moodleUrl,
    username: process.env.MOODLE_USERNAME,
    password: process.env.MOODLE_PASSWORD,
    storageState: process.env.MOODLE_STORAGE_STATE || undefined,
    headless: process.env.MOODLE_HEADLESS !== "false",
  };
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
