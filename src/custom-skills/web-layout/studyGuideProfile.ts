import { isLikelyMoodleUrl, normalizeMoodleCourseIdentity } from "../moodle/moodleSite.js";

export interface StudyGuideRequirements {
  courseTitle: string;
  courseCode: string;
  sectionTitles: string[];
}

export interface HandoffSource {
  id?: unknown;
  title?: unknown;
  kind?: unknown;
  url?: unknown;
  path?: unknown;
  page?: unknown;
}

export interface HandoffVisualAsset {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  relative_path?: unknown;
  mime_type?: unknown;
  width_px?: unknown;
  height_px?: unknown;
  source_id?: unknown;
  source_page?: unknown;
  confidence?: unknown;
  caption_hint?: unknown;
  relevance_reason?: unknown;
}

interface HandoffSection {
  heading?: unknown;
  summary?: unknown;
  source_ids?: unknown;
}

export interface ExtractionHandoff {
  document_title?: unknown;
  course?: { title?: unknown; url?: unknown };
  sources?: HandoffSource[];
  sections?: HandoffSection[];
  formulas?: unknown[];
  figures?: Array<{
    asset_id?: unknown;
    caption?: unknown;
    placement_hint?: unknown;
    source_ids?: unknown;
  }>;
  visual_assets?: HandoffVisualAsset[];
  worked_examples?: unknown[];
  learning_modules?: Array<{
    id?: unknown;
    title?: unknown;
    content_mode?: unknown;
    learning_objectives?: unknown[];
    assessment_signals?: unknown[];
  }>;
}

export interface HandoffSectionGroup {
  key: string;
  title: string;
  subtopics: string[];
}

