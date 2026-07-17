import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { buildResourceManifest, stableResourceId } from "../resourceManifest.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("external resource acquisition", () => {
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
    expect(classifyResourceFailure("Download job timed out after 90000ms.").status)
      .toBe("transient_failure");
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
    const wrongCourse = "https://moodle.technikum-wien.at/course/view.php?id=30986";
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=32280";
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

  it("persists classified failures without turning diagnostics into study evidence", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-resource-failure-"));
    temporaryDirectories.push(runDir);
    const courseUrl = "https://moodle.technikum-wien.at/course/view.php?id=32280";
    const resourceUrl = "https://moodle.technikum-wien.at/mod/resource/view.php?id=1953045";
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
    const targetCourse = "https://moodle.technikum-wien.at/course/view.php?id=32280";
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
});

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
