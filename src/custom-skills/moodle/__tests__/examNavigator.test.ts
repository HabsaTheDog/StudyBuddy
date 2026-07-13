import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resourcesFromSnapshot } from "../resourceManifest.js";
import { assessExamNavigatorCoverage } from "../coveragePolicy.js";
import {
  EvidencePackageSchema,
  ResourceManifestSchema,
  StudyModelSchema,
  type ResourceNode,
} from "../examNavigatorContracts.js";
import { buildStudyModel } from "../studyModel.js";
import { classifyArtifactIntent } from "../studentFirstPolicy.js";
import { reviewStudyModel } from "../studentFirstReview.js";
import { renderStudentFirstHtml } from "../studentFirstHtmlRenderer.js";
import { renderStudentFirstTypst } from "../studentFirstTypstRenderer.js";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import { validateTypst } from "../validation.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateSingleFileHtml, validateWebLayoutHtml } from "../../web-layout/validation.js";
import { moodleExtractedData, moodleTestConfig } from "./support/moodleTestBlocks.js";

const courseUrl = "https://moodle.technikum-wien.at/course/view.php?id=32280";
const melSnapshot = {
  origin: courseUrl,
  refs: {},
  snapshot: [
    '- heading "Kurs: Maschinenelemente 1 | FHTW Moodle" [level=2, ref=e1]',
    '- button "D. Eigenstudium - Lötverbindungen" [expanded=true, ref=e2]',
    '- link "Moodle Test 4: Theorie" [ref=e3, url=https://moodle.technikum-wien.at/mod/quiz/view.php?id=2186267]',
    '- button "4. Präsenz - Lötverbindungen" [expanded=true, ref=e4]',
    '- link "Foliensatz: Lötverbindung" [ref=e5, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186270]',
    '- link "Angabe E" [ref=e6, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186271]',
    '- link "Lösung E" [ref=e7, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186272]',
    '- link "Angabe 11" [ref=e8, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186273]',
    '- link "Lösung 11" [ref=e9, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186274]',
    '- button "E. Eigenstudium - Tribologie" [expanded=true, ref=e10]',
    '- link "Moodle Test 5: Theorie" [ref=e11, url=https://moodle.technikum-wien.at/mod/quiz/view.php?id=2186278]',
    '- button "5. Präsenz - Tribologie" [expanded=true, ref=e12]',
    '- link "Foliensatz: Tribologie" [ref=e13, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186281]',
    '- link "Angabe F" [ref=e14, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186282]',
    '- link "Lösung F" [ref=e15, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186283]',
    '- link "Angabe G" [ref=e16, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186284]',
    '- link "Lösung G" [ref=e17, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=2186285]',
    ...[13, 14, 15, 16].flatMap((number, index) => [
      `- link "Angabe ${number}" [ref=a${number}, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=${2186286 + index * 2}]`,
      `- link "Lösung ${number}" [ref=l${number}, url=https://moodle.technikum-wien.at/mod/resource/view.php?id=${2186287 + index * 2}]`,
    ]),
  ].join("\n"),
};

