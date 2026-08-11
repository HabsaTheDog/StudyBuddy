import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Codex } from "@openai/codex-sdk";
import {
  buildCodexChildEnvironment,
  buildCodexShellEnvironmentConfig,
} from "../shared/childProcessSecurity.js";
import type { RunDiagnostics } from "./runDiagnostics.js";

const require = createRequire(import.meta.url);
const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60_000;
const LATEST_VERSION_TTL_MS = 60 * 60_000;
const PROCESS_TIMEOUT_MS = 20_000;
const CANARY_TIMEOUT_MS = 90_000;
const UPDATE_COMMAND = "npm install --save-exact @openai/codex-sdk@latest";
const CANARY_RESPONSE = "STUDY_BUDDY_RUNTIME_OK";

export type CodexPreflightMode = "full" | "version-only" | "off";
export type CodexBinarySource = "bundled" | "override";

export interface CodexDoctorCheck {
  id: string;
  status: string;
  summary: string;
}

export interface CodexModelProbe {
  model: string;
  status: "verified" | "cached" | "failed";
  checkedAt: string;
  error?: string;
}

export interface CodexRuntimeReport {
  schemaVersion: 1;
  checkedAt: string;
  status: "verified" | "warning" | "skipped";
  preflightMode: CodexPreflightMode;
  sdkVersion: string;
  bundledCliVersion: string;
  effectiveCliVersion: string;
  binarySource: CodexBinarySource;
  binaryPath: string;
  globalCliVersion: string | null;
  latestStableVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string;
  doctorChecks: CodexDoctorCheck[];
  modelProbes: CodexModelProbe[];
  requestedModels: string[];
  effectiveModels: string[];
  fallbackApplied: string | null;
  warnings: string[];
}

export interface CodexRuntimePreflightInput {
  runDir?: string;
  cacheDir: string;
  codexPath?: string;
  models: string[];
  explicitModel: boolean;
  fallbackModel?: string;
  mode?: CodexPreflightMode;
  cacheTtlMs?: number;
  bypassCache?: boolean;
  diagnostics?: RunDiagnostics;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface BundledRuntime {
  sdkVersion: string;
  bundledCliVersion: string;
  bundledCliPath: string;
}

interface RuntimeCache {
  schemaVersion: 1;
  doctor?: {
    key: string;
    expiresAt: number;
    checks: CodexDoctorCheck[];
  };
  latest?: {
    expiresAt: number;
    version: string | null;
  };
  probes: Record<string, { expiresAt: number; checkedAt: string }>;
}

interface CodexRuntimeDependencies {
  now?: () => number;
  resolveBundledRuntime?: () => Promise<BundledRuntime>;
  runProcess?: (command: string, args: string[], timeoutMs: number) => Promise<ProcessResult>;
  fetchLatestVersion?: () => Promise<string | null>;
  runCanary?: (input: {
    binaryPath: string;
    model: string;
    workingDirectory: string;
  }) => Promise<void>;
}

export class CodexRuntimePreflightError extends Error {
  readonly updateCommand = UPDATE_COMMAND;
  readonly report?: CodexRuntimeReport;

