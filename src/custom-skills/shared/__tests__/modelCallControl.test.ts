import { afterEach, expect, it, vi } from "vitest";
const admission = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock("../../moodle/modelCallScheduler.js", () => ({ acquireModelCallAdmission: admission.acquire }));
import { acquireModelCallControl } from "../modelCallControl.js";

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it("starts the deadline after admission, forwards aborts and releases capacity once", async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const resume = vi.fn();
  admission.acquire.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { queuedAt: "queued", queueWaitMs: 100, release: admission.release };
  });
  const pending = acquireModelCallControl({ task: "source_search", model: "test", timeoutMs: 50, signal: abort.signal, pauseRuntimeBudget: () => resume });
  await vi.advanceTimersByTimeAsync(100);
  const control = await pending;
  expect(resume).toHaveBeenCalledOnce();
  expect(control.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(50);
  expect(control.timedOut()).toBe(true);
  await control.release();
  await control.release();
  expect(admission.release).toHaveBeenCalledOnce();
});

it("does not admit canceled work even when the scheduler is unthrottled", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(acquireModelCallControl({ task: "quiz_solver", model: "test", timeoutMs: 10, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(admission.acquire).not.toHaveBeenCalled();
});
