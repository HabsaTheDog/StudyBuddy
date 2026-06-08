import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildExtractionGraph, buildMoodleGraph, runMoodleGraph } from "../graph.js";
import { initialSourceCoverage, RunDiagnostics } from "../runDiagnostics.js";
import { initialAgentState } from "../state.js";
import {
  moodleExtractedData,
  moodleTestConfig,
  sequenceCodex,
  studyBuddyTypstDocument,
} from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("moodle graph retry routing", () => {
  it("retries invalid analyzer JSON and then writes Typst", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const outputPath = path.join(runDir, "document.typ");
    const codex = sequenceCodex([
      "not json",
      JSON.stringify(moodleExtractedData()),
      studyBuddyTypstDocument(),
    ]);

    const graph = buildMoodleGraph(
      moodleTestConfig({
        outputPath,
        runDir,
        prompt: "make notes",
      }),
      { codex },
    );

    const result = await graph.invoke({ ...initialAgentState, moodle_raw_text: "local fixture text" });
    expect(result.error_log).toBeNull();
    expect(result.retry_count).toBe(1);
    await expect(readFile(outputPath, "utf8")).resolves.toContain("DYN2");
  });

  it("aborts before the analyzer when required Moodle authentication failed", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    let codexCalls = 0;
    const config = moodleTestConfig({
      runDir,
      outputPath: path.join(runDir, "document.typ"),
      diagnostics,
    });

    const graph = buildMoodleGraph(config, {
      codex: {
        async run() {
          codexCalls += 1;
          return "{}";
        },
      },
      scraperNode: async () => {
        await diagnostics.markFailure("moodle", {
          detail: "Moodle login did not complete.",
          attemptedUrls: [config.moodleUrl],
          failureKind: "auth",
        });
        return {
          moodle_raw_text: "[Moodle warning]\nAuthentication failed.",
          error_log: null,
        };
      },
      cisScraperNode: async (state) => ({
        moodle_raw_text: state.moodle_raw_text,
        error_log: null,
      }),
    });

    const result = await graph.invoke(initialAgentState);

    expect(result.error_log).toContain("Required Moodle source failed (failed_auth)");
    expect(codexCalls).toBe(0);
  });

  it("rejects a DC-DC document when the source file was not downloaded", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    let codexCalls = 0;
    const config = moodleTestConfig({
      runDir,
      outputPath: path.join(runDir, "document.typ"),
      prompt: "Erstelle ein DC-DC-Wandler Lern-PDF",
      diagnostics,
    });

    const graph = buildMoodleGraph(config, {
      codex: {
        async run() {
          codexCalls += 1;
          return "{}";
        },
      },
      scraperNode: async () => {
        await diagnostics.markSuccess("moodle", {
          detail: "Tiefsetzsteller page opened.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return {
          moodle_raw_text: "Versuch 5: Tiefsetzsteller",
          error_log: null,
        };
      },
      cisScraperNode: async (state) => ({
        moodle_raw_text: state.moodle_raw_text,
        error_log: null,
      }),
    });

    const result = await graph.invoke(initialAgentState);

    expect(result.error_log).toContain("no readable Moodle file was downloaded");
    expect(codexCalls).toBe(0);
  });

  it("finishes extraction with validated data and without creating a document", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-extract-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      outputPath: path.join(runDir, "document.typ"),
      stage: "extract",
      diagnostics,
    });
    const graph = buildExtractionGraph(config, {
      codex: sequenceCodex([JSON.stringify(moodleExtractedData())]),
      scraperNode: async () => {
        await diagnostics.markSuccess("moodle", {
          detail: "Course extracted.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return {
          moodle_raw_text: "Relevant course source",
          error_log: null,
        };
      },
      cisScraperNode: async (state) => ({
        moodle_raw_text: state.moodle_raw_text,
        error_log: null,
      }),
    });

    const result = await graph.invoke(initialAgentState);

    expect(result.error_log).toBeNull();
    expect(result.final_document).toBe("");
    await expect(readFile(path.join(runDir, "extracted-data.json"), "utf8")).resolves.toContain("DYN2");
  });

  it("renders from a successful extraction handoff without running scrapers", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-staged-"));
    const extractionDir = path.join(runDir, "extraction");
    const renderDir = path.join(runDir, "render");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(extractionDir, { recursive: true }));
    await Promise.all([
      writeFile(path.join(extractionDir, "run-summary.md"), "Run status: success\n", "utf8"),
      writeFile(path.join(extractionDir, "error.log"), "", "utf8"),
      writeFile(path.join(extractionDir, "moodle_raw.txt"), "Validated source bundle", "utf8"),
      writeFile(
        path.join(extractionDir, "extracted-data.json"),
        `${JSON.stringify(moodleExtractedData())}\n`,
        "utf8",
      ),
      writeFile(
        path.join(extractionDir, "source_coverage.json"),
        `${JSON.stringify({
          ...initialSourceCoverage,
          moodle: {
            ...initialSourceCoverage.moodle,
            status: "success",
            detail: "Extraction complete.",
            urls: ["https://moodle.example/course"],
            pages: 1,
          },
        })}\n`,
        "utf8",
      ),
    ]);

    let scraperCalls = 0;
    const result = await runMoodleGraph(
      {
        prompt: "make notes",
        moodleUrl: "https://moodle.example/course",
        runDir: renderDir,
        stage: "render",
        sourceRunDir: extractionDir,
      },
      {
        scraperNode: async () => {
          scraperCalls += 1;
          return {};
        },
        cisScraperNode: async () => {
          scraperCalls += 1;
          return {};
        },
        codex: sequenceCodex([studyBuddyTypstDocument()]),
      },
    );

    expect(result.ok).toBe(true);
    expect(scraperCalls).toBe(0);
    await expect(readFile(path.join(renderDir, "document.pdf"))).resolves.not.toHaveLength(0);
  }, 20_000);

  it("terminates a stalled graph at the configured hard runtime", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));

    const result = await runMoodleGraph(
      {
        prompt: "make notes",
        moodleUrl: "https://moodle.example/course",
        runDir,
        maxRuntimeMs: 50,
        idleTimeoutMs: 5_000,
      },
      {
        scraperNode: async () => new Promise<never>(() => undefined),
        cisScraperNode: async () => ({}),
        codex: sequenceCodex([]),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Study Buddy run timed out after 50ms");
  }, 10_000);
});
