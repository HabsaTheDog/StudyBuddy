import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserSnapshot } from "./agentBrowserClient.js";
import {
  ResourceManifestSchema,
  type ResourceManifest,
  type ResourceNode,
} from "./examNavigatorContracts.js";
import {
  canonicalizeResourceUrl,
  classifyResourceFailure,
  resourceLocators,
} from "./resourceAcquisition.js";
import { assertPublicHttpsUrl } from "./urlSecurity.js";
import { isLikelyMoodleUrl } from "./moodleSite.js";

export const RESOURCE_MANIFEST_FILE = "source-map.json";

export async function buildResourceManifest(
  runDir: string,
  rawText: string,
  options: { preferredCourseUrls?: string[] } = {},
): Promise<ResourceManifest> {
  const resources = new Map<string, ResourceNode>();
  const snapshotFiles = await findSnapshotFiles(runDir);
  for (const snapshotFile of snapshotFiles) {
    const snapshot = await readSnapshot(snapshotFile);
    if (!snapshot) continue;
    for (const resource of resourcesFromSnapshot(snapshot)) {
      mergeResource(resources, resource);
    }
  }
  for (const resource of resourcesFromRawText(rawText)) {
    mergeResource(resources, resource);
  }
  applyAcquisitionResults(resources, rawText);
  await applyResourcePlan(resources, runDir);
  await hydrateChecksums(resources);

  const values = [...resources.values()].sort(compareResources);
  const courseUrl = selectCourseUrl(values, rawText, options.preferredCourseUrls ?? []);
  const manifest = ResourceManifestSchema.parse({
    schemaVersion: "1.0",
    courseUrl,
    generatedAt: new Date().toISOString(),
    resources: values,
  });
  await writeFile(
    path.join(runDir, RESOURCE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

async function applyResourcePlan(resources: Map<string, ResourceNode>, runDir: string): Promise<void> {
  const plan = await readFile(path.join(runDir, "resource-plan.json"), "utf8")
    .then((text) => JSON.parse(text) as {
      entries?: Array<{
        href?: string;
        selected?: boolean;
        role?: string;
        topic?: string | null;
        priority?: number;
        reason?: string;
      }>;
    })
    .catch(() => null);
  for (const entry of plan?.entries ?? []) {
    if (!entry.href || typeof entry.selected !== "boolean" || !entry.role || !entry.reason) continue;
    const id = stableResourceId(entry.href);
    const current = resources.get(id);
    if (!current) continue;
    resources.set(id, {
      ...current,
      selection: {
        selected: entry.selected,
        role: entry.role as NonNullable<ResourceNode["selection"]>["role"],
        topic: entry.topic ?? null,
        priority: entry.priority ?? 0,
        reason: entry.reason,
      },
      status: !entry.selected && current.status === "discovered" ? "skipped" : current.status,
      acquisition: !entry.selected && !current.acquisition
        ? {
            status: "skipped",
            transport: null,
            attempts: 0,
            bytes: null,
            durationMs: null,
          }
        : current.acquisition,
    });
  }
}

async function hydrateChecksums(resources: Map<string, ResourceNode>): Promise<void> {
  await Promise.all([...resources.entries()].map(async ([id, resource]) => {
    if (!resource.localPath) return;
    try {
      const contents = await readFile(resource.localPath);
      resources.set(id, {
        ...resource,
        checksum: createHash("sha256").update(contents).digest("hex"),
      });
    } catch {
      // Acquisition status and failure details remain the source of truth.
    }
  }));
}

export async function readResourceManifest(runDir: string): Promise<ResourceManifest> {
  const text = await readFile(path.join(runDir, RESOURCE_MANIFEST_FILE), "utf8");
  return ResourceManifestSchema.parse(JSON.parse(text));
}

export async function verifyResourceLinks(
  manifest: ResourceManifest,
  options: {
    enabled?: boolean;
    fetchImpl?: typeof fetch;
    resolveHostname?: (hostname: string) => Promise<string[]>;
    maxRedirects?: number;
  } = {},
): Promise<ResourceManifest> {
  if (options.enabled === false) return manifest;
  const resources = [...manifest.resources];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < resources.length) {
      const index = cursor++;
      const resource = resources[index];
      if (
        resource.localPath ||
        resource.verifiedAt ||
        resource.status !== "discovered" ||
        !isExternalHttp(resource.originUrl)
      ) {
        continue;
      }
      try {
        const { response, resolvedUrl } = await fetchVerifiedHead(resource.originUrl, options);
        const loginRequired = response.status === 401 || response.status === 403;
        const notFound = response.status === 404;
        const serverFailure = response.status >= 500;
        resources[index] = {
          ...resource,
          resolvedUrl,
          status: response.ok
            ? "metadata_only"
            : loginRequired
              ? "unauthorized"
              : notFound
                ? "not_found"
                : serverFailure
                  ? "transient_failure"
                  : "failed",
          verifiedAt: response.ok ? new Date().toISOString() : null,
          failureReason: loginRequired
            ? "Login required"
            : notFound
              ? "HTTP 404"
            : response.ok
              ? null
              : `HTTP ${response.status}`,
          failureKind: loginRequired
            ? "auth"
            : notFound
              ? "not_found"
              : serverFailure
                ? "http"
                : response.ok
                  ? null
                  : "http",
          recommendedAction: loginRequired
            ? "Anmeldung oder Berechtigung für diese externe Quelle prüfen."
            : notFound
              ? "Im aktuellen Kurs nach einer Ersatzressource suchen."
              : serverFailure
                ? "Serverfehler später mit Backoff erneut versuchen."
                : response.ok
                  ? null
                  : "HTTP-Antwort der externen Quelle prüfen.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const classification = classifyResourceFailure(message, {
          requestedUrl: resource.originUrl,
        });
        const blockedByUrlPolicy = /must use HTTPS|private network address|embedded credentials/i.test(message);
        resources[index] = {
          ...resource,
          status: blockedByUrlPolicy ? "failed" : classification.status,
          failureReason: `Link check failed: ${message}`,
          failureKind: blockedByUrlPolicy ? "unsupported" : classification.failureKind,
          recommendedAction: blockedByUrlPolicy
            ? "Only public HTTPS links without embedded credentials can be checked."
            : classification.recommendedAction,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, resources.length) }, () => worker()));
  return ResourceManifestSchema.parse({
    ...manifest,
    generatedAt: new Date().toISOString(),
    resources,
  });
}

