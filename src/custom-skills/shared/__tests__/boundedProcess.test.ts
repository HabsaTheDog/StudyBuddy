import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBoundedProcess } from "../boundedProcess.js";

describe("runBoundedProcess", () => {
  it("captures successful output", async () => {
    await expect(runBoundedProcess(process.execPath, ["-e", "process.stdout.write('ok')"]))
      .resolves.toMatchObject({ code: 0, stdout: "ok", stderr: "" });
  });

  it("terminates commands that exceed their time budget", async () => {
    await expect(runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeoutMs: 30 },
    )).rejects.toThrow("timed out");
  });

  it("terminates commands that exceed the output limit", async () => {
    await expect(runBoundedProcess(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(2048))"],
      { maxOutputBytes: 128 },
    )).rejects.toThrow("stdout safety limit");
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    const result = runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal },
    );
    controller.abort(new Error("test cancellation"));
    await expect(result).rejects.toThrow("test cancellation");
  });

  it("does not leave the spawned process active after cancellation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "Study Buddy process Prüfpfad "));
    const pidPath = path.join(directory, "child.pid");
    const controller = new AbortController();
    try {
      const result = runBoundedProcess(process.execPath, [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)",
        pidPath,
      ], { signal: controller.signal });
      const childPid = await waitForPid(pidPath);
      controller.abort(new Error("termination check"));
      await expect(result).rejects.toThrow("termination check");
      await expect(waitForProcessExit(childPid)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function waitForPid(pidPath: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await readFile(pidPath, "utf8").catch(() => "");
    if (value) return Number(value);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Child process did not write its PID.");
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Child process ${pid} remained active after cancellation.`);
}
