import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import path from "node:path";
import { stableResourceId } from "./resourceManifest.js";
import { assertPublicHttpsUrl } from "./urlSecurity.js";
import { resolveStudyBuddyWorkspaceDataPaths } from "../shared/workspaceData.js";

export interface DirectSourceLink { title: string; url: string; section?: string }
export interface DirectSourceRecord extends DirectSourceLink {
  id: string; resolvedUrl?: string; textPath?: string; localPath?: string; sha256?: string;
  pageCount?: number | null; readability?: string; pages?: Array<{ page: number; path: string; sha256: string }>;
}
export type DirectSourceRequest = { op: "courses"; query?: string } | { op: "page"; url: string } |
  { op: "download"; url?: string; sourceID?: string; resourceID?: string; title?: string } |
  { op: "text"; sourceID: string; pages?: number[] } | { op: "pages"; sourceID: string; pages: number[] };
export interface DirectSourceBackend {
  courses(): Promise<{ links: DirectSourceLink[]; complete: boolean }>;
  page(url: string): Promise<{ title: string; url: string; text: string; links: DirectSourceLink[] }>;
  download(url: string, directory: string, id: string): Promise<{ path: string; resolvedUrl: string }>;
  text(file: string): Promise<{ text: string; pageCount: number | null; status: string }>;
  pages(file: string, pages: number[], directory: string): Promise<Array<{ page: number; path: string }>>;
}
export function assertDirectReadUrl(value: string, origins: readonly string[]) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !origins.includes(url.origin)) throw new Error("Source URL is outside configured HTTPS portal origins.");
  if ((url.pathname.startsWith("/mod/quiz/") && url.pathname !== "/mod/quiz/view.php") ||
      /(?:^|\/)(?:attempt|review|processattempt|submit|save|delete|logout|post|edit|(?:un)?enrol)[a-z_-]*\.(?:php|aspx)$/i.test(url.pathname) ||
      url.searchParams.has("sesskey") || [...url.searchParams.entries()].some(([key, value]) => /^(?:action|do|mode)$/i.test(key) && /^(?:submit|save|delete|edit|enrol|start|attempt|finish|logout)$/i.test(value))) throw new Error("Source adapter permits read-only metadata, never quiz attempts/reviews or mutations.");
  return url.toString();
}
function pageNumbers(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 12 || value.some(page => !Number.isSafeInteger(page) || page < 1) || new Set(value).size !== value.length) throw new Error("pages must contain one to twelve distinct positive page numbers.");
  return value;
}
export function parseDirectSourceRequest(value: unknown): DirectSourceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Source request must be one JSON object.");
  const r = value as Record<string, unknown>;
  const allowed = { courses: ["op", "query"], page: ["op", "url"], download: ["op", "url", "sourceID", "resourceID", "title"], text: ["op", "sourceID", "pages"], pages: ["op", "sourceID", "pages"] };
  if (typeof r.op !== "string" || !Object.hasOwn(allowed, r.op) || Object.keys(r).some(key => !allowed[r.op as keyof typeof allowed].includes(key))) throw new Error("Unknown source operation or argument.");
  for (const key of ["url", "query", "sourceID", "resourceID", "path", "title"]) if (r[key] !== undefined && (typeof r[key] !== "string" || !(r[key] as string).trim())) throw new Error(`Invalid ${key}.`);
  if (r.op === "page" && !r.url || r.op === "download" && Number(Boolean(r.url)) + Number(Boolean(r.sourceID)) + Number(Boolean(r.resourceID)) !== 1 || (r.op === "text" || r.op === "pages") && !r.sourceID) throw new Error("Exactly one required source target is needed.");
  if (r.pages !== undefined) pageNumbers(r.pages);
  if (r.op === "pages" && r.pages === undefined) throw new Error("Explicit page numbers are required.");
  return r as unknown as DirectSourceRequest;
}
export function directSourcesRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStudyBuddyWorkspaceDataPaths({ ...env, STUDY_BUDDY_THREAD_ID: env.STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID || env.STUDY_BUDDY_THREAD_ID }).threadRoot, "direct-sources");
}
const recordSchema = z.object({ id: z.string().regex(/^res_[a-f0-9]{16}$/), title: z.string(), url: z.string().url(), section: z.string().optional(), resolvedUrl: z.string().url().optional(), textPath: z.string().optional(), localPath: z.string().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), pageCount: z.number().int().positive().nullable().optional(), readability: z.string().optional(), pages: z.array(z.object({ page: z.number().int().positive(), path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).optional() }).strict();
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
export class DirectSources {
  constructor(readonly root: string, readonly origins: string[], private readonly backend: DirectSourceBackend, private readonly validatePublic = assertPublicHttpsUrl) {}
  private async directory(directory: string) {
    let current = path.parse(path.resolve(directory)).root;
    for (const segment of path.resolve(directory).slice(current.length).split(path.sep)) {
      current = path.join(current, segment);
      const info = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (info?.isSymbolicLink()) throw new Error("Source storage ancestors must not be symlinks.");
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== path.resolve(directory)) throw new Error("Source storage must be a real owned directory, not a symlink.");
  }
  private async write(target: string, text: string) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" }); await rename(temporary, target);
  }
  private async readRecords(): Promise<DirectSourceRecord[]> {
    await this.directory(this.root); await this.directory(path.join(this.root, "records"));
    return Promise.all((await readdir(path.join(this.root, "records"))).filter(file => file.endsWith(".json")).map(async file => {
      const target = path.join(this.root, "records", file);
      const info = await lstat(target);
      if (!info.isFile() || info.nlink !== 1) throw Error("Source record must be a regular owned file, not a link.");
      await this.owned(target);
      const record = recordSchema.parse(JSON.parse(await readFile(target, "utf8")));
      if (`${record.id}.json` !== file || stableResourceId(record.url) !== record.id) throw Error("Source record identity mismatch.");
      assertDirectReadUrl(record.url, this.origins);
      if (record.resolvedUrl) assertDirectReadUrl(record.resolvedUrl, this.origins);
      for (const file of [record.localPath, record.textPath, ...(record.pages ?? []).map(page => page.path)].filter((file): file is string => Boolean(file))) await this.owned(file);
      return record;
    }));
  }
  private async save(record: DirectSourceRecord) {
    await mkdir(path.join(this.root, "records"), { recursive: true, mode: 0o700 });
    const old = (await this.readRecords()).find(item => item.id === record.id);
    const target = path.join(this.root, "records", `${record.id}.json`);
    await this.write(target, JSON.stringify(recordSchema.parse({ ...old, ...record })));
  }
  private async owned(file: string) {
    const info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error("Source file must be a regular owned file, not a link.");
    const [root, actual] = await Promise.all([realpath(this.root), realpath(file)]);
    const relative = path.relative(root, actual);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Source file is outside the owned source folder.");
    return actual;
  }
  private async url(value: string) { const url = assertDirectReadUrl(value, this.origins); await this.validatePublic(url); return url; }
  async run(input: unknown): Promise<Record<string, unknown>> {
    const r = parseDirectSourceRequest(input); await this.directory(this.root);
    let result: Record<string, unknown>;
    if (r.op === "courses") {
      const found = await this.backend.courses(); const links = found.links.filter(link => { try { assertDirectReadUrl(link.url, this.origins); return true; } catch { return false; } });
      for (const link of links) await this.save({ ...link, id: stableResourceId(link.url) });
      const terms = (r.query ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
      result = { complete: found.complete, courses: links.filter(link => !terms.length || terms.every(term => link.title.toLocaleLowerCase().includes(term))).map(link => ({ ...link, id: stableResourceId(link.url) })), totalCourses: links.length };
    } else if (r.op === "page") {
      const url = await this.url(r.url), page = await this.backend.page(url); await this.url(page.url);
      const id = stableResourceId(url), textPath = path.join(this.root, `${id}.native.txt`);
      await this.write(textPath, page.text); await this.save({ id, title: page.title, url, resolvedUrl: page.url, textPath });
      const links = page.links.filter(link => { try { assertDirectReadUrl(link.url, this.origins); return true; } catch { return false; } });
      for (const link of links) if (stableResourceId(link.url) !== id) await this.save({ ...link, id: stableResourceId(link.url) });
      result = { id, title: page.title, url, resolvedUrl: page.url, textPath, text: page.text, links: links.map(link => ({ ...link, id: stableResourceId(link.url) })) };
    } else if (r.op === "download") {
      const known = (await this.readRecords()).find(record => record.id === (r.sourceID ?? r.resourceID));
      if (!r.url && !known) throw new Error("Unknown source ID.");
      const url = await this.url(r.url ?? known!.url), id = stableResourceId(url);
      const acquired = await this.backend.download(url, this.root, id); await this.url(acquired.resolvedUrl);
      const localPath = await this.owned(acquired.path), sha256 = digest(await readFile(localPath));
      const catalog = known ?? (await this.readRecords()).find(record => record.id === id);
      const record = { id, title: catalog?.title ?? r.title ?? url, url, resolvedUrl: acquired.resolvedUrl, localPath, sha256 };
      await this.save(record); result = record;
    } else {
      const source = (await this.readRecords()).find(record => record.id === r.sourceID);
      if (!source?.localPath) throw new Error("Source must be an owned downloaded file.");
      const file = await this.owned(source.localPath); const sha256 = digest(await readFile(file));
      if (sha256 !== source.sha256) throw new Error("Downloaded source bytes changed; reacquire instead of trusting stale provenance.");
      const extracted = await this.backend.text(file);
      if (r.pages && extracted.pageCount != null && r.pages.some(page => page > extracted.pageCount!)) throw new Error("Requested page is outside the original document.");
      if (r.op === "text") {
        const text = r.pages ? r.pages.map(page => extracted.text.split("\f")[page - 1] ?? "").join("\f") : extracted.text;
        const textPath = path.join(this.root, `${source.id}.text${r.pages ? `-${r.pages.join("-")}` : ""}.txt`);
        await this.write(textPath, text); await this.save({ ...source, textPath, pageCount: extracted.pageCount, readability: extracted.status });
        result = { ...source, textPath, pageCount: extracted.pageCount, readability: extracted.status, text, pages: r.pages ?? null };
      } else {
        const rendered = await this.backend.pages(file, r.pages, this.root);
        const pages = await Promise.all(rendered.map(async page => ({ page: page.page, path: await this.owned(page.path), sha256: digest(await readFile(page.path)) })));
        if (pages.length !== r.pages.length || pages.some((page, index) => page.page !== r.pages[index])) throw new Error("Original page rendering did not satisfy the exact request.");
        await this.save({ ...source, pageCount: extracted.pageCount, readability: extracted.status, pages });
        result = { ...source, pageCount: extracted.pageCount, readability: extracted.status, pages, composition: "original rendered PDF pages; no embedded raster extraction" };
      }
    }
    const manifestPath = path.join(this.root, "sources-manifest.json");
    await this.write(manifestPath, JSON.stringify({ version: 1, untrusted: true, sources: await this.readRecords() }));
    return { ok: true, untrusted: true, manifestPath, ...result, ...(typeof result.id === "string" ? { sourceID: result.id } : {}) };
  }
}
