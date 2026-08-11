#!/usr/bin/env node
import { Command } from "commander";
import { installCliBrokenPipeGuard } from "../shared/cliErrorGuard.js";
import { monitorRunProcess } from "./runWatchdog.js";

installCliBrokenPipeGuard();

const program = new Command()
  .name("study-buddy-watchdog")
  .requiredOption("--run-dir <path>")
  .requiredOption("--pid <number>", "Child process ID", parsePositiveInteger)
  .requiredOption("--process-group-id <number>", "Child process group ID", parsePositiveInteger)
  .option("--idle-timeout-ms <number>", "Maximum time without heartbeat or file progress", parsePositiveInteger, 360_000)
  .option("--max-runtime-ms <number>", "Maximum total workflow runtime", parsePositiveInteger, 3_600_000)
  .option("--poll-ms <number>", "Filesystem polling interval", parsePositiveInteger, 2_000)
  .parse(process.argv);

const options = program.opts<{
  runDir: string;
  pid: number;
  processGroupId: number;
  idleTimeoutMs: number;
  maxRuntimeMs: number;
  pollMs: number;
}>();

const report = await monitorRunProcess({
  runDir: options.runDir,
  pid: options.pid,
  processGroupId: options.processGroupId,
  idleTimeoutMs: options.idleTimeoutMs,
  maxRuntimeMs: options.maxRuntimeMs,
  pollMs: options.pollMs,
});

if (report.status !== "completed") {
  console.error(report.reason);
  process.exitCode = 124;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}
