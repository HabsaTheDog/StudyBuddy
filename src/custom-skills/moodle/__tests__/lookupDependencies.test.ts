import { describe, expect, it } from "vitest";
import {
  emptyCoverageAssessment,
  emptyEvidencePackage,
  emptyResourceManifest,
  emptyStudyModel,
} from "../examNavigatorContracts.js";
import { reviewStudyModel } from "../studentFirstReview.js";

describe("mandatory lookup dependency review", () => {
  it("rejects tolerance content that skips the referenced table and lookup method", async () => {
    const model = baseModel();
    const report = await reviewStudyModel(model, coverage(), manifest(), evidence());

    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "lookup-visual-missing",
      "lookup-method-missing",
    ]));
  });

  it("accepts the chapter when it contains the lookup table and teaches the lookup", async () => {
    const model = baseModel();
    model.figures.push({
      id: "fig_tol_table",
      chapterId: "chapter_tol",
      kind: "moodle_pdf_image",
      title: "Grundtoleranz-Tabelle",
      caption: "Toleranzgrade und Nennmaßbereiche aus TB 2-1",
      relativePath: "visuals/tolerance-table.png",
      sourcePage: 6,
      widthPx: 935,
      heightPx: 480,
      sourceIds: ["src_tol"],
      generationPrompt: null,
    });
    model.workedExamples[0].steps = [
      "Nennmaßbereich für 40 mm in der Tabelle TB 2-1 auswählen.",
      "Toleranzgrad IT8 in der passenden Tabellenspalte ablesen.",
      "Grundabmaß es für g aus TB 2-2 nachschlagen und ei = es - IT8 berechnen.",
    ];

    const report = await reviewStudyModel(model, coverage(), manifest(), evidence());

    expect(report.ok).toBe(true);
  });
});

function baseModel() {
  return {
    ...emptyStudyModel(),
    publicationStatus: "complete" as const,
    courseChapters: [{
      id: "chapter_tol",
      title: "Kapitel 1 — Toleranzen und Passungen",
      subject: "Toleranzen und Passungen",
      order: 1,
      priority: "essential" as const,
      contentMode: "quantitative" as const,
      learningObjectives: ["Tabellenwerte anwenden"],
      assessmentSignals: ["Prüfungsaufgabe"],
      status: "covered" as const,
      topicIds: ["topic_tol"],
      resourceIds: ["res_tol"],
    }],
    topics: [{
      id: "topic_tol",
      chapterId: "chapter_tol",
      title: "Maßtoleranzen",
      summary: "x".repeat(1_250),
      priority: "essential" as const,
      scopeStatus: "inferred" as const,
      learningGoals: ["EI, ES, ei und es aus Tabellen bestimmen"],
      sourceIds: ["src_tol"],
    }],
    workedExamples: [{
      id: "example_tol",
      chapterId: "chapter_tol",
      origin: "source" as const,
      learningGoal: "Grenzmaße bestimmen",
      prompt: "Gegeben sind es = -9 µm und ei = -48 µm.",
      steps: ["Grenzmaße durch Einsetzen der vorgegebenen Abmaße berechnen."],
      result: "Go und Gu sind berechnet.",
      sourceIds: ["src_tol"],
    }],
    sources: [{
      id: "src_tol",
      title: "Foliensatz Grundlagen",
      originUrl: "https://moodle.example/lecture",
      localPath: null,
      previewPath: null,
      kind: "moodle_pdf",
    }],
  };
}

function coverage() {
  return {
    ...emptyCoverageAssessment(),
    status: "complete" as const,
    detail: "Sources acquired.",
  };
}

function manifest() {
  return {
    ...emptyResourceManifest(),
    resources: [{
      id: "res_tol",
      parentId: null,
      sectionPath: ["Eigenstudium 1"],
      activityType: "resource",
      title: "Foliensatz Grundlagen",
      originUrl: "https://moodle.example/lecture",
      resolvedUrl: null,
      localPath: null,
      previewPath: null,
      status: "acquired" as const,
      checksum: null,
      verifiedAt: null,
      examRelevance: "inferred" as const,
      failureReason: null,
    }],
  };
}

function evidence() {
  return {
    ...emptyEvidencePackage(),
    records: [{
      id: "ev_tol",
      resourceId: "res_tol",
      kind: "exercise" as const,
      locator: { page: 12 },
      content: "Berechnen Sie die Passung mit den Werten der Tabellen TB 2-1 bis TB 2-3.",
      confidence: 1,
      pairId: null,
      sourceUrl: "https://moodle.example/lecture",
      localPath: null,
    }],
  };
}
