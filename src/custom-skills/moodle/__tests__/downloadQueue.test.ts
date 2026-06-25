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
});
