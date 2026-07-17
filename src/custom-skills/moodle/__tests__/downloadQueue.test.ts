import { describe, expect, it } from "vitest";
import { clampConcurrency, runDownloadQueue } from "../downloadQueue.js";

describe("downloadQueue", () => {
  it("runs jobs at the configured concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const jobs = Array.from({ length: 8 }, (_, index) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return index;
    });

    const results = await runDownloadQueue(jobs, { concurrency: 3, timeoutMs: 1_000 });

    expect(maxActive).toBe(3);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("never allows configured concurrency above 4", () => {
    expect(clampConcurrency(12)).toBe(4);
    expect(clampConcurrency(0)).toBe(1);
  });

  it("aborts the underlying job before returning a timeout result", async () => {
    let aborted = false;
    let lateMutation = false;
    const jobs = [async ({ signal }: { signal: AbortSignal }) =>
      new Promise<string>((resolve, reject) => {
        const lateTimer = setTimeout(() => {
          lateMutation = true;
          resolve("late");
        }, 80);
        signal.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(lateTimer);
          reject(signal.reason);
        }, { once: true });
      })];

    const results = await runDownloadQueue(jobs, {
      concurrency: 1,
      timeoutMs: 10,
      cancellationGraceMs: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(results[0].status).toBe("rejected");
    expect(aborted).toBe(true);
    expect(lateMutation).toBe(false);
  });

  it("propagates parent cancellation to active jobs", async () => {
    const controller = new AbortController();
    let observedAbort = false;
    const run = runDownloadQueue([
      async ({ signal }) => new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => {
          observedAbort = true;
          reject(signal.reason);
        }, { once: true });
      }),
    ], { concurrency: 1, timeoutMs: 1_000, signal: controller.signal });

    controller.abort(new Error("test cancellation"));
    const results = await run;

    expect(observedAbort).toBe(true);
    expect(results[0].status).toBe("rejected");
  });
});
