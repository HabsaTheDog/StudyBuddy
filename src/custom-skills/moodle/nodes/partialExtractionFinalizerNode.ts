import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  clearPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { validateExtractedData } from "../validation.js";
import { canonicalizeResourceUrl } from "../resourceAcquisition.js";

const WITHHOLD_AFFECTED_CONTENT = "withhold_affected_content";

interface TaggedRepairFinding {
  chapterTitle: string;
  requirementId: string | null;
  owner: string | null;
  repairTarget: string | null;
  fallback: string | null;
}

function finalizedChapterTitles(extractedData: unknown): Set<string> {
  const warnings = (extractedData as { warnings?: unknown })?.warnings;
  if (!Array.isArray(warnings)) return new Set();
  return new Set(warnings.flatMap((warning) => {
    if (typeof warning !== "string") return [];
    const match = warning.match(
      /^(?:Kapitel\s+(.+?)\s+ist nicht vollständig abgedeckt|Chapter\s+(.+?)\s+is not fully covered):/i,
    );
    const title = (match?.[1] ?? match?.[2])?.trim();
    return title ? [title.toLocaleLowerCase("de")] : [];
  }));
}

function errorChapterTitles(state: LangGraphAgentState): string[] {
  return [...new Set(taggedRepairFindings(state.error_log ?? "")
    .map((finding) => finding.chapterTitle))];
}

function taggedRepairFindings(error: string): TaggedRepairFinding[] {
  return error.split("\n").flatMap((line) => {
    const chapterTitle = tag(line, "chapter");
    if (!chapterTitle) return [];
    return [{
      chapterTitle,
      requirementId: tag(line, "requirement"),
      owner: tag(line, "owner"),
      repairTarget: tag(line, "repair"),
      fallback: tag(line, "fallback"),
    }];
  });
}

function tag(line: string, name: string): string | null {
  return new RegExp(`\\[${name}:\\s*([^\\]]+)\\]`, "i").exec(line)?.[1]?.trim() ?? null;
}

