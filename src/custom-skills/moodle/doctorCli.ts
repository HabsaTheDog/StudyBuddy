#!/usr/bin/env node
import { Command } from "commander";
import {
  CodexRuntimePreflightError,
  formatCodexRuntimeSummary,
  preflightCodexRuntime,
} from "./codexRuntime.js";
import { resolveTaskModelPolicy } from "./modelPolicy.js";
import { inspectSystemDependencies } from "./systemDependencies.js";
import {
  ensureStudyBuddyWorkspaceData,
  resolveStudyBuddyWorkspaceDataPaths,
} from "../shared/workspaceData.js";

const program = new Command()
  .name("moodle-doctor")
  .description("Verify the Codex runtime used by Study Buddy without accessing Moodle or CIS.")
  .option("--model <model>", "Model to verify; repeat for multiple models", collect, [])
  .option("--fallback-model <model>", "Compatibility fallback for policy-selected models")
  .option("--codex-path <path>", "Explicit Codex executable override")
  .option("--version-only", "Check SDK and CLI version pairing without auth or model calls")
  .option("--no-cache", "Ignore successful cached checks")
  .option("--json", "Print machine-readable JSON")
  .parse(process.argv);

const options = program.opts<{
  model: string[];
  fallbackModel?: string;
  codexPath?: string;
  versionOnly?: boolean;
  cache: boolean;
  json?: boolean;
}>();

const models = options.model.length > 0
  ? options.model
  : [...new Set((["artifact_planner", "content_analyzer", "quiz_solver", "artifact_builder", "quality_reviewer"] as const).flatMap((task) => [
      resolveTaskModelPolicy({ profile: "balanced", task, attempt: 1 }).model,
      resolveTaskModelPolicy({ profile: "balanced", task, attempt: 2 }).model,
    ]))];

try {
  const systemDependencies = await inspectSystemDependencies();
  const extractionTooling = {
    pdftotext: systemDependencies.dependencies.pdftotext.available,
    pdftoppm: systemDependencies.dependencies.pdftoppm.available,
    libreoffice: systemDependencies.dependencies.libreoffice.available,
  };
  const workspaceData = ensureStudyBuddyWorkspaceData(resolveStudyBuddyWorkspaceDataPaths());
  const report = await preflightCodexRuntime({
    cacheDir: workspaceData.cacheRoot,
    codexPath: options.codexPath ?? process.env.STUDY_BUDDY_CODEX_PATH,
    models,
    explicitModel: options.model.length > 0,
    fallbackModel:
      options.fallbackModel ?? process.env.STUDY_BUDDY_CODEX_COMPATIBILITY_FALLBACK_MODEL,
    mode: options.versionOnly ? "version-only" : "full",
    bypassCache: !options.cache,
  });
  if (options.json) {
    console.log(JSON.stringify({ runtime: report, systemDependencies, extractionTooling }, null, 2));
  } else {
    console.log([
      ...formatCodexRuntimeSummary(report),
      ...Object.entries(systemDependencies.dependencies).flatMap(([name, dependency]) => [
        `${name}: ${dependency.available ? dependency.version ?? "available" : "missing"}${dependency.path ? ` (${dependency.path})` : ""}`,
        ...(!dependency.available ? dependency.remediation.map((command) => `  Fix: ${command}`) : []),
      ]),
      "OCR: intentionally disabled (not a runtime dependency)",
    ].join("\n"));
  }
} catch (error) {
  if (options.json && error instanceof CodexRuntimePreflightError && error.report) {
    console.error(JSON.stringify({ error: error.message, runtime: error.report }, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
