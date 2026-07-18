import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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
    expect(result.error).toContain("incomplete document");
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

  it("resumes a validated build directly at semantic quality review", async () => {
    const workspace = await tempWorkspace();
    const first = await runWebLayoutGraph(
      {
        prompt: "Build flashcards",
        kind: "flashcards",
        requestName: "resume-source",
        skipBrowserValidation: true,
      },
      {
        sourceNode: async () => ({ source_text: "source", error_log: null }),
        plannerNode: async () => ({ layout_spec: validLayoutSpec(), error_log: null }),
        generatorNode: async () => ({
          html_document: minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" }),
          error_log: null,
        }),
        qualityReviewerNode: async () => ({ error_log: null }),
      },
    );
    expect(first.ok).toBe(true);
    await writeFile(path.join(first.runDir, "source.txt"), "", "utf8");
    await writeFile(path.join(first.runDir, "layout-spec.json"), "{}\n", "utf8");
    await writeFile(path.join(first.runDir, "validation-report.json"), "{}\n", "utf8");

    let sourceCalls = 0;
    let plannerCalls = 0;
    let generatorCalls = 0;
    let qualityCalls = 0;
    const resumed = await runWebLayoutGraph(
      {
        prompt: "Resume flashcards",
        kind: "flashcards",
        requestName: "resume-target",
        resumeRunDir: first.runDir,
        skipBrowserValidation: true,
      },
      {
        sourceNode: async () => { sourceCalls += 1; return { error_log: "must not run" }; },
        plannerNode: async () => {
          plannerCalls += 1;
          return { layout_spec: validLayoutSpec(), error_log: null };
        },
        generatorNode: async () => { generatorCalls += 1; return { error_log: "must not run" }; },
        qualityReviewerNode: async () => { qualityCalls += 1; return { error_log: null }; },
      },
    );

    expect(resumed.ok).toBe(true);
    expect(resumed.runDir).toContain(path.join(workspace, "output", "resume-target"));
    expect(sourceCalls).toBe(0);
    expect(plannerCalls).toBe(0);
    expect(generatorCalls).toBe(0);
    expect(qualityCalls).toBe(1);
  });

  it("resumes a persisted failed quality review directly at generator repair", async () => {
    const workspace = await tempWorkspace();
    const first = await runWebLayoutGraph(
      {
        prompt: "Build flashcards",
        kind: "flashcards",
        requestName: "resume-quality-source",
        skipBrowserValidation: true,
      },
      {
        sourceNode: async () => ({ source_text: "source", error_log: null }),
        plannerNode: async () => ({ layout_spec: validLayoutSpec(), error_log: null }),
        generatorNode: async () => ({
          html_document: minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" }),
          error_log: null,
        }),
        qualityReviewerNode: async () => ({ error_log: null }),
      },
    );
    await writeFile(path.join(first.runDir, "quality-review.json"), JSON.stringify({
      ok: false,
      summary: "Needs repair",
      findings: ["Persist answers."],
    }), "utf8");

    let generatorCalls = 0;
    let receivedRepair = "";
    const resumed = await runWebLayoutGraph(
      {
        prompt: "Resume flashcards",
        kind: "flashcards",
        requestName: "resume-quality-target",
        resumeRunDir: first.runDir,
        skipBrowserValidation: true,
      },
      {
        generatorNode: async (state) => {
          generatorCalls += 1;
          receivedRepair = state.error_log ?? "";
          return {
            html_document: minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" }),
            error_log: null,
          };
        },
        qualityReviewerNode: async () => ({ error_log: null }),
      },
    );

    expect(resumed.ok).toBe(true);
    expect(generatorCalls).toBe(1);
    expect(receivedRepair).toContain("Persist answers.");
    expect(resumed.runDir).toContain(path.join(workspace, "output", "resume-quality-target"));
  });

  it("resumes the latest repaired checkpoint instead of repeating edits from the older build", async () => {
    const workspace = await tempWorkspace();
    const resumeDir = path.join(workspace, "output", "repair-checkpoint", "run");
    const buildPath = path.join(resumeDir, ".build", "document.html");
    const repairPath = path.join(resumeDir, ".repair", "document.html");
    await mkdir(path.join(resumeDir, ".build"), { recursive: true });
    await mkdir(path.join(resumeDir, ".repair"), { recursive: true });
    await writeFile(path.join(resumeDir, "source.txt"), "source", "utf8");
    await writeFile(path.join(resumeDir, "layout-spec.json"), `${JSON.stringify(validLayoutSpec())}\n`, "utf8");
    await writeFile(
      buildPath,
      minimalValidStudyBuddyHtml({ title: "OLDER BUILD", kind: "flashcards", language: "de" }),
      "utf8",
    );
    await writeFile(
      repairPath,
      minimalValidStudyBuddyHtml({ title: "LATEST REPAIR", kind: "flashcards", language: "de" }),
      "utf8",
    );
    await utimes(buildPath, new Date(1_000), new Date(1_000));
    await utimes(repairPath, new Date(2_000), new Date(2_000));
    let reviewedHtml = "";

    const resumed = await runWebLayoutGraph(
      {
        prompt: "Resume repaired checkpoint",
        kind: "flashcards",
        requestName: "repair-checkpoint-target",
        resumeRunDir: resumeDir,
        skipBrowserValidation: true,
      },
      {
        qualityReviewerNode: async (state) => {
          reviewedHtml = state.html_document;
          return { error_log: null };
        },
      },
    );

    expect(resumed.ok).toBe(true);
    expect(reviewedHtml).toContain("LATEST REPAIR");
    expect(reviewedHtml).not.toContain("OLDER BUILD");
  });

  it("prefers a newer bundled build over an older editable repair with local assets", async () => {
    const workspace = await tempWorkspace();
    const resumeDir = path.join(workspace, "output", "bundled-checkpoint", "run");
    const repairPath = path.join(resumeDir, ".repair", "document.html");
    const buildPath = path.join(resumeDir, ".build", "document.html");
    await mkdir(path.dirname(repairPath), { recursive: true });
    await mkdir(path.dirname(buildPath), { recursive: true });
    await writeFile(path.join(resumeDir, "source.txt"), "source", "utf8");
    await writeFile(path.join(resumeDir, "layout-spec.json"), `${JSON.stringify(validLayoutSpec())}\n`, "utf8");
    await writeFile(
      repairPath,
      minimalValidStudyBuddyHtml({ title: "EDITABLE REPAIR", kind: "flashcards", language: "de" })
        .replace("</main>", '<img src="assets/logo.png" alt="Study Buddy"></main>'),
      "utf8",
    );
    await writeFile(
      buildPath,
      minimalValidStudyBuddyHtml({ title: "LATEST BUNDLED BUILD", kind: "flashcards", language: "de" }),
      "utf8",
    );
    await utimes(repairPath, new Date(1_000), new Date(1_000));
    await utimes(buildPath, new Date(2_000), new Date(2_000));
    let reviewedHtml = "";

    const resumed = await runWebLayoutGraph(
      {
        prompt: "Resume bundled checkpoint",
        kind: "flashcards",
        requestName: "bundled-checkpoint-target",
        resumeRunDir: resumeDir,
        skipBrowserValidation: true,
      },
      {
        qualityReviewerNode: async (state) => {
          reviewedHtml = state.html_document;
          return { error_log: null };
        },
      },
    );

    expect(resumed.ok).toBe(true);
    expect(reviewedHtml).toContain("LATEST BUNDLED BUILD");
    expect(reviewedHtml).not.toContain("EDITABLE REPAIR");
  });

  it("rebuilds resume evidence from configured sources instead of stale repair text", async () => {
    const workspace = await tempWorkspace();
    const resumeDir = path.join(workspace, "output", "source-priority", "run");
    const sourceFile = path.join(workspace, "canonical-notes.txt");
    await mkdir(path.join(resumeDir, ".build"), { recursive: true });
    await writeFile(sourceFile, "CANONICAL SOURCE EVIDENCE", "utf8");
    await writeFile(path.join(resumeDir, "source.txt"), "STALE REPAIR PROMPT", "utf8");
    await writeFile(
      path.join(resumeDir, ".build", "document.html"),
      minimalValidStudyBuddyHtml({ title: "Guide", kind: "flashcards", language: "de" }),
      "utf8",
    );
    await writeFile(path.join(resumeDir, "layout-spec.json"), `${JSON.stringify(validLayoutSpec())}\n`, "utf8");
    let reviewedSource = "";

    const resumed = await runWebLayoutGraph(
      {
        prompt: "Repair with canonical evidence",
        kind: "flashcards",
        requestName: "source-priority-target",
        resumeRunDir: resumeDir,
        sourceFiles: [sourceFile],
        skipBrowserValidation: true,
      },
      {
        qualityReviewerNode: async (state) => {
          reviewedSource = state.source_text;
          return { error_log: null };
        },
      },
    );

    expect(resumed.ok).toBe(true);
    expect(reviewedSource).toContain("CANONICAL SOURCE EVIDENCE");
    expect(reviewedSource).not.toContain("STALE REPAIR PROMPT");
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
