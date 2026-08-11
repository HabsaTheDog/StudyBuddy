import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ModelCallTimeoutError,
  resolveModelPromptBodyCharacterBudget,
  type CodexClient,
} from "../codexClient.js";
import {
  clearPendingExtractionRepairs,
  persistPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray } from "../validation.js";

export const qualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "summary", "findings"],
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "message",
          "chapterTitle",
          "requirementId",
          "deliverableId",
          "owner",
          "severity",
          "repairTarget",
        ],
        properties: {
          message: { type: "string" },
          chapterTitle: { type: ["string", "null"] },
          requirementId: { type: ["string", "null"] },
          deliverableId: { type: ["string", "null"] },
          owner: {
            type: "string",
            enum: ["source", "content", "interaction", "visual", "technical"],
          },
          severity: { type: "string", enum: ["blocking", "advisory"] },
          repairTarget: {
            type: "string",
            enum: ["source_architect", "content_analyzer", "visual_pipeline", "formatter", "none"],
          },
        },
      },
      maxItems: 12,
    },
  },
} as const;

interface QualityFinding {
  message: string;
  chapterTitle: string | null;
  requirementId: string | null;
  deliverableId: string | null;
  owner: "source" | "content" | "interaction" | "visual" | "technical";
  severity: "blocking" | "advisory";
  repairTarget: "source_architect" | "content_analyzer" | "visual_pipeline" | "formatter" | "none";
}

const QUALITY_REVIEW_PROMPT_MARGIN = 512;

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
      if (localized.blocking.length === 0) {
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
      const message = `Semantic quality review failed:\n- ${localized.blocking
        .map(formatFindingForRepair)
        .join("\n- ")}`;
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
  const promptBudget = Math.max(
    8_000,
    resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) -
      QUALITY_REVIEW_PROMPT_MARGIN,
  );
  const compose = (mode: "standard" | "bounded" | "minimal") => {
    // This node validates the extraction handoff, not a renderer preview. A
    // prefix slice of final_document can silently omit trailing chapters and
    // make the reviewer report them as missing even though the complete study
    // model passed deterministic validation.
    const artifact = `Structured study model review view:\n${JSON.stringify(
      mode === "minimal"
        ? minimalStudyModelForReview(state)
        : compactStudyModelForReview(state, mode === "bounded"),
    )}`;
    return [
    "Review this Study Buddy artifact against the exact original request and evaluated request contract, then for factual grounding, disciplinary and internal consistency, pedagogical usefulness, and alignment with the requested output.",
    "Return JSON only and do not rewrite, invoke tools, open files, or infer facts from omitted source material.",
    "This is an extraction-handoff review. Deterministic gates check schema, citations, formula metadata and file integrity; do not reject renderer-owned layout, navigation, schedules, or presentation.",
    "Set ok=false only for a localized violated explicit must requirement, explicit prohibition, factual contradiction, invalid citation, broken mathematics/units, or an included example whose shown givens and steps cannot produce its result. Missing evidence-derived should recommendations are advisory.",
    "Do not infer required examples, calculations, applications, figures, questions, section counts, or chapter length from a subject label or generic study-guide convention. Evaluate only what the contract and evidence establish.",
    "Derived examples with declared values are valid when the cited rule is source-backed. A lookup-dependent example is invalid if it merely copies table/diagram values without showing the visible asset and selection method.",
    "Narrow documented source gaps and publicationStatus='partial' are acceptable. Do not demand optional breadth, a detached practice bank, invented material, one example per formula, or one worked example per official Moodle topic.",
    previousReviewError
      ? "This is a repair verification. Check whether the previously reported blocking defects are resolved. Do not introduce stricter example-count rules or unrelated new breadth requirements; add a new blocker only for a concrete contradiction, invalid mathematics/citation, or unusable method visible in the repaired handoff."
      : "",
    previousReviewError
      ? `Previous blocking review:\n${previousReviewError}`
      : "",
    "Formula strings use Typst, not TeX. Source-index mappings are valid citations.",
    "Return structured findings. Use exact IDs from the contract when a finding evaluates a requirement or deliverable; otherwise use null. chapterTitle must be an exact allowed title or null. severity=blocking is reserved for an explicit must/prohibition or a concrete factual, citation, or mathematical defect. Evidence-derived should recommendations and renderer-owned presentation observations are advisory.",
    "Choose the narrowest repairTarget: source_architect only for missing/unavailable evidence, content_analyzer for source-backed semantic content, visual_pipeline for visual evidence selection, formatter for renderer-owned presentation, and none when no automated repair is appropriate.",
    `Exact original user request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract, null, 2)}`,
    `Allowed exact chapter titles:\n${JSON.stringify(state.study_model.courseChapters.map((chapter) => chapter.title))}`,
    `Deterministic review:\n${JSON.stringify(state.review_report)}`,
    artifact,
    ].join("\n\n");
  };
  const standardPrompt = compose("standard");
  if (standardPrompt.length <= promptBudget) return standardPrompt;
  const boundedPrompt = compose("bounded");
  return boundedPrompt.length <= promptBudget ? boundedPrompt : compose("minimal");
}

