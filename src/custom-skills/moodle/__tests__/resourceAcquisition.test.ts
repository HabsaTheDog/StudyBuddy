import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessExamNavigatorCoverage } from "../coveragePolicy.js";
import { buildEvidencePackage } from "../evidencePackage.js";
import {
  EvidencePackageSchema,
  ResourceManifestSchema,
  type ResourceNode,
} from "../examNavigatorContracts.js";
import {
  classifyResourceFailure,
  formatResourceFailureBlock,
  inspectResourcePayload,
  isKnownPdfEndpoint,
} from "../resourceAcquisition.js";
import { buildResourceManifest, stableResourceId, verifyResourceLinks } from "../resourceManifest.js";
import { createCoverageNode } from "../nodes/coverageNode.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("external resource acquisition", () => {
  it("refuses private and non-HTTPS link checks before making a request", async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests += 1;
      return new Response(null, { status: 200 });
    };
    for (const originUrl of ["https://127.0.0.1/admin", "http://public.example/resource"]) {
      const result = await verifyResourceLinks(resourceManifest(originUrl), {
        fetchImpl,
        resolveHostname: async () => ["8.8.8.8"],
      });
      expect(result.resources[0]?.status).toBe("failed");
      expect(result.resources[0]?.failureReason).toContain("Link check failed");
    }
    expect(requests).toBe(0);
  });

  it("revalidates every redirect target before following it", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "https://192.168.1.10/private" },
      });
    };
    const result = await verifyResourceLinks(resourceManifest("https://public.example/resource"), {
      fetchImpl,
      resolveHostname: async () => ["8.8.8.8"],
    });

    expect(requested).toEqual(["https://public.example/resource"]);
    expect(result.resources[0]?.status).toBe("failed");
    expect(result.resources[0]?.failureReason).toContain("private network");
  });

  it("recognizes HAN PDF endpoints without a .pdf suffix", () => {
    expect(isKnownPdfEndpoint(
      "https://example.han.technikum-wien.at/content/pdf/10.1007%2F978-3-8348-9898-2",
    )).toBe(true);
  });

  it("distinguishes TLS, stale Moodle resources, and transient timeouts", () => {
    expect(classifyResourceFailure("unable to verify the first certificate").status)
      .toBe("tls_failure");
    expect(classifyResourceFailure(
      "Downloaded file is not a PDF; Moodle returned an HTML page instead (BMR SS2025).",
      { requestedUrl: "https://moodle.technikum-wien.at/mod/resource/view.php?id=1" },
    ).status).toBe("stale");
    expect(classifyResourceFailure("Download job timed out after 90000ms.")).toMatchObject({
      status: "transient_failure",
      failureKind: "client_timeout",
    });
    expect(classifyResourceFailure("request ETIMEDOUT").failureKind).toBe("remote_timeout");
  });

  it("keeps title, URL, failure class, and suggested action in failure blocks", () => {
    const block = formatResourceFailureBlock({
      title: "Seite 27 bis 44",
      url: "https://example.han.technikum-wien.at/content/pdf/book.pdf",
      message: "unable to verify the first certificate",
    });

    expect(block).toContain("Title: Seite 27 bis 44");
    expect(block).toContain("URL: https://example.han.technikum-wien.at");
    expect(block).toContain("Resource status: tls_failure");
    expect(block).toContain("Failure kind: tls");
    expect(block).toContain("Suggested action:");
  });

  it("detects an HTML course page returned instead of a PDF", () => {
    const payload = inspectResourcePayload(
      Buffer.from("<!doctype html><html><head><title>BMR-VZ-2-SS2025-MEL1-DE</title></head></html>"),
      "text/html; charset=utf-8",
    );

    expect(payload).toEqual({
      kind: "html",
      contentType: "text/html",
      title: "BMR-VZ-2-SS2025-MEL1-DE",
    });
  });

  it("selects the requested course instead of the first dashboard course and preserves locators", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-resource-manifest-"));
    temporaryDirectories.push(runDir);
    const sourcesDir = path.join(runDir, "sources");
    await mkdir(sourcesDir, { recursive: true });
    const dashboardUrl = "https://moodle.technikum-wien.at/my/";
    const wrongCourse = "https://moodle.technikum-wien.at/course/view.php?id=101";
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const bookUrl = "https://example.han.technikum-wien.at/content/pdf/book.pdf";
    await writeFile(path.join(sourcesDir, "1-dashboard.json"), JSON.stringify({
      origin: dashboardUrl,
      refs: {},
      snapshot: `- link "Technical English" [ref=e1, url=${wrongCourse}]`,
    }));
    await writeFile(path.join(sourcesDir, "2-course.json"), JSON.stringify({
      origin: targetCourse,
      refs: {},
      snapshot: [
        '- heading "Kurs: Maschinenelemente 1 | FHTW Moodle" [level=2, ref=e1]',
        '- button "B. Eigenstudium - Klebeverbindungen" [expanded=true, ref=e2]',
        `- link "Seite 103 bis 113" [ref=e3, url=${bookUrl}#page=103]`,
        '- button "D. Eigenstudium - Lötverbindungen" [expanded=true, ref=e4]',
        `- link "Seite 114 bis 125" [ref=e5, url=${bookUrl}#page=114]`,
      ].join("\n"),
    }));

    const manifest = await buildResourceManifest(runDir, [
      "[Moodle page]",
      "Title: Dashboard",
      `URL: ${dashboardUrl}`,
      "",
      "[Moodle page]",
      "Title: Maschinenelemente 1",
      `URL: ${targetCourse}`,
    ].join("\n"), { preferredCourseUrls: [targetCourse] });

    expect(manifest.courseUrl).toBe(targetCourse);
    const book = manifest.resources.find((resource) => resource.canonicalUrl === bookUrl);
    expect(book?.parentId).toBe(stableResourceId(targetCourse));
    expect(book?.locators).toEqual(expect.arrayContaining([
      "pages:103-113",
      "pages:114-125",
      "page=103",
      "page=114",
    ]));
  });

  it("keeps selected downloads in the target course when later activity snapshots repeat navigation links", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-course-scope-repair-"));
    temporaryDirectories.push(runDir);
    const sourcesDir = path.join(runDir, "sources");
    await mkdir(sourcesDir, { recursive: true });
    const courseUrl = "https://moodle.technikum-wien.at/course/view.php?id=32916";
    const feedbackUrl = "https://moodle.technikum-wien.at/mod/feedback/view.php?id=2249369";
    const resourceUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=2249357";
    const localPath = path.join(sourcesDir, "translation.pdf");
    await writeFile(localPath, "%PDF-1.4\nfixture\n", "utf8");
    await writeFile(path.join(sourcesDir, "1-course.json"), JSON.stringify({
      origin: courseUrl,
      refs: {},
      snapshot: [
        '- heading "Kurs: Physikalische Grundlagen der Dynamik | FHTW Moodle" [level=2, ref=e1]',
        `- link "Kontrollfragen Translation" [ref=e2, url=${resourceUrl}]`,
        `- link "Feedback" [ref=e3, url=${feedbackUrl}]`,
      ].join("\n"),
    }));
    await writeFile(path.join(sourcesDir, "2-feedback.json"), JSON.stringify({
      origin: feedbackUrl,
      refs: {},
      snapshot: [
        `- link "Physikalische Grundlagen der Dynamik" [ref=e1, url=${courseUrl}]`,
        `- link "Kontrollfragen Translation" [ref=e2, url=${resourceUrl}]`,
        `- link "Feedback" [ref=e3, url=${feedbackUrl}]`,
      ].join("\n"),
    }));
    await writeFile(path.join(runDir, "resource-plan.json"), `${JSON.stringify({
      entries: [{
        href: resourceUrl,
        selected: true,
        role: "primary_lecture",
        topic: "Translation",
        priority: 900,
        reason: "Selected for the target course.",
      }],
    })}\n`, "utf8");
    const rawText = [
      "[Moodle page]",
      "Title: Physikalische Grundlagen der Dynamik",
      `URL: ${courseUrl}`,
      "",
      "[Linked file]",
      "Title: Kontrollfragen Translation",
      `URL: ${resourceUrl}`,
      "Resource status: acquired",
      `Saved path: ${localPath}`,
      "Selection: selected",
      "Resource role: primary_lecture",
      "Resource topic: Translation",
      "Resource priority: 900",
      "Selection reason: Selected for the target course.",
      "Acquisition status: completed",
      "Acquisition transport: authenticated_request",
      "Acquisition attempts: 1",
      "Acquisition bytes: 20",
      "Acquisition duration ms: 5",
      "Extraction status: usable",
      "Extraction method: native_pdf_text",
      "Extraction characters: 500",
      "Extraction pages: 2",
      "Extraction warnings: none",
    ].join("\n");

    const manifest = await buildResourceManifest(runDir, rawText, {
      preferredCourseUrls: [courseUrl],
    });
    const acquired = manifest.resources.find((resource) => resource.originUrl === resourceUrl);
    expect(acquired).toMatchObject({
      parentId: stableResourceId(courseUrl),
      status: "acquired",
      localPath,
    });
    expect(manifest.resources.find((resource) => resource.originUrl === feedbackUrl)?.parentId)
      .not.toBe(stableResourceId(feedbackUrl));

    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev-translation",
        resourceId: acquired!.id,
        kind: "claim",
        locator: { page: 1 },
        content: "Translation evidence",
        confidence: 1,
        pairId: null,
        sourceUrl: resourceUrl,
        localPath,
      }],
      warnings: [],
    });
    const coverage = assessExamNavigatorCoverage(studyGuideConfig(), manifest, evidence);
    expect(coverage.status).not.toBe("blocked");
    expect(coverage.discoveredResources).toBe(1);
    expect(coverage.acquiredResources).toBe(1);
  });

  it("persists classified failures without turning diagnostics into study evidence", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-resource-failure-"));
    temporaryDirectories.push(runDir);
    const courseUrl = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const resourceUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=201";
    const rawText = [
      "[Moodle page]",
      "Title: Maschinenelemente 1",
      `URL: ${courseUrl}`,
      "",
      "[Linked file]",
      "Title: Angabe 7",
      `URL: ${resourceUrl}`,
      "Resource status: stale",
      "Failure kind: stale_resource",
      "Suggested action: Im aktuellen Kurs nach dem Ersatz suchen.",
      "Download failed: Downloaded file is not a PDF; Moodle returned an HTML page instead (BMR-VZ-2-SS2025-MEL1-DE).",
    ].join("\n");

    const manifest = await buildResourceManifest(runDir, rawText, {
      preferredCourseUrls: [courseUrl],
    });
    const evidence = await buildEvidencePackage(runDir, rawText, manifest);
    const failed = manifest.resources.find((resource) => resource.originUrl === resourceUrl);

    expect(failed?.status).toBe("stale");
    expect(failed?.failureKind).toBe("stale_resource");
    expect(failed?.recommendedAction).toContain("Ersatz");
    expect(evidence.records).toHaveLength(0);
  });

  it("reports a usable partial run with explicit resource reasons and ignores dashboard help", () => {
    const dashboardUrl = "https://moodle.technikum-wien.at/my/";
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const targetId = stableResourceId(targetCourse);
    const acquired = resource("slides", "resource", "acquired", targetId);
    const stale = resource("Angabe 7", "resource", "stale", targetId);
    const tls = resource("Seite 27 bis 44", "file", "tls_failure", targetId);
    const help = resource("", "page", "discovered", stableResourceId(dashboardUrl));
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: targetCourse,
      generatedAt: new Date().toISOString(),
      resources: [
        resource(targetCourse, "course", "discovered", null, targetCourse),
        resource(dashboardUrl, "moodle_page", "discovered", null, dashboardUrl),
        acquired,
        stale,
        tls,
        help,
      ],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev1",
        resourceId: acquired.id,
        kind: "claim",
        locator: {},
        content: "Nutzbare Fachquelle",
        confidence: 1,
        pairId: null,
        sourceUrl: acquired.originUrl,
        localPath: "/tmp/slides.pdf",
      }],
      warnings: [],
    });

    const coverage = assessExamNavigatorCoverage(moodleTestConfig(), manifest, evidence);

    expect(coverage.status).toBe("partial");
    expect(coverage.detail).toContain("Der Run ist verwendbar");
    expect(coverage.detail).toContain("veraltete Moodle-Verweise");
    expect(coverage.detail).toContain("TLS-/Zertifikatsprüfung");
    expect(coverage.discoveredResources).toBe(3);
    expect(coverage.resourceIssues?.map((issue) => issue.status))
      .toEqual(expect.arrayContaining(["stale", "tls_failure"]));
  });

  it("assesses semantic coverage from the bounded plan instead of the raw 42-file catalog", () => {
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const targetId = stableResourceId(targetCourse);
    const topics = [
      "Punktkinematik",
      "Vektorkinematik",
      "Schwerpunktsatz",
      "Drallsatz",
      "Schwingungen",
    ];
    const selected = topics.map((topic, index) => plannedResource(topic, targetId, true, "acquired", index));
    const skipped = Array.from({ length: 37 }, (_, index) =>
      plannedResource(`Optional ${index}`, targetId, false, "skipped", index + selected.length)
    );
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: targetCourse,
      generatedAt: new Date().toISOString(),
      resources: [resource(targetCourse, "course", "discovered", null, targetCourse), ...selected, ...skipped],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: selected.map((item, index) => ({
        id: `ev-${index}`,
        resourceId: item.id,
        kind: "claim",
        locator: {},
        content: `Evidence for ${item.title}`,
        confidence: 1,
        pairId: null,
        sourceUrl: item.originUrl,
        localPath: item.localPath,
      })),
      warnings: [],
    });

    const coverage = assessExamNavigatorCoverage(studyGuideConfig(), manifest, evidence);

    expect(coverage.status).toBe("complete");
    expect(coverage.discoveredResources).toBe(5);
    expect(coverage.acquiredResources).toBe(5);
    expect(coverage.failedResources).toBe(0);
  });

  it("treats the bounded target-course plan as authoritative over a stale snapshot parent", () => {
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const otherCourse = "https://moodle.technikum-wien.at/course/view.php?id=101";
    const staleActivityParent = stableResourceId(
      "https://moodle.technikum-wien.at/mod/feedback/view.php?id=301",
    );
    const selected = plannedResource("Translation", staleActivityParent, true, "acquired", 0);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: targetCourse,
      generatedAt: new Date().toISOString(),
      resources: [
        resource(targetCourse, "course", "discovered", null, targetCourse),
        resource(otherCourse, "course", "discovered", null, otherCourse),
        resource("Feedback", "page", "discovered", stableResourceId(targetCourse),
          "https://moodle.technikum-wien.at/mod/feedback/view.php?id=301"),
        selected,
      ],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev-selected",
        resourceId: selected.id,
        kind: "claim",
        locator: {},
        content: "Selected acquired evidence",
        confidence: 1,
        pairId: null,
        sourceUrl: selected.originUrl,
        localPath: selected.localPath,
      }],
      warnings: [],
    });

    const coverage = assessExamNavigatorCoverage(studyGuideConfig(), manifest, evidence);

    expect(coverage.status).not.toBe("blocked");
    expect(coverage.discoveredResources).toBe(1);
    expect(coverage.acquiredResources).toBe(1);
    expect(coverage.usableEvidenceRecords).toBe(1);
  });

  it("recognizes a German compound as an exam-scope request", () => {
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const targetId = stableResourceId(targetCourse);
    const selected = plannedResource("Translation", targetId, true, "acquired", 0);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: targetCourse,
      generatedAt: new Date().toISOString(),
      resources: [resource(targetCourse, "course", "discovered", null, targetCourse), selected],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev-exam-scope",
        resourceId: selected.id,
        kind: "claim",
        locator: {},
        content: "Course content without an official exam boundary.",
        confidence: 1,
        pairId: null,
        sourceUrl: selected.originUrl,
        localPath: selected.localPath,
      }],
      warnings: [],
    });
    const coverage = assessExamNavigatorCoverage({
      ...studyGuideConfig(),
      prompt: "Ich lerne für meine Dynamikprüfung.",
    }, manifest, evidence);

    expect(coverage.status).toBe("partial");
    expect(coverage.detail).toContain("offizielle Prüfungsabgrenzung");
    expect(coverage.acquiredResources).toBe(1);
  });

  it("repairs persisted course scope locally before the publication gate", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-coverage-recovery-"));
    temporaryDirectories.push(runDir);
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const staleParent = stableResourceId(
      "https://moodle.technikum-wien.at/mod/feedback/view.php?id=301",
    );
    const selected = plannedResource("Translation", staleParent, true, "acquired", 0);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: targetCourse,
      generatedAt: new Date().toISOString(),
      resources: [
        resource(targetCourse, "course", "discovered", null, targetCourse),
        resource("Other course", "course", "discovered", null,
          "https://moodle.technikum-wien.at/course/view.php?id=101"),
        selected,
      ],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev-selected",
        resourceId: selected.id,
        kind: "claim",
        locator: {},
        content: "Selected acquired evidence",
        confidence: 1,
        pairId: null,
        sourceUrl: selected.originUrl,
        localPath: selected.localPath,
      }],
      warnings: [],
    });
    const node = createCoverageNode({ ...studyGuideConfig(), runDir });

    const result = await node(moodleTestState({
      resource_manifest: manifest,
      evidence_package: evidence,
    }));

    expect(result.error_log).toBeNull();
    expect(result.coverage_assessment).toMatchObject({
      acquiredResources: 1,
      usableEvidenceRecords: 1,
    });
    expect(result.resource_manifest?.resources.find((entry) => entry.id === selected.id)?.parentId)
      .toBe(stableResourceId(targetCourse));
    const recovery = JSON.parse(await readFile(path.join(runDir, "coverage-recovery.json"), "utf8")) as {
      status: string;
      performedNetworkAccess: boolean;
      performedModelCall: boolean;
    };
    expect(recovery).toMatchObject({
      status: "repaired",
      performedNetworkAccess: false,
      performedModelCall: false,
    });
  });

  it("blocks only when a selected critical topic lacks usable evidence", () => {
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=102";
    const targetId = stableResourceId(targetCourse);
    const usable = plannedResource("Punktkinematik", targetId, true, "acquired", 0);
    const missing = plannedResource("Drallsatz", targetId, true, "transient_failure", 1);
    const manifest = ResourceManifestSchema.parse({
      schemaVersion: "1.0",
      courseUrl: targetCourse,
      generatedAt: new Date().toISOString(),
      resources: [resource(targetCourse, "course", "discovered", null, targetCourse), usable, missing],
    });
    const evidence = EvidencePackageSchema.parse({
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      records: [{
        id: "ev-usable",
        resourceId: usable.id,
        kind: "claim",
        locator: {},
        content: "Usable evidence",
        confidence: 1,
        pairId: null,
        sourceUrl: usable.originUrl,
        localPath: usable.localPath,
      }],
      warnings: [],
    });

    const coverage = assessExamNavigatorCoverage(studyGuideConfig(), manifest, evidence);

    expect(coverage.status).toBe("blocked");
    expect(coverage.criticalMissing.join(" ")).toContain("Drallsatz");
    expect(coverage.retryActions.join(" ")).toContain("Primärquellen");
  });
});