function hasDegradableRepairDisposition(state: LangGraphAgentState): boolean {
  const error = state.error_log ?? "";
  const findings = taggedRepairFindings(error);
  if (findings.length === 0) return false;
  const requirementById = new Map(
    state.request_contract.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const isLocalWithhold = (finding: TaggedRepairFinding) => {
    if (finding.owner !== "content" || finding.repairTarget !== "content_analyzer") return false;
    if (!finding.requirementId) return true;
    const requirement = requirementById.get(finding.requirementId);
    return Boolean(requirement && requirement.priority !== "must");
  };
  if (error.startsWith("Semantic quality review failed:")) {
    return findings.every(isLocalWithhold);
  }
  return findings.every((finding) =>
    isLocalWithhold(finding) && finding.fallback === WITHHOLD_AFFECTED_CONTENT
  );
}

export function canFinalizePartialExtraction(state: LangGraphAgentState): boolean {
  const finalized = finalizedChapterTitles(state.extracted_data);
  const targets = errorChapterTitles(state);
  const hasUnfinalizedTarget = targets.length > 0
    ? targets.some((title) => !finalized.has(title.toLocaleLowerCase("de")))
    : finalized.size === 0;
  return Boolean(
    state.error_log &&
    Object.keys(state.extracted_data).length > 0 &&
    hasUnfinalizedTarget &&
    hasDegradableRepairDisposition(state)
  );
}

export function createPartialExtractionFinalizerNode(config: MoodleRuntimeConfig) {
  return async function partialExtractionFinalizerNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    if (!canFinalizePartialExtraction(state)) return {};
    const pending = await readPendingExtractionRepairs(config.runDir);
    const finalized = finalizedChapterTitles(state.extracted_data);
    const titles = [...new Set([
      ...(pending?.pendingChapterTitles ?? []),
      ...errorChapterTitles(state),
    ])].filter((title) => !finalized.has(title.toLocaleLowerCase("de")));
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
    const normalizedTitles = new Set(titles.map((title) => title.toLocaleLowerCase("de")));
    const architectureModules = state.source_architect_decision.learningArchitecture?.modules
      .filter((module) => normalizedTitles.has(module.title.toLocaleLowerCase("de"))) ?? [];
    const architectureResourceUrls = new Set(architectureModules
      .flatMap((module) => module.resourceUrls)
      .map(canonicalizeResourceUrl));
    const architectureResources = state.resource_manifest.resources.filter((resource) =>
      architectureResourceUrls.has(canonicalizeResourceUrl(resource.originUrl))
    );
    const affectedResourceIds = new Set([
      ...state.study_model.courseChapters
      .filter((chapter) => titles.includes(chapter.title))
      .flatMap((chapter) => chapter.resourceIds),
      ...architectureResources.map((resource) => resource.id),
    ]);
    const belongsToAffectedChapter = (item: { source_ids: string[] }) =>
      item.source_ids.some((sourceId) => affectedResourceIds.has(sourceId));
    // A reviewer can discover invalid mathematics only after the final local
    // repair. Keep the evidence-grounded chapter explanation and hierarchy,
    // but never carry formulas, examples, or questions from that rejected
    // replacement into a transparent partial publication.
    const removed = {
      sections: extracted.sections.filter(belongsToAffectedChapter),
      formulas: extracted.formulas.filter(belongsToAffectedChapter),
      workedExamples: extracted.worked_examples.filter(belongsToAffectedChapter),
      questions: extracted.quiz_style_questions.filter(belongsToAffectedChapter),
      figures: extracted.figures.filter(belongsToAffectedChapter),
      learningModules: extracted.learning_modules.filter((item) =>
        item.resource_ids.some((sourceId) => affectedResourceIds.has(sourceId))
      ),
      visualAssets: extracted.visual_assets.filter((item) =>
        Boolean(item.source_id && affectedResourceIds.has(item.source_id))
      ),
    };
    const warnings = titles.map((title) => english
      ? `Chapter ${title} is not fully covered: the bounded local content repair did not produce publishable detail. The chapter remains visible with its course-backed objectives; unvalidated formulas, examples, questions, and visuals were withheld.`
      : `Kapitel ${title} ist nicht vollständig abgedeckt: Die begrenzte lokale Inhaltsreparatur ergab keine veröffentlichungsfähigen Details. Das Kapitel bleibt mit seinen kursbelegten Lernzielen sichtbar; unvalidierte Formeln, Beispiele, Fragen und Visuals wurden zurückgehalten.`
    );
    const existingSourceIds = new Set(extracted.sources.map((source) => source.id));
    const placeholderSources = architectureResources
      .filter((resource) => !existingSourceIds.has(resource.id))
      .map((resource) => ({
        id: resource.id,
        title: resource.title,
        kind: (resource.localPath?.toLocaleLowerCase("en").endsWith(".pdf") ||
            canonicalizeResourceUrl(resource.originUrl).toLocaleLowerCase("en").endsWith(".pdf"))
          ? "pdf" as const
          : "file" as const,
        url: resource.originUrl,
        path: resource.localPath,
        page: null,
      }));
    const placeholders = titles.map((title) => {
      const architecture = architectureModules.find((module) =>
        module.title.toLocaleLowerCase("de") === title.toLocaleLowerCase("de")
      );
      const resourceIds = architecture
        ? architectureResources
            .filter((resource) => architecture.resourceUrls
              .map(canonicalizeResourceUrl)
              .includes(canonicalizeResourceUrl(resource.originUrl)))
            .map((resource) => resource.id)
        : [...affectedResourceIds];
      return {
        section: {
          heading: title,
          summary: english
            ? "This course chapter belongs to the requested scope, but the available evidence did not support a sufficiently validated detailed explanation after the bounded repair. Use the listed learning objectives as a transparent review checklist; no unsupported derivation or example is asserted here."
            : "Dieses Kurskapitel gehört zum angefragten Stoff, die verfügbare Evidenz trug nach der begrenzten Reparatur jedoch keine ausreichend validierte Detailerklärung. Nutze die aufgeführten Lernziele als transparente Wiederholungs-Checkliste; eine unbelegte Herleitung oder Beispielrechnung wird hier nicht behauptet.",
          key_concepts: architecture?.learningObjectives ?? [],
          source_ids: resourceIds,
        },
        module: {
          id: architecture?.id ?? `partial-${title.toLocaleLowerCase("de").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
          title,
          priority: architecture?.priority ?? "essential" as const,
          content_mode: architecture?.contentMode ?? "mixed" as const,
          learning_objectives: architecture?.learningObjectives ?? [],
          assessment_signals: architecture?.assessmentSignals ?? [],
          resource_ids: resourceIds,
        },
      };
    });
    const extractedData = validateExtractedData({
      ...extracted,
      sources: [...extracted.sources, ...placeholderSources],
      sections: [
        ...extracted.sections.filter((item) => !belongsToAffectedChapter(item)),
        ...placeholders.map(({ section }) => section),
      ],
      formulas: extracted.formulas.filter((item) => !belongsToAffectedChapter(item)),
      worked_examples: extracted.worked_examples.filter((item) => !belongsToAffectedChapter(item)),
      quiz_style_questions: extracted.quiz_style_questions.filter(
        (item) => !belongsToAffectedChapter(item),
      ),
      figures: extracted.figures.filter((item) => !belongsToAffectedChapter(item)),
      learning_modules: [
        ...extracted.learning_modules.filter((item) =>
          !item.resource_ids.some((sourceId) => affectedResourceIds.has(sourceId))
        ),
        ...placeholders.map(({ module }) => module),
      ],
      visual_assets: extracted.visual_assets.filter((item) =>
        !(item.source_id && affectedResourceIds.has(item.source_id))
      ),
      warnings: [...new Set([...extracted.warnings, ...warnings])],
    });
    const auditPath = path.join(config.runDir, "partial-finalization.json");
    let priorAudit: {
      chapters?: string[];
      warnings?: string[];
      removedRejectedContent?: Record<string, string[]>;
    } = {};
    try {
      priorAudit = JSON.parse(await readFile(auditPath, "utf8")) as typeof priorAudit;
    } catch {
      // The first localized fallback has no prior audit to merge.
    }
    const removedRejectedContent = {
      sectionHeadings: removed.sections.map((item) => item.heading),
      formulaNames: removed.formulas.map((item) => item.name),
      workedExampleGoals: removed.workedExamples.map((item) => item.learning_goal),
      questionPrompts: removed.questions.map((item) => item.question),
      figureAssetIds: removed.figures.map((item) => item.asset_id),
      learningModuleTitles: removed.learningModules.map((item) => item.title),
      visualAssetIds: removed.visualAssets.map((item) => item.id),
    };
    const mergedRemoved = Object.fromEntries(Object.entries(removedRejectedContent).map(
      ([key, values]) => [key, [...new Set([
        ...(priorAudit.removedRejectedContent?.[key] ?? []),
        ...values,
      ])]],
    ));
    await writeFile(
      auditPath,
      `${JSON.stringify({
        status: "partial",
        reason: "localized-content-repair-exhausted",
        chapters: [...new Set([...(priorAudit.chapters ?? []), ...titles])],
        priorError: state.error_log,
        warnings: [...new Set([...(priorAudit.warnings ?? []), ...warnings])],
        removedRejectedContent: mergedRemoved,
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
