import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWebLayoutGraph } from "../graph.js";
import { minimalValidStudyBuddyHtml } from "../htmlShell.js";
import type { LangGraphWebLayoutState } from "../state.js";

const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
const tempDirs: string[] = [];

afterEach(async () => {
  process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout graph", () => {
  it("retries the generator after validator failure", async () => {
    const workspace = await tempWorkspace();
    let generatorCalls = 0;
    const result = await runWebLayoutGraph(
      {
        prompt: "Build flashcards",
        kind: "flashcards",
        requestName: "retry-test",
        skipBrowserValidation: true,
      },
      {
        sourceNode: async () => ({ source_text: "source", error_log: null }),
        plannerNode: async () => ({ layout_spec: validLayoutSpec(), error_log: null }),
        generatorNode: async () => {
          generatorCalls += 1;
          return {
            html_document: generatorCalls === 1
              ? "<!doctype html><html><body>broken</body></html>"
              : minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" }),
            error_log: null,
          };
        },
        qualityReviewerNode: async () => ({ error_log: null }),
      },
    );

    expect(result.ok).toBe(true);
    expect(generatorCalls).toBe(2);
    expect(result.outputPath).toContain(path.join(workspace, "output", "retry-test"));
  });

  it("aborts after three invalid generations", async () => {
    await tempWorkspace();
    const result = await runWebLayoutGraph(
      {
        prompt: "Build flashcards",
        kind: "flashcards",
        requestName: "abort-test",
        skipBrowserValidation: true,
      },
      {
        sourceNode: async () => ({ source_text: "source", error_log: null }),
        plannerNode: async () => ({ layout_spec: validLayoutSpec(), error_log: null }),
        generatorNode: async () => ({
          html_document: "<!doctype html><html><body>broken</body></html>",
          error_log: null,
        }),
        qualityReviewerNode: async () => ({ error_log: null }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.state.retry_count).toBe(3);
    expect(result.error).toContain("HTML validation failed");
  });

  it("keeps validator and semantic quality retry budgets independent", async () => {
    await tempWorkspace();
    let generatorCalls = 0;
    let qualityCalls = 0;
    const result = await runWebLayoutGraph(
      {
        prompt: "Build a resilient interactive guide",
        kind: "flashcards",
        requestName: "independent-retry-test",
        skipBrowserValidation: true,
      },
      {
        sourceNode: async () => ({ source_text: "source", error_log: null }),
        plannerNode: async () => ({ layout_spec: validLayoutSpec(), error_log: null }),
        generatorNode: async () => {
          generatorCalls += 1;
          return {
            html_document: generatorCalls <= 2
              ? "<!doctype html><html><body>broken</body></html>"
              : minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" }),
            error_log: null,
          };
        },
        qualityReviewerNode: async (state) => {
          qualityCalls += 1;
          return qualityCalls === 1
            ? {
                error_log: "Semantic quality review failed: repair this",
                retry_count: state.retry_count + 1,
                quality_retry_count: state.quality_retry_count + 1,
              }
            : { error_log: null };
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(generatorCalls).toBe(4);
    expect(qualityCalls).toBe(2);
    expect(result.state.validator_retry_count).toBe(2);
    expect(result.state.quality_retry_count).toBe(1);
    expect(result.state.retry_count).toBe(3);
  });
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-graph-"));
  tempDirs.push(workspace);
  process.env.STUDY_BUDDY_WORKSPACE = workspace;
  return workspace;
}

function validLayoutSpec(): LangGraphWebLayoutState["layout_spec"] {
  return {
    title: "Flashcards",
    language: "de",
    kind: "flashcards",
    audience: "Studierende",
    learningGoals: ["Wiederholen"],
    sections: [{ id: "main", title: "Main", purpose: "Learn", interactionType: "flashcards" }],
    requiredInteractions: ["flip"],
    dataModel: {},
    designDirection: "Study Buddy technical",
    accessibilityNotes: ["Keyboard"],
  };
}
