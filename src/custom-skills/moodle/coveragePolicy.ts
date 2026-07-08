import {
  CoverageAssessmentSchema,
  type CoverageAssessment,
  type EvidencePackage,
  type ResourceManifest,
} from "./examNavigatorContracts.js";
import type { MoodleRuntimeConfig } from "./types.js";

export function assessExamNavigatorCoverage(
  config: MoodleRuntimeConfig,
  manifest: ResourceManifest,
  evidence: EvidencePackage,
): CoverageAssessment {
  const courseKnown = manifest.resources.some((resource) => resource.activityType === "course");
  const deepResources = manifest.resources.filter(isDeepContentResource);
  const acquired = deepResources.filter((resource) => resource.status === "acquired");
  const failed = deepResources.filter((resource) => resource.status === "failed");
  const inaccessible = deepResources.filter((resource) => resource.status !== "acquired");
  const needsDeepMaterial =
    config.intentDecision?.needsCourseMaterial === true &&
    config.intentDecision?.needsDownloadedFiles === true;
  const examScopeRequested = /\b(?:prüfung|pruefung|exam|klausur|prüfungsstoff|pruefungsstoff)\b/i
    .test(config.prompt);
  const examScopeConfirmed = manifest.resources.some(
    (resource) => resource.examRelevance === "confirmed",
  );
  const criticalMissing: string[] = [];
  const retryActions: string[] = [];

  if (!courseKnown && manifest.resources.length > 0) {
    criticalMissing.push("Der Zielkurs konnte nicht eindeutig als Kursressource erfasst werden.");
    retryActions.push("Den direkten Moodle-Kurslink oder den exakten Kursalias angeben.");
  }
  if (evidence.records.length === 0 && manifest.resources.length > 0) {
    criticalMissing.push("Es wurde keine nutzbare fachliche Evidenz extrahiert.");
    retryActions.push("Moodle-Anmeldung, Dateizugriff und Extraktionswerkzeuge prüfen.");
  }
  if (needsDeepMaterial && deepResources.length >= 3 && acquired.length === 0) {
    criticalMissing.push(
      "Es wurden mehrere Fachressourcen entdeckt, aber keine davon wurde erfolgreich geöffnet oder heruntergeladen.",
    );
    retryActions.push(
      "Den Run mit direktem Kurslink erneut starten und Download-/Proxy-Zugriff prüfen.",
    );
  }
  if (
    needsDeepMaterial &&
    deepResources.length >= 4 &&
    inaccessible.length / deepResources.length > 0.5 &&
    acquired.length > 0
  ) {
    criticalMissing.push(
      "Mehr als die Hälfte der für den Auftrag relevanten Fachressourcen ist nicht auswertbar.",
    );
    retryActions.push("Fehlgeschlagene Ressourcen gezielt über ihre Moodle-URLs erneut öffnen.");
  }

  const blocked = criticalMissing.length > 0;
  const partialReasons: string[] = [];
  if (!blocked && inaccessible.length > 0) {
    partialReasons.push(`${inaccessible.length} Fachressource(n) wurden nicht lokal ausgewertet.`);
  }
  if (!blocked && examScopeRequested && !examScopeConfirmed) {
    partialReasons.push(
      "Der Kursstoff ist belegbar, aber eine vollständige offizielle Prüfungsabgrenzung wurde nicht bestätigt.",
    );
  }

  const status = blocked ? "blocked" : partialReasons.length > 0 ? "partial" : "complete";
  return CoverageAssessmentSchema.parse({
    status,
    detail:
      status === "complete"
        ? "Alle für den Auftrag kritischen Quellenrollen sind abgedeckt."
        : status === "partial"
          ? partialReasons.join(" ")
          : criticalMissing.join(" "),
    criticalMissing,
    omittedTopics: omittedTopics(deepResources),
    retryActions,
    discoveredResources: deepResources.length,
    acquiredResources: acquired.length,
    failedResources: failed.length,
    usableEvidenceRecords: evidence.records.length,
  });
}

function isDeepContentResource(resource: ResourceManifest["resources"][number]): boolean {
  if (
    ["resource", "file", "folder", "page", "book", "assignment"].includes(resource.activityType)
  ) {
    return true;
  }
  return /\b(?:foliensatz|angabe|lösung|loesung|aufgabe|rechenbeispiel|skript|pdf)\b/i
    .test(resource.title);
}

function omittedTopics(resources: ResourceManifest["resources"]): string[] {
  const groups = new Map<string, ResourceManifest["resources"]>();
  for (const resource of resources) {
    const topic = resource.sectionPath.at(-1);
    if (!topic) continue;
    groups.set(topic, [...(groups.get(topic) ?? []), resource]);
  }
  return [...groups.entries()]
    .filter(([, topicResources]) =>
      topicResources.length > 0 &&
      topicResources.every((resource) => resource.status !== "acquired")
    )
    .map(([topic]) => topic);
}