async function fetchVerifiedHead(
  originUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    resolveHostname?: (hostname: string) => Promise<string[]>;
    maxRedirects?: number;
  },
): Promise<{ response: Response; resolvedUrl: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? 3, 10));
  let currentUrl = originUrl;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertPublicHttpsUrl(currentUrl, options.resolveHostname);
    const response = await fetchImpl(currentUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(6_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, resolvedUrl: currentUrl };
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error(`HTTP ${response.status} redirect did not include a Location header.`);
    if (redirects === maxRedirects) throw new Error(`Link check exceeded ${maxRedirects} redirects.`);
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error("Link check exceeded its redirect limit.");
}

export function resourcesFromSnapshot(snapshot: AgentBrowserSnapshot): ResourceNode[] {
  const resources: ResourceNode[] = [];
  let sectionPath: string[] = [];
  const originUrl = normalizeUrl(snapshot.origin);
  const snapshotCourseTitle = courseTitle(snapshot);
  if (originUrl) {
    resources.push(resourceNode({
      title: snapshotCourseTitle || "Moodle course",
      originUrl,
      activityType: originUrl.includes("/course/") ? "course" : "moodle_page",
      sectionPath: [],
      parentId: null,
    }));
  }

  for (const line of snapshot.snapshot.split("\n")) {
    const sectionTitle = sectionTitleFromLine(line, snapshotCourseTitle);
    if (sectionTitle) {
      sectionPath = [sectionTitle];
    }
    const href = /url=([^\]\s]+)/i.exec(line)?.[1];
    if (!href) continue;
    const normalized = normalizeUrl(href);
    if (!normalized || isUtilityUrl(normalized)) continue;
    const ref = /ref=([a-z0-9_-]+)/i.exec(line)?.[1] ?? "";
    const title =
      snapshot.refs[ref]?.name?.trim() ||
      /"([^"]+)"/.exec(line)?.[1]?.trim() ||
      normalized;
    if (!title || isUtilityTitle(title)) continue;
    const activityType = classifyActivity(normalized, title);
    const parentId =
      activityType === "course" || !originUrl
        ? null
        : stableResourceId(originUrl);
    resources.push(resourceNode({
      title,
      originUrl: normalized,
      sourceUrl: href,
      activityType,
      sectionPath,
      parentId,
    }));
  }
  return deduplicateResources(resources);
}

