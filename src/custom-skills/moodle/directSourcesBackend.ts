import { copyFile, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { launchMoodleBrowser } from "./browserLaunch.js";
import { ensureLoggedIn } from "./browserAuth.js";
import { enumeratePlaywrightOverview } from "./overviewEnumeration.js";
import { extractReadableFile } from "./fileTextExtraction.js";
import { inspectResourcePayload } from "./resourceAcquisition.js";
import { assertPublicHttpsUrl } from "./urlSecurity.js";
import { runBoundedProcess } from "../shared/boundedProcess.js";
import { assertDirectReadUrl, type DirectSourceBackend, type DirectSourceLink } from "./directSources.js";

export interface DirectSourcePortal { dashboard: string; username?: string; password?: string; loginOrigins: string[]; storageState?: string }
export class PlaywrightDirectSourceBackend implements DirectSourceBackend {
  constructor(private portals: DirectSourcePortal[]) {}
  private get origins() { return this.portals.map(portal => new URL(portal.dashboard).origin); }
  private async browser<T>(url: string, work: (page: Page) => Promise<T>, navigate = true) {
    assertDirectReadUrl(url, this.origins); await assertPublicHttpsUrl(url);
    const portal = this.portals.find(portal => new URL(portal.dashboard).origin === new URL(url).origin)!;
    const browser = await launchMoodleBrowser({ headless: true, purpose: "Direct read-only sources" });
    try {
      const context = await browser.newContext({ ...(portal.storageState ? { storageState: portal.storageState } : {}) });
      let authenticating = true;
      await context.route("**/*", async route => {
        const request = route.request();
        try {
          const current = new URL(request.url());
          const loginAllowed = [new URL(portal.dashboard).origin, ...portal.loginOrigins].includes(current.origin);
          if (authenticating && loginAllowed) {
            if (this.origins.includes(current.origin)) assertDirectReadUrl(current.toString(), this.origins);
            if (!['GET', 'HEAD'].includes(request.method())) {
              // Do not evaluate the page while its navigation is paused here:
              // that would wait for this same route and deadlock login.
              if (request.method() !== "POST" || !/\/(?:login|auth)(?:\/|\.|$)/i.test(current.pathname)) throw Error("Only an authentication POST is permitted.");
            }
            await assertPublicHttpsUrl(current.toString());
          } else {
            assertDirectReadUrl(current.toString(), this.origins);
            if (!['GET', 'HEAD'].includes(request.method())) throw Error("Only read-only requests permitted.");
            await assertPublicHttpsUrl(current.toString());
          }
          await route.continue();
        } catch { await route.abort("blockedbyclient"); }
      });
      const page = await context.newPage();
      await ensureLoggedIn(page, { serviceName: "University source", targetUrl: portal.dashboard, username: portal.username, password: portal.password, allowedOrigins: portal.loginOrigins });
      authenticating = false;
      if (navigate && page.url() !== url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      assertDirectReadUrl(page.url(), this.origins);
      return await work(page);
    } finally { await browser.close(); }
  }
  async courses() {
    const portal = this.portals[0]; if (!portal) throw Error("No configured Moodle portal.");
    return this.browser(portal.dashboard, async page => {
      const overview = await enumeratePlaywrightOverview(page);
      const links: DirectSourceLink[] = [];
      for (const line of overview.snapshot.snapshot.split("\n")) {
        const url = /url=(https:\/\/[^\]\s]+\/course\/view\.php\?id=\d+)/.exec(line)?.[1];
        const title = /link ("(?:[^"\\]|\\.)*")/.exec(line)?.[1];
        if (url && title && !links.some(link => link.url === url)) links.push({ title: JSON.parse(title), url });
      }
      return { links, complete: overview.complete };
    }, false);
  }
  async page(url: string) {
    return this.browser(url, async page => {
      const observed = await page.evaluate(() => {
        const root = document.querySelector("main,#region-main") ?? document.body;
        return { title: document.title, url: location.href, text: (root as HTMLElement).innerText,
          links: Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")).map(anchor => ({ title: (anchor.innerText || anchor.textContent || anchor.href).trim(), url: anchor.href,
            section: anchor.closest("[data-sectionid],li.section,section")?.querySelector("h2,h3,h4,.sectionname")?.textContent?.trim() ?? "" })) };
      });
      return observed;
    });
  }
  async download(url: string, directory: string, id: string) {
    return this.browser(url, async page => {
      // Use authenticated cookie provenance, but gate every redirect before GET.
      let current = url;
      for (let hop = 0; hop <= 5; hop++) {
        assertDirectReadUrl(current, this.origins); await assertPublicHttpsUrl(current);
        const cookies = await page.context().cookies(current);
        const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(60_000), headers: cookies.length ? { cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") } : undefined });
        if (response.status >= 300 && response.status < 400) {
          const next = response.headers.get("location"); await response.body?.cancel();
          if (!next || hop === 5) throw Error("Source redirect limit exceeded."); current = new URL(next, current).toString(); continue;
        }
        if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(`Source download HTTP ${response.status}.`); }
        const limit = 100 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > limit) { await response.body.cancel(); throw Error("Source exceeds 100 MiB."); }
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const temporary = path.join(directory, `${id}-${process.pid}-${Date.now()}.part`), file = await open(temporary, "wx", 0o600);
        const reader = response.body.getReader(), sample: Uint8Array[] = []; let bytes = 0, sampled = 0;
        try {
          while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) throw Error("Source exceeds 100 MiB.");
            await file.write(value); if (sampled < 65536) { const piece = value.subarray(0, 65536 - sampled); sample.push(piece); sampled += piece.length; } }
          if (!bytes) throw Error("Empty source file.");
          const inspected = inspectResourcePayload(Buffer.concat(sample), response.headers.get("content-type") ?? undefined);
          const extension = inspected.kind === "pdf" ? ".pdf" : inspected.kind === "text" ? ".txt" : null;
          if (!extension) throw Error("Source is not a supported document; read its native page instead.");
          await file.close(); const target = path.join(directory, `${id}${extension}`); await rename(temporary, target); return { path: target, resolvedUrl: current };
        } catch (error) { await reader.cancel().catch(() => undefined); await file.close().catch(() => undefined); await rm(temporary, { force: true }); throw error; }
      }
      throw Error("Source redirect exhausted.");
    }, false);
  }
  async text(file: string) {
    const temporary = await mkdtemp(path.join(path.dirname(file), "text-read-"));
    try {
      const staged = path.join(temporary, path.basename(file)); await copyFile(file, staged);
      const result = await extractReadableFile(staged, { commandTimeoutMs: 60_000 });
      return { text: result.text, pageCount: result.pageCount, status: result.status };
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async pages(file: string, pages: number[], directory: string) {
    if (path.extname(file).toLowerCase() !== ".pdf") throw Error("Original page rendering requires PDF.");
    const executable = process.env.STUDY_BUDDY_PDFTOPPM_PATH || "pdftoppm";
    const renderDir = await mkdtemp(path.join(directory, "pages-"));
    const result = [];
    for (const page of pages) {
      const prefix = path.join(renderDir, `${path.basename(file, ".pdf")}-page-${page}`);
      const rendered = await runBoundedProcess(executable, ["-png", "-singlefile", "-f", String(page), "-l", String(page), "-r", "144", file, prefix], { timeoutMs: 60_000 });
      if (rendered.code !== 0) throw Error("Original PDF page rendering failed.");
      result.push({ page, path: `${prefix}.png` });
    }
    return result;
  }
}
