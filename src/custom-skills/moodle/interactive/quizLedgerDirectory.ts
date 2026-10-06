// @effect-diagnostics nodeBuiltinImport:off
import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

interface DirectoryFileSystem {
  lstat(value: string): Promise<Pick<Stats, "isSymbolicLink" | "isDirectory" | "dev" | "ino">>;
  realpath(value: string): Promise<string>;
}

/** Windows short names and casing are aliases, while links must remain inadmissible. */
export async function resolveQuizLedgerDirectory(
  value: string,
  fileSystem: DirectoryFileSystem = { lstat, realpath },
  paths: Pick<typeof path, "resolve" | "dirname"> = path,
): Promise<string> {
  async function inspect(value: string) {
    let current = value;
    const directory = await fileSystem.lstat(current);
    for (;;) {
      const entry = current === value ? directory : await fileSystem.lstat(current);
      if (entry.isSymbolicLink()) throw new Error("Quiz ledger directory must not contain symlinks.");
      if (!entry.isDirectory()) throw new Error("Quiz ledger path must contain only directories.");
      const parent = paths.dirname(current);
      if (parent === current) return directory;
      current = parent;
    }
  }

  const requested = paths.resolve(value);
  const before = await inspect(requested);
  const canonical = await fileSystem.realpath(requested);
  const after = await inspect(requested);
  const resolved = await inspect(canonical);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    after.dev !== resolved.dev ||
    after.ino !== resolved.ino
  ) {
    throw new Error("Quiz ledger directory changed during path resolution.");
  }
  return canonical;
}
