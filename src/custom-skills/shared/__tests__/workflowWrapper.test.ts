import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const wrapper = resolve(repositoryRoot, "scripts/study_buddy_task.sh");
const temporary = mkdtempSync(join(tmpdir(), "study-buddy-wrapper-"));

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function run(action: string, env: Record<string, string> = {}) {
  return spawnSync(wrapper, [action], {
    cwd: temporary,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...env,
    },
  });
}

describe("canonical Study Buddy workflow wrapper", () => {
  it("contains no maintainer-local path", () => {
    const source = readFileSync(wrapper, "utf8");
    expect(source).not.toContain("/home/alvaroschroll");
    expect(source).not.toContain(".agents/skills");
  });

  it.skipIf(process.platform === "win32")(
    "is executable and syntactically valid",
    () => {
      accessSync(wrapper, constants.X_OK);
      expect(spawnSync("bash", ["-n", wrapper]).status).toBe(0);
    },
  );

  it.skipIf(process.platform === "win32")(
    "resolves its repository root and invocation workspace without HOME",
    () => {
      const root = run("root");
      expect(root.status).toBe(0);
      expect(root.stdout.trim()).toBe(repositoryRoot);
      const workspace = run("workspace");
      expect(workspace.status).toBe(0);
      expect(workspace.stdout.trim()).toBe(temporary);
    },
  );

  it.skipIf(process.platform === "win32")("accepts the explicit packaged workflow root", () => {
    const packagedRoot = join(temporary, "packaged-workflow");
    mkdirSync(packagedRoot);
    writeFileSync(join(packagedRoot, "package.json"), "{}\n");
    const result = run("root", { STUDY_BUDDY_WORKFLOW_ROOT: packagedRoot });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packagedRoot);
  });
});
