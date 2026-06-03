import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    await node(moodleTestState({
      final_document: "#set page()\n",
    }));

    await expect(readFile(outputPath, "utf8")).resolves.toBe("#set page()\n");
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
