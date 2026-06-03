import type { CodexClient } from "../codexClient.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { validateTypst } from "../validation.js";

export function createFormatterNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function formatterNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const typst = await codex.run(buildFormatterPrompt(config, state));
      const document = stripTypstFence(typst);
      const validation = await validateTypst(document);
      if (!validation.ok) {
        return {
          final_document: document,
          error_log: `Typst validation failed:\n${validation.error}`,
          retry_count: state.retry_count + 1,
        };
      }
      return {
        final_document: document,
        error_log: null,
      };
    } catch (error) {
      return {
        error_log: `Formatter failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

function buildFormatterPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): string {
  return [
    "Generate a complete Typst document for an engineering study note.",
    "Return only Typst source. Do not include Markdown fences or explanation.",
    "Use A4 page setup, readable headings, source notes, and strict Typst math syntax.",
    "Escape text content that is not Typst syntax.",
    state.error_log ? `Previous Typst validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Extracted data JSON:\n${JSON.stringify(state.extracted_data, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function stripTypstFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:typst|typ)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return `${(fenced?.[1] ?? trimmed).trim()}\n`;
}
