import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelCallTimeoutError,
  NonRetryableCodexError,
  classifyCodexError,
  type CodexClient,
} from "../codexClient.js";
import { chapterFragmentJsonSchema, extractedDataJsonSchema } from "../schemas.js";
import { buildChapterFragmentPrompt, createAnalyzerNode } from "../nodes/analyzerNode.js";
import {
  persistPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError, StudyBuddyTimeoutError } from "../runtimeAbort.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

describe("analyzerNode", () => {
  it("hands selected page image paths to the model for direct visual reading", () => {
    const prompt = buildChapterFragmentPrompt(
      moodleTestConfig({
        prompt: "Create an English dynamics guide",
        outputLanguage: "en",
        outputLanguageReason: "explicit_prompt",
      }),
      moodleTestState(),
      {
        key: "kinematics",
        title: "Vector kinematics",
        resourceIds: ["res_example"],
        matchTerms: ["vector", "kinematics"],
        contentMode: "quantitative",
      },
      { key: "example", label: "Example", resourceIds: ["res_example"], records: [] },
      0,
      1,
      {
        tooling: { pdfinfo: true, pdftotext: true, pdftoppm: true, pdfimages: true, magick: true },
        warnings: [],
        candidates: [{
          id: "page-image",
          kind: "moodle_pdf_page",
          title: "Worked example page",
          relative_path: "assets/visuals/example-page-1.png",
          mime_type: "image/png",
          width_px: 1200,
          height_px: 1600,
          source_id: "res_example",
          source_url: null,
          source_path: "/tmp/example.pdf",
          source_page: 1,
          confidence: 1,
          caption_hint: "Example page",
          relevance_reason: "Selected worked example",
          generation_prompt: null,
        }],
      },
      [{ resourceId: "res_example", pages: [1], purpose: "worked_example", priority: "high", placementHint: "chapter", reason: "read values" }],
    );

    expect(prompt).toContain("assets/visuals/example-page-1.png");
    expect(prompt).toContain("inspiziere die lokalen Bilddateien");
    expect(prompt).toContain("in English");
  });

  it("parses Codex JSON, validates defaults, and passes the schema hint", async () => {
    let receivedPrompt = "";
    let receivedSchema: unknown;
    const codex: CodexClient = {
      async run(prompt, options) {
        receivedPrompt = prompt;
        receivedSchema = options?.outputSchema;
        return '```json\n{"document_title":"DYN2","course":{"title":"Dynamik"}}\n```';
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({
      moodle_raw_text: "Feder-Daempfer-System",
      error_log: "Previous schema error",
      retry_count: 2,
      }),
    );

    expect(receivedPrompt).toContain("Previous validation error to repair:\nPrevious schema error");
    expect(receivedPrompt).toContain("Feder-Daempfer-System");
    expect(receivedPrompt).toContain("A study guide must teach the material");
    expect(receivedPrompt).toContain("origin='derived'");
    expect(receivedSchema).toBe(extractedDataJsonSchema);
    expect(result.error_log).toBeNull();
    expect(result.retry_count).toBeUndefined();
    expect(result.extracted_data).toMatchObject({
      document_title: "DYN2",
      language: "de",
      course: { title: "Dynamik", url: "" },
      sections: [],
      formulas: [],
    });
  });

  it("enforces the resolved artifact language even when source-biased model metadata disagrees", async () => {
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return JSON.stringify({
          document_title: "Dynamics",
          language: "de",
          course: { title: "Dynamik" },
        });
      },
    };
    const config = moodleTestConfig({
      prompt: "Make me a PDF about dynamics",
      outputLanguage: "en",
      outputLanguageReason: "prompt_language",
    });

    const result = await createAnalyzerNode(config, codex)(moodleTestState());

    expect(receivedPrompt).toContain("Output language is English");
    expect(result.extracted_data).toMatchObject({ language: "en" });
  });

  it("keeps invalid analyzer output in retry state", async () => {
    const codex: CodexClient = {
      async run() {
        return '"not an object"';
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({
      retry_count: 1,
      }),
    );

    expect(result.extracted_data).toBeUndefined();
    expect(result.error_log).toMatch(/^Analyzer failed:/);
    expect(result.retry_count).toBe(2);
  });

  it("rethrows a run-level abort before analysis without creating retry state", async () => {
    const controller = new AbortController();
    const timeout = new StudyBuddyTimeoutError("Global test timeout reached.");
    controller.abort(timeout);
    let calls = 0;
    const codex: CodexClient = {
      async run() {
        calls += 1;
        return '{"document_title":"must not run","course":{"title":"Course"}}';
      },
    };

    await expect(createAnalyzerNode(
      moodleTestConfig({ abortSignal: controller.signal }),
      codex,
    )(moodleTestState({ retry_count: 2 }))).rejects.toBe(timeout);
    expect(calls).toBe(0);
  });

  it("stops chapter workers immediately when the global signal aborts", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-abort-chapters-"));
    try {
      const controller = new AbortController();
      const timeout = new StudyBuddyTimeoutError("Global chapter timeout reached.");
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          controller.abort(timeout);
          throw new Error("SDK request canceled");
        },
      };
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        abortSignal: controller.signal,
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const state = moodleTestState({
        retry_count: 1,
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [
            chapterResource("first", "First chapter", "Topic 1", "primary_lecture"),
            chapterResource("second", "Second chapter", "Topic 2", "primary_lecture"),
          ],
        },
      });

      await expect(createAnalyzerNode(config, codex)(state)).rejects.toBe(timeout);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("First chapter");
      expect(prompts[0]).not.toContain("Second chapter");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("checkpoints on the first tokenless chapter timeout instead of consuming later chapters", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-capacity-checkpoint-"));
    try {
      let calls = 0;
      const codex: CodexClient = {
        async run() {
          calls += 1;
          throw new ModelCallTimeoutError({
            task: "content_analyzer",
            model: "gpt-5.6-luna",
            timeoutMs: 90_000,
            queueWaitMs: 2_000,
          });
        },
      };
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        stage: "extract",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const state = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [
            chapterResource("first", "First chapter", "Topic 1", "primary_lecture"),
            chapterResource("second", "Second chapter", "Topic 2", "primary_lecture"),
          ],
        },
      });

      await expect(createAnalyzerNode(config, codex)(state)).rejects.toThrow(
        "Extraction capacity checkpoint required",
      );
      expect(calls).toBe(1);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("checkpoints before starting a chapter that cannot fit in the remaining run budget", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-checkpoint-chapters-"));
    try {
      let calls = 0;
      const codex: CodexClient = {
        async run() {
          calls += 1;
          throw new Error("Model must not start after checkpoint boundary.");
        },
      };
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        maxRuntimeMs: 10 * 60_000,
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
        executionTelemetry: {
          getSnapshot: () => ({
            startedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
          }),
        } as never,
      });
      const state = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [
            chapterResource("first", "First chapter", "Topic 1", "primary_lecture"),
            chapterResource("second", "Second chapter", "Topic 2", "primary_lecture"),
          ],
        },
      });

      await expect(createAnalyzerNode(config, codex)(state)).rejects.toBeInstanceOf(
        StudyBuddyCheckpointError,
      );
      expect(calls).toBe(0);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("caps quick-answer source context before invoking Codex", async () => {
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return '{"document_title":"Answer","course":{"title":"Course"}}';
      },
    };
    const config = moodleTestConfig({
      intentDecision: {
        intent: "quick_answer",
        wantsPdf: false,
        wantsTypstDocument: false,
        wantsQuickAnswer: true,
        wantsQuizAssistance: false,
        needsMoodle: true,
        needsCis: false,
        needsCalendar: false,
        needsCourseMaterial: false,
        needsDownloadedFiles: false,
        reason: "test",
      },
    });

    await createAnalyzerNode(config, codex)(
      moodleTestState({ moodle_raw_text: "x".repeat(200_000) }),
    );

    expect(receivedPrompt.length).toBeLessThan(40_000);
  });

  it("caches valid chapter handoffs and repairs only the chapter named by review feedback", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-chapters-"));
    try {
      const calls: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          calls.push(prompt);
          const glue = prompt.includes("Kleben");
          const id = glue ? "glue" : "rivet";
          const title = glue ? "Kleben" : "Nieten";
          return JSON.stringify({
            document_title: "MEL",
            language: "de",
            course: { title: "MEL", url: "https://moodle.example/course" },
            sources: [{ id, title, kind: "pdf", url: `https://moodle.example/${id}.pdf`, path: `/tmp/${id}.pdf`, page: 1 }],
            sections: [{ heading: title, summary: `${title} ausführlich erklärt.`, key_concepts: [`${title} anwenden`], source_ids: [id] }],
            formulas: [],
            worked_examples: [{
              origin: "source",
              learning_goal: `${title} berechnen`,
              prompt: `${title} Beispiel`,
              steps: ["Gegebenes erfassen", "Ergebnis bestimmen"],
              result: "Ergebnis",
              source_ids: [id],
            }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("glue", "Foliensatz: Kleben", "Eigenstudium 2", "primary_lecture"),
        chapterResource("glue-solution", "Lösung 5", "Eigenstudium 2", "worked_example"),
        chapterResource("rivet", "Foliensatz: Nietverbindung", "Eigenstudium 3", "primary_lecture"),
        chapterResource("rivet-solution", "Lösung 7", "Eigenstudium 3", "worked_example"),
      ];
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const baseState = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
      });

      const first = await createAnalyzerNode(config, codex)(baseState);
      const repaired = await createAnalyzerNode(config, codex)({
        ...baseState,
        error_log: "Chapter is too shallow: Klebeverbindungen",
      });

      expect(calls).toHaveLength(3);
      expect(first.extracted_data).toMatchObject({ sections: [{ heading: "Kleben" }, { heading: "Nieten" }] });
      expect(repaired.error_log).toBeNull();
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("regenerates the cached dense fragment localized by generic semantic feedback", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-formula-repair-"));
    try {
      const prompts: string[] = [];
      let repairPass = false;
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          const impulse = prompt.includes("Impulssatz");
          const formulaName = impulse ? "Impulssatz" : "Erlösfunktion";
          return JSON.stringify({
            sections: [{
              heading: formulaName,
              summary: `${formulaName} wird mit Voraussetzungen und Kontrolle erklärt.`,
              key_concepts: [formulaName],
              source_ids: [impulse ? "res_impulse" : "res_revenue"],
            }],
            formulas: [{
              name: formulaName,
              typst: impulse ? "dot(P) = sum F" : "E = p q",
              variables: impulse ? ["P: Impuls", "F: äußere Kraft"] : ["E: Erlös", "p: Preis", "q: Menge"],
              units: impulse && !repairPass ? [] : [impulse ? "P: kg m/s; F: N" : "E: EUR; p: EUR/Stück; q: Stück"],
              context: impulse ? "Abgeschlossenes System mit äußeren Kräften." : "Konstanter Stückpreis.",
              source_ids: [impulse ? "res_impulse" : "res_revenue"],
            }],
            worked_examples: [{
              origin: "derived",
              learning_goal: `${formulaName} anwenden`,
              prompt: `${formulaName} anhand gegebener Werte anwenden.`,
              steps: ["Größen mit Einheiten erfassen", "Formel einsetzen", "Ergebnis kontrollieren"],
              result: "Das Ergebnis ist mit Einheit und Kontrolle dokumentiert.",
              source_ids: [impulse ? "res_impulse" : "res_revenue"],
            }],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("impulse", "Impulssatz", "Dynamik", "primary_lecture"),
        chapterResource("revenue", "Erlösfunktion", "Wirtschaft", "primary_lecture"),
      ];
      const evidenceRecords = resources.flatMap((resource) =>
        Array.from({ length: 19 }, (_, index) => ({
          id: `${resource.id}_${index}`,
          resourceId: resource.id,
          kind: "claim" as const,
          locator: { page: index + 1 },
          content: `${resource.title} Formel Definition Beispiel ${index}`,
          confidence: 1,
          pairId: null,
          sourceUrl: resource.originUrl,
          localPath: resource.localPath,
        }))
      );
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const baseState = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: evidenceRecords,
          warnings: [],
        },
      });

      await createAnalyzerNode(config, codex)(baseState);
      const firstPassCalls = prompts.length;
      repairPass = true;
      const repairError = "Semantic quality review failed:\n- [chapter: Dynamik — Impulssatz] Die fachliche Einordnung im Kapitel ist widersprüchlich.";
      await persistPendingExtractionRepairs(runDir, repairError, 1);
      const repaired = await createAnalyzerNode(config, codex)({
        ...baseState,
        error_log: repairError,
        retry_count: 1,
      });

      expect(prompts).toHaveLength(firstPassCalls + 1);
      expect(prompts.at(-1)).toContain("Die fachliche Einordnung im Kapitel ist widersprüchlich.");
      expect(repaired.error_log).toBeNull();
      await expect(readPendingExtractionRepairs(runDir)).resolves.toMatchObject({
        pendingChapterTitles: [],
        completedChapterTitles: ["Dynamik — Impulssatz"],
      });
      const formulas = (repaired.extracted_data as {
        formulas: Array<{ name: string; units: string[] }>;
      } | undefined)?.formulas;
      expect(formulas).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Impulssatz", units: ["P: kg m/s; F: N"] }),
      ]));
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("packs bounded theory and paired practice evidence into one dense-chapter call", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-dense-chapter-"));
    try {
      const schemas: unknown[] = [];
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt, options) {
          schemas.push(options?.outputSchema);
          prompts.push(prompt);
          if (prompt.includes("Teil ")) {
            const practice = prompt.includes("Anwendungsblock");
            return JSON.stringify({
              sections: [{
                heading: practice ? "H7/k6 nachschlagen" : "Toleranzgrundlagen",
                summary: practice ? "Nachschlagen und Grenzmaße berechnen." : "EI, ES, ei und es erklären.",
                key_concepts: practice ? ["TB 2-1 bis TB 2-3"] : ["Toleranzfeld"],
                source_ids: [practice ? "res_task" : "res_theory"],
              }],
              formulas: [],
              worked_examples: practice ? [{
                origin: "source",
                learning_goal: "Tabellenmethode anwenden",
                prompt: "H7/k6 bestimmen",
                steps: ["Nennmaßbereich", "Toleranzgrad", "Grundabmaß", "Grenzmaße"],
                result: "Passungskennwerte bestimmt",
                source_ids: ["res_task"],
              }] : [],
              figures: [],
              warnings: [],
            });
          }
          return JSON.stringify({
            document_title: "MEL",
            language: "de",
            course: { title: "MEL", url: "https://moodle.example/course" },
            sources: [{ id: "glue", title: "Kleben", kind: "pdf", url: null, path: "/tmp/glue.pdf", page: null }],
            sections: [{ heading: "Kleben", summary: "Kleben ausführlich.", key_concepts: ["Überlappung"], source_ids: ["glue"] }],
            formulas: [],
            worked_examples: [{ origin: "derived", learning_goal: "Klebung", prompt: "Klebung", steps: ["Rechnen"], result: "OK", source_ids: ["glue"] }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("theory", "Foliensatz: Toleranzen", "Eigenstudium 1", "primary_lecture"),
        chapterResource("task", "Angabe A", "Eigenstudium 1", "worked_example"),
        chapterResource("glue", "Foliensatz: Kleben", "Eigenstudium 2", "primary_lecture"),
      ];
      const evidenceRecords = Array.from({ length: 19 }, (_, index) => ({
        id: `ev_${index}`,
        resourceId: "res_theory",
        kind: "claim" as const,
        locator: { page: index + 1 },
        content: `Toleranzinhalt ${index}`,
        confidence: 1,
        pairId: null,
        sourceUrl: "https://moodle.example/theory.pdf",
        localPath: "/tmp/theory.pdf",
      }));
      evidenceRecords.push({
        id: "ev_task",
        resourceId: "res_task",
        kind: "claim",
        locator: { page: 1 },
        content: "Angabe und Lösung H7/k6",
        confidence: 1,
        pairId: null,
        sourceUrl: "https://moodle.example/task.pdf",
        localPath: "/tmp/task.pdf",
      });
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        prompt: "Erstelle einen Study Guide für MEL",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const result = await createAnalyzerNode(config, codex)(moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: evidenceRecords,
          warnings: [],
        },
      }));

      expect(schemas[0]).toBe(chapterFragmentJsonSchema);
      expect(schemas[1]).toBe(extractedDataJsonSchema);
      expect(prompts.some((prompt) => prompt.includes("Foliensatz: Toleranzen – Theorieblock"))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes("Angabe A – Anwendungsblock"))).toBe(true);
      expect(result.error_log).toBeNull();
      expect(result.extracted_data).toMatchObject({
        sections: [
          { heading: "H7/k6 nachschlagen" },
          { heading: "Kleben" },
        ],
        worked_examples: [
          { learning_goal: "Tabellenmethode anwenden" },
          { learning_goal: "Klebung" },
        ],
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("uses model-planned domain modules and bounds a large course independently of Moodle session names", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-domain-modules-"));
    try {
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          if (prompt.includes("Teil ")) {
            return JSON.stringify({
              sections: [{
                heading: "Differentialgleichungen lösen",
                summary: "Ein ausführlicher mathematischer Lernabschnitt mit Lösungsstrategie.",
                key_concepts: ["Ansatz auswählen", "Lösung kontrollieren"],
                source_ids: ["res_math"],
              }],
              formulas: [],
              worked_examples: [{
                origin: "source",
                learning_goal: "Eine Differentialgleichung lösen",
                prompt: "Löse eine repräsentative Gleichung.",
                steps: ["Typ erkennen", "Ansatz wählen", "Einsetzen", "Kontrollieren"],
                result: "Die Lösung erfüllt die Gleichung.",
                source_ids: ["res_math"],
              }],
              figures: [],
              warnings: [],
            });
          }
          return JSON.stringify({
            document_title: "Interdisziplinärer Kurs",
            language: "de",
            course: { title: "Kurs", url: "https://moodle.example/course" },
            sources: [{
              id: "res_case",
              title: "Clinical cases",
              kind: "pdf",
              url: "https://moodle.example/case.pdf",
              path: "/tmp/case.pdf",
              page: null,
            }],
            sections: [{
              heading: "Akuten Fall beurteilen",
              summary: "Ein klinischer Fall wird anhand der belegten Befunde strukturiert beurteilt.",
              key_concepts: ["Befunde gewichten", "Entscheidung begründen"],
              source_ids: ["res_case"],
            }],
            formulas: [],
            worked_examples: [{
              origin: "source",
              learning_goal: "Eine Fallvignette beurteilen",
              prompt: "Ordne die Befunde einer Fallvignette ein.",
              steps: ["Leitsymptom", "Differenzialdiagnosen", "Entscheidung"],
              result: "Die Entscheidung ist anhand der Befunde begründet.",
              source_ids: ["res_case"],
            }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            learning_modules: [{
              id: "model-invented-session",
              title: "Präsenz 15",
              priority: "supplementary",
              content_mode: "conceptual",
              learning_objectives: [],
              assessment_signals: [],
              resource_ids: ["res_case"],
            }],
            warnings: [],
          });
        },
      };
      const mathUrl = "https://moodle.example/math.pdf";
      const caseUrl = "https://moodle.example/case.pdf";
      const referenceUrl = "https://moodle.example/course-reference.pdf";
      const resources = [
        chapterResource("math", "Differentialgleichungen", "Präsenz 15", "primary_lecture"),
        chapterResource("case", "Clinical cases", "Präsenz 15", "primary_lecture"),
        chapterResource("reference", "Course-wide reference", "Präsenz 15", "primary_lecture"),
      ].map((resource, index) => ({
        ...resource,
        originUrl: index === 0 ? mathUrl : index === 1 ? caseUrl : referenceUrl,
        selection: index === 2 ? { ...resource.selection!, role: "external_reference" as const } : resource.selection,
      }));
      const denseMathEvidence = Array.from({ length: 80 }, (_, index) => ({
        id: `ev_math_${index}`,
        resourceId: "res_math",
        kind: "claim" as const,
        locator: { page: index + 1 },
        content: `Differentialgleichung Lösungsweg Prüfung ${index} ${"x".repeat(1_000)}`,
        confidence: 1,
        pairId: null,
        sourceUrl: mathUrl,
        localPath: "/tmp/math.pdf",
      }));
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        executionProfile: "balanced",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "interactive_learning" },
      });
      const state = moodleTestState({
        source_architect_decision: {
          round: 1,
          status: "sufficient",
          coverageSummary: "Two domain modules are covered.",
          requestedUrls: [],
          remainingAvailable: 0,
          reasons: [],
          learningArchitecture: {
            schemaVersion: 1,
            modules: [{
              id: "differential-equations",
              title: "Differentialgleichungen",
              priority: "essential",
              contentMode: "quantitative",
              learningObjectives: ["Gleichungen lösen und kontrollieren"],
              assessmentSignals: ["Prüfungsaufgaben"],
              resourceUrls: [mathUrl],
            }, {
              id: "acute-cases",
              title: "Akute Fallbeurteilung",
              priority: "essential",
              contentMode: "case_based",
              learningObjectives: ["Fallvignetten begründet beurteilen"],
              assessmentSignals: ["Fallprüfung"],
              resourceUrls: [caseUrl],
            }],
            supportResources: [{
              id: "course-reference",
              title: "Course-wide reference",
              purpose: "general_reference",
              resourceUrls: [referenceUrl],
            }],
            excludedResourceUrls: [],
          },
        },
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: [...denseMathEvidence, {
            id: "ev_case",
            resourceId: "res_case",
            kind: "exercise" as const,
            locator: { page: 1 },
            content: "Fallvignette mit Leitsymptom, Befunden und begründeter Entscheidung.",
            confidence: 1,
            pairId: null,
            sourceUrl: caseUrl,
            localPath: "/tmp/case.pdf",
          }, {
            id: "ev_reference",
            resourceId: "res_reference",
            kind: "claim" as const,
            locator: { page: 1 },
            content: "GLOBAL_REFERENCE_SENTINEL with course-wide explanatory material.",
            confidence: 1,
            pairId: null,
            sourceUrl: referenceUrl,
            localPath: "/tmp/reference.pdf",
          }],
          warnings: [],
        },
      });

      const result = await createAnalyzerNode(config, codex)(state);
      const fragmentPrompts = prompts.filter((prompt) => prompt.includes("Teil "));

      expect(fragmentPrompts.length).toBeLessThanOrEqual(2);
      expect(prompts.some((prompt) => prompt.includes("Lernmodus: quantitative"))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes("Learning mode: case_based"))).toBe(true);
      expect(prompts.filter((prompt) => prompt.includes("GLOBAL_REFERENCE_SENTINEL")).length)
        .toBeGreaterThanOrEqual(2);
      expect(result.error_log).toBeNull();
      expect(result.extracted_data).toMatchObject({
        learning_modules: [
          { title: "Differentialgleichungen", content_mode: "quantitative" },
          { title: "Akute Fallbeurteilung", content_mode: "case_based" },
        ],
      });
      expect(JSON.stringify(result.extracted_data)).not.toContain("Präsenz 15");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("exhausts the retry budget immediately for deterministic model errors", async () => {
    const codex: CodexClient = {
      async run() {
        throw new NonRetryableCodexError(
          "Model requires a newer version of Codex.",
          "model_incompatible",
        );
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({ retry_count: 0 }),
    );

    expect(result.error_log).toContain("Analyzer failed (non-retryable)");
    expect(result.retry_count).toBe(3);
  });

  it.each([
    [new Error("This model requires a newer version of Codex"), "model_incompatible"],
    [new Error("Update your Codex version to use this model"), "model_incompatible"],
    [new Error("Unsupported model: gpt-future"), "model_unavailable"],
    [{ status: 404, error: { code: "model_not_found" } }, "model_unavailable"],
    [{ statusCode: 401, message: "Unauthorized" }, "authentication"],
    [new Error("Auth failed: not logged in"), "authentication"],
    [{ response: { status: 400 }, message: "Invalid request" }, "invalid_request"],
  ])("classifies deterministic SDK rejection %# as non-retryable", (error, category) => {
    expect(classifyCodexError(error)).toEqual({ category, retryable: false });
  });

  it.each([
    [new Error("Selected model is at capacity. Please try a different model."), "model_capacity"],
    [new Error("rate limit exceeded"), "rate_limit"],
    [new Error("network connection reset"), "network"],
    [new Error("temporary service issue"), "unknown"],
  ])("leaves transient/unknown error %# retryable", (error, category) => {
    expect(classifyCodexError(error)).toEqual({ category, retryable: true });
  });
});

function chapterResource(
  id: string,
  title: string,
  section: string,
  role: "primary_lecture" | "worked_example",
) {
  return {
    id: `res_${id}`,
    parentId: null,
    sectionPath: [section],
    activityType: "resource",
    title,
    originUrl: `https://moodle.example/${id}.pdf`,
    resolvedUrl: null,
    localPath: `/tmp/${id}.pdf`,
    previewPath: null,
    status: "acquired" as const,
    checksum: id,
    verifiedAt: null,
    examRelevance: "unknown" as const,
    failureReason: null,
    selection: { selected: true, role, topic: null, priority: 1, reason: "test" },
  };
}
