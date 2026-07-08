import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";

const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
const previousCodexModel = process.env.STUDY_BUDDY_CODEX_MODEL;
const tempDirs: string[] = [];

afterEach(async () => {
  restoreOptionalEnv("STUDY_BUDDY_WORKSPACE", previousWorkspace);
  restoreOptionalEnv("STUDY_BUDDY_CODEX_MODEL", previousCodexModel);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout config", () => {
  it("creates a request-specific timestamped run directory", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;

    const config = createWebLayoutRuntimeConfig({
      prompt: "Erstelle Flashcards zu Buck Boost",
      kind: "flashcards",
      requestName: "buck-boost-flashcards",
    });

    expect(config.runDir).toContain(path.join("output", "buck-boost-flashcards"));
    expect(config.outputPath).toBe(path.join(config.runDir, "document.html"));
    expect(config.sourceMode).toBe("prompt");
  });

  it("uses an explicit Codex model over the inherited Study Buddy model", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    process.env.STUDY_BUDDY_CODEX_MODEL = "gpt-env";

    const config = createWebLayoutRuntimeConfig({
      prompt: "Erstelle Flashcards zu Buck Boost",
      codexModel: "gpt-selected",
    });

    expect(config.codexModel).toBe("gpt-selected");
  });
});

function restoreOptionalEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