function localizeQualityFindings(
  findings: QualityFinding[],
  state: LangGraphAgentState,
): { blocking: QualityFinding[]; advisory: QualityFinding[] } {
  const chapters = state.study_model.courseChapters.map((chapter, index) => ({
    title: chapter.title,
    index: index + 1,
    normalizedTitle: normalizeReviewText(chapter.title),
    terms: reviewTerms(chapter.title),
  }));
  const requirementById = new Map(
    state.request_contract.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const deliverableIds = new Set(state.request_contract.deliverables.map((deliverable) => deliverable.id));
  const blocking: QualityFinding[] = [];
  const advisory: QualityFinding[] = [];

  for (const finding of findings) {
    const explicit = finding.chapterTitle?.trim() ??
      /\[chapter:\s*([^\]]+)\]/i.exec(finding.message)?.[1]?.trim();
    let matched = explicit
      ? chapters.filter((chapter) => chapter.normalizedTitle === normalizeReviewText(explicit))
      : [];
    if (matched.length === 0) {
      const numbered = /\b(?:kapitel|chapter)\s+(\d{1,2})\b/i.exec(finding.message)?.[1];
      if (numbered) {
        matched = chapters.filter((chapter) => chapter.index === Number(numbered));
      }
    }
    if (matched.length === 0) {
      const normalizedFinding = normalizeReviewText(finding.message);
      matched = chapters.filter((chapter) =>
        normalizedFinding.includes(chapter.normalizedTitle) ||
        chapter.terms.some((term) => normalizedFinding.includes(term))
      );
    }
    const requirement = finding.requirementId
      ? requirementById.get(finding.requirementId)
      : undefined;
    const normalizedFinding: QualityFinding = {
      ...finding,
      message: finding.message.replace(/\[chapter:\s*[^\]]+\]\s*/i, "").trim(),
      chapterTitle: matched.length === 1 ? matched[0].title : null,
      requirementId: requirement ? finding.requirementId : null,
      deliverableId: finding.deliverableId && deliverableIds.has(finding.deliverableId)
        ? finding.deliverableId
        : null,
      severity: requirement?.priority === "should" ? "advisory" : finding.severity,
    };
    if (normalizedFinding.severity === "blocking") blocking.push(normalizedFinding);
    else advisory.push(normalizedFinding);
  }
  return {
    blocking: uniqueQualityFindings(blocking),
    advisory: uniqueQualityFindings(advisory),
  };
}

function formatFindingForRepair(finding: QualityFinding): string {
  return [
    finding.chapterTitle ? `[chapter: ${finding.chapterTitle}]` : "",
    finding.requirementId ? `[requirement: ${finding.requirementId}]` : "",
    finding.deliverableId ? `[deliverable: ${finding.deliverableId}]` : "",
    `[owner: ${finding.owner}]`,
    `[repair: ${finding.repairTarget}]`,
    finding.message,
  ].filter(Boolean).join(" ");
}

