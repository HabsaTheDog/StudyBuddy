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
    expect(result.learning_modules[0]?.content_mode).toBe("quantitative");
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
    expect(result.learning_modules[0]?.content_mode).toBe("conceptual");
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
});
