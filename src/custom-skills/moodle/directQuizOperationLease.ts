import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import { readOwnedFile } from "./directDocumentPaths.js";

const Generation = z
  .object({ version: z.literal(1), pid: z.number().int().positive(), token: z.string().uuid() })
  .strict();
const activeMessage =
  "Another operation is active for this quiz; do not run browser tools concurrently.";

interface LeaseIO {
  open: (file: string, flags: "wx", mode: number) => Promise<FileHandle>;
  lstat: (file: string) => Promise<BigIntStats>;
  unlink: (file: string) => Promise<void>;
  readOwnedFile: typeof readOwnedFile;
  kill: typeof process.kill;
}

const defaultIO: LeaseIO = {
  open,
  lstat: (file) => lstat(file, { bigint: true }),
  unlink,
  readOwnedFile,
  kill: process.kill,
};

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function acquireDirectQuizOperationLease(
  workspace: string,
  file: string,
  overrides: Partial<LeaseIO> = {},
): Promise<{ release: () => Promise<void> }> {
  const io = { ...defaultIO, ...overrides };
  const snapshot = async () => {
    const before = await io.lstat(file);
    if (!before.isFile() || before.nlink !== 1n) throw Error(activeMessage);
    const generation = Generation.parse(JSON.parse((await io.readOwnedFile(workspace, file)).toString()));
    const after = await io.lstat(file);
    if (!after.isFile() || after.nlink !== 1n || !sameFile(before, after)) throw Error(activeMessage);
    return { identity: after, generation };
  };
  const create = async () => {
    const generation = { version: 1, pid: process.pid, token: randomUUID() };
    const handle = await io.open(file, "wx", 0o600);
    let owned;
    try {
      await handle.writeFile(JSON.stringify(generation));
      await handle.sync();
      // Windows handle and path stats use different metadata APIs. Compare
      // path snapshots with each other, and bind ownership to our written token.
      owned = await snapshot();
      if (owned.generation.token !== generation.token || owned.generation.pid !== generation.pid) {
        throw Error(activeMessage);
      }
    } catch (error) {
      await handle.close();
      throw error;
    }
    return {
      release: async () => {
        await handle.close();
        // A removed, malformed, linked, or replaced generation is not ours to delete.
        const current = await snapshot().catch(() => null);
        if (
          current &&
          sameFile(current.identity, owned.identity) &&
          current.generation.token === generation.token &&
          current.generation.pid === generation.pid
        ) {
          await io.unlink(file).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      },
    };
  };
  try {
    return await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Empty/initializing/malformed locks are never considered dead.
  const previous = await snapshot().catch(() => {
    throw Error(activeMessage);
  });
  try {
    io.kill(previous.generation.pid, 0);
    throw Error(activeMessage);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  // Serialize reclaimers for this exact generation; a loser must not unlink a replacement lease.
  const reclaimFile = `${file}.reclaim-${previous.generation.token}`;
  const reclaim = await io.open(reclaimFile, "wx", 0o600).catch(() => {
    throw Error("Quiz lock recovery is already in progress.");
  });
  try {
    const current = await snapshot();
    if (
      !sameFile(current.identity, previous.identity) ||
      current.generation.token !== previous.generation.token ||
      current.generation.pid !== previous.generation.pid
    ) {
      throw Error(activeMessage);
    }
    await io.unlink(file);
    return await create();
  } finally {
    await reclaim.close();
    await io.unlink(reclaimFile);
  }
}
