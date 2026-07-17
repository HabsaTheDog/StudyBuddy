export interface DownloadQueueOptions {
  concurrency: number;
  timeoutMs: number;
  signal?: AbortSignal;
  cancellationGraceMs?: number;
  onEvent?: (event: DownloadQueueEvent) => void | Promise<void>;
}

export interface DownloadJobContext {
  index: number;
  signal: AbortSignal;
  attempt: number;
}

export interface DownloadQueueEvent {
  type: "started" | "completed" | "failed" | "timed_out" | "canceled";
  index: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

export async function runDownloadQueue<T>(
  jobs: Array<(context: DownloadJobContext) => Promise<T>>,
  options: DownloadQueueOptions,
): Promise<Array<PromiseSettledResult<T>>> {
  const concurrency = clampConcurrency(options.concurrency);
  const results = new Array<PromiseSettledResult<T>>(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      try {
        if (options.onEvent) {
          await options.onEvent({ type: "started", index, startedAt });
        }
        results[index] = {
          status: "fulfilled",
          value: await runWithDeadline(
            (signal) => jobs[index]({ index, signal, attempt: 1 }),
            options,
          ),
        };
        const completedAtMs = Date.now();
        await options.onEvent?.({
          type: "completed",
          index,
          startedAt,
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: completedAtMs - startedAtMs,
        });
      } catch (error) {
        results[index] = {
          status: "rejected",
          reason: error,
        };
        const completedAtMs = Date.now();
        const message = error instanceof Error ? error.message : String(error);
        await options.onEvent?.({
          type: classifyTerminalEvent(error, options.signal),
          index,
          startedAt,
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: completedAtMs - startedAtMs,
          error: message,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
  );
  return results;
}

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return 3;
  }
  return Math.min(4, Math.max(1, Math.trunc(value)));
}

class DownloadJobTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Download job timed out after ${timeoutMs}ms.`);
    this.name = "DownloadJobTimeoutError";
  }
}

async function runWithDeadline<T>(
  start: (signal: AbortSignal) => Promise<T>,
  options: DownloadQueueOptions,
): Promise<T> {
  if (options.signal?.aborted) {
    throw abortReason(options.signal);
  }
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(abortReason(options.signal!));
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  let timeout: NodeJS.Timeout | null = null;
  const timeoutError = new DownloadJobTimeoutError(options.timeoutMs);
  if (Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(timeoutError), options.timeoutMs);
  }
  const operation = (async () => start(controller.signal))();
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(abortReason(controller.signal)), {
          once: true,
        });
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted) {
      await settleAfterCancellation(operation, options.cancellationGraceMs ?? 2_000);
      throw abortReason(controller.signal);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

async function settleAfterCancellation(operation: Promise<unknown>, graceMs: number): Promise<void> {
  await Promise.race([
    operation.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, graceMs))),
  ]);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason || "Download job canceled."));
}

function classifyTerminalEvent(
  error: unknown,
  parentSignal: AbortSignal | undefined,
): DownloadQueueEvent["type"] {
  if (error instanceof DownloadJobTimeoutError) return "timed_out";
  if (parentSignal?.aborted || (error instanceof Error && /abort|cancel/i.test(error.name))) {
    return "canceled";
  }
  return "failed";
}
