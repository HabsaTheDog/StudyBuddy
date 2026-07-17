import {
  CoverageAssessmentSchema,
  type CoverageAssessment,
  type EvidencePackage,
  type ResourceManifest,
} from "./examNavigatorContracts.js";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  canonicalizeResourceUrl,
  isKnownPdfEndpoint,
  isResourceFailureStatus,
} from "./resourceAcquisition.js";
import { stableResourceId } from "./resourceManifest.js";

export function assessExamNavigatorCoverage(
  config: MoodleRuntimeConfig,
  manifest: ResourceManifest,
  evidence: EvidencePackage,
): CoverageAssessment {
  const scopedResources = targetCourseResources(manifest);
  const courseKnown = Boolean(manifest.courseUrl) && scopedResources.some(
    (resource) =>
      resource.activityType === "course" &&
      canonicalizeResourceUrl(resource.originUrl) === canonicalizeResourceUrl(manifest.courseUrl!),
  );
  const deepResources = scopedResources.filter(isDeepContentResource);
  const acquired = deepResources.filter((resource) => resource.status === "acquired");
  const failed = deepResources.filter((resource) => isResourceFailureStatus(resource.status));
  const inaccessible = deepResources.filter((resource) => resource.status !== "acquired");
  const resourceIssues = buildResourceIssues(inaccessible);
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
    partialReasons.push(
      `Der Run ist verwendbar: ${acquired.length}/${deepResources.length} Fachressourcen wurden lokal ausgewertet. ` +
      resourceIssues.map((issue) => issue.explanation).join(" "),
    );
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
    retryActions: unique([
      ...retryActions,
      ...resourceIssues
        .filter((issue) => issue.retryable)
        .map((issue) => retryActionForStatus(issue.status)),
    ]),
    discoveredResources: deepResources.length,
    acquiredResources: acquired.length,
    failedResources: failed.length,
    usableEvidenceRecords: evidence.records.length,
    resourceIssues,
  });
}

function isDeepContentResource(resource: ResourceManifest["resources"][number]): boolean {
  if (isUtilityResource(resource)) return false;
  if (
    ["resource", "file", "folder", "page", "book", "assignment"].includes(resource.activityType)
  ) {
    return true;
  }
  if (resource.activityType === "external" && (
    isKnownPdfEndpoint(resource.originUrl) ||
    /\b(?:seite|pages?)\s+[A-Z]?\d+/i.test(resource.title)
  )) {
    return true;
  }
  return /\b(?:foliensatz|angabe|lösung|loesung|aufgabe|rechenbeispiel|skript|pdf)\b/i
    .test(resource.title);
}

export function targetCourseResources(manifest: ResourceManifest): ResourceManifest["resources"] {
  if (!manifest.courseUrl) return manifest.resources;
  const courseResources = manifest.resources.filter((resource) => resource.activityType === "course");
  if (courseResources.length <= 1) return manifest.resources;
  const targetUrl = canonicalizeResourceUrl(manifest.courseUrl);
  const targetId = stableResourceId(targetUrl);
  return manifest.resources.filter((resource) => {
    if (canonicalizeResourceUrl(resource.originUrl) === targetUrl) return true;
    if (resource.parentId === targetId) return true;
    if (resource.sectionPath.length > 0 && (!resource.parentId || resource.parentId === targetId)) {
      return true;
    }
    return Boolean(resource.localPath && !resource.parentId);
  });
}

export function summarizeManifestAcquisition(manifest: ResourceManifest): {
  detail: string;
  partial: boolean;
  data: Record<string, unknown>;
} {
  const resources = targetCourseResources(manifest).filter(isDeepContentResource);
  const acquired = resources.filter((resource) => resource.status === "acquired");
  const issues = buildResourceIssues(resources.filter((resource) => resource.status !== "acquired"));
  return {
    detail: issues.length === 0
      ? `${acquired.length}/${resources.length} Fachressourcen wurden erfolgreich lokal ausgewertet.`
      : `Moodle-Seitenzugriff erfolgreich; der Run bleibt verwendbar. ${acquired.length}/${resources.length} Fachressourcen wurden lokal ausgewertet. ${issues.map((issue) => issue.explanation).join(" ")}`,
    partial: issues.length > 0,
    data: {
      courseUrl: manifest.courseUrl,
      discoveredResources: resources.length,
      acquiredResources: acquired.length,
      resourceIssues: issues,
    },
  };
}

function buildResourceIssues(
  resources: ResourceManifest["resources"],
): NonNullable<CoverageAssessment["resourceIssues"]> {
  const groups = new Map<ResourceManifest["resources"][number]["status"], ResourceManifest["resources"]>();
  for (const resource of resources) {
    groups.set(resource.status, [...(groups.get(resource.status) ?? []), resource]);
  }
  return [...groups.entries()].map(([status, grouped]) => ({
    status,
    count: grouped.length,
    titles: grouped.slice(0, 6).map((resource) => resource.title),
    explanation: explainIssue(status, grouped.length),
    retryable: ["transient_failure", "tls_failure"].includes(status),
  }));
}

function explainIssue(
  status: ResourceManifest["resources"][number]["status"],
  count: number,
): string {
  const noun = `${count} Ressource${count === 1 ? "" : "n"}`;
  switch (status) {
    case "tls_failure": return `${noun} konnten wegen einer TLS-/Zertifikatsprüfung nicht geladen werden.`;
    case "transient_failure": return `${noun} scheiterten vorübergehend an Timeout, Netzwerk oder Serverantwort.`;
    case "stale": return `${noun} sind veraltete Moodle-Verweise und lieferten keine aktuelle Datei.`;
    case "unauthorized": return `Für ${noun} fehlt die erforderliche Anmeldung oder Berechtigung.`;
    case "not_found": return `${noun} wurden von der Quelle nicht mehr gefunden.`;
    case "unsupported": return `${noun} lieferten einen anderen Inhaltstyp als erwartet.`;
    case "metadata_only": return `${noun} waren erreichbar, wurden aber nur als externe Metadaten erfasst.`;
    case "discovered": return `${noun} wurden erkannt, aber in diesem Run nicht lokal geöffnet.`;
    case "failed": return `${noun} konnten aus einem nicht näher klassifizierten Grund nicht geladen werden.`;
    case "skipped": return `${noun} wurden aufgrund der Aufgaben- oder Sicherheitsregeln übersprungen.`;
    case "acquired": return `${noun} wurden lokal ausgewertet.`;
  }
}

function retryActionForStatus(status: ResourceManifest["resources"][number]["status"]): string {
  if (status === "tls_failure") {
    return "FHTW/HAN-CA-Zertifikat konfigurieren und nur die betroffenen externen Ressourcen erneut laden.";
  }
  return "Vorübergehend fehlgeschlagene Ressourcen mit niedrigerer Parallelität gezielt erneut laden.";
}

function isUtilityResource(resource: ResourceManifest["resources"][number]): boolean {
  return resource.activityType === "page" &&
    resource.sectionPath.length === 0 &&
    /^(?:\?||hilfe|help)$/iu.test(resource.title.trim());
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
