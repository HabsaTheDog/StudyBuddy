import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyStudyBuddyIntent } from "../taskIntent.js";
import {
  createSourceArchitectNode,
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
      status: "request_more",
      requestedUrls: [taskUrl, solutionUrl],
    });
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