describe("student-centric exam navigator contracts", () => {
  it("discovers the MEL resource map, including calculations, solutions, and quizzes", () => {
    const resources = resourcesFromSnapshot(melSnapshot);
    const titles = resources.map((resource) => resource.title);

    expect(titles).toEqual(expect.arrayContaining([
      "Foliensatz: Lötverbindung",
      "Angabe E",
      "Lösung E",
      "Angabe 11",
      "Lösung 11",
      "Foliensatz: Tribologie",
      "Angabe F",
      "Lösung F",
      "Angabe G",
      "Lösung G",
      "Angabe 13",
      "Lösung 16",
      "Moodle Test 4: Theorie",
      "Moodle Test 5: Theorie",
    ]));
    expect(resources.find((resource) => resource.title === "Angabe F")?.sectionPath)
      .toContain("5. Präsenz - Tribologie");
  });

  it("blocks a source-weak MEL-style run with many discovered files and no acquisition", () => {
    const resources = resourcesFromSnapshot(melSnapshot);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl,
      generatedAt: new Date().toISOString(),
      resources,
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev_course",
        resourceId: resources[0].id,
        kind: "claim",
        locator: { section: "course" },
        content: "Der Kurs nennt Lötverbindungen und Tribologie.",
        confidence: 0.95,
        pairId: null,
        sourceUrl: courseUrl,
        localPath: null,
      }],
      warnings: [],
    });
    const config = moodleTestConfig({
      prompt: "Erstelle einen MEL Study Guide als PDF mit Rechenaufgaben",
      artifactIntent: classifyArtifactIntent("Erstelle einen MEL Study Guide als PDF mit Rechenaufgaben"),
      intentDecision: {
        intent: "extraction",
        wantsPdf: false,
        wantsTypstDocument: false,
        wantsQuickAnswer: false,
        wantsQuizAssistance: false,
        needsMoodle: true,
        needsCis: false,
        needsCalendar: false,
        needsCourseMaterial: true,
        needsDownloadedFiles: true,
        reason: "fixture",
      },
    });

    const coverage = assessExamNavigatorCoverage(config, manifest, evidence);

    expect(coverage.status).toBe("blocked");
    expect(coverage.criticalMissing.join(" ")).toContain("keine davon");
  });

  it("publishes partial coverage when only an isolated source is missing", () => {
    const course = node("course", courseUrl, "course", "acquired");
    const acquired = node("slides", "https://moodle.example/mod/resource/view.php?id=1", "resource", "acquired");
    const failed = node("exercise", "https://moodle.example/mod/resource/view.php?id=2", "resource", "failed");
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl,
      generatedAt: new Date().toISOString(),
      resources: [course, acquired, failed],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev",
        resourceId: acquired.id,
        kind: "claim",
        locator: {},
        content: "Fachlich nutzbare Evidenz",
        confidence: 1,
        pairId: null,
        sourceUrl: acquired.originUrl,
        localPath: null,
      }],
      warnings: [],
    });

    const coverage = assessExamNavigatorCoverage(moodleTestConfig(), manifest, evidence);

    expect(coverage.status).toBe("partial");
  });

  it("removes organizational questions and renders one shared checklist", async () => {
    const config = moodleTestConfig({
      prompt: "Erstelle eine interaktive Lernseite mit Karteikarten",
      artifactIntent: classifyArtifactIntent(
        "Erstelle eine interaktive Lernseite mit Karteikarten",
        { profile: "interactive_learning", formats: ["html", "pdf"] },
      ),
    });
    const extracted = moodleExtractedData({
      document_title: "MEL1 Navigator",
      course: { title: "Maschinenelemente 1", url: courseUrl },
      sources: [{
        id: "src_course",
        title: "MEL1 Moodle",
        kind: "moodle_page",
        url: courseUrl,
        path: null,
        page: null,
      }],
      sections: [
        {
          heading: "Kursidentifikation und Prüfungstermine",
          summary: "Alias und Termin.",
          key_concepts: ["Kursalias"],
          source_ids: ["src_course"],
        },
        {
          heading: "Prüfungsnavigator",
          summary: "Organisatorische Navigation.",
          key_concepts: ["Navigation"],
          source_ids: ["src_course"],
        },
        {
          heading: "Lerncheckliste",
          summary: "Meta-Checkliste.",
          key_concepts: ["Checkliste"],
          source_ids: ["src_course"],
        },
        {
          heading: "Tribologie",
          summary: "Tribologie beschreibt Reibung, Schmierung und Verschleiß in technischen Kontakten.",
          key_concepts: ["Reibungszustände unterscheiden", "Schmiermechanismen erklären"],
          source_ids: ["src_course"],
        },
      ],
      quiz_style_questions: [
        {
          question: "Wann und wo findet die Prüfung statt?",
          answer: "Freitag im Hörsaal.",
          source_ids: ["src_course"],
        },
        {
          question: "Wie beeinflusst Schmierung den Reibungszustand?",
          answer: "Sie trennt die Kontaktflächen abhängig vom Schmierregime.",
          source_ids: ["src_course"],
        },
      ],
    });
    const coverage = {
      status: "partial" as const,
      detail: "Einzelne Quelle fehlt.",
      criticalMissing: [],
      omittedTopics: [],
      retryActions: [],
      discoveredResources: 1,
      acquiredResources: 1,
      failedResources: 0,
      usableEvidenceRecords: 1,
    };
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl,
      generatedAt: new Date().toISOString(),
      resources: [node("course", courseUrl, "course", "acquired")],
    });

    const model = buildStudyModel(config, extracted, manifest, coverage);
    const review = await reviewStudyModel(model, coverage, manifest);
    const html = renderStudentFirstHtml(model, "/tmp");
    const typst = renderStudentFirstTypst(model);

    expect(model.topics.map((topic) => topic.title)).toEqual(["Tribologie"]);
    expect(model.practiceItems).toHaveLength(1);
    expect(model.practiceItems[0].prompt).toContain("Schmierung");
    expect(new Set(model.checklist).size).toBe(model.checklist.length);
    expect(review.ok).toBe(true);
    expect((typst.match(/#sb-checklist\s*\(/g) ?? [])).toHaveLength(1);
    expect(validateStudyBuddyDocumentStructure(typst).ok).toBe(true);
    expect((await validateTypst(typst, await getStudyBuddyTypstSupportFiles())).ok).toBe(true);
    expect(validateSingleFileHtml(html, "reference").ok).toBe(true);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('aria-label="Seitennavigation"');
    expect(html).toContain('id="source-search"');
    expect(html).toContain('data-source-jump');
    expect(html).toContain('class="route-grid"');
    expect(html).not.toContain("<table");
  });

  it("keeps the Moodle chapter order and places formulas and figures inside their chapter", () => {
    const toleranceUrl = "https://moodle.example/mod/resource/view.php?id=10";
    const glueUrl = "https://moodle.example/mod/resource/view.php?id=20";
    const toleranceResource = {
      ...node("tolerances", toleranceUrl, "resource", "acquired"),
      sectionPath: ["A. Eigenstudium - Toleranzen, Passungen und Oberflächen"],
    };
    const glueResource = {
      ...node("glue", glueUrl, "resource", "failed"),
      sectionPath: ["B. Eigenstudium - Klebeverbindungen"],
    };
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl,
      generatedAt: new Date().toISOString(),
      resources: [node("course", courseUrl, "course", "acquired"), toleranceResource, glueResource],
    });
    const extracted = moodleExtractedData({
      document_title: "MEL1 Study Guide",
      course: { title: "Maschinenelemente 1", url: courseUrl },
      sources: [{
        id: "src_tolerances",
        title: "Foliensatz Toleranzen",
        kind: "pdf",
        url: toleranceUrl,
        path: "/tmp/tolerances.pdf",
        page: null,
      }],
      sections: [{
        heading: "Toleranzen, Passungen und Oberflächen",
        summary: "Grenzabmaße und Passungen werden aus den Toleranzfeldern bestimmt.",
        key_concepts: ["Grenzabmaße bestimmen"],
        source_ids: ["src_tolerances"],
      }],
      formulas: [{
        name: "Passung",
        typst: "P_o = G_\"oB\" - G_\"uW\" = ES - ei",
        variables: ["P: Passung"],
        units: ["mm"],
        context: "Differenz der Istmaße.",
        source_ids: ["src_tolerances"],
      }],
      worked_examples: [{
        prompt: "Bestimme die Passung aus den Toleranzfeldern.",
        steps: ["Grenzmaße aus der Tabelle ablesen", "Bohrung minus Welle bilden"],
        result: "P = I_B - I_W",
        source_ids: ["src_tolerances"],
      }],
      visual_assets: [{
        id: "fig_tolerances",
        kind: "moodle_pdf_image",
        title: "Toleranzfeld",
        relative_path: "assets/visuals/toleranzfeld.png",
        mime_type: "image/png",
        width_px: 800,
        height_px: 500,
        source_id: "src_tolerances",
        source_url: toleranceUrl,
        source_path: "/tmp/tolerances.pdf",
        source_page: 4,
        confidence: 0.9,
        caption_hint: "Toleranzfeld",
        relevance_reason: "Erklärt die Lage der Abmaße.",
        generation_prompt: null,
      }],
      figures: [{
        asset_id: "fig_tolerances",
        caption: "Toleranzfelder von Bohrung und Welle",
        placement_hint: "Toleranzen",
        source_ids: ["src_tolerances"],
      }],
    });
    const coverage = {
      status: "partial" as const,
      detail: "Klebeverbindungen fehlen.",
      criticalMissing: [],
      omittedTopics: ["Klebeverbindungen"],
      retryActions: [],
      discoveredResources: 3,
      acquiredResources: 2,
      failedResources: 1,
      usableEvidenceRecords: 3,
    };
    const model = buildStudyModel(moodleTestConfig(), extracted, manifest, coverage);
    const typst = renderStudentFirstTypst(model);

    expect(model.courseChapters.map((chapter) => chapter.title)).toEqual([
      "A. Eigenstudium - Toleranzen, Passungen und Oberflächen",
      "B. Eigenstudium - Klebeverbindungen",
    ]);
    expect(model.courseChapters.map((chapter) => chapter.status)).toEqual(["covered", "missing"]);
    expect(model.formulas[0].chapterId).toBe(model.topics[0].chapterId);
    expect(model.figures[0].chapterId).toBe(model.topics[0].chapterId);
    expect(typst).toContain('label-text: "Beispielbild 1"');
    expect(typst).toContain('#image("assets/visuals/toleranzfeld.png", width: 88%, height: 82mm, fit: "contain")');
    expect(typst).toContain('$ P_o = G_"oB" - G_"uW" = "ES" - "ei" $');
    expect(typst.indexOf("A. Eigenstudium")).toBeLessThan(typst.indexOf("B. Eigenstudium"));
    expect(typst.indexOf("Formelwerkzeug")).toBeLessThan(typst.lastIndexOf("B. Eigenstudium"));
  });

  it("does not silently replace missing source visuals with generic diagrams", () => {
    const sourceUrl = "https://moodle.example/mod/resource/view.php?id=10";
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl,
      generatedAt: new Date().toISOString(),
      resources: [node("tolerances", sourceUrl, "resource", "acquired")],
    });
    const extracted = moodleExtractedData({
      course: { title: "Maschinenelemente 1", url: courseUrl },
      sources: [{
        id: "src_tolerances",
        title: "Angabe A",
        kind: "pdf",
        url: sourceUrl,
        path: "/tmp/angabe-a.pdf",
        page: 1,
      }],
      sections: [{
        heading: "Toleranzen",
        summary: "Toleranzfelder werden aus Grenzabmaßen bestimmt.",
        key_concepts: ["Toleranzfelder lesen"],
        source_ids: ["src_tolerances"],
      }],
      visual_assets: [{
        id: "fig_missing_source_visual",
        kind: "typst_diagram",
        title: "Toleranzfelder bei H7/k6",
        relative_path: null,
        mime_type: null,
        width_px: null,
        height_px: null,
        source_id: "src_tolerances",
        source_url: sourceUrl,
        source_path: "/tmp/angabe-a.pdf",
        source_page: 1,
        confidence: 0.7,
        caption_hint: "Toleranzfelder als didaktisches Diagramm",
        relevance_reason: "Source image extraction was unavailable.",
        generation_prompt: null,
      }],
      figures: [{
        asset_id: "fig_missing_source_visual",
        caption: "Toleranzfelder von Bohrung und Welle",
        placement_hint: "Toleranzen",
        source_ids: ["src_tolerances"],
      }],
    });
    const coverage = {
      status: "complete" as const,
      detail: "Alle Quellen verarbeitet.",
      criticalMissing: [],
      omittedTopics: [],
      retryActions: [],
      discoveredResources: 1,
      acquiredResources: 1,
      failedResources: 0,
      usableEvidenceRecords: 2,
    };

    const model = buildStudyModel(moodleTestConfig(), extracted, manifest, coverage);
    const typst = renderStudentFirstTypst(model);

    expect(typst).not.toContain("#sb-block-diagram");
    expect(typst).toContain("Visualisierung nicht gerendert");
    expect(typst).toContain("Toleranzfelder bei H7/k6");
  });

  it.runIf(process.env.WEB_LAYOUT_BROWSER_TESTS === "1")(
    "passes desktop and mobile browser validation without overflow",
    async () => {
      const runDir = await mkdtemp(path.join(os.tmpdir(), "exam-navigator-browser-"));
      try {
        const model = StudyModelSchema.parse({
          schemaVersion: "1.0",
          profile: "exam_navigator",
          language: "de",
          title: "MEL1 Exam Navigator",
          courseTitle: "Maschinenelemente 1",
          courseUrl,
          publicationStatus: "partial",
          scopeNote: "Einzelne Quelle fehlt.",
          topics: [{
            id: "tribologie",
            title: "Tribologie",
            summary: "Reibung, Schmierung und Verschleiß werden gemeinsam als tribologisches System betrachtet.",
            priority: "essential",
            scopeStatus: "inferred",
            learningGoals: ["Schmierzustände fachlich unterscheiden"],
            sourceIds: ["src"],
          }],
          formulas: [],
          workedExamples: [],
          checklist: ["Ich kann Schmierzustände fachlich unterscheiden."],
          practiceItems: [],
          sources: [{
            id: "src",
            title: "MEL1 Moodle-Kurs",
            originUrl: courseUrl,
            localPath: null,
            previewPath: null,
            kind: "moodle_page",
          }],
          warnings: [],
        });
        const report = await validateWebLayoutHtml(
          renderStudentFirstHtml(model, runDir),
          "reference",
          { runDir },
        );
        expect(report.ok).toBe(true);
        expect(report.screenshotPaths).toHaveLength(2);
      } finally {
        await rm(runDir, { recursive: true, force: true });
      }
    },
    20_000,
  );
});

function node(
  id: string,
  originUrl: string,
  activityType: string,
  status: ResourceNode["status"],
): ResourceNode {
  return {
    id: `res_${id}`,
    parentId: null,
    sectionPath: [],
    activityType,
    title: id,
    originUrl,
    resolvedUrl: null,
    localPath: null,
    previewPath: null,
    status,
    checksum: null,
    verifiedAt: null,
    examRelevance: "unknown",
    failureReason: status === "failed" ? "fixture failure" : null,
  };
}
