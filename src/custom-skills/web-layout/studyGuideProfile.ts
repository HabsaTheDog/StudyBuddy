import type { StudyGuideContent } from "./studyGuideContent.js";

export type StudyGuideArchetype = "quantitative" | "mixed" | "conceptual" | "case-based";

export interface StudyGuideRequirements {
  courseTitle: string;
  courseCode: string;
  archetype: StudyGuideArchetype;
  sectionTitles: string[];
  topicTarget: number;
  exerciseTarget: number;
  selectionTarget: number;
  calculationTarget: number;
  sourceExerciseCount: number;
  derivedPracticeMinimum: number;
  rationale: string;
}

interface HandoffSource {
  id?: unknown;
  title?: unknown;
  kind?: unknown;
  url?: unknown;
}

interface HandoffSection {
  heading?: unknown;
  summary?: unknown;
  source_ids?: unknown;
}

interface ExtractionHandoff {
  document_title?: unknown;
  course?: { title?: unknown; url?: unknown };
  sources?: HandoffSource[];
  sections?: HandoffSection[];
  formulas?: unknown[];
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
  const identity = inferCourseIdentity(extractedCourseTitle, sourceText);
  const courseTitle = identity.title;
  const courseCode = identity.code;
  const sectionTitles = selectRepresentativeSections(handoff?.sections ?? []);
  const practice = countPracticeEvidence(sourceText);
  const formulaCount = Array.isArray(handoff?.formulas) ? handoff.formulas.length : 0;
  const quantitativeName = /\b(?:maes|mathematik|dynamik|mechanik|maschinen|physik|elektro|thermo|statistik|rechnung|engineering)\b/i.test(courseTitle);
  const caseName = /\b(?:medizin|pflege|diagnos|therap|gesundheit|wirtschaft|management|marketing|recht|ethik)\b/i.test(courseTitle);
  const caseSignals = countMatches(sourceText, /\b(?:fallbeispiel|fallstudie|patient|diagnos|therap|entscheidungssituation|unternehmen|stakeholder|szenario)\b/gi);
  const quantitativeSignals = countMatches(sourceText, /(?:\b(?:berechne|bestimme|ermittle|gleichung|integral|ableitung|moment|kraft|spannung|leistung)\b|[=∫Σ√])/gi);
  const archetype: StudyGuideArchetype = quantitativeName || practice.calculation >= 5 || formulaCount >= 5 || quantitativeSignals >= 80
    ? practice.selection >= 8 ? "mixed" : "quantitative"
    : caseName || caseSignals >= 12
      ? "case-based"
      : practice.calculation > 0
        ? "mixed"
        : "conceptual";
  const evidenceTopics = sectionTitles.length || practice.sourceFiles || 6;
  const topicTarget = clamp(evidenceTopics, 4, 12);
  const baselinePerTopic = archetype === "quantitative" || archetype === "mixed" ? 4 : 3;
  const usefulMinimum = topicTarget * baselinePerTopic;
  const maes2 = /\bMAES2\b/i.test(`${courseCode} ${courseTitle}`);
  const exerciseTarget = maes2 ? 40 : clamp(Math.max(usefulMinimum, Math.min(practice.total, 44)), 18, 44);
  const calculationShare = archetype === "quantitative" ? 0.4 : archetype === "mixed" ? 0.25 : 0;
  const selectionShare = archetype === "case-based" ? 0.5 : archetype === "conceptual" ? 0.55 : 0.35;
  const calculationTarget = maes2 ? 18 : Math.round(exerciseTarget * calculationShare);
  const selectionTarget = maes2 ? 20 : Math.min(exerciseTarget - calculationTarget, Math.round(exerciseTarget * selectionShare));
  const sourceExerciseCount = practice.total;
  const derivedPracticeMinimum = Math.max(0, exerciseTarget - sourceExerciseCount);
  return {
    courseTitle,
    courseCode,
    archetype,
    sectionTitles: sectionTitles.length ? sectionTitles.slice(0, 12) : Array.from({ length: topicTarget }, (_, index) => `Themenbereich ${index + 1}`),
    topicTarget: maes2 ? 11 : topicTarget,
    exerciseTarget,
    selectionTarget,
    calculationTarget,
    sourceExerciseCount,
    derivedPracticeMinimum,
    rationale: `${sectionTitles.length} belegte Kursabschnitte, ${practice.total} erkannte Quellaufgaben, ${formulaCount} Formeleinträge; Profil ${archetype}.`,
  };
}

