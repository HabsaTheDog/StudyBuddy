import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { createQualityReviewerNode } from "../nodes/qualityReviewerNode.js";

const tempDirs: string[] = [];
const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;

afterEach(async () => {
  if (previousWorkspace === undefined) delete process.env.STUDY_BUDDY_WORKSPACE;
  else process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout semantic quality input", () => {
  it("reviews the bundled delivery artifact rather than local source references", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-quality-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Review the offline guide",
      kind: "study-guide",
      requestName: "bundled-review-test",
      skipBrowserValidation: true,
    });
    await mkdir(path.join(config.runDir, ".build"), { recursive: true });
    await writeFile(
      path.join(config.runDir, ".build", "document.html"),
      '<!doctype html><html><body><img src="data:image/webp;base64,AAAA" alt="Study Buddy"></body></html>',
      "utf8",
    );
    let receivedPrompt = "";
    const codex = {
      run: async (prompt: string) => {
        receivedPrompt = prompt;
        return JSON.stringify({ ok: true, summary: "ok", findings: [] });
      },
    };

    await createQualityReviewerNode(config, codex)({
      source_text: "source",
      html_document: '<!doctype html><img src="assets/logo.png">',
      validation_report: {},
      retry_count: 0,
      quality_retry_count: 0,
    } as never);

    expect(receivedPrompt).toContain("data:image/webp;base64,[embedded binary omitted: 4 chars]");
    expect(receivedPrompt).not.toContain('src="assets/logo.png"');
    expect(receivedPrompt).toContain("necessarily still marked running");
    expect(receivedPrompt).toContain("Do not inspect or reject run-summary.md");
    expect(receivedPrompt).toContain("Reject a study guide that uses a persistent left sidebar");
    expect(receivedPrompt).toContain("source-authentic selection types");
  });

  it("ignores self-referential run-status findings while preserving real HTML findings", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-quality-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Review the offline guide",
      requestName: "orchestration-finding-test",
      skipBrowserValidation: true,
    });
    await mkdir(path.join(config.runDir, ".build"), { recursive: true });
    await writeFile(
      path.join(config.runDir, ".build", "document.html"),
      "<!doctype html><html><body>Guide</body></html>",
      "utf8",
    );
    const codex = {
      run: async () => JSON.stringify({
        ok: false,
        summary: "Two findings",
        findings: [
          "run-summary.md still says Run status: running and error.log is missing.",
          "The answer feedback reveals the solution before submission.",
        ],
      }),
    };

    const result = await createQualityReviewerNode(config, codex)({
      source_text: "source",
      html_document: "<!doctype html><html><body>Guide</body></html>",
      validation_report: {},
      retry_count: 0,
      quality_retry_count: 0,
    } as never);

    expect(result.error_log).toContain("reveals the solution");
    expect(result.error_log).not.toContain("run-summary.md");
    expect(result.quality_retry_count).toBe(1);
  });
});
