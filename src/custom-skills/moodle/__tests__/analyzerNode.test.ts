import { describe, expect, it } from "vitest";
import type { CodexClient } from "../codexClient.js";
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
});