function uniqueQualityFindings(findings: QualityFinding[]): QualityFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function compactStudyModelForReview(state: LangGraphAgentState, bounded = false) {
  const model = state.study_model;
  const limits = bounded
    ? {
      objectiveCount: 10,
      objectiveLength: 120,
      assessmentCount: 5,
      assessmentLength: 100,
      topicSummary: 260,
      topicGoalCount: 2,
      topicGoalLength: 120,
      formulaCount: 2,
      formulaText: 180,
      formulaListCount: 5,
      formulaListText: 90,
      assumptionText: 120,
      exampleCount: 1,
      examplePrompt: 280,
      exampleStepCount: 5,
      exampleStep: 240,
      exampleResult: 280,
      figureCaption: 180,
      checklistCount: 6,
      checklistText: 160,
      sourceCount: 36,
      sourceText: 160,
      findingCount: 16,
      findingText: 220,
    }
    : {
      objectiveCount: 14,
      objectiveLength: 150,
      assessmentCount: 8,
      assessmentLength: 140,
      topicSummary: 520,
      topicGoalCount: 4,
      topicGoalLength: 180,
      formulaCount: 3,
      formulaText: 320,
      formulaListCount: 10,
      formulaListText: 160,
      assumptionText: 220,
      exampleCount: 2,
      examplePrompt: 400,
      exampleStepCount: 6,
      exampleStep: 480,
      exampleResult: 400,
      figureCaption: 280,
      checklistCount: 8,
      checklistText: 260,
      sourceCount: 50,
      sourceText: 260,
      findingCount: 40,
      findingText: 400,
    };
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
      const contractTerms = reviewTerms(state.request_contract.requirements
        .filter((requirement) => requirement.appliesTo.length > 0)
        .map((requirement) => requirement.statement)
        .join(" "));
      const chapterTerms = reviewTerms([
        chapter.title,
        ...chapter.learningObjectives,
        ...chapter.assessmentSignals,
      ].join(" "));
      const priorityScore = (value: string) => {
        const normalized = normalizeReviewText(value);
        return contractTerms.filter((term) => normalized.includes(term)).length * 10 +
          chapterTerms.filter((term) => normalized.includes(term)).length;
      };
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
      ).slice(0, limits.exampleCount);
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
        learningObjectives: compactReviewObjectives(
          chapter.learningObjectives,
          limits.objectiveCount,
          limits.objectiveLength,
        ),
        assessmentSignals: chapter.assessmentSignals
          .slice(0, limits.assessmentCount)
          .map((signal) => compactReviewText(signal, limits.assessmentLength)),
        topics: topics.map((topic) => ({
          title: compactReviewText(topic.title, 180),
          summary: compactReviewText(topic.summary, limits.topicSummary),
          learningGoals: topic.learningGoals
            .slice(0, limits.topicGoalCount)
            .map((goal) => compactReviewText(goal, limits.topicGoalLength)),
          sourceIds: topic.sourceIds,
        })),
        formulas: model.formulas
          .filter((formula) => formula.chapterId === chapter.id)
          .slice(0, limits.formulaCount)
          .map((formula) => ({
            name: compactReviewText(formula.name, 140),
            expression: compactReviewText(formula.expression, limits.formulaText),
            variables: formula.variables
              .slice(0, limits.formulaListCount)
              .map((value) => compactReviewText(value, limits.formulaListText)),
            units: formula.units
              .slice(0, limits.formulaListCount)
              .map((value) => compactReviewText(value, limits.formulaListText)),
            assumptions: compactReviewText(formula.assumptions, limits.assumptionText),
          })),
        workedExamples: examples.map((example) => ({
          origin: example.origin,
          learningGoal: compactReviewText(example.learningGoal, 160),
          prompt: compactReviewText(example.prompt, limits.examplePrompt),
          steps: example.steps
            .slice(0, limits.exampleStepCount)
            .map((step) => compactReviewText(step, limits.exampleStep)),
          result: compactReviewText(example.result, limits.exampleResult),
          sourceIds: example.sourceIds,
        })),
        figures: figures.map((figure) => ({
          kind: figure.kind,
          title: compactReviewText(figure.title, 160),
          caption: compactReviewText(figure.caption, limits.figureCaption),
          sourcePage: figure.sourcePage,
        })),
      };
    }),
    checklist: model.checklist
      .slice(0, limits.checklistCount)
      .map((item) => compactReviewText(item, limits.checklistText)),
    sources: model.sources
      .filter((source) => referencedSourceIds.has(source.id))
      .slice(0, limits.sourceCount)
      .map((source) => ({
        id: source.id,
        title: compactReviewText(source.title, limits.sourceText),
        kind: source.kind,
        originUrl: source.originUrl
          ? compactReviewText(source.originUrl, limits.sourceText)
          : null,
      })),
    deterministicFindings: state.review_report.findings
      .slice(0, limits.findingCount)
      .map((finding) => ({
        ...finding,
        message: compactReviewText(finding.message, limits.findingText),
      })),
  };
}