export function handoffSectionGroups(sourceText: string): HandoffSectionGroup[] {
  const handoff = readExtractionHandoff(sourceText);
  const explicitModules = (handoff?.learning_modules ?? []).flatMap((module, index) => {
    const title = typeof module.title === "string" ? cleanSectionTitle(module.title) : "";
    if (!title) return [];
    return [{
      key: typeof module.id === "string" && module.id ? module.id : `module-${index + 1}`,
      title,
      subtopics: [] as string[],
    }];
  });
  if (explicitModules.length > 1) return explicitModules;
  const sections = handoff?.sections ?? [];
  const groups = new Map<string, string[]>();
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const title = typeof section.heading === "string"
      ? cleanSectionTitle(section.heading)
      : "";
    if (!title) continue;
    const ids = Array.isArray(section.source_ids)
      ? section.source_ids.map(String)
      : [];
    const chapter = ids
      .map((id) => /(?:^|_)ch(\d+)(?:_|$)/i.exec(id)?.[1])
      .find(Boolean);
    const primarySource = ids[0]?.replace(/_res_[a-z0-9]+$/i, "");
    const key = chapter ? `chapter-${chapter}` : primarySource || `section-${index + 1}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(title);
    groups.set(key, bucket);
  }
  return [...groups.entries()].map(([key, titles]) => {
    const subtopics = unique(titles);
    return {
      key,
      title: groupedSectionTitle(subtopics),
      subtopics,
    };
  });
}

export function deriveStudyGuideRequirements(sourceText: string): StudyGuideRequirements {
  const handoff = readExtractionHandoff(sourceText);
  const extractedCourseTitle = cleanTitle(
    typeof handoff?.course?.title === "string"
      ? handoff.course.title
      : typeof handoff?.document_title === "string"
        ? handoff.document_title
        : "Interaktiver Study Guide",
  );
  const identity = inferCourseIdentity(extractedCourseTitle);
  const courseTitle = identity.title;
  const courseCode = identity.code;
  const moduleTitles = (handoff?.learning_modules ?? []).flatMap((module) =>
    typeof module.title === "string" && module.title.trim() ? [cleanSectionTitle(module.title)] : []
  );
  const sectionTitles = unique(moduleTitles.length > 0
    ? moduleTitles
    : selectRepresentativeSections(handoff?.sections ?? []));
  return {
    courseTitle,
    courseCode,
    sectionTitles: sectionTitles.length ? sectionTitles : [courseTitle],
  };
}

export function readExtractionHandoff(sourceText: string): ExtractionHandoff | null {
  const marker = sourceText.indexOf("## Extracted data");
  if (marker < 0) return null;
  const jsonStart = sourceText.indexOf("{", marker);
  if (jsonStart < 0) return null;
  const jsonEnd = findJsonObjectEnd(sourceText, jsonStart);
  if (jsonEnd < 0) return null;
  try {
    return JSON.parse(sourceText.slice(jsonStart, jsonEnd + 1)) as ExtractionHandoff;
  } catch {
    return null;
  }
}

function findJsonObjectEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

export function knownHandoffSourceUrls(sourceText: string): Set<string> {
  const handoff = readExtractionHandoff(sourceText);
  return new Set((handoff?.sources ?? [])
    .map((source) => typeof source.url === "string" ? source.url : "")
    .filter((url) => /^https:\/\//i.test(url) && isLikelyMoodleUrl(url)));
}

export function handoffSourceRegistry(sourceText: string): Array<{ id: string; label: string; url: string }> {
  const handoff = readExtractionHandoff(sourceText);
  return (handoff?.sources ?? []).flatMap((source) => {
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const label = typeof source.title === "string" ? source.title.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    return label && /^https:\/\//i.test(url) && isLikelyMoodleUrl(url)
      ? [{ id, label, url }]
      : [];
  });
}

function inferCourseCode(title: string): string {
  const explicit = /\b([A-ZÄÖÜ]{2,8}\d{0,2})\b/.exec(title)?.[1];
  if (explicit) return explicit;
  return title.split(/[–—:\-]/, 1)[0].trim().slice(0, 24) || "Kurs";
}

function inferCourseIdentity(extractedTitle: string): { code: string; title: string } {
  const identity = normalizeMoodleCourseIdentity(extractedTitle);
  return {
    code: identity.code || inferCourseCode(identity.title),
    title: identity.title,
  };
}

function selectRepresentativeSections(sections: HandoffSection[]): string[] {
  const candidates = sections.map((section) => ({
    title: typeof section.heading === "string" ? cleanSectionTitle(section.heading) : "",
    group: Array.isArray(section.source_ids)
      ? section.source_ids.map(String).map((id) => /(?:^|_)ch(\d+)(?:_|$)/i.exec(id)?.[1]).find(Boolean) ?? ""
      : "",
  })).filter((candidate) => candidate.title);
  const grouped = new Map<string, string>();
  const ungrouped: string[] = [];
  for (const candidate of candidates) {
    if (candidate.group) {
      if (!grouped.has(candidate.group)) grouped.set(candidate.group, candidate.title);
    } else ungrouped.push(candidate.title);
  }
  // Extraction handoffs commonly contain several pedagogical sub-sections per
  // source chapter. One representative tab per chapter prevents the first
  // chapter from crowding every other chapter out of the twelve-tab cap.
  if (grouped.size >= 2) return unique([...grouped.values(), ...ungrouped]);
  return unique(candidates.map((candidate) => candidate.title));
}

function cleanTitle(value: string): string {
  return value.replace(/\s*[–-]\s*BMR\b.*$/i, "").replace(/\s+/g, " ").trim();
}

function cleanSectionTitle(value: string): string {
  return value.replace(/^THEMA\s*\d+\s*:\s*/i, "").replace(/\s+/g, " ").trim();
}

function groupedSectionTitle(subtopics: string[]): string {
  const numbered = subtopics.flatMap((title) => {
    const match = /^\s*Thema\s*(\d+)\b/i.exec(title);
    return match ? [Number(match[1])] : [];
  });
  const uniqueNumbers = [...new Set(numbered)].sort((left, right) => left - right);
  if (uniqueNumbers.length <= 1) return subtopics[0] ?? "Kurskapitel";
  const first = uniqueNumbers[0]!;
  const last = uniqueNumbers.at(-1)!;
  return `Themen ${first}–${last}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
