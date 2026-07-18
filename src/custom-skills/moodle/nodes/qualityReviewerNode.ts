import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ModelCallTimeoutError, type CodexClient } from "../codexClient.js";
import {
  clearPendingExtractionRepairs,
  persistPendingExtractionRepairs,
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
      const response = await codex.run(buildQualityReviewPrompt(config, state), {
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
): string {
  const artifact = state.final_document.trim()
    ? `Generated artifact:\n${state.final_document.slice(0, 45_000)}`
    : `Structured study model review view:\n${JSON.stringify(compactStudyModelForReview(state))}`;
  return [
    "Review this Study Buddy artifact for factual grounding, disciplinary and internal consistency, pedagogical usefulness, and alignment with the requested output.",
    "Do not rewrite the artifact. Return JSON only. Mark ok=false only for concrete issues that require a new analysis or build attempt.",
    "This is an extraction-handoff review, not the final PDF review. Do not reject missing layout, page structure, a learning schedule, study-plan presentation, navigation, or other elements owned by the deterministic renderer.",
    "The deterministic review already enforces chapter depth, citations, formula metadata, and representative application. Focus your findings on concrete contradictions, broken mathematics/units, or an example whose shown inputs and steps cannot produce its result. Do not demand broader topic coverage from this compact view.",
    "Every blocking finding must begin with `[chapter: EXACT TITLE]`, using exactly one title from the supplied chapter-title list. Split issues for different chapters into separate findings. If an issue cannot be assigned to one exact chapter, put it only in summary and keep findings empty.",
    "Review only the supplied artifact and deterministic review. Do not claim that omitted source material contains facts, formulas, or examples that are not present in this review input.",
    "The structured review view includes a source index that maps opaque sourceIds to titles and Moodle URLs. Treat those mappings as valid citations; do not require the human-facing chapter text itself to repeat the full URL.",
    "Formula strings in structured study data use Typst math syntax, not TeX. Typst functions such as frac and dot intentionally have no leading backslash; do not flag that syntax as malformed TeX.",
    "Worked examples with origin='derived' are explicitly didactic examples. They are allowed when their method and result are reproducible from the cited source-backed rules or formulas; do not reject them merely because their numeric values were newly chosen.",
    "The study_guide profile intentionally keeps practiceItems empty; its application layer is workedExamples embedded in each chapter. Do not report an empty detached practice bank as a defect when chapter examples are complete.",
    "For a study guide, reject chapter-sized content that functions only as a short overview. A learner needs explanations, relationships, conditions and the form of application appropriate to the discipline—not just one paragraph and a few bullets.",
    "A publicationStatus or chapter status of 'partial' is not by itself a blocking defect. A guide may publish with a clearly named, narrowly scoped source gap when the supplied evidence does not support that subtopic. Never demand invented material merely to turn partial coverage into complete coverage.",
    "Respect each chapter's contentMode. Quantitative chapters need a reproducible calculation or derivation; case_based chapters need a traceable case analysis and justified decision; procedural chapters need an executable sequence with decision/error points; mixed chapters need an appropriate combination. Purely conceptual chapters may instead demonstrate depth through explanations, distinctions, evidence interpretation, argument structure, or an illustrative comparison and must not be forced into a fake calculation or case.",
    "Do not require one example to cover every formula, case type, argument, or method in the chapter.",
    "An example is blocking only when it presents itself as reproducible but omits necessary givens, substitutions, units, or reasoning, or when its result contradicts its shown method. A clearly scoped limitation is acceptable.",
    "When the supplied evidence or deterministic review identifies a mandatory table/diagram lookup, reject an example that merely copies the looked-up values from a solution. The learner must see the lookup asset and the row/column or interval-selection method before subsequent calculations.",
    "A compact didactic lookup-table excerpt is a valid lookup asset when it is visibly labeled as an excerpt rather than a complete norm table, shows the exact interval/field selections and values needed by the example, and traces those values to the supplied course evidence. Do not demand a full copyrighted norm table in addition. A decorative diagram or an unstructured list of finished values does not satisfy this exception.",
    "A missing optional formula, subtopic, or additional worked example is not a defect unless the user explicitly required it and the supplied artifact itself demonstrates that suitable source-backed material was available.",
    "Set ok=false only for a concrete factual contradiction, mathematical inconsistency, unusably shallow covered chapter, missing representative chapter example, invalid citation, or an example that cannot be followed from its stated givens. Put non-blocking coverage observations in summary, not findings.",
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
  return {
    profile: model.profile,
    title: model.title,
    courseTitle: model.courseTitle,
    publicationStatus: model.publicationStatus,
    scopeNote: model.scopeNote,
    chapters: model.courseChapters.map((chapter) => {
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
      ).slice(0, 3);
      const examples = prioritizeLookup(
        model.workedExamples.filter((example) => example.chapterId === chapter.id),
        (example) => `${example.learningGoal} ${example.prompt} ${example.steps.join(" ")}`,
      ).slice(0, 2);
      const figures = prioritizeLookup(
        model.figures.filter((figure) => figure.chapterId === chapter.id),
        (figure) => `${figure.title} ${figure.caption}`,
      ).slice(0, 2);
      return {
        id: chapter.id,
        title: chapter.title,
        status: chapter.status,
        priority: chapter.priority,
        contentMode: chapter.contentMode,
        learningObjectives: chapter.learningObjectives,
        assessmentSignals: chapter.assessmentSignals,
        topics: topics.map((topic) => ({
          title: topic.title,
          summary: topic.summary,
          learningGoals: topic.learningGoals,
          sourceIds: topic.sourceIds,
        })),
        formulas: model.formulas
          .filter((formula) => formula.chapterId === chapter.id)
          .slice(0, 4)
          .map((formula) => ({
            name: formula.name,
            expression: formula.expression,
            variables: formula.variables,
            units: formula.units,
            assumptions: formula.assumptions.slice(0, 300),
          })),
        workedExamples: examples.map((example) => ({
          origin: example.origin,
          learningGoal: example.learningGoal,
            prompt: example.prompt.slice(0, 500),
            steps: example.steps.slice(0, 8).map((step) => step.slice(0, 350)),
            result: example.result.slice(0, 500),
          sourceIds: example.sourceIds,
        })),
        figures: figures.map((figure) => ({
          kind: figure.kind,
          title: figure.title,
          caption: figure.caption.slice(0, 400),
          relativePath: figure.relativePath,
          sourcePage: figure.sourcePage,
        })),
      };
    }),
    checklist: model.checklist.slice(0, 12),
    sources: model.sources.slice(0, 80).map((source) => ({
      id: source.id,
      title: source.title,
      kind: source.kind,
      originUrl: source.originUrl,
    })),
    deterministicFindings: state.review_report.findings,
  };
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
