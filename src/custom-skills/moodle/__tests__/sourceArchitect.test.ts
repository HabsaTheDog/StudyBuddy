import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import {
  createSourceArchitectNode,
  isLookupOnlySourceBlock,
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

  it("does not accept lecture-only coverage when a matching task and solution are cataloged", async () => {
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
      status: "request_more",
      requestedUrls: [taskUrl, solutionUrl],
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