function resourceManifest(originUrl: string) {
  return ResourceManifestSchema.parse({
    schemaVersion: "1.0",
    courseUrl: null,
    generatedAt: new Date(0).toISOString(),
    resources: [{
      id: "external-1",
      parentId: null,
      sectionPath: [],
      activityType: "external",
      title: "External resource",
      originUrl,
      resolvedUrl: null,
      localPath: null,
      previewPath: null,
      status: "discovered",
      checksum: null,
      verifiedAt: null,
      examRelevance: "unknown",
      failureReason: null,
    }],
  });
}

function resource(
  title: string,
  activityType: string,
  status: ResourceNode["status"],
  parentId: string | null,
  originUrl = `https://moodle.technikum-wien.at/mod/resource/view.php?id=${encodeURIComponent(title)}`,
): ResourceNode {
  return {
    id: stableResourceId(originUrl),
    parentId,
    sectionPath: activityType === "resource" || activityType === "file" ? ["Fachthema"] : [],
    activityType,
    title,
    originUrl,
    resolvedUrl: null,
    localPath: status === "acquired" ? "/tmp/source.pdf" : null,
    previewPath: null,
    status,
    checksum: null,
    verifiedAt: null,
    examRelevance: "unknown",
    failureReason: status === "acquired" || status === "discovered" ? null : `${status} fixture`,
  };
}

