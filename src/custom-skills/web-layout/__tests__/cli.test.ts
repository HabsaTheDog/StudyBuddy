import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
const tempDirs: string[] = [];

afterEach(async () => {
  process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout CLI", () => {
  it("prints JSON with outputPath", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-cli-"));
    tempDirs.push(workspace);
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");

    const { stdout } = await execFileAsync(
      tsx,
      [
        "src/custom-skills/web-layout/cli.ts",
        "Build flashcards",
        "--kind",
        "flashcards",
        "--request-name",
        "cli-test",
        "--skip-browser-validation",
        "--json",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STUDY_BUDDY_WORKSPACE: workspace,
          WEB_LAYOUT_TEST_CODEX: "1",
        },
        timeout: 60_000,
      },
    );

    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.outputPath).toContain(path.join(workspace, "output", "cli-test"));
  });
});
