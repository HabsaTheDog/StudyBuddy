import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StudyBuddyExecutionProfile } from "./modelPolicy.js";
import { canonicalizeResourceUrl } from "./resourceAcquisition.js";

export type ResourceRole =
  | "overview"
  | "formula"
  | "primary_lecture"
  | "worked_example"
  | "sample_exam"
  | "administrative"
  | "external_reference"
  | "supplementary";

export interface ResourcePlanningCandidate {
  href: string;
  label: string;
  sectionTitle?: string;
  score: number;
}

export interface PlannedResource<T extends ResourcePlanningCandidate = ResourcePlanningCandidate> {
  candidate: T;
  selected: boolean;
  role: ResourceRole;
  topic: string | null;
  priority: number;
  reason: string;
}

export interface ResourcePlan<T extends ResourcePlanningCandidate = ResourcePlanningCandidate> {
  schemaVersion: 1;
  profile: StudyBuddyExecutionProfile;
  generatedAt: string;
  discovered: number;
  selected: number;
  entries: Array<PlannedResource<T>>;
}

const PROFILE_LIMITS: Record<StudyBuddyExecutionProfile, number> = {
  auto: 16,
  fast: 8,
  balanced: 16,
  quality: 24,
  custom: 16,
};

const EXAMPLES_PER_TOPIC: Record<StudyBuddyExecutionProfile, number> = {
  auto: 1,
  fast: 0,
  balanced: 1,
  quality: 2,
  custom: 1,
};

const PROBE_LIMITS: Record<StudyBuddyExecutionProfile, number> = {
  auto: 5,
  fast: 3,
  balanced: 5,
  quality: 7,
  custom: 5,
};

export function planCourseResources<T extends ResourcePlanningCandidate>(
  candidates: T[],
  profile: StudyBuddyExecutionProfile,
  hardLimit: number,
): ResourcePlan<T> {
  const unique = new Map<string, T>();
  for (const candidate of candidates) {
    const key = canonicalizeResourceUrl(candidate.href);
    const current = unique.get(key);
    if (!current || candidate.score > current.score) unique.set(key, candidate);
  }
  const classified = [...unique.values()].map((candidate) => {
    const role = classifyResourceRole(candidate);
    const topic = classifyResourceTopic(candidate);
    return {
      candidate,
      selected: false,
      role,
      topic,
      priority: rolePriority(role) + candidate.score,
      reason: "Not selected: lower value than the bounded topic/role plan.",
    } satisfies PlannedResource<T>;
  }).sort((left, right) => right.priority - left.priority);

  const limit = Math.max(0, Math.min(hardLimit, PROFILE_LIMITS[profile]));
  const selected = new Set<PlannedResource<T>>();
  const add = (entry: PlannedResource<T>, reason: string) => {
    if (selected.size >= limit || selected.has(entry)) return;
    entry.selected = true;
    entry.reason = reason;
    selected.add(entry);
  };

  for (const role of ["overview", "formula", "sample_exam"] as const) {
    const best = classified.find((entry) => entry.role === role);
    if (best) add(best, `Selected as the primary ${role.replaceAll("_", " ")} source.`);
  }

  const primaryTopics = new Set(
    classified
      .filter((entry) => entry.role === "primary_lecture" && entry.topic)
      .map((entry) => entry.topic!),
  );
  for (const topic of primaryTopics) {
    const best = classified.find((entry) => entry.role === "primary_lecture" && entry.topic === topic);
    if (best) add(best, `Selected as the primary lecture source for ${topic}.`);
  }

  const exampleQuota = EXAMPLES_PER_TOPIC[profile];
  const exampleTopics = new Set(
    classified
      .filter((entry) => entry.role === "worked_example" && entry.topic)
      .map((entry) => entry.topic!),
  );
  for (const topic of exampleTopics) {
    for (const entry of classified
      .filter((candidate) => candidate.role === "worked_example" && candidate.topic === topic)
      .slice(0, exampleQuota)) {
      add(entry, `Selected as a representative worked example for ${topic}.`);
    }
  }

  for (const entry of classified.filter(
    (candidate) =>
      candidate.role !== "external_reference" && candidate.role !== "worked_example",
  )) {
    if (selected.size >= limit) break;
    add(entry, "Selected to complete the bounded course-first source set.");
  }
  for (const entry of classified.filter((candidate) => candidate.role === "external_reference")) {
    if (selected.size >= limit) break;
    const topicAlreadyCovered = entry.topic && [...selected].some((candidate) =>
      candidate.topic === entry.topic && candidate.role !== "worked_example"
    );
    if (!topicAlreadyCovered) add(entry, "Selected because no Moodle source covered this topic.");
  }

  return {
    schemaVersion: 1,
    profile,
    generatedAt: new Date().toISOString(),
    discovered: classified.length,
    selected: selected.size,
    entries: classified,
  };
}

