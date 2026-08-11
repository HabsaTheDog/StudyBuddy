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
  const rawDeepResources = scopedResources.filter(isDeepContentResource);
  const selectedResources = rawDeepResources.filter((resource) => resource.selection?.selected === true);
  const plannedDeepResources = selectedResources.length > 0
    ? selectedResources
    : rawDeepResources.filter((resource) => resource.status !== "skipped");
  const acquiredDirectResources = plannedDeepResources.filter((resource) => resource.status === "acquired");
  const deepResources = plannedDeepResources.filter((resource) =>
    !isSatisfiedDirectActivityAlias(config, manifest, resource, acquiredDirectResources)
  );
  const acquired = deepResources.filter((resource) => resource.status === "acquired");
  const usable = acquired.filter(isUsableResource);
  const directResourceKnown = isDirectMoodleLearningResourceUrl(config.moodleUrl) &&
    usable.length > 0 &&
    evidence.records.some((record) =>
      usable.some((resource) => resource.id === record.resourceId)
    );
  const failed = deepResources.filter((resource) => isResourceFailureStatus(resource.status));
  const inaccessible = deepResources.filter((resource) => resource.status !== "acquired");
  const resourceIssues = buildResourceIssues(inaccessible);
  const needsDeepMaterial =
    config.intentDecision?.needsCourseMaterial === true &&
    config.intentDecision?.needsDownloadedFiles === true;
  // German compounds such as "Dynamikprüfung" still request exam scope.
  const examScopeRequested = /(?:prüfung|pruefung|exam|klausur|prüfungsstoff|pruefungsstoff)\b/i
    .test(config.prompt);
  const examScopeConfirmed = manifest.resources.some(
    (resource) => resource.examRelevance === "confirmed",
  );
  const criticalMissing: string[] = [];
  const retryActions: string[] = [];

  if (!courseKnown && !directResourceKnown && manifest.resources.length > 0) {
    criticalMissing.push("Der Zielkurs konnte nicht eindeutig als Kursressource erfasst werden.");
    retryActions.push("Den direkten Moodle-Kurslink oder den exakten Kursalias angeben.");
  }
  if (evidence.records.length === 0 && manifest.resources.length > 0) {
    criticalMissing.push("Es wurde keine nutzbare fachliche Evidenz extrahiert.");
    retryActions.push("Moodle-Anmeldung, Dateizugriff und Extraktionswerkzeuge prüfen.");
  }
  if (needsDeepMaterial && deepResources.length >= 1 && usable.length === 0) {
    criticalMissing.push(
      "Es wurden mehrere Fachressourcen entdeckt, aber keine davon wurde erfolgreich geöffnet oder heruntergeladen.",
    );
    retryActions.push(
      "Den Run mit direktem Kurslink erneut starten und Download-/Proxy-Zugriff prüfen.",
    );
  }
  const missingCriticalTopics = criticalTopics(deepResources).filter((topic) =>
    !usable.some((resource) => resource.selection?.topic === topic)
  );
  if (needsDeepMaterial && missingCriticalTopics.length > 0) {
    criticalMissing.push(`Für kritische Kursthemen fehlt nutzbare Evidenz: ${missingCriticalTopics.join(", ")}.`);
    retryActions.push("Nur die fehlenden Primärquellen der betroffenen Themen gezielt erneut laden.");
  }

  const blocked = criticalMissing.length > 0;
  const partialReasons: string[] = [];
  if (!blocked && inaccessible.length > 0) {
    partialReasons.push(
      `Der Run ist verwendbar: ${usable.length}/${deepResources.length} ausgewählte Fachressourcen liefern nutzbare Evidenz. ` +
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

function isSatisfiedDirectActivityAlias(
  config: MoodleRuntimeConfig,
  manifest: ResourceManifest,
  resource: ResourceManifest["resources"][number],
  acquired: ResourceManifest["resources"],
): boolean {
  if (manifest.courseUrl || !isDirectMoodleLearningResourceUrl(config.moodleUrl)) return false;
  if (resource.status !== "discovered" || acquired.length === 0) return false;
  return canonicalizeResourceUrl(resource.originUrl) === canonicalizeResourceUrl(config.moodleUrl);
}

function isDirectMoodleLearningResourceUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname;
    return pathname.includes("/pluginfile.php/") ||
      /\/mod\/(?:resource|page|book|folder|assign|lesson|url)\/view\.php$/i.test(pathname);
  } catch {
    return false;
  }
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
    // The bounded resource plan is created only after target-course resolution.
    // It is therefore authoritative when later Moodle navigation snapshots have
    // overwritten a resource's immediate parent page.
    if (resource.selection?.selected === true) return true;
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
  const allResources = targetCourseResources(manifest).filter(isDeepContentResource);
  const selected = allResources.filter((resource) => resource.selection?.selected === true);
  const resources = selected.length > 0
    ? selected
    : allResources.filter((resource) => resource.status !== "skipped");
  const acquired = resources.filter((resource) => resource.status === "acquired");
  const usable = acquired.filter(isUsableResource);
  const issues = buildResourceIssues(resources.filter((resource) => resource.status !== "acquired"));
  return {
    detail: issues.length === 0
      ? `${usable.length}/${resources.length} ausgewählte Fachressourcen liefern nutzbare Evidenz.`
      : `Moodle-Seitenzugriff erfolgreich; der Run bleibt verwendbar. ${usable.length}/${resources.length} ausgewählte Fachressourcen liefern nutzbare Evidenz. ${issues.map((issue) => issue.explanation).join(" ")}`,
    partial: issues.length > 0,
    data: {
      courseUrl: manifest.courseUrl,
      discoveredResources: resources.length,
      acquiredResources: acquired.length,
      usableResources: usable.length,
      skippedResources: allResources.filter((resource) => resource.status === "skipped").length,
      resourceIssues: issues,
    },
  };
}