export function stableResourceId(url: string): string {
  return `res_${createHash("sha256").update(normalizeUrl(url) || url).digest("hex").slice(0, 16)}`;
}

function resourcesFromRawText(rawText: string): ResourceNode[] {
  const resources: ResourceNode[] = [];
  const blocks = rawText.split(/\n(?=\[(?:Moodle page|Linked file)\])/g);
  for (const block of blocks) {
    const url = /^URL:\s*(\S+)/m.exec(block)?.[1];
    if (!url) continue;
    const normalized = normalizeUrl(url);
    if (!normalized) continue;
    const title = /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim() || normalized;
    resources.push(resourceNode({
      title,
      originUrl: normalized,
      activityType: block.startsWith("[Linked file]")
        ? classifyActivity(normalized, title)
        : classifyActivity(normalized, title),
      sectionPath: [],
      parentId: null,
    }));
  }
  return resources;
}

function applyAcquisitionResults(resources: Map<string, ResourceNode>, rawText: string): void {
  const blocks = rawText.split(/\n(?=\[Linked file\])/g);
  for (const block of blocks) {
    if (!block.startsWith("[Linked file]")) continue;
    const url = /^URL:\s*(\S+)/m.exec(block)?.[1];
    if (!url) continue;
    const id = stableResourceId(url);
    const current = resources.get(id) ?? resourceNode({
      title: /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim() || url,
      originUrl: url,
      activityType: classifyActivity(url, block),
      sectionPath: [],
      parentId: null,
    });
    const localPath = /^Saved path:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    const explicitStatus = /^Resource status:\s*(\S+)$/m.exec(block)?.[1]?.trim() as ResourceNode["status"] | undefined;
    const explicitFailureKind = /^Failure kind:\s*(\S+)$/m.exec(block)?.[1]?.trim() as NonNullable<ResourceNode["failureKind"]> | undefined;
    const resolvedUrl = /^Resolved URL:\s*(\S+)$/m.exec(block)?.[1]?.trim() ?? null;
    const contentType = /^Content-Type:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    const recommendedAction = /^Suggested action:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    const selectionStatus = /^Selection:\s*(selected|skipped)$/m.exec(block)?.[1]?.trim();
    const selectionRole = /^Resource role:\s*(\S+)$/m.exec(block)?.[1]?.trim();
    const selectionTopic = /^Resource topic:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    const selectionPriority = numberMetadata(block, "Resource priority");
    const selectionReason = /^Selection reason:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const acquisitionStatus = /^Acquisition status:\s*(\S+)$/m.exec(block)?.[1]?.trim();
    const acquisitionTransport = /^Acquisition transport:\s*(\S+)$/m.exec(block)?.[1]?.trim();
    const extractionStatus = /^Extraction status:\s*(\S+)$/m.exec(block)?.[1]?.trim();
    const extractionMethod = /^Extraction method:\s*(\S+)$/m.exec(block)?.[1]?.trim();
    const extractionWarnings = /^Extraction warnings:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const failureReason =
      /^Download failed(?::\s*)?(.+)?$/m.exec(block)?.[1]?.trim() ??
      /Readable text extraction failed:\s*(.+)$/m.exec(block)?.[1]?.trim() ??
      null;
    const classification = failureReason
      ? classifyResourceFailure(failureReason, { requestedUrl: url })
      : null;
    resources.set(id, {
      ...current,
      localPath,
      previewPath: localPath,
      resolvedUrl: resolvedUrl ?? current.resolvedUrl,
      status: localPath
        ? "acquired"
        : explicitStatus ?? classification?.status ?? current.status,
      verifiedAt: localPath ? new Date().toISOString() : current.verifiedAt,
      failureReason,
      canonicalUrl: canonicalizeResourceUrl(url),
      locators: uniqueStrings([...(current.locators ?? []), ...resourceLocators(current.title, url)]),
      contentType: contentType ?? current.contentType,
      failureKind: explicitFailureKind ?? classification?.failureKind ?? current.failureKind,
      recommendedAction:
        recommendedAction ?? classification?.recommendedAction ?? current.recommendedAction,
      selection: selectionStatus && selectionRole && selectionReason
        ? {
            selected: selectionStatus === "selected",
            role: selectionRole as NonNullable<ResourceNode["selection"]>["role"],
            topic: selectionTopic === "none" ? null : selectionTopic,
            priority: selectionPriority ?? 0,
            reason: selectionReason,
          }
        : current.selection,
      acquisition: acquisitionStatus
        ? {
            status: acquisitionStatus as NonNullable<ResourceNode["acquisition"]>["status"],
            transport: acquisitionTransport && acquisitionTransport !== "none"
              ? acquisitionTransport as NonNullable<ResourceNode["acquisition"]>["transport"]
              : null,
            attempts: numberMetadata(block, "Acquisition attempts") ?? 0,
            bytes: numberMetadata(block, "Acquisition bytes"),
            durationMs: numberMetadata(block, "Acquisition duration ms"),
          }
        : current.acquisition,
      extraction: extractionStatus && extractionMethod
        ? {
            status: extractionStatus as NonNullable<ResourceNode["extraction"]>["status"],
            method: extractionMethod as NonNullable<ResourceNode["extraction"]>["method"],
            characterCount: numberMetadata(block, "Extraction characters") ?? 0,
            pageCount: numberMetadata(block, "Extraction pages"),
            warnings: extractionWarnings && extractionWarnings !== "none"
              ? extractionWarnings.split(" | ").map((value) => value.trim()).filter(Boolean)
              : [],
          }
        : current.extraction,
    });
  }
}

