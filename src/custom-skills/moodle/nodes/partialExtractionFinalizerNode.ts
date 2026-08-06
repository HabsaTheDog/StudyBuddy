import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  clearPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { validateExtractedData } from "../validation.js";

const DEGRADABLE_CONTENT_FAILURE =
  /(?:chapter fragment repair produced no result|invalid application fragment|applied example|representative application|worked example|chapter (?:is )?too shallow|learning characters|anwendungsbeispiel|repräsentative anwendung|kapitel.{0,40}zu (?:kurz|oberflächlich))/i;
const HARD_CONTENT_FAILURE =
  /(?:wrong course|course identity|permission|unauthori[sz]ed|unsafe|invalid citation|contradict|widerspr|broken mathematics|invalid math|formula metadata|units? mismatch|source access|source coverage)/i;

export function canFinalizePartialExtraction(state: LangGraphAgentState): boolean {
  return Boolean(
    state.error_log &&
    Object.keys(state.extracted_data).length > 0 &&
    DEGRADABLE_CONTENT_FAILURE.test(state.error_log) &&
    !HARD_CONTENT_FAILURE.test(state.error_log)
  );
}

export function createPartialExtractionFinalizerNode(config: MoodleRuntimeConfig) {
  return async function partialExtractionFinalizerNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    if (!canFinalizePartialExtraction(state)) return {};
    const pending = await readPendingExtractionRepairs(config.runDir);
    const titles = [...new Set([
      ...(pending?.pendingChapterTitles ?? []),
      ...state.study_model.courseChapters
        .filter((chapter) => state.error_log?.toLocaleLowerCase("de").includes(
          chapter.title.toLocaleLowerCase("de"),
        ))
        .map((chapter) => chapter.title),
    ])];
    if (titles.length === 0) {
      await config.diagnostics?.log(
        "warn",
        "analyzer",
        "A local content failure was degradable, but no exact chapter could be identified; publication remains blocked.",
      );
      return {};
    }

    const extracted = validateExtractedData(state.extracted_data);
    const english = extracted.language === "en";
    const warnings = titles.map((title) => english
      ? `Chapter ${title} is not fully covered: three targeted repairs did not produce a sufficiently validated representative application. Existing validated explanations remain available; the failed replacement was not published.`
      : `Kapitel ${title} ist nicht vollständig abgedeckt: Drei gezielte Reparaturen ergaben keine ausreichend validierte repräsentative Anwendung. Bereits validierte Erklärungen bleiben erhalten; der fehlgeschlagene Ersatz wurde nicht veröffentlicht.`
    );
    const extractedData = validateExtractedData({
      ...extracted,
      warnings: [...new Set([...extracted.warnings, ...warnings])],
    });
    await writeFile(
      path.join(config.runDir, "partial-finalization.json"),
      `${JSON.stringify({
        status: "partial",
        reason: "localized-content-repair-exhausted",
        chapters: titles,
        priorError: state.error_log,
        warnings,
      }, null, 2)}\n`,
      "utf8",
    );
    await clearPendingExtractionRepairs(config.runDir);
    await config.diagnostics?.log(
      "warn",
      "analyzer",
      `Finalized validated partial coverage after bounded repair exhaustion: ${titles.join(" · ")}`,
    );
    return {
      extracted_data: extractedData,
      error_log: null,
    };
  };
}
