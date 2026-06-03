import type { CodexClient } from "../../codexClient.js";
import type { ExtractedData } from "../../schemas.js";
import type { LangGraphAgentState } from "../../state.js";
import type { MoodleRuntimeConfig } from "../../types.js";

export function moodleTestConfig(overrides: Partial<MoodleRuntimeConfig> = {}): MoodleRuntimeConfig {
  return {
    prompt: "make compact notes",
    moodleUrl: "https://moodle.example/course",
    outputPath: "/tmp/document.typ",
    runDir: "/tmp",
    maxDepth: 0,
    maxPages: 1,
    allowFileDownloads: false,
    baseUrl: "https://moodle.example",
    dashboardUrl: "https://moodle.example/my",
    headless: true,
    ...overrides,
  };
}

export function moodleTestState(overrides: Partial<LangGraphAgentState> = {}): LangGraphAgentState {
  return {
    moodle_raw_text: "",
    extracted_data: {},
    final_document: "",
    error_log: null,
    retry_count: 0,
    ...overrides,
  };
}

export function moodleExtractedData(overrides: Partial<ExtractedData> = {}): ExtractedData {
  return {
    document_title: "DYN2",
    language: "de",
    course: { title: "Dynamik", url: "https://moodle.example/course" },
    sources: [],
    sections: [],
    formulas: [],
    worked_examples: [],
    quiz_style_questions: [],
    warnings: [],
    ...overrides,
  };
}

export function sequenceCodex(outputs: string[]): CodexClient {
  let index = 0;
  return {
    async run() {
      const output = outputs[index];
      index += 1;
      if (output === undefined) {
        throw new Error("No mock Codex output left.");
      }
      return output;
    },
  };
}
