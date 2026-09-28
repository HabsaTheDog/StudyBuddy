import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { createPlannerNode } from "../nodes/plannerNode.js";
import { createGeneratorNode } from "../nodes/generatorNode.js";
import { createQualityReviewerNode } from "../nodes/qualityReviewerNode.js";
import { initialWebLayoutState } from "../state.js";
import type { CodexClient } from "../codexClient.js";
import { minimalValidStudyBuddyHtml } from "../htmlShell.js";

it("passes source images, excluding branding, through planning, generation, and review", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "image-evidence-"));
  const config = createWebLayoutRuntimeConfig({ prompt: "Use the attached observation card", kind: "worksheet", language: "en", assetFiles: ["/tmp/observation.png"], runDir: dir });
  const tasks: string[] = [];
  const client: CodexClient = { run: async (prompt, options) => {
    expect(options.localImages).toEqual(["/tmp/observation.png"]);
    expect(prompt).toContain(config.originalUserPrompt);
    tasks.push(options.task);
    if (options.task === "artifact_planner") return JSON.stringify({ title: "Card", language: "en", kind: "worksheet", audience: "Learner", learningGoals: ["Read the card"], sections: [{ id: "card", title: "Card", purpose: "Read it", interactionType: "input" }], requiredInteractions: ["Check"], dataModel: {}, designDirection: "Clear", accessibilityNotes: [] });
    if (options.task === "quality_reviewer") return JSON.stringify({ ok: true, summary: "Matches evidence", findings: [] });
    return minimalValidStudyBuddyHtml({ title: "Card", language: "en", kind: "worksheet" });
  } };
  try {
    let state = { ...initialWebLayoutState };
    for (const make of [createPlannerNode, createGeneratorNode, createQualityReviewerNode]) {
      const result = await make(config, client)(state);
      expect(result.error_log).toBeNull();
      state = { ...state, ...result };
    }
    expect(tasks).toEqual(["artifact_planner", "artifact_builder", "quality_reviewer"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