export function fallbackStudyGuideRequirements(content: StudyGuideContent): StudyGuideRequirements {
  if (/\bMAES2\b/i.test(`${content.courseCode ?? ""} ${content.courseTitle}`)) {
    return {
      courseTitle: content.courseTitle,
      courseCode: content.courseCode || "MAES2",
      archetype: "mixed",
      sectionTitles: content.topics.map((topic) => topic.title),
      topicTarget: 11,
      exerciseTarget: 40,
      selectionTarget: 20,
      calculationTarget: 18,
      sourceExerciseCount: 40,
      derivedPracticeMinimum: 0,
      rationale: "Legacy MAES2 quality floor.",
    };
  }
  const exerciseTarget = Math.max(3 * content.topics.length, 12);
  return {
    courseTitle: content.courseTitle,
    courseCode: content.courseCode || inferCourseCode(content.courseTitle),
    archetype: "conceptual",
    sectionTitles: content.topics.map((topic) => topic.title),
    topicTarget: Math.max(content.topics.length, 4),
    exerciseTarget,
    selectionTarget: Math.ceil(exerciseTarget / 2),
    calculationTarget: 0,
    sourceExerciseCount: 0,
    derivedPracticeMinimum: 0,
    rationale: "Schema-only fallback quality floor.",
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

export function isMaes2PracticeCorpus(sourceText: string): boolean {
  const requirements = deriveStudyGuideRequirements(sourceText);
  return /\bMAES2\b/i.test(`${requirements.courseCode} ${requirements.courseTitle}`) &&
    /## Full extracted practice corpus/.test(sourceText) &&
    /Minitest-(?:1|2|3|4|5|6|7|8|10)/i.test(sourceText);
}

export function knownHandoffSourceUrls(sourceText: string): Set<string> {
  const handoff = readExtractionHandoff(sourceText);
  return new Set((handoff?.sources ?? [])
    .map((source) => typeof source.url === "string" ? source.url : "")
    .filter((url) => /^https:\/\/moodle\.technikum-wien\.at\/(?:course\/|mod\/|pluginfile\.php\/)/i.test(url)));
}

export function handoffSourceRegistry(sourceText: string): Array<{ id: string; label: string; url: string }> {
  const handoff = readExtractionHandoff(sourceText);
  return (handoff?.sources ?? []).flatMap((source) => {
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const label = typeof source.title === "string" ? source.title.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    return label && /^https:\/\/moodle\.technikum-wien\.at\/(?:course\/|mod\/|pluginfile\.php\/)/i.test(url)
      ? [{ id, label, url }]
      : [];
  });
}

function countPracticeEvidence(sourceText: string): { total: number; selection: number; calculation: number; sourceFiles: number } {
  const corpusIndex = sourceText.indexOf("## Full extracted practice corpus");
  if (corpusIndex < 0) return { total: 0, selection: 0, calculation: 0, sourceFiles: 0 };
  const corpus = sourceText.slice(corpusIndex);
  const starts = [...corpus.matchAll(/^\s*\d{1,2}\.\s+([^:\n]{2,80})\s*:?/gmi)];
  const selection = starts.filter((match) => /choice|wahr|falsch|dropdown|drop ?down|zuordnung|auswahl/i.test(match[1])).length;
  const calculation = starts.filter((match) => /numerisch|rechnung|berechnung|eingabe/i.test(match[1])).length;
  const sourceFiles = countMatches(corpus, /^### Practice source:/gmi);
  return { total: starts.length, selection, calculation: Math.max(calculation, starts.length - selection), sourceFiles };
}

function inferCourseCode(title: string): string {
  const explicit = /\b([A-ZÄÖÜ]{2,8}\d{0,2})\b/.exec(title)?.[1];
  if (explicit) return explicit;
  return title.split(/[–—:\-]/, 1)[0].trim().slice(0, 24) || "Kurs";
}

function inferCourseIdentity(extractedTitle: string, sourceText: string): { code: string; title: string } {
  const evidence = `${extractedTitle}\n${sourceText.slice(0, 80_000)}`;
  if (/\bMAES\s*2\b|Mathematik für Engineering Science 2/i.test(evidence)) {
    return { code: "MAES2", title: "Mathematik für Engineering Science 2" };
  }
  if (/\bDYN\s*2\b|Anwendungen der Dynamik/i.test(evidence)) {
    return { code: "DYN2", title: "Anwendungen der Dynamik" };
  }
  if (/\bMEL\s*1?\b|Maschinenelemente 1/i.test(evidence)) {
    return { code: "MEL1", title: "Maschinenelemente 1" };
  }
  return { code: inferCourseCode(extractedTitle), title: extractedTitle };
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
  if (grouped.size >= 2) return unique([...grouped.values(), ...ungrouped]).slice(0, 12);
  return unique(candidates.map((candidate) => candidate.title)).slice(0, 12);
}

function cleanTitle(value: string): string {
  return value.replace(/\s*[–-]\s*BMR\b.*$/i, "").replace(/\s+/g, " ").trim();
}

function cleanSectionTitle(value: string): string {
  return value.replace(/^THEMA\s*\d+\s*:\s*/i, "").replace(/\s+/g, " ").trim();
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