function plannedResource(
  topic: string,
  parentId: string,
  selected: boolean,
  status: ResourceNode["status"],
  index: number,
): ResourceNode {
  const originUrl = `https://moodle.technikum-wien.at/pluginfile.php/1/source-${index}.pdf`;
  return {
    ...resource(topic, "file", status, parentId, originUrl),
    selection: {
      selected,
      role: selected ? "primary_lecture" : "supplementary",
      topic: selected ? topic : null,
      priority: selected ? 900 : 0,
      reason: selected ? "Critical topic source" : "Outside bounded plan",
    },
    acquisition: {
      status: status === "acquired" ? "completed" : status === "skipped" ? "skipped" : "failed",
      transport: status === "skipped" ? null : "authenticated_request",
      attempts: status === "skipped" ? 0 : 1,
      bytes: status === "acquired" ? 1024 : null,
      durationMs: status === "skipped" ? null : 25,
    },
    extraction: {
      status: status === "acquired" ? "usable" : "not_attempted",
      method: status === "acquired" ? "native_pdf_text" : "none",
      characterCount: status === "acquired" ? 500 : 0,
      pageCount: status === "acquired" ? 2 : null,
      warnings: [],
    },
  };
}

function studyGuideConfig() {
  return moodleTestConfig({
    prompt: "Create a Dynamics study guide PDF",
    intentDecision: {
      intent: "study_pdf",
      wantsPdf: true,
      wantsTypstDocument: true,
      wantsQuickAnswer: false,
      wantsQuizAssistance: false,
      needsMoodle: true,
      needsCis: false,
      needsCalendar: false,
      needsCourseMaterial: true,
      needsDownloadedFiles: true,
      reason: "semantic coverage fixture",
    },
  });
}
