import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { createSourceNode } from "../nodes/sourceNode.js";
import {
  createRequestContractIntegrity,
  minimalRequestContract,
} from "../../shared/requestContract.js";

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
    await writeSuccessfulHandoff(handoff, "Build visualization");
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build visualization",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toBeNull();
    expect(result.source_text).toContain("Moodle extraction handoff");
    expect(result.source_text).toContain("moodle text");
  });

  it("adds bounded extracted quizzes and exercises as a full practice corpus", async () => {
    const workspace = await tempWorkspace();
    const handoff = path.join(workspace, "practice-handoff");
    await writeSuccessfulHandoff(handoff, "Build a mathematics study guide");
    await mkdir(path.join(handoff, "sources"), { recursive: true });
    await Promise.all([
      writeFile(path.join(handoff, "sources", "Minitest-1.extracted.txt"), "1. Multiple Choice: exact exercise", "utf8"),
      writeFile(path.join(handoff, "sources", "Lecture-Script.extracted.txt"), "large theory excerpt", "utf8"),
    ]);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a mathematics study guide",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toBeNull();
    expect(result.source_text).toContain("## Full extracted practice corpus");
    expect(result.source_text).toContain("1. Multiple Choice: exact exercise");
    expect(result.source_text).not.toContain("large theory excerpt");
  });

  it("summarizes large evidence packages instead of overflowing the model prompt", async () => {
    const workspace = await tempWorkspace();
    const handoff = path.join(workspace, "large-evidence-handoff");
    await writeSuccessfulHandoff(handoff, "Build a MAES study guide");
    const repeatedDetail = "evidence-detail-that-must-not-be-copied ".repeat(20);
    await writeFile(path.join(handoff, "evidence-package.json"), JSON.stringify({
      records: Array.from({ length: 2_000 }, (_, index) => ({
        kind: index % 2 === 0 ? "claim" : "exercise",
        resourceId: `resource-${index % 12}`,
        content: repeatedDetail,
      })),
      warnings: ["one warning"],
    }), "utf8");
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a MAES study guide",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toBeNull();
    expect(result.source_text).toContain('"recordCount": 2000');
    expect(result.source_text).toContain('"claim": 1000');
    expect(result.source_text).not.toContain(repeatedDetail.trim());
    expect(result.source_text?.length).toBeLessThan(100_000);
  });

  it("rejects a failed Moodle extraction handoff", async () => {
    const workspace = await tempWorkspace();
    const handoff = path.join(workspace, "failed-handoff");
    await writeSuccessfulHandoff(handoff, "Build visualization");
    await writeFile(path.join(handoff, "run-summary.md"), "Run status: failed\n", "utf8");
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build visualization",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toContain("not a successful extraction run");
  });

  it("rejects a Moodle handoff whose evaluated request contract was changed", async () => {
    const workspace = await tempWorkspace();
    const handoff = path.join(workspace, "tampered-contract-handoff");
    await writeSuccessfulHandoff(handoff, "Build visualization");
    const tampered = minimalRequestContract("A different request", ["study-guide"]);
    await writeFile(
      path.join(handoff, "request-contract.json"),
      `${JSON.stringify(tampered, null, 2)}\n`,
      "utf8",
    );
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build visualization",
      sourceRunDir: handoff,
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toContain("integrity mismatch");
  });

  it("rejects an explicitly Moodle-derived prompt without an extraction handoff", async () => {
    await tempWorkspace();
    const config = createWebLayoutRuntimeConfig({
      prompt: "Use my Moodle math course materials to build an interactive exam guide",
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toContain("require a successful extraction handoff");
    expect(result.error_log).toContain("--source-run-dir");
  });

  it("rejects oversized source files before loading them into the model context", async () => {
    const workspace = await tempWorkspace();
    const sourceFile = path.join(workspace, "oversized.txt");
    await writeFile(sourceFile, Buffer.alloc(10 * 1024 * 1024 + 1, 65));
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a reference",
      sourceFiles: [sourceFile],
    });

    const result = await createSourceNode(config)();

    expect(result.error_log).toContain("10 MiB safety limit");
  });
});

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-source-"));
  tempDirs.push(workspace);
  process.env.STUDY_BUDDY_WORKSPACE = workspace;
  return workspace;
}

async function writeSuccessfulHandoff(dir: string, originalPrompt: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const requestContract = minimalRequestContract(originalPrompt, ["study-guide"]);
  await Promise.all([
    writeFile(path.join(dir, "run-summary.md"), "Run status: success\n", "utf8"),
    writeFile(path.join(dir, "error.log"), "", "utf8"),
    writeFile(path.join(dir, "moodle_raw.txt"), "moodle text", "utf8"),
    writeFile(path.join(dir, "extracted-data.json"), "{\"document_title\":\"Test\"}\n", "utf8"),
    writeFile(path.join(dir, "source_coverage.json"), "{\"moodle\":{\"status\":\"success\"}}\n", "utf8"),
    writeFile(path.join(dir, "request-contract.json"), `${JSON.stringify(requestContract, null, 2)}\n`, "utf8"),
    writeFile(
      path.join(dir, "request-contract-integrity.json"),
      `${JSON.stringify(createRequestContractIntegrity(requestContract), null, 2)}\n`,
      "utf8",
    ),
  ]);
}
