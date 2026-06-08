import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { dismissCommonOverlays, ensureLoggedIn, isAuthFailure, looksLikeLoginPage } from "../browserAuth.js";
import { extractReadableFileText } from "../fileTextExtraction.js";
import { safeFileName } from "../runDiagnostics.js";
import { throwIfAborted } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

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
      await ensureLoggedIn(page, {
        serviceName: "CIS",
        targetUrl: config.cisDashboardUrl || config.cisUrls[0],
        username: config.cisUsername,
        password: config.cisPassword,
      });
      await diagnostics?.log("info", "cis_login", "CIS login ok.");

      const sourcesDir = path.join(config.runDir, "cis-sources");
      await mkdir(sourcesDir, { recursive: true });
      const queue: CrawlPage[] = seedCisUrls(config).map((url) => ({ url, depth: 0 }));

      while (queue.length > 0 && visited.size < config.maxCisPages) {
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
          await captureReadableFiles(page, sourcesDir, chunks, config, downloaded);
        }

        if (next.depth < config.maxDepth) {
          const links = await extractCisLinks(page, config.cisBaseUrl);
          for (const link of links) {
            if (!visited.has(normalizeCisUrl(link)) && queue.length + visited.size < config.maxCisPages) {
              queue.push({ url: link, depth: next.depth + 1 });
            }
          }
        }
      }

      const hasText = chunks.some(hasBodyText);
      await diagnostics?.markSuccess("cis", {
        detail: hasText
          ? `Fetched ${successfulUrls.size} CIS page(s).`
          : "CIS was reachable, but no readable page text was extracted.",
        urls: [...successfulUrls],
        pages: successfulUrls.size,
        partial: !hasText,
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
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    if (await looksLikeLoginPage(page)) {
      throw new Error("CIS login is required or the session expired while opening the page.");
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

async function extractCisLinks(page: Page, baseUrl: string): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const hrefs = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
  );
  return [...new Set(hrefs)]
    .filter((href) => href.startsWith(origin))
    .filter((href) => href.includes("cis.php"))
    .filter(isUsefulCisUrl)
    .slice(0, 12);
}

function seedCisUrls(config: MoodleRuntimeConfig): string[] {
  const base = config.cisBaseUrl.replace(/\/$/, "");
  return [
    ...config.cisUrls,
    `${base}/cis.php/Cis/MyLvPlan`,
    `${base}/cis.php/Cis/MyLv`,
  ].filter(isUsefulCisUrl);
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
): Promise<void> {
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
    .filter(({ href }) => {
      const normalized = normalizeCisUrl(href);
      if (downloaded.has(normalized)) {
        return false;
      }
      downloaded.add(normalized);
      return true;
    })
    .slice(0, 3);
  for (const [index, link] of fileLinks.entries()) {
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
      chunks.push(
        `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nDownload failed`,
      );
      continue;
    }
    const body = await response.body();
    await writeFile(target, body);
    await config.diagnostics?.updateCoverage("cis", { artifacts: [target] });
    const text = await extractReadableFileText(target).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return `Readable text extraction failed: ${message}`;
    });
    chunks.push(
      `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nSaved path: ${target}\n\n${text.trim()}`,
    );
  }
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