async function findSnapshotFiles(runDir: string): Promise<string[]> {
  const candidates: string[] = [];
  for (const directory of [path.join(runDir, "sources"), path.join(runDir, "diagnostics")]) {
    const directoryStat = await stat(directory).catch(() => null);
    if (!directoryStat?.isDirectory()) continue;
    const entries = await readdir(directory, { recursive: true });
    for (const entry of entries) {
      if (String(entry).endsWith(".json")) {
        candidates.push(path.join(directory, String(entry)));
      }
    }
  }
  return candidates;
}

async function readSnapshot(filePath: string): Promise<AgentBrowserSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<AgentBrowserSnapshot>;
    return typeof parsed.origin === "string" &&
      typeof parsed.snapshot === "string" &&
      parsed.refs &&
      typeof parsed.refs === "object"
      ? parsed as AgentBrowserSnapshot
      : null;
  } catch {
    return null;
  }
}

function resourceNode(input: {
  title: string;
  originUrl: string;
  sourceUrl?: string;
  activityType: string;
  sectionPath: string[];
  parentId: string | null;
}): ResourceNode {
  const originUrl = normalizeUrl(input.originUrl) || input.originUrl;
  const sectionText = input.sectionPath.join(" ");
  return {
    id: stableResourceId(originUrl),
    parentId: input.parentId,
    sectionPath: [...input.sectionPath],
    activityType: input.activityType,
    title: cleanTitle(input.title),
    originUrl,
    resolvedUrl: null,
    localPath: null,
    previewPath: null,
    status: "discovered",
    checksum: null,
    verifiedAt: null,
    examRelevance:
      /\b(?:prüfung|pruefung|exam|theorie-test|test\s*\d+)\b/i.test(`${sectionText} ${input.title}`)
        ? "inferred"
        : "unknown",
    failureReason: null,
    canonicalUrl: canonicalizeResourceUrl(originUrl),
    locators: resourceLocators(input.title, input.sourceUrl ?? input.originUrl),
    contentType: null,
    failureKind: null,
    recommendedAction: null,
  };
}

