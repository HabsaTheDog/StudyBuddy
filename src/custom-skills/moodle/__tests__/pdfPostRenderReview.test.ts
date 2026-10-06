import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexClient } from "../codexClient.js";
import { pdfPostRenderRepairMessage, reviewRenderedPdf } from "../pdfPostRenderReview.js";
import { compileTypstPdf } from "../validation.js";
import { runBoundedProcess } from "../../shared/boundedProcess.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture(intentional: boolean) {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "pdf-divider-review-"));
  directories.push(runDir);
  const source = [
    '#set page(header: [Study document], footer: [Recurring footer], width: 210mm, height: 297mm)',
    "= Introduction", "A useful body paragraph starts the document.", "#pagebreak()",
    intentional ? '#align(center + horizon)[#text(30pt)[Part Two]\n\nApplications]' : '#text(8pt)[Applications]',
    "#pagebreak()", "= Exercises", "The application content begins here.",
  ].join("\n\n");
  const sourcePath = path.join(runDir, "document.typ");
  const pdfPath = path.join(runDir, "document.pdf");
  await writeFile(sourcePath, source);
  expect(await compileTypstPdf(sourcePath, pdfPath)).toEqual({ ok: true, skipped: false });
  const info = await runBoundedProcess("pdfinfo", [pdfPath]);
  expect(info.code, info.stderr).toBe(0);
  expect(info.stdout).toMatch(/^Pages:\s+3\s*$/m);
  return { runDir, pdfPath };
}

describe.each([false, true])("PDF post-render divider review contract (montage unavailable: %s)", (withoutMontage) => {
  const processRunner: typeof runBoundedProcess = (command, args, options) =>
    command === "magick" && withoutMontage
      ? Promise.resolve({ code: 127, stdout: "", stderr: "ImageMagick is unavailable" })
      : runBoundedProcess(command, args, options);
  it("makes an accidental divider-only intermediate page blocking through the existing formatter repair", async () => {
    const input = await fixture(false);
    const run = vi.fn<CodexClient["run"]>().mockResolvedValue(JSON.stringify({ ok: false, findings: [{
      page: 2, severity: "error", code: "orphaned-section-divider",
      message: "Page 2 strands only the application divider; its content begins on page 3. Keep the divider with its following content.", repairTarget: "formatter",
    }] }));
    const review = await reviewRenderedPdf({ ...input, codex: { run }, processRunner });
    const prompt = run.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("unintentional heading/divider-only intermediate page");
    expect(prompt).toContain("recurring headers and footers");
    expect(prompt).toContain("consecutive physical page labels are supplied");
    expect(prompt).toContain("Keep the heading/divider with its following content");
    expect(review).toMatchObject({ ok: false, modelReview: "failed", modelReviewedPages: [1, 2, 3] });
    expect(pdfPostRenderRepairMessage(review)).toContain("[page 2] orphaned-section-divider");
    for (const call of run.mock.calls) expect(call[1]?.localImages?.length).toBeLessThanOrEqual(2);
    if (withoutMontage) {
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1][0]).toContain("Visible page labels in this batch: 2, 3.");
    }
  }, 30_000);

  it("preserves a clearly designed section opener without deterministic sparse-page rejection", async () => {
    const input = await fixture(true);
    const run = vi.fn<CodexClient["run"]>().mockResolvedValue(JSON.stringify({ ok: true, findings: [] }));
    const review = await reviewRenderedPdf({ ...input, codex: { run }, processRunner });
    expect(run.mock.calls[0]?.[0]).toContain("intentional cover or clearly designed standalone section opener");
    expect(run.mock.calls[0]?.[0]).toContain("Ordinary whitespace and short content are not sufficient evidence");
    expect(review).toMatchObject({ ok: true, modelReview: "passed", modelReviewedPages: [1, 2, 3], findings: [] });
  }, 30_000);
});
