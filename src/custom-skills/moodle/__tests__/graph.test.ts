import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAnswerGraph,
  buildExtractionGraph,
  buildMoodleGraph,
  qualityFailureNeedsSourceAcquisition,
  runMoodleGraph,
} from "../graph.js";
import { initialSourceCoverage, RunDiagnostics } from "../runDiagnostics.js";
import { initialAgentState } from "../state.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { CodexRuntimePreflightError } from "../codexRuntime.js";
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
  it("distinguishes source-coverage quality failures from content-only repairs", () => {
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- Zwei Kapitel fehlen, obwohl weitere Kursdateien und Quellen verfügbar sind.",
    )).toBe(true);
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- Der gezeigte Zahlenwert widerspricht der Formel.",
    )).toBe(false);
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- Die Kapitel brechen ab und die Übergabe enthält nur sourceIds ohne Quellenverzeichnis; der Formelbestand ist leer.",
    )).toBe(false);
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- Für Kapitel 9 fehlt eine zugängliche Kursdatei mit der Musterlösung.",
    )).toBe(true);
    expect(qualityFailureNeedsSourceAcquisition("Quality reviewer failed: timeout")).toBe(false);
  });

  it("writes schedule answers without Typst or PDF artifacts", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-answer-"));
    const prompt = "Finde die naechste kommende MEL Pruefung in Moodle und CIS. Nenne nur den naechsten Termin mit exactem Datum, Uhrzeit, Raum und pruefungsrelevanten Lernunterlagen aus dem zugehoerigen MEL Moodle-Kurs.";

    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      prompt,
      moodleUrl: "https://moodle.example/my/",
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
      diagnostics,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: true,
        hasCisUrls: true,
      }),
    });
    const graph = buildAnswerGraph(
      config,
      {
        scraperNode: async () => {
          await diagnostics.markSuccess("moodle", {
            detail: "MEL course opened.",
            urls: ["https://moodle.example/course/view.php?id=32280"],
            pages: 1,
          });
          return {
            moodle_raw_text: "[Moodle page]\nTitle: MEL1\nURL: https://moodle.example/course/view.php?id=32280\n\nMaschinenelemente 1 prüfungsrelevante Lernunterlagen",
            error_log: null,
          };
        },
        cisScraperNode: async (state) => {
          await diagnostics.markSuccess("cis", {
            detail: "MEL detail opened.",
            urls: ["https://cis.example/cis.php/lv"],
            pages: 1,
          });
          return {
            moodle_raw_text: `${state.moodle_raw_text}\n\n[CIS page]\nTitle: MEL Termine\nURL: https://cis.example/cis.php/lv\n\nMaschinenelemente 1 Prüfung 30.06.2026 10:00 Raum A1`,
            error_log: null,
          };
        },
        codex: sequenceCodex([JSON.stringify(moodleExtractedData({
          sections: [{ heading: "Nächster Termin", summary: "30.06.2026, 10:00, Raum A1", key_concepts: [], source_ids: [] }],
        }))]),
      },
    );
    const result = await graph.invoke(initialAgentState);

    expect(result.error_log).toBeNull();
    await expect(stat(path.join(runDir, "answer.md"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(path.join(runDir, "answer.json"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(path.join(runDir, "document.typ"))).rejects.toThrow();
    await expect(stat(path.join(runDir, "document.pdf"))).rejects.toThrow();
  });

  it("rejects answer routes when the requested MEL target course is missing", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-answer-"));
    let codexCalls = 0;
    const prompt = "Finde die naechste kommende MEL Pruefung in Moodle und CIS. Nenne nur den naechsten Termin und Lernunterlagen.";

    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      prompt,
      moodleUrl: "https://moodle.example/my/",
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
      diagnostics,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: true,
        hasCisUrls: true,
      }),
    });
    const graph = buildAnswerGraph(config, {
        scraperNode: async () => {
          await diagnostics.markSuccess("moodle", {
            detail: "Dashboard opened.",
            urls: ["https://moodle.example/my/"],
            pages: 1,
          });
          return {
            moodle_raw_text: "Dashboard Generico Tool\nDYN2 Anwendungen der Dynamik",
            error_log: null,
          };
        },
        cisScraperNode: async (state) => {
          await diagnostics.markSuccess("cis", {
            detail: "CIS opened.",
            urls: ["https://cis.example/cis.php"],
            pages: 1,
          });
          return {
            moodle_raw_text: `${state.moodle_raw_text}\nDYN2 Prüfung 26.06.2026`,
            error_log: null,
          };
        },
        codex: {
          async run() {
            codexCalls += 1;
            return "{}";
          },
        },
      });
    const result = await graph.invoke(initialAgentState);

    expect(result.error_log).toContain("no evidence for the requested target course");
    expect(codexCalls).toBe(0);
  });

  it("writes a partial answer when target coverage exists but no date is found", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-answer-"));
    const prompt = "Finde die naechste kommende MEL Pruefung in Moodle und CIS. Nenne nur den naechsten Termin mit Datum, Uhrzeit und Raum.";

    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      prompt,
      moodleUrl: "https://moodle.example/my/",
      outputPath: path.join(runDir, "document.typ"),
      runDir,
      includeCis: true,
      cisUrls: ["https://cis.example/cis.php"],
      diagnostics,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "all",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: true,
        hasCisUrls: true,
      }),
    });
    const graph = buildAnswerGraph(config, {
        scraperNode: async () => {
          await diagnostics.markSuccess("moodle", {
            detail: "MEL course opened.",
            urls: ["https://moodle.example/course/view.php?id=32280"],
            pages: 1,
          });
          return {
            moodle_raw_text: "Maschinenelemente 1 Moodle-Kurs",
            error_log: null,
          };
        },
        cisScraperNode: async (state) => {
          await diagnostics.markSuccess("cis", {
            detail: "MEL detail opened.",
            urls: ["https://cis.example/cis.php/lv"],
            pages: 1,
          });
          return {
            moodle_raw_text: `${state.moodle_raw_text}\nMaschinenelemente 1 keine zukünftigen Prüfungstermine sichtbar`,
            error_log: null,
          };
        },
        codex: sequenceCodex([JSON.stringify(moodleExtractedData())]),
      });
    const result = await graph.invoke(initialAgentState);

    expect(result.error_log).toBeNull();
    const answerJson = JSON.parse(await readFile(path.join(runDir, "answer.json"), "utf8")) as { status: string; answer: string };
    expect(["not_found", "partial"]).toContain(answerJson.status);
    expect(answerJson.answer).toContain("Kein kommender");
  });

  it("retries invalid analyzer JSON and then writes Typst", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const outputPath = path.join(runDir, "document.typ");
    const codex = sequenceCodex([
      "not json",
      JSON.stringify(moodleExtractedData()),
      JSON.stringify({ ok: true, summary: "Reviewed", findings: [] }),
    ]);

    const graph = buildMoodleGraph(
      moodleTestConfig({
        outputPath,
        runDir,
        prompt: "make notes",
      }),
      {
        codex,
        scraperNode: async () => ({
          moodle_raw_text: "local fixture text",
          error_log: null,
        }),
        cisScraperNode: async (state) => ({
          moodle_raw_text: state.moodle_raw_text,
          error_log: null,
        }),
      },
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

  it("rejects file-based study requests when no Moodle file was downloaded", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    let codexCalls = 0;
    const config = moodleTestConfig({
      runDir,
      outputPath: path.join(runDir, "document.typ"),
      prompt: "Suche konkrete Folien und PDF-Dateien zu Bohrungen im Technischen Zeichnen",
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
          detail: "Course page opened, but no files were downloaded.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return {
          moodle_raw_text: "Grundlagen des technischen Zeichnens: Bohrungen",
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
      codex: sequenceCodex([
        JSON.stringify(moodleExtractedData()),
        JSON.stringify({ ok: true, summary: "Reviewed", findings: [] }),
      ]),
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

  it("retries a reviewer execution failure without rebuilding validated extraction data", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-extract-review-retry-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      outputPath: path.join(runDir, "document.typ"),
      stage: "extract",
      diagnostics,
    });
    let analyzerCalls = 0;
    let reviewerCalls = 0;
    const graph = buildExtractionGraph(config, {
      codex: {
        async run(_prompt, options) {
          if (options?.task === "content_analyzer") {
            analyzerCalls += 1;
            return JSON.stringify(moodleExtractedData());
          }
          if (options?.task === "quality_reviewer") {
            reviewerCalls += 1;
            if (reviewerCalls === 1) throw new Error("temporary reviewer service issue");
            return JSON.stringify({ ok: true, summary: "Reviewed", findings: [] });
          }
          throw new Error(`Unexpected task: ${options?.task}`);
        },
      },
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
    expect(analyzerCalls).toBe(1);
    expect(reviewerCalls).toBe(2);
    expect(result.retry_count).toBe(1);
  });

  it("renders from a successful extraction handoff without running scrapers", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-staged-"));
    const extractionDir = path.join(runDir, "extraction");
    const renderDir = path.join(runDir, "render");
    await mkdir(path.join(extractionDir, "assets", "visuals"), { recursive: true });
    await writeFile(
      path.join(extractionDir, "assets", "visuals", "source.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="white"/><path d="M10 20 H70" stroke="black"/></svg>`,
      "utf8",
    );
    await Promise.all([
      writeFile(path.join(extractionDir, "run-summary.md"), "Run status: success\n", "utf8"),
      writeFile(path.join(extractionDir, "error.log"), "", "utf8"),
      writeFile(path.join(extractionDir, "moodle_raw.txt"), "Validated source bundle", "utf8"),
      writeFile(
        path.join(extractionDir, "extracted-data.json"),
        `${JSON.stringify(moodleExtractedData({
          visual_assets: [
            {
              id: "fig-001",
              kind: "moodle_pdf_page",
              title: "Schaltbild",
              relative_path: "assets/visuals/source.svg",
              mime_type: "image/svg+xml",
              width_px: 80,
              height_px: 40,
              source_id: null,
              source_url: "https://moodle.example/resource",
              source_path: path.join(extractionDir, "sources", "script.pdf"),
              source_page: 1,
              confidence: 0.9,
              caption_hint: "Schaltbild aus Moodle",
              relevance_reason: "Technisches Thema.",
              generation_prompt: null,
            },
          ],
          figures: [
            {
              asset_id: "fig-001",
              caption: "Schaltbild aus der Moodle-Unterlage",
              placement_hint: "overview",
              source_ids: [],
            },
          ],
        }))}\n`,
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
        codex: sequenceCodex([
          studyBuddyTypstDocument(),
          JSON.stringify({ ok: true, summary: "Reviewed", findings: [] }),
        ]),
      },
    );

    expect(result.ok).toBe(true);
    expect(scraperCalls).toBe(0);
    await expect(readFile(path.join(renderDir, "document.pdf"))).resolves.not.toHaveLength(0);
    await expect(stat(path.join(renderDir, "assets", "visuals", "source.svg"))).resolves.toMatchObject({
      size: expect.any(Number),
    });
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

  it("stops before source access when the Codex runtime preflight fails", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-runtime-preflight-"));
    let scraperCalls = 0;

    const result = await runMoodleGraph(
      {
        prompt: "make notes",
        moodleUrl: "https://moodle.example/course",
        runDir,
      },
      {
        runtimePreflight: async () => {
          throw new CodexRuntimePreflightError(
            "Codex runtime preflight failed before source access. Run: npm install --save-exact @openai/codex-sdk@latest",
          );
        },
        scraperNode: async () => {
          scraperCalls += 1;
          return {};
        },
        codex: sequenceCodex([]),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Codex runtime preflight failed before source access");
    expect(scraperCalls).toBe(0);
    expect(result.sourceCoverage.moodle.status).toBe("not_requested");
  });
});