function buildResourceIssues(
  resources: ResourceManifest["resources"],
): NonNullable<CoverageAssessment["resourceIssues"]> {
  const groups = new Map<string, ResourceManifest["resources"]>();
  for (const resource of resources) {
    const key = `${resource.status}:${resource.failureKind ?? "none"}`;
    groups.set(key, [...(groups.get(key) ?? []), resource]);
  }
  return [...groups.values()].map((grouped) => ({
    status: grouped[0].status,
    failureKind: grouped[0].failureKind ?? null,
    count: grouped.length,
    titles: grouped.slice(0, 6).map((resource) => resource.title),
    explanation: explainIssue(grouped[0].status, grouped.length, grouped[0].failureKind),
    retryable: ["transient_failure", "tls_failure"].includes(grouped[0].status),
  }));
}

function explainIssue(
  status: ResourceManifest["resources"][number]["status"],
  count: number,
  failureKind?: ResourceManifest["resources"][number]["failureKind"],
): string {
  const noun = `${count} Ressource${count === 1 ? "" : "n"}`;
  if (failureKind === "client_timeout") return `${noun} überschritten das lokale Download-Zeitbudget.`;
  if (failureKind === "remote_timeout") return `${noun} erhielten innerhalb des Zeitbudgets keine Antwort von der Remote-Quelle.`;
  if (failureKind === "canceled") return `${noun} wurden durch den übergeordneten Run abgebrochen.`;
  if (failureKind === "extraction") return `${noun} wurden geladen, konnten aber nicht in nutzbaren Text extrahiert werden.`;
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
    return "Das CA-Zertifikat der betroffenen Moodle-/Proxy-Instanz konfigurieren und nur diese externen Ressourcen erneut laden.";
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
      topicResources.every((resource) => !isUsableResource(resource))
    )
    .map(([topic]) => topic);
}

function isUsableResource(resource: ResourceManifest["resources"][number]): boolean {
  if (resource.status !== "acquired") return false;
  return resource.extraction?.status !== "unusable";
}

function criticalTopics(resources: ResourceManifest["resources"]): string[] {
  return unique(resources
    .filter((resource) =>
      resource.selection?.role === "primary_lecture" ||
      resource.selection?.role === "external_reference"
    )
    .map((resource) => resource.selection?.topic ?? "")
    .filter(Boolean));
}
