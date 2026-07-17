import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { minimalValidStudyBuddyHtml } from "../htmlShell.js";
import { validateSingleFileHtml, validateWebLayoutHtml } from "../validation.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("single-file HTML validation", () => {
  it("accepts a valid offline interactive HTML fixture", () => {
    const report = validateSingleFileHtml(
      minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" }),
      "flashcards",
    );

    expect(report.ok).toBe(true);
  });

  it("rejects CDN scripts", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" })
      .replace("</body>", "<script src=\"https://cdn.example/app.js\"></script></body>");

    const report = validateSingleFileHtml(html, "flashcards");

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("script-src");
  });

  it("rejects remote images and fonts", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" })
      .replace("</style>", "@font-face { src: url('https://cdn.example/font.woff2'); }</style>")
      .replace("</main>", "<img src=\"https://cdn.example/pic.png\" alt=\"remote\"></main>");

    const report = validateSingleFileHtml(html, "flashcards");

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("external-reference");
  });

  it("rejects fetch", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" })
      .replace("</script>", "fetch('https://example.com')</script>");

    const report = validateSingleFileHtml(html, "flashcards");

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("network-api");
  });

  it("allows user-triggered HTTPS source links", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Reference", kind: "reference", language: "de" })
      .replace("</main>", "<a href=\"https://moodle.example/course\" target=\"_blank\" rel=\"noopener noreferrer\">Quelle</a></main>");

    const report = validateSingleFileHtml(html, "reference");

    expect(report.ok).toBe(true);
  });

  it("rejects sibling-file dependencies in a final artifact", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Reference", kind: "reference", language: "de" })
      .replace("</main>", '<img src="assets/diagram.webp" alt="Diagram"></main>');

    const report = validateSingleFileHtml(html, "reference");

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("sibling-reference");
  });

  it.runIf(process.env.WEB_LAYOUT_BROWSER_TESTS === "1")("passes browser validation", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-browser-"));
    tempDirs.push(runDir);
    const report = await validateWebLayoutHtml(
      minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" }),
      "flashcards",
      { runDir },
    );

    expect(report.ok).toBe(true);
  });
});
