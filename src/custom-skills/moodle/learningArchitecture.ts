import { z } from "zod";

export const learningPrioritySchema = z.enum([
  "essential",
  "important",
  "supplementary",
]);

export const learningContentModeSchema = z.enum([
  "quantitative",
  "conceptual",
  "procedural",
  "case_based",
  "mixed",
]);

const nonEmptyTextSchema = z.string().trim().min(1);
const resourceUrlSchema = z.string().url();

export const learningModuleSchema = z.object({
  id: nonEmptyTextSchema,
  title: nonEmptyTextSchema,
  priority: learningPrioritySchema,
  contentMode: learningContentModeSchema,
  learningObjectives: z.array(nonEmptyTextSchema).min(1),
  assessmentSignals: z.array(nonEmptyTextSchema),
  resourceUrls: z.array(resourceUrlSchema),
}).strict();

export const learningSupportResourceSchema = z.object({
  id: nonEmptyTextSchema,
  title: nonEmptyTextSchema,
  purpose: z.enum(["formula_reference", "general_reference", "supplementary"]),
  resourceUrls: z.array(resourceUrlSchema),
}).strict();

export const learningArchitectureSchema = z.object({
  schemaVersion: z.literal(1),
  modules: z.array(learningModuleSchema),
  supportResources: z.array(learningSupportResourceSchema),
  excludedResourceUrls: z.array(resourceUrlSchema),
}).strict().superRefine((architecture, context) => {
  const ids = new Set<string>();
  for (const [kind, entries] of [
    ["module", architecture.modules],
    ["support resource", architecture.supportResources],
  ] as const) {
    for (const entry of entries) {
      if (ids.has(entry.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate learning architecture id: ${entry.id}`,
          path: [kind === "module" ? "modules" : "supportResources"],
        });
      }
      ids.add(entry.id);
    }
  }
});

export type LearningPriority = z.infer<typeof learningPrioritySchema>;
export type LearningContentMode = z.infer<typeof learningContentModeSchema>;
export type LearningModule = z.infer<typeof learningModuleSchema>;
export type LearningSupportResource = z.infer<typeof learningSupportResourceSchema>;
export type LearningArchitecture = z.infer<typeof learningArchitectureSchema>;

/** Compact shape already produced by sourceArchitect's document-brief stage. */
export interface LearningArchitectureDocumentBrief {
  resourceId?: string;
  title: string;
  role?: string | null;
  topic?: string | null;
  summary?: string | null;
  resourceUrl?: string | null;
  sectionTitle?: string | null;
}

/** Structural subset of a resource-catalog entry needed by this module. */
export interface LearningArchitectureCatalogEntry {
  href: string;
  label: string;
  sectionTitle?: string | null;
  role?: string | null;
  topic?: string | null;
  priority?: number | null;
}

export interface LearningArchitectureInput {
  briefs: LearningArchitectureDocumentBrief[];
  catalog: LearningArchitectureCatalogEntry[];
}

export type LearningArchitectureValidation =
  | { success: true; data: LearningArchitecture }
  | { success: false; error: string };

/**
 * Keeps model-call count bounded without discarding learning objectives or
 * source coverage. Adjacent modules are combined because course order is part
 * of the architecture and usually reflects prerequisite progression.
 */
export function boundLearningArchitecture(
  architecture: LearningArchitecture,
  maxModules = 6,
): LearningArchitecture {
  if (architecture.modules.length <= maxModules || maxModules < 1) return architecture;
  const groups = Array.from({ length: maxModules }, () => [] as LearningArchitecture["modules"]);
  architecture.modules.forEach((module, index) => {
    groups[Math.floor(index * maxModules / architecture.modules.length)].push(module);
  });
  const priorityRank = { essential: 0, important: 1, supplementary: 2 } as const;
  const modules = groups.filter((group) => group.length > 0).map((group, index) => {
    const modes = new Set(group.map((module) => module.contentMode));
    return {
      id: `${group[0].id}-cluster-${index + 1}`,
      title: group.map((module) => module.title).join(" / "),
      priority: [...group]
        .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority])[0].priority,
      contentMode: modes.size === 1 ? group[0].contentMode : "mixed" as const,
      learningObjectives: [...new Set(group.flatMap((module) => module.learningObjectives))],
      assessmentSignals: [...new Set(group.flatMap((module) => module.assessmentSignals))],
      resourceUrls: [...new Set(group.flatMap((module) => module.resourceUrls))],
    };
  });
  return learningArchitectureSchema.parse({ ...architecture, modules });
}

/**
 * Validates untrusted model output. Fenced JSON is accepted because some model
 * transports retain a Markdown fence even when JSON was explicitly requested.
 */
export function validateLearningArchitectureModelJson(
  value: string | unknown,
): LearningArchitectureValidation {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(stripJsonFence(value));
    } catch (error) {
      return {
        success: false,
        error: `Learning architecture is not valid JSON: ${errorMessage(error)}`,
      };
    }
  }
  const result = learningArchitectureSchema.safeParse(parsed);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: z.prettifyError(result.error) };
}

export function parseLearningArchitectureModelJson(value: string | unknown): LearningArchitecture {
  const result = validateLearningArchitectureModelJson(value);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

interface ResourceRecord {
  title: string;
  role: string;
  topic: string | null;
  sectionTitle: string | null;
  summary: string;
  urls: string[];
  priority: number;
}

interface ModuleAccumulator {
  title: string;
  records: ResourceRecord[];
}

/**
 * Produces a bounded, domain-neutral learning architecture when model planning
 * is unavailable. It deliberately derives modules from meaningful topics and
 * learning activity signals, never from a list of known subjects.
 */
export function buildDeterministicLearningArchitecture(
  input: LearningArchitectureInput,
): LearningArchitecture {
  const records = mergeBriefsWithCatalog(input.briefs, input.catalog);
  const excludedResourceUrls = new Set<string>();
  const supportRecords: ResourceRecord[] = [];
  const practiceRecords: ResourceRecord[] = [];
  const modules = new Map<string, ModuleAccumulator>();

  for (const record of records) {
    if (isAdministrative(record) || isDiscardableShell(record)) {
      record.urls.forEach((url) => excludedResourceUrls.add(url));
      continue;
    }
    if (isSupportResource(record)) {
      supportRecords.push(record);
      continue;
    }
    if (isPracticeResource(record)) {
      practiceRecords.push(record);
      continue;
    }
    const title = deriveLearningTitle(record);
    if (!title) {
      record.urls.forEach((url) => excludedResourceUrls.add(url));
      continue;
    }
    const key = normalizeForComparison(title);
    const accumulator = modules.get(key) ?? { title, records: [] };
    accumulator.records.push(record);
    modules.set(key, accumulator);
  }

  for (const practice of practiceRecords) {
    const target = bestPracticeTarget(practice, modules);
    if (target) {
      target.records.push(practice);
    } else {
      practice.urls.forEach((url) => excludedResourceUrls.add(url));
    }
  }

  const usedIds = new Set<string>();
  const learningModules = [...modules.values()]
    .map((module) => buildLearningModule(module, uniqueId(module.title, usedIds)))
    .sort(compareModules);
  const supportResources = groupSupportResources(supportRecords, usedIds);

  return learningArchitectureSchema.parse({
    schemaVersion: 1,
    modules: learningModules,
    supportResources,
    excludedResourceUrls: [...excludedResourceUrls].sort(),
  });
}

function mergeBriefsWithCatalog(
  briefs: LearningArchitectureDocumentBrief[],
  catalog: LearningArchitectureCatalogEntry[],
): ResourceRecord[] {
  const records = catalog.map((entry) => ({
    title: cleanWhitespace(entry.label),
    role: normalizeRole(entry.role),
    topic: nullableText(entry.topic),
    sectionTitle: nullableText(entry.sectionTitle),
    summary: "",
    urls: validUrls([entry.href]),
    priority: entry.priority ?? 0,
  } satisfies ResourceRecord));
  const unmatched = new Set(records.map((_, index) => index));

  for (const brief of briefs) {
    const matchingIndex = findCatalogMatch(brief, records, unmatched);
    if (matchingIndex !== null) {
      const record = records[matchingIndex];
      unmatched.delete(matchingIndex);
      record.role = preferSpecificText(brief.role, record.role);
      record.topic = nullableText(brief.topic) ?? record.topic;
      record.sectionTitle = nullableText(brief.sectionTitle) ?? record.sectionTitle;
      record.summary = cleanWhitespace(brief.summary ?? "");
      record.urls = uniqueStrings([...record.urls, ...validUrls([brief.resourceUrl])]);
      continue;
    }
    records.push({
      title: cleanWhitespace(brief.title),
      role: normalizeRole(brief.role),
      topic: nullableText(brief.topic),
      sectionTitle: nullableText(brief.sectionTitle),
      summary: cleanWhitespace(brief.summary ?? ""),
      urls: validUrls([brief.resourceUrl]),
      priority: 0,
    });
  }
  return records.filter((record) => record.title.length > 0);
}

function findCatalogMatch(
  brief: LearningArchitectureDocumentBrief,
  records: ResourceRecord[],
  unmatched: Set<number>,
): number | null {
  const briefTitle = normalizeForComparison(brief.title);
  const briefTopic = normalizeForComparison(brief.topic ?? "");
  for (const index of unmatched) {
    const record = records[index];
    if (normalizeForComparison(record.title) === briefTitle) return index;
    if (briefTopic && normalizeForComparison(record.topic ?? "") === briefTopic) return index;
  }
  return null;
}

function isAdministrative(record: ResourceRecord): boolean {
  if (record.role === "administrative") return true;
  const combined = `${record.title} ${record.sectionTitle ?? ""}`;
  return /\b(?:organisation|organization|organisatorisch|administration|course\s+information|kursinformation|allgemeine\s+informationen?|general\s+information|announcement|ankündigung|ankuendigung|calendar|kalender|schedule|stundenplan|attendance|anwesenheit|grading|bewertung|exam\s+dates?|prüfungstermine?|pruefungstermine?|welcome|willkommen|forum|office\s+hours?|sprechstunde|contact|kontakt|feedback)\b/i.test(combined);
}

function isSupportResource(record: ResourceRecord): boolean {
  if (["formula", "external_reference"].includes(record.role)) return true;
  return /\b(?:formula\s*(?:sheet|collection)|formelsammlung|formulary|reference|nachschlagewerk|handbook|tabellenbuch|lookup\s+table|glossar(?:y)?|symbol\s*(?:list|table)|cheat\s*sheet)\b/i.test(record.title);
}

function isPracticeResource(record: ResourceRecord): boolean {
  if (["worked_example", "sample_exam", "exercise", "solution"].includes(record.role)) {
    return true;
  }
  return /^\s*(?:(?:sample|mock|past|muster)\s+)?(?:mini\s*test|quiz|test|exam|prüfung|pruefung|worksheet|arbeitsblatt|exercise|übungs?(?:blatt|aufgaben?)?|uebungs?(?:blatt|aufgaben?)?|assignment|aufgabe|worked\s+(?:example|solution)|lösung|loesung)\b/i.test(record.title);
}

function isDiscardableShell(record: ResourceRecord): boolean {
  const title = cleanWhitespace(record.title);
  if (/^(?:-\s*)?link\s*\[\s*ref\s*=.*\burl\s*=|^https?:\/\//i.test(title)) return true;
  if (/\b(?:tips?\s+(?:for|on)\s+(?:learning|studying)|how\s+to\s+study|lerntipps?|tipps?\s+(?:für|fuer|zum)\s+(?:das\s+)?lernen)\b/i.test(title)) {
    return true;
  }
  if (/\b(?:gesamtskriptum|complete\s+course|whole\s+course|course\s+(?:script|notes|shell)|kurs(?:skript|unterlagen))\b/i.test(title)) {
    return true;
  }
  // A catalog-only, supplementary author/title entry ending in a bare level
  // number is normally a whole-course shell, not a teachable unit. Requiring
  // all three conditions avoids dropping titled units such as "Method 2" from
  // primary material.
  return record.role === "supplementary" && !record.summary && !record.topic &&
    /^[^:]{2,80}:\s*[„“"']?[\p{L}][\p{L}\s-]{1,60}\s+\d+\s*[“”"']?$/u.test(title);
}

function deriveLearningTitle(record: ResourceRecord): string | null {
  for (const candidate of [record.topic, record.sectionTitle, record.title]) {
    const cleaned = cleanLearningTitle(candidate ?? "");
    if (cleaned && !isGenericContainerTitle(cleaned)) return cleaned;
  }
  return null;
}

function cleanLearningTitle(value: string): string {
  return cleanWhitespace(value)
    .replace(/\.(?:pdf|pptx?|docx?|xlsx?)$/i, "")
    .replace(/^\s*(?:\d+[._-]\s*)+/, "")
    .replace(/^[^:]{2,80}:\s*(?=(?:(?:warmup|mathe)[- ]*)?(?:skriptum|script|studienbrief|study\s+letter|fact[- ]?sheet|lecture\s+notes?|vorlesungsunterlagen)\b)/i, "")
    .replace(/^\s*(?:(?:warmup|mathe)[- ]*)?(?:skriptum|script|studienbrief|study\s+letter|fact[- ]?sheet|lecture\s+notes?|vorlesungsunterlagen)\s*\d*\s*[:._–—„“"'-]*\s*/i, "")
    .replace(/^\s*(?:lecture|vorlesung|slides?|folien|chapter|kapitel|unit|einheit|week|woche|notes?)\s*\d*\s*[:._–—-]*\s*/i, "")
    .replace(/\s*[:._–—-]+\s*(?:lecture|vorlesung|slides?|folien|notes?|skript|worksheet|arbeitsblatt|exercise|übung|uebung|case\s+study|fallstudie)\s*$/i, "")
    .replace(/^[„“"']+|[“”"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bestPracticeTarget(
  practice: ResourceRecord,
  modules: ReadonlyMap<string, ModuleAccumulator>,
): ModuleAccumulator | null {
  const subject = practiceSubject(practice);
  if (!subject) return null;
  const subjectNormalized = normalizeForComparison(subject);
  const subjectTokens = semanticTokens(subject);
  let best: { module: ModuleAccumulator; score: number } | null = null;
  for (const module of modules.values()) {
    const moduleNormalized = normalizeForComparison(module.title);
    const moduleTokens = semanticTokens([
      module.title,
      ...module.records.map((record) => `${record.topic ?? ""} ${record.summary.slice(0, 500)}`),
    ].join(" "));
    const shared = [...subjectTokens].filter((token) => moduleTokens.has(token)).length;
    const overlap = shared / Math.max(1, subjectTokens.size);
    const exact = subjectNormalized === moduleNormalized
      ? 4
      : subjectNormalized.includes(moduleNormalized) || moduleNormalized.includes(subjectNormalized)
        ? 2
        : 0;
    const score = exact + overlap;
    if (shared === 0 && exact === 0) continue;
    if (!best || score > best.score || (score === best.score && module.title.length > best.module.title.length)) {
      best = { module, score };
    }
  }
  return best?.module ?? null;
}

function practiceSubject(record: ResourceRecord): string | null {
  for (const candidate of [record.topic, record.sectionTitle]) {
    const cleaned = cleanLearningTitle(candidate ?? "");
    if (cleaned && !isGenericContainerTitle(cleaned)) return cleaned;
  }
  const marker = /\b(?:mini\s*test|quiz|test|exam|prüfung|pruefung|worksheet|arbeitsblatt|exercise|übungs?(?:blatt|aufgaben?)?|uebungs?(?:blatt|aufgaben?)?|assignment|aufgabe|worked\s+(?:example|solution)|lösung|loesung)\s*\d*\s*:\s*/i.exec(record.summary);
  if (marker) {
    const remainder = record.summary.slice(marker.index + marker[0].length);
    const heading = remainder
      .split(/\s+\d+\s*[.)]?\s*(?=(?:single|multiple|drag|drop|true|false|wahr|falsch|numeri(?:c|sch)|question|frage)\b)/i)[0]
      .replace(/\s+\d+\s*$/g, "")
      .replace(/[.:;,-]+\s*$/g, "")
      .trim();
    if (heading && heading.length <= 160 && !isGenericContainerTitle(heading)) return heading;
  }
  const fromTitle = cleanLearningTitle(record.title
    .replace(/^\s*(?:(?:sample|mock|past|muster)\s+)?(?:mini\s*test|quiz|test|exam|prüfung|pruefung|worksheet|arbeitsblatt|exercise|übungs?(?:blatt|aufgaben?)?|uebungs?(?:blatt|aufgaben?)?|assignment|aufgabe|worked\s+(?:example|solution)|lösung|loesung)\s*\d*\s*[:._–—-]*\s*/i, "")
    .replace(/^\s*(?:solutions?|lösungen?|loesungen?)\s*[:._–—-]*\s*/i, "")
    .replace(/\s*[:._–—-]+\s*(?:solutions?|lösungen?|loesungen?|file|datei)\s*$/i, ""));
  return fromTitle && !isGenericContainerTitle(fromTitle) ? fromTitle : null;
}

function semanticTokens(value: string): Set<string> {
  const stopWords = new Set([
    "and", "the", "for", "with", "from", "into", "und", "der", "die", "das", "den", "dem", "des", "mit", "von", "fur", "fuer", "zu",
    "lecture", "vorlesung", "script", "skriptum", "studienbrief", "sheet", "blatt", "test", "minitest", "quiz", "exam", "prufung", "pruefung", "solution", "losung", "loesung", "file", "datei", "grundlagen",
  ]);
  return new Set(normalizeForComparison(value).split(" ")
    .filter((token) => token.length >= 3 && !stopWords.has(token) && !/^\d+$/.test(token)));
}

function isGenericContainerTitle(value: string): boolean {
  const normalized = normalizeForComparison(value);
  if (!normalized) return true;
  return /^(?:(?:lecture|vorlesung|slides?|folien|chapter|kapitel|unit|einheit|week|woche|session|prasenz|praesenz|presence|module|modul|block|topic|thema|course|kurs|overview|uberblick|ueberblick|summary|zusammenfassung|materials?|materialien|unterlagen|documents?|resources?|ressourcen?|exam|prufung|pruefung|test)\s*)+(?:\d+|[a-z]|[ivxlcdm]+)?$/i.test(normalized);
}

function buildLearningModule(module: ModuleAccumulator, id: string): LearningModule {
  const contentMode = inferContentMode(module.records);
  return {
    id,
    title: module.title,
    priority: inferPriority(module.records),
    contentMode,
    learningObjectives: learningObjectives(module.title, contentMode),
    assessmentSignals: assessmentSignals(module.records),
    resourceUrls: uniqueStrings(module.records.flatMap((record) => record.urls)).sort(),
  };
}

function inferPriority(records: ResourceRecord[]): LearningPriority {
  const roles = new Set(records.map((record) => record.role));
  const text = records.map(resourceText).join(" ");
  if (
    [...roles].some((role) => ["primary_lecture", "sample_exam", "worked_example"].includes(role)) ||
    /\b(?:exam|prüfung|pruefung|test|quiz|assignment|aufgabe|exercise|übung|uebung|assessment)\b/i.test(text)
  ) return "essential";
  if (roles.has("overview") || records.some((record) => record.priority >= 500)) return "important";
  return "supplementary";
}

function inferContentMode(records: ResourceRecord[]): LearningContentMode {
  const text = records.map(resourceText).join(" ");
  const caseBased = /\b(?:case\s+study|fallstudie|case|scenario|szenario|vignette|decision\s+situation)\b/i.test(text);
  const quantitative = /\b(?:calculate|calculation|compute|equation|formula|derive|solve|numeric|quantitative|berechne[nt]?|rechnung|gleichung|formel|herleiten|lösen|loesen)\b/i.test(text);
  const procedural = /\b(?:procedure|protocol|workflow|step[- ]by[- ]step|perform|technique|method|prozess|verfahren|protokoll|ablauf|durchführen|durchfuehren)\b/i.test(text);
  const conceptual = /\b(?:explain|understand|concept|principle|theory|compare|distinguish|interpret|erklären|erklaeren|verstehen|konzept|prinzip|theorie|vergleichen|unterscheiden|interpretieren)\b/i.test(text);
  const active = [caseBased, quantitative, procedural, conceptual].filter(Boolean).length;
  if (active > 1) return "mixed";
  if (caseBased) return "case_based";
  if (quantitative) return "quantitative";
  if (procedural) return "procedural";
  if (conceptual) return "conceptual";
  if (records.some((record) => record.role === "primary_lecture")) return "mixed";
  return "conceptual";
}

function learningObjectives(title: string, mode: LearningContentMode): string[] {
  switch (mode) {
    case "quantitative":
      return [
        `Apply the quantitative relationships and calculations used in ${title}.`,
        `Interpret and check results for ${title}.`,
      ];
    case "procedural":
      return [
        `Carry out the central procedure for ${title} in the correct sequence.`,
        `Recognize decision points and common errors in ${title}.`,
      ];
    case "case_based":
      return [
        `Analyze a representative case involving ${title}.`,
        `Justify a conclusion using evidence from the case.`,
      ];
    case "mixed":
      return [
        `Explain the central ideas behind ${title}.`,
        `Apply them to calculations, procedures, or cases represented in the course.`,
      ];
    default:
      return [
        `Explain the central concepts and relationships in ${title}.`,
        `Distinguish ${title} from closely related ideas.`,
      ];
  }
}

function assessmentSignals(records: ResourceRecord[]): string[] {
  const roles = new Set(records.map((record) => record.role));
  const text = records.map(resourceText).join(" ");
  const signals: string[] = [];
  if (roles.has("sample_exam") || /\b(?:sample|past|mock|muster).{0,20}(?:exam|prüfung|pruefung|test)\b/i.test(text)) {
    signals.push("Appears in sample, mock, or past assessment material.");
  }
  if (roles.has("worked_example") || /\b(?:solution|worked\s+example|lösung|loesung|musterlösung|musterloesung)\b/i.test(text)) {
    signals.push("Practiced in worked examples or solutions.");
  }
  if (/\b(?:assignment|exercise|worksheet|quiz|aufgabe|übung|uebung|arbeitsblatt)\b/i.test(text)) {
    signals.push("Practiced in an assignment, exercise, worksheet, or quiz.");
  }
  if (roles.has("primary_lecture")) {
    signals.push("Emphasized in primary teaching material.");
  }
  return uniqueStrings(signals);
}

function groupSupportResources(
  records: ResourceRecord[],
  usedIds: Set<string>,
): LearningSupportResource[] {
  const grouped = new Map<string, ResourceRecord[]>();
  for (const record of records) {
    const key = normalizeForComparison(record.title);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return [...grouped.values()].map((group) => {
    const first = group[0];
    return {
      id: uniqueId(first.title, usedIds),
      title: first.title,
      purpose: first.role === "formula" || /\b(?:formula|formel|symbol)\b/i.test(first.title)
        ? "formula_reference" as const
        : first.role === "external_reference" || /\b(?:reference|nachschlagewerk|handbook|tabellenbuch|lookup)\b/i.test(first.title)
          ? "general_reference" as const
          : "supplementary" as const,
      resourceUrls: uniqueStrings(group.flatMap((record) => record.urls)).sort(),
    };
  }).sort((left, right) => left.title.localeCompare(right.title));
}

function compareModules(left: LearningModule, right: LearningModule): number {
  const rank: Record<LearningPriority, number> = { essential: 0, important: 1, supplementary: 2 };
  return rank[left.priority] - rank[right.priority] || left.title.localeCompare(right.title);
}

function uniqueId(value: string, used: Set<string>): string {
  const base = value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "learning-module";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function resourceText(record: ResourceRecord): string {
  return `${record.title} ${record.topic ?? ""} ${record.sectionTitle ?? ""} ${record.summary}`;
}

function normalizeRole(role: string | null | undefined): string {
  return cleanWhitespace(role ?? "supplementary").toLowerCase().replace(/[ -]+/g, "_");
}

function preferSpecificText(candidate: string | null | undefined, fallback: string): string {
  const normalized = normalizeRole(candidate);
  return normalized === "supplementary" ? fallback : normalized;
}

function nullableText(value: string | null | undefined): string | null {
  const cleaned = cleanWhitespace(value ?? "");
  return cleaned || null;
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForComparison(value: string): string {
  return cleanWhitespace(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validUrls(values: Array<string | null | undefined>): string[] {
  return uniqueStrings(values.filter((value): value is string => {
    if (!value) return false;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