/**
 * Selects a deliberately small, diverse first look at a course. The complete
 * classified candidate list remains in the plan so a later architect pass can
 * request exact resources without crawling Moodle again.
 */
export function planInitialResourceProbe<T extends ResourcePlanningCandidate>(
  candidates: T[],
  profile: StudyBuddyExecutionProfile,
  hardLimit: number,
): ResourcePlan<T> {
  const catalog = planCourseResources(candidates, profile, candidates.length);
  const limit = Math.max(0, Math.min(hardLimit, PROBE_LIMITS[profile]));
  const selected = new Set<PlannedResource<T>>();
  const add = (entry: PlannedResource<T> | undefined, reason: string) => {
    if (!entry || selected.size >= limit || selected.has(entry)) return;
    selected.add(entry);
    entry.selected = true;
    entry.reason = reason;
  };

  for (const entry of catalog.entries) {
    entry.selected = false;
    entry.reason = "Cataloged for possible targeted acquisition after the initial probe.";
  }
  for (const role of ["overview", "primary_lecture", "formula", "sample_exam"] as const) {
    add(
      catalog.entries.find((entry) => entry.role === role),
      `Selected for the initial probe as a representative ${role.replaceAll("_", " ")} source.`,
    );
  }
  const representedSections = new Set(
    [...selected].map((entry) => normalizeSection(entry.candidate.sectionTitle)).filter(Boolean),
  );
  for (const entry of catalog.entries) {
    const section = normalizeSection(entry.candidate.sectionTitle);
    if (section && !representedSections.has(section)) {
      add(entry, `Selected for the initial probe to represent the course section ${entry.candidate.sectionTitle}.`);
      representedSections.add(section);
    }
  }
  for (const entry of catalog.entries) {
    add(entry, "Selected to complete the bounded initial course probe.");
  }

  return {
    ...catalog,
    selected: selected.size,
  };
}

export async function writeResourcePlan<T extends ResourcePlanningCandidate>(
  runDir: string,
  plan: ResourcePlan<T>,
): Promise<string> {
  const filePath = path.join(runDir, "resource-plan.json");
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const next = {
    ...plan,
    entries: plan.entries.map(({ candidate, ...entry }) => ({
      ...entry,
      href: candidate.href,
      label: candidate.label,
      sectionTitle: candidate.sectionTitle ?? null,
      score: candidate.score,
    })),
  };
  const previous = await readExistingPlan(filePath);
  const serializable = previous ? mergeSerializablePlans(previous, next) : next;
  await writeFile(temporaryPath, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
  await writeCatalog(runDir, serializable);
  return filePath;
}

export async function selectCatalogResources(
  runDir: string,
  urls: string[],
  reason: string,
): Promise<string[]> {
  const filePath = path.join(runDir, "resource-plan.json");
  const plan = await readExistingPlan(filePath);
  if (!plan) return [];
  const requested = new Set(urls.map(canonicalizeResourceUrl));
  const selected: string[] = [];
  for (const entry of plan.entries) {
    if (!requested.has(canonicalizeResourceUrl(entry.href))) continue;
    entry.selected = true;
    entry.reason = reason;
    selected.push(entry.href);
  }
  plan.selected = plan.entries.filter((entry) => entry.selected).length;
  plan.generatedAt = new Date().toISOString();
  await atomicWriteJson(filePath, plan);
  await writeCatalog(runDir, plan);
  return selected;
}

async function readExistingPlan(filePath: string): Promise<SerializableResourcePlan | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as SerializableResourcePlan;
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}

