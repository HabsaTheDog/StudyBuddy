import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAnswerGraph,
  buildEvidenceHandoffExtractionGraph,
  buildExtractionGraph,
  buildMoodleGraph,
  checkpointPdfPostRenderReview,
  loadExtractionReviewState,
  loadRenderState,
  persistVerifiedRequestContract,
  qualityFailureNeedsSourceAcquisition,
  resolvePreflightModels,
  routeAfterExtractionQualityReview,
  routeAfterPdfPostRenderReview,
  runMoodleGraph,
} from "../graph.js";
import { initialSourceCoverage, RunDiagnostics } from "../runDiagnostics.js";
import { initialAgentState } from "../state.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import { CodexRuntimePreflightError } from "../codexRuntime.js";
import {
  EvidencePackageSchema,
  ResourceManifestSchema,
} from "../examNavigatorContracts.js";
import { stableResourceId } from "../resourceManifest.js";
import {
  createRequestContractIntegrity,
  minimalRequestContract,
  REQUEST_CONTRACT_FILE,
  REQUEST_CONTRACT_INTEGRITY_FILE,
} from "../../shared/requestContract.js";
import {
  moodleExtractedData,
  moodleTestConfig,
  sequenceCodex,
  studyBuddyTypstDocument,
} from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

async function writeVerifiedRequestContract(
  directory: string,
  prompt = "make compact notes",
): Promise<string> {
  const contract = minimalRequestContract(prompt, ["pdf"]);
  const integrity = createRequestContractIntegrity(contract);
  await Promise.all([
    writeFile(path.join(directory, REQUEST_CONTRACT_FILE), `${JSON.stringify(contract, null, 2)}\n`, "utf8"),
    writeFile(
      path.join(directory, REQUEST_CONTRACT_INTEGRITY_FILE),
      `${JSON.stringify(integrity, null, 2)}\n`,
      "utf8",
    ),
  ]);
  return integrity.contractHash;
}

