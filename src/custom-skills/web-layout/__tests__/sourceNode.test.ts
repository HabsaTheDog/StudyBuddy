import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { createSourceNode } from "../nodes/sourceNode.js";

const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
const tempDirs: string[] = [];

afterEach(async () => {
  process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout source node", () => {
  it("ingests UTF-8 source files with file headers", async () => {
    const workspace = await tempWorkspace();
    const sourceFile = path.join(workspace, "notes.md");
    await writeFile(sourceFile, "Buck converter notes", "utf8");
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build flashcards",
      sourceFiles: [sourceFile],
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toBeNull();
    expect(result.source_text).toContain("# Source file:");
    expect(result.source_text).toContain("Buck converter notes");
  });

  it("ingests a successful Moodle extraction handoff", async () => {
    const workspace = await tempWorkspace();
    const handoff = path.join(workspace, "handoff");
    await writeSuccessfulHandoff(handoff);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build visualization",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toBeNull();
    expect(result.source_text).toContain("Moodle extraction handoff");
    expect(result.source_text).toContain("moodle text");
  });

  it("rejects a failed Moodle extraction handoff", async () => {
    const workspace = await tempWorkspace();
    const handoff = path.join(workspace, "failed-handoff");
    await writeSuccessfulHandoff(handoff);
    await writeFile(path.join(handoff, "run-summary.md"), "Run status: failed\n", "utf8");
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build visualization",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toContain("not a successful extraction run");
  });
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-source-"));
  tempDirs.push(workspace);
  process.env.STUDY_BUDDY_WORKSPACE = workspace;
  return workspace;
}

async function writeSuccessfulHandoff(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, "run-summary.md"), "Run status: success\n", "utf8"),
    writeFile(path.join(dir, "error.log"), "", "utf8"),
    writeFile(path.join(dir, "moodle_raw.txt"), "moodle text", "utf8"),
    writeFile(path.join(dir, "extracted-data.json"), "{\"document_title\":\"Test\"}\n", "utf8"),
    writeFile(path.join(dir, "source_coverage.json"), "{\"moodle\":{\"status\":\"success\"}}\n", "utf8"),
  ]);
}
