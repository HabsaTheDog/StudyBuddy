import { describe, expect, it } from "vitest";
import { buildEvidenceHandoff } from "../nodes/evidenceHandoffNode.js";
import { EvidencePackageSchema, ResourceManifestSchema } from "../examNavigatorContracts.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

describe("interactive evidence handoff", () => {
  it("creates a grounded extraction contract without synthesizing teaching content", () => {
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-07-19T00:00:00.000Z",
      courseUrl: "https://moodle.example/course/view.php?id=42",
      resources: [{
        id: "res_1",
        parentId: null,
        sectionPath: ["Wälzlager"],
        activityType: "resource",
        title: "Wälzlager Skript",
        originUrl: "https://moodle.example/mod/resource/view.php?id=1",
        resolvedUrl: "https://moodle.example/pluginfile.php/1/waelzlager.pdf",
        localPath: "/tmp/waelzlager.pdf",
        previewPath: null,
        status: "acquired",
        checksum: "abc",
        verifiedAt: "2026-07-19T00:00:00.000Z",
        examRelevance: "confirmed",
        failureReason: null,
        contentType: "application/pdf",
        selection: { selected: true, role: "primary_lecture", topic: "Wälzlager", priority: 10, reason: "core chapter" },
        extraction: { status: "usable", method: "native_pdf_text", characterCount: 4200, pageCount: 12, warnings: [] },
      }],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-07-19T00:00:00.000Z",
      warnings: [],
      records: [{
        id: "ev_1",
        resourceId: "res_1",
        kind: "formula",
        locator: { page: 4, section: "Lebensdauer" },
        content: "Die nominelle Lebensdauer wird mit L10 = (C/P)^p bestimmt.",
        confidence: 0.95,
        pairId: null,
        sourceUrl: "https://moodle.example/pluginfile.php/1/waelzlager.pdf",
        localPath: "/tmp/waelzlager.pdf",
      }],
    });
    const config = moodleTestConfig({
      prompt: "Erstelle einen interaktiven Study Guide für MEL",
      outputLanguage: "de",
      evidenceHandoffOnly: true,
    });

    const result = buildEvidenceHandoff(config, moodleTestState({ resource_manifest: manifest, evidence_package: evidence }));

    expect(result.sources).toHaveLength(1);
    expect(result.sections[0]?.heading).toBe("Wälzlager");
    expect(result.sections[0]?.summary).toContain("L10");
    expect(result.learning_modules[0]?.content_mode).toBe("mixed");
    expect(result.learning_modules[0]?.learning_objectives).toEqual([]);
    expect(result.learning_modules[0]?.assessment_signals).toEqual([]);
    expect(result.formulas).toEqual([]);
    expect(result.worked_examples).toEqual([]);
    expect(result.quiz_style_questions).toEqual([]);
  });

  it("preserves an unseen Moodle course title instead of deriving it from the request", () => {
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-07-19T00:00:00.000Z",
      courseUrl: "https://learn.university.example/course/view.php?id=204",
      resources: [{
        id: "res_lit",
        parentId: null,
        sectionPath: ["Close Reading"],
        activityType: "resource",
        title: "Modernism Reader",
        originUrl: "https://learn.university.example/mod/resource/view.php?id=8",
        resolvedUrl: "https://learn.university.example/pluginfile.php/8/modernism.pdf",
        localPath: "/tmp/modernism.pdf",
        previewPath: null,
        status: "acquired",
        checksum: "lit",
        verifiedAt: "2026-07-19T00:00:00.000Z",
        examRelevance: "confirmed",
        failureReason: null,
        contentType: "application/pdf",
        selection: { selected: true, role: "primary_lecture", topic: "Close Reading", priority: 10, reason: "core unit" },
        extraction: { status: "usable", method: "native_pdf_text", characterCount: 4100, pageCount: 18, warnings: [] },
      }],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-07-19T00:00:00.000Z",
      warnings: [],
      records: [{
        id: "ev_lit",
        resourceId: "res_lit",
        kind: "definition",
        locator: { page: 3, section: "Narrative voice" },
        content: "Close reading compares narrative voice, form, historical context, and competing interpretations.",
        confidence: 0.96,
        pairId: null,
        sourceUrl: "https://learn.university.example/pluginfile.php/8/modernism.pdf",
        localPath: "/tmp/modernism.pdf",
      }],
    });
    const config = moodleTestConfig({
      prompt: "Make something useful for the class I mentioned",
      outputLanguage: "en",
      moodleUrl: manifest.courseUrl!,
      evidenceHandoffOnly: true,
    });
    const state = moodleTestState({
      moodle_raw_text: [
        "[Moodle course resolution]",
        "Selected: HUM-204 World Literature",
        "Course title: HUM-204 World Literature",
        "URL: https://learn.university.example/course/view.php?id=204",
        "Confidence: high",
      ].join("\n"),
      resource_manifest: manifest,
      evidence_package: evidence,
    });

    const result = buildEvidenceHandoff(config, state);

    expect(result.course.title).toBe("HUM-204 World Literature");
    expect(result.document_title).toBe("HUM-204 World Literature – Interactive Study Guide");
    expect(result.learning_modules[0]?.content_mode).toBe("mixed");
  });

  it("reconstructs generic self-study and class pairs from the visible Moodle hierarchy", () => {
    const courseUrl = "https://learn.university.example/course/view.php?id=32514";
    const sectionResources = [
      ["Self-Study A: Business Forms", "Moodle Lesson: Business Forms"],
      ["Class 1: Investor Mindset", "Investor Vocabulary"],
      ["Self-Study B: Team Communication", "Moodle Lesson: Meetings"],
      ["Class 2: ELF Meetings", "Meeting Role Play"],
    ];
    const resources = [{
      id: "res_course",
      parentId: null,
      sectionPath: [],
      activityType: "course",
      title: "Course: Business English",
      originUrl: courseUrl,
      resolvedUrl: null,
      localPath: null,
      previewPath: null,
      status: "discovered",
      checksum: null,
      verifiedAt: null,
      examRelevance: "unknown",
      failureReason: null,
      contentType: null,
    }, ...sectionResources.map(([section, title], index) => ({
      id: `res_activity_${index}`,
      parentId: "res_course",
      sectionPath: [section],
      activityType: "lesson",
      title,
      originUrl: `${courseUrl}#activity-${index}`,
      resolvedUrl: null,
      localPath: null,
      previewPath: null,
      status: "discovered",
      checksum: null,
      verifiedAt: null,
      examRelevance: "unknown",
      failureReason: null,
      contentType: null,
    }))];
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-07-19T00:00:00.000Z",
      courseUrl,
      resources,
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-07-19T00:00:00.000Z",
      warnings: [],
      records: [{
        id: "ev_course",
        resourceId: "res_course",
        kind: "claim",
        locator: { section: "course" },
        content: "The Moodle course page defines the visible sequence and learning outcomes.",
        confidence: 0.99,
        pairId: null,
        sourceUrl: courseUrl,
        localPath: null,
      }],
    });
    const state = moodleTestState({
      moodle_raw_text: [
        "Self-Study A: Business Forms",
        "Prepare the business-form vocabulary.",
        "Class 1: Investor Mindset",
        "Explain how a company appeals to investors.",
        "Self-Study B: Team Communication",
        "Prepare diplomatic meeting language.",
        "Class 2: ELF Meetings",
        "Run and participate in an international meeting.",
      ].join("\n"),
      resource_manifest: manifest,
      evidence_package: evidence,
    });

    const result = buildEvidenceHandoff(moodleTestConfig({
      prompt: "Create an adaptive Study Buddy",
      outputLanguage: "en",
      moodleUrl: courseUrl,
      evidenceHandoffOnly: true,
    }), state);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.heading).toContain("Self-Study A");
    expect(result.sections[0]?.heading).toContain("Class 1");
    expect(result.sections[0]?.summary).toContain("appeals to investors");
    expect(result.sections[1]?.summary).toContain("international meeting");
    expect(result.sections.every((section) => section.source_ids.includes("res_course"))).toBe(true);
    expect(result.sections.flatMap((section) => section.key_concepts)).toContain("Meeting Role Play");
  });

  it("prefers selected subject topics over an arbitrary first-ten Moodle session cap", () => {
    const courseUrl = "https://moodle.example/course/view.php?id=32844";
    const topics = [
      "Punktkinematik",
      "Vektorkinematik",
      "Massengeometrie",
      "Schwerpunktsatz",
      "Drallsatz",
      "Schwingungen",
    ];
    const manifestTopics = [topics[2]!, topics[0]!, topics[1]!, ...topics.slice(3)];
    const resources = manifestTopics.map((topic, index) => ({
      id: `res_${index + 1}`,
      parentId: null,
      sectionPath: [`Course section: ${topic}`],
      activityType: "resource",
      title: `${topic} Vorlesung`,
      originUrl: `${courseUrl}#${index + 1}`,
      resolvedUrl: `https://moodle.example/pluginfile.php/${index + 1}/${topic}.pdf`,
      localPath: `/tmp/${topic}.pdf`,
      previewPath: null,
      status: "acquired" as const,
      checksum: `sum-${index + 1}`,
      verifiedAt: "2026-08-09T00:00:00.000Z",
      examRelevance: "confirmed" as const,
      failureReason: null,
      contentType: "application/pdf",
      selection: { selected: true, role: "primary_lecture" as const, topic, priority: 10, reason: "core" },
      extraction: { status: "usable" as const, method: "native_pdf_text", characterCount: 4000, pageCount: 10, warnings: [] },
    }));
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-08-09T00:00:00.000Z",
      courseUrl,
      resources,
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-08-09T00:00:00.000Z",
      warnings: [],
      records: resources.map((resource, index) => ({
        id: `ev_${index + 1}`,
        resourceId: resource.id,
        kind: "claim" as const,
        locator: { section: resource.selection!.topic! },
        content: `${resource.selection!.topic!} enthält belegte Theorie und Anwendungen.`,
        confidence: 0.95,
        pairId: null,
        sourceUrl: resource.resolvedUrl,
        localPath: resource.localPath,
      })),
    });
    const state = moodleTestState({
      moodle_raw_text: topics.map((topic) => `Course section: ${topic}\nTermininhalt`).join("\n"),
      resource_manifest: manifest,
      evidence_package: evidence,
    });

    const result = buildEvidenceHandoff(moodleTestConfig({
      prompt: "Erstelle einen interaktiven Study Guide zum Abprüfen.",
      outputLanguage: "de",
      evidenceHandoffOnly: true,
    }), state);

    expect(result.learning_modules.map((module) => module.title)).toEqual(topics);
    expect(result.learning_modules.every((module) => module.learning_objectives.length === 0)).toBe(true);
    expect(result.learning_modules.every((module) => module.assessment_signals.length === 0)).toBe(true);
    expect(result.learning_modules.at(-1)?.title).toBe("Schwingungen");
  });

  it("binds selected visual practice sources to the evaluated architecture and exposes honest method evidence", () => {
    const courseUrl = "https://moodle.example/course/view.php?id=44";
    const lectureUrl = "https://moodle.example/pluginfile.php/44/lecture.pdf";
    const exampleUrl = "https://moodle.example/pluginfile.php/44/example.pdf";
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-08-16T00:00:00.000Z",
      courseUrl,
      resources: [{
        id: "lecture",
        parentId: null,
        sectionPath: ["Self-study 1A: Kinematics"],
        activityType: "resource",
        title: "Unit A lecture",
        originUrl: lectureUrl,
        resolvedUrl: lectureUrl,
        localPath: "/tmp/lecture.pdf",
        previewPath: null,
        status: "acquired",
        checksum: "lecture",
        verifiedAt: "2026-08-16T00:00:00.000Z",
        examRelevance: "confirmed",
        failureReason: null,
        contentType: "application/pdf",
        selection: { selected: true, role: "primary_lecture", topic: null, priority: 900, reason: "core" },
        extraction: { status: "usable", method: "native_pdf_text", characterCount: 1000, pageCount: 8, warnings: [] },
      }, {
        id: "example",
        parentId: null,
        sectionPath: ["Class 1B: Kinematics"],
        activityType: "resource",
        title: "Worked method sheet",
        originUrl: exampleUrl,
        resolvedUrl: exampleUrl,
        localPath: "/tmp/example.pdf",
        previewPath: null,
        status: "acquired",
        checksum: "example",
        verifiedAt: "2026-08-16T00:00:00.000Z",
        examRelevance: "confirmed",
        failureReason: null,
        contentType: "application/pdf",
        selection: { selected: true, role: "worked_example", topic: null, priority: 600, reason: "depth" },
        extraction: { status: "partial", method: "native_pdf_text", characterCount: 20, pageCount: 2, warnings: ["visual-required"] },
      }],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-08-16T00:00:00.000Z",
      warnings: [],
      records: [{
        id: "ev-unit-a",
        resourceId: "lecture",
        kind: "formula",
        locator: { page: 2 },
        content: "The lecture establishes the governing relation.",
        confidence: 1,
        pairId: null,
        sourceUrl: lectureUrl,
        localPath: "/tmp/lecture.pdf",
      }],
    });
    const state = moodleTestState({
      resource_manifest: manifest,
      evidence_package: evidence,
      source_architect_decision: {
        round: 2,
        status: "sufficient",
        coverageSummary: "Unit A is grounded.",
        requestedUrls: [],
        reasons: [],
        remainingAvailable: 0,
        learningArchitecture: {
          schemaVersion: 1,
          modules: [{
            id: "unit-a",
            title: "Kinematics",
            priority: "essential",
            contentMode: "mixed",
            learningObjectives: ["Apply the governing relation."],
            assessmentSignals: [],
            resourceUrls: [lectureUrl],
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      },
    });
    const result = buildEvidenceHandoff(moodleTestConfig({
      prompt: "Create an interactive guide",
      outputLanguage: "en",
      moodleUrl: courseUrl,
      evidenceHandoffOnly: true,
    }), state, {
      schemaVersion: 1,
      resources: [{
        sourceId: "example",
        sourceTitle: "Worked method sheet",
        sourceRole: "worked_example",
        sourcePath: "/tmp/example.pdf",
        sourceHash: "a".repeat(64),
        pageCount: 2,
        examples: [{
          pages: [2],
          evidenceStatus: "method_only",
          learningGoal: "Rearrange and check the governing relation.",
          taskPrompt: "",
          givens: [],
          targets: [],
          solutionSteps: ["Write the governing relation.", "Check dimensions."],
          result: "",
          diagramDescription: "A labelled system sketch is visible.",
          confidence: 0.8,
          warnings: ["The original prompt is not visible."],
        }],
        warnings: [],
      }],
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.source_ids).toEqual(["lecture", "example"]);
    expect(result.sections[0]?.summary).toContain("status method_only");
    expect(result.sections[0]?.summary).toContain("original prompt is not visible");
    expect(result.worked_examples).toHaveLength(1);
    expect(result.worked_examples[0]?.origin).toBe("derived");
    expect(result.worked_examples[0]?.source_ids).toEqual(["example"]);
  });

  it("balances long overview, lecture, and native practice evidence instead of truncating later sources", () => {
    const courseUrl = "https://moodle.example/course/view.php?id=55";
    const resources = [
      { id: "overview", title: "Course overview", role: "overview" as const },
      { id: "lecture", title: "Oscillations lecture", role: "primary_lecture" as const },
      { id: "practice", title: "Physical pendulum worked example", role: "worked_example" as const },
    ].map((entry, index) => ({
      id: entry.id,
      parentId: null,
      sectionPath: ["Oscillations"],
      activityType: "resource",
      title: entry.title,
      originUrl: `https://moodle.example/pluginfile.php/55/${entry.id}.pdf`,
      resolvedUrl: `https://moodle.example/pluginfile.php/55/${entry.id}.pdf`,
      localPath: `/tmp/${entry.id}.pdf`,
      previewPath: null,
      status: "acquired" as const,
      checksum: entry.id,
      verifiedAt: "2026-08-16T00:00:00.000Z",
      examRelevance: "confirmed" as const,
      failureReason: null,
      contentType: "application/pdf",
      selection: { selected: true, role: entry.role, topic: null, priority: 900 - index, reason: "coverage" },
      extraction: { status: "usable" as const, method: "native_pdf_text", characterCount: 12_000, pageCount: 12, warnings: [] },
    }));
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-08-16T00:00:00.000Z",
      courseUrl,
      resources,
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: "2026-08-16T00:00:00.000Z",
      warnings: [],
      records: [{
        id: "ev-overview",
        resourceId: "overview",
        kind: "claim",
        locator: { section: "overview" },
        content: `GENERAL-${"x".repeat(11_000)}`,
        confidence: 1,
        pairId: null,
        sourceUrl: resources[0]!.resolvedUrl,
        localPath: resources[0]!.localPath,
      }, {
        id: "ev-lecture",
        resourceId: "lecture",
        kind: "formula",
        locator: { page: 4 },
        content: "LECTURE-SIGNAL: derive the oscillation equation from the physical model.",
        confidence: 1,
        pairId: null,
        sourceUrl: resources[1]!.resolvedUrl,
        localPath: resources[1]!.localPath,
      }, {
        id: "ev-practice",
        resourceId: "practice",
        kind: "exercise",
        locator: { page: 2 },
        content: "PRACTICE-SIGNAL: determine the period of the physical pendulum from the complete task data.",
        confidence: 1,
        pairId: null,
        sourceUrl: resources[2]!.resolvedUrl,
        localPath: resources[2]!.localPath,
      }],
    });
    const state = moodleTestState({
      resource_manifest: manifest,
      evidence_package: evidence,
      source_architect_decision: {
        round: 2,
        status: "sufficient",
        coverageSummary: "Oscillations are grounded.",
        requestedUrls: [],
        reasons: [],
        remainingAvailable: 0,
        learningArchitecture: {
          schemaVersion: 1,
          modules: [{
            id: "oscillations",
            title: "Oscillations",
            priority: "essential",
            contentMode: "mixed",
            learningObjectives: ["Model oscillations."],
            assessmentSignals: [],
            resourceUrls: resources.map((resource) => resource.resolvedUrl!),
          }],
          supportResources: [],
          excludedResourceUrls: [],
        },
      },
    });

    const result = buildEvidenceHandoff(moodleTestConfig({
      prompt: "Create an interactive exam guide",
      outputLanguage: "en",
      moodleUrl: courseUrl,
      evidenceHandoffOnly: true,
    }), state);

    expect(result.sections[0]?.summary.length).toBeLessThanOrEqual(7_000);
    expect(result.sections[0]?.summary).toContain("GENERAL-");
    expect(result.sections[0]?.summary).toContain("LECTURE-SIGNAL");
    expect(result.sections[0]?.summary).toContain("PRACTICE-SIGNAL");
    expect(result.sections[0]?.summary.indexOf("PRACTICE-SIGNAL"))
      .toBeLessThan(result.sections[0]?.summary.indexOf("GENERAL-"));
  });
});
