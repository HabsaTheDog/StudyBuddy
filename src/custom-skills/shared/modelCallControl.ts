import { acquireModelCallAdmission, type ModelCallAdmissionOptions } from "../moodle/modelCallScheduler.js";

/** One admission/deadline lifecycle for document, page and quiz SDK turns. */
export async function acquireModelCallControl(input: ModelCallAdmissionOptions & {
  timeoutMs: number;
  pauseRuntimeBudget?: () => (() => void);
}) {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Model call timeout must be a positive finite duration.");
  }
  input.signal?.throwIfAborted();
  const resume = input.pauseRuntimeBudget?.();
  const admission = await (async () => {
    try { return await acquireModelCallAdmission(input); }
    finally { resume?.(); }
  })();
  if (input.signal?.aborted) {
    await admission.release();
    input.signal.throwIfAborted();
  }
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), input.timeoutMs);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutController.signal])
    : timeoutController.signal;
  let released = false;
  return {
    signal,
    queuedAt: admission.queuedAt,
    queueWaitMs: admission.queueWaitMs,
    timedOut: () => timeoutController.signal.aborted && !input.signal?.aborted,
    async release() {
      if (released) return;
      released = true;
      clearTimeout(timeout);
      await admission.release();
    },
  };
}
