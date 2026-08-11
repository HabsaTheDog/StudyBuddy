import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import {
  isNonRetryableCodexError,
  resolveModelPromptBodyCharacterBudget,
} from "../codexClient.js";
import { renderDeterministicStudyDocument } from "../deterministicTypstRenderer.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { validateExtractedData, validateTypst } from "../validation.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import { studyBuddyTemplatePromptReference } from "../typstTemplate.js";
import { decideRenderStrategy } from "../renderStrategy.js";
import { writeRunProgress } from "../runProgress.js";
import { throwIfAborted } from "../runtimeAbort.js";
import { normalizeInlineMathSource } from "../typstInlineMath.js";

const FORMATTER_PROMPT_RESERVE = 1_024;

export class FormatterPromptCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatterPromptCapacityError";
  }
}

export function createFormatterNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function formatterNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const decision = config.renderStrategyDecision ?? decideRenderStrategy(config);
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
      await config.diagnostics?.log("info", "formatter", "Generating Typst document...");
      const typst = await codex.run(buildFormatterPrompt(config, state), {
        task: state.error_log ? "artifact_repair" : "artifact_builder",
        attempt: state.retry_count + 1,
      });
      const document = normalizeGeneratedTypstComponents(
        normalizeGeneratedTypstMath(stripTypstFence(typst)),
      );
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
      const validation = await validateTypst(document, supportFiles, {
        assetBaseDir: config.runDir,
        signal: config.abortSignal,
      });
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
      throwIfAborted(config.abortSignal);
      if (
        error instanceof FormatterPromptCapacityError ||
        isNonRetryableCodexError(error) ||
        (error instanceof Error && error.message.includes("exceeds its hard"))
      ) {
        throw error;
      }
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
    signal: config.abortSignal,
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

export function buildFormatterPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): string {
  const task = state.error_log ? "artifact_repair" : "artifact_builder";
  const priorDocument = state.final_document.trim();
  const prompt = state.error_log && priorDocument
    ? buildRepairPrompt(config, state, priorDocument)
    : buildInitialFormatterPrompt(config, state);
  const capacity = resolveModelPromptBodyCharacterBudget(task) - FORMATTER_PROMPT_RESERVE;
  if (prompt.length > capacity) {
    throw new FormatterPromptCapacityError(
      `Formatter producer payload has ${prompt.length} characters and exceeds its ${capacity}-character preflight capacity. ` +
      "The validated extraction or prior document must be partitioned before rendering.",
    );
  }
  return prompt;
}

function buildInitialFormatterPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): string {
  return [
    "Generate a complete, source-grounded Typst learning document appropriate to the course discipline.",
    "Return only Typst source. Do not include Markdown fences or explanation.",
    studyBuddyTemplatePromptReference(config.outputLanguage),
    `Artifact language: ${config.outputLanguage === "en" ? "English" : "German"}. Do not let the source language override it.`,
    "Select components before writing content: shell, document pattern, tables, mathematics, diagrams, exercises, and source notes.",
    "Do not reproduce or redefine component implementations in the generated document.",
    "Set sb-document compact: true only when the exact request explicitly asks for a compact overview, formula sheet, cheat sheet, or similarly dense artifact. Compact mode lets level-1 chapters flow without forced page breaks; otherwise leave compact false.",
    "Never place #sb-divider immediately before a level-1 heading. Choose the heading or the divider, because stacking both can strand the divider on an otherwise blank page.",
    "Escape text content that is not Typst syntax.",
    "For Moodle+CIS runs, include a compact source coverage note that distinguishes Moodle facts from CIS facts.",
    "Do not hide missing Moodle or CIS coverage; include it as a short Quellenlage line.",
    "Typst math syntax is not locale-aware: never write a bare decimal-comma token such as 0,120 inside math because Typst parses the comma as an argument separator. Preserve the German decimal comma by quoting the complete numeric literal, for example $\"0,120\" \"m\"$, while keeping units separate.",
    "In Typst math, separate multiplied single-letter variables with spaces (for example $M d^2$), and use only defined Typst math functions. Do not invent LaTeX helpers such as ddot or introduce LaTeX delimiters such as \\( ... \\).",
    "Keep each formula or unit expression inside one complete Typst math span. Never nest dollar delimiters as in [$rho$: kg/m$^3$]; write [$rho$: $\"kg\"/\"m\"^3$] instead. Use accent(x, dot.double) for a second time derivative; ddot(x) is not a Typst function.",
    state.error_log ? `Pre-render quality finding to address:\n${state.error_log}` : "",
    `Exact original user request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract)}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {})}`,
    `Extracted data JSON:\n${JSON.stringify(compactExtractedDataForFormatter(state.extracted_data))}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRepairPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  priorDocument: string,
): string {
  return [
    "Repair the supplied complete Typst document. Return the complete corrected Typst source only.",
    "Treat the existing document as the authoritative draft. Make the smallest local edits that resolve every supplied compiler or review diagnostic.",
    "After fixing each diagnostic, scan the complete existing source for other occurrences of the same concrete syntax class and normalize those consistently in the same response. For example, one bare decimal-comma diagnostic requires checking every bare decimal-comma numeric literal inside Typst math. Do not use this scan to rewrite unrelated content.",
    "If diagnostics report raw-typesetting-markup, convert every math-bearing component argument from a quoted markup string to Typst content, for example result: [$ x = 2 \"m\" $] and variables: ([$bold(r)$: Ortsvektor],). Preserve the mathematical meaning and all surrounding content.",
    "For a blank_page or sparse-page diagnostic, preserve all content and repair only the pagination cause: remove a divider immediately before a level-1 heading, enable compact mode when the exact request is explicitly compact, or demote a heading only when its hierarchy remains correct. Never delete learner content merely to fill a page.",
    "Do not rewrite, summarize, expand, reorder, translate, or otherwise regenerate unaffected content. Preserve citations, formulas, structure, component calls, wording, and source-grounded scope outside the necessary repair locations.",
    "Use Typst syntax only. Never introduce LaTeX delimiters such as \\( ... \\), \\[ ... \\], or dollar-delimited LaTeX commands. Preserve exactly one Study Buddy document shell and its existing import.",
    "Keep each formula or unit expression inside one complete Typst math span; never nest dollar delimiters. Use accent(x, dot.double) for a second time derivative because ddot(x) is not a Typst function.",
    studyBuddyTemplatePromptReference(config.outputLanguage),
    `Exact original user request (repair boundary only):\n${config.originalUserPrompt}`,
    `Verified request contract (repair boundary only):\n${JSON.stringify(state.request_contract)}`,
    `Diagnostics to repair:\n${state.error_log}`,
    `Existing complete Typst source:\n${priorDocument}`,
  ].join("\n\n");
}

function compactExtractedDataForFormatter(data: LangGraphAgentState["extracted_data"]): unknown {
  if (Array.isArray(data) || !data || typeof data !== "object") return data;
  const record = data as Record<string, unknown>;
  const sources = Array.isArray(record.sources)
    ? record.sources.map((source) => pickObjectFields(source, ["id", "title", "kind", "url", "page"]))
    : record.sources;
  const visualAssets = Array.isArray(record.visual_assets)
    ? record.visual_assets.map((asset) => pickObjectFields(asset, [
        "id",
        "kind",
        "relative_path",
        "title",
        "caption_hint",
        "source_id",
        "source_page",
        "confidence",
        "width_px",
        "height_px",
      ]))
    : record.visual_assets;
  const warnings = Array.isArray(record.warnings)
    ? [...new Set(record.warnings.filter((warning): warning is string => typeof warning === "string"))]
    : record.warnings;
  return { ...record, sources, visual_assets: visualAssets, warnings };
}

function pickObjectFields(value: unknown, fields: readonly string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}

function stripTypstFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:typst|typ)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return `${(fenced?.[1] ?? trimmed).trim()}\n`;
}

/**
 * Canonicalize model-authored math syntax without changing prose, component
 * structure, or document semantics. Analyzer fragments intentionally use a
 * small subject-neutral math shorthand; the final Typst document must not
 * depend on a repair model translating that shorthand perfectly.
 */
export function normalizeGeneratedTypstMath(source: string): string {
  let result = "";
  let cursor = 0;
  let mathStart = -1;
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && !isEscaped(source, index)) {
      inString = !inString;
      continue;
    }
    if (character !== "$" || inString || isEscaped(source, index)) continue;

    if (mathStart < 0) {
      result += source.slice(cursor, index + 1);
      mathStart = index + 1;
      cursor = index + 1;
      continue;
    }

    result += `${normalizeInlineMathSource(source.slice(mathStart, index))}$`;
    cursor = index + 1;
    mathStart = -1;
  }

  return mathStart < 0 ? result + source.slice(cursor) : source;
}

/**
 * Preserve optional explanatory prose emitted after source notes while
 * canonicalizing it to the component's supported two-argument signature.
 * This is a syntax-only rewrite: the note and its complete body remain in the
 * same location and order.
 */
export function normalizeGeneratedTypstComponents(source: string): string {
  const needle = "#sb-source-note(";
  let result = "";
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(needle, cursor);
    if (start < 0) return result + source.slice(cursor);
    const argsOpen = start + needle.length - 1;
    const argsClose = findMatchingDelimiter(source, argsOpen, "(", ")");
    if (argsClose < 0) return result + source.slice(cursor);
    let bodyOpen = argsClose + 1;
    while (/\s/.test(source[bodyOpen] ?? "")) bodyOpen += 1;
    if (source[bodyOpen] !== "[") {
      result += source.slice(cursor, argsClose + 1);
      cursor = argsClose + 1;
      continue;
    }
    const bodyClose = findMatchingDelimiter(source, bodyOpen, "[", "]");
    if (bodyClose < 0) return result + source.slice(cursor);

    result += source.slice(cursor, argsClose + 1);
    const body = source.slice(bodyOpen + 1, bodyClose).trim();
    if (body) result += `\n${body}`;
    cursor = bodyClose + 1;
  }
  return result;
}

function findMatchingDelimiter(
  value: string,
  openIndex: number,
  open: "(" | "[",
  close: ")" | "]",
): number {
  let depth = 0;
  let inString = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && !isEscaped(value, index)) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}
