import { readObligationInventory } from "../obligationInventory.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractCourseTargetHint, rawTextContainsRequestedCourse } from "../courseTargeting.js";
import { formatCalendarAnswer } from "../calendarAdapter.js";
import { extractScheduleEvidence } from "../scheduleEvidence.js";
import type { SourceCoverageEntry } from "../runDiagnostics.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { readObligationCoverage } from "../obligationCoverage.js";

export interface QuickAnswerArtifact {
  schemaVersion: 1;
  kind: "quick_answer" | "schedule_answer";
  prompt: string;
  answer: string;
  status: "answered" | "not_found" | "partial";
  confidence: "high" | "medium" | "low";
  sources: Array<{
    kind: "moodle_page" | "cis_page" | "calendar_event" | "pdf" | "file";
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
    const inventory = config.intentDecision?.obligationDiscovery?.requested
      ? await readObligationInventory(config.runDir) : null;
    if (inventory?.answer) {
      const artifact: QuickAnswerArtifact = {
        schemaVersion: 1, kind: "quick_answer", prompt: config.originalUserPrompt,
        answer: inventory.answer, status: inventory.complete ? "answered" : "partial",
        confidence: inventory.complete ? "high" : "low",
        sources: inventory.courses.filter(c => c.status === "audited").map(c => ({ kind: "moodle_page" as const, title: c.title, url: c.url }))
          .concat(inventory.facts.filter(f => f.disposition === "due").map(f => ({ kind: "moodle_page" as const, title: f.label, url: f.url }))),
        missing: inventory.gaps, generatedAt: new Date().toISOString(),
      };
      await mkdir(config.runDir, { recursive: true });
      await Promise.all([
        writeFile(answerPath(config), inventory.answer + "\n"),
        writeFile(answerJsonPath(config), JSON.stringify(artifact, null, 2) + "\n"),
      ]);
      return { final_document: inventory.answer, error_log: null };
    }
    const coverage = config.diagnostics?.getCoverage();
    const obligationDiscovery = config.intentDecision?.obligationDiscovery?.requested === true;
    const obligationCoverage = obligationDiscovery
      ? await readObligationCoverage(config.runDir)
      : null;
    const scheduleEvidence = config.intentDecision?.intent === "schedule_answer"
      ? extractScheduleEvidence(config.prompt, state.moodle_raw_text)
      : null;
    const missing = obligationDiscovery
      ? answerMissingItems(config, state.moodle_raw_text)
      : config.calendarSelection?.complete
        ? []
        : scheduleEvidence?.missing ?? answerMissingItems(config, state.moodle_raw_text);
    if (obligationDiscovery && obligationCoverage?.complete !== true) {
      missing.push(config.outputLanguage === "en"
        ? `Moodle obligation audit incomplete: ${obligationCoverage?.detail ?? "coverage manifest is missing"}`
        : `Moodle-Aufgabenprüfung unvollständig: ${obligationCoverage?.detail ?? "Abdeckungsnachweis fehlt"}`);
    }
    const calendarAnswer = !obligationDiscovery && config.calendarSelection?.complete
      ? formatCalendarAnswer(config.calendarSelection.events, config.outputLanguage)
      : "";
    const extractedAnswer = obligationDiscovery
      ? extractObligationAnswer(state, config.outputLanguage)
      : calendarAnswer || scheduleEvidence?.answer || extractAnswerText(state.extracted_data);
    const fallbackAnswer = fallbackAnswerText(config, missing, obligationCoverage?.complete === true);
    const completenessWarning = obligationDiscovery && obligationCoverage?.complete !== true
      ? config.outputLanguage === "en"
        ? "Important: This is not a complete result because not every discovered course/activity could be verified."
        : "Wichtig: Das ist kein vollständiges Ergebnis, weil nicht alle entdeckten Kurse/Aktivitäten verifiziert werden konnten."
      : "";
    const answer = [extractedAnswer || fallbackAnswer, completenessWarning].filter(Boolean).join("\n\n");
    const status = extractedAnswer && missing.length === 0
      ? "answered"
      : extractedAnswer
        ? "partial"
        : "not_found";
    const artifact: QuickAnswerArtifact = {
      schemaVersion: 1,
      kind: config.intentDecision?.intent === "schedule_answer" ? "schedule_answer" : "quick_answer",
      prompt: config.prompt,
      answer,
      status,
      confidence: status === "answered" ? "high" : status === "partial" ? "low" : "medium",
      sources: coverage ? coverageSources(coverage.moodle, "moodle_page").concat(
        coverageSources(coverage.cis, "cis_page"),
        (config.calendarSelection?.events ?? []).map((event) => ({
          kind: "calendar_event" as const,
          title: event.title,
          coverageNote: coverage.calendar.detail,
        })),
      ) : [],
      missing,
      generatedAt: new Date().toISOString(),
    };

    await mkdir(config.runDir, { recursive: true });
    await Promise.all([
      writeFile(answerPath(config), `${answer.trim()}\n`, "utf8"),
      writeFile(answerJsonPath(config), `${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
    ]);
    await config.diagnostics?.log("info", "answer", "Wrote deterministic quick answer artifacts.");

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

function fallbackAnswerText(config: MoodleRuntimeConfig, missing: string[], auditComplete = false): string {
  const target = extractCourseTargetHint(config.prompt).canonicalLabel ?? extractCourseTargetHint(config.prompt).requestedCodes.join(" / ");
  const english = config.outputLanguage === "en";
  if (config.intentDecision?.obligationDiscovery?.requested) {
    if (auditComplete) {
      return english
        ? "No source-confirmed obligation was found in the completely audited Moodle scope."
        : "Im vollständig geprüften Moodle-Bereich wurde keine quellenbestätigte Aufgabe gefunden.";
    }
    return english
      ? "The Moodle obligation audit could not be completed; no reliable negative conclusion is possible."
      : "Die Moodle-Aufgabenprüfung konnte nicht vollständig abgeschlossen werden; eine belastbare Negativaussage ist nicht möglich.";
  }
  if (config.intentDecision?.intent === "schedule_answer") {
    const label = target || (english ? "requested course" : "angefragten");
    return english
      ? `No upcoming ${label} exam date with date, time, and room was found.`
      : `Kein kommender ${label} Prüfungstermin mit Datum, Uhrzeit und Raum gefunden.`;
  }
  if (missing.length > 0) {
    return english
      ? `No reliable answer was found: ${missing.join("; ")}.`
      : `Keine belastbare Antwort gefunden: ${missing.join("; ")}.`;
  }
  return english
    ? "No reliable answer was found in the evaluated sources."
    : "Keine belastbare Antwort in den gelesenen Quellen gefunden.";
}

function extractObligationAnswer(
  state: LangGraphAgentState,
  outputLanguage: MoodleRuntimeConfig["outputLanguage"],
): string {
  const value = state.extracted_data as Record<string, unknown>;
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const byId = new Map<string, { title?: string; url?: string | null }>();
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    if (typeof record.id !== "string") continue;
    byId.set(record.id, {
      title: typeof record.title === "string" ? record.title : undefined,
      url: typeof record.url === "string" ? record.url : null,
    });
  }
  const obligationLines = sections.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const section = entry as Record<string, unknown>;
    const heading = typeof section.heading === "string" ? section.heading.trim() : "";
    const summary = typeof section.summary === "string" ? section.summary.trim() : "";
    if (!heading || !summary) return [];
    const sourceIds = Array.isArray(section.source_ids)
      ? section.source_ids.filter((id): id is string => typeof id === "string")
      : [];
    const directSources = sourceIds
      .map((id) => byId.get(id))
      .filter((source): source is { title?: string; url?: string | null } => Boolean(source?.url));
    if (directSources.length === 0) return [];
    const citations = directSources
      .map((source) => `[${source.title || "Moodle-Quelle"}](${source.url})`)
      .join(", ");
    return [`- **${heading}:** ${summary} (${citations})`];
  });
  const warningLines = (Array.isArray(value.warnings) ? value.warnings : []).flatMap((entry) => {
    if (typeof entry !== "string" || !entry.trim()) return [];
    const warning = entry.trim();
    const source = bestMatchingSource(warning, [...byId.values()]);
    const citation = source?.url
      ? ` ([${source.title || "Moodle-Quelle"}](${source.url}))`
      : "";
    const label = outputLanguage === "en" ? "Audited/note" : "Geprüft/Hinweis";
    return [`- **${label}:** ${warning}${citation}`];
  });
  return [...obligationLines, ...warningLines].join("\n");
}

function bestMatchingSource(
  text: string,
  sources: Array<{ title?: string; url?: string | null }>,
): { title?: string; url?: string | null } | null {
  const textTokens = meaningfulTokens(text);
  const ranked = sources
    .filter((source) => Boolean(source.url))
    .map((source) => ({
      source,
      score: [...meaningfulTokens(source.title ?? "")].reduce(
        (sum, token) => sum + (textTokens.has(token) ? token.length : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score);
  return ranked[0] && ranked[0].score >= 8 ? ranked[0].source : null;
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase("de").match(/[a-z0-9äöüß]{3,}/gi) ?? [])
      .filter((token) => !/^(?:der|die|das|den|dem|des|ein|eine|einer|eines|und|oder|für|kurs|moodle|course|the|and|with|abgabe|aufgabe|test|termin|präsenz|präsenzeinheit|vorbereitung|woche|nächsten|nächste|konkrete)$/.test(token)),
  );
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
    missing.push(config.outputLanguage === "en"
      ? `Target Moodle course was not opened: ${targetLabel}`
      : `Der angefragte Moodle-Kurs wurde nicht geöffnet: ${targetLabel}`);
  }
  if (
    config.intentDecision?.intent === "schedule_answer" &&
    /\b(?:prüfung|pruefung|exam)\b/i.test(config.prompt) &&
    !extractScheduleEvidence(config.prompt, rawText).answer
  ) {
    missing.push(config.outputLanguage === "en"
      ? `${targetLabel || "Target"} direct source did not expose a future exam date`
      : `${targetLabel || "Zielkurs"} hat in der direkten Quelle keinen zukünftigen Prüfungstermin ausgewiesen`);
  }
  return missing;
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
