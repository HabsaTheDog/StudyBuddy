import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const LOCK_FILE = ".study-buddy-active-run.json";
const heldLeases = new Map<string, number>();

interface RunLeaseRecord {
  pid: number;
  startedAt: string;
  command: string;
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

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
