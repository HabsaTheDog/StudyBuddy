import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserSnapshot } from "./agentBrowserClient.js";
import {
  ResourceManifestSchema,
  type ResourceManifest,
  type ResourceNode,
} from "./examNavigatorContracts.js";

export const RESOURCE_MANIFEST_FILE = "source-map.json";

export async function buildResourceManifest(
  runDir: string,
  rawText: string,
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
  await hydrateChecksums(resources);

  const values = [...resources.values()].sort(compareResources);
  const course = values.find((resource) => resource.activityType === "course");
  const manifest = ResourceManifestSchema.parse({
    schemaVersion: "1.0",
    courseUrl: course?.originUrl ?? null,
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
  options: { enabled?: boolean } = {},
): Promise<ResourceManifest> {
  if (options.enabled === false) return manifest;
  const resources = [...manifest.resources];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < resources.length) {
      const index = cursor++;
      const resource = resources[index];
      if (resource.localPath || resource.verifiedAt || !isExternalHttp(resource.originUrl)) {
        continue;
      }
      try {
        const response = await fetch(resource.originUrl, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(6_000),
        });
        const loginRequired = response.status === 401 || response.status === 403;
        resources[index] = {
          ...resource,
          resolvedUrl: response.url || resource.resolvedUrl,
          verifiedAt: response.ok || loginRequired ? new Date().toISOString() : null,
          failureReason: loginRequired
            ? "Login required"
            : response.ok
              ? null
              : `HTTP ${response.status}`,
        };
      } catch (error) {
        resources[index] = {
          ...resource,
          failureReason: `Link check failed: ${error instanceof Error ? error.message : String(error)}`,
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

export function resourcesFromSnapshot(snapshot: AgentBrowserSnapshot): ResourceNode[] {
  const resources: ResourceNode[] = [];
  let sectionPath: string[] = [];
  const originUrl = normalizeUrl(snapshot.origin);
  if (originUrl) {
    resources.push(resourceNode({
      title: courseTitle(snapshot) || "Moodle course",
      originUrl,
      activityType: originUrl.includes("/course/") ? "course" : "moodle_page",
      sectionPath: [],
      parentId: null,
    }));
  }

  for (const line of snapshot.snapshot.split("\n")) {
    const sectionTitle = sectionTitleFromLine(line);
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
    const failureReason =
      /^Download failed(?::\s*)?(.+)?$/m.exec(block)?.[1]?.trim() ??
      /Readable text extraction failed:\s*(.+)$/m.exec(block)?.[1]?.trim() ??
      null;
    resources.set(id, {
      ...current,
      localPath,
      previewPath: localPath,
      status: failureReason ? "failed" : localPath ? "acquired" : current.status,
      verifiedAt: localPath ? new Date().toISOString() : current.verifiedAt,
      failureReason,
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
    sectionPath: incoming.sectionPath.length > 0 ? incoming.sectionPath : current.sectionPath,
    localPath: incoming.localPath ?? current.localPath,
    previewPath: incoming.previewPath ?? current.previewPath,
    resolvedUrl: incoming.resolvedUrl ?? current.resolvedUrl,
    status: statusRank(incoming.status) >= statusRank(current.status) ? incoming.status : current.status,
    failureReason: incoming.failureReason ?? current.failureReason,
  });
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
  if (/^https?:/i.test(url) && !url.includes("moodle.technikum-wien.at")) return "external";
  if (/\b(?:video|youtube)\b/i.test(title)) return "video";
  return "link";
}

function sectionTitleFromLine(line: string): string | null {
  const match = /-\s+(?:button|heading)\s+"([^"]+)"/i.exec(line);
  if (!match) return null;
  const title = cleanTitle(match[1]);
  if (
    !title ||
    /^(?:site-navigation|navigationsleiste|inhalt|kursindex|alles einklappen|nutzermenü)$/i.test(title)
  ) {
    return null;
  }
  if (
    /\b(?:eigenstudium|präsenz|praesenz|information|prüfung|pruefung|literatur|kommunikation)\b/i
      .test(title)
  ) {
    return title;
  }
  return null;
}

function courseTitle(snapshot: AgentBrowserSnapshot): string | null {
  return /heading\s+"(?:Kurs:\s*)?([^"|]+)(?:\s*\||")/i.exec(snapshot.snapshot)?.[1]?.trim() ?? null;
}

function isUtilityUrl(url: string): boolean {
  return /(?:editsection\.php|mailto:|#(?:maincontent|sectionlistfull)?$|\/user\/|\/message\/|\/calendar\/)/i
    .test(url);
}

function isUtilityTitle(title: string): boolean {
  return /^(?:datum setzen|zum hauptinhalt|fhtw moodle|startseite|dashboard|alle anzeigen)$/i
    .test(cleanTitle(title));
}

function cleanTitle(value: string): string {
  return value.replace(/^[\s└|]+/u, "").replace(/\s+/g, " ").trim() || "Unbenannte Ressource";
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of ["time", "forcedownload"]) url.searchParams.delete(key);
    return url.toString();
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
      parsed.hostname !== "moodle.technikum-wien.at"
    );
  } catch {
    return false;
  }
}

function statusRank(status: ResourceNode["status"]): number {
  return { discovered: 0, skipped: 1, failed: 2, acquired: 3 }[status];
}

function compareResources(left: ResourceNode, right: ResourceNode): number {
  return (
    left.sectionPath.join("/").localeCompare(right.sectionPath.join("/"), "de") ||
    left.title.localeCompare(right.title, "de")
  );
}
