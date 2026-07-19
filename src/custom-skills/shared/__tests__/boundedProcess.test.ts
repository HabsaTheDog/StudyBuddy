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
});
