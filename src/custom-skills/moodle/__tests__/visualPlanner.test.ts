import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVisualPlannerPrompt,
  createVisualPlannerNode,
  validateVisualPlan,
} from "../nodes/visualPlannerNode.js";
import { RunDiagnostics } from "../runDiagnostics.js";
import { ResourceManifestSchema } from "../examNavigatorContracts.js";
import { buildVisualPageIndex, readVisualRetrievalPlan } from "../visualPlanner.js";
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

  it("skips files saved as PDFs when Moodle returned HTML", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-planner-"));
    const fakePdf = path.join(runDir, "login-page.pdf");
    await writeFile(fakePdf, "<!doctype html><html><body>Please log in</body></html>", "utf8");
    const config = moodleTestConfig({ runDir });

    const index = await buildVisualPageIndex(config, moodleTestState({
      resource_manifest: ResourceManifestSchema.parse({
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [{
          id: "res-login",
          parentId: null,
          sectionPath: ["MEL"],
          activityType: "resource",
          title: "Angabe 7",
          originUrl: "https://moodle.example/mod/resource/view.php?id=1953045",
          resolvedUrl: null,
          localPath: fakePdf,
          previewPath: fakePdf,
          status: "acquired",
          checksum: null,
          verifiedAt: new Date().toISOString(),
          examRelevance: "unknown",
          failureReason: null,
        }],
      }),
    }));

    expect(index.entries).toEqual([]);
    expect(index.warnings.join("\n")).toContain("Moodle returned an HTML page");
  });

  it("lets the evaluated request decide visual relevance while enforcing only page ceilings and known IDs", () => {
    const config = moodleTestConfig({
      executionProfile: "balanced",
      originalUserPrompt: "Create a concise overview; images are optional.",
    });
    const state = moodleTestState({
      source_architect_decision: {
        ...moodleTestState().source_architect_decision,
        learningArchitecture: {
          schemaVersion: 1,
          modules: [{
            id: "module-a",
            title: "Module A",
            priority: "essential",
            contentMode: "quantitative",
            learningObjectives: ["Apply the method"],
            assessmentSignals: ["Worked example"],
            resourceUrls: ["https://moodle.example/mod/resource/view.php?id=1"],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      },
      resource_manifest: ResourceManifestSchema.parse({
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [{
          id: "res-direct",
          parentId: null,
          sectionPath: ["Module A"],
          activityType: "resource",
          title: "Worked examples",
          originUrl: "https://moodle.example/mod/resource/view.php?id=1",
          resolvedUrl: null,
          localPath: null,
          previewPath: null,
          status: "acquired",
          checksum: null,
          verifiedAt: new Date().toISOString(),
          examRelevance: "confirmed",
          failureReason: null,
        }],
      }),
    });
    const pageIndex = {
      schemaVersion: "1.0" as const,
      generatedAt: new Date().toISOString(),
      warnings: [],
      entries: [{
        resourceId: "res-direct",
        title: "Worked examples",
        sourcePath: "/tmp/examples.pdf",
        sourceUrl: "https://moodle.example/mod/resource/view.php?id=1",
        sectionPath: ["Module A"],
        pageCount: 20,
        pages: Array.from({ length: 20 }, (_, index) => ({
          page: index + 1,
          hint: `Page ${index + 1}`,
          signals: index % 2 === 0
            ? ["worked_example", "formula_or_math"]
            : ["context_logo"],
        })),
      }],
    };

    const prompt = buildVisualPlannerPrompt(config, state, pageIndex);
    expect(prompt).toContain(config.originalUserPrompt);
    expect(prompt).toContain("evaluated request contract");
    expect(prompt).toContain("The empty requests array is valid");
    expect(prompt).not.toContain("formula_reference pages are mandatory");

    expect(validateVisualPlan(config, pageIndex, {
      schemaVersion: "1.0",
      strategy: "The request does not need visual support.",
      requests: [],
    })).toMatchObject({ requests: [] });
    expect(() => validateVisualPlan(config, pageIndex, {
      schemaVersion: "1.0",
      strategy: "Invalid page.",
      requests: [{
        resourceId: "res-direct",
        pages: [21],
        purpose: "diagram",
        priority: "medium",
        placementHint: "Only if requested.",
        reason: "A model decision.",
      }],
    })).toThrow("unknown page");
  });
});
