import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiskWriterNode } from "../nodes/diskWriterNode.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("diskWriterNode", () => {
  it("writes final Typst inside the run directory", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const outputPath = path.join(runDir, "document.typ");
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath,
      runDir,
      prompt: "test",
    }));

    const result = await node(moodleTestState({
      final_document: "#set page()\n",
    }));

    expect(result.error_log).toBeNull();
    await expect(readFile(outputPath, "utf8")).resolves.toBe("#set page()\n");
    await expect(stat(path.join(runDir, "document.pdf"))).resolves.toMatchObject({
      size: expect.any(Number),
    });
    await expect(
      readFile(path.join(runDir, "study-buddy-components.typ"), "utf8"),
    ).resolves.toContain("#let sb-document");
    await expect(stat(path.join(runDir, "assets", "study-buddy-logo.png"))).resolves.toMatchObject({
      size: expect.any(Number),
    });
    await expect(
      readFile(
        path.join(
          runDir,
          ".typst-packages",
          "preview",
          "cetz",
          "0.5.0",
          "typst.toml",
        ),
        "utf8",
      ),
    ).resolves.toContain('name = "cetz"');
  });

  it("refuses to write outside the run directory", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath: path.join(runDir, "..", "escape.typ"),
      runDir,
      prompt: "test",
    }));

    await expect(
      node(moodleTestState({
        final_document: "#set page()\n",
      })),
    ).rejects.toThrow(/outside run directory/);
  });
});