  constructor(message: string, report?: CodexRuntimeReport, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexRuntimePreflightError";
    this.report = report;
  }
}

export async function preflightCodexRuntime(
  input: CodexRuntimePreflightInput,
  dependencies: CodexRuntimeDependencies = {},
): Promise<CodexRuntimeReport> {
  const now = dependencies.now?.() ?? Date.now();
  const checkedAt = new Date(now).toISOString();
  const mode = input.mode ?? "full";
  const cacheTtlMs = input.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const resolveBundledRuntime = dependencies.resolveBundledRuntime ?? defaultResolveBundledRuntime;
  const runProcess = dependencies.runProcess ?? defaultRunProcess;
  const fetchLatestVersion = dependencies.fetchLatestVersion ?? defaultFetchLatestVersion;
  const runCanary = dependencies.runCanary ?? defaultRunCanary;
  const bundled = await resolveBundledRuntime();
  const binarySource: CodexBinarySource = input.codexPath ? "override" : "bundled";
  const binaryPath = input.codexPath ?? bundled.bundledCliPath;
  const requestedModels = unique(input.models);
  const warnings: string[] = [];

  if (bundled.sdkVersion !== bundled.bundledCliVersion) {
    throw new CodexRuntimePreflightError(
      `Codex runtime preflight failed: @openai/codex-sdk ${bundled.sdkVersion} bundles @openai/codex ${bundled.bundledCliVersion}. Run: ${UPDATE_COMMAND}`,
    );
  }

  const versionResult = await runProcess(binaryPath, ["--version"], PROCESS_TIMEOUT_MS);
  const effectiveCliVersion = parseCodexVersion(versionResult.stdout || versionResult.stderr);
  if (versionResult.exitCode !== 0 || !effectiveCliVersion) {
    throw new CodexRuntimePreflightError(
      `Codex runtime preflight failed: could not execute ${binaryPath} --version. ${compactProcessError(versionResult)}`,
    );
  }
  if (binarySource === "bundled" && effectiveCliVersion !== bundled.bundledCliVersion) {
    throw new CodexRuntimePreflightError(
      `Codex runtime preflight failed: bundled package version ${bundled.bundledCliVersion} resolves to CLI ${effectiveCliVersion}. Run: ${UPDATE_COMMAND}`,
    );
  }

  const baseReport: CodexRuntimeReport = {
    schemaVersion: 1,
    checkedAt,
    status: mode === "off" ? "skipped" : "verified",
    preflightMode: mode,
    sdkVersion: bundled.sdkVersion,
    bundledCliVersion: bundled.bundledCliVersion,
    effectiveCliVersion,
    binarySource,
    binaryPath,
    globalCliVersion: null,
    latestStableVersion: null,
    updateAvailable: false,
    updateCommand: UPDATE_COMMAND,
    doctorChecks: [],
    modelProbes: [],
    requestedModels,
    effectiveModels: requestedModels,
    fallbackApplied: null,
    warnings,
  };

  if (mode === "off") {
    warnings.push("Codex runtime compatibility checks were explicitly disabled.");
    baseReport.status = "skipped";
    await persistRuntimeReport(input.runDir, baseReport);
    return baseReport;
  }

  if (mode === "version-only") {
    await persistRuntimeReport(input.runDir, baseReport);
    return baseReport;
  }

  await mkdir(input.cacheDir, { recursive: true });
  const cachePath = path.join(input.cacheDir, "codex-runtime-cache.json");
  const cache = await readRuntimeCache(cachePath);
  const doctorKey = hashKey(`${binaryPath}\0${effectiveCliVersion}\0${process.env.CODEX_HOME ?? "default"}`);
  if (!input.bypassCache && cache.doctor?.key === doctorKey && cache.doctor.expiresAt > now) {
    baseReport.doctorChecks = cache.doctor.checks;
  } else {
    const doctorResult = await runProcess(binaryPath, ["doctor", "--json"], PROCESS_TIMEOUT_MS);
    const doctorChecks = parseDoctorChecks(doctorResult.stdout);
    const criticalFailures = doctorChecks.filter(isCriticalDoctorFailure);
    baseReport.doctorChecks = doctorChecks;
    if (criticalFailures.length > 0) {
      const detail = criticalFailures.map((check) => `${check.id}: ${check.summary}`).join("; ");
      const report = { ...baseReport, status: "warning" as const };
      await persistRuntimeReport(input.runDir, report);
      throw new CodexRuntimePreflightError(
        `Codex runtime preflight failed: ${detail}`,
        report,
      );
    }
    cache.doctor = { key: doctorKey, expiresAt: now + cacheTtlMs, checks: doctorChecks };
  }
  const recoverableDoctorFailures = baseReport.doctorChecks.filter(isRecoverableDoctorFailure);
  if (recoverableDoctorFailures.length > 0) {
    warnings.push(
      `Codex doctor reported a transient provider HTTP reachability failure; continuing to the authenticated model canary and bounded model-call recovery (${recoverableDoctorFailures.map((check) => check.summary).join("; ")}).`,
    );
  }

  if (!input.bypassCache && cache.latest && cache.latest.expiresAt > now) {
    baseReport.latestStableVersion = cache.latest.version;
  } else {
    baseReport.latestStableVersion = await fetchLatestVersion().catch(() => null);
    cache.latest = {
      expiresAt: now + LATEST_VERSION_TTL_MS,
      version: baseReport.latestStableVersion,
    };
  }
  baseReport.updateAvailable = Boolean(
    baseReport.latestStableVersion &&
      compareVersions(effectiveCliVersion, baseReport.latestStableVersion) < 0,
  );
  if (baseReport.updateAvailable) {
    warnings.push(
      `A newer stable Codex SDK is available (${baseReport.latestStableVersion}); the installed runtime remains usable only because its model probes passed.`,
    );
  }

  const globalVersionResult = await runProcess("codex", ["--version"], PROCESS_TIMEOUT_MS).catch(() => null);
  baseReport.globalCliVersion = globalVersionResult
    ? parseCodexVersion(globalVersionResult.stdout || globalVersionResult.stderr)
    : null;

  const failedModels: Array<{ model: string; error: string; transient: boolean }> = [];
  for (const model of requestedModels) {
    const cacheKey = probeCacheKey(binaryPath, effectiveCliVersion, model);
    const cached = cache.probes[cacheKey];
    if (!input.bypassCache && cached?.expiresAt && cached.expiresAt > now) {
      baseReport.modelProbes.push({ model, status: "cached", checkedAt: cached.checkedAt });
      continue;
    }
    try {
      await runCanary({ binaryPath, model, workingDirectory: input.cacheDir });
      baseReport.modelProbes.push({ model, status: "verified", checkedAt });
      cache.probes[cacheKey] = { expiresAt: now + cacheTtlMs, checkedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedModels.push({ model, error: message, transient: isTransientCanaryError(message) });
      baseReport.modelProbes.push({ model, status: "failed", checkedAt, error: message });
    }
  }

  const compatibilityFailures = failedModels.filter((item) => !item.transient);
  const transientFailures = failedModels.filter((item) => item.transient);
  if (transientFailures.length > 0) {
    warnings.push(
      `Compatibility canary was inconclusive for ${transientFailures.map((item) => item.model).join(", ")} after a transient timeout or cancellation; continuing with the requested policy so its bounded model-call retries can decide runtime health.`,
    );
  }

  if (compatibilityFailures.length > 0 && input.fallbackModel && !input.explicitModel) {
    const fallback = input.fallbackModel.trim();
    if (fallback && !requestedModels.includes(fallback)) {
      const cacheKey = probeCacheKey(binaryPath, effectiveCliVersion, fallback);
      const cached = cache.probes[cacheKey];
      try {
        if (!input.bypassCache && cached?.expiresAt && cached.expiresAt > now) {
          baseReport.modelProbes.push({ model: fallback, status: "cached", checkedAt: cached.checkedAt });
        } else {
          await runCanary({ binaryPath, model: fallback, workingDirectory: input.cacheDir });
          baseReport.modelProbes.push({ model: fallback, status: "verified", checkedAt });
          cache.probes[cacheKey] = { expiresAt: now + cacheTtlMs, checkedAt };
        }
        baseReport.fallbackApplied = fallback;
        baseReport.effectiveModels = [fallback];
        warnings.push(
          `Configured compatibility fallback ${fallback} replaced policy-selected model(s): ${compatibilityFailures.map((item) => item.model).join(", ")}.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        baseReport.modelProbes.push({ model: fallback, status: "failed", checkedAt, error: message });
      }
    }
  }

  const unresolvedFailures = compatibilityFailures.length > 0 && !baseReport.fallbackApplied;
  if (unresolvedFailures) {
    baseReport.status = "warning";
    await writeRuntimeCache(cachePath, cache);
    await persistRuntimeReport(input.runDir, baseReport);
    const detail = compatibilityFailures.map((item) => `${item.model}: ${item.error}`).join("; ");
    throw new CodexRuntimePreflightError(
      `Codex runtime preflight failed before source access. ${detail}. Effective CLI: ${effectiveCliVersion}. Run: ${UPDATE_COMMAND}`,
      baseReport,
    );
  }

  if (warnings.length > 0) baseReport.status = "warning";
  await writeRuntimeCache(cachePath, cache);
  await persistRuntimeReport(input.runDir, baseReport);
  await input.diagnostics?.log(
    warnings.length > 0 ? "warn" : "info",
    "runtime",
    `Codex runtime ${effectiveCliVersion} verified for ${baseReport.effectiveModels.join(", ") || "no model calls"}.`,
    {
      sdkVersion: bundled.sdkVersion,
      effectiveCliVersion,
      binarySource,
      modelProbes: baseReport.modelProbes.map(({ model, status }) => ({ model, status })),
      fallbackApplied: baseReport.fallbackApplied,
      updateAvailable: baseReport.updateAvailable,
    },
  );
  return baseReport;
}

export function formatCodexRuntimeSummary(report: CodexRuntimeReport | undefined): string[] {
  if (!report) return ["- Runtime preflight: not run"];
  return [
    `- SDK: ${report.sdkVersion}`,
    `- Effective CLI: ${report.effectiveCliVersion}`,
    `- Binary source: ${report.binarySource}`,
    `- Preflight: ${report.status}`,
    `- Requested models: ${report.requestedModels.join(", ") || "none"}`,
    `- Effective models: ${report.effectiveModels.join(", ") || "none"}`,
    `- Compatibility fallback: ${report.fallbackApplied ?? "none"}`,
    `- Latest stable observed: ${report.latestStableVersion ?? "not checked"}`,
    `- Update command: ${report.updateCommand}`,
  ];
}

export async function invalidateCodexRuntimeCache(cacheDir: string): Promise<void> {
  await rm(path.join(cacheDir, "codex-runtime-cache.json"), { force: true });
}

async function defaultResolveBundledRuntime(): Promise<BundledRuntime> {
  const sdkEntryPath = fileURLToPath(import.meta.resolve("@openai/codex-sdk"));
  const bundledCliPath = require.resolve("@openai/codex/bin/codex.js");
  const sdkPackagePath = path.resolve(path.dirname(sdkEntryPath), "..", "package.json");
  const cliPackagePath = path.resolve(path.dirname(bundledCliPath), "..", "package.json");
  const [sdkPackage, cliPackage] = await Promise.all([
    readJsonFile<{ version?: string }>(sdkPackagePath),
    readJsonFile<{ version?: string }>(cliPackagePath),
  ]);
  if (!sdkPackage.version || !cliPackage.version) {
    throw new CodexRuntimePreflightError("Codex runtime preflight failed: package version metadata is missing.");
  }
  return {
    sdkVersion: sdkPackage.version,
    bundledCliVersion: cliPackage.version,
    bundledCliPath,
  };
}

async function defaultRunProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const invocation = resolveCodexProcessInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      env: buildCodexChildEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export function resolveCodexProcessInvocation(
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (/\.(?:c|m)?js$/i.test(command)) {
    return { command: process.execPath, args: [command, ...args] };
  }
  return { command, args: [...args] };
}

async function defaultFetchLatestVersion(): Promise<string | null> {
  const response = await fetch("https://registry.npmjs.org/%40openai%2Fcodex-sdk/latest", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { version?: unknown };
  return typeof payload.version === "string" ? payload.version : null;
}

async function defaultRunCanary(input: {
  binaryPath: string;
  model: string;
  workingDirectory: string;
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANARY_TIMEOUT_MS);
  try {
    const codexEnvironment = buildCodexChildEnvironment();
    const codex = new Codex({
      codexPathOverride: input.binaryPath,
      env: codexEnvironment,
      config: buildCodexShellEnvironmentConfig(codexEnvironment),
    });
    const thread = codex.startThread({
      workingDirectory: input.workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      model: input.model,
      modelReasoningEffort: "low",
    });
    let result;
    try {
      result = await thread.run(`Reply with exactly ${CANARY_RESPONSE}.`, {
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Compatibility canary timed out after ${CANARY_TIMEOUT_MS}ms.`, {
          cause: error,
        });
      }
      throw error;
    }
    if (result.finalResponse.trim() !== CANARY_RESPONSE) {
      throw new Error(`Unexpected compatibility canary response for ${input.model}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientCanaryError(message: string): boolean {
  return /operation was aborted|\babort(?:ed)?\b|timed?\s*out|timeout|temporar(?:y|ily)|queue|rate limit|overloaded|connection (?:reset|closed)|network/i.test(message);
}

function parseDoctorChecks(stdout: string): CodexDoctorCheck[] {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new CodexRuntimePreflightError("Codex runtime preflight failed: codex doctor returned invalid JSON.", undefined, {
      cause: error,
    });
  }
  const checks = isRecord(payload) && isRecord(payload.checks) ? payload.checks : null;
  if (!checks) {
    throw new CodexRuntimePreflightError("Codex runtime preflight failed: codex doctor returned no checks.");
  }
  return Object.entries(checks).flatMap(([id, value]) => {
    if (!isRecord(value)) return [];
    return [{
      id,
      status: typeof value.status === "string" ? value.status : "unknown",
      summary: typeof value.summary === "string" ? value.summary : "No summary.",
    }];
  });
}

function isCriticalDoctorFailure(check: CodexDoctorCheck): boolean {
  if (check.status !== "fail") return false;
  return [
    "auth.credentials",
    "config.load",
    "runtime.provenance",
    "runtime.search",
    "sandbox.helpers",
    "state.paths",
  ].includes(check.id);
}

function isRecoverableDoctorFailure(check: CodexDoctorCheck): boolean {
  return check.status === "fail" && check.id === "network.provider_reachability";
}

function parseCodexVersion(output: string): string | null {
  return output.match(/codex(?:-cli)?\s+([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/i)?.[1] ?? null;
}

async function readRuntimeCache(cachePath: string): Promise<RuntimeCache> {
  try {
    const value = await readJsonFile<Partial<RuntimeCache>>(cachePath);
    if (value.schemaVersion !== CACHE_SCHEMA_VERSION) return emptyRuntimeCache();
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      doctor: value.doctor,
      latest: value.latest,
      probes: isRecord(value.probes) ? value.probes as RuntimeCache["probes"] : {},
    };
  } catch {
    return emptyRuntimeCache();
  }
}

function emptyRuntimeCache(): RuntimeCache {
  return { schemaVersion: CACHE_SCHEMA_VERSION, probes: {} };
}

async function writeRuntimeCache(cachePath: string, cache: RuntimeCache): Promise<void> {
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporaryPath, cachePath);
}

async function persistRuntimeReport(runDir: string | undefined, report: CodexRuntimeReport): Promise<void> {
  if (!runDir) return;
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "codex-runtime.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function probeCacheKey(binaryPath: string, cliVersion: string, model: string): string {
  return hashKey(`${binaryPath}\0${cliVersion}\0${model}\0${process.env.CODEX_HOME ?? "default"}`);
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index]! - rightParts[index]!;
  }
  return 0;
}

function compactProcessError(result: ProcessResult): string {
  return (result.stderr || result.stdout || `exit code ${result.exitCode}`).trim().slice(0, 500);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
