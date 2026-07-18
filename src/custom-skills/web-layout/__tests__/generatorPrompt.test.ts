import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { buildGeneratorPrompt, createGeneratorNode } from "../nodes/generatorNode.js";
import { initialWebLayoutState } from "../state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generator prompt", () => {
  it("contains Study Buddy design tokens and single-file rules", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-prompt-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build flashcards",
      kind: "flashcards",
      runDir,
    });
    const prompt = buildGeneratorPrompt(config, {
      source_text: "source",
      layout_spec: { title: "Demo" },
      html_document: "",
      validation_report: {},
      error_log: null,
    });

    expect(prompt).toContain("--sb-navy: #19254b");
    expect(prompt).toContain("--sb-gold: #dfbb63");
    expect(prompt).toContain("No <script src>");
    expect(prompt).toContain("assets/logo.png");
    expect(prompt).toContain("Do not display legacy prototype marks");
    expect(prompt).toContain("one coherent primary learning interaction");
    expect(prompt).toContain("do not build citations or source-management controls");
    expect(prompt).toContain("not from a broad subject label");
    expect(prompt).toContain("Rules, policy, business, and economics");
    expect(prompt).toContain("Biomedical or medical material");
    expect(prompt).toContain("flashcards may be primary only when higher-order application is not supported");
    expect(prompt).toContain("Never award exam credit for unrestricted free text");
    expect(prompt).toContain("native semantic MathML");
    expect(prompt).toContain("never expose raw TeX, Typst, or ASCII approximations");
  });

  it("defines a coherent integrated study-guide mode", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-study-guide-prompt-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a complete mathematics study guide",
      kind: "study-guide",
      runDir,
    });
    const prompt = buildGeneratorPrompt(config, {
      source_text: "source",
      layout_spec: { title: "Mathematics" },
      html_document: "",
      validation_report: {},
      error_log: null,
    });

    expect(prompt).toContain("course-dependent study guide, not a quiz dashboard");
    expect(prompt).toContain("data-sb-learning-content");
    expect(prompt).toContain("data-sb-practice");
    expect(prompt).toContain("data-sb-progress");
    expect(prompt).toContain("sticky top hotbar marked data-sb-hotbar");
    expect(prompt).toContain("data-sb-cross-exercise");
    expect(prompt).toContain("data-sb-calculation-exercise");
    expect(prompt).toContain("Do not use a persistent left sidebar");
    expect(prompt).not.toContain("Implement one coherent primary learning interaction");
  });

  it("uses a staged file for repairs instead of placing the complete HTML in the prompt", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-repair-prompt-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Repair the guide",
      kind: "worksheet",
      runDir,
    });
    const prompt = buildGeneratorPrompt(config, {
      source_text: "source",
      layout_spec: { title: "Guide" },
      html_document: '<!doctype html><img src="data:image/png;base64,QUJDREVGRw=="><script>function keepMe(){}</script>',
      validation_report: { ok: false },
      error_log: "Answer persistence is broken.",
    });

    expect(prompt).toContain(".repair/document.html");
    expect(prompt).toContain("edit only .repair/document.html");
    expect(prompt).not.toContain("function keepMe(){}");
    expect(prompt).not.toContain("QUJDREVGRw==");
  });

  it("rejects a status message when the staged repair artifact was not modified", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-incomplete-response-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Repair the guide", kind: "worksheet", runDir });
    const result = await createGeneratorNode(config, {
      run: async () => "I updated the requested files and the guide is ready.",
    })({
      ...initialWebLayoutState,
      html_document: "<!doctype html><html><head><style></style></head><body><script></script></body></html>",
      error_log: "Repair one interaction.",
    });

    expect(result.html_document).toBeUndefined();
    expect(result.error_log).toContain("did not modify the staged repair artifact");
    expect(result.generator_retry_count).toBe(1);
  });

  it("loads a complete in-place repair without requiring the model to emit the full document", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-staged-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Repair the guide", kind: "worksheet", runDir });
    const original = "<!doctype html><html><head><style></style></head><body><main>Old</main><script></script></body></html>";
    const repaired = original.replace("Old", "Repaired");
    const result = await createGeneratorNode(config, {
      run: async () => {
        await writeFile(path.join(runDir, ".repair", "document.html"), repaired, "utf8");
        return "UPDATED_DOCUMENT_HTML";
      },
    })({
      ...initialWebLayoutState,
      html_document: original,
      error_log: "Repair the visible heading.",
    });

    expect(result.error_log).toBeNull();
    expect(result.html_document).toContain("Repaired");
    await expect(readFile(path.join(runDir, ".repair", "document.html"), "utf8")).resolves.toBe(repaired);
  });
});
