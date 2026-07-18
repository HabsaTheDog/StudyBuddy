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
import { decideRenderStrategy } from "../renderStrategy.js";
import { writeRunProgress } from "../runProgress.js";
import { renderStudentFirstTypst } from "../studentFirstTypstRenderer.js";

export function createFormatterNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function formatterNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const decision = config.renderStrategyDecision ?? decideRenderStrategy(config);
      if (
        !state.error_log &&
        state.review_report.ok &&
        state.study_model.publicationStatus !== "blocked"
      ) {
        const document = renderStudentFirstTypst(state.study_model);
        const validation = await validateGeneratedDocument(document, config);
        if (!validation.ok) {
          return {
            final_document: document,
            error_log: `Student-first Typst renderer failed:\n${validation.error}`,
            retry_count: state.retry_count + 1,
          };
        }
        await persistFormatterAttempt(config.runDir, state.retry_count + 1, document, null);
        return {
          final_document: document,
          error_log: null,
        };
      }
      config.renderStrategyDecision = decision;
      await config.diagnostics?.log("info", "formatter", `Render strategy: ${decision.strategy}. ${decision.reason}`);
      await writeRunProgress(config, { phase: "writing_document" });
      if (!state.error_log && decision.strategy === "deterministic") {
        const document = renderDeterministicStudyDocument(
          validateExtractedData(state.extracted_data),
          config.diagnostics?.getCoverage() ?? emptyCoverage(),
          { prompt: config.prompt, profile: config.artifactIntent.profile },
        );
        const validation = await validateGeneratedDocument(document, config);
        if (!validation.ok) {
          await config.diagnostics?.log(
            "warn",
            "formatter",
            "Deterministic renderer output was not suitable; switching to LLM formatter.",
          );
          config.renderStrategyDecision = {
            strategy: "llm_formatter",
            reason: `Deterministic renderer validation failed: ${validation.error}`,
          };
        } else {
          await persistFormatterAttempt(config.runDir, state.retry_count + 1, document, null);
          return {
            final_document: document,
            error_log: null,
          };
        }
      }
      const semanticRepair = state.error_log?.startsWith("Semantic quality review failed:") ?? false;
      if (state.error_log && state.retry_count > 0 && !semanticRepair) {
        await config.diagnostics?.log(
          "warn",
          "formatter",
          "Using deterministic Study Buddy renderer after a failed free-form Typst attempt.",
        );
        const fallback = renderDeterministicStudyDocument(
          validateExtractedData(state.extracted_data),
          config.diagnostics?.getCoverage() ?? emptyCoverage(),
          { prompt: config.prompt, profile: config.artifactIntent.profile },
        );
        const fallbackValidation = await validateGeneratedDocument(fallback, config);
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
      const typst = await codex.run(buildFormatterPrompt(config, state), {
        task: "artifact_builder",
        attempt: state.retry_count + 1,
      });
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
      const validation = await validateTypst(document, supportFiles, { assetBaseDir: config.runDir });
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
  config: MoodleRuntimeConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const structure = validateStudyBuddyDocumentStructure(document);
  if (!structure.ok) {
    return {
      ok: false,
      error: `Study Buddy document rules failed:\n- ${structure.errors.join("\n- ")}`,
    };
  }
  const supportFiles = await getStudyBuddyTypstSupportFiles();
  const validation = await validateTypst(document, supportFiles, {
    assetBaseDir: config.runDir,
    preview: config.typstValidationMode === "strict" ? true : requiresPreview(document),
  });
  return validation.ok ? { ok: true } : validation;
}

function requiresPreview(document: string): boolean {
  return /#image\s*\(|#sb-figure\s*\(|#sb-flowchart|#sb-block-diagram|#cetz|#canvas/i.test(document);
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
    calendar: {
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
    studyBuddyTemplatePromptReference(config.outputLanguage),
    `Artifact language: ${config.outputLanguage === "en" ? "English" : "German"}. Do not let the source language override it.`,
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
