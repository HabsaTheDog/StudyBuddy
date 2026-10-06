import { lstat, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveQuizLedgerDirectory } from "../quizLedgerDirectory.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const ordinaryDirectory = (ino = 1) => ({
  dev: 1,
  ino,
  isDirectory: () => true,
  isSymbolicLink: () => false,
});

describe("quiz ledger directory resolution", () => {
  it.each([
    "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\ledger",
    "C:\\USERS\\RunnerAdmin\\AppData\\Local\\Temp\\ledger",
  ])("accepts an ordinary Windows path alias %s", async (requested) => {
    const canonical = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ledger";
    const fileSystem = {
      lstat: vi.fn(async () => ordinaryDirectory()),
      realpath: vi.fn(async () => canonical),
    };
    expect(await resolveQuizLedgerDirectory(requested, fileSystem, path.win32)).toBe(canonical);
  });

  it.each(["C:\\Users\\RUNNER~1", "C:\\Users\\RUNNER~1\\ledger"])(
    "rejects an actual Windows junction/link at %s despite realpath normalization",
    async (linked) => {
      const requested = "C:\\Users\\RUNNER~1\\ledger";
      const fileSystem = {
        lstat: vi.fn(async (value: string) => ({
          ...ordinaryDirectory(),
          isSymbolicLink: () => value === linked,
        })),
        realpath: vi.fn(async () => "C:\\Users\\runneradmin\\ledger"),
      };
      await expect(resolveQuizLedgerDirectory(requested, fileSystem, path.win32)).rejects.toThrow(
        /symlinks/,
      );
      expect(fileSystem.realpath).not.toHaveBeenCalled();
    },
  );

  it("rejects directory replacement during canonical resolution", async () => {
    const requested = "C:\\Users\\runneradmin\\ledger";
    let changed = false;
    const fileSystem = {
      lstat: vi.fn(async () => ordinaryDirectory(changed ? 2 : 1)),
      realpath: vi.fn(async () => {
        changed = true;
        return requested;
      }),
    };
    await expect(resolveQuizLedgerDirectory(requested, fileSystem, path.win32)).rejects.toThrow(
      /changed during/,
    );
  });

  it("rejects a link introduced during canonical resolution", async () => {
    const requested = "C:\\Users\\runneradmin\\ledger";
    let linked = false;
    const fileSystem = {
      lstat: vi.fn(async () => ({
        ...ordinaryDirectory(),
        isSymbolicLink: () => linked,
      })),
      realpath: vi.fn(async () => {
        linked = true;
        return "C:\\elsewhere\\ledger";
      }),
    };
    await expect(resolveQuizLedgerDirectory(requested, fileSystem, path.win32)).rejects.toThrow(
      /symlinks/,
    );
  });

  it("checks real ancestor links, including Windows directory junctions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quiz-ledger-path-"));
    roots.push(root);
    const actual = path.join(root, "actual");
    await mkdir(actual);
    await mkdir(path.join(actual, "ledger"));
    const alias = path.join(root, "linked");
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(resolveQuizLedgerDirectory(path.join(alias, "ledger"))).rejects.toThrow(/symlinks/);
    const canonical = await realpath(path.join(actual, "ledger"));
    expect(await resolveQuizLedgerDirectory(canonical)).toBe(canonical);
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
  });
});
