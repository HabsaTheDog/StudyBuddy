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
});
