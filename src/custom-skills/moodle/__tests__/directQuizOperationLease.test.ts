import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOwnedFile } from "../directDocumentPaths.js";
import { acquireDirectQuizOperationLease } from "../directQuizOperationLease.js";

let workspace: string;
let file: string;
const generation = (pid = process.pid) => ({ version: 1, pid, token: randomUUID() });
const deadProcess = () => {
  throw Object.assign(Error("No such process"), { code: "ESRCH" });
};

beforeEach(async () => {
  workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "study-buddy-quiz-lease-")));
  file = path.join(workspace, ".operation-lock");
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("direct quiz operation lease", () => {
  it("releases sequential operations while refusing a concurrent live lease", async () => {
    for (let index = 0; index < 3; index++) {
      const lease = await acquireDirectQuizOperationLease(workspace, file);
      await expect(acquireDirectQuizOperationLease(workspace, file)).rejects.toThrow("Another operation");
      await lease.release();
      await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("releases when Windows handle and path stats report different volume serial numbers", async () => {
    const handleStat = vi.fn();
    const windowsOpen: typeof open = async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "stat") {
            return async (options?: { bigint?: boolean }) => {
              handleStat();
              const stats = await target.stat(options);
              // Node 22.16/libuv fstat uses a 32-bit volume serial; lstat's
              // GetFileInformationByName fast path uses the 64-bit value.
              return Object.assign(stats, { dev: options?.bigint ? 0x12n : 0x12 });
            };
          }
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    const windowsIO = {
      open: windowsOpen,
      lstat: async (target: string) => Object.assign(await lstat(target, { bigint: true }), {
        dev: 0x100000012n,
      }),
    };
    const lease = await acquireDirectQuizOperationLease(workspace, file, windowsIO);
    await lease.release();
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(handleStat).not.toHaveBeenCalled();
    const next = await acquireDirectQuizOperationLease(workspace, file, windowsIO);
    await next.release();
  });

  it.each(["", "{", JSON.stringify({ version: 1, pid: process.pid })])(
    "does not reclaim an initializing or malformed lock: %j",
    async (contents) => {
      await writeFile(file, contents);
      const kill = vi.fn(deadProcess);
      await expect(acquireDirectQuizOperationLease(workspace, file, { kill })).rejects.toThrow("Another operation");
      expect(kill).not.toHaveBeenCalled();
      expect(await readFile(file, "utf8")).toBe(contents);
    },
  );

  it("does not treat an inaccessible process as dead", async () => {
    const contents = JSON.stringify(generation());
    await writeFile(file, contents);
    await expect(acquireDirectQuizOperationLease(workspace, file, {
      kill: () => { throw Object.assign(Error("Access denied"), { code: "EPERM" }); },
    })).rejects.toMatchObject({ code: "EPERM" });
    expect(await readFile(file, "utf8")).toBe(contents);
  });

  it("reclaims a genuinely exited process and releases the new generation", async () => {
    const dead = await promisify(execFile)(process.execPath, ["-e", "process.stdout.write(String(process.pid))"]);
    const stale = generation(Number(dead.stdout));
    await writeFile(file, JSON.stringify(stale));
    const lease = await acquireDirectQuizOperationLease(workspace, file);
    const current = JSON.parse(await readFile(file, "utf8"));
    expect(current.pid).toBe(process.pid);
    expect(current.token).not.toBe(stale.token);
    await expect(lstat(`${file}.reclaim-${stale.token}`)).rejects.toMatchObject({ code: "ENOENT" });
    await lease.release();
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a replacement generation written into the same inode before release", async () => {
    const lease = await acquireDirectQuizOperationLease(workspace, file);
    const previous = await lstat(file, { bigint: true });
    const replacement = generation();
    await writeFile(file, JSON.stringify(replacement));
    expect((await lstat(file, { bigint: true })).ino).toBe(previous.ino);
    await lease.release();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(replacement);
  });

  it("allows an externally removed lease and never deletes a later acquisition on repeated release", async () => {
    const first = await acquireDirectQuizOperationLease(workspace, file);
    await unlink(file);
    await first.release();
    const next = await acquireDirectQuizOperationLease(workspace, file);
    const contents = await readFile(file);
    await first.release();
    expect(await readFile(file)).toEqual(contents);
    await next.release();
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a replacement inode even if it copies the owned generation token", async () => {
    const replacementFile = path.join(workspace, "replacement-lock");
    let replaceOnClose = false;
    const lease = await acquireDirectQuizOperationLease(workspace, file, {
      open: async (target, flags, mode) => {
        const handle = await open(target, flags, mode);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          if (replaceOnClose) {
            replaceOnClose = false;
            await rename(replacementFile, file);
          }
        };
        return handle;
      },
    });
    const owned = await readFile(file);
    const previous = await lstat(file, { bigint: true });
    // Preallocate the replacement while the original still exists, preventing
    // inode reuse without relying on Windows deleting/recreating an open file.
    await writeFile(replacementFile, owned);
    expect((await lstat(replacementFile, { bigint: true })).ino).not.toBe(previous.ino);
    replaceOnClose = true;
    await lease.release();
    expect(await readFile(file)).toEqual(owned);
  });

  it("rejects a foreign generation replacing the path during initial ownership capture", async () => {
    const replacement = generation();
    const read = vi.fn(async (root: string, target: string) => {
      await writeFile(target, JSON.stringify(replacement));
      return readOwnedFile(root, target);
    });
    await expect(acquireDirectQuizOperationLease(workspace, file, { readOwnedFile: read })).rejects.toThrow("Another operation");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(replacement);
  });

  it("preserves a replacement inode introduced during release's token read", async () => {
    let replace = false;
    const replacement = generation();
    const replacementFile = path.join(workspace, "replacement-lock");
    const lease = await acquireDirectQuizOperationLease(workspace, file, {
      readOwnedFile: async (root, target) => {
        const contents = await readOwnedFile(root, target);
        if (replace) {
          await rename(replacementFile, target);
        }
        return contents;
      },
    });
    // Keep both files alive until the swap: unlink followed by write may reuse
    // the original inode, which would not exercise the changed-identity check.
    await writeFile(replacementFile, JSON.stringify(replacement));
    const before = await lstat(file, { bigint: true });
    const after = await lstat(replacementFile, { bigint: true });
    expect({ dev: after.dev, ino: after.ino }).not.toEqual({ dev: before.dev, ino: before.ino });
    replace = true;
    await lease.release();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(replacement);
  });

  it("does not reclaim a replacement live generation even when the inode is unchanged", async () => {
    const stale = generation(1);
    const replacement = generation();
    await writeFile(file, JSON.stringify(stale));
    await expect(acquireDirectQuizOperationLease(workspace, file, {
      kill: deadProcess,
      open: async (target, flags, mode) => {
        const handle = await open(target, flags, mode);
        if (target.includes(".reclaim-")) await writeFile(file, JSON.stringify(replacement));
        return handle;
      },
    })).rejects.toThrow("Another operation");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(replacement);
    await expect(lstat(`${file}.reclaim-${stale.token}`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes reclaimers for the exact stale generation", async () => {
    const stale = generation(1);
    const contents = JSON.stringify(stale);
    await writeFile(file, contents);
    const reclaimFile = `${file}.reclaim-${stale.token}`;
    await writeFile(reclaimFile, "owned by another reclaimer");
    await expect(acquireDirectQuizOperationLease(workspace, file, { kill: deadProcess })).rejects.toThrow("recovery is already in progress");
    expect(await readFile(file, "utf8")).toBe(contents);
    expect(await readFile(reclaimFile, "utf8")).toBe("owned by another reclaimer");
  });

  it("rejects hard-linked locks even if their generation belongs to an exited process", async () => {
    await writeFile(file, JSON.stringify(generation(1)));
    await link(file, path.join(workspace, "other-name"));
    const kill = vi.fn(deadProcess);
    await expect(acquireDirectQuizOperationLease(workspace, file, { kill })).rejects.toThrow("Another operation");
    expect(kill).not.toHaveBeenCalled();
    expect((await lstat(file)).nlink).toBe(2);
  });

  it("rejects a linked lock without changing its target (Windows junctions require no symlink privilege)", async () => {
    const target = path.join(workspace, "target");
    if (process.platform === "win32") {
      await mkdir(target);
      await writeFile(path.join(target, "sentinel"), "unchanged");
      await symlink(target, file, "junction");
    } else {
      await writeFile(target, JSON.stringify(generation(1)));
      await symlink(target, file);
    }
    const kill = vi.fn(deadProcess);
    await expect(acquireDirectQuizOperationLease(workspace, file, { kill })).rejects.toThrow("Another operation");
    expect(kill).not.toHaveBeenCalled();
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    if (process.platform === "win32") {
      expect(await readFile(path.join(target, "sentinel"), "utf8")).toBe("unchanged");
    } else {
      expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({ version: 1, pid: 1 });
    }
  });
});