function mergeResource(resources: Map<string, ResourceNode>, incoming: ResourceNode): void {
  const current = resources.get(incoming.id);
  if (!current) {
    resources.set(incoming.id, incoming);
    return;
  }
  resources.set(incoming.id, {
    ...current,
    ...incoming,
    parentId: incoming.parentId ?? current.parentId,
    title: isGenericResourceTitle(current.title) ? incoming.title : current.title,
    sectionPath: incoming.sectionPath.length > 0 ? incoming.sectionPath : current.sectionPath,
    localPath: incoming.localPath ?? current.localPath,
    previewPath: incoming.previewPath ?? current.previewPath,
    resolvedUrl: incoming.resolvedUrl ?? current.resolvedUrl,
    status: statusRank(incoming.status) >= statusRank(current.status) ? incoming.status : current.status,
    failureReason: incoming.failureReason ?? current.failureReason,
    canonicalUrl: incoming.canonicalUrl ?? current.canonicalUrl,
    locators: uniqueStrings([...(current.locators ?? []), ...(incoming.locators ?? [])]),
    contentType: incoming.contentType ?? current.contentType,
    failureKind: incoming.failureKind ?? current.failureKind,
    recommendedAction: incoming.recommendedAction ?? current.recommendedAction,
    selection: incoming.selection ?? current.selection,
    acquisition: incoming.acquisition ?? current.acquisition,
    extraction: incoming.extraction ?? current.extraction,
  });
}

