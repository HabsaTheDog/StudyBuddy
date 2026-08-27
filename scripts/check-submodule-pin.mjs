import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const submodulePath = "t3code-fork";

function git(args, cwd = repositoryRoot) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const indexEntry = git(["ls-files", "--stage", "--", submodulePath]);
const match = /^160000 ([0-9a-f]{40}) 0\tt3code-fork$/u.exec(indexEntry);
if (!match) {
  throw new Error("t3code-fork must be an exact Git submodule commit in the index.");
}

const pinnedCommit = match[1];
const remoteUrl = git([
  "config",
  "--file",
  resolve(repositoryRoot, ".gitmodules"),
  "--get",
  `submodule.${submodulePath}.url`,
]);
const remoteRefs = git(["ls-remote", remoteUrl]);
if (!remoteRefs.split(/\r?\n/u).some((line) => line.startsWith(`${pinnedCommit}\t`))) {
  throw new Error(`Pinned UI commit is not reachable from a public remote ref: ${pinnedCommit}`);
}

process.stdout.write(`Verified public UI submodule pin ${pinnedCommit}.\n`);
