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

  it("accepts the integrated study-guide contract and rejects missing practice", () => {
    const valid = minimalValidStudyBuddyHtml({ title: "Study Guide", kind: "study-guide", language: "de" });
    const invalid = valid.replace(/data-sb-practice/g, "data-legacy-practice");

    expect(validateSingleFileHtml(valid, "study-guide").ok).toBe(true);
    expect(validateSingleFileHtml(invalid, "study-guide").issues.map((entry) => entry.code))
      .toContain("interaction-requirement");
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

  it("rejects sendBeacon and requires the locked-down offline CSP", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Flashcards", kind: "flashcards", language: "de" })
      .replace("</script>", "navigator.sendBeacon('https://example.com/collect','x')</script>");
    const withoutCsp = html.replace(/<meta\b[^>]*content-security-policy[^>]*>\s*/i, "");

    expect(validateSingleFileHtml(html, "flashcards").issues.map((issue) => issue.code))
      .toContain("network-api");
    expect(validateSingleFileHtml(withoutCsp, "flashcards").issues.map((issue) => issue.code))
      .toContain("content-security-policy");
  });

  it("allows user-triggered HTTPS source links", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Reference", kind: "reference", language: "de" })
      .replace("</main>", "<a href=\"https://moodle.example/course\" target=\"_blank\" rel=\"noopener noreferrer\">Quelle</a></main>");

    const report = validateSingleFileHtml(html, "reference");

    expect(report.ok).toBe(true);
  });

  it("does not mistake JavaScript href assignments for file dependencies", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Reference", kind: "reference", language: "de" })
      .replace(
        "</script>",
        "const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({ok:true},null,2)]));</script>",
      );

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

  it("requires the standardized persistence contract for exam-practice artifacts", () => {
    const valid = minimalValidStudyBuddyHtml({ title: "Exam", kind: "exam-practice", language: "de" });
    const invalid = valid.replace(/data-sb-exam-draft/g, "data-legacy-draft");

    expect(validateSingleFileHtml(valid, "exam-practice").ok).toBe(true);
    expect(validateSingleFileHtml(invalid, "exam-practice").issues.map((entry) => entry.code))
      .toContain("interaction-requirement");
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

  it.runIf(process.env.WEB_LAYOUT_BROWSER_TESTS === "1")(
    "executes the real exam start, draft, reload, lock, timer, and finish flow",
    async () => {
      const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-exam-browser-"));
      tempDirs.push(runDir);
      const report = await validateWebLayoutHtml(
        minimalValidStudyBuddyHtml({ title: "Exam", kind: "exam-practice", language: "de" }),
        "exam-practice",
        { runDir },
      );

      expect(report.ok, report.issues.map((entry) => entry.message).join("\n")).toBe(true);
      expect(report.browserChecks).toEqual([
        expect.objectContaining({
          id: "exam-start-draft-reload-finish",
          ok: true,
        }),
      ]);
    },
  );
});
