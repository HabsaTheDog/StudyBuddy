import { spawn } from "node:child_process";
import { appendFile, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ACTIVITY_FILES = new Set([
  "run-events.jsonl",
  "run-metrics.json",
  "run-progress.json",
  "run-summary.md",
  "workflow-summary.json",
  "workflow-summary.md",
]);

export interface RunWatchdogReport {
  status: "completed" | "idle_timeout" | "runtime_timeout";
  reason?: string;
  lastActivityAt?: string;
}

export interface RunWatchdogDependencies {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  processIsAlive?: (pid: number) => boolean;
  terminate?: (pid: number, processGroupId: number, graceMs: number) => Promise<void>;
  latestActivityAt?: (runDir: string) => Promise<number | null>;
}

export async function monitorRunProcess(input: {
  runDir: string;
  pid: number;
  processGroupId?: number;
  idleTimeoutMs: number;
  maxRuntimeMs: number;
  pollMs?: number;
  terminationGraceMs?: number;
}, dependencies: RunWatchdogDependencies = {}): Promise<RunWatchdogReport> {
  const runDir = path.resolve(input.runDir);
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const processIsAlive = dependencies.processIsAlive ?? defaultProcessIsAlive;
  const terminate = dependencies.terminate ?? terminateProcessGroup;
  const latestActivityAt = dependencies.latestActivityAt ?? findLatestRunActivity;
  const startedAt = now();
  let lastActivityAt = Math.max(startedAt, await latestActivityAt(runDir) ?? 0);
  const pollMs = Math.max(100, input.pollMs ?? 2_000);

  while (processIsAlive(input.pid)) {
    await sleep(pollMs);
    const current = now();
    lastActivityAt = Math.max(lastActivityAt, await latestActivityAt(runDir) ?? 0);
    const runtimeMs = current - startedAt;
    const idleMs = current - lastActivityAt;
    const status = runtimeMs >= input.maxRuntimeMs
      ? "runtime_timeout"
      : idleMs >= input.idleTimeoutMs
        ? "idle_timeout"
        : null;
    if (!status) continue;

    const reason = status === "runtime_timeout"
      ? `External Study Buddy watchdog stopped the run after ${input.maxRuntimeMs}ms total runtime.`
      : `External Study Buddy watchdog stopped the run after ${input.idleTimeoutMs}ms without heartbeat or file progress.`;
    await markRunStalled(runDir, reason, current);
    await terminate(
      input.pid,
      input.processGroupId ?? input.pid,
      input.terminationGraceMs ?? 5_000,
    );
    return {
      status,
      reason,
      lastActivityAt: new Date(lastActivityAt).toISOString(),
    };
  }

  return {
    status: "completed",
    lastActivityAt: new Date(lastActivityAt).toISOString(),
  };
}

export async function findLatestRunActivity(runDir: string): Promise<number | null> {
  let latest: number | null = null;
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 3) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "sources" && entry.name !== "downloads") {
          await visit(target, depth + 1);
        }
        return;
      }
      if (!entry.isFile() || !ACTIVITY_FILES.has(entry.name)) return;
      const modifiedAt = await stat(target).then((value) => value.mtimeMs, () => 0);
      latest = Math.max(latest ?? 0, modifiedAt);
    }));
  }
  await visit(path.resolve(runDir), 0);
  return latest;
}

export async function markRunStalled(
  runDir: string,
  reason: string,
  timestampMs = Date.now(),
): Promise<void> {
  const timestamp = new Date(timestampMs).toISOString();
  const reportPath = path.join(runDir, "watchdog-error.json");
  await atomicWrite(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    status: "timeout",
    reason,
    detectedAt: timestamp,
  }, null, 2)}\n`);

  await updateMarkdownSummary(path.join(runDir, "workflow-summary.md"), reason, timestamp);
  await updateWorkflowJson(path.join(runDir, "workflow-summary.json"), reason);

  const progressFiles = await findNamedFiles(runDir, "run-progress.json", 3);
  for (const progressPath of progressFiles) {
    const raw = await readFile(progressPath, "utf8").catch(() => "");
    try {
      const progress = JSON.parse(raw) as Record<string, unknown>;
      const steps = Array.isArray(progress.publicSteps)
        ? progress.publicSteps.map((step) => {
            if (!step || typeof step !== "object") return step;
            const record = step as Record<string, unknown>;
            return record.status === "running" ? { ...record, status: "failed" } : record;
          })
        : progress.publicSteps;
      await atomicWrite(progressPath, `${JSON.stringify({
        ...progress,
        status: "timeout",
        updatedAt: timestamp,
        completedAt: timestamp,
        progressRatio: 1,
        publicSteps: steps,
        error: { message: reason, retryable: true },
      }, null, 2)}\n`);
    } catch {
      // Preserve malformed diagnostics and still write the explicit watchdog report.
    }
    const stageDir = path.dirname(progressPath);
    await updateMarkdownSummary(path.join(stageDir, "run-summary.md"), reason, timestamp);
    const errorPath = path.join(stageDir, "error.log");
    const existing = await readFile(errorPath, "utf8").catch(() => "");
    if (!existing.includes(reason)) {
      await appendFile(errorPath, `${existing.trim() ? "\n" : ""}${reason}\n`, "utf8");
    }
  }
}

async function findNamedFiles(root: string, name: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === name) found.push(target);
      else if (entry.isDirectory() && !entry.name.startsWith(".")) await visit(target, depth + 1);
    }
  }
  await visit(path.resolve(root), 0);
  return found;
}

async function updateMarkdownSummary(target: string, reason: string, timestamp: string): Promise<void> {
  const current = await readFile(target, "utf8").catch(() => "");
  if (!current) return;
  let updated = current.replace(/^Run status:\s*(?:queued|running)$/m, "Run status: timeout");
  updated = updated.replace(/^Error:\s*none$/m, `Error: ${reason}`);
  if (!updated.includes(reason)) updated += `\nError: ${reason}\n`;
  if (!updated.includes("Watchdog detected at:")) updated += `Watchdog detected at: ${timestamp}\n`;
  await atomicWrite(target, updated);
}

async function updateWorkflowJson(target: string, reason: string): Promise<void> {
  const current = await readFile(target, "utf8").catch(() => "");
  if (!current) return;
  try {
    const parsed = JSON.parse(current) as Record<string, unknown>;
    await atomicWrite(target, `${JSON.stringify({ ...parsed, status: "failed", error: reason }, null, 2)}\n`);
  } catch {
    // The standalone watchdog report remains the source of truth.
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

function defaultProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcessGroup(pid: number, processGroupId: number, graceMs: number): Promise<void> {
  if (process.platform === "win32") {
    await runWindowsTaskkill(pid, false);
    const deadline = Date.now() + graceMs;
    while (defaultProcessIsAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (defaultProcessIsAlive(pid)) await runWindowsTaskkill(pid, true);
    return;
  }

  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-Math.abs(processGroupId), name);
    } catch {
      try {
        process.kill(pid, name);
      } catch {
        // Process already exited.
      }
    }
  };
  signal("SIGTERM");
  const deadline = Date.now() + graceMs;
  while (defaultProcessIsAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (defaultProcessIsAlive(pid)) signal("SIGKILL");
}

export function windowsTaskkillArguments(pid: number, force: boolean): string[] {
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

async function runWindowsTaskkill(pid: number, force: boolean): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn("taskkill.exe", windowsTaskkillArguments(pid, force), {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve());
    child.once("close", () => resolve());
  });
}
