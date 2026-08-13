import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiskWriterNode } from "../nodes/diskWriterNode.js";
import type { CodexClient } from "../codexClient.js";
import { parsePdfTextPages } from "../pdfPostRenderReview.js";
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
      final_document: "#set page()\n= Rendered test page\n\nVisible body text.\n",
    }));

    expect(result.error_log).toBeNull();
    await expect(readFile(outputPath, "utf8")).resolves.toContain("Visible body text.");
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
      readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8"),
    ).resolves.toContain('"modelReview": "not_configured"');
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

  it("rejects a compiled PDF whose only page is visually blank", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      prompt: "test",
    }));

    const result = await node(moodleTestState({ final_document: "#set page()\n" }));

    expect(result.error_log).toMatch(/repair target: formatter[\s\S]*blank-page/i);
    const review = JSON.parse(
      await readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8"),
    ) as { ok: boolean; findings: Array<{ page: number | null; code: string }> };
    expect(review.ok).toBe(false);
    expect(review.findings).toContainEqual(expect.objectContaining({ page: 1, code: "blank-page" }));
  });

  it("rejects visibly printed Typst markup in the compiled PDF text layer", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      prompt: "test",
    }));

    const result = await node(moodleTestState({
      final_document: '#set page()\n#let raw = "$bold(r)$: Ortsvektor"\n#raw\n',
    }));

    expect(result.error_log).toMatch(/repair target: formatter[\s\S]*raw-typesetting-markup/i);
    const review = JSON.parse(
      await readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8"),
    ) as { ok: boolean; findings: Array<{ page: number | null; code: string }> };
    expect(review.ok).toBe(false);
    expect(review.findings).toContainEqual(expect.objectContaining({ page: 1, code: "raw-typesetting-markup" }));
  });

  it("attaches portable rendered page input to an injected visual reviewer and persists page-local findings", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const run = vi.fn<CodexClient["run"]>().mockResolvedValue(JSON.stringify({
      ok: true,
      findings: [{
        page: 2,
        severity: "warning",
        code: "dense-footer",
        message: "The footer is dense but remains readable.",
        repairTarget: "formatter",
      }],
    }));
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      prompt: "test",
    }), { run });

    const result = await node(moodleTestState({
      final_document: [
        "#set page()",
        "= First rendered page",
        "Visible body text on page one.",
        "#pagebreak()",
        "= Second rendered page",
        "Visible body text on page two.",
      ].join("\n"),
    }));

    expect(result.error_log).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    const reviewOptions = run.mock.calls[0]?.[1];
    expect(reviewOptions).toMatchObject({ task: "quality_reviewer" });
    const reviewImagePaths = (reviewOptions?.localImages ?? []).map((imagePath) =>
      path.relative(runDir!, imagePath).split(path.sep).join("/")
    );
    expect(reviewImagePaths.length).toBeGreaterThan(0);
    expect(reviewImagePaths.length).toBeLessThanOrEqual(2);
    expect(reviewImagePaths.every((imagePath) =>
      /^pdf-review\/(?:sheets\/sheet-|pages\/page-)\d+\.png$/.test(imagePath)
    )).toBe(true);
    const review = JSON.parse(
      await readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8"),
    ) as {
      ok: boolean;
      modelReview: string;
      modelReviewedPages: number[];
      pages: Array<{ wordCount: number; rasterPath: string | null }>;
      findings: Array<{ page: number | null; code: string; repairTarget: string }>;
    };
    expect(review).toMatchObject({
      ok: true,
      modelReview: "passed",
      modelReviewedPages: [1, 2],
    });
    expect(review.pages).toHaveLength(2);
    expect(review.pages.every((page) => page.wordCount > 0)).toBe(true);
    expect(review.pages.every((page) => /^pdf-review\/pages\/page-\d+\.png$/.test(page.rasterPath ?? ""))).toBe(true);
    expect(review.findings).toContainEqual(expect.objectContaining({
      page: 2,
      code: "dense-footer",
      repairTarget: "formatter",
    }));
  });

  it("extracts encoded XML text without confusing decoded text with markup", () => {
    const pages = parsePdfTextPages([
      '<page width="100" height="100">',
      '<word xMin="1" yMin="2" xMax="20" yMax="5">&lt;script&gt;safe &amp; sound</word>',
      '<word xMin="1" yMin="6" xMax="20" yMax="9"><b>Nested</b> text</word>',
      "</page>",
    ].join(""));

    expect(pages[0]?.words.map((word) => word.text)).toEqual([
      "<script>safe & sound",
      "Nested text",
    ]);
  });

  it("returns a formatter repair target for a blocking page-local visual finding", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const run = vi.fn<CodexClient["run"]>().mockResolvedValue(JSON.stringify({
      ok: false,
      findings: [{
        page: 1,
        severity: "error",
        code: "overlapping-blocks",
        message: "Two body blocks visibly overlap.",
        repairTarget: "formatter",
      }],
    }));
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      prompt: "test",
    }), { run });

    const result = await node(moodleTestState({
      final_document: "#set page()\n= Rendered page\n\nVisible body text.\n",
    }));

    expect(result.error_log).toMatch(
      /PDF post-render review failed; repair target: formatter[\s\S]*\[page 1\] overlapping-blocks/,
    );
    await expect(
      readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8"),
    ).resolves.toContain('"modelReview": "failed"');
  });

  it("keeps deterministic approval usable while transparently recording an unavailable image reviewer", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const run = vi.fn<CodexClient["run"]>().mockRejectedValue(new Error("temporary visual capacity outage"));
    const node = createDiskWriterNode(moodleTestConfig({
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      prompt: "test",
    }), { run });

    const result = await node(moodleTestState({
      final_document: "#set page()\n= Rendered page\n\nVisible body text.\n",
    }));

    expect(result.error_log).toBeNull();
    const review = JSON.parse(
      await readFile(path.join(runDir, "pdf-post-render-review.json"), "utf8"),
    ) as { ok: boolean; modelReview: string; findings: Array<{ code: string; severity: string }> };
    expect(review).toMatchObject({ ok: true, modelReview: "unavailable" });
    expect(review.findings).toContainEqual(expect.objectContaining({
      code: "visual-model-review-unavailable",
      severity: "warning",
    }));
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
