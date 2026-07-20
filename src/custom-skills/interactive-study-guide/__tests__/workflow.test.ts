import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireInteractiveWorkflowAdmission, runInteractiveStudyGuideWorkflow } from "../workflow.js";

async function validHandoff(runDir: string): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "run-summary.md"), "Run status: partial\n", "utf8");
  await writeFile(path.join(runDir, "error.log"), "", "utf8");
  await writeFile(path.join(runDir, "moodle_raw.txt"), "evidence", "utf8");
  await writeFile(path.join(runDir, "extracted-data.json"), "{}", "utf8");
  await writeFile(path.join(runDir, "source_coverage.json"), "{}", "utf8");
}

describe("interactive Study Guide workflow", () => {
  it("does not serialize independent workflows unless a throttle is configured", async () => {
    const releases = await Promise.all(Array.from({ length: 6 }, () =>
      acquireInteractiveWorkflowAdmission({ concurrency: 0 })
    ));
    expect(releases).toHaveLength(6);
    await Promise.all(releases.map((release) => release()));
  });

  it("fails before extraction when the run directory and resolved workspace disagree", async () => {
    const outsideDataRoot = path.join(
      process.cwd(),
      "output",
      "test-quick-chat",
      "study-buddy-data",
      "runs",
      `${Date.now()}`,
    );
    let extractionCalled = false;

    await expect(runInteractiveStudyGuideWorkflow({ prompt: "Study Guide MEL", runDir: outsideDataRoot }, {
      runExtraction: async () => {
        extractionCalled = true;
        throw new Error("must not extract");
      },
    })).rejects.toThrow("Check STUDY_BUDDY_WORKSPACE propagation");
    expect(extractionCalled).toBe(false);
  });

  it("renders only after a validated extraction and preserves the exact prompt", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-workflow", `${Date.now()}`);
    const calls: string[] = [];
    const result = await runInteractiveStudyGuideWorkflow({ prompt: "Erstelle einen interaktiven Study Guide für MEL", runDir: root }, {
      runExtraction: async (input) => {
        calls.push(`extract:${input.prompt}`);
        expect(input.evidenceHandoffOnly).toBe(true);
        expect(input.visualMode).toBe("off");
        expect(input.executionProfile).toBe("balanced");
        await validHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        calls.push(`web:${input.prompt}`);
        expect(input.executionProfile).toBe("balanced");
        expect(input.sourceRunDir).toBe(path.join(root, "extraction"));
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>MEL</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async ({ sourcePaths }) => [{ sourcePath: sourcePaths[0]!, publishedPath: "/tmp/mel.html", bytes: 32, sha256: "test" }],
    });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "extract:Erstelle einen interaktiven Study Guide für MEL",
      "web:Erstelle einen interaktiven Study Guide für MEL",
    ]);
  });

  it("forwards the quality profile through extraction and web rendering", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-quality-profile", `${Date.now()}`);
    const profiles: string[] = [];
    const result = await runInteractiveStudyGuideWorkflow({ prompt: "Study Guide MEL", runDir: root, executionProfile: "quality" }, {
      runExtraction: async (input) => {
        profiles.push(`extract:${input.executionProfile}`);
        await validHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        profiles.push(`web:${input.executionProfile}`);
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>MEL quality</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async () => [],
    });

    expect(result.ok).toBe(true);
    expect(profiles).toEqual(["extract:quality", "web:quality"]);
  });

  it("preserves a validated HTML artifact when publication fails", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-publish-failure", `${Date.now()}`);
    const extractionRunDir = path.join(root, "extraction");
    const webLayoutRunDir = path.join(root, "web-layout");
    const outputPath = path.join(webLayoutRunDir, "document.html");
    const publicationError = "Canonical deliverable must be inside study-buddy-data";

    const result = await runInteractiveStudyGuideWorkflow({ prompt: "Study Guide MEL", runDir: root }, {
      runExtraction: async (input) => {
        await validHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>Validated MEL</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async () => {
        throw new Error(publicationError);
      },
    });

    expect(result.ok).toBe(false);
    expect(result.sourceRunDir).toBe(extractionRunDir);
    expect(result.webLayoutRunDir).toBe(webLayoutRunDir);
    expect(result.outputPath).toBe(outputPath);
    expect(result.error).toBe(publicationError);
    await expect(readFile(result.summaryPath, "utf8")).resolves.toContain(`Canonical HTML: ${outputPath}`);
  });

  it("continues a recoverable extraction checkpoint before rendering", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-recovery", `${Date.now()}`);
    let attempts = 0;
    let rendered = false;
    const result = await runInteractiveStudyGuideWorkflow({ prompt: "Study Guide DYN2", runDir: root }, {
      runExtraction: async (input) => {
        attempts += 1;
        await mkdir(input.runDir!, { recursive: true });
        if (attempts === 1) {
          const error = "Extraction checkpoint required: continue chapter handoffs";
          await writeFile(path.join(input.runDir!, "run-summary.md"), "Run status: failed\n", "utf8");
          await writeFile(path.join(input.runDir!, "error.log"), error, "utf8");
          await writeFile(path.join(input.runDir!, "extracted-data.json"), "{}", "utf8");
          return { ok: false, runDir: input.runDir!, error } as never;
        }
        expect(input.resumeExtractionRunDir).toBe(path.join(root, "extraction"));
        await validHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        rendered = true;
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>DYN2</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async () => [],
    });

    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(rendered).toBe(true);
  });

  it("resumes an exhausted workflow in place without crawling sources again", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-external-resume", `${Date.now()}`);
    const prior = path.join(root, "extraction-recovery-1");
    await mkdir(prior, { recursive: true });
    const capacityError = "Extraction capacity checkpoint required: resume after fair model admission";
    await writeFile(path.join(prior, "run-summary.md"), "Run status: failed\n", "utf8");
    await writeFile(path.join(prior, "error.log"), capacityError, "utf8");
    await writeFile(path.join(prior, "extracted-data.json"), "{}", "utf8");
    await mkdir(path.join(root, "extraction"), { recursive: true });

    let extractionCalls = 0;
    const result = await runInteractiveStudyGuideWorkflow({
      prompt: "Erstelle einen interaktiven Study Guide für MEL",
      resumeRunDir: root,
      maxExtractionAttempts: 1,
    }, {
      runExtraction: async (input) => {
        extractionCalls += 1;
        expect(input.resumeExtractionRunDir).toBe(prior);
        expect(input.maxPages).toBe(0);
        expect(input.allowFileDownloads).toBe(false);
        expect(input.runDir).toBe(path.join(root, "extraction-recovery-2"));
        await validHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>MEL resumed</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async () => [],
    });

    expect(result.ok).toBe(true);
    expect(extractionCalls).toBe(1);
    expect(result.extractionRunDirs.at(-1)).toBe(path.join(root, "extraction-recovery-2"));
  });

  it("hydrates immutable Moodle raw evidence into a successful recovery handoff", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-handoff-hydration", `${Date.now()}`);
    const initial = path.join(root, "extraction");
    const recovered = path.join(root, "extraction-recovery-1");
    await mkdir(initial, { recursive: true });
    await writeFile(path.join(initial, "moodle_raw.txt"), "immutable Moodle evidence", "utf8");
    await mkdir(recovered, { recursive: true });
    await writeFile(path.join(recovered, "run-summary.md"), "Run status: success\n", "utf8");
    await writeFile(path.join(recovered, "error.log"), "", "utf8");
    await writeFile(path.join(recovered, "extracted-data.json"), "{}", "utf8");
    await writeFile(path.join(recovered, "source_coverage.json"), "{}", "utf8");

    let extractionCalled = false;
    const result = await runInteractiveStudyGuideWorkflow({ prompt: "Study Guide MEL", resumeRunDir: root }, {
      runExtraction: async () => {
        extractionCalled = true;
        throw new Error("must not extract again");
      },
      runWebLayout: async (input) => {
        expect(input.sourceRunDir).toBe(recovered);
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>Hydrated MEL</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async () => [],
    });

    expect(result.ok).toBe(true);
    expect(extractionCalled).toBe(false);
    expect(await readFile(path.join(recovered, "moodle_raw.txt"), "utf8")).toBe("immutable Moodle evidence");
  });

  it("never renders after a semantic extraction failure", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-interactive-failure", `${Date.now()}`);
    let rendered = false;
    const result = await runInteractiveStudyGuideWorkflow({ prompt: "Study Guide", runDir: root }, {
      runExtraction: async (input) => {
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(path.join(input.runDir!, "run-summary.md"), "Run status: failed\n", "utf8");
        await writeFile(path.join(input.runDir!, "error.log"), "Course could not be resolved", "utf8");
        return { ok: false, runDir: input.runDir!, error: "Course could not be resolved" } as never;
      },
      runWebLayout: async () => {
        rendered = true;
        throw new Error("must not run");
      },
    });

    expect(result.ok).toBe(false);
    expect(rendered).toBe(false);
    expect(result.extractionRunDirs).toHaveLength(1);
  });
});
