import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const LOCK_FILE = ".study-buddy-active-run.json";
const heldLeases = new Map<string, number>();

interface RunLeaseRecord {
  pid: number;
  startedAt: string;
  command: string;
}

interface QueuedRunSlotRecord extends RunLeaseRecord {
  leaseId: string;
  slot: number;
}

export interface QueuedRunSlotOptions {
  slots?: number;
  pollMs?: number;
  signal?: AbortSignal;
  onWait?: (activeSlots: number, totalSlots: number) => void | Promise<void>;
}

export async function acquireRunLease(
  targetDirectory: string | undefined,
  options: { reentrant?: boolean } = {},
): Promise<() => Promise<void>> {
  if (!targetDirectory) {
    return async () => undefined;
  }

  const directory = path.resolve(targetDirectory);
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, LOCK_FILE);
  const heldCount = heldLeases.get(lockPath) ?? 0;
  if (heldCount > 0) {
    if (!options.reentrant) {
      const existing = await readLease(lockPath);
      throw new Error(
        `Study Buddy run target is already active (pid ${existing?.pid ?? process.pid}, started ${existing?.startedAt ?? "unknown"}): ${directory}`,
      );
    }
    heldLeases.set(lockPath, heldCount + 1);
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await releaseHeldLease(lockPath);
    };
  }
  const record: RunLeaseRecord = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command: process.argv.join(" "),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.close();
      heldLeases.set(lockPath, 1);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await releaseHeldLease(lockPath);
      };
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== "EEXIST") throw error;
      const existing = await readLease(lockPath);
      if (existing && processIsAlive(existing.pid)) {
        throw new Error(
          `Study Buddy run target is already active (pid ${existing.pid}, started ${existing.startedAt}): ${directory}`,
        );
      }
      await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }

  throw new Error(`Could not acquire Study Buddy run lease: ${directory}`);
}

/**
 * Acquire one process-wide worker slot from a filesystem-backed queue.
 *
 * Unlike acquireRunLease, contention is expected here: callers wait until a
 * slot is free. Keeping this primitive in shared orchestration lets separate
 * T3 workspaces coordinate expensive model work without coupling their run
 * directories or runtime budgets.
 */
export async function acquireQueuedRunSlot(
  queueDirectory: string,
  options: QueuedRunSlotOptions = {},
): Promise<() => Promise<void>> {
  const slots = Math.max(1, Math.min(8, Math.floor(options.slots ?? 1)));
  const pollMs = Math.max(10, Math.floor(options.pollMs ?? 1_000));
  const directory = path.resolve(queueDirectory);
  const leaseId = randomUUID();
  await mkdir(directory, { recursive: true });
  let waitingAnnounced = false;

  while (true) {
    throwIfQueueAborted(options.signal);
    let activeSlots = 0;
    for (let slot = 1; slot <= slots; slot += 1) {
      const lockPath = path.join(directory, `slot-${slot}.json`);
      const record: QueuedRunSlotRecord = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        command: process.argv.join(" "),
        leaseId,
        slot,
      };
      try {
        const handle = await open(lockPath, "wx");
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
        await handle.close();
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          const current = await readQueuedSlot(lockPath);
          if (current?.leaseId === leaseId) {
            await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
          }
        };
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code !== "EEXIST") throw error;
        const existing = await readQueuedSlot(lockPath);
        if (existing && processIsAlive(existing.pid)) {
          activeSlots += 1;
          continue;
        }
        await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        });
        // Retry immediately now that the stale owner is gone.
        continue;
      }
    }
    if (!waitingAnnounced) {
      waitingAnnounced = true;
      await options.onWait?.(activeSlots, slots);
    }
    await waitForQueuePoll(pollMs, options.signal);
  }
}

async function releaseHeldLease(lockPath: string): Promise<void> {
  const remaining = (heldLeases.get(lockPath) ?? 1) - 1;
  if (remaining > 0) {
    heldLeases.set(lockPath, remaining);
    return;
  }
  heldLeases.delete(lockPath);
  const current = await readLease(lockPath);
  if (current?.pid === process.pid) {
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function readLease(lockPath: string): Promise<RunLeaseRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as Partial<RunLeaseRecord>;
    return typeof parsed.pid === "number" && typeof parsed.startedAt === "string"
      ? {
          pid: parsed.pid,
          startedAt: parsed.startedAt,
          command: typeof parsed.command === "string" ? parsed.command : "unknown",
        }
      : null;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") return null;
    return null;
  }
}

async function readQueuedSlot(lockPath: string): Promise<QueuedRunSlotRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as Partial<QueuedRunSlotRecord>;
    return typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.leaseId === "string" &&
      typeof parsed.slot === "number"
      ? {
          pid: parsed.pid,
          startedAt: parsed.startedAt,
          command: typeof parsed.command === "string" ? parsed.command : "unknown",
          leaseId: parsed.leaseId,
          slot: parsed.slot,
        }
      : null;
  } catch {
    return null;
  }
}

function waitForQueuePoll(pollMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, pollMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(queueAbortReason(signal));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfQueueAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw queueAbortReason(signal);
}

function queueAbortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error(String(signal?.reason || "Queued Study Buddy run aborted."));
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
