import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexClient } from "../codexClient.js";
import { minimalValidStudyBuddyHtml } from "../htmlShell.js";
import { createGeneratorNode } from "../nodes/generatorNode.js";
import { initialWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("targeted artifact repair", () => {
  it("tries the bounded deterministic responsive repair before a model call", async () => {
    const runDir = await temporaryDirectory();
    let modelCalls = 0;
    const node = createGeneratorNode(config(runDir), {
      async run() {
        modelCalls += 1;
        throw new Error("must not run");
      },
    });
    const result = await node({
      ...initialWebLayoutState,
      html_document: minimalValidStudyBuddyHtml({
        title: "Guide",
        kind: "study-guide",
        language: "de",
      }),
      error_log: "HTML validation failed: horizontal overflow",
      validation_report: {
        ok: false,
        issues: [{ code: "horizontal-overflow", message: "28px overflow" }],
      },
    });

    expect(modelCalls).toBe(0);
    expect(result.error_log).toBeNull();
    expect(result.artifact_repair_stage).toBe(1);
    expect(result.html_document).toContain('data-sb-repair="responsive-targeted-v1"');
  });

  it("routes a semantic repair to the isolated artifact_repair role", async () => {
    const runDir = await temporaryDirectory();
    const tasks: string[] = [];
    const codex: CodexClient = {
      async run(_prompt, options) {
        tasks.push(options.task);
        const repairPath = path.join(runDir, ".repair", "document.html");
        const html = await readFile(repairPath, "utf8");
        await writeFile(repairPath, html.replace("Guide", "Repaired Guide"), "utf8");
        return "UPDATED_DOCUMENT_HTML";
      },
    };
    const node = createGeneratorNode(config(runDir), codex);
    const result = await node({
      ...initialWebLayoutState,
      html_document: minimalValidStudyBuddyHtml({
        title: "Guide",
        kind: "study-guide",
        language: "de",
      }),
      error_log: "Semantic quality review failed: preserve answers",
      validation_report: { ok: true, issues: [] },
    });

    expect(tasks).toEqual(["artifact_repair"]);
    expect(result.error_log).toBeNull();
    expect(result.artifact_repair_stage).toBe(2);
    expect(result.html_document).toContain("Repaired Guide");
  });

  it("repairs native-provider HTML with bounded text edits and no file tools", async () => {
    for (const [key, value] of Object.entries({
      URL: "http://127.0.0.1:12345/api/study-buddy/model",
      TOKEN: "fixture",
      PROVIDER: "antigravity",
      MODEL: "gemini-test",
      THREAD: "owner",
    }))
      vi.stubEnv(`STUDY_BUDDY_MODEL_BRIDGE_${key}`, value);
    const runDir = await temporaryDirectory();
    const node = createGeneratorNode(config(runDir), {
      async run(prompt, options) {
        expect(options.task).toBe("artifact_repair");
        expect(options.outputSchema).toBeDefined();
        expect(prompt).not.toContain("Use your file tools");
        return JSON.stringify({
          edits: [{ before: "<title>Guide</title>", after: "<title>Repaired Guide</title>" }],
        });
      },
    });
    const result = await node({
      ...initialWebLayoutState,
      html_document: minimalValidStudyBuddyHtml({
        title: "Guide",
        kind: "study-guide",
        language: "de",
      }),
      error_log: "Semantic quality review failed: improve title",
      validation_report: { ok: true, issues: [] },
    });
    expect(result.error_log).toBeNull();
    expect(result.html_document).toContain("<title>Repaired Guide</title>");
  });

  it("uses the generator-local retry count for model escalation", async () => {
    const runDir = await temporaryDirectory();
    const attempts: number[] = [];
    const codex: CodexClient = {
      async run(_prompt, options) {
        attempts.push(options.attempt ?? -1);
        const repairPath = path.join(runDir, ".repair", "document.html");
        const html = await readFile(repairPath, "utf8");
        await writeFile(repairPath, html.replace("Guide", "Repaired Guide"), "utf8");
        return "UPDATED_DOCUMENT_HTML";
      },
    };
    const node = createGeneratorNode(config(runDir), codex);
    await node({
      ...initialWebLayoutState,
      retry_count: 6,
      validator_retry_count: 3,
      generator_retry_count: 0,
      html_document: minimalValidStudyBuddyHtml({
        title: "Guide",
        kind: "study-guide",
        language: "de",
      }),
      error_log: "Semantic quality review failed: preserve answers",
      validation_report: { ok: true, issues: [] },
    });

    expect(attempts).toEqual([1]);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "study-buddy-artifact-repair-"));
  tempDirs.push(directory);
  return directory;
}

function config(runDir: string): WebLayoutRuntimeConfig {
  return {
    prompt: "Repair guide",
    originalUserPrompt: "Repair guide",
    kind: "study-guide",
    requestName: "repair-guide",
    runDir,
    outputPath: path.join(runDir, "document.html"),
    sourceFiles: [],
    assetFiles: [],
    sourceMode: "prompt",
    language: "de",
    maxRuntimeMs: 60_000,
    idleTimeoutMs: 60_000,
    browserHeaded: false,
    skipBrowserValidation: true,
    maxArtifactBytes: 100_000_000,
    maxImageWidth: 2_000,
    webpQuality: 84,
    executionProfile: "balanced",
  };
}