function minimalStudyModelForReview(state: LangGraphAgentState) {
  const model = state.study_model;
  const referencedSourceIds = new Set<string>();
  const chapters = model.courseChapters.map((chapter) => {
    const officialTopicCount = new Set(chapter.learningObjectives.flatMap((objective) =>
      [...objective.matchAll(/(?:Thema|Topic)\s+(\d{1,2})\b/gi)]
        .map((match) => Number(match[1]))
    )).size;
    const topics = model.topics
      .filter((topic) => topic.chapterId === chapter.id)
      .slice(0, Math.max(2, officialTopicCount));
    const formulas = model.formulas
      .filter((formula) => formula.chapterId === chapter.id)
      .slice(0, 1);
    const examples = model.workedExamples
      .filter((example) => example.chapterId === chapter.id)
      .slice(0, 1);
    for (const sourceId of [
      ...topics.flatMap((topic) => topic.sourceIds),
      ...formulas.flatMap((formula) => formula.sourceIds),
      ...examples.flatMap((example) => example.sourceIds),
    ]) referencedSourceIds.add(sourceId);
    return {
      title: chapter.title,
      status: chapter.status,
      priority: chapter.priority,
      contentMode: chapter.contentMode,
      learningObjectives: compactReviewObjectives(chapter.learningObjectives, 10, 80),
      assessmentSignals: chapter.assessmentSignals
        .slice(0, 3)
        .map((signal) => compactReviewText(signal, 80)),
      topics: topics.map((topic) => ({
        title: compactReviewText(topic.title, 100),
        summary: compactReviewText(topic.summary, 120),
        sourceIds: topic.sourceIds,
      })),
      formulas: formulas.map((formula) => ({
        name: compactReviewText(formula.name, 90),
        expression: compactReviewText(formula.expression, 120),
        units: formula.units.slice(0, 4).map((unit) => compactReviewText(unit, 60)),
        sourceIds: formula.sourceIds,
      })),
      workedExamples: examples.map((example) => ({
        origin: example.origin,
        learningGoal: compactReviewText(example.learningGoal, 100),
        prompt: compactReviewText(example.prompt, 120),
        steps: example.steps.slice(0, 4).map((step) => compactReviewText(step, 120)),
        result: compactReviewText(example.result, 120),
        sourceIds: example.sourceIds,
      })),
    };
  });
  return {
    profile: model.profile,
    title: model.title,
    courseTitle: model.courseTitle,
    publicationStatus: model.publicationStatus,
    scopeNote: compactReviewText(model.scopeNote, 240),
    chapters,
    sources: model.sources
      .filter((source) => referencedSourceIds.has(source.id))
      .slice(0, 32)
      .map((source) => ({
        id: source.id,
        title: compactReviewText(source.title, 100),
        kind: source.kind,
      })),
    deterministicFindings: state.review_report.findings.slice(0, 12).map((finding) => ({
      ...finding,
      message: compactReviewText(finding.message, 140),
    })),
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

function compactReviewObjectives(
  objectives: string[],
  maxItems = 14,
  maxLength = 150,
): string[] {
  return [...new Set(objectives
    .filter((objective) => !/\.{5,}/.test(objective))
    .map((objective) => {
      const official = /^((?:Thema|Topic)\s+\d{1,2}\s*[–-]\s*[^:·]+)(?::|\s+·\s+)?\s*(.*)$/i
        .exec(objective);
      if (!official) return compactReviewText(objective, maxLength);
      const detail = official[2].trim();
      return detail
        ? compactReviewText(`${official[1].trim()} · ${detail}`, maxLength)
        : official[1].trim();
    }))].slice(0, maxItems);
}

function validateQualityReview(value: unknown): {
  ok: boolean;
  summary: string;
  findings: QualityFinding[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality reviewer returned a non-object response.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.summary !== "string") {
    throw new Error("Quality reviewer response is missing ok or summary.");
  }
  if (!Array.isArray(record.findings)) throw new Error("Quality reviewer findings must be an array.");
  const findings = record.findings.map(validateQualityFinding);
  return {
    ok: record.ok,
    summary: record.summary,
    findings: findings.slice(0, 12),
  };
}

function validateQualityFinding(value: unknown): QualityFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality reviewer finding must be an object.");
  }
  const record = value as Record<string, unknown>;
  const nullableString = (field: string): string | null => {
    const fieldValue = record[field];
    if (fieldValue === null) return null;
    if (typeof fieldValue !== "string") {
      throw new Error(`Quality reviewer finding ${field} must be a string or null.`);
    }
    return fieldValue;
  };
  if (typeof record.message !== "string" || !record.message.trim()) {
    throw new Error("Quality reviewer finding message must be a non-empty string.");
  }
  const owners = ["source", "content", "interaction", "visual", "technical"] as const;
  const severities = ["blocking", "advisory"] as const;
  const repairTargets = ["source_architect", "content_analyzer", "visual_pipeline", "formatter", "none"] as const;
  if (!owners.includes(record.owner as typeof owners[number])) {
    throw new Error("Quality reviewer finding owner is invalid.");
  }
  if (!severities.includes(record.severity as typeof severities[number])) {
    throw new Error("Quality reviewer finding severity is invalid.");
  }
  if (!repairTargets.includes(record.repairTarget as typeof repairTargets[number])) {
    throw new Error("Quality reviewer finding repairTarget is invalid.");
  }
  return {
    message: record.message.trim(),
    chapterTitle: nullableString("chapterTitle"),
    requirementId: nullableString("requirementId"),
    deliverableId: nullableString("deliverableId"),
    owner: record.owner as QualityFinding["owner"],
    severity: record.severity as QualityFinding["severity"],
    repairTarget: record.repairTarget as QualityFinding["repairTarget"],
  };
}
