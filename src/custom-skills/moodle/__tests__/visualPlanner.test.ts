import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVisualPlannerNode } from "../nodes/visualPlannerNode.js";
import { RunDiagnostics } from "../runDiagnostics.js";
import { ResourceManifestSchema } from "../examNavigatorContracts.js";
import { readVisualRetrievalPlan } from "../visualPlanner.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("visual planner node", () => {
  it("writes an empty fallback plan when no local PDFs are available", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-planner-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({ runDir, diagnostics });
    const node = createVisualPlannerNode(config, {
      async run() {
        throw new Error("Codex should not be called without a PDF page index.");
      },
    });

    const result = await node(moodleTestState({
      resource_manifest: ResourceManifestSchema.parse({
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [],
      }),
    }));

    expect(result.error_log).toBeNull();
    await expect(readVisualRetrievalPlan(runDir)).resolves.toMatchObject({
      schemaVersion: "1.0",
      requests: [],
    });
  });
});
