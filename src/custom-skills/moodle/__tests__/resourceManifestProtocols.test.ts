import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildResourceManifest, resourcesFromSnapshot } from "../resourceManifest.js";
import { buildStudyModel } from "../studyModel.js";
import { reviewStudyModel } from "../studentFirstReview.js";
import type { CoverageAssessment } from "../examNavigatorContracts.js";
import { moodleExtractedData, moodleTestConfig } from "./support/moodleTestBlocks.js";

const quizUrl = "https://learn.example.edu/mod/quiz/view.php?id=42";
const configUrl = "https://learn.example.edu/mod/quiz/accessrule/seb/config.php?cmid=42";
const launcherUrl = "sebs://learn.example.edu/mod/quiz/accessrule/seb/config.php?cmid=42";
const coverage: CoverageAssessment = {
  status: "complete", detail: "The requested evidence is available.",
  criticalMissing: [], omittedTopics: [], retryActions: [],
  discoveredResources: 1, acquiredResources: 1, failedResources: 0, usableEvidenceRecords: 1,
};
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function quizSnapshot() {
  return {
    origin: quizUrl, refs: {}, snapshot: [
      '- heading "First test" [level=1]',
      '- paragraph: Safe Exam Browser is required for this test.',
      `- link "Launch Safe Exam Browser" [ref=launch, url=${launcherUrl}]`,
      `- link "Download browser configuration" [ref=config, url=${configUrl}]`,
      '- link "Practice reader" [ref=reader, url=https://learn.example.edu/mod/resource/view.php?id=43]',
    ].join("\n"),
  };
}

describe("citable resource protocols", () => {
  it("keeps quiz and HTTPS configuration references while excluding the SEB launch control", () => {
    const resources = resourcesFromSnapshot(quizSnapshot());
    expect(resources.map((resource) => resource.originUrl)).toEqual([
      quizUrl, configUrl, "https://learn.example.edu/mod/resource/view.php?id=43",
    ]);
    expect(resources.some((resource) => resource.originUrl === launcherUrl)).toBe(false);
  });

  it.each([
    launcherUrl, "seb://learn.example.edu/config.seb", "javascript:alert(1)",
    "data:text/html,quiz", "file:///tmp/quiz.pdf", "mailto:help@example.edu",
    "ftp://files.example.edu/quiz.pdf", "custom://learn.example.edu/mod/quiz/view.php?id=42",
    "not-a-valid-url",
  ])("excludes non-web snapshot href %s", (href) => {
    const resources = resourcesFromSnapshot({
      origin: quizUrl, refs: {},
      snapshot: `- link "Operational control" [ref=control, url=${href}]`,
    });
    expect(resources.map((resource) => resource.originUrl)).toEqual([quizUrl]);
  });

  it("retains a legitimate HTTP study reference without broadening the download policy", () => {
    const resources = resourcesFromSnapshot({ origin: quizUrl, refs: {},
      snapshot: '- link "Public reader" [ref=reader, url=http://archive.example.edu/reader.pdf#page=3]',
    });
    expect(resources[1].originUrl).toBe("http://archive.example.edu/reader.pdf");
    expect(resources[1].locators).toContain("page=3");
  });

  it("does not reintroduce operational URLs from raw source or acquisition-result blocks", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "sb-resource-protocols-"));
    tempDirs.push(runDir);
    const rawText = [
      `[Moodle page]\nTitle: First test\nURL: ${quizUrl}\nSafe Exam Browser is required.`,
      `[Moodle page]\nTitle: Browser launcher\nURL: ${launcherUrl}`,
      `[Linked file]\nTitle: Browser launcher\nURL: ${launcherUrl}\nSaved path: /tmp/browser-config.seb`,
      "[Linked file]\nTitle: Broken source\nURL: malformed\nSaved path: /tmp/broken.pdf",
    ].join("\n\n");
    const manifest = await buildResourceManifest(runDir, rawText);
    expect(manifest.resources.map((resource) => resource.originUrl)).toEqual([quizUrl]);
    expect(rawText).toContain("Safe Exam Browser is required.");
  });

  it("publishes supported study content after snapshot discovery while retaining strict unsafe-link review", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "sb-resource-review-"));
    tempDirs.push(runDir);
    await mkdir(path.join(runDir, "sources"));
    await writeFile(path.join(runDir, "sources", "quiz-snapshot.json"), JSON.stringify(quizSnapshot()));
    const manifest = await buildResourceManifest(runDir, "");
    const extracted = moodleExtractedData({
      sources: [{ id: "quiz-page", title: "First test", kind: "moodle_page", url: quizUrl, path: null, page: null }],
      sections: [{ heading: "Relative motion", summary: "Velocity is measured with respect to a reference frame.",
        key_concepts: ["Select a reference frame for relative velocity."], source_ids: ["quiz-page"] }],
    });
    const model = buildStudyModel(moodleTestConfig(), extracted, manifest, coverage);
    const review = await reviewStudyModel(model, coverage, manifest);
    expect(review.ok).toBe(true);
    expect(model.sources.map((source) => source.originUrl)).toContain(quizUrl);
    expect(model.sources.map((source) => source.originUrl)).not.toContain(launcherUrl);

    const unsafeModel = { ...model, sources: [...model.sources, {
      id: "unsafe", title: "Unsafe supplied source", originUrl: launcherUrl,
      localPath: null, previewPath: null, kind: "quiz",
    }] };
    const unsafeReview = await reviewStudyModel(unsafeModel, coverage, manifest);
    expect(unsafeReview.ok).toBe(false);
    expect(unsafeReview.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsafe-origin", severity: "error" }),
    ]));
  });
});
