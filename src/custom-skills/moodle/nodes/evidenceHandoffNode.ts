import type { MoodleRuntimeConfig } from "../types.js";
import type { LangGraphAgentState, JsonObject } from "../state.js";
import { validateExtractedData } from "../validation.js";
import { classifyResourceTopic } from "../resourcePlanning.js";

interface ModuleBucket {
  id: string;
  title: string;
  resourceIds: string[];
}

/**
 * Builds the minimal, fully grounded Extraction contract needed by the
 * interactive Study Guide renderer. The downstream web stage owns teaching
 * synthesis, exercises, and quality review, so repeating those model calls in
 * Moodle Extraction would only add latency and failure surface.
 */
export function createEvidenceHandoffNode(config: MoodleRuntimeConfig) {
  return async function evidenceHandoffNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const extracted = buildEvidenceHandoff(config, state);
    await config.diagnostics?.log(
      "info",
      "analyzer",
      `Built deterministic interactive evidence handoff with ${extracted.sources.length} source(s), ${extracted.sections.length} section(s), and ${state.evidence_package.records.length} evidence record(s).`,
    );
    return {
      extracted_data: extracted as unknown as JsonObject,
      error_log: null,
    };
  };
}

export function buildEvidenceHandoff(
  config: MoodleRuntimeConfig,
  state: Pick<LangGraphAgentState, "resource_manifest" | "evidence_package">,
) {
  const records = state.evidence_package.records;
  const evidencedIds = new Set(records.map((record) => record.resourceId));
  const resources = state.resource_manifest.resources.filter((resource) =>
    evidencedIds.has(resource.id) ||
    resource.extraction?.status === "usable" ||
    Boolean(resource.localPath),
  );
  const sources = resources.map((resource) => ({
    id: resource.id,
    title: resource.title,
    kind: sourceKind(resource.activityType, resource.contentType, resource.localPath),
    url: safeHttpUrl(resource.resolvedUrl ?? resource.canonicalUrl ?? resource.originUrl),
    path: resource.localPath,
    page: null,
  }));
  const sourceIds = new Set(sources.map((source) => source.id));
  const buckets = new Map<string, ModuleBucket>();
  const moduleResources = resources.filter((resource) => resource.selection?.selected === true);
  for (const resource of moduleResources) {
    const title = moduleTitle(resource);
    const key = moduleKey(title) || "course-overview";
    const bucket = buckets.get(key) ?? { id: key, title, resourceIds: [] };
    if (!bucket.resourceIds.includes(resource.id)) bucket.resourceIds.push(resource.id);
    buckets.set(key, bucket);
  }
  if (buckets.size === 0) {
    buckets.set("course-overview", {
      id: "course-overview",
      title: config.outputLanguage === "de" ? "Kursüberblick" : "Course overview",
      resourceIds: [...evidencedIds].filter((id) => sourceIds.has(id)),
    });
  }
  const modules = [...buckets.values()]
    .filter((bucket) => bucket.resourceIds.length > 0)
    .slice(0, 10);
  const sections = modules.map((module) => {
    const moduleRecords = records.filter((record) => module.resourceIds.includes(record.resourceId));
    const summary = unique(moduleRecords.map((record) => record.content.trim()).filter(Boolean))
      .join("\n\n")
      .slice(0, 7_000)
      .trim();
    return {
      heading: module.title,
      summary: summary || (config.outputLanguage === "de"
        ? `Quellengrundlage für ${module.title}.`
        : `Source evidence for ${module.title}.`),
      key_concepts: unique([
        ...resources.filter((resource) => module.resourceIds.includes(resource.id)).map((resource) => resource.title),
        ...moduleRecords.filter((record) => record.kind === "definition" || record.kind === "formula").map((record) => firstSentence(record.content)),
      ]).filter(Boolean).slice(0, 10),
      source_ids: module.resourceIds,
    };
  });
  const learningModules = modules.map((module, index) => {
    const moduleRecords = records.filter((record) => module.resourceIds.includes(record.resourceId));
    const quantitative = moduleRecords.some((record) => record.kind === "formula" || record.kind === "exercise" || record.kind === "solution");
    return {
      id: module.id,
      title: module.title,
      priority: index < 6 ? "essential" as const : "important" as const,
      content_mode: quantitative ? "quantitative" as const : "mixed" as const,
      learning_objectives: [config.outputLanguage === "de"
        ? `${module.title} anhand der belegten Kursunterlagen erklären und anwenden.`
        : `Explain and apply ${module.title} using the cited course evidence.`],
      assessment_signals: [config.outputLanguage === "de"
        ? `Repräsentative Aufgaben zu ${module.title} mit nachvollziehbarem Lösungsweg bearbeiten.`
        : `Solve representative ${module.title} tasks with a traceable method.`],
      resource_ids: module.resourceIds,
    };
  });
  const courseTitle = inferCourseTitle(records.map((record) => record.content), config.prompt);

  return validateExtractedData({
    document_title: config.outputLanguage === "de"
      ? `${courseTitle} – Interaktiver Study Guide`
      : `${courseTitle} – Interactive Study Guide`,
    language: config.outputLanguage,
    course: {
      title: courseTitle,
      url: state.resource_manifest.courseUrl ?? config.moodleUrl,
    },
    sources,
    sections,
    formulas: [],
    worked_examples: [],
    quiz_style_questions: [],
    visual_assets: [],
    figures: [],
    learning_modules: learningModules,
    warnings: [config.outputLanguage === "de"
      ? "Evidence-first-Handoff: Didaktische Synthese und Aufgaben werden einmalig im validierten Web-Layout erzeugt."
      : "Evidence-first handoff: teaching synthesis and exercises are generated once in the validated web-layout stage."],
  });
}

