import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractCourseTargetHint, rawTextContainsRequestedCourse } from "../courseTargeting.js";
import type { SourceCoverageEntry } from "../runDiagnostics.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

export interface QuickAnswerArtifact {
  schemaVersion: 1;
  kind: "quick_answer" | "schedule_answer";
  prompt: string;
  answer: string;
  status: "answered" | "not_found" | "partial";
  confidence: "high" | "medium" | "low";
  sources: Array<{
    kind: "moodle_page" | "cis_page" | "pdf" | "file";
    title: string;
    url?: string;
    path?: string;
    coverageNote?: string;
  }>;
  missing: string[];
  generatedAt: string;
}

export function createAnswerWriterNode(config: MoodleRuntimeConfig) {
  return async function answerWriterNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const coverage = config.diagnostics?.getCoverage();
    const missing = answerMissingItems(config, state.moodle_raw_text);
    const extractedAnswer = extractAnswerText(state.extracted_data);
    const fallbackAnswer = fallbackAnswerText(config, missing);
    const answer = extractedAnswer || fallbackAnswer;
    const status = extractedAnswer && missing.length === 0
      ? "answered"
      : extractedAnswer
        ? "partial"
        : missing.length > 0
          ? "partial"
          : "not_found";
    const artifact: QuickAnswerArtifact = {
      schemaVersion: 1,
      kind: config.intentDecision?.intent === "schedule_answer" ? "schedule_answer" : "quick_answer",
      prompt: config.prompt,
      answer,
      status,
      confidence: status === "answered" ? "high" : missing.length > 0 ? "low" : "medium",
      sources: coverage ? coverageSources(coverage.moodle, "moodle_page").concat(
        coverageSources(coverage.cis, "cis_page"),
      ) : [],
      missing,
      generatedAt: new Date().toISOString(),
    };

    await mkdir(config.runDir, { recursive: true });
    await Promise.all([
      writeFile(answerPath(config), `${answer.trim()}\n`, "utf8"),
      writeFile(answerJsonPath(config), `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
    ]);
    await config.diagnostics?.log("info", "analyzer", "Wrote quick answer artifacts.");

    return {
      final_document: answer,
      error_log: state.error_log,
    };
  };
}

export function answerPath(config: MoodleRuntimeConfig): string {
  return path.join(config.runDir, "answer.md");
}

export function answerJsonPath(config: MoodleRuntimeConfig): string {
  return path.join(config.runDir, "answer.json");
}

function extractAnswerText(extractedData: LangGraphAgentState["extracted_data"]): string {
  const value = extractedData as Record<string, unknown>;
  for (const key of ["answer", "summary", "result", "final_answer"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const sections = value.sections;
  if (Array.isArray(sections) && sections.length > 0) {
    const first = sections[0] as Record<string, unknown>;
    const title = typeof first.heading === "string" ? first.heading : "";
    const summary = typeof first.summary === "string" ? first.summary : "";
    const combined = [title, summary].filter(Boolean).join(": ");
    if (combined.trim()) {
      return combined.trim();
    }
  }
  const warnings = value.warnings;
  if (Array.isArray(warnings) && warnings.some((entry) => typeof entry === "string" && entry.trim())) {
    return warnings.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).join("\n");
  }
  return "";
}

function fallbackAnswerText(config: MoodleRuntimeConfig, missing: string[]): string {
  const target = extractCourseTargetHint(config.prompt).canonicalLabel ?? extractCourseTargetHint(config.prompt).requestedCodes.join(" / ");
  if (config.intentDecision?.intent === "schedule_answer") {
    const label = target || "angefragten";
    return `Kein kommender ${label} Prüfungstermin mit Datum, Uhrzeit und Raum gefunden.`;
  }
  return missing.length > 0
    ? `Keine belastbare Antwort gefunden: ${missing.join("; ")}.`
    : "Keine belastbare Antwort in den gelesenen Quellen gefunden.";
}

function answerMissingItems(config: MoodleRuntimeConfig, rawText: string): string[] {
  const missing: string[] = [];
  const target = extractCourseTargetHint(config.prompt);
  const targetLabel = target.canonicalLabel ?? target.requestedCodes.join(" / ");
  if (
    config.intentDecision?.needsCourseMaterial &&
    (target.requestedCodes.length > 0 || target.requestedNames.length > 0) &&
    !rawTextContainsRequestedCourse(config.prompt, rawText)
  ) {
    missing.push(`Target Moodle course was not opened: ${targetLabel}`);
  }
  if (
    config.intentDecision?.intent === "schedule_answer" &&
    /\b(?:prüfung|pruefung|exam)\b/i.test(config.prompt) &&
    !hasConcreteScheduleDate(rawText)
  ) {
    missing.push(`${targetLabel || "Target"} CIS detail page did not expose a future Prüfungstermin`);
  }
  return missing;
}

function hasConcreteScheduleDate(text: string): boolean {
  return /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[.]\d{1,2}[.](?:20)?\d{2})\b/.test(text) &&
    /\b(?:\d{1,2}:\d{2}|uhr)\b/i.test(text);
}

function coverageSources(
  entry: SourceCoverageEntry,
  kind: "moodle_page" | "cis_page",
): QuickAnswerArtifact["sources"] {
  const pageSources = entry.urls.map((url) => ({
    kind,
    title: url,
    url,
    coverageNote: entry.detail,
  }));
  const artifactSources = entry.artifacts.map((artifact) => ({
    kind: artifact.toLowerCase().endsWith(".pdf") ? "pdf" as const : "file" as const,
    title: path.basename(artifact),
    path: artifact,
    coverageNote: entry.detail,
  }));
  return [...pageSources, ...artifactSources];
}
