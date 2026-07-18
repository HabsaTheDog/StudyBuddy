export class StudyBuddyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyBuddyTimeoutError";
  }
}

/** Signals a recoverable extraction boundary after validated handoffs exist. */
export class StudyBuddyCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyBuddyCheckpointError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  throw abortReason(signal);
}

export function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return operation;
  }
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new StudyBuddyTimeoutError(String(signal.reason || "Study Buddy run aborted."));
}
