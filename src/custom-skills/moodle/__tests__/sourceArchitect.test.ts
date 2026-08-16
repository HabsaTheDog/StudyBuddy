import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import {
  createSourceArchitectNode,
  canPublishWithDocumentedSourceGaps,
  isLookupOnlySourceBlock,
  reconcileLearningArchitectureWithCatalog,
  routeAfterSourceArchitect,
} from "../sourceArchitect.js";
import { stableResourceId } from "../resourceManifest.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("source architect", () => {
  it("demotes administrative containers and adds newly selected subject modules", () => {
    const pointUrl = "https://moodle.example/point.pdf";
    const vectorUrl = "https://moodle.example/vector.pdf";
    const balanceUrl = "https://moodle.example/balance.pdf";
    const overviewUrl = "https://moodle.example/overview.pdf";
    const architecture = {
      schemaVersion: 1 as const,
      modules: [{
        id: "point",
        title: "Punktkinematik",
        priority: "essential" as const,
        contentMode: "mixed" as const,
        learningObjectives: ["Punktbewegungen berechnen."],
        assessmentSignals: [],
        resourceUrls: [pointUrl],
      }, {
        id: "communication",
        title: "LV-Kommunikation",
        priority: "important" as const,
        contentMode: "conceptual" as const,
        learningObjectives: ["Explain LV-Kommunikation."],
        assessmentSignals: [],
        resourceUrls: [overviewUrl],
      }],
      supportResources: [{
        id: "overview",
        title: "Dynamik Überblick",
        purpose: "general_reference" as const,
        resourceUrls: [overviewUrl],
      }],
      excludedResourceUrls: [],
    };
    const catalog = [
      { ...entry(pointUrl, "Punktkinematik", true, 890), role: "primary_lecture" as const, topic: "Punktkinematik" },
      { ...entry(vectorUrl, "Vektorkinematik", true, 890), role: "primary_lecture" as const, topic: "Vektorkinematik" },
      { ...entry(balanceUrl, "Schwerpunktsatz", true, 890), role: "primary_lecture" as const, topic: "Schwerpunktsatz" },
      { ...entry(overviewUrl, "Dynamik Überblick", true, 1000), role: "overview" as const, topic: null, sectionTitle: "LV-Kommunikation" },
    ];

    const reconciled = reconcileLearningArchitectureWithCatalog(architecture, catalog);
    const titles = reconciled.modules.map((module) => module.title);

    expect(titles).toEqual(expect.arrayContaining([
      "Punktkinematik",
      "Vektorkinematik",
      "Schwerpunktsatz",
    ]));
    expect(titles).not.toContain("LV-Kommunikation");
    expect(reconciled.supportResources.flatMap((support) => support.resourceUrls))
      .toContain(overviewUrl);
  });

  it("restores an unselected but explicitly classified primary course topic", () => {
    const pointUrl = "https://moodle.example/point.pdf";
    const massGeometryUrl = "https://moodle.example/mass-geometry.pdf";
    const architecture = {
      schemaVersion: 1 as const,
      modules: [{
        id: "point",
        title: "Punktkinematik",
        priority: "essential" as const,
        contentMode: "quantitative" as const,
        learningObjectives: ["Punktbewegungen berechnen."],
        assessmentSignals: [],
        resourceUrls: [pointUrl],
      }],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const catalog = [
      { ...entry(pointUrl, "Punktkinematik", true, 890), role: "primary_lecture" as const, topic: "Punktkinematik" },
      {
        ...entry(massGeometryUrl, "Wiederholung_Massengeometrie", false, 890),
        role: "primary_lecture" as const,
        topic: "Massengeometrie",
      },
    ];

    const reconciled = reconcileLearningArchitectureWithCatalog(architecture, catalog, "de");

    expect(reconciled.modules.map((module) => module.title)).toEqual([
      "Punktkinematik",
      "Massengeometrie",
    ]);
    expect(reconciled.modules.flatMap((module) => module.resourceUrls)).toContain(massGeometryUrl);
    expect(reconciled.modules[1].learningObjectives.join(" ")).not.toMatch(/\b(?:Explain|Apply)\b/);
  });

  it("orders modules by their primary lecture instead of a shared overview", () => {
    const overviewUrl = "https://moodle.example/overview.pdf";
    const pointUrl = "https://moodle.example/point.pdf";
    const massUrl = "https://moodle.example/mass.pdf";
    const architecture = {
      schemaVersion: 1 as const,
      modules: [{
        id: "mass",
        title: "Schwerpunktberechnung",
        priority: "essential" as const,
        contentMode: "mixed" as const,
        learningObjectives: ["Schwerpunkte bestimmen."],
        assessmentSignals: [],
        resourceUrls: [overviewUrl, massUrl],
      }, {
        id: "point",
        title: "Punktkinematik",
        priority: "essential" as const,
        contentMode: "quantitative" as const,
        learningObjectives: ["Punktbewegungen berechnen."],
        assessmentSignals: [],
        resourceUrls: [pointUrl],
      }],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const catalog = [
      { ...entry(overviewUrl, "DYN2 Überblick", true, 1000), role: "overview" as const },
      { ...entry(pointUrl, "Punktkinematik", true, 900), role: "primary_lecture" as const, topic: "Punktkinematik" },
      { ...entry(massUrl, "Massengeometrie", true, 900), role: "primary_lecture" as const, topic: "Massengeometrie" },
    ];

    const reconciled = reconcileLearningArchitectureWithCatalog(architecture, catalog, "de");

    expect(reconciled.modules.map((module) => module.title)).toEqual([
      "Punktkinematik",
      "Schwerpunktberechnung",
    ]);
  });

  it("attaches one shared primary lecture to every matching submodule", () => {
    const overviewUrl = "https://moodle.example/overview.pdf";
    const pointUrl = "https://moodle.example/point.pdf";
    const massUrl = "https://moodle.example/mass.pdf";
    const architecture = {
      schemaVersion: 1 as const,
      modules: [{
        id: "massenschwerpunkte",
        title: "Massenmittelpunkte bestimmen",
        priority: "essential" as const,
        contentMode: "mixed" as const,
        learningObjectives: ["Massenschwerpunkte berechnen."],
        assessmentSignals: [],
        resourceUrls: [overviewUrl],
      }, {
        id: "massentraegheit",
        title: "Massenträgheitsmomente aufbauen",
        priority: "essential" as const,
        contentMode: "quantitative" as const,
        learningObjectives: ["Massenträgheitsmomente bestimmen."],
        assessmentSignals: [],
        resourceUrls: [overviewUrl],
      }, {
        id: "punktkinematik",
        title: "Punktkinematik",
        priority: "essential" as const,
        contentMode: "quantitative" as const,
        learningObjectives: ["Punktbewegungen berechnen."],
        assessmentSignals: [],
        resourceUrls: [pointUrl],
      }],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const catalog = [
      { ...entry(overviewUrl, "DYN2 Überblick", true, 1000), role: "overview" as const },
      { ...entry(pointUrl, "Punktkinematik", true, 900), role: "primary_lecture" as const, topic: "Punktkinematik" },
      { ...entry(massUrl, "Wiederholung Massengeometrie", true, 900), role: "primary_lecture" as const, topic: "Massengeometrie" },
    ];

    const reconciled = reconcileLearningArchitectureWithCatalog(architecture, catalog, "de");
    const massModules = reconciled.modules.filter((module) => module.id.startsWith("massen"));

    expect(massModules).toHaveLength(2);
    expect(massModules.every((module) => module.resourceUrls.includes(massUrl))).toBe(true);
    expect(reconciled.modules.map((module) => module.id)).toEqual([
      "punktkinematik",
      "massenschwerpunkte",
      "massentraegheit",
    ]);
  });

  it("lets the source architect interpret a numbered Moodle syllabus without fixed grouping", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-numbered-outline-"));
    directories.push(runDir);
    const sequenceUrl = "https://moodle.example/studienbrief-6.pdf";
    const derivativeUrl = "https://moodle.example/studienbrief-20.pdf";
    const integralUrl = "https://moodle.example/studienbrief-22.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(sequenceUrl, "Studienbrief 6 „Folgen und Reihen“", false, 150), role: "supplementary" },
        { ...entry(derivativeUrl, "Studienbrief 20 „Differentialrechnung I“", false, 150), role: "supplementary" },
        { ...entry(integralUrl, "Studienbrief 22 „Integralrechnung“", false, 150), role: "supplementary" },
      ],
    }));
    const state = moodleTestState({
      moodle_raw_text: [
        "THEMA 1: FOLGEN UND REIHEN",
        "In dieser Selbststudienphase lernen Sie Folgen und Reihen.",
        "6.1 Folgen",
        "6.2 Reihen",
        "Übungsaufgaben zu Thema 1",
        "THEMA 2: GRUNDLAGEN DER DIFFERENTIALRECHNUNG",
        "In dieser Selbststudienphase lernen Sie Grenzwerte und Ableitungen.",
        "20.1 Grenzwert und Stetigkeit",
        "20.2 Ableitung",
        "Minitest 2",
        "THEMA 3: ANWENDUNGEN DER DIFFERENTIALRECHNUNG",
        "In dieser Selbststudienphase lernen Sie Ableitungen anzuwenden.",
        "20.3 Berechnung von Ableitungen",
        "Übungsaufgaben zu Thema 3",
        "THEMA 4: INTEGRALRECHNUNG",
        "In dieser Selbststudienphase lernen Sie Stammfunktionen.",
        "22.1 Stammfunktion",
        "Übungsaufgaben zu Thema 4",
      ].join("\n"),
    });
    const codex = { run: vi.fn().mockResolvedValue(JSON.stringify({
      status: "request_more",
      coverage_summary: "Four course topics require their direct study letters.",
      requested_urls: [sequenceUrl, derivativeUrl, integralUrl],
      reasons: ["Preserve the visible course topics."],
      learning_architecture: {
        schemaVersion: 1,
        modules: [
          { id: "t1", title: "Thema 1: Folgen und Reihen", priority: "essential", contentMode: "mixed", learningObjectives: ["Folgen und Reihen"], assessmentSignals: [], resourceUrls: [sequenceUrl] },
          { id: "t2", title: "Thema 2: Grundlagen der Differentialrechnung", priority: "essential", contentMode: "mixed", learningObjectives: ["Grenzwerte und Ableitungen"], assessmentSignals: ["Minitest 2"], resourceUrls: [derivativeUrl] },
          { id: "t3", title: "Thema 3: Anwendungen der Differentialrechnung", priority: "important", contentMode: "mixed", learningObjectives: ["Ableitungen anwenden"], assessmentSignals: ["Übungsaufgaben zu Thema 3"], resourceUrls: [derivativeUrl] },
          { id: "t4", title: "Thema 4: Integralrechnung", priority: "important", contentMode: "mixed", learningObjectives: ["Stammfunktionen"], assessmentSignals: [], resourceUrls: [integralUrl] },
        ],
        supportResources: [],
        excludedResourceUrls: [],
      },
    })) };
    const prompt = "Create a complete course study guide";
    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      runtimeCacheDir: runDir,
      prompt,
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    }), codex)(state);

    expect(codex.run).toHaveBeenCalledOnce();
    expect(result.source_architect_decision?.learningArchitecture?.modules.map((module) =>
      module.title
    )).toEqual([
      "Thema 1: Folgen und Reihen",
      "Thema 2: Grundlagen der Differentialrechnung",
      "Thema 3: Anwendungen der Differentialrechnung",
      "Thema 4: Integralrechnung",
    ]);
    expect(result.source_architect_decision).toMatchObject({
      status: "request_more",
      requestedUrls: [sequenceUrl, derivativeUrl, integralUrl],
    });
  });

  it("reuses architecture when only volatile catalog metadata or order changes", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-cache-"));
    directories.push(rootDir);
    const firstRunDir = path.join(rootDir, "first");
    const secondRunDir = path.join(rootDir, "second");
    const cacheDir = path.join(rootDir, "cache");
    await Promise.all([mkdir(firstRunDir), mkdir(secondRunDir)]);
    const acquiredUrl = "https://moodle.example/calculus.pdf";
    const requestedUrl = "https://moodle.example/differential-equations.pdf";
    const firstEntries = [
      { ...entry(acquiredUrl, "Calculus", true, 1000), topic: "calculus" },
      { ...entry(requestedUrl, "Differential equations", false, 900), topic: "ode" },
    ];
    const secondEntries = [
      { ...firstEntries[1], label: "DGL Skript", selected: true, topic: "changed hint" },
      { ...firstEntries[0], label: "Analysis notes", selected: false, role: "primary_lecture" },
    ];
    await Promise.all([
      writeFile(path.join(firstRunDir, "resource-catalog.json"), JSON.stringify({
        schemaVersion: 1,
        entries: firstEntries,
      })),
      writeFile(path.join(secondRunDir, "resource-catalog.json"), JSON.stringify({
        schemaVersion: 1,
        entries: secondEntries,
      })),
    ]);
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(
            stableResourceId(acquiredUrl),
            acquiredUrl,
            "Calculus",
            "Course",
            "/tmp/calculus.pdf",
            "primary_lecture",
          ),
          resource(
            stableResourceId(requestedUrl),
            requestedUrl,
            "Differential equations",
            "Course",
            null,
            "primary_lecture",
          ),
        ],
      },
    });
    const architecture = {
      schemaVersion: 1,
      modules: [
        {
          id: "calculus",
          title: "Calculus",
          priority: "essential",
          contentMode: "quantitative",
          learningObjectives: ["Apply calculus."],
          assessmentSignals: ["Course exercise"],
          resourceUrls: [acquiredUrl],
        },
        {
          id: "differential-equations",
          title: "Differential equations",
          priority: "essential",
          contentMode: "quantitative",
          learningObjectives: ["Solve differential equations."],
          assessmentSignals: ["Course exercise"],
          resourceUrls: [requestedUrl],
        },
      ],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const coldCodex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "request_more",
        coverage_summary: "Differential equations remain.",
        requested_urls: [requestedUrl],
        reasons: ["Direct course evidence is required."],
        learning_architecture: architecture,
      })),
    };
    const prompt = "Create a complete calculus study guide";
    const baseConfig = {
      runtimeCacheDir: cacheDir,
      prompt,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "extract" as const,
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    };
    await createSourceArchitectNode(moodleTestConfig({
      ...baseConfig,
      runDir: firstRunDir,
    }), coldCodex)(state);

    const warmCodex = { run: vi.fn() };
    const warm = await createSourceArchitectNode(moodleTestConfig({
      ...baseConfig,
      runDir: secondRunDir,
    }), warmCodex)(state);

    expect(coldCodex.run).toHaveBeenCalledTimes(1);
    expect(warmCodex.run).not.toHaveBeenCalled();
    expect(warm.source_architect_decision).toMatchObject({
      status: "request_more",
      requestedUrls: [requestedUrl],
    });
    expect(warm.source_architect_decision?.reasons).toContain(
      "Reused the course-and-prompt keyed source architecture cache.",
    );
  });

  it("adds an omitted high-priority overview to the architecture and exact request set", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-overview-gate-"));
    directories.push(runDir);
    const acquiredUrl = "https://moodle.example/calculus.pdf";
    const omittedUrl = "https://moodle.example/differential-equations.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        entry(acquiredUrl, "Calculus", true, 1000),
        { ...entry(omittedUrl, "Differential equations", false, 1000), role: "overview" },
      ],
    }));
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(
            stableResourceId(acquiredUrl),
            acquiredUrl,
            "Calculus",
            "Course",
            "/tmp/calculus.pdf",
            "primary_lecture",
          ),
          resource(
            stableResourceId(omittedUrl),
            omittedUrl,
            "Differential equations",
            "Course",
            null,
            "primary_lecture",
          ),
        ],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "sufficient",
        coverage_summary: "Calculus is covered.",
        requested_urls: [],
        reasons: [],
        learning_architecture: {
          schemaVersion: 1,
          modules: [{
            id: "calculus",
            title: "Calculus",
            priority: "essential",
            contentMode: "quantitative",
            learningObjectives: ["Apply calculus."],
            assessmentSignals: ["Course exercise"],
            resourceUrls: [acquiredUrl],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      })),
    };

    const prompt = "Create a complete calculus study guide";
    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      runtimeCacheDir: runDir,
      prompt,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    }), codex)(state);

    expect(result.source_architect_decision).toMatchObject({
      status: "request_more",
      requestedUrls: [omittedUrl],
    });
    expect(result.source_architect_decision?.learningArchitecture?.modules
      .map((module) => module.title)).toContain("Differential equations");
  });

  it("does not add representative examples when the planning model omits them", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-essential-module-sources-"));
    directories.push(runDir);
    const oscillationLectureUrl = "https://moodle.example/schwingungen.pdf";
    const angularMomentumLectureUrl = "https://moodle.example/drallsatz.pdf";
    const pendulumUrl = "https://moodle.example/physikalisches-pendel.pdf";
    const brakeUrl = "https://moodle.example/bandbremse.pdf";
    const compositeOscillatorUrl = "https://moodle.example/stab-mit-feder.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(oscillationLectureUrl, "Folien Schwingungen", true, 900), role: "primary_lecture", topic: "Schwingungen" },
        { ...entry(angularMomentumLectureUrl, "Folien Drallsatz", true, 900), role: "primary_lecture", topic: "Drallsatz" },
        { ...entry(compositeOscillatorUrl, "Stab mit Feder", false, 700), role: "worked_example", topic: "Schwingungen" },
        { ...entry(pendulumUrl, "Physikalisches Pendel", false, 600), role: "worked_example", topic: "Schwingungen" },
        { ...entry(brakeUrl, "Bandbremse", false, 600), role: "worked_example", topic: "Drallsatz" },
      ],
    }));
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(
            stableResourceId(oscillationLectureUrl),
            oscillationLectureUrl,
            "Folien Schwingungen",
            "Schwingungen",
            "/tmp/schwingungen.pdf",
            "primary_lecture",
          ),
          resource(
            stableResourceId(angularMomentumLectureUrl),
            angularMomentumLectureUrl,
            "Folien Drallsatz",
            "Drallsatz",
            "/tmp/drallsatz.pdf",
            "primary_lecture",
          ),
        ],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "sufficient",
        coverage_summary: "The lecture is present.",
        requested_urls: [],
        reasons: [],
        learning_architecture: {
          schemaVersion: 1,
          modules: [{
            id: "schwingungen",
            title: "Schwingungen",
            priority: "essential",
            contentMode: "mixed",
            learningObjectives: ["Lineare und rotatorische Schwinger auswerten."],
            assessmentSignals: ["Eigenfrequenzen bestimmen."],
            resourceUrls: [oscillationLectureUrl],
          }, {
            id: "drallsatz",
            title: "Drallsatz",
            priority: "essential",
            contentMode: "mixed",
            learningObjectives: ["Rotationsdynamische Aufgaben lösen."],
            assessmentSignals: ["Momentenbilanzen aufstellen."],
            resourceUrls: [angularMomentumLectureUrl],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      })),
    };
    const prompt = "Create a complete dynamics study guide";

    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      runtimeCacheDir: runDir,
      prompt,
      executionProfile: "balanced",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    }), codex)(state);

    expect(result.source_architect_decision).toMatchObject({ status: "sufficient", requestedUrls: [] });
  });

  it("does not turn unrequested worked examples into mandatory source acquisition", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-prompt-scoped-examples-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.example/drallsatz.pdf";
    const exampleUrl = "https://moodle.example/beispiel-rolle.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "4_Folien_Drallsatz", false, 900), role: "primary_lecture", topic: "Drallsatz" },
        { ...entry(exampleUrl, "4_Beispiel_Rolle_mit_Antrieb", false, 800), role: "worked_example", topic: "Drallsatz" },
      ],
    }));
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "request_more",
        coverage_summary: "Drallsatz evidence is needed.",
        requested_urls: [lectureUrl, exampleUrl],
        reasons: ["Acquire the lecture and a representative example."],
        learning_architecture: {
          schemaVersion: 1,
          modules: [{
            id: "drallsatz",
            title: "Drallsatz",
            priority: "essential",
            contentMode: "quantitative",
            learningObjectives: ["Momentenbilanzen und Rechenwege erklären."],
            assessmentSignals: ["Drallsatz anwenden."],
            resourceUrls: [lectureUrl, exampleUrl],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      })),
    };
    const prompt = "Erstelle ein kompaktes PDF mit Rechenarten und Formelherleitungen.";

    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      runtimeCacheDir: runDir,
      prompt,
      artifactIntent: {
        ...moodleTestConfig().artifactIntent,
        profile: "study_guide",
      },
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    }), codex)(moodleTestState());

    expect(result.source_architect_decision).toMatchObject({
      status: "request_more",
      requestedUrls: [lectureUrl, exampleUrl],
    });
    const architectPrompt = codex.run.mock.calls[0]?.[0] as string;
    expect(architectPrompt).toContain("lecture-only coverage is not sufficient");
    expect(architectPrompt).toContain("complete nonredundant set of practice sources");
    expect(architectPrompt).toContain("Do not minimize away a distinct task");
    expect(architectPrompt).not.toContain("smallest exact URL set");
    expect(architectPrompt).toContain("Do not impose a universal task count");
  });

  it("preserves first-round module boundaries while deterministically acquiring remaining assignments", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-stable-"));
    directories.push(runDir);
    const acquiredUrl = "https://moodle.example/module-one.pdf";
    const missingUrl = "https://moodle.example/module-two.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        entry(acquiredUrl, "Module one", true, 900),
        entry(missingUrl, "Module two", false, 850),
      ],
    }));
    const architecture = {
      schemaVersion: 1 as const,
      modules: [
        {
          id: "one",
          title: "Module one",
          priority: "essential" as const,
          contentMode: "conceptual" as const,
          learningObjectives: ["Explain module one."],
          assessmentSignals: ["Course exercise one"],
          resourceUrls: [acquiredUrl],
        },
        {
          id: "two",
          title: "Module two",
          priority: "essential" as const,
          contentMode: "procedural" as const,
          learningObjectives: ["Apply module two."],
          assessmentSignals: ["Course exercise two"],
          resourceUrls: [missingUrl],
        },
      ],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const state = moodleTestState({
      source_architect_decision: {
        round: 1,
        status: "request_more",
        coverageSummary: "Module two remains.",
        requestedUrls: [acquiredUrl],
        remainingAvailable: 1,
        reasons: [],
        learningArchitecture: architecture,
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(
            stableResourceId(acquiredUrl),
            acquiredUrl,
            "Module one",
            "Course",
            "/tmp/module-one.pdf",
            "primary_lecture",
          ),
          resource(
            stableResourceId(missingUrl),
            missingUrl,
            "Module two",
            "Course",
            null,
            "primary_lecture",
          ),
        ],
      },
    });
    const codex = { run: vi.fn() };

    const result = await createSourceArchitectNode(moodleTestConfig({ runDir }), codex)(state);

    expect(codex.run).not.toHaveBeenCalled();
    expect(result.source_architect_decision).toMatchObject({
      round: 2,
      status: "request_more",
      requestedUrls: [missingUrl],
      learningArchitecture: architecture,
    });
  });

  it("continues draining a finite selected source set beyond two operational batches", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-multi-batch-"));
    directories.push(runDir);
    const urls = Array.from({ length: 25 }, (_, index) =>
      `https://moodle.example/practice-${index + 1}.pdf`
    );
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: urls.map((url, index) => ({
        ...entry(url, `Practice ${index + 1}`, index < 12, 900 - index),
        role: "worked_example",
      })),
    }));
    const architecture = {
      schemaVersion: 1 as const,
      modules: [{
        id: "practice",
        title: "Course practice",
        priority: "essential" as const,
        contentMode: "mixed" as const,
        learningObjectives: ["Apply the evidenced course methods."],
        assessmentSignals: ["Course practice"],
        resourceUrls: urls,
      }],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const state = moodleTestState({
      source_architect_decision: {
        round: 2,
        status: "request_more",
        coverageSummary: "Two operational batches have started.",
        requestedUrls: urls.slice(0, 12),
        remainingAvailable: 13,
        reasons: [],
        learningArchitecture: architecture,
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: urls.map((url, index) => resource(
          stableResourceId(url),
          url,
          `Practice ${index + 1}`,
          "Course practice",
          index < 12 ? `/tmp/practice-${index + 1}.pdf` : null,
          "worked_example",
        )),
      },
    });
    const codex = { run: vi.fn() };

    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      executionProfile: "balanced",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
    }), codex)(state);

    expect(codex.run).not.toHaveBeenCalled();
    expect(result.source_architect_decision).toMatchObject({
      round: 3,
      status: "request_more",
    });
    expect(result.source_architect_decision?.requestedUrls).toHaveLength(12);
    expect(result.source_architect_decision?.requestedUrls.every((url) => urls.slice(12).includes(url))).toBe(true);
  });

  it("reassesses remaining practice evidence after a full first acquisition batch for an interactive guide", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-practice-reassessment-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.example/oscillations-lecture.pdf";
    const acquiredExampleUrl = "https://moodle.example/forced-oscillation-example.pdf";
    const remainingExampleUrl = "https://moodle.example/physical-pendulum-example.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "Oscillations lecture", true, 900), role: "primary_lecture", topic: "Oscillations" },
        { ...entry(acquiredExampleUrl, "Forced oscillation example", true, 700), role: "worked_example", topic: "Oscillations" },
        { ...entry(remainingExampleUrl, "Physical pendulum example", false, 690), role: "worked_example", topic: "Oscillations" },
      ],
    }));
    const architecture = {
      schemaVersion: 1 as const,
      modules: [{
        id: "oscillations",
        title: "Oscillations",
        priority: "essential" as const,
        contentMode: "quantitative" as const,
        learningObjectives: ["Model and compare oscillating systems."],
        assessmentSignals: ["Solve course applications."],
        resourceUrls: [lectureUrl, acquiredExampleUrl],
      }],
      supportResources: [],
      excludedResourceUrls: [],
    };
    const baseContract = moodleTestState().request_contract;
    const state = moodleTestState({
      request_contract: {
        ...baseContract,
        deliverables: [{ id: "interactive-guide", kind: "interactive learning artifact", purpose: "Self-check" }],
        requirements: [{ ...baseContract.requirements[0]!, appliesTo: ["interactive-guide"] }],
        reviewAssignments: [
          ...baseContract.reviewAssignments,
          { owner: "interaction", requirementIds: ["original-request"], checks: ["Learners can answer and review items."] },
        ],
      },
      source_architect_decision: {
        round: 1,
        status: "request_more",
        coverageSummary: "The first practice batch was acquired.",
        requestedUrls: [acquiredExampleUrl],
        remainingAvailable: 1,
        reasons: [],
        learningArchitecture: architecture,
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(stableResourceId(lectureUrl), lectureUrl, "Oscillations lecture", "Oscillations", "/tmp/lecture.pdf", "primary_lecture"),
          resource(stableResourceId(acquiredExampleUrl), acquiredExampleUrl, "Forced oscillation example", "Oscillations", "/tmp/example.pdf", "worked_example"),
        ],
      },
    });
    const codex = { run: vi.fn().mockResolvedValue(JSON.stringify({
      status: "request_more",
      coverage_summary: "The physical pendulum adds a distinct evidenced model.",
      requested_urls: [remainingExampleUrl],
      reasons: ["It is not redundant with the acquired forced-oscillation task."],
      learning_architecture: architecture,
    })) };

    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      prompt: "Create an interactive exam study guide",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create an interactive exam study guide",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    }), codex)(state);

    expect(codex.run).toHaveBeenCalledTimes(1);
    expect(result.source_architect_decision).toMatchObject({
      round: 2,
      status: "request_more",
      requestedUrls: [remainingExampleUrl],
    });
  });

  it("does not turn unacquired catalog entries into deterministic learning modules", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-fallback-"));
    directories.push(runDir);
    const acquiredUrl = "https://moodle.example/differential-equations.pdf";
    const failedUrl = "https://moodle.example/unread-week-15.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(acquiredUrl, "Differential equations", true, 900), role: "primary_lecture" },
        { ...entry(failedUrl, "Unread catalog topic", false, 800), role: "primary_lecture" },
      ],
    }));
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(stableResourceId(acquiredUrl), acquiredUrl, "Differential equations", "Course", "/tmp/differential.pdf", "primary_lecture"),
          { ...resource(stableResourceId(failedUrl), failedUrl, "Unread catalog topic", "Course", null, "primary_lecture"), status: "failed", failureReason: "download failed" },
        ],
      },
      evidence_package: {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        records: [{
          id: "ev_diff",
          resourceId: stableResourceId(acquiredUrl),
          kind: "claim",
          locator: { page: 1 },
          content: "Solve and check first-order differential equations.",
          confidence: 1,
          pairId: null,
          sourceUrl: acquiredUrl,
          localPath: "/tmp/differential.pdf",
        }],
        warnings: [],
      },
    });

    const result = await createSourceArchitectNode(moodleTestConfig({ runDir }), { run: vi.fn() })(state);
    const titles = result.source_architect_decision?.learningArchitecture?.modules.map((module) => module.title);
    expect(titles).toContain("Differential equations");
    expect(titles).not.toContain("Unread catalog topic");
  });

  it("recognizes a direct block whose only unresolved issue is visual lookup verification", () => {
    expect(isLookupOnlySourceBlock({
      round: 3,
      status: "blocked",
      coverageSummary: "Die fünf Fachkapitel sind inhaltlich abgedeckt. Nicht ausreichend ist nur die lesbare Tabelle TB 2-1 bis TB 2-3.",
      requestedUrls: [],
      remainingAvailable: 10,
      reasons: ["Die Tabelle muss visuell geprüft werden."],
    })).toBe(true);
  });

  it("publishes documented isolated gaps when every learning module has acquired evidence", () => {
    const acquiredUrl = "https://moodle.example/module-one.pdf";
    const state = moodleTestState({
      coverage_assessment: {
        status: "partial",
        detail: "One stale exercise solution is unavailable.",
        criticalMissing: [],
        omittedTopics: ["Optional exercise solution"],
        retryActions: [],
        discoveredResources: 2,
        acquiredResources: 1,
        failedResources: 1,
        usableEvidenceRecords: 5,
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [resource(
          stableResourceId(acquiredUrl),
          acquiredUrl,
          "Module one",
          "Module one",
          "/tmp/module-one.pdf",
          "primary_lecture",
        )],
      },
    });
    expect(canPublishWithDocumentedSourceGaps(state, {
      round: 4,
      status: "blocked",
      coverageSummary: "All course chapters have evidence; one exercise solution is stale.",
      requestedUrls: [],
      remainingAvailable: 0,
      reasons: ["The unavailable solution is documented."],
      learningArchitecture: {
        schemaVersion: 1,
        modules: [{
          id: "module-one",
          title: "Module one",
          priority: "essential",
          contentMode: "conceptual",
          learningObjectives: ["Explain the module."],
          assessmentSignals: ["Course exercise"],
          resourceUrls: [acquiredUrl],
        }],
        supportResources: [],
        excludedResourceUrls: [],
      },
    })).toBe(true);
  });

  it("requests exact missing catalog resources from compact document briefs", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-architect-"));
    directories.push(runDir);
    const acquiredUrl = "https://moodle.technikum-wien.at/pluginfile.php/1/overview.pdf";
    const requestedUrl = "https://moodle.technikum-wien.at/pluginfile.php/1/chapter-two.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        entry(acquiredUrl, "Overview", true, 1000),
        entry(requestedUrl, "Chapter two", false, 900),
      ],
    }));
    const acquiredId = stableResourceId(acquiredUrl);
    const state = moodleTestState({
      source_architect_decision: {
        round: 1,
        status: "request_more",
        coverageSummary: "A second planned acquisition round is needed.",
        requestedUrls: [],
        remainingAvailable: 1,
        reasons: [],
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.technikum-wien.at/course/view.php?id=1",
        generatedAt: new Date().toISOString(),
        resources: [{
          id: acquiredId,
          parentId: null,
          sectionPath: ["Chapter one - tolerances"],
          activityType: "resource",
          title: "Overview",
          originUrl: acquiredUrl,
          resolvedUrl: acquiredUrl,
          localPath: path.join(runDir, "overview.pdf"),
          previewPath: null,
          status: "acquired",
          checksum: "abc",
          verifiedAt: null,
          examRelevance: "unknown",
          failureReason: null,
        }],
      },
      evidence_package: {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        records: [{
          id: "ev_1",
          resourceId: acquiredId,
          kind: "claim",
          locator: { section: "Overview" },
          content: "The overview covers chapter one but explicitly omits chapter two.",
          confidence: 0.95,
          pairId: null,
          sourceUrl: acquiredUrl,
          localPath: path.join(runDir, "overview.pdf"),
        }],
        warnings: [],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "request_more",
        coverage_summary: "Chapter two is missing.",
        requested_urls: [requestedUrl, "https://example.org/invented.pdf"],
        reasons: ["The requested guide must cover chapter two."],
      })),
    };
    const config = moodleTestConfig({
      runDir,
      prompt: "Create a study guide for MEL",
      executionProfile: "balanced",
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create a study guide for MEL",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    });

    const result = await createSourceArchitectNode(config, codex)(state);

    expect(result.source_architect_decision).toMatchObject({
      round: 2,
      status: "request_more",
      requestedUrls: [requestedUrl],
      remainingAvailable: 1,
    });
    expect(codex.run.mock.calls[0][0]).toContain("Chapter one - tolerances");
    expect(codex.run.mock.calls[0][0]).toContain("authoritative scope boundary");
    expect(codex.run.mock.calls[0][1]).toMatchObject({
      task: "artifact_planner",
      attempt: 1,
    });
    expect(routeAfterSourceArchitect({ ...state, ...result })).toBe("targetedAcquisition");
    const briefs = JSON.parse(await readFile(path.join(runDir, "document-briefs.json"), "utf8"));
    expect(briefs.briefs[0]).toMatchObject({ checksum: "abc", evidenceRecords: 1 });
  });

  it("accepts a domain-neutral model architecture but removes invented resource URLs", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-domain-architecture-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=clinical";
    const availableUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=cases";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "Acute chest pain", true, 900), role: "primary_lecture" },
        { ...entry(availableUrl, "Additional cases", false, 600), role: "worked_example" },
      ],
    }));
    const lectureId = stableResourceId(lectureUrl);
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.technikum-wien.at/course/view.php?id=medicine",
        generatedAt: new Date().toISOString(),
        resources: [resource(
          lectureId,
          lectureUrl,
          "Acute chest pain",
          "Clinical reasoning",
          "/tmp/clinical.pdf",
          "primary_lecture",
        )],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "sufficient",
        coverage_summary: "The clinical reasoning module is covered.",
        requested_urls: [],
        reasons: [],
        learning_architecture: {
          schemaVersion: 1,
          modules: [{
            id: "acute-chest-pain",
            title: "Acute chest pain",
            priority: "essential",
            contentMode: "case_based",
            learningObjectives: ["Assess a patient vignette and justify the next step."],
            assessmentSignals: ["Case discussion in the lecture."],
            resourceUrls: [lectureUrl, "https://invented.example/fake.pdf"],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      })),
    };
    const config = moodleTestConfig({
      runDir,
      prompt: "Create a study guide for clinical medicine",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create a study guide for clinical medicine",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    });

    const result = await createSourceArchitectNode(config, codex)(state);

    expect(result.source_architect_decision?.learningArchitecture?.modules.find((module) =>
      module.title === "Acute chest pain"
    )).toMatchObject({
      title: "Acute chest pain",
      contentMode: "case_based",
      resourceUrls: [lectureUrl],
    });
    const persisted = JSON.parse(await readFile(path.join(runDir, "learning-architecture.json"), "utf8"));
    expect(JSON.stringify(persisted)).not.toContain("invented.example");
  });

  it("does not force a task and solution when the evaluated plan accepts lecture-only coverage", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-learning-ready-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=10";
    const taskUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=11";
    const solutionUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=12";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "Foliensatz: Kleben", true, 900), sectionTitle: "Eigenstudium 2" },
        { ...entry(taskUrl, "Angabe 5", false, 150), sectionTitle: "Eigenstudium 2", role: "supplementary" },
        { ...entry(solutionUrl, "Lösung 5", false, 600), sectionTitle: "Eigenstudium 2", role: "worked_example" },
      ],
    }));
    const lectureId = stableResourceId(lectureUrl);
    const state = moodleTestState({
      source_architect_decision: {
        round: 2,
        status: "request_more",
        coverageSummary: "Two targeted rounds have already completed.",
        requestedUrls: [],
        remainingAvailable: 2,
        reasons: [],
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.technikum-wien.at/course/view.php?id=1",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(lectureId, lectureUrl, "Foliensatz: Kleben", "Eigenstudium 2", "/tmp/lecture.pdf", "primary_lecture"),
          resource(stableResourceId(taskUrl), taskUrl, "Angabe 5", "Eigenstudium 2", null, "supplementary"),
          resource(stableResourceId(solutionUrl), solutionUrl, "Lösung 5", "Eigenstudium 2", null, "worked_example"),
        ],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "sufficient",
        coverage_summary: "The lecture names the chapter.",
        requested_urls: [],
        reasons: [],
      })),
    };
    const config = moodleTestConfig({
      runDir,
      prompt: "Create a study guide for MEL",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create a study guide for MEL",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    });

    const result = await createSourceArchitectNode(config, codex)(state);

    expect(result.source_architect_decision).toMatchObject({
      round: 3,
      status: "sufficient",
      requestedUrls: [],
    });
  });

  it("requests chapter-matched external references when acquired evidence requires table-book lookup", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-lookup-dependency-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=20";
    const tableBookOne = "https://link.springer.example/chapter-2-pages-27-44.pdf";
    const tableBookTwo = "https://link.springer.example/chapter-2-pages-46-63.pdf";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "Foliensatz Grundlagen", true, 900), sectionTitle: "Diskussion zum Eigenstudium 1", role: "primary_lecture" },
        { ...entry(tableBookOne, "Seite 27 bis 44", false, 50), sectionTitle: "A. Eigenstudium - Toleranzen", role: "external_reference" },
        { ...entry(tableBookTwo, "Seite 46 bis 63", false, 50), sectionTitle: "A. Eigenstudium - Toleranzen", role: "external_reference" },
      ],
    }));
    const lectureId = stableResourceId(lectureUrl);
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.technikum-wien.at/course/view.php?id=1",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(lectureId, lectureUrl, "Foliensatz Grundlagen", "Diskussion zum Eigenstudium 1", "/tmp/lecture.pdf", "primary_lecture"),
        ],
      },
      evidence_package: {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        records: [{
          id: "ev_table_lookup",
          resourceId: lectureId,
          kind: "exercise",
          locator: { page: 12 },
          content: "Bestimmen Sie EI, ES, ei und es mit den Werten der Tabellen TB 2-1 bis TB 2-3.",
          confidence: 1,
          pairId: null,
          sourceUrl: lectureUrl,
          localPath: "/tmp/lecture.pdf",
        }],
        warnings: [],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "sufficient",
        coverage_summary: "The lecture is present.",
        requested_urls: [],
        reasons: [],
      })),
    };
    const config = moodleTestConfig({
      runDir,
      runtimeCacheDir: runDir,
      prompt: "Create a study guide for MEL",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create a study guide for MEL",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    });

    const result = await createSourceArchitectNode(config, codex)(state);

    expect(result.source_architect_decision).toMatchObject({
      round: 1,
      status: "request_more",
      requestedUrls: [tableBookOne, tableBookTwo],
    });
    expect(result.source_architect_decision?.reasons.join(" ")).toContain("mandatory learning dependency");
  });

  it("delegates embedded-table verification to the visual pipeline after bounded acquisition", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-visual-handoff-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=30";
    const unrelatedUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=31";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "Foliensatz Toleranzen", true, 900), sectionTitle: "Eigenstudium 1", role: "primary_lecture" },
        { ...entry(unrelatedUrl, "Weitere Aufgabe", false, 150), sectionTitle: "Eigenstudium 1", role: "supplementary" },
      ],
    }));
    const lectureId = stableResourceId(lectureUrl);
    const state = moodleTestState({
      source_architect_decision: {
        round: 3,
        status: "request_more",
        coverageSummary: "Three targeted acquisitions completed.",
        requestedUrls: [],
        remainingAvailable: 1,
        reasons: [],
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.technikum-wien.at/course/view.php?id=1",
        generatedAt: new Date().toISOString(),
        resources: [
          resource(lectureId, lectureUrl, "Foliensatz Toleranzen", "Eigenstudium 1", "/tmp/tolerances.pdf", "primary_lecture"),
          {
            ...resource("res_failed_book", "https://books.example/tables.pdf", "Tabellenbuch", "Eigenstudium 1", null, "supplementary"),
            status: "tls_failure" as const,
            failureReason: "Certificate chain unavailable.",
          },
        ],
      },
      evidence_package: {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        records: [{
          id: "ev_embedded_table",
          resourceId: lectureId,
          kind: "exercise",
          locator: { page: 12 },
          content: "Verwenden Sie die Tabellen TB 2-1 bis TB 2-3.",
          confidence: 1,
          pairId: null,
          sourceUrl: lectureUrl,
          localPath: "/tmp/tolerances.pdf",
        }, {
          id: "ev_failed_book",
          resourceId: "res_failed_book",
          kind: "claim",
          locator: { page: 1 },
          content: "Tabellenbuch TB 2-1",
          confidence: 0.5,
          pairId: null,
          sourceUrl: "https://books.example/tables.pdf",
          localPath: null,
        }],
        warnings: [],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "blocked",
        coverage_summary: "The table is not visible in the text brief.",
        requested_urls: [],
        reasons: ["TB 2-1 must be verified visually."],
      })),
    };
    const config = moodleTestConfig({
      runDir,
      prompt: "Create a study guide for MEL",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create a study guide for MEL",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    });

    const result = await createSourceArchitectNode(config, codex)(state);

    expect(result.source_architect_decision).toMatchObject({
      round: 4,
      status: "sufficient",
      requestedUrls: [],
    });
    expect(result.source_architect_decision?.reasons.join(" ")).toContain("deterministic review");
  });

  it("continues with documented limitations after bounded acquisition when essential modules are covered", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-bounded-limitations-"));
    directories.push(runDir);
    const lectureUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=901";
    const unavailablePracticeUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=902";
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: [
        { ...entry(lectureUrl, "Calculus", true, 900), role: "primary_lecture" },
        { ...entry(unavailablePracticeUrl, "Stale solution", false, 300), role: "worked_example" },
      ],
    }));
    const lectureId = stableResourceId(lectureUrl);
    const state = moodleTestState({
      source_architect_decision: {
        round: 3,
        status: "request_more",
        coverageSummary: "Bounded acquisitions completed.",
        requestedUrls: [],
        remainingAvailable: 1,
        reasons: [],
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [resource(lectureId, lectureUrl, "Calculus", "Calculus", "/tmp/calculus.pdf", "primary_lecture")],
      },
      evidence_package: {
        schemaVersion: "1.0",
        generatedAt: new Date().toISOString(),
        records: [{ id: "ev_calc", resourceId: lectureId, kind: "claim", locator: { page: 1 }, content: "Derivatives and integrals with worked methods.", confidence: 1, pairId: null, sourceUrl: lectureUrl, localPath: "/tmp/calculus.pdf" }],
        warnings: [],
      },
    });
    const codex = {
      run: vi.fn().mockResolvedValue(JSON.stringify({
        status: "blocked",
        coverage_summary: "A separate solution file remains unavailable.",
        requested_urls: [],
        reasons: ["The stale solution has no replacement."],
        learning_architecture: {
          schemaVersion: 1,
          modules: [{ id: "calculus", title: "Calculus", priority: "essential", contentMode: "quantitative", learningObjectives: ["Apply calculus methods."], assessmentSignals: ["Exam exercises."], resourceUrls: [lectureUrl] }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      })),
    };

    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      prompt: "Create a calculus study guide",
      artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      intentDecision: classifyStudyBuddyIntent({
        prompt: "Create a calculus study guide",
        stage: "extract",
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    }), codex)(state);

    expect(result.error_log).toBeNull();
    expect(result.source_architect_decision).toMatchObject({ round: 4, status: "sufficient", requestedUrls: [] });
    expect(result.source_architect_decision?.coverageSummary).toContain("explicit limitations");
  });

  it("fails closed when the 24-module limit omits essential course evidence", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-essential-module-limit-"));
    directories.push(runDir);
    const items = Array.from({ length: 26 }, (_, index) => {
      const number = index + 1;
      const url = `https://moodle.example/essential-topic-${number}.pdf`;
      return { number, url, id: stableResourceId(url) };
    });
    await writeFile(path.join(runDir, "resource-catalog.json"), JSON.stringify({
      schemaVersion: 1,
      entries: items.map(({ number, url }) => ({
        ...entry(url, `Essential Topic ${number}`, true, 950),
        role: "primary_lecture",
        topic: `Essential Topic ${number}`,
      })),
    }));
    const baseContract = moodleTestState().request_contract;
    const state = moodleTestState({
      request_contract: {
        ...baseContract,
        originalPrompt: "Create a complete course study guide",
        userGoal: "Cover the complete evidenced course.",
      },
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: items.map(({ number, url, id }) => ({
          ...resource(id, url, `Essential Topic ${number}`, `Topic ${number}`, `/tmp/topic-${number}.pdf`, "primary_lecture"),
          selection: {
            selected: true,
            role: "primary_lecture" as const,
            topic: `Essential Topic ${number}`,
            priority: 950,
            reason: "Explicit course topic",
          },
        })),
      },
    });
    const codex = { run: vi.fn() };

    const result = await createSourceArchitectNode(moodleTestConfig({
      runDir,
      runtimeCacheDir: path.join(runDir, "cache"),
      prompt: "Create a complete course study guide",
    }), codex)(state);

    expect(codex.run).not.toHaveBeenCalled();
    expect(result.source_architect_decision).toMatchObject({ status: "blocked" });
    expect(result.error_log).toContain("omitted essential evidence");
    expect(result.source_architect_decision?.learningArchitecture?.modules).toHaveLength(24);
    expect(result.source_architect_decision?.learningArchitecture?.moduleLimit)
      .toMatchObject({ maxModules: 24, originalModuleCount: 26 });
    expect(result.source_architect_decision?.coverageSummary).toContain("Technical module limit 24");
    expect(result.source_architect_decision?.reasons.join(" ")).toContain(
      "explicit must requirement(s)",
    );
    const audit = JSON.parse(
      await readFile(path.join(runDir, "source-architecture-limit-audit.json"), "utf8"),
    );
    expect(audit.moduleLimit.omittedModules).toHaveLength(2);
    expect(audit.moduleLimit.omittedModules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: expect.stringMatching(/^Essential Topic \d+$/),
        resourceUrls: [expect.stringMatching(/^https:\/\/moodle\.example\/essential-topic-\d+\.pdf$/)],
      }),
    ]));
  });

  it("preserves a noncritical module-limit audit through the cached recovery path", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-module-limit-cache-"));
    directories.push(rootDir);
    const firstRunDir = path.join(rootDir, "first");
    const secondRunDir = path.join(rootDir, "second");
    const cacheDir = path.join(rootDir, "cache");
    await Promise.all([mkdir(firstRunDir), mkdir(secondRunDir)]);
    const acquired = Array.from({ length: 25 }, (_, index) => {
      const number = index + 1;
      const url = `https://moodle.example/supplement-${number}.pdf`;
      return { number, url, id: stableResourceId(url) };
    });
    const availableUrl = "https://moodle.example/optional-extra.pdf";
    const entries = [
      ...acquired.map(({ number, url }) => ({
        ...entry(url, `Supplement ${number}`, false, 100),
        role: "supplementary" as const,
      })),
      { ...entry(availableUrl, "Optional extra", false, 100), role: "supplementary" as const },
    ];
    await Promise.all([firstRunDir, secondRunDir].map((directory) =>
      writeFile(path.join(directory, "resource-catalog.json"), JSON.stringify({
        schemaVersion: 1,
        entries,
      }))
    ));
    const state = moodleTestState({
      resource_manifest: {
        schemaVersion: "1.0",
        courseUrl: "https://moodle.example/course",
        generatedAt: new Date().toISOString(),
        resources: [
          ...acquired.map(({ number, url, id }) =>
            resource(id, url, `Supplement ${number}`, `Supplement ${number}`, `/tmp/supplement-${number}.pdf`, "supplementary")
          ),
          resource(stableResourceId(availableUrl), availableUrl, "Optional extra", "Optional", null, "supplementary"),
        ],
      },
    });
    const prompt = "Create a study guide from the available selected material";
    const configBase = {
      runtimeCacheDir: cacheDir,
      prompt,
      intentDecision: classifyStudyBuddyIntent({
        prompt,
        stage: "extract" as const,
        diagnosticOnly: false,
        autoAnswer: false,
        includeCis: false,
        hasCisUrls: false,
      }),
    };
    const coldCodex = { run: vi.fn().mockRejectedValue(new Error("planner unavailable")) };
    const cold = await createSourceArchitectNode(moodleTestConfig({
      ...configBase,
      runDir: firstRunDir,
    }), coldCodex)(state);
    expect(cold.source_architect_decision?.learningArchitecture?.moduleLimit)
      .toMatchObject({ maxModules: 24, originalModuleCount: 25 });
    expect(cold.source_architect_decision?.coverageSummary).toContain("Technical module limit 24");

    const warmCodex = { run: vi.fn() };
    const warm = await createSourceArchitectNode(moodleTestConfig({
      ...configBase,
      runDir: secondRunDir,
    }), warmCodex)(state);

    expect(warmCodex.run).not.toHaveBeenCalled();
    expect(warm.source_architect_decision?.reasons).toEqual(expect.arrayContaining([
      "Reused the course-and-prompt keyed source architecture cache.",
      expect.stringContaining("explicitly partial"),
    ]));
    expect(warm.source_architect_decision?.learningArchitecture?.moduleLimit)
      .toMatchObject({ maxModules: 24, originalModuleCount: 25 });
    await expect(readFile(
      path.join(secondRunDir, "source-architecture-limit-audit.json"),
      "utf8",
    )).resolves.toContain('"originalModuleCount": 25');
  });
});

function entry(href: string, label: string, selected: boolean, priority: number) {
  return {
    href,
    label,
    sectionTitle: "Course material",
    score: 0,
    selected,
    role: selected ? "overview" : "primary_lecture",
    topic: null,
    priority,
    reason: selected ? "Initial probe" : "Cataloged",
  };
}

function resource(
  id: string,
  originUrl: string,
  title: string,
  section: string,
  localPath: string | null,
  role: "primary_lecture" | "worked_example" | "supplementary",
) {
  return {
    id,
    parentId: null,
    sectionPath: [section],
    activityType: "resource",
    title,
    originUrl,
    resolvedUrl: originUrl,
    localPath,
    previewPath: null,
    status: localPath ? "acquired" as const : "skipped" as const,
    checksum: null,
    verifiedAt: null,
    examRelevance: "unknown" as const,
    failureReason: null,
    selection: {
      selected: Boolean(localPath),
      role,
      topic: null,
      priority: 0,
      reason: localPath ? "Initial probe" : "Cataloged",
    },
  };
}
