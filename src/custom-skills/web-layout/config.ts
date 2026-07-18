import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { webLayoutKindSchema } from "./schemas.js";
import type { WebLayoutInput, WebLayoutKind, WebLayoutRuntimeConfig, WebLayoutSourceMode } from "./types.js";
import { parseExecutionProfile, parseReasoningEffort } from "../shared/modelPolicy.js";

export const DEFAULT_MAX_ARTIFACT_BYTES = 100_000_000;
export const ABSOLUTE_MAX_ARTIFACT_BYTES = 250_000_000;
export const DEFAULT_MAX_IMAGE_WIDTH = 2_000;
export const DEFAULT_WEBP_QUALITY = 84;

export function createWebLayoutRuntimeConfig(input: WebLayoutInput): WebLayoutRuntimeConfig {
  if (!input.prompt.trim()) {
    throw new Error("prompt is required.");
  }
  const workspaceRoot = resolveWorkspaceRoot();
  const requestName = safeSlug(input.requestName || inferRequestName(input.prompt));
  const resumeRunDir = input.resumeRunDir
    ? resolveWorkspacePath(input.resumeRunDir, workspaceRoot)
    : undefined;
  const inheritedSources = !input.sourceRunDir && !(input.sourceFiles?.length)
    ? inheritedResumeSources(resumeRunDir, workspaceRoot)
    : {};
  const sourceRunDir = input.sourceRunDir
    ? resolveWorkspacePath(input.sourceRunDir, workspaceRoot)
    : inheritedSources.sourceRunDir;
  const sourceFiles = (input.sourceFiles?.length ? input.sourceFiles : inheritedSources.sourceFiles ?? [])
    .map((file) => resolveWorkspacePath(file, workspaceRoot));
  const explicitRunDir = input.runDir ? resolveWorkspacePath(input.runDir, workspaceRoot) : null;
  const outputRoot = path.join(workspaceRoot, "output", requestName);
  const runDir = explicitRunDir || path.join(outputRoot, timestampSlug());
  const outputPath = input.outputPath
    ? resolveWorkspacePath(input.outputPath, workspaceRoot)
    : path.join(runDir, "document.html");
  mkdirSync(runDir, { recursive: true });
  const canonicalLogoPath = path.join(workspaceRoot, "CI", "logo.png");
  const assetFiles = [...(input.assetFiles ?? []).map((file) => resolveWorkspacePath(file, workspaceRoot))];
  if (existsSync(canonicalLogoPath) && !assetFiles.some((file) => path.resolve(file) === canonicalLogoPath)) {
    assetFiles.unshift(canonicalLogoPath);
  }

  return {
    prompt: input.prompt,
    kind: parseKind(input.kind ?? "auto"),
    requestName,
    runDir,
    outputPath,
    sourceFiles,
    assetFiles,
    sourceRunDir,
    resumeRunDir,
    sourceMode: inferSourceMode(sourceRunDir, sourceFiles),
    language: input.language ?? "de",
    maxRuntimeMs: input.maxRuntimeMs ?? 20 * 60_000,
    idleTimeoutMs: input.idleTimeoutMs ?? 5 * 60_000,
    browserHeaded: input.browserHeaded ?? false,
    skipBrowserValidation: input.skipBrowserValidation ?? false,
    maxArtifactBytes: boundedInteger(
      input.maxArtifactBytes,
      DEFAULT_MAX_ARTIFACT_BYTES,
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
    resumeRunDir: config.resumeRunDir,
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

function inferSourceMode(sourceRunDir: string | undefined, sourceFiles: string[]): WebLayoutSourceMode {
  if (sourceRunDir) {
    return "moodle-handoff";
  }
  if (sourceFiles.length) {
    return "text-file";
  }
  return "prompt";
}

function inheritedResumeSources(
  resumeRunDir: string | undefined,
  workspaceRoot: string,
): { sourceRunDir?: string; sourceFiles?: string[] } {
  let current = resumeRunDir;
  const visited = new Set<string>();
  for (let depth = 0; current && depth < 24; depth += 1) {
    const resolvedCurrent = resolveWorkspacePath(current, workspaceRoot);
    if (visited.has(resolvedCurrent)) break;
    visited.add(resolvedCurrent);
    const configPath = path.join(resolvedCurrent, "config.json");
    if (!existsSync(configPath)) break;
    let record: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") break;
      record = parsed as Record<string, unknown>;
    } catch {
      break;
    }
    if (typeof record.sourceRunDir === "string" && record.sourceRunDir.trim()) {
      return { sourceRunDir: resolveWorkspacePath(record.sourceRunDir, workspaceRoot) };
    }
    if (Array.isArray(record.sourceFiles)) {
      const files = record.sourceFiles.filter(
        (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
      );
      if (files.length) return { sourceFiles: files };
    }
    current = typeof record.resumeRunDir === "string" && record.resumeRunDir.trim()
      ? record.resumeRunDir
      : undefined;
  }
  return {};
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
