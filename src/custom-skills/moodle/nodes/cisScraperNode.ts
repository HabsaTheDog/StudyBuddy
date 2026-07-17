import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { dismissCommonOverlays, ensureLoggedIn, isAuthFailure, looksLikeLoginPage } from "../browserAuth.js";
import { extractReadableFileText } from "../fileTextExtraction.js";
import { safeFileName } from "../runDiagnostics.js";
import { throwIfAborted } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { runDownloadQueue } from "../downloadQueue.js";
import { extractCourseTargetHint, rawTextContainsRequestedCourse } from "../courseTargeting.js";
import { resolveTaskBudget } from "../taskBudget.js";

interface CrawlPage {
  url: string;
  depth: number;
}

export function createCisScraperNode(config: MoodleRuntimeConfig) {
  return async function cisScraperNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const diagnostics = config.diagnostics;
    if (config.cisUrls.length === 0) {
      await diagnostics?.updateCoverage("cis", {
        status: "not_requested",
        detail: "No CIS URLs were configured.",
      });
      return {};
    }

    let browser: Browser | null = null;
    const visited = new Set<string>();
    const successfulUrls = new Set<string>();
    const downloaded = new Set<string>();
    const chunks: string[] = [];
    const scheduleLookup = config.intentDecision?.intent === "schedule_answer";
    const taskBudget = resolveTaskBudget(config.intentDecision);
    const maxCisPages = scheduleLookup
      ? Math.min(config.maxCisPages, taskBudget.maxCisPages)
      : config.maxCisPages;
    const maxDownloadedFiles = scheduleLookup ? taskBudget.maxDownloadedFiles : undefined;

    try {
      await diagnostics?.log("info", "cis_login", "Opening CIS dashboard...");
      browser = await chromium.launch({ headless: config.headless });
      config.abortSignal?.addEventListener("abort", () => {
        void browser?.close();
      }, { once: true });
      const context = await browser.newContext({
        ...(config.cisStorageState ? { storageState: config.cisStorageState } : {}),
        ...(config.cisUsername && config.cisPassword
          ? {
              httpCredentials: {
                username: config.cisUsername,
                password: config.cisPassword,
              },
            }
          : {}),
      });
      const page = await context.newPage();
      const seedUrls = seedCisUrls(config, scheduleLookup);
      await ensureLoggedIn(page, {
        serviceName: "CIS",
        targetUrl: scheduleLookup
          ? seedUrls[0] || config.cisDashboardUrl || config.cisUrls[0]
          : config.cisDashboardUrl || config.cisUrls[0],
        username: config.cisUsername,
        password: config.cisPassword,
      });
      await diagnostics?.log("info", "cis_login", "CIS login ok.");

      const sourcesDir = path.join(config.runDir, "cis-sources");
      await mkdir(sourcesDir, { recursive: true });
      const queue: CrawlPage[] = seedUrls.map((url) => ({ url, depth: 0 }));

      while (queue.length > 0 && visited.size < maxCisPages) {
        throwIfAborted(config.abortSignal);
        const next = queue.shift();
        if (!next || visited.has(normalizeCisUrl(next.url))) {
          continue;
        }
        visited.add(normalizeCisUrl(next.url));
        await diagnostics?.markAttempt("cis", next.url, `Opening CIS URL: ${next.url}`);
        await diagnostics?.log("info", "cis_crawl", `Opening CIS URL: ${next.url}`);
        const opened = await gotoWithDiagnostics(page, config, next.url, visited.size);
        if (!opened.ok) {
          chunks.push(formatWarning("CIS", opened.message));
          continue;
        }
        await dismissCommonOverlays(page);

        const title = await page.title().catch(() => next.url);
        const text = await page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
        const resolvedUrl = page.url() || next.url;
        successfulUrls.add(resolvedUrl);
        chunks.push(formatCisChunk({ title, url: resolvedUrl, text }));

        if (config.allowFileDownloads) {
          await captureReadableFiles(page, sourcesDir, chunks, config, downloaded, {
            maxFiles: maxDownloadedFiles,
            scheduleOnly: scheduleLookup && !config.intentDecision?.needsCourseMaterial,
          });
        }

        if (next.depth < config.maxDepth) {
          const links = await extractCisLinks(page, config.cisBaseUrl, config.prompt, text);
          const nextLinks = links
            .filter((link) => !visited.has(normalizeCisUrl(link)))
            .map((url) => ({ url, depth: next.depth + 1 }));
          queue.unshift(...nextLinks);
        }
      }

      const hasText = chunks.some(hasBodyText);
      const target = extractCourseTargetHint(config.prompt);
      const targetRequested = target.requestedCodes.length > 0 || target.requestedNames.length > 0;
      const targetCovered = !targetRequested || rawTextContainsRequestedCourse(config.prompt, chunks.join("\n\n"));
      await diagnostics?.markSuccess("cis", {
        detail: hasText
          ? targetCovered
            ? `Fetched ${successfulUrls.size} CIS page(s).`
            : `Fetched ${successfulUrls.size} CIS page(s), but target-course detail was not reached.`
          : "CIS was reachable, but no readable page text was extracted.",
        urls: [...successfulUrls],
        pages: successfulUrls.size,
        partial: !hasText || !targetCovered,
      });

      return {
        moodle_raw_text: [state.moodle_raw_text, chunks.join("\n\n")]
          .filter((part) => part.trim())
          .join("\n\n"),
        error_log: null,
      };
    } catch (error) {
      throwIfAborted(config.abortSignal);
      const message = error instanceof Error ? error.message : String(error);
      await diagnostics?.markFailure("cis", {
        detail: message,
        urls: [...visited],
        attemptedUrls: config.cisUrls,
        failureKind: isAuthFailure(message) ? "auth" : "unknown",
      });
      await diagnostics?.log("warn", "cis_crawl", `CIS scrape failed: ${message}`);
      const warningChunk = formatWarning("CIS", `CIS scrape failed: ${message}`);
      return {
        moodle_raw_text: [state.moodle_raw_text, warningChunk]
          .filter((part) => part.trim())
          .join("\n\n"),
        error_log: null,
      };
    } finally {
      await browser?.close();
    }
  };
}

