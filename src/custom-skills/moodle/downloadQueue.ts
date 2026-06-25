export interface DownloadQueueOptions {
  concurrency: number;
  timeoutMs: number;
}

export async function runDownloadQueue<T>(
  jobs: Array<() => Promise<T>>,
  options: DownloadQueueOptions,
): Promise<Array<PromiseSettledResult<T>>> {
  const concurrency = clampConcurrency(options.concurrency);
  const results = new Array<PromiseSettledResult<T>>(jobs.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = {
          status: "fulfilled",
          value: await withTimeout(jobs[index](), options.timeoutMs),
        };
      } catch (error) {
        results[index] = {
          status: "rejected",
          reason: error,
        };
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Download job timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
