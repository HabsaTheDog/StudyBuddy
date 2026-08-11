import type { MoodleRuntimeConfig } from "../types.js";
import type { LangGraphAgentState, JsonObject } from "../state.js";
import { validateExtractedData } from "../validation.js";
import { classifyResourceTopic } from "../resourcePlanning.js";
import { extractResolvedCourseIdentity } from "../courseTargeting.js";

interface ModuleBucket {
  id: string;
  title: string;
  resourceIds: string[];
  summary?: string;
  conceptTitles?: string[];
  courseSourceId?: string;
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
  state: Pick<LangGraphAgentState, "moodle_raw_text" | "resource_manifest" | "evidence_package" | "request_contract">,
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
  const selectedTopicModules = deriveSelectedTopicModules(
    resources,
    state.moodle_raw_text,
  );
  const hierarchyModules = deriveCourseHierarchyModules(
    state.moodle_raw_text,
    state.resource_manifest.resources,
    sourceIds,
  );
  const moduleResources = resources.filter((resource) => resource.selection?.selected === true);
  if (selectedTopicModules.length >= 2) {
    for (const module of selectedTopicModules) buckets.set(module.id, module);
  } else if (hierarchyModules.length >= 2) {
    for (const module of hierarchyModules) buckets.set(module.id, module);
  } else {
    for (const resource of moduleResources) {
      const title = moduleTitle(resource);
      const key = moduleKey(title) || "course-overview";
      const bucket = buckets.get(key) ?? { id: key, title, resourceIds: [] };
      if (!bucket.resourceIds.includes(resource.id)) bucket.resourceIds.push(resource.id);
      buckets.set(key, bucket);
    }
  }
  if (buckets.size === 0) {
    buckets.set("course-overview", {
      id: "course-overview",
      title: config.outputLanguage === "de" ? "Kursüberblick" : "Course overview",
      resourceIds: [...evidencedIds].filter((id) => sourceIds.has(id)),
    });
  }
  const modules = [...buckets.values()]
    .filter((bucket) => bucket.resourceIds.length > 0);
  const sections = modules.map((module) => {
    const moduleRecords = records.filter((record) =>
      module.resourceIds.includes(record.resourceId) &&
      record.resourceId !== module.courseSourceId
    );
    const summary = unique([
      module.summary?.trim() ?? "",
      ...moduleRecords.map((record) => record.content.trim()).filter(Boolean),
    ])
      .join("\n\n")
      .slice(0, 7_000)
      .trim();
    return {
      heading: module.title,
      summary: summary || (config.outputLanguage === "de"
        ? `Quellengrundlage für ${module.title}.`
        : `Source evidence for ${module.title}.`),
      key_concepts: unique([
        ...(module.conceptTitles ?? []),
        ...resources.filter((resource) => module.resourceIds.includes(resource.id)).map((resource) => resource.title),
        ...moduleRecords.filter((record) => record.kind === "definition" || record.kind === "formula").map((record) => firstSentence(record.content)),
      ]).filter(Boolean).slice(0, 10),
      source_ids: module.resourceIds,
    };
  });
  const learningModules = modules.map((module) => {
    const moduleRecords = records.filter((record) =>
      module.resourceIds.includes(record.resourceId) &&
      record.resourceId !== module.courseSourceId
    );
    const evidencedObjectives = state.request_contract.requirements
      .filter((requirement) =>
        requirement.origin === "evidence_derived" &&
        requirement.evidenceRefs.some((resourceId) => module.resourceIds.includes(resourceId))
      )
      .map((requirement) => requirement.statement);
    const evidencedTasks = moduleRecords
      .filter((record) => record.kind === "exercise" || record.kind === "solution")
      .map((record) => firstSentence(record.content))
      .filter(Boolean);
    return {
      id: module.id,
      title: module.title,
      priority: "important" as const,
      // This field remains for schema compatibility. The downstream learning
      // architect selects actual block types from the request contract and
      // evidence instead of a subject-name classifier.
      content_mode: "mixed" as const,
      learning_objectives: unique(evidencedObjectives),
      assessment_signals: unique(evidencedTasks),
      resource_ids: module.resourceIds,
    };
  });
  const resolvedCourse = extractResolvedCourseIdentity(state.moodle_raw_text);
  const courseTitle = resolvedCourse && resolvedCourse.confidence !== "low"
    ? resolvedCourse.title
    : inferCourseTitle(records.map((record) => record.content), config.prompt);

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

function deriveSelectedTopicModules(
  resources: LangGraphAgentState["resource_manifest"]["resources"],
  moodleRawText: string,
): ModuleBucket[] {
  const primary = resources.filter((resource) =>
    resource.selection?.selected === true &&
    resource.selection.role === "primary_lecture" &&
    Boolean(resource.selection.topic?.trim())
  );
  const topicOrder = (topic: string): number => {
    const positions = primary
      .filter((resource) => resource.selection!.topic!.trim() === topic)
      .flatMap((resource) => [
        ...resource.sectionPath.map((part) => moodleRawText.indexOf(part)),
        moodleRawText.indexOf(resource.title),
        moodleRawText.indexOf(topic),
      ])
      .filter((position) => position >= 0);
    return positions.length > 0 ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
  };
  const orderedTopics = unique(primary.map((resource) => resource.selection!.topic!.trim()))
    .map((topic, index) => ({ topic, index, order: topicOrder(topic) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((entry) => entry.topic);
  return orderedTopics.map((title) => {
    const matching = resources.filter((resource) =>
      resource.selection?.selected === true &&
      resource.selection.topic?.trim().toLocaleLowerCase("de") === title.toLocaleLowerCase("de")
    );
    return {
      id: moduleKey(title),
      title,
      resourceIds: unique(matching.map((resource) => resource.id)),
      conceptTitles: unique(matching.map((resource) => resource.title)).slice(0, 12),
    };
  }).filter((module) => module.resourceIds.length > 0);
}


function deriveCourseHierarchyModules(
  moodleRawText: string,
  allResources: LangGraphAgentState["resource_manifest"]["resources"],
  availableSourceIds: Set<string>,
): ModuleBucket[] {
  const raw = moodleRawText.trim();
  if (!raw) return [];
  const courseSource = allResources.find((resource) =>
    resource.activityType === "course" && availableSourceIds.has(resource.id)
  );
  if (!courseSource) return [];

  const sectionEntries = new Map<string, {
    title: string;
    resources: typeof allResources;
    rawIndex: number;
  }>();
  for (const resource of allResources) {
    const title = resource.sectionPath.map((part) => part.trim()).filter(Boolean).at(-1);
    if (!title || isUtilitySection(title)) continue;
    const rawIndex = raw.lastIndexOf(title);
    if (rawIndex < 0) continue;
    const key = title.toLocaleLowerCase();
    const current = sectionEntries.get(key) ?? { title, resources: [], rawIndex };
    current.resources.push(resource);
    current.rawIndex = Math.min(current.rawIndex, rawIndex);
    sectionEntries.set(key, current);
  }
  const ordered = [...sectionEntries.values()]
    .sort((left, right) => left.rawIndex - right.rawIndex);
  if (ordered.length < 2) return [];

  const groups: typeof ordered[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const next = ordered[index + 1];
    if (isPreparatorySection(current.title) && next && isTaughtSection(next.title)) {
      groups.push([current, next]);
      index += 1;
    } else {
      groups.push([current]);
    }
  }

  return groups.slice(0, 12).map((group, index) => {
    const first = group[0]!;
    const nextGroup = groups[index + 1];
    const start = first.rawIndex;
    const end = nextGroup?.[0]?.rawIndex ?? raw.length;
    const sectionResources = group.flatMap((entry) => entry.resources);
    const supportingIds = sectionResources
      .map((resource) => resource.id)
      .filter((id) => availableSourceIds.has(id));
    const resourceIds = unique([courseSource.id, ...supportingIds]);
    const title = group.length === 2
      ? `${group[0]!.title} + ${group[1]!.title}`
      : first.title;
    return {
      id: moduleKey(title) || `course-module-${index + 1}`,
      title,
      resourceIds,
      summary: raw.slice(start, end).trim().slice(0, 6_000),
      conceptTitles: unique(sectionResources.map((resource) => resource.title)).slice(0, 12),
      courseSourceId: courseSource.id,
    };
  }).filter((module) => module.summary);
}

function isPreparatorySection(value: string): boolean {
  return /^\s*(?:self[\s-]?study|self[\s-]?learning|selbststudium|selbstlern\w*|vorbereitung)\b/iu.test(value);
}

function isTaughtSection(value: string): boolean {
  return /^\s*(?:class|lesson|session|unit|week|einheit|lektion|sitzung|termin)\s*\d+\b/iu.test(value);
}

function isUtilitySection(value: string): boolean {
  return /\b(?:important links?|course communication|announcements?|assessment(?: criteria)?|repeat exam|serviceangebote|student services?|grades?|general|allgemeines|kommunikation|prüfungsinformationen|pruefungsinformationen)\b/iu
    .test(value);
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
