import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findLatestRunActivity,
  monitorRunProcess,
  windowsTaskkillArguments,
} from "../runWatchdog.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("external Study Buddy watchdog", () => {
  it("targets the complete Windows process tree and escalates only when requested", () => {
    expect(windowsTaskkillArguments(1234, false)).toEqual(["/PID", "1234", "/T"]);
    expect(windowsTaskkillArguments(1234, true)).toEqual(["/PID", "1234", "/T", "/F"]);
  });

  it("returns normally when the supervised process exits", async () => {
    let checks = 0;
    const terminate = vi.fn();
    const result = await monitorRunProcess({
      runDir: process.cwd(),
      pid: 123,
      idleTimeoutMs: 1_000,
      maxRuntimeMs: 10_000,
      pollMs: 100,
    }, {
      now: () => 1_000,
      sleep: async () => undefined,
      processIsAlive: () => checks++ === 0,
      latestActivityAt: async () => 1_000,
      terminate,
    });

    expect(result.status).toBe("completed");
    expect(terminate).not.toHaveBeenCalled();
  });

  it("marks stale workflow and extraction state terminal before terminating the process", async () => {
    runDir = await createRunningWorkflow();
    let current = 10_000;
    let alive = true;
    const terminate = vi.fn(async () => {
      alive = false;
    });

    const result = await monitorRunProcess({
      runDir,
      pid: 123,
      processGroupId: 123,
      idleTimeoutMs: 200,
      maxRuntimeMs: 10_000,
      pollMs: 100,
    }, {
      now: () => current,
      sleep: async (milliseconds) => {
        current += milliseconds;
      },
      processIsAlive: () => alive,
      latestActivityAt: async () => 10_000,
      terminate,
    });

    expect(result.status).toBe("idle_timeout");
    expect(terminate).toHaveBeenCalledOnce();
    expect(await readFile(path.join(runDir, "workflow-summary.md"), "utf8"))
      .toContain("Run status: timeout");
    const progress = JSON.parse(await readFile(path.join(runDir, "extraction", "run-progress.json"), "utf8"));
    expect(progress).toMatchObject({
      status: "timeout",
      progressRatio: 1,
      error: { retryable: true },
    });
    expect(await readFile(path.join(runDir, "extraction", "error.log"), "utf8"))
      .toContain("without heartbeat or file progress");
    expect(JSON.parse(await readFile(path.join(runDir, "watchdog-error.json"), "utf8")))
      .toMatchObject({ status: "timeout" });
  });

  it("detects activity files in nested extraction and render directories", async () => {
    runDir = await createRunningWorkflow();
    const activity = await findLatestRunActivity(runDir);

    expect(activity).not.toBeNull();
    expect(activity!).toBeGreaterThan(0);
  });

  it("terminates a real detached process group after its run files become stale", async () => {
    if (process.platform === "win32") return;
    runDir = await createRunningWorkflow();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    const childPid = child.pid!;
    try {
      const result = await monitorRunProcess({
        runDir,
        pid: childPid,
        processGroupId: childPid,
        idleTimeoutMs: 150,
        maxRuntimeMs: 5_000,
        pollMs: 100,
        terminationGraceMs: 200,
      });

      expect(result.status).toBe("idle_timeout");
      await expect(waitForExit(childPid)).resolves.toBeUndefined();
    } finally {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        // Expected after watchdog termination.
      }
    }
  });
});

async function createRunningWorkflow(): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "study-buddy-watchdog-"))
  );
  await mkdir(path.join(root, "extraction"), { recursive: true });
  await writeFile(path.join(root, "workflow-summary.md"), [
    "# Interactive Study Guide workflow",
    "",
    "Run status: running",
    "Error: none",
    "",
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "workflow-summary.json"), JSON.stringify({ status: "running" }), "utf8");
  await writeFile(path.join(root, "extraction", "run-summary.md"), "Run status: running\n", "utf8");
  await writeFile(path.join(root, "extraction", "run-progress.json"), JSON.stringify({
    schemaVersion: 2,
    status: "running",
    progressRatio: 0.22,
    publicSteps: [{ id: "moodle", status: "running" }],
  }), "utf8");
  return root;
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${pid} remained alive after watchdog termination.`);
}
