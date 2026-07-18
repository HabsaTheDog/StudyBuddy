import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  it("follows the user prompt language by default", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-language-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;

    expect(createWebLayoutRuntimeConfig({ prompt: "Create interactive flashcards" }).language).toBe("en");
    expect(createWebLayoutRuntimeConfig({ prompt: "Erstelle interaktive Lernkarten" }).language).toBe("de");
    expect(createWebLayoutRuntimeConfig({ prompt: "Create flashcards", language: "de" }).language).toBe("de");
  });

  it("accepts the integrated study-guide kind", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;

    const config = createWebLayoutRuntimeConfig({
      prompt: "Erstelle einen vollständigen Study Guide",
      kind: "study-guide",
    });

    expect(config.kind).toBe("study-guide");
  });

  it("creates a request-specific timestamped run directory", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;

    const config = createWebLayoutRuntimeConfig({
      prompt: "Erstelle Flashcards zu Buck Boost",
      kind: "flashcards",
      requestName: "buck-boost-flashcards",
    });

    expect(config.runDir).toContain(
      path.join("study-buddy-data", "runs", "buck-boost-flashcards"),
    );
    expect(config.outputPath).toBe(path.join(config.runDir, "document.html"));
    expect(config.sourceMode).toBe("prompt");
    expect(config.maxRuntimeMs).toBe(20 * 60_000);
    expect(config.maxArtifactBytes).toBe(100_000_000);
  });

  it("rejects artifact ceilings above the 250 MB absolute limit", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;

    expect(() => createWebLayoutRuntimeConfig({
      prompt: "Erstelle Flashcards",
      maxArtifactBytes: 250_000_001,
    })).toThrow("maxArtifactBytes");
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

  it("resolves a resume run directory inside the workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;

    const config = createWebLayoutRuntimeConfig({
      prompt: "Setze den Lauf fort",
      resumeRunDir: "output/previous/run",
    });

    expect(config.resumeRunDir).toBe(path.join(workspace, "output", "previous", "run"));
  });

  it("inherits the Moodle handoff through a resume chain", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const extraction = path.join(workspace, "output", "moodle", "extraction");
    const firstRun = path.join(workspace, "output", "first", "run");
    const secondRun = path.join(workspace, "output", "second", "run");
    await Promise.all([
      mkdir(extraction, { recursive: true }),
      mkdir(firstRun, { recursive: true }),
      mkdir(secondRun, { recursive: true }),
    ]);
    await writeFile(
      path.join(firstRun, "config.json"),
      JSON.stringify({ sourceRunDir: extraction, resumeRunDir: null }),
      "utf8",
    );
    await writeFile(
      path.join(secondRun, "config.json"),
      JSON.stringify({ sourceRunDir: null, resumeRunDir: firstRun }),
      "utf8",
    );

    const config = createWebLayoutRuntimeConfig({
      prompt: "Setze den Moodle-Lauf fort",
      resumeRunDir: secondRun,
    });

    expect(config.sourceRunDir).toBe(extraction);
    expect(config.sourceMode).toBe("moodle-handoff");
  });

  it("stops safely on a cyclic resume chain", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-config-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const cycleRun = path.join(workspace, "output", "cycle", "run");
    await mkdir(cycleRun, { recursive: true });
    await writeFile(
      path.join(cycleRun, "config.json"),
      JSON.stringify({ sourceRunDir: null, resumeRunDir: cycleRun }),
      "utf8",
    );

    const config = createWebLayoutRuntimeConfig({
      prompt: "Setze den Lauf fort",
      resumeRunDir: cycleRun,
    });

    expect(config.sourceRunDir).toBeUndefined();
    expect(config.sourceMode).toBe("prompt");
  });
});

function restoreOptionalEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