function numberMetadata(block: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(\\d+)$`, "m").exec(block);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function deduplicateResources(resources: ResourceNode[]): ResourceNode[] {
  const result = new Map<string, ResourceNode>();
  for (const resource of resources) mergeResource(result, resource);
  return [...result.values()];
}

function classifyActivity(url: string, title: string): string {
  const pathname = safePathname(url);
  if (pathname.includes("/course/view.php")) return "course";
  if (pathname.includes("/course/section.php")) return "section";
  if (pathname.includes("/mod/resource/") || pathname.includes("/pluginfile.php")) return "resource";
  if (pathname.includes("/mod/folder/")) return "folder";
  if (pathname.includes("/mod/page/")) return "page";
  if (pathname.includes("/mod/book/")) return "book";
  if (pathname.includes("/mod/url/")) return "url";
  if (pathname.includes("/mod/assign/")) return "assignment";
  if (pathname.includes("/mod/forum/")) return "forum";
  if (pathname.includes("/mod/quiz/")) return "quiz";
  if (/\.(?:pdf|docx?|pptx?|xlsx?|zip)(?:$|[?#])/i.test(url)) return "file";
  if (/^https?:/i.test(url) && !isLikelyMoodleUrl(url)) return "external";
  if (/\b(?:video|youtube)\b/i.test(title)) return "video";
  return "link";
}

function sectionTitleFromLine(line: string, currentCourseTitle: string | null): string | null {
  const match = /-\s+(?:button|heading)\s+"([^"]+)"/i.exec(line);
  if (!match) return null;
  const title = cleanTitle(match[1]);
  const normalized = title.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const normalizedCourseTitle = currentCourseTitle?.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  if (
    !title ||
    title.length > 180 ||
    normalized === normalizedCourseTitle ||
    /^(?:course|kurs)\s*:/i.test(title) ||
    /^(?:site-navigation|navigation|primary navigation|secondary navigation|navigationsleiste|contents?|inhalt|course index|kursindex|collapse all|expand all|alles einklappen|alles ausklappen|user menu|nutzermenü|main menu|hauptmenü|hauptmenue|breadcrumbs?|search|suche|notifications?|benachrichtigungen?)$/i.test(title)
  ) {
    return null;
  }
  // Moodle themes expose course sections as either buttons or headings. Keep
  // their actual labels instead of requiring institution-specific German
  // keywords such as "Eigenstudium" or "Präsenz".
  return title;
}

function courseTitle(snapshot: AgentBrowserSnapshot): string | null {
  return /heading\s+"(?:Kurs:\s*)?([^"|]+)(?:\s*\||")/i.exec(snapshot.snapshot)?.[1]?.trim() ?? null;
}

function isUtilityUrl(url: string): boolean {
  return /(?:editsection\.php|mailto:|#(?:maincontent|sectionlistfull)?$|\/user\/|\/message\/|\/calendar\/)/i
    .test(url);
}

function isUtilityTitle(title: string): boolean {
  return /^(?:datum setzen|zum hauptinhalt|skip to main content|startseite|home|dashboard|alle anzeigen|show all|(?:[\p{L}\p{N}&' -]+\s+)?moodle(?:\s+site)?)$/iu
    .test(cleanTitle(title));
}

function cleanTitle(value: string): string {
  return value.replace(/^[\s└|]+/u, "").replace(/\s+/g, " ").trim() || "Unbenannte Ressource";
}

function normalizeUrl(value: string): string | null {
  try {
    return canonicalizeResourceUrl(value);
  } catch {
    return null;
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function isExternalHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !isLikelyMoodleUrl(parsed.toString())
    );
  } catch {
    return false;
  }
}

function statusRank(status: ResourceNode["status"]): number {
  return {
    discovered: 0,
    metadata_only: 1,
    skipped: 1,
    transient_failure: 2,
    tls_failure: 2,
    failed: 2,
    unsupported: 2,
    unauthorized: 2,
    not_found: 2,
    stale: 2,
    acquired: 3,
  }[status];
}

function selectCourseUrl(
  resources: ResourceNode[],
  rawText: string,
  preferredCourseUrls: string[],
): string | null {
  const courses = resources.filter((resource) => resource.activityType === "course");
  for (const preferredUrl of preferredCourseUrls.map(canonicalizeResourceUrl)) {
    const explicit = courses.find(
      (resource) => canonicalizeResourceUrl(resource.originUrl) === preferredUrl,
    );
    if (explicit) return explicit.originUrl;
  }

  const pageUrls = [...rawText.matchAll(/^URL:\s*(https?:\/\/\S*\/course\/view\.php\?\S+)$/gm)]
    .map((match) => canonicalizeResourceUrl(match[1]));
  for (const pageUrl of pageUrls.reverse()) {
    const matched = courses.find((resource) => canonicalizeResourceUrl(resource.originUrl) === pageUrl);
    if (matched) return matched.originUrl;
  }
  return courses.find((resource) => resource.sectionPath.length > 0)?.originUrl ??
    courses.at(-1)?.originUrl ??
    null;
}

function isGenericResourceTitle(title: string): boolean {
  return /^https?:\/\//i.test(title) || /^(?:Moodle course|Unbenannte Ressource)$/i.test(title);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function compareResources(left: ResourceNode, right: ResourceNode): number {
  return (
    left.sectionPath.join("/").localeCompare(right.sectionPath.join("/"), "de") ||
    left.title.localeCompare(right.title, "de")
  );
}
