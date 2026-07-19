import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOptionalConcurrency } from "../shared/concurrency.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUEUE_DIRECTORY = path.resolve(
  MODULE_DIR,
  "../../..",
  "study-buddy-data",
  ".model-call-queue",
);

interface QueueRecord {
  leaseId: string;
  pid: number;
  queuedAt: string;
  task: string;
  model: string;
}

interface ActiveRecord extends QueueRecord {
  admittedAt: string;
  slot: number;
}

export interface ModelCallAdmission {
  queuedAt: string;
  admittedAt: string;
  queueWaitMs: number;
  slot: number;
  release(): Promise<void>;
}

export interface ModelCallAdmissionOptions {
  task: string;
  model: string;
  signal?: AbortSignal;
  queueDirectory?: string;
  concurrency?: number;
  pollMs?: number;
  onWait?: (position: number, activeSlots: number) => void | Promise<void>;
}

/**
 * Optionally apply filesystem-backed FIFO admission to expensive Codex calls
 * across Study Buddy processes. Admission is unthrottled by default so each T3
 * workspace can progress independently. A positive concurrency setting opts
 * into a shared installation-wide cap.
 */
export async function acquireModelCallAdmission(
  options: ModelCallAdmissionOptions,
): Promise<ModelCallAdmission> {
  const queueDirectory = path.resolve(options.queueDirectory ?? DEFAULT_QUEUE_DIRECTORY);
  const ticketsDirectory = path.join(queueDirectory, "tickets");
  const activeDirectory = path.join(queueDirectory, "active");
  const concurrency = resolveOptionalConcurrency(
    options.concurrency ?? process.env.STUDY_BUDDY_MODEL_CALL_CONCURRENCY,
  );
  const pollMs = Math.max(10, Math.floor(options.pollMs ?? 250));
  const queuedMs = Date.now();
  const queuedAt = new Date(queuedMs).toISOString();
  if (concurrency === null) {
    return {
      queuedAt,
      admittedAt: queuedAt,
      queueWaitMs: 0,
      slot: 0,
      release: async () => undefined,
    };
  }
  const leaseId = randomUUID();
  const record: QueueRecord = {
    leaseId,
    pid: process.pid,
    queuedAt,
    task: options.task,
    model: options.model,
  };
  const ticketName = `${String(queuedMs).padStart(13, "0")}-${process.pid}-${leaseId}.json`;
  const ticketPath = path.join(ticketsDirectory, ticketName);
  await Promise.all([
    mkdir(ticketsDirectory, { recursive: true }),
    mkdir(activeDirectory, { recursive: true }),
  ]);
  const temporaryTicketPath = path.join(ticketsDirectory, `.${ticketName}.tmp`);
  await writeFile(temporaryTicketPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporaryTicketPath, ticketPath);
  let announcedPosition: number | null = null;

  try {
    while (true) {
      throwIfAborted(options.signal);
      await reclaimStaleQueueEntries(ticketsDirectory, activeDirectory);
      const tickets = await readTickets(ticketsDirectory);
      const position = tickets.findIndex((ticket) => ticket.record.leaseId === leaseId);
      if (position === -1) {
        throw new Error(`Study Buddy model-call ticket disappeared before admission: ${leaseId}`);
      }
      const activeSlots = await countActiveSlots(activeDirectory, concurrency);
      if (position < concurrency) {
        const acquired = await tryAcquireActiveSlot(activeDirectory, concurrency, {
          ...record,
          admittedAt: new Date().toISOString(),
          slot: 0,
        });
        if (acquired) {
          await unlink(ticketPath).catch(ignoreMissing);
          const admittedAt = acquired.record.admittedAt;
          return {
            queuedAt,
            admittedAt,
            queueWaitMs: Math.max(0, Date.parse(admittedAt) - queuedMs),
            slot: acquired.record.slot,
            release: acquired.release,
          };
        }
      }
      const humanPosition = position + 1;
      if (announcedPosition !== humanPosition) {
        announcedPosition = humanPosition;
        await options.onWait?.(humanPosition, activeSlots);
      }
      await waitForPoll(pollMs, options.signal);
    }
  } catch (error) {
    await unlink(ticketPath).catch(ignoreMissing);
    throw error;
  }
}

async function tryAcquireActiveSlot(
  activeDirectory: string,
  concurrency: number,
  input: ActiveRecord,
): Promise<{ record: ActiveRecord; release(): Promise<void> } | null> {
  for (let slot = 1; slot <= concurrency; slot += 1) {
    const activePath = path.join(activeDirectory, `slot-${slot}.json`);
    const record = { ...input, slot };
    const temporaryPath = path.join(activeDirectory, `.${record.leaseId}-${slot}.tmp`);
    try {
      // Linking a fully written temporary record gives us atomic create-if-
      // absent semantics without exposing an empty/partial JSON lock file.
      await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await link(temporaryPath, activePath);
      await unlink(temporaryPath).catch(ignoreMissing);
      let released = false;
      return {
        record,
        async release() {
          if (released) return;
          released = true;
          const current = await readJson<ActiveRecord>(activePath);
          if (current?.leaseId === record.leaseId) {
            await unlink(activePath).catch(ignoreMissing);
          }
        },
      };
    } catch (error) {
      await unlink(temporaryPath).catch(ignoreMissing);
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return null;
}

async function reclaimStaleQueueEntries(
  ticketsDirectory: string,
  activeDirectory: string,
): Promise<void> {
  for (const directory of [ticketsDirectory, activeDirectory]) {
    const names = await readdir(directory).catch(() => []);
    for (const name of names.filter((entry) => entry.endsWith(".json"))) {
      const filePath = path.join(directory, name);
      const record = await readJson<QueueRecord>(filePath);
      if (!record || !processIsAlive(record.pid)) {
        await unlink(filePath).catch(ignoreMissing);
      }
    }
  }
}

async function readTickets(
  ticketsDirectory: string,
): Promise<Array<{ name: string; record: QueueRecord }>> {
  const names = (await readdir(ticketsDirectory).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const tickets = await Promise.all(names.map(async (name) => ({
    name,
    record: await readJson<QueueRecord>(path.join(ticketsDirectory, name)),
  })));
  return tickets
    .filter((ticket): ticket is { name: string; record: QueueRecord } => Boolean(ticket.record))
    .sort((left, right) =>
      Date.parse(left.record.queuedAt) - Date.parse(right.record.queuedAt) ||
      left.name.localeCompare(right.name)
    );
}

async function countActiveSlots(activeDirectory: string, concurrency: number): Promise<number> {
  let active = 0;
  for (let slot = 1; slot <= concurrency; slot += 1) {
    if (await readJson<ActiveRecord>(path.join(activeDirectory, `slot-${slot}.json`))) active += 1;
  }
  return active;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
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

function waitForPoll(pollMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, pollMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error(String(signal?.reason || "Study Buddy model-call admission aborted."));
}

function ignoreMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
