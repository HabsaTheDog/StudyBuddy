import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout CLI", () => {
  it("prints JSON with outputPath", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-cli-"));
    tempDirs.push(workspace);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
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
        timeout: 30_000,
      },
    );

    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.outputPath).toContain(
      path.join(workspace, "study-buddy-data", "runs", "cli-test"),
    );
    expect(result.publishedDeliverables).toHaveLength(1);
    expect(result.publishedDeliverables[0].publishedPath).toBe(
      path.join(workspace, "study-buddy-deliverables", "build-flashcards.html"),
    );
  // Let execFile terminate/settle before the outer test deadline and cleanup.
  // Cold Windows process startup can exceed Vitest's 5s unit-test default.
  }, 35_000);
});