interface SerializablePlanEntry {
  href: string;
  label: string;
  sectionTitle: string | null;
  score: number;
  selected: boolean;
  role: ResourceRole;
  topic: string | null;
  priority: number;
  reason: string;
}

interface SerializableResourcePlan {
  schemaVersion: 1;
  profile: StudyBuddyExecutionProfile;
  generatedAt: string;
  discovered: number;
  selected: number;
  entries: SerializablePlanEntry[];
}

async function writeCatalog(runDir: string, plan: SerializableResourcePlan): Promise<void> {
  await atomicWriteJson(path.join(runDir, "resource-catalog.json"), {
    schemaVersion: 1,
    generatedAt: plan.generatedAt,
    profile: plan.profile,
    discovered: plan.discovered,
    initiallySelected: plan.entries.filter((entry) => entry.selected).length,
    entries: plan.entries,
  });
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function mergeSerializablePlans(
  previous: SerializableResourcePlan,
  next: SerializableResourcePlan,
): SerializableResourcePlan {
  const entries = new Map<string, SerializablePlanEntry>();
  for (const entry of [...previous.entries, ...next.entries]) {
    const key = canonicalizeResourceUrl(entry.href);
    const current = entries.get(key);
    if (!current || entry.selected || !current.selected) entries.set(key, entry);
  }
  const mergedEntries = [...entries.values()];
  return {
    schemaVersion: 1,
    profile: next.profile,
    generatedAt: next.generatedAt,
    discovered: mergedEntries.length,
    selected: mergedEntries.filter((entry) => entry.selected).length,
    entries: mergedEntries,
  };
}

export function classifyResourceRole(candidate: Pick<ResourcePlanningCandidate, "href" | "label" | "sectionTitle">): ResourceRole {
  try {
    if (new URL(candidate.href).hostname !== "moodle.technikum-wien.at") return "external_reference";
  } catch {
    return "supplementary";
  }
  const text = `${candidate.sectionTitle ?? ""} ${candidate.label} ${decodePath(candidate.href)}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (/(?:formelsammlung|formelblatt|formula sheet|formulas?)/.test(text)) return "formula";
  if (/(?:musterpr[uü]fung|alteprfg|sample exam|probepr[uü]fung|klausur)/.test(text)) return "sample_exam";
  if (/(?:zusammenfassung|zentrale aspekte|overview|summary|skript)/.test(text)) return "overview";
  if (/(?:folien|slides?|vorlesung|lecture)/.test(text) || /(?:^|[/\s])ad\s?\d/i.test(text)) {
    return "primary_lecture";
  }
  if (/(?:beispiel|rechenbeispiel|[uü]bung|exercise|solution|l[oö]sung)/.test(text)) {
    return "worked_example";
  }
  if (/(?:allgemeines|organisation|administrativ|lv.?info|pr[uü]fungsordnung)/.test(text)) {
    return "administrative";
  }
  return "supplementary";
}

export function classifyResourceTopic(candidate: Pick<ResourcePlanningCandidate, "href" | "label" | "sectionTitle">): string | null {
  const text = `${candidate.sectionTitle ?? ""} ${candidate.label} ${decodePath(candidate.href)}`.toLowerCase();
  const topics: Array<[RegExp, string]> = [
    [/punktkinematik|schiefer.?wurf|bremsweg|schraubenlinie|h[uü]lse/, "Punktkinematik"],
    [/vektorkinematik|kopplung|scheibe.?in.?zylinder|gerader.?stab/, "Vektorkinematik"],
    [/schwerpunktsatz|schwerpunkt|flaschenzug|rohrkr[uü]mmer|gleitende.?bl[oö]cke/, "Schwerpunktsatz"],
    [/drallsatz|drehimpuls|bandbremse|kegelbahn|kugel.?auf.?zylinder|initialbeschleunigung/, "Drallsatz"],
    [/schwingung|pendel|metronom|feder|schwungscheibe|schaukel/, "Schwingungen"],
  ];
  return topics.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function rolePriority(role: ResourceRole): number {
  return {
    overview: 1_000,
    formula: 950,
    primary_lecture: 900,
    sample_exam: 850,
    worked_example: 600,
    administrative: 250,
    supplementary: 150,
    external_reference: 50,
  }[role];
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value;
  }
}

function normalizeSection(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
