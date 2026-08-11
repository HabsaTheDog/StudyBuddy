import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireInteractiveWorkflowAdmission, runInteractiveStudyGuideWorkflow } from "../workflow.js";
import {
  createRequestContractIntegrity,
  type RequestContract,
} from "../../shared/requestContract.js";

async function validHandoff(runDir: string): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "run-summary.md"), "Run status: partial\n", "utf8");
  await writeFile(path.join(runDir, "error.log"), "", "utf8");
  await writeFile(path.join(runDir, "moodle_raw.txt"), "evidence", "utf8");
  await writeFile(path.join(runDir, "extracted-data.json"), "{}", "utf8");
  await writeFile(path.join(runDir, "source_coverage.json"), "{}", "utf8");
}

async function combinedHandoff(runDir: string): Promise<void> {
  await validHandoff(runDir);
  const contract: RequestContract = {
    schemaVersion: 1,
    evaluationStatus: "evaluated",
    originalPrompt: "Create an interactive guide and a compact PDF",
    userGoal: "Learn with an interactive guide and compact reference",
    deliverables: [
      { id: "html", kind: "interactive study guide", purpose: "Self testing" },
      { id: "pdf", kind: "compact PDF study reference", purpose: "Compact reference" },
    ],
    requirements: [],
    notRequired: [],
    forbidden: [],
    contentStrategy: {
      summary: "Share one source handoff",
      quantityBasis: "No fixed quota",
      completionRule: "Both requested deliverables pass their own review",
    },
    reviewAssignments: [
      { owner: "technical", requirementIds: [], checks: ["Validate each requested artifact"] },
    ],
  };
  await writeFile(path.join(runDir, "request-contract.json"), `${JSON.stringify(contract)}\n`, "utf8");
  await writeFile(
    path.join(runDir, "request-contract-integrity.json"),
    `${JSON.stringify(createRequestContractIntegrity(contract))}\n`,
    "utf8",
  );
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
        expect(input.formats).toEqual(["html"]);
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

  it("fans HTML and PDF out in parallel from one validated extraction handoff", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-combined-artifact-workflow", `${Date.now()}`);
    const sourceRunDir = path.join(root, "extraction");
    let entered = 0;
    let maximumParallel = 0;
    let releaseBoth!: () => void;
    const bothEntered = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const enterBranch = async () => {
      entered += 1;
      maximumParallel = Math.max(maximumParallel, entered);
      if (entered === 2) releaseBoth();
      await bothEntered;
    };
    const publishedSources: string[][] = [];
    const result = await runInteractiveStudyGuideWorkflow({
      prompt: "Create an interactive guide and a compact PDF",
      runDir: root,
    }, {
      runExtraction: async (input) => {
        expect(input.formats).toEqual(["html", "pdf"]);
        await combinedHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        expect(input.sourceRunDir).toBe(sourceRunDir);
        await enterBranch();
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>Combined</title>", "utf8");
        entered -= 1;
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      runPdfRender: async (input) => {
        expect(input).toMatchObject({
          stage: "render",
          sourceRunDir,
          maxPages: 0,
          maxCisPages: 0,
          allowFileDownloads: false,
          formats: ["pdf"],
        });
        await enterBranch();
        const pdfPath = path.join(input.runDir!, "document.pdf");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(path.join(input.runDir!, "document.typ"), "#set page(width: 210mm)", "utf8");
        await writeFile(pdfPath, "%PDF-test", "utf8");
        entered -= 1;
        return { ok: true, runDir: input.runDir!, pdfPath } as never;
      },
      publish: async ({ sourcePaths }) => {
        const concreteSources = sourcePaths.filter((sourcePath): sourcePath is string => Boolean(sourcePath));
        publishedSources.push(concreteSources);
        return concreteSources.map((sourcePath) => ({
          sourcePath,
          publishedPath: `/tmp/${path.basename(sourcePath)}`,
          bytes: 1,
          sha256: "test",
        }));
      },
    });

    expect(result.ok).toBe(true);
    expect(maximumParallel).toBe(2);
    expect(result.outputPath).toBe(path.join(root, "web-layout", "document.html"));
    expect(result.pdfPath).toBe(path.join(root, "pdf-render", "document.pdf"));
    expect(publishedSources).toEqual([[
      path.join(root, "web-layout", "document.html"),
      path.join(root, "pdf-render", "document.pdf"),
    ]]);
  });

  it("reuses a validated HTML branch and reruns only the missing PDF branch", async () => {
    const root = path.join(process.cwd(), "study-buddy-data", "test-combined-branch-resume", `${Date.now()}`);
    const extractionRunDir = path.join(root, "extraction");
    const webRunDir = path.join(root, "web-layout");
    await combinedHandoff(extractionRunDir);
    await mkdir(webRunDir, { recursive: true });
    await writeFile(path.join(webRunDir, "run-summary.md"), "Run status: success\n", "utf8");
    await writeFile(path.join(webRunDir, "error.log"), "", "utf8");
    await writeFile(path.join(webRunDir, "quality-review.json"), '{"ok":true,"findings":[]}\n', "utf8");
    await writeFile(path.join(webRunDir, "document.html"), "<!doctype html><title>Reusable</title>", "utf8");
    let extractionCalls = 0;
    let htmlCalls = 0;
    let pdfCalls = 0;
    const result = await runInteractiveStudyGuideWorkflow({
      prompt: "Create an interactive guide and a compact PDF",
      resumeRunDir: root,
    }, {
      runExtraction: async () => {
        extractionCalls += 1;
        throw new Error("must reuse extraction");
      },
      runWebLayout: async () => {
        htmlCalls += 1;
        throw new Error("must reuse HTML");
      },
      runPdfRender: async (input) => {
        pdfCalls += 1;
        const pdfPath = path.join(input.runDir!, "document.pdf");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(path.join(input.runDir!, "document.typ"), "#set page(width: 210mm)", "utf8");
        await writeFile(pdfPath, "%PDF-test", "utf8");
        return { ok: true, runDir: input.runDir!, pdfPath } as never;
      },
      publish: async () => [],
    });

    expect(result.ok).toBe(true);
    expect(extractionCalls).toBe(0);
    expect(htmlCalls).toBe(0);
    expect(pdfCalls).toBe(1);
  });

  it("keeps the exact user request separate from a specific operational prompt", async () => {
    const root = path.join(
      process.cwd(),
      "study-buddy-data",
      "test-interactive-original-prompt",
      `${Date.now()}`,
    );
    const originalUserPrompt = "Okay, und jetzt dasselbe für Englisch.";
    const operationalPrompt = "Erstelle einen vollständigen Study Buddy für den Moodle-Kurs Business English.";
    const result = await runInteractiveStudyGuideWorkflow({
      prompt: operationalPrompt,
      originalUserPrompt,
      runDir: root,
      language: "de",
    }, {
      runExtraction: async (input) => {
        expect(input.prompt).toBe(operationalPrompt);
        expect(input.originalUserPrompt).toBe(originalUserPrompt);
        await validHandoff(input.runDir!);
        return { ok: true, runDir: input.runDir! } as never;
      },
      runWebLayout: async (input) => {
        expect(input.prompt).toBe(operationalPrompt);
        expect(input.originalUserPrompt).toBe(originalUserPrompt);
        const outputPath = path.join(input.runDir!, "document.html");
        await mkdir(input.runDir!, { recursive: true });
        await writeFile(outputPath, "<!doctype html><title>Business English</title>", "utf8");
        return { ok: true, runDir: input.runDir!, outputPath } as never;
      },
      publish: async () => [],
    });

    expect(result.ok).toBe(true);
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
