import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ModelCallTimeoutError, type CodexClient } from "../codexClient.js";
import {
  clearPendingExtractionRepairs,
  persistPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray } from "../validation.js";

const qualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "summary", "findings"],
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
  },
} as const;

export function createQualityReviewerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function qualityReviewerNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const previousReview = await readPendingExtractionRepairs(config.runDir);
      const response = await codex.run(buildQualityReviewPrompt(
        config,
        state,
        previousReview?.reviewError ?? null,
      ), {
        outputSchema: qualityReviewSchema,
        task: "quality_reviewer",
        attempt: state.retry_count + 1,
      });
      const parsed = validateQualityReview(parseJsonObjectOrArray(response));
      const localized = localizeQualityFindings(parsed.findings, state);
      await writeFile(
        path.join(config.runDir, "quality-review.json"),
        `${JSON.stringify({
          ...parsed,
          blocking_findings: localized.blocking,
          advisory_findings: localized.advisory,
        }, null, 2)}\n`,
        "utf8",
      );
      if (parsed.ok || localized.blocking.length === 0) {
        await clearPendingExtractionRepairs(config.runDir);
        if (!parsed.ok && localized.advisory.length > 0) {
          await config.diagnostics?.log(
            "warn",
            "analyzer",
            `Semantic review returned ${localized.advisory.length} non-localized/presentation finding(s); extraction remains valid and rendering owns those concerns.`,
          );
        }
        await config.diagnostics?.log("info", "analyzer", "Semantic quality review passed.");
        return { error_log: null };
      }
      const message = `Semantic quality review failed:\n- ${localized.blocking.join("\n- ")}`;
      await persistPendingExtractionRepairs(
        config.runDir,
        message,
        state.retry_count + 1,
      );
      await config.diagnostics?.log("warn", "analyzer", message);
      return { error_log: message, retry_count: state.retry_count + 1 };
    } catch (error) {
      if (config.stage === "extract" && error instanceof ModelCallTimeoutError) {
        throw new StudyBuddyCheckpointError(
          `Extraction capacity checkpoint required: ${error.task} on ${error.model} ` +
          `produced no token usage within ${error.timeoutMs}ms. Resume after fair model admission.`,
        );
      }
      return {
        error_log: `Quality reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

export function buildQualityReviewPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  previousReviewError: string | null = null,
): string {
  const artifact = state.final_document.trim()
    ? `Generated artifact:\n${state.final_document.slice(0, 30_000)}`
    : `Structured study model review view:\n${JSON.stringify(compactStudyModelForReview(state))}`;
  return [
    "Review this Study Buddy artifact for factual grounding, disciplinary and internal consistency, pedagogical usefulness, and alignment with the requested output.",
    "Return JSON only and do not rewrite, invoke tools, open files, or infer facts from omitted source material.",
    "This is an extraction-handoff review. Deterministic gates already check schema, citations, formula metadata, chapter depth and representative application; do not reject renderer-owned layout, navigation, schedules, or presentation.",
    "Set ok=false only for a localized factual contradiction, invalid citation, broken mathematics/units, unusably shallow covered chapter, missing mode-appropriate representative application, or an example whose shown givens and steps cannot produce its result.",
    "Respect contentMode: quantitative work needs a reproducible calculation/derivation; cases need traceable evidence and decision; procedures need executable steps and error/decision points; conceptual chapters may prove depth through explanation and comparison.",
    "Derived examples with declared values are valid when the cited rule is source-backed. A lookup-dependent example is invalid if it merely copies table/diagram values without showing the visible asset and selection method.",
    "Narrow documented source gaps and publicationStatus='partial' are acceptable. Do not demand optional breadth, a detached practice bank, invented material, one example per formula, or one worked example per official Moodle topic.",
    "For a grouped quantitative chapter, one or two representative executable applications spanning distinct methods are sufficient. Remaining official topics may be substantively covered by an accurate explanation plus a usable method or formula.",
    previousReviewError
      ? "This is a repair verification. Check whether the previously reported blocking defects are resolved. Do not introduce stricter example-count rules or unrelated new breadth requirements; add a new blocker only for a concrete contradiction, invalid mathematics/citation, or unusable method visible in the repaired handoff."
      : "",
    previousReviewError
      ? `Previous blocking review:\n${previousReviewError}`
      : "",
    "Formula strings use Typst, not TeX. Source-index mappings are valid citations.",
    "Every blocking finding must begin `[chapter: EXACT TITLE]`. Split chapters; put non-localizable or non-blocking observations only in summary with no finding.",
    `User request:\n${config.prompt}`,
    `Allowed exact chapter titles:\n${JSON.stringify(state.study_model.courseChapters.map((chapter) => chapter.title))}`,
    `Deterministic review:\n${JSON.stringify(state.review_report)}`,
    artifact,
  ].join("\n\n");
}

function localizeQualityFindings(
  findings: string[],
  state: LangGraphAgentState,
): { blocking: string[]; advisory: string[] } {
  const chapters = state.study_model.courseChapters.map((chapter, index) => ({
    title: chapter.title,
    index: index + 1,
    normalizedTitle: normalizeReviewText(chapter.title),
    terms: reviewTerms(chapter.title),
  }));
  const blocking: string[] = [];
  const advisory: string[] = [];

  for (const finding of findings) {
    const explicit = /\[chapter:\s*([^\]]+)\]/i.exec(finding)?.[1]?.trim();
    let matched = explicit
      ? chapters.filter((chapter) => chapter.normalizedTitle === normalizeReviewText(explicit))
      : [];
    if (matched.length === 0) {
      const numbered = /\b(?:kapitel|chapter)\s+(\d{1,2})\b/i.exec(finding)?.[1];
      if (numbered) {
        matched = chapters.filter((chapter) => chapter.index === Number(numbered));
      }
    }
    if (matched.length === 0) {
      const normalizedFinding = normalizeReviewText(finding);
      matched = chapters.filter((chapter) =>
        normalizedFinding.includes(chapter.normalizedTitle) ||
        chapter.terms.some((term) => normalizedFinding.includes(term))
      );
    }
    // More than three matches usually means generic language rather than a
    // localized defect. Do not invalidate most of a course from one sentence.
    if (matched.length === 0 || matched.length > 3) {
      advisory.push(finding);
      continue;
    }
    const message = finding.replace(/\[chapter:\s*[^\]]+\]\s*/i, "").trim();
    for (const chapter of matched) {
      blocking.push(`[chapter: ${chapter.title}] ${message}`);
    }
  }
  return {
    blocking: [...new Set(blocking)],
    advisory: [...new Set(advisory)],
  };
}

function normalizeReviewText(value: string): string {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function reviewTerms(title: string): string[] {
  const ignored = new Set([
    "kapitel", "grundlagen", "anwendungen", "berechnen", "bestimmen", "auslegen",
    "praesenz", "eigenstudium", "unter", "sowie", "erste", "zweite", "ordnung",
  ]);
  return [...new Set((normalizeReviewText(title).match(/[a-z0-9]{5,}/g) ?? [])
    .flatMap((term) => [
      term,
      term.replace(/(?:ungen|ung|en|e|n|er|es)$/i, ""),
    ])
    .filter((term) => term.length >= 5 && !ignored.has(term)))];
}

function compactStudyModelForReview(state: LangGraphAgentState) {
  const model = state.study_model;
  const referencedSourceIds = new Set([
    ...model.topics.flatMap((topic) => topic.sourceIds),
    ...model.formulas.flatMap((formula) => formula.sourceIds),
    ...model.workedExamples.flatMap((example) => example.sourceIds),
    ...model.figures.flatMap((figure) => figure.sourceIds),
  ]);
  return {
    profile: model.profile,
    title: model.title,
    courseTitle: model.courseTitle,
    publicationStatus: model.publicationStatus,
    scopeNote: model.scopeNote,
    chapters: model.courseChapters.map((chapter) => {
      const officialTopicCount = new Set(chapter.learningObjectives.flatMap((objective) =>
        [...objective.matchAll(/(?:Thema|Topic)\s+(\d{1,2})\b/gi)]
          .map((match) => Number(match[1]))
      )).size;
      const lookupPattern = /(?:TB\s*\d|tabelle|nennmaßbereich|nennmassbereich|toleranzgrad|grundabmaß|grundabmass|EI|ES|ei|es)/i;
      const mandatoryAssetPattern = /(?:TB\s*\d|lernausschnitt|roloff|matek|viskositäts?-temperatur|viscosity-temperature|diagrammabbildung|nachschlag)/i;
      const priorityScore = (value: string) =>
        Number(mandatoryAssetPattern.test(value)) * 100 + Number(lookupPattern.test(value)) * 10;
      const prioritizeLookup = <T>(values: T[], text: (value: T) => string) => [...values].sort(
        (left, right) => priorityScore(text(right)) - priorityScore(text(left)),
      );
      const topics = prioritizeLookup(
        model.topics.filter((topic) => topic.chapterId === chapter.id),
        (topic) => `${topic.title} ${topic.summary} ${topic.learningGoals.join(" ")}`,
      ).slice(0, Math.max(2, officialTopicCount));
      const examples = prioritizeLookup(
        model.workedExamples.filter((example) => example.chapterId === chapter.id),
        (example) => `${example.learningGoal} ${example.prompt} ${example.steps.join(" ")}`,
      ).slice(0, 2);
      const figures = prioritizeLookup(
        model.figures.filter((figure) => figure.chapterId === chapter.id),
        (figure) => `${figure.title} ${figure.caption}`,
      ).slice(0, 1);
      return {
        id: chapter.id,
        title: chapter.title,
        status: chapter.status,
        priority: chapter.priority,
        contentMode: chapter.contentMode,
        learningObjectives: compactReviewObjectives(chapter.learningObjectives),
        assessmentSignals: chapter.assessmentSignals
          .slice(0, 8)
          .map((signal) => signal.slice(0, 140)),
        topics: topics.map((topic) => ({
          title: topic.title,
          summary: topic.summary.slice(0, 520),
          learningGoals: topic.learningGoals.slice(0, 4).map((goal) => goal.slice(0, 180)),
          sourceIds: topic.sourceIds,
        })),
        formulas: model.formulas
          .filter((formula) => formula.chapterId === chapter.id)
          .slice(0, 3)
          .map((formula) => ({
            name: formula.name,
            expression: formula.expression,
            variables: formula.variables,
            units: formula.units,
            assumptions: formula.assumptions.slice(0, 220),
          })),
        workedExamples: examples.map((example) => ({
          origin: example.origin,
          learningGoal: example.learningGoal,
          prompt: compactReviewText(example.prompt, 400),
          steps: example.steps.slice(0, 6).map((step) => compactReviewText(step, 480)),
          result: compactReviewText(example.result, 400),
          sourceIds: example.sourceIds,
        })),
        figures: figures.map((figure) => ({
          kind: figure.kind,
          title: figure.title,
          caption: figure.caption.slice(0, 280),
          sourcePage: figure.sourcePage,
        })),
      };
    }),
    checklist: model.checklist.slice(0, 8),
    sources: model.sources
      .filter((source) => referencedSourceIds.has(source.id))
      .slice(0, 50)
      .map((source) => ({
        id: source.id,
        title: source.title,
        kind: source.kind,
        originUrl: source.originUrl,
      })),
    deterministicFindings: state.review_report.findings,
  };
}

function compactReviewText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const marker = " … [review view shortened; full field passed deterministic validation] … ";
  const remaining = Math.max(40, maxLength - marker.length);
  const prefixLength = Math.ceil(remaining * 0.7);
  const suffixLength = remaining - prefixLength;
  return `${value.slice(0, prefixLength).trimEnd()}${marker}${value.slice(-suffixLength).trimStart()}`;
}

function compactReviewObjectives(objectives: string[]): string[] {
  return [...new Set(objectives
    .filter((objective) => !/\.{5,}/.test(objective))
    .map((objective) => {
      const official = /^((?:Thema|Topic)\s+\d{1,2}\s*[–-]\s*[^:·]+)(?::|\s+·\s+)?\s*(.*)$/i
        .exec(objective);
      if (!official) return objective.slice(0, 150);
      const detail = official[2].trim();
      return detail
        ? `${official[1].trim()} · ${detail.slice(0, 110)}`
        : official[1].trim();
    }))].slice(0, 14);
}

function validateQualityReview(value: unknown): {
  ok: boolean;
  summary: string;
  findings: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality reviewer returned a non-object response.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.summary !== "string") {
    throw new Error("Quality reviewer response is missing ok or summary.");
  }
  if (!Array.isArray(record.findings) || !record.findings.every((item) => typeof item === "string")) {
    throw new Error("Quality reviewer findings must be a string array.");
  }
  return {
    ok: record.ok,
    summary: record.summary,
    findings: record.findings.slice(0, 12),
  };
}