function evaluatedRequestContract(prompt: string, formats: string[]) {
  return {
    ...minimalRequestContract(prompt, formats),
    evaluationStatus: "evaluated" as const,
  };
}

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("moodle graph retry routing", () => {
  it("atomically replaces a same-prompt extraction contract after evidence changes", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-contract-revision-"));
    const initial = minimalRequestContract("make compact notes", ["pdf"]);
    const revised = { ...initial, evaluationStatus: "evaluated" as const, userGoal: "Grounded notes" };
    const initialHash = await persistVerifiedRequestContract(runDir, initial, "extraction");
    const revisedHash = await persistVerifiedRequestContract(runDir, revised, "extraction");
    expect(revisedHash).not.toBe(initialHash);
    const persisted = JSON.parse(await readFile(path.join(runDir, REQUEST_CONTRACT_FILE), "utf8"));
    const integrity = JSON.parse(await readFile(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE), "utf8"));
    expect(persisted.userGoal).toBe(revised.userGoal);
    expect(integrity.contractHash).toBe(revisedHash);
  });

  it("rejects prompt changes and incomplete contract-integrity pairs", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-contract-boundary-"));
    await persistVerifiedRequestContract(runDir, minimalRequestContract("make compact notes", ["pdf"]), "extraction");
    await expect(persistVerifiedRequestContract(
      runDir,
      minimalRequestContract("different user request", ["pdf"]),
      "extraction",
    )).rejects.toThrow("Request contract mismatch");
    const incompleteDir = path.join(runDir, "incomplete");
    await mkdir(incompleteDir, { recursive: true });
    await writeFile(
      path.join(incompleteDir, REQUEST_CONTRACT_FILE),
      JSON.stringify(minimalRequestContract("make compact notes", ["pdf"])),
      "utf8",
    );
    await expect(persistVerifiedRequestContract(
      incompleteDir,
      minimalRequestContract("make compact notes", ["pdf"]),
      "extraction",
    )).rejects.toThrow("integrity pair is incomplete");
  });

  it("preflights the PDF visual reviewer for render-only runs", () => {
    const models = resolvePreflightModels(moodleTestConfig({
      stage: "render",
      modelPolicyOverrides: {
        artifact_builder: {
          model: "artifact-builder-primary",
          escalationModel: "artifact-builder-repair",
        },
        artifact_repair: {
          model: "artifact-repair-primary",
          escalationModel: "artifact-repair-escalation",
        },
        quality_reviewer: {
          model: "pdf-reviewer-primary",
          escalationModel: "pdf-reviewer-escalation",
        },
      },
    }));

    expect(models).toEqual(expect.arrayContaining([
      "pdf-reviewer-primary",
      "pdf-reviewer-escalation",
    ]));
  });

  it("bounds PDF post-render repairs and never routes unrelated writer failures into a recrawl", () => {
    const postRenderFailure = {
      ...initialAgentState,
      retry_count: 0,
      error_log:
        "PDF post-render review failed; repair target: formatter.\n- [page 1] overlapping blocks",
    };

    expect(checkpointPdfPostRenderReview(postRenderFailure)).toEqual({ retry_count: 1 });
    expect(routeAfterPdfPostRenderReview({
      ...postRenderFailure,
      retry_count: 1,
    })).toBe("formatter");
    expect(routeAfterPdfPostRenderReview({
      ...postRenderFailure,
      retry_count: 3,
    })).toBe("abort");
    expect(routeAfterPdfPostRenderReview({
      ...initialAgentState,
      error_log: "PDF compilation failed: renderer exited with code 1",
    })).toBe("abort");
    expect(routeAfterPdfPostRenderReview(initialAgentState)).toBe("bundleWriter");
  });

  it("reserves the last global retry for localized semantic repair", () => {
    expect(routeAfterExtractionQualityReview({
      ...initialAgentState,
      retry_count: 2,
      error_log:
        "Semantic quality review failed:\n- [chapter: Drallsatz] Die Momentenbilanz fehlt.",
    })).toBe("contentAnalyzer");
    expect(routeAfterExtractionQualityReview({
      ...initialAgentState,
      retry_count: 3,
      error_log:
        "Semantic quality review failed:\n- [chapter: Drallsatz] Die Momentenbilanz fehlt.",
    })).toBe("abort");
  });

  it("publishes validated partial content when localized depth repair is exhausted", () => {
    expect(routeAfterExtractionQualityReview({
      ...initialAgentState,
      retry_count: 3,
      extracted_data: moodleExtractedData(),
      error_log:
        "Semantic quality review failed:\n" +
        "- [chapter: Schwingungen] [owner: content] [repair: content_analyzer] Nicht freigegebene lokale Details.\n" +
        "- [chapter: Massengeometrie] [owner: content] [repair: content_analyzer] Nicht freigegebene lokale Details.",
    })).toBe("partialFinalizer");

    expect(routeAfterExtractionQualityReview({
      ...initialAgentState,
      retry_count: 3,
      extracted_data: moodleExtractedData(),
      error_log:
        "Semantic quality review failed:\n" +
        "- [chapter: Schwingungen] [owner: source] [repair: source_architect] Die Quellenintegrität ist ungültig.",
    })).toBe("abort");
  });

  it("distinguishes source-coverage quality failures from content-only repairs", () => {
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- [owner: source] [repair: source_architect] Weitere Kursdateien sind erforderlich.",
    )).toBe(true);
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- [owner: content] [repair: content_analyzer] Der gezeigte Wert ist falsch.",
    )).toBe(false);
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- [owner: content] [repair: content_analyzer] Die Übergabe ist unvollständig.",
    )).toBe(false);
    expect(qualityFailureNeedsSourceAcquisition(
      "Semantic quality review failed:\n- [owner: source] [repair: source_architect] Eine zugängliche Kursdatei fehlt.",
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
      JSON.stringify(evaluatedRequestContract("make notes", ["pdf"])),
      "not json",
      JSON.stringify(moodleExtractedData()),
      studyBuddyTypstDocument(),
      JSON.stringify({ ok: true, summary: "Reviewed", findings: [] }),
    ]);

    const graph = buildMoodleGraph(
      moodleTestConfig({
        outputPath,
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
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
  }, 30_000);

  it("aborts before the analyzer when required Moodle authentication failed", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    let codexCalls = 0;
    const config = moodleTestConfig({
      runDir,
      runtimeCacheDir: path.join(runDir, "runtime-cache"),
      outputPath: path.join(runDir, "document.typ"),
      diagnostics,
    });

    const graph = buildMoodleGraph(config, {
      codex: {
        async run() {
          codexCalls += 1;
          return JSON.stringify(evaluatedRequestContract(
            config.originalUserPrompt,
            config.artifactIntent.formats,
          ));
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
    expect(codexCalls).toBe(1);
  });

  it("rejects a DC-DC document when the source file was not downloaded", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    let codexCalls = 0;
    const config = moodleTestConfig({
      runDir,
      runtimeCacheDir: path.join(runDir, "runtime-cache"),
      outputPath: path.join(runDir, "document.typ"),
      prompt: "Erstelle ein DC-DC-Wandler Lern-PDF",
      diagnostics,
    });

    const graph = buildMoodleGraph(config, {
      codex: {
        async run() {
          codexCalls += 1;
          return JSON.stringify(evaluatedRequestContract(
            config.originalUserPrompt,
            config.artifactIntent.formats,
          ));
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
    expect(codexCalls).toBe(1);
  });

  it("rejects file-based study requests when no Moodle file was downloaded", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-run-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    let codexCalls = 0;
    const config = moodleTestConfig({
      runDir,
      runtimeCacheDir: path.join(runDir, "runtime-cache"),
      outputPath: path.join(runDir, "document.typ"),
      prompt: "Suche konkrete Folien und PDF-Dateien zu Bohrungen im Technischen Zeichnen",
      diagnostics,
    });

    const graph = buildMoodleGraph(config, {
      codex: {
        async run() {
          codexCalls += 1;
          return JSON.stringify(evaluatedRequestContract(
            config.originalUserPrompt,
            config.artifactIntent.formats,
          ));
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
    expect(codexCalls).toBe(1);
  });

  it("finishes extraction with validated data and without creating a document", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-extract-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      runtimeCacheDir: path.join(runDir, "runtime-cache"),
      outputPath: path.join(runDir, "document.typ"),
      stage: "extract",
      diagnostics,
    });
    const graph = buildExtractionGraph(config, {
      codex: sequenceCodex([
        JSON.stringify(evaluatedRequestContract(
          config.originalUserPrompt,
          config.artifactIntent.formats,
        )),
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
    expect(result.request_contract_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(path.join(runDir, "extracted-data.json"), "utf8")).resolves.toContain("DYN2");
    await expect(readFile(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE), "utf8"))
      .resolves.toContain(result.request_contract_hash!);
  });

  it("persists the verified request contract before an interactive evidence handoff can terminate", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-interactive-extract-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir,
      runtimeCacheDir: path.join(runDir, "runtime-cache"),
      outputPath: path.join(runDir, "document.typ"),
      stage: "extract",
      evidenceHandoffOnly: true,
      moodleUrl: "https://moodle.example/course/view.php?id=32844",
      diagnostics,
    });
    const graph = buildEvidenceHandoffExtractionGraph(config, {
      codex: sequenceCodex([
        JSON.stringify(evaluatedRequestContract(
          config.originalUserPrompt,
          config.artifactIntent.formats,
        )),
        JSON.stringify({
          status: "sufficient",
          coverage_summary: "The authorized course page grounds the requested interactive overview.",
          requested_urls: [],
          reasons: ["No additional source is required for this fixture."],
          learning_architecture: {
            schemaVersion: 1,
            modules: [{
              id: "course-overview",
              title: "Course overview",
              priority: "essential",
              contentMode: "mixed",
              learningObjectives: ["Explain the evidenced course overview."],
              assessmentSignals: [],
              resourceUrls: [config.moodleUrl],
            }],
            supportResources: [],
            excludedResourceUrls: [],
          },
        }),
      ]),
      scraperNode: async () => {
        await diagnostics.markSuccess("moodle", {
          detail: "Course page extracted.",
          urls: [config.moodleUrl],
          pages: 1,
        });
        return {
          moodle_raw_text: [
            "Selected Moodle course: Example Course",
            `Course URL: ${config.moodleUrl}`,
            "Chapter: Course overview",
          ].join("\n"),
          error_log: null,
        };
      },
      cisScraperNode: async (state) => ({
        moodle_raw_text: state.moodle_raw_text,
        error_log: null,
      }),
    });

    const result = await graph.invoke(initialAgentState);

    expect(result.request_contract_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.source_architect_decision.round).toBe(1);
    expect(result.source_architect_decision.status).toBe("sufficient");
    await expect(readFile(path.join(runDir, REQUEST_CONTRACT_FILE), "utf8"))
      .resolves.toContain(config.originalUserPrompt);
    await expect(readFile(path.join(runDir, REQUEST_CONTRACT_INTEGRITY_FILE), "utf8"))
      .resolves.toContain(result.request_contract_hash!);
  });

  it("resumes a false persisted coverage block without crawling sources", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-coverage-resume-"));
    const sourceDir = path.join(runDir, "source");
    const recoveryDir = path.join(runDir, "recovery");
    const sourcesDir = path.join(sourceDir, "sources");
    await mkdir(sourcesDir, { recursive: true });
    await mkdir(recoveryDir, { recursive: true });
    const courseUrl = "https://moodle.technikum-wien.at/course/view.php?id=101";
    const resourceUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=102";
    const resourceId = stableResourceId(resourceUrl);
    const staleParent = stableResourceId(
      "https://moodle.technikum-wien.at/mod/feedback/view.php?id=103",
    );
    const localPath = path.join(sourcesDir, "translation.pdf");
    await writeFile(localPath, "%PDF-1.4\nfixture\n", "utf8");
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl,
      generatedAt: new Date().toISOString(),
      resources: [{
        id: stableResourceId(courseUrl),
        parentId: null,
        sectionPath: [],
        activityType: "course",
        title: "Physikalische Grundlagen der Dynamik",
        originUrl: courseUrl,
        resolvedUrl: null,
        localPath: null,
        previewPath: null,
        status: "discovered",
        checksum: null,
        verifiedAt: null,
        examRelevance: "unknown",
        failureReason: null,
      }, {
        id: resourceId,
        parentId: staleParent,
        sectionPath: ["Translation"],
        activityType: "resource",
        title: "Kontrollfragen Translation",
        originUrl: resourceUrl,
        resolvedUrl: null,
        localPath,
        previewPath: localPath,
        status: "acquired",
        checksum: null,
        verifiedAt: new Date().toISOString(),
        examRelevance: "unknown",
        failureReason: null,
        selection: {
          selected: true,
          role: "primary_lecture",
          topic: "Translation",
          priority: 900,
          reason: "Selected for the target course.",
        },
        extraction: {
          status: "usable",
          method: "native_pdf_text",
          characterCount: 500,
          pageCount: 2,
          warnings: [],
        },
      }],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev-translation",
        resourceId,
        kind: "claim",
        locator: { page: 1 },
        content: "Translation evidence",
        confidence: 1,
        pairId: null,
        sourceUrl: resourceUrl,
        localPath,
      }],
      warnings: [],
    });
    await Promise.all([
      writeVerifiedRequestContract(sourceDir),
      writeFile(path.join(sourceDir, "run-summary.md"), "Run status: failed\n", "utf8"),
      writeFile(
        path.join(sourceDir, "error.log"),
        "Student-first coverage blocked publication: no resource was downloaded.\n",
        "utf8",
      ),
      writeFile(path.join(sourceDir, "moodle_raw.txt"), "Persisted Moodle evidence\n", "utf8"),
      writeFile(path.join(sourceDir, "source-map.json"), `${JSON.stringify(manifest)}\n`, "utf8"),
      writeFile(path.join(sourceDir, "evidence-package.json"), `${JSON.stringify(evidence)}\n`, "utf8"),
      writeFile(path.join(sourceDir, "coverage-report.json"), `${JSON.stringify({
        status: "blocked",
        detail: "No downloads.",
        criticalMissing: ["No downloads."],
        omittedTopics: [],
        retryActions: ["Retry crawl."],
        discoveredResources: 1,
        acquiredResources: 0,
        failedResources: 0,
        usableEvidenceRecords: 1,
      })}\n`, "utf8"),
    ]);
    const diagnostics = new RunDiagnostics({ runDir: recoveryDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir: recoveryDir,
      outputPath: path.join(recoveryDir, "document.typ"),
      stage: "extract",
      resumeExtractionRunDir: sourceDir,
      moodleUrl: courseUrl,
      diagnostics,
      intentDecision: {
        intent: "study_pdf",
        wantsPdf: true,
        wantsTypstDocument: true,
        wantsQuickAnswer: false,
        wantsQuizAssistance: false,
        needsMoodle: true,
        needsCis: false,
        needsCalendar: false,
        needsCourseMaterial: true,
        needsDownloadedFiles: true,
        reason: "coverage recovery fixture",
      },
    });

    const recovered = await loadExtractionReviewState(config);

    expect(recovered.error_log).toBeNull();
    expect(recovered.coverage_assessment.status).not.toBe("blocked");
    expect(recovered.request_contract_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(recovered.coverage_assessment.acquiredResources).toBe(1);
    expect(recovered.resource_manifest.resources.find((entry) => entry.id === resourceId)?.parentId)
      .toBe(stableResourceId(courseUrl));
    await expect(readFile(path.join(recoveryDir, "coverage-recovery.json"), "utf8"))
      .resolves.toContain('"performedNetworkAccess": false');
    await expect(readFile(path.join(recoveryDir, REQUEST_CONTRACT_INTEGRITY_FILE), "utf8"))
      .resolves.toContain(recovered.request_contract_hash!);
  });

  it("resumes a reviewer budget failure from persisted extracted data", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-review-budget-resume-"));
    const sourceDir = path.join(runDir, "source");
    const recoveryDir = path.join(runDir, "recovery");
    await Promise.all([
      mkdir(sourceDir, { recursive: true }),
      mkdir(recoveryDir, { recursive: true }),
    ]);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: "https://moodle.example/course/1",
      generatedAt: new Date().toISOString(),
      resources: [],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [],
      warnings: [],
    });
    const coverage = {
      status: "partial",
      detail: "Persisted course evidence is usable.",
      criticalMissing: [],
      omittedTopics: [],
      retryActions: [],
      discoveredResources: 1,
      acquiredResources: 1,
      failedResources: 0,
      usableEvidenceRecords: 1,
    };
    await Promise.all([
      writeVerifiedRequestContract(sourceDir),
      writeFile(path.join(sourceDir, "run-summary.md"), "Run status: failed\n", "utf8"),
      writeFile(
        path.join(sourceDir, "error.log"),
        "Quality reviewer failed: quality_reviewer request exceeds its hard character budget.\n",
        "utf8",
      ),
      writeFile(path.join(sourceDir, "moodle_raw.txt"), "Persisted Moodle evidence\n", "utf8"),
      writeFile(
        path.join(sourceDir, "extracted-data.json"),
        `${JSON.stringify(moodleExtractedData())}\n`,
        "utf8",
      ),
      writeFile(path.join(sourceDir, "source-map.json"), `${JSON.stringify(manifest)}\n`, "utf8"),
      writeFile(path.join(sourceDir, "evidence-package.json"), `${JSON.stringify(evidence)}\n`, "utf8"),
      writeFile(path.join(sourceDir, "coverage-report.json"), `${JSON.stringify(coverage)}\n`, "utf8"),
    ]);
    const diagnostics = new RunDiagnostics({ runDir: recoveryDir });
    await diagnostics.init();
    const config = moodleTestConfig({
      runDir: recoveryDir,
      outputPath: path.join(recoveryDir, "document.typ"),
      stage: "extract",
      resumeExtractionRunDir: sourceDir,
      diagnostics,
    });

    const recovered = await loadExtractionReviewState(config);

    expect(Object.keys(recovered.extracted_data).length).toBeGreaterThan(0);
    expect(recovered.error_log).toBeNull();
    expect(recovered.retry_count).toBe(0);
  });

  it("resumes an exhausted analyzer from persisted chapter handoffs without crawling", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-analyzer-resume-"));
    const sourceDir = path.join(runDir, "source");
    const recoveryDir = path.join(runDir, "recovery");
    const handoffDir = path.join(sourceDir, "chapter-handoffs");
    await Promise.all([
      mkdir(handoffDir, { recursive: true }),
      mkdir(recoveryDir, { recursive: true }),
    ]);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: "https://moodle.example/course/1",
      generatedAt: new Date().toISOString(),
      resources: [],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [],
      warnings: [],
    });
    const coverage = {
      status: "partial",
      detail: "Persisted course evidence is usable.",
      criticalMissing: [],
      omittedTopics: [],
      retryActions: [],
      discoveredResources: 1,
      acquiredResources: 1,
      failedResources: 0,
      usableEvidenceRecords: 1,
    };
    await Promise.all([
      writeVerifiedRequestContract(sourceDir),
      writeFile(path.join(sourceDir, "run-summary.md"), "Run status: failed\n", "utf8"),
      writeFile(
        path.join(sourceDir, "error.log"),
        "Analyzer failed: [chapter: Vektorkinematik] Chapter analyzer returned no applied example.\n",
        "utf8",
      ),
      writeFile(path.join(sourceDir, "moodle_raw.txt"), "Persisted Moodle evidence\n", "utf8"),
      writeFile(path.join(sourceDir, "source-map.json"), `${JSON.stringify(manifest)}\n`, "utf8"),
      writeFile(path.join(sourceDir, "evidence-package.json"), `${JSON.stringify(evidence)}\n`, "utf8"),
      writeFile(path.join(sourceDir, "coverage-report.json"), `${JSON.stringify(coverage)}\n`, "utf8"),
      writeFile(path.join(handoffDir, "punktkinematik.json"), "{}\n", "utf8"),
    ]);
    const diagnostics = new RunDiagnostics({ runDir: recoveryDir });
    await diagnostics.init();

    const recovered = await loadExtractionReviewState(moodleTestConfig({
      runDir: recoveryDir,
      outputPath: path.join(recoveryDir, "document.typ"),
      stage: "extract",
      resumeExtractionRunDir: sourceDir,
      diagnostics,
    }));

    expect(recovered.error_log).toContain("[chapter: Vektorkinematik]");
    expect(recovered.retry_count).toBe(2);
    expect(recovered.extracted_data).toEqual({});
    await expect(readFile(path.join(recoveryDir, "chapter-handoffs", "punktkinematik.json"), "utf8"))
      .resolves.toBe("{}\n");
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
      writeVerifiedRequestContract(extractionDir, "make notes"),
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
        outputLanguage: "de",
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
    await expect(readFile(path.join(renderDir, REQUEST_CONTRACT_INTEGRITY_FILE), "utf8"))
      .resolves.toEqual(await readFile(path.join(extractionDir, REQUEST_CONTRACT_INTEGRITY_FILE), "utf8"));
  }, 20_000);

  it("rejects an official render when the persisted RequestContract hash does not match", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-contract-mismatch-"));
    const sourceDir = path.join(runDir, "source");
    const renderDir = path.join(runDir, "render");
    await Promise.all([
      mkdir(sourceDir, { recursive: true }),
      mkdir(renderDir, { recursive: true }),
    ]);
    const contract = minimalRequestContract("make compact notes", ["pdf"]);
    await Promise.all([
      writeFile(path.join(sourceDir, "run-summary.md"), "Run status: success\n", "utf8"),
      writeFile(path.join(sourceDir, "error.log"), "", "utf8"),
      writeFile(path.join(sourceDir, "moodle_raw.txt"), "Persisted evidence", "utf8"),
      writeFile(path.join(sourceDir, "extracted-data.json"), "{}\n", "utf8"),
      writeFile(path.join(sourceDir, REQUEST_CONTRACT_FILE), `${JSON.stringify(contract, null, 2)}\n`, "utf8"),
      writeFile(
        path.join(sourceDir, REQUEST_CONTRACT_INTEGRITY_FILE),
        `${JSON.stringify({ schemaVersion: 1, algorithm: "sha256", contractHash: "0".repeat(64) }, null, 2)}\n`,
        "utf8",
      ),
    ]);

    await expect(loadRenderState(moodleTestConfig({
      runDir: renderDir,
      stage: "render",
      sourceRunDir: sourceDir,
    }))).rejects.toThrow("Request contract integrity mismatch");
  });

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
