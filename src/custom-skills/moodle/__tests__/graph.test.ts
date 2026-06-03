import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMoodleGraph } from "../graph.js";
import { initialAgentState } from "../state.js";
import { moodleExtractedData, moodleTestConfig, sequenceCodex } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("moodle graph retry routing", () => {
  it("retries invalid analyzer JSON and then writes Typst", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const outputPath = path.join(runDir, "document.typ");
    const codex = sequenceCodex([
      "not json",
      JSON.stringify(moodleExtractedData()),
      "#set page()\n= DYN2\n",
    ]);

    const graph = buildMoodleGraph(
      moodleTestConfig({
        outputPath,
        runDir,
        prompt: "make notes",
      }),
      { codex },
    );

    const result = await graph.invoke({ ...initialAgentState, moodle_raw_text: "local fixture text" });
    expect(result.error_log).toBeNull();
    expect(result.retry_count).toBe(1);
    await expect(readFile(outputPath, "utf8")).resolves.toContain("DYN2");
  });
});
