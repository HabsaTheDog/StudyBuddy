import { mkdirSync } from "node:fs";
import path from "node:path";
import { webLayoutKindSchema } from "./schemas.js";
import type { WebLayoutInput, WebLayoutKind, WebLayoutRuntimeConfig, WebLayoutSourceMode } from "./types.js";
import { parseExecutionProfile, parseReasoningEffort } from "../shared/modelPolicy.js";

export const ABSOLUTE_MAX_ARTIFACT_BYTES = 1_000_000_000;
export const DEFAULT_MAX_IMAGE_WIDTH = 2_000;
export const DEFAULT_WEBP_QUALITY = 84;

export function createWebLayoutRuntimeConfig(input: WebLayoutInput): WebLayoutRuntimeConfig {
  if (!input.prompt.trim()) {
    throw new Error("prompt is required.");
  }
  const workspaceRoot = resolveWorkspaceRoot();
  const requestName = safeSlug(input.requestName || inferRequestName(input.prompt));
  const explicitRunDir = input.runDir ? resolveWorkspacePath(input.runDir, workspaceRoot) : null;
  const outputRoot = path.join(workspaceRoot, "output", requestName);
  const runDir = explicitRunDir || path.join(outputRoot, timestampSlug());
  const outputPath = input.outputPath
    ? resolveWorkspacePath(input.outputPath, workspaceRoot)
    : path.join(runDir, "document.html");
  mkdirSync(runDir, { recursive: true });

  return {
    prompt: input.prompt,
    kind: parseKind(input.kind ?? "auto"),
    requestName,
    runDir,
    outputPath,
    sourceFiles: (input.sourceFiles ?? []).map((file) => resolveWorkspacePath(file, workspaceRoot)),
    assetFiles: (input.assetFiles ?? []).map((file) => resolveWorkspacePath(file, workspaceRoot)),
    sourceRunDir: input.sourceRunDir ? resolveWorkspacePath(input.sourceRunDir, workspaceRoot) : undefined,
    sourceMode: inferSourceMode(input),
    language: input.language ?? "de",
    maxRuntimeMs: input.maxRuntimeMs ?? 10 * 60_000,
    idleTimeoutMs: input.idleTimeoutMs ?? 5 * 60_000,
    browserHeaded: input.browserHeaded ?? false,
    skipBrowserValidation: input.skipBrowserValidation ?? false,
    maxArtifactBytes: boundedInteger(
      input.maxArtifactBytes,
      ABSOLUTE_MAX_ARTIFACT_BYTES,
      1,
      ABSOLUTE_MAX_ARTIFACT_BYTES,
      "maxArtifactBytes",
    ),
    maxImageWidth: boundedInteger(
      input.maxImageWidth,
      DEFAULT_MAX_IMAGE_WIDTH,
      320,
      8_192,
      "maxImageWidth",
    ),
    webpQuality: boundedInteger(input.webpQuality, DEFAULT_WEBP_QUALITY, 1, 100, "webpQuality"),
    codexModel: trimOptional(input.codexModel) ?? trimOptional(process.env.STUDY_BUDDY_CODEX_MODEL),
    codexReasoningEffort:
      input.codexReasoningEffort ??
      parseReasoningEffort(process.env.STUDY_BUDDY_CODEX_REASONING_EFFORT),
    executionProfile: parseExecutionProfile(
      input.executionProfile ?? process.env.STUDY_BUDDY_EXECUTION_PROFILE,
    ),
    modelPolicyOverrides: input.modelPolicyOverrides,
  };
}

export function sanitizeWebLayoutConfig(config: WebLayoutRuntimeConfig) {
  return {
    prompt: config.prompt,
    kind: config.kind,
    requestName: config.requestName,
    runDir: config.runDir,
    outputPath: config.outputPath,
    sourceFiles: config.sourceFiles,
    assetFiles: config.assetFiles,
    sourceRunDir: config.sourceRunDir,
    sourceMode: config.sourceMode,
    language: config.language,
    maxRuntimeMs: config.maxRuntimeMs,
    idleTimeoutMs: config.idleTimeoutMs,
    browserHeaded: config.browserHeaded,
    skipBrowserValidation: config.skipBrowserValidation,
    maxArtifactBytes: config.maxArtifactBytes,
    maxImageWidth: config.maxImageWidth,
    webpQuality: config.webpQuality,
    codexModel: config.codexModel,
    codexReasoningEffort: config.codexReasoningEffort,
    executionProfile: config.executionProfile,
    modelPolicyOverrides: config.modelPolicyOverrides,
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function inferSourceMode(input: WebLayoutInput): WebLayoutSourceMode {
  if (input.sourceRunDir) {
    return "moodle-handoff";
  }
  if (input.sourceFiles?.length) {
    return "text-file";
  }
  return "prompt";
}

function parseKind(value: string): WebLayoutKind {
  return webLayoutKindSchema.parse(value);
}

function resolveWorkspaceRoot(): string {
  return path.resolve(process.env.STUDY_BUDDY_WORKSPACE || process.env.T3CODE_CWD || process.cwd());
}

function resolveWorkspacePath(value: string, workspaceRoot: string): string {
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function inferRequestName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .match(/[a-z0-9äöüß_-]{3,}/gi);
  return safeSlug((words ?? ["web-layout"]).slice(0, 6).join("-"));
}

export function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "web-layout";
}
