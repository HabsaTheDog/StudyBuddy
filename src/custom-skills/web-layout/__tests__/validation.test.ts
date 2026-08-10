import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { buildAdaptiveStudyModel } from "../adaptiveStudyModel.js";
import { renderAdaptiveStudyGuide } from "../adaptiveStudyGuideRenderer.js";
import { studyBuddyCssTokenBlock } from "../designGuidelines.js";
import { applyOfflineSecurityPolicy, minimalValidStudyBuddyHtml } from "../htmlShell.js";
import type { StudyGuideContent } from "../studyGuideContent.js";
import { validateSingleFileHtml, validateWebLayoutHtml } from "../validation.js";
import { approveQuestionBankForRendering } from "./fixtures/approvedQuestionBank.js";

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

  it.runIf(process.env.WEB_LAYOUT_BROWSER_TESTS === "1")(
    "audits every adaptive learner-state scenario across all required viewports",
    async () => {
      const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-adaptive-browser-"));
      tempDirs.push(runDir);
      const content = adaptiveContentFixture();
      const model = approveQuestionBankForRendering(buildAdaptiveStudyModel(
        content,
        "Ordinary course material without a documented assessment structure.",
        "en",
      ));
      const html = applyOfflineSecurityPolicy(renderAdaptiveStudyGuide(content, model, "en"))
        .replace(":root{", `:root{${studyBuddyCssTokenBlock()}`)
        .replace('src="assets/logo.png"', 'src="data:image/png;base64,iVBORw0KGgo="');

      const report = await validateWebLayoutHtml(html, "study-guide", { runDir });
      const audit = JSON.parse(
        await readFile(path.join(runDir, "interaction-audit.json"), "utf8"),
      ) as {
        ok: boolean;
        auditedStates: number;
        runtimeNetworkRequests: number;
        blockingBrowserIssues: number;
        permissionViolations: number;
        finalQuizSubmissions: number;
        learnerStateScenarios: Record<string, boolean>;
        states: Array<{ viewport: string; ok: boolean }>;
      };

      expect(
        report.ok,
        `${report.issues.map((entry) => entry.message).join("\n")}\n${JSON.stringify(audit, null, 2)}`,
      ).toBe(true);
      expect(report.browserChecks).toEqual([
        expect.objectContaining({
          id: "adaptive-study-guide-all-required-states",
          ok: true,
        }),
      ]);
      expect(audit).toMatchObject({
        ok: true,
        auditedStates: 4,
        runtimeNetworkRequests: 0,
        blockingBrowserIssues: 0,
        permissionViolations: 0,
        finalQuizSubmissions: 0,
      });
      expect(audit.states.map((state) => state.viewport))
        .toEqual(["desktop", "laptop", "tablet", "mobile"]);
      expect(Object.keys(audit.learnerStateScenarios)).toHaveLength(26);
      expect(audit.learnerStateScenarios["three-main-tabs"]).toBe(true);
      expect(audit.learnerStateScenarios["topic-question-navigation"]).toBe(true);
      expect(audit.learnerStateScenarios["catalog-links-scroll-to-top"]).toBe(true);
      expect(audit.learnerStateScenarios["exam-tasks-are-authentic"]).toBe(true);
      expect(audit.learnerStateScenarios["exam-finish-only-on-last-question"]).toBe(true);
      expect(audit.learnerStateScenarios["exam-solutions-visible"]).toBe(true);
      expect(audit.learnerStateScenarios["exam-self-assessment-collapsed"]).toBe(true);
      expect(audit.learnerStateScenarios["exam-detailed-criteria-collapsed"]).toBe(true);
      expect(audit.learnerStateScenarios["exam-self-assessment-scoring"]).toBe(true);
      expect(Object.values(audit.learnerStateScenarios).every(Boolean)).toBe(true);
    },
    60_000,
  );
});

function adaptiveContentFixture(): StudyGuideContent {
  const source = {
    label: "Course reader",
    sourceTask: "Unit 1 evidence",
    provenance: "source" as const,
  };
  return {
    courseTitle: "Adaptive validation",
    courseCode: "AV",
    scopeNote: "A compact source-grounded fixture for deterministic adaptive browser validation.",
    topics: [{
      id: "unit-1",
      title: "Unit 1",
      learningGoals: ["Explain and apply the documented relationship."],
      theory: {
        summary: "The source establishes a relationship, demonstrates its application, and distinguishes a supported conclusion from an unsupported one. ".repeat(2),
        keyIdeas: ["Use the documented relationship.", "Check the result against the supplied evidence."],
        formulas: [{ expression: "y = 2x", meaning: "Documented proportional relationship" }],
      },
      workedExamples: [{
        title: "Worked application",
        prompt: "Apply the relationship for x = 2.",
        steps: ["Substitute x = 2.", "Multiply by two."],
        answer: "y = 4",
        source,
      }],
      exercises: [
        {
          id: "unit-cross",
          type: "cross",
          prompt: "Which statement follows from the documented relationship?",
          selectionMode: "single",
          options: [
            { text: "For x = 2, y = 4.", correct: true, feedback: "Correct." },
            { text: "For x = 2, y = 1.", correct: false, feedback: "This reverses the relationship." },
          ],
          explanation: "Substituting x = 2 into y = 2x gives y = 4.",
          source,
        },
        {
          id: "unit-calculation",
          type: "calculation",
          prompt: "Calculate y when x = 3.",
          givens: ["x = 3", "y = 2x"],
          acceptedAnswers: ["6"],
          unit: "",
          steps: ["Substitute x = 3.", "Evaluate 2 × 3."],
          commonMistake: "Do not divide x by two.",
          source,
        },
        {
          id: "unit-application",
          type: "application",
          prompt: "Explain how you would check a proposed value of y.",
          instructions: ["Substitute x.", "Compare the calculated and proposed values."],
          sampleAnswer: "I substitute x into y = 2x and compare the result with the proposed y.",
          selfCheck: ["The relationship is named.", "The comparison is explicit."],
          source,
        },
      ],
      retrieval: [{ prompt: "What is the relationship?", answer: "y = 2x" }],
    }],
    sources: [{
      id: "reader",
      label: "Course reader",
      url: "",
      coverage: "Unit 1",
    }],
  };
}