async function gotoWithDiagnostics(
  page: Page,
  config: MoodleRuntimeConfig,
  url: string,
  index: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    if (await looksLikeLoginPage(page)) {
      throw new Error("CIS login is required or the session expired while opening the page.");
    }
    const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (!text.trim()) {
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    }
    return { ok: true };
  } catch (firstError) {
    await config.diagnostics?.capturePageDiagnostics("cis", page, `${index}-timeout-initial`, firstError);
    await config.diagnostics?.log("warn", "cis_crawl", `Initial CIS open failed; retrying: ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      if (text.trim()) {
        await config.diagnostics?.updateCoverage("cis", {
          status: "partial",
          detail: `CIS URL loaded partially after retry: ${url}`,
        });
        return { ok: true };
      }
      throw firstError;
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      await config.diagnostics?.capturePageDiagnostics("cis", page, `${index}-timeout-final`, secondError);
      await config.diagnostics?.markFailure("cis", {
        detail: `Attempted to open ${url}, but timed out before extraction: ${message}`,
        attemptedUrls: [url],
        failureKind: "timeout",
      });
      return {
        ok: false,
        message: `Attempted to open ${url}, but timed out before extraction: ${message}`,
      };
    }
  }
}

async function extractCisLinks(page: Page, baseUrl: string, prompt: string, pageText: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const links = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      label: (
        (anchor as HTMLAnchorElement).innerText ||
        (anchor as HTMLAnchorElement).textContent ||
        ""
      ).trim(),
      context: (
        (anchor.closest("tr, article, section, .card, .panel, li, div") as HTMLElement | null)
          ?.innerText || ""
      ).trim().slice(0, 2_000),
    })),
  );
  const targetOnPage = rawTextContainsRequestedCourse(prompt, pageText);
  return uniqueLinks(links)
    .filter(({ href }) => href.startsWith(origin))
    .filter(({ href }) => href.includes("cis.php"))
    .filter(({ href }) => isUsefulCisUrl(href))
    .sort((left, right) =>
      cisLinkPriority(right, targetOnPage, prompt) - cisLinkPriority(left, targetOnPage, prompt)
    )
    .map(({ href }) => href)
    .slice(0, 12);
}

function seedCisUrls(config: MoodleRuntimeConfig, scheduleLookup: boolean): string[] {
  const base = config.cisBaseUrl.replace(/\/$/, "");
  const directLvUrls = [
    `${base}/cis.php/Cis/MyLvPlan`,
    `${base}/cis.php/Cis/MyLv`,
  ];
  const urls = scheduleLookup
    ? [...directLvUrls, ...config.cisUrls, `${base}/cis.php/Cis4`]
    : [...config.cisUrls, ...directLvUrls, `${base}/cis.php/Cis4`];
  return uniqueCisUrls(urls.filter(isUsefulCisUrl));
}

function uniqueCisUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const normalized = normalizeCisUrl(url);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function uniqueLinks<T extends { href: string; label: string; context?: string }>(links: T[]): T[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const normalized = normalizeCisUrl(link.href);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function cisLinkPriority(
  link: { href: string; label: string; context?: string },
  targetOnPage: boolean,
  prompt: string,
): number {
  if (!targetOnPage) return 0;
  const text = `${link.href} ${link.label}`.toLowerCase();
  const targetContext = rawTextContainsRequestedCourse(prompt, link.context ?? "");
  if (/alle\s+termine\s+dieser\s+lv/.test(text)) return targetContext ? 1_000 : 300;
  if (/lehrveranstaltungsinformationen|lv-info|lvinfo/.test(text)) return targetContext ? 900 : 250;
  if (/termin|exam|prüfung|pruefung/.test(text)) return targetContext ? 800 : 150;
  return 0;
}

function normalizeCisUrl(url: string): string {
  return url.replace(/#.*$/, "").replace(/\/$/, "");
}

function isUsefulCisUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (
    lower.includes("/auth/") ||
    lower.includes("logout") ||
    lower.includes("password") ||
    lower.includes("profil") ||
    lower.includes("profile")
  ) {
    return false;
  }
  return (
    lower.includes("cis.php/") ||
    lower.endsWith("cis.php") ||
    lower.endsWith("cis.php/")
  );
}

async function captureReadableFiles(
  page: Page,
  sourcesDir: string,
  chunks: string[],
  config: MoodleRuntimeConfig,
  downloaded: Set<string>,
  options: { maxFiles?: number; scheduleOnly: boolean },
): Promise<void> {
  const remaining = options.maxFiles === undefined
    ? 3
    : Math.max(0, options.maxFiles - downloaded.size);
  if (remaining === 0) return;

  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: (anchor as HTMLAnchorElement).href,
      label: (
        (anchor as HTMLAnchorElement).innerText ||
        (anchor as HTMLAnchorElement).textContent ||
        ""
      ).trim(),
    })),
  );
  const fileLinks = hrefs
    .filter(({ href }) => /\.(pdf|txt|md)$/i.test(new URL(href).pathname))
    .filter((link) => !options.scheduleOnly || isScheduleDocument(link))
    .filter(({ href }) => {
      const normalized = normalizeCisUrl(href);
      if (downloaded.has(normalized)) {
        return false;
      }
      downloaded.add(normalized);
      return true;
    })
    .slice(0, remaining);
  const jobs = fileLinks.map((link, index) => async () => {
    throwIfAborted(config.abortSignal);
    const filename = safeFileName(
      `${index + 1}-${link.label || path.basename(new URL(link.href).pathname)}`,
    );
    const target = path.join(sourcesDir, filename);
    await config.diagnostics?.log("info", "cis_download", `Downloading CIS file: ${link.href}`);
    const response = await page
      .context()
      .request.get(link.href)
      .catch(() => null);
    if (!response?.ok()) {
      return `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nDownload failed`;
    }
    const body = await response.body();
    await writeFile(target, body);
    await config.diagnostics?.updateCoverage("cis", { artifacts: [target] });
    const text = await extractReadableFileText(target).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return `Readable text extraction failed: ${message}`;
    });
    return `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nSaved path: ${target}\n\n${text.trim()}`;
  });
  const results = await runDownloadQueue(jobs, {
    concurrency: config.downloadConcurrency,
    timeoutMs: 90_000,
  });
  for (const result of results) {
    chunks.push(result.status === "fulfilled"
      ? result.value
      : `[Linked file]\nDownload failed: ${errorMessage(result.reason)}`);
  }
}

function isScheduleDocument(link: { href: string; label: string }): boolean {
  const text = `${link.label} ${decodeURIComponent(new URL(link.href).pathname)}`.toLowerCase();
  return /(?:prüfung|pruefung|exam|termin|schedule|kurs.?info|course.?info|lv.?info|lehrveranstaltungsinfo|organisation|syllabus)/i
    .test(text);
}

function formatCisChunk(input: { title: string; url: string; text: string }): string {
  return ["[CIS page]", `Title: ${input.title}`, `URL: ${input.url}`, "", input.text.trim()].join(
    "\n",
  );
}

function formatWarning(source: string, message: string): string {
  return [`[${source} warning]`, message].join("\n");
}

function hasBodyText(chunk: string): boolean {
  const lines = chunk.split("\n").slice(4).join("\n").trim();
  return lines.length > 0 && !/^download failed$/i.test(lines);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
