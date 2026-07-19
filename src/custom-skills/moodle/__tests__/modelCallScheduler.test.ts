import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireModelCallAdmission } from "../modelCallScheduler.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("model-call scheduler", () => {
  it("admits independent model calls immediately when no throttle is configured", async () => {
    const directory = path.join(os.tmpdir(), `study-buddy-unthrottled-${Date.now()}`);
    const admissions = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      acquireModelCallAdmission({
        task: `parallel_task_${index}`,
        model: "terra",
        queueDirectory: directory,
        concurrency: 0,
      })
    ));

    expect(admissions.map((admission) => admission.queueWaitMs)).toEqual(Array(6).fill(0));
    expect(admissions.map((admission) => admission.slot)).toEqual(Array(6).fill(0));
    await Promise.all(admissions.map((admission) => admission.release()));
    await expect(readdir(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("admits queued model calls in FIFO order", async () => {
    const directory = await temporaryDirectory();
    const first = await acquireModelCallAdmission({
      task: "content_analyzer",
      model: "luna",
      queueDirectory: directory,
      concurrency: 1,
      pollMs: 10,
    });
    const order: string[] = [];
    const secondPromise = acquireModelCallAdmission({
      task: "content_analyzer",
      model: "luna",
      queueDirectory: directory,
      concurrency: 1,
      pollMs: 10,
    }).then((admission) => {
      order.push("second");
      return admission;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const thirdPromise = acquireModelCallAdmission({
      task: "quality_reviewer",
      model: "terra",
      queueDirectory: directory,
      concurrency: 1,
      pollMs: 10,
    }).then((admission) => {
      order.push("third");
      return admission;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual([]);
    await first.release();
    const second = await secondPromise;
    expect(order).toEqual(["second"]);
    await second.release();
    const third = await thirdPromise;
    expect(order).toEqual(["second", "third"]);
    await third.release();
  });

  it("admits two workflows while keeping the third call queued", async () => {
    const directory = await temporaryDirectory();
    const first = await acquireModelCallAdmission({
      task: "content_analyzer", model: "terra", queueDirectory: directory, concurrency: 2, pollMs: 10,
    });
    const second = await acquireModelCallAdmission({
      task: "content_analyzer", model: "terra", queueDirectory: directory, concurrency: 2, pollMs: 10,
    });
    let admitted = false;
    const thirdPromise = acquireModelCallAdmission({
      task: "quality_reviewer", model: "sol", queueDirectory: directory, concurrency: 2, pollMs: 10,
    }).then((value) => {
      admitted = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(admitted).toBe(false);
    await first.release();
    const third = await thirdPromise;
    expect(admitted).toBe(true);
    await Promise.all([second.release(), third.release()]);
  });

  it("honors configured capacity above the old two-call ceiling", async () => {
    const directory = await temporaryDirectory();
    const admitted = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      acquireModelCallAdmission({
        task: `parallel_task_${index}`,
        model: "terra",
        queueDirectory: directory,
        concurrency: 4,
        pollMs: 10,
      })
    ));

    expect(admitted.map((admission) => admission.slot).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    await Promise.all(admitted.map((admission) => admission.release()));
  });

  it("removes an aborted waiting ticket", async () => {
    const directory = await temporaryDirectory();
    const first = await acquireModelCallAdmission({
      task: "content_analyzer",
      model: "luna",
      queueDirectory: directory,
      concurrency: 1,
      pollMs: 10,
    });
    const controller = new AbortController();
    const waiting = acquireModelCallAdmission({
      task: "content_analyzer",
      model: "luna",
      queueDirectory: directory,
      concurrency: 1,
      pollMs: 10,
      signal: controller.signal,
    });
    controller.abort(new Error("stop waiting"));

    await expect(waiting).rejects.toThrow("stop waiting");
    const tickets = path.join(directory, "tickets");
    expect(await readdir(tickets)).toEqual([]);
    await first.release();
  });

  it("reclaims malformed active records", async () => {
    const directory = await temporaryDirectory();
    const activeDirectory = path.join(directory, "active");
    await mkdir(activeDirectory, { recursive: true });
    await writeFile(path.join(activeDirectory, "slot-1.json"), "invalid", "utf8");

    const admission = await acquireModelCallAdmission({
      task: "content_analyzer",
      model: "luna",
      queueDirectory: directory,
      concurrency: 1,
      pollMs: 10,
    });
    expect(admission.queueWaitMs).toBeGreaterThanOrEqual(0);
    await admission.release();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-model-queue-"));
  temporaryDirectories.push(directory);
  return directory;
}