function moduleTitle(resource: LangGraphAgentState["resource_manifest"]["resources"][number]): string {
  if (resource.selection?.role === "sample_exam") return "Prüfungstraining";
  if (resource.selection?.topic) return cleanModuleTitle(resource.selection.topic);
  const classified = classifyResourceTopic({
    href: resource.resolvedUrl ?? resource.originUrl,
    label: resource.title,
    sectionTitle: resource.sectionPath.at(-1),
  });
  if (classified) return cleanModuleTitle(classified);
  const section = resource.sectionPath.filter((part) => part.trim()).at(-1);
  return cleanModuleTitle(section || resource.title);
}

function cleanModuleTitle(value: string): string {
  return value
    .replace(/^\s*\d+\.\s*(?:Präsenz(?:phase)?|Einheit|Termin)\s*[-–—:]?\s*/iu, "")
    .replace(/^\s*\d+\.\s*/u, "")
    .replace(/\bKlebeverbindungen\b/giu, "Klebverbindungen")
    .replace(/\s+/g, " ")
    .trim();
}

function moduleKey(value: string): string {
  return slug(cleanModuleTitle(value));
}

function sourceKind(activityType: string, contentType: string | null | undefined, localPath: string | null) {
  if (contentType === "application/pdf" || /\.pdf$/i.test(localPath ?? "")) return "pdf" as const;
  if (/assignment/i.test(activityType)) return "assignment" as const;
  if (/page|label|url|link/i.test(activityType)) return "moodle_page" as const;
  return "file" as const;
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function inferCourseTitle(contents: string[], fallback: string): string {
  for (const content of contents) {
    const match = content.match(/Selected:\s*(.+?)(?:\s+Lektor|\s+Ihre Rolle|$)/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return fallback.replace(/\b(?:can you|please|create|make|erstelle|einen?|interactive|interaktiven?|study guide|for my|für|course)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || "Study Buddy Course";
}

function firstSentence(value: string): string {
  return value.trim().split(/(?<=[.!?])\s+/)[0]?.slice(0, 240) ?? "";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}
