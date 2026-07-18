import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { buildGeneratorPrompt } from "../nodes/generatorNode.js";

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
  });

  it("includes compact existing HTML during a repair without embedded binary payloads", async () => {
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

    expect(prompt).toContain("Existing complete HTML to repair");
    expect(prompt).toContain("function keepMe(){}");
    expect(prompt).toContain("embedded binary omitted");
    expect(prompt).not.toContain("QUJDREVGRw==");
  });
});
