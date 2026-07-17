import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NonRetryableCodexError,
  classifyCodexError,
  type CodexClient,
} from "../codexClient.js";
import { extractedDataJsonSchema } from "../schemas.js";
import { createAnalyzerNode } from "../nodes/analyzerNode.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

describe("analyzerNode", () => {
  it("parses Codex JSON, validates defaults, and passes the schema hint", async () => {
    let receivedPrompt = "";
    let receivedSchema: unknown;
    const codex: CodexClient = {
      async run(prompt, options) {
        receivedPrompt = prompt;
        receivedSchema = options?.outputSchema;
        return '```json\n{"document_title":"DYN2","course":{"title":"Dynamik"}}\n```';
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({
      moodle_raw_text: "Feder-Daempfer-System",
      error_log: "Previous schema error",
      retry_count: 2,
      }),
    );

    expect(receivedPrompt).toContain("Previous validation error to repair:\nPrevious schema error");
    expect(receivedPrompt).toContain("Feder-Daempfer-System");
    expect(receivedPrompt).toContain("A study guide must teach the material");
    expect(receivedPrompt).toContain("origin='derived'");
    expect(receivedSchema).toBe(extractedDataJsonSchema);
    expect(result.error_log).toBeNull();
    expect(result.retry_count).toBeUndefined();
    expect(result.extracted_data).toMatchObject({
      document_title: "DYN2",
      language: "de",
      course: { title: "Dynamik", url: "" },
      sections: [],
      formulas: [],
    });
  });

  it("keeps invalid analyzer output in retry state", async () => {
    const codex: CodexClient = {
      async run() {
        return '"not an object"';
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({
      retry_count: 1,
      }),
    );

    expect(result.extracted_data).toBeUndefined();
    expect(result.error_log).toMatch(/^Analyzer failed:/);
    expect(result.retry_count).toBe(2);
  });

  it("caps quick-answer source context before invoking Codex", async () => {
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return '{"document_title":"Answer","course":{"title":"Course"}}';
      },
    };
    const config = moodleTestConfig({
      intentDecision: {
        intent: "quick_answer",
        wantsPdf: false,
        wantsTypstDocument: false,
        wantsQuickAnswer: true,
        wantsQuizAssistance: false,
        needsMoodle: true,
        needsCis: false,
        needsCalendar: false,
        needsCourseMaterial: false,
        needsDownloadedFiles: false,
        reason: "test",
      },
    });

    await createAnalyzerNode(config, codex)(
      moodleTestState({ moodle_raw_text: "x".repeat(200_000) }),
    );

    expect(receivedPrompt.length).toBeLessThan(40_000);
  });

  it("caches valid chapter handoffs and repairs only the chapter named by review feedback", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-chapters-"));
    try {
      const calls: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          calls.push(prompt);
          const glue = prompt.includes("Kleben");
          const id = glue ? "glue" : "rivet";
          const title = glue ? "Kleben" : "Nieten";
          return JSON.stringify({
            document_title: "MEL",
            language: "de",
            course: { title: "MEL", url: "https://moodle.example/course" },
            sources: [{ id, title, kind: "pdf", url: `https://moodle.example/${id}.pdf`, path: `/tmp/${id}.pdf`, page: 1 }],
            sections: [{ heading: title, summary: `${title} ausführlich erklärt.`, key_concepts: [`${title} anwenden`], source_ids: [id] }],
            formulas: [],
            worked_examples: [{
              origin: "source",
              learning_goal: `${title} berechnen`,
              prompt: `${title} Beispiel`,
              steps: ["Gegebenes erfassen", "Ergebnis bestimmen"],
              result: "Ergebnis",
              source_ids: [id],
            }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("glue", "Foliensatz: Kleben", "Eigenstudium 2", "primary_lecture"),
        chapterResource("glue-solution", "Lösung 5", "Eigenstudium 2", "worked_example"),
        chapterResource("rivet", "Foliensatz: Nietverbindung", "Eigenstudium 3", "primary_lecture"),
        chapterResource("rivet-solution", "Lösung 7", "Eigenstudium 3", "worked_example"),
      ];
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const baseState = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
      });

      const first = await createAnalyzerNode(config, codex)(baseState);
      const repaired = await createAnalyzerNode(config, codex)({
        ...baseState,
        error_log: "Chapter is too shallow: Klebeverbindungen",
      });

      expect(calls).toHaveLength(3);
      expect(first.extracted_data).toMatchObject({ sections: [{ heading: "Kleben" }, { heading: "Nieten" }] });
      expect(repaired.error_log).toBeNull();
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("exhausts the retry budget immediately for deterministic model errors", async () => {
    const codex: CodexClient = {
      async run() {
        throw new NonRetryableCodexError(
          "Model requires a newer version of Codex.",
          "model_incompatible",
        );
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({ retry_count: 0 }),
    );

    expect(result.error_log).toContain("Analyzer failed (non-retryable)");
    expect(result.retry_count).toBe(3);
  });

  it.each([
    [new Error("This model requires a newer version of Codex"), "model_incompatible"],
    [new Error("Update your Codex version to use this model"), "model_incompatible"],
    [new Error("Unsupported model: gpt-future"), "model_unavailable"],
    [{ status: 404, error: { code: "model_not_found" } }, "model_unavailable"],
    [{ statusCode: 401, message: "Unauthorized" }, "authentication"],
    [new Error("Auth failed: not logged in"), "authentication"],
    [{ response: { status: 400 }, message: "Invalid request" }, "invalid_request"],
  ])("classifies deterministic SDK rejection %# as non-retryable", (error, category) => {
    expect(classifyCodexError(error)).toEqual({ category, retryable: false });
  });

  it.each([
    [new Error("Selected model is at capacity. Please try a different model."), "model_capacity"],
    [new Error("rate limit exceeded"), "rate_limit"],
    [new Error("network connection reset"), "network"],
    [new Error("temporary service issue"), "unknown"],
  ])("leaves transient/unknown error %# retryable", (error, category) => {
    expect(classifyCodexError(error)).toEqual({ category, retryable: true });
  });
});

function chapterResource(
  id: string,
  title: string,
  section: string,
  role: "primary_lecture" | "worked_example",
) {
  return {
    id: `res_${id}`,
    parentId: null,
    sectionPath: [section],
    activityType: "resource",
    title,
    originUrl: `https://moodle.example/${id}.pdf`,
    resolvedUrl: null,
    localPath: `/tmp/${id}.pdf`,
    previewPath: null,
    status: "acquired" as const,
    checksum: id,
    verifiedAt: null,
    examRelevance: "unknown" as const,
    failureReason: null,
    selection: { selected: true, role, topic: null, priority: 1, reason: "test" },
  };
}
