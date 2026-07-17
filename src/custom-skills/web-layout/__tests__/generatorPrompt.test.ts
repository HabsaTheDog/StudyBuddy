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
  });
});
