import type { StudyGuideContent } from "./studyGuideContent.js";
import { isLikelyMoodleUrl } from "../moodle/moodleSite.js";

export type StudyGuideArchetype =
  | "quantitative"
  | "mixed"
  | "conceptual"
  | "procedural"
  | "case-based";

export interface StudyGuideRequirements {
  courseTitle: string;
  courseCode: string;
  archetype: StudyGuideArchetype;
  sectionTitles: string[];
  topicTarget: number;
  exerciseTarget: number;
  selectionTarget: number;
  calculationTarget: number;
  applicationTarget: number;
  vocabularyTarget: number;
  vocabularyAssessmentRequired: boolean;
  sourceExerciseCount: number;
  derivedPracticeMinimum: number;
  rationale: string;
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
  const sectionTitles = selectRepresentativeSections(handoff?.sections ?? []);
  const practice = countPracticeEvidence(sourceText);
  const formulaCount = Array.isArray(handoff?.formulas) ? handoff.formulas.length : 0;
  const workedExampleCount = Array.isArray(handoff?.worked_examples) ? handoff.worked_examples.length : 0;
  const objectiveCount = Math.max(
    sectionTitles.length,
    (handoff?.learning_modules ?? []).reduce(
      (total, module) => total + (Array.isArray(module.learning_objectives) ? module.learning_objectives.length : 0),
      0,
    ),
  );
  const assessmentSignalCount = (handoff?.learning_modules ?? []).reduce(
    (total, module) => total + (Array.isArray(module.assessment_signals) ? module.assessment_signals.length : 0),
    0,
  );
  const structuredLearningEvidence = JSON.stringify({
    sections: handoff?.sections ?? [],
    learning_modules: handoff?.learning_modules ?? [],
  });
  const vocabularySignals = countMatches(
    structuredLearningEvidence,
    /\b(?:vocabulary|vocab|wortschatz|terminology|terms?\s+of|useful\s+expressions?|fachbegriffe?|glossar|glossary)\b/gi,
  );
  const vocabularyAssessment = /\b(?:vocabulary|vocab|wortschatz)\s*(?:test|quiz|section|teil|prüfung)\b/i.test(sourceText);
  const declaredModes = new Set((handoff?.learning_modules ?? []).flatMap((module) =>
    typeof module.content_mode === "string" ? [module.content_mode] : []
  ));
  const quantitativeName = /\b(?:mathematics?|mathematik|dynamics?|dynamik|mechanics?|mechanik|physics?|physik|statistics?|statistik|calculus|rechnung)\b/i.test(courseTitle);
  const proceduralName = /\b(?:language|sprache|labor|lab|writing|schreiben|communication|kommunikation|practice|praxis)\b/i.test(courseTitle);
  const caseName = /\b(?:medicine|medizin|pflege|diagnos|therap|health|gesundheit|business|wirtschaft|management|marketing|law|recht|ethics?|ethik)\b/i.test(courseTitle);
  const caseSignals = countMatches(sourceText, /\b(?:fallbeispiel|fallstudie|patient|diagnos|therap|entscheidungssituation|unternehmen|stakeholder|szenario)\b/gi);
  const applicationSignals = countMatches(
    sourceText,
    /\b(?:apply|analyse|analyze|evaluate|critique|write|present|discuss|design|interpret|compare|perform|anwenden|analysieren|bewerten|begründen|schreiben|präsentieren|diskutieren|entwerfen|interpretieren|durchführen)\b/gi,
  );
  const quantitativeSignalText = sourceText.replace(/https?:\/\/[^\s"'<>]+/giu, " ");
  const quantitativeSignals = countMatches(
    quantitativeSignalText,
    /(?:\b(?:berechne|bestimme|ermittle|gleichung|integral|ableitung|kraft|spannung)\b|(?:[\p{L}\p{N})]\s*[=∫Σ√]\s*[\p{L}\p{N}(]))/giu,
  );
  const hasQuantitativeEvidence = quantitativeName ||
    declaredModes.has("quantitative") ||
    formulaCount > 0 ||
    practice.calculation > 0 ||
    quantitativeSignals >= 8;
  const archetype = inferArchetype({
    declaredModes,
    quantitativeName,
    proceduralName,
    caseName,
    caseSignals,
    quantitativeSignals,
    formulaCount,
    practice,
  });
  const evidenceTopics = sectionTitles.length || practice.sourceFiles || 6;
  const topicTarget = clamp(evidenceTopics, 4, 12);
  // Coverage is derived from evidenced objectives rather than a fixed
  // per-course or per-topic quota: every objective needs foundation and
  // application, complex objectives need depth, and assessment signals add a
  // representative assessment slot. Existing source questions remain a floor.
  const objectiveFloor = Math.max(objectiveCount, topicTarget);
  const foundationAndApplication = objectiveFloor * 2;
  const depthCoverage = Math.min(
    objectiveFloor,
    formulaCount + workedExampleCount,
  );
  const assessmentCoverage = assessmentSignalCount > 0 ||
      /(?:Musterprüfung|Prüfungsaufbau|sample\s+exam|exam\s+(?:format|structure))/i.test(sourceText)
    ? objectiveFloor
    : 0;
  const vocabularyPerTopic = vocabularyAssessment
    ? clamp(
        8 + Math.ceil(vocabularySignals / Math.max(1, topicTarget * 2)),
        10,
        16,
      )
    : 0;
  const vocabularyTarget = vocabularyAssessment
    ? Math.min(120, topicTarget * vocabularyPerTopic)
    : vocabularySignals > 0
      ? clamp(
          Math.max(
            6,
            vocabularySignals * 3,
            topicTarget,
          ),
          4,
          Math.min(48, topicTarget * 8),
        )
      : 0;
  const exerciseCeiling = Math.min(
    180,
    Math.max(60, vocabularyTarget + topicTarget * 6),
  );
  const exerciseTarget = clamp(
    Math.max(
      12,
      practice.total,
      foundationAndApplication + depthCoverage + assessmentCoverage + Math.ceil(vocabularyTarget / 2),
      vocabularyTarget > 0 ? vocabularyTarget + topicTarget * 3 : 0,
    ),
    12,
    exerciseCeiling,
  );
  const quantitativeEvidenceDensity = formulaCount + workedExampleCount + practice.calculation;
  const calculationShare = hasQuantitativeEvidence
    ? quantitativeEvidenceDensity >= objectiveFloor ? 0.4 : 0.25
    : 0;
  const applicationShare = declaredModes.has("procedural") || declaredModes.has("case-based")
    ? 0.55
    : applicationSignals >= objectiveFloor || caseSignals >= Math.ceil(objectiveFloor / 2)
    ? 0.4
    : applicationSignals > 0
      ? 0.3
      : 0.2;
  const generalExerciseTarget = Math.max(0, exerciseTarget - vocabularyTarget);
  const calculationTarget = Math.round(generalExerciseTarget * calculationShare);
  const applicationTarget = Math.min(
    generalExerciseTarget - calculationTarget,
    Math.max(1, Math.round(generalExerciseTarget * applicationShare)),
  );
  const selectionTarget = Math.max(0, generalExerciseTarget - calculationTarget - applicationTarget);
  const sourceExerciseCount = practice.total;
  const derivedPracticeMinimum = Math.max(0, exerciseTarget - sourceExerciseCount);
  return {
    courseTitle,
    courseCode,
    archetype,
    sectionTitles: sectionTitles.length ? sectionTitles.slice(0, 12) : Array.from({ length: topicTarget }, (_, index) => `Themenbereich ${index + 1}`),
    topicTarget,
    exerciseTarget,
    selectionTarget,
    calculationTarget,
    applicationTarget,
    vocabularyTarget,
    vocabularyAssessmentRequired: vocabularyAssessment,
    sourceExerciseCount,
    derivedPracticeMinimum,
    rationale: `${sectionTitles.length} evidenced course sections, ${objectiveFloor} objective coverage slots, ${practice.total} recognized source tasks, ${formulaCount} formula entries, ${workedExampleCount} worked examples, ${assessmentSignalCount} assessment signals, and ${vocabularySignals} terminology/vocabulary signals; evidence profile ${archetype}.`,
  };
}

export function fallbackStudyGuideRequirements(content: StudyGuideContent): StudyGuideRequirements {
  const objectiveCount = content.topics.reduce((total, topic) => total + topic.learningGoals.length, 0);
  const exerciseTarget = Math.max(2 * objectiveCount, 3 * content.topics.length, 12);
  return {
    courseTitle: content.courseTitle,
    courseCode: content.courseCode || inferCourseCode(content.courseTitle),
    archetype: "conceptual",
    sectionTitles: content.topics.map((topic) => topic.title),
    topicTarget: Math.max(content.topics.length, 4),
    exerciseTarget,
    selectionTarget: Math.ceil(exerciseTarget / 2),
    calculationTarget: 0,
    applicationTarget: Math.max(1, Math.floor(exerciseTarget / 4)),
    vocabularyTarget: 0,
    vocabularyAssessmentRequired: false,
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

function inferCourseIdentity(extractedTitle: string): { code: string; title: string } {
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

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function inferArchetype(input: {
  declaredModes: Set<string>;
  quantitativeName: boolean;
  proceduralName: boolean;
  caseName: boolean;
  caseSignals: number;
  quantitativeSignals: number;
  formulaCount: number;
  practice: { total: number; selection: number; calculation: number; sourceFiles: number };
}): StudyGuideArchetype {
  const normalizedModes = new Set([...input.declaredModes].map((mode) =>
    mode === "case_based" ? "case-based" : mode
  ));
  normalizedModes.delete("mixed");
  if (normalizedModes.size > 1 || input.declaredModes.has("mixed")) return "mixed";
  if (normalizedModes.has("quantitative")) return "quantitative";
  if (normalizedModes.has("procedural")) return "procedural";
  if (normalizedModes.has("case-based")) return "case-based";
  if (normalizedModes.has("conceptual")) return "conceptual";
  if (
    input.quantitativeName ||
    input.practice.calculation >= 5 ||
    input.formulaCount >= 5 ||
    input.quantitativeSignals >= 80
  ) {
    return input.practice.selection >= 8 ? "mixed" : "quantitative";
  }
  if (input.caseName || input.caseSignals >= 12) return "case-based";
  if (input.proceduralName) return "procedural";
  return input.practice.calculation > 0 ? "mixed" : "conceptual";
}
