import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { renderDeterministicStudyDocument } from "../deterministicTypstRenderer.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { validateExtractedData, validateTypst } from "../validation.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import { studyBuddyTemplatePromptReference } from "../typstTemplate.js";

export function createFormatterNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function formatterNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      if (state.error_log && state.retry_count > 0) {
        await config.diagnostics?.log(
          "warn",
          "formatter",
          "Using deterministic Study Buddy renderer after a failed free-form Typst attempt.",
        );
        const fallback = renderDeterministicStudyDocument(
          validateExtractedData(state.extracted_data),
          config.diagnostics?.getCoverage() ?? emptyCoverage(),
        );
        const fallbackValidation = await validateGeneratedDocument(fallback);
        if (!fallbackValidation.ok) {
          return {
            final_document: fallback,
            error_log: `Deterministic Typst fallback failed:\n${fallbackValidation.error}`,
            retry_count: state.retry_count + 1,
          };
        }
        await persistFormatterAttempt(config.runDir, state.retry_count + 1, fallback, null);
        return {
          final_document: fallback,
          error_log: null,
        };
      }
      await config.diagnostics?.log("info", "formatter", "Generating Typst document...");
      const typst = await codex.run(buildFormatterPrompt(config, state));
      const document = stripTypstFence(typst);
      const structureValidation = validateStudyBuddyDocumentStructure(document);
      if (!structureValidation.ok) {
        const error = `Study Buddy document rules failed:\n- ${structureValidation.errors.join("\n- ")}`;
        await persistFormatterAttempt(config.runDir, state.retry_count + 1, document, error);
        await config.diagnostics?.log(
          "warn",
          "typst",
          "Study Buddy document structure validation failed; routing back to formatter.",
        );
        return {
          final_document: document,
          error_log: error,
          retry_count: state.retry_count + 1,
        };
      }
      const supportFiles = await getStudyBuddyTypstSupportFiles();
      const validation = await validateTypst(document, supportFiles);
      if (!validation.ok) {
        const error = `Typst validation failed:\n${validation.error}`;
        await persistFormatterAttempt(config.runDir, state.retry_count + 1, document, error);
        await config.diagnostics?.log("warn", "typst", "Typst validation failed; routing back to formatter.");
        return {
          final_document: document,
          error_log: error,
          retry_count: state.retry_count + 1,
        };
      }
      await persistFormatterAttempt(config.runDir, state.retry_count + 1, document, null);
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

async function persistFormatterAttempt(
  runDir: string,
  attempt: number,
  document: string,
  error: string | null,
): Promise<void> {
  const diagnosticsDir = path.join(runDir, "diagnostics");
  await mkdir(diagnosticsDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(diagnosticsDir, `formatter-attempt-${attempt}.typ`), document, "utf8"),
    writeFile(path.join(diagnosticsDir, `formatter-attempt-${attempt}.log`), error ?? "", "utf8"),
  ]);
}

async function validateGeneratedDocument(
  document: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const structure = validateStudyBuddyDocumentStructure(document);
  if (!structure.ok) {
    return {
      ok: false,
      error: `Study Buddy document rules failed:\n- ${structure.errors.join("\n- ")}`,
    };
  }
  const supportFiles = await getStudyBuddyTypstSupportFiles();
  const validation = await validateTypst(document, supportFiles);
  return validation.ok ? { ok: true } : validation;
}

function emptyCoverage() {
  return {
    moodle: {
      status: "not_requested" as const,
      detail: "No coverage diagnostics available.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
    cis: {
      status: "not_requested" as const,
      detail: "No coverage diagnostics available.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
  };
}

function buildFormatterPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): string {
  return [
    "Generate a complete Typst document for an engineering study note.",
    "Return only Typst source. Do not include Markdown fences or explanation.",
    studyBuddyTemplatePromptReference(),
    "Select components before writing content: shell, document pattern, tables, mathematics, diagrams, exercises, and source notes.",
    "Do not reproduce or redefine component implementations in the generated document.",
    "Escape text content that is not Typst syntax.",
    "For Moodle+CIS runs, include a compact source coverage note that distinguishes Moodle facts from CIS facts.",
    "Do not hide missing Moodle or CIS coverage; include it as a short Quellenlage line.",
    state.error_log ? `Previous Typst validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {}, null, 2)}`,
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
