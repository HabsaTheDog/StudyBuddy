import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createAgentBrowserClient, type AgentBrowserClient, type AgentBrowserSnapshot } from "../agentBrowserClient.js";
import {
  dismissCommonOverlays,
  ensureAgentBrowserLoggedIn,
  ensureLoggedIn,
  isAuthFailure,
  looksLikeAgentBrowserLoginPage,
  looksLikeLoginPage,
} from "../browserAuth.js";
import { assertReadableDownloadedFile, extractReadableFileText } from "../fileTextExtraction.js";
import { safeFileName } from "../runDiagnostics.js";
import { throwIfAborted } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { runDownloadQueue } from "../downloadQueue.js";
import {
  explicitCourseCodesFromText,
  extractCourseTargetHint,
  resolveCourseTargetsFromLinks,
  scoreCourseTargetLabel,
} from "../courseTargeting.js";
import {
  assertQuizPolicyAllows,
  detectQuizRestrictions,
  isMoodleQuizAttemptUrl,
  isMoodleQuizFinalSubmitUrl,
  isMoodleQuizSaveOrMoveUrl,
  QuizPolicyViolation,
  type QuizContext,
} from "../quizPolicy.js";

interface CrawlPage {
  url: string;
  depth: number;
}

interface PageFetchSuccess {
  ok: true;
  chunk: string;
  url: string;
}

interface PageFetchFailure {
  ok: false;
  chunk: string;
  message: string;
  failureKind: "timeout" | "auth" | "unknown";
}

type PageFetchResult = PageFetchSuccess | PageFetchFailure;

export function createScraperNode(config: MoodleRuntimeConfig) {
  return async function scraperNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const diagnostics = config.diagnostics;
    let browser: Browser | null = null;
    let page: Page | null = null;
    const visited = new Set<string>();
    const successfulUrls = new Set<string>();
    const downloaded = new Set<string>();
    const chunks: string[] = [];

    try {
      if (config.browserBackend === "agent-browser") {
        return scrapeWithAgentBrowser(config, state);
      }

      await diagnostics?.log("info", "moodle_login", "Opening Moodle dashboard...");
      browser = await chromium.launch({ headless: config.headless });
      const closeOnAbort = () => {
        void browser?.close();
      };
      config.abortSignal?.addEventListener("abort", closeOnAbort, { once: true });
      const context = await browser.newContext(
        config.storageState ? { storageState: config.storageState } : undefined,
      );
      page = await context.newPage();
      await ensureLoggedIn(page, {
        serviceName: "Moodle",
        targetUrl: config.dashboardUrl || config.moodleUrl,
        username: config.username,
        password: config.password,
      });
      await diagnostics?.log("info", "moodle_login", "Moodle login ok.");

      const queue: CrawlPage[] = [{ url: config.moodleUrl, depth: 0 }];
      const sourcesDir = path.join(config.runDir, "sources");
      await mkdir(sourcesDir, { recursive: true });

      while (queue.length > 0 && visited.size < config.maxPages) {
        throwIfAborted(config.abortSignal);
        const next = queue.shift();
        if (!next || visited.has(next.url)) {
          continue;
        }
        const openViolation = quizUrlPolicyViolation(config, next.url);
        if (openViolation) {
          await recordQuizPolicyBlock(config, openViolation);
          chunks.push(formatWarning("Moodle quiz safety", openViolation.message));
          continue;
        }
        visited.add(next.url);
        await diagnostics?.markAttempt("moodle", next.url, `Opening Moodle URL: ${next.url}`);
        await diagnostics?.log("info", "moodle_crawl", `Opening Moodle URL: ${next.url}`);
        const opened = await gotoWithDiagnostics(page, config, next.url, visited.size);
        if (!opened.ok) {
          chunks.push(formatWarning("Moodle", opened.message));
          continue;
        }
        await dismissCommonOverlays(page);

        const title = await page.title().catch(() => next.url);
        const resolvedUrl = page.url() || next.url;
        const readViolation = quizReadPolicyViolation(config, resolvedUrl, title);
        if (readViolation) {
          await recordQuizPolicyBlock(config, readViolation);
          chunks.push(formatWarning("Moodle quiz safety", readViolation.message));
          continue;
        }
        const text = await page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
        const quizContext = detectQuizRestrictions({ url: resolvedUrl, text });
        const restrictionViolations = quizRestrictionPolicyViolations(config, quizContext);
        for (const violation of restrictionViolations) {
          await recordQuizPolicyBlock(config, violation);
          chunks.push(formatWarning("Moodle quiz safety", violation.message));
        }
        successfulUrls.add(resolvedUrl);
        chunks.push(formatSourceChunk({ title, url: resolvedUrl, text }));
        await capturePlaywrightResourceSnapshot(
          page,
          sourcesDir,
          visited.size,
          title,
          resolvedUrl,
        );

        if (config.allowFileDownloads) {
          await captureFileLinks(page, sourcesDir, chunks, config, downloaded);
        }

        if (next.depth < config.maxDepth) {
          const links = await extractMoodleLinks(page, config);
          for (const link of links) {
            const linkViolation = quizUrlPolicyViolation(config, link, quizContext);
            if (linkViolation) {
              await recordQuizPolicyBlock(config, linkViolation);
              continue;
            }
            if (config.allowFileDownloads && isReadableResourceLink(link)) {
              continue;
            }
            if (!visited.has(link) && queue.length + visited.size < config.maxPages) {
              queue.push({ url: link, depth: next.depth + 1 });
            }
          }
        }
      }

      const hasText = chunks.some(hasBodyText);
      await diagnostics?.markSuccess("moodle", {
        detail: hasText
          ? `Fetched ${successfulUrls.size} relevant Moodle page(s).`
          : "Moodle was reachable, but no readable page text was extracted.",
        urls: [...successfulUrls],
        pages: successfulUrls.size,
        partial: !hasText,
      });

      return {
        moodle_raw_text: chunks.join("\n\n"),
        error_log: null,
      };
    } catch (error) {
      throwIfAborted(config.abortSignal);
      const message = error instanceof Error ? error.message : String(error);
      if (page) {
        await diagnostics?.capturePageDiagnostics(
          "moodle",
          page,
          "playwright-login-or-crawl-failure",
          error,
        );
      }
      await diagnostics?.markFailure("moodle", {
        detail: message,
        urls: [...visited],
        attemptedUrls: [config.moodleUrl],
        failureKind: isAuthFailure(message) ? "auth" : "unknown",
      });
      await diagnostics?.log("warn", "moodle_crawl", `Moodle scrape failed: ${message}`);
      return {
        moodle_raw_text: [state.moodle_raw_text, formatWarning("Moodle", `Moodle scrape failed: ${message}`)]
          .filter((part) => part.trim())
          .join("\n\n"),
        error_log: null,
      };
    } finally {
      await browser?.close();
    }
  };
}

async function scrapeWithAgentBrowser(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
): Promise<Partial<LangGraphAgentState>> {
  const diagnostics = config.diagnostics;
  const client = createAgentBrowserClient(config);
  const visited = new Set<string>();
  const successfulUrls = new Set<string>();
  const downloaded = new Set<string>();
  const chunks: string[] = [];
  const failures: PageFetchFailure[] = [];
  let recoveredPages = 0;

  try {
    await diagnostics?.log("info", "moodle_login", "Opening Moodle dashboard with agent-browser...");
    await ensureAgentBrowserLoggedIn(client, {
      serviceName: "Moodle",
      targetUrl: config.dashboardUrl || config.moodleUrl,
      username: config.username,
      password: config.password,
    });
    await diagnostics?.log("info", "moodle_login", "Moodle login ok with agent-browser.");

    const queue: CrawlPage[] = [{ url: config.moodleUrl, depth: 0 }];
    const sourcesDir = path.join(config.runDir, "sources");
    await mkdir(sourcesDir, { recursive: true });

    while (queue.length > 0 && visited.size < config.maxPages) {
      throwIfAborted(config.abortSignal);
      const next = queue.shift();
      if (!next || visited.has(next.url)) {
        continue;
      }
      const openViolation = quizUrlPolicyViolation(config, next.url);
      if (openViolation) {
        await recordQuizPolicyBlock(config, openViolation);
        chunks.push(formatWarning("Moodle quiz safety", openViolation.message));
        continue;
      }
      visited.add(next.url);
      await diagnostics?.markAttempt("moodle", next.url, `Opening Moodle URL with agent-browser: ${next.url}`);
      await diagnostics?.log("info", "moodle_crawl", `agent-browser open: ${next.url}`);
      let snapshot: AgentBrowserSnapshot | null = null;
      try {
        await client.open(next.url);
        snapshot = await client.snapshot({ interactive: true, urls: true, compact: true });
        if (await looksLikeAgentBrowserLoginPage(client)) {
          throw new Error("Moodle login is required or the session expired while opening the page.");
        }
      } catch (error) {
        throwIfAborted(config.abortSignal);
        await diagnostics?.captureAgentBrowserDiagnostics(
          "moodle",
          client,
          `${visited.size}-agent-browser-open`,
          error,
        );
        const message = error instanceof Error ? error.message : String(error);
        const openFailureKind = isAuthFailure(message)
          ? "auth"
          : isTimeoutFailure(message)
            ? "timeout"
            : "unknown";
        snapshot = await recoverAgentBrowserSnapshot(client, next.url);
        if (snapshot) {
          recoveredPages += 1;
          await diagnostics?.log(
            "warn",
            "moodle_crawl",
            `agent-browser reported an open failure, but the requested page loaded and was recovered: ${next.url}`,
          );
        } else {
          const fallback = await fetchSinglePageWithPlaywright(config, next.url, visited.size);
          chunks.push(fallback.chunk);
          if (fallback.ok) {
            successfulUrls.add(fallback.url);
            recoveredPages += 1;
          } else {
            failures.push({
              ...fallback,
              message: `agent-browser failed opening ${next.url}: ${message}; ${fallback.message}`,
              failureKind:
                fallback.failureKind === "unknown" ? openFailureKind : fallback.failureKind,
            });
          }
          continue;
        }
      }

      const title = snapshot.origin || next.url;
      const readViolation = quizReadPolicyViolation(config, snapshot.origin || next.url, title);
      if (readViolation) {
        await recordQuizPolicyBlock(config, readViolation);
        chunks.push(formatWarning("Moodle quiz safety", readViolation.message));
        continue;
      }
      const text = snapshotToText(snapshot.snapshot);
      const quizContext = detectQuizRestrictions({ url: snapshot.origin || next.url, text });
      const restrictionViolations = quizRestrictionPolicyViolations(config, quizContext);
      for (const violation of restrictionViolations) {
        await recordQuizPolicyBlock(config, violation);
        chunks.push(formatWarning("Moodle quiz safety", violation.message));
      }
      successfulUrls.add(next.url);
      await writeFile(
        path.join(sourcesDir, safeFileName(`${visited.size}-${title || "snapshot"}.json`)),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8",
      );
      chunks.push(formatSourceChunk({ title, url: next.url, text }));

      if (config.allowFileDownloads) {
        await captureOpenedAgentBrowserResource(
          snapshot.origin,
          next.url,
          sourcesDir,
          chunks,
          config,
          downloaded,
        );
        await captureAgentBrowserFileLinks(
          client,
          snapshot,
          sourcesDir,
          chunks,
          config,
          downloaded,
        );
      }

      if (next.depth < config.maxDepth) {
        const links = extractMoodleLinksFromSnapshot(snapshot, config);
        for (const link of links) {
          const linkViolation = quizUrlPolicyViolation(config, link, quizContext);
          if (linkViolation) {
            await recordQuizPolicyBlock(config, linkViolation);
            continue;
          }
          if (config.allowFileDownloads && isReadableResourceLink(link)) {
            continue;
          }
          if (!visited.has(link) && queue.length + visited.size < config.maxPages) {
            queue.push({ url: link, depth: next.depth + 1 });
          }
        }
      }
    }

    const hasText = chunks.some(hasBodyText);
    if (successfulUrls.size === 0 && failures.length > 0) {
      const lastFailure = failures.at(-1)!;
      await diagnostics?.markFailure("moodle", {
        detail: lastFailure.message,
        attemptedUrls: [...visited],
        failureKind: lastFailure.failureKind,
      });
      return {
        moodle_raw_text: chunks.join("\n\n"),
        error_log: null,
      };
    }
    await diagnostics?.markSuccess("moodle", {
      detail: hasText
        ? `Fetched ${successfulUrls.size} relevant Moodle page(s) with agent-browser.`
        : "Moodle was reachable with agent-browser, but no readable page text was extracted.",
      urls: [...successfulUrls],
      pages: successfulUrls.size,
      partial: recoveredPages > 0 || failures.length > 0 || !hasText,
    });

    return {
      moodle_raw_text: chunks.join("\n\n"),
      error_log: null,
    };
  } catch (error) {
    throwIfAborted(config.abortSignal);
    const message = error instanceof Error ? error.message : String(error);
    await diagnostics?.captureAgentBrowserDiagnostics(
      "moodle",
      client,
      "login-or-crawl-failure",
      error,
    );
    await diagnostics?.markFailure("moodle", {
      detail: message,
      urls: [...visited],
      attemptedUrls: [config.moodleUrl],
      failureKind: isAuthFailure(message) ? "auth" : "unknown",
    });
    await diagnostics?.log("warn", "moodle_crawl", `Moodle agent-browser scrape failed: ${message}`);
    await diagnostics?.log(
      "warn",
      "moodle_login",
      "Retrying Moodle authentication and crawl with Playwright fallback.",
    );
    return createScraperNode({ ...config, browserBackend: "playwright" })(state);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function captureOpenedAgentBrowserResource(
  origin: string,
  requestedUrl: string,
  sourcesDir: string,
  chunks: string[],
  config: MoodleRuntimeConfig,
  downloaded: Set<string>,
): Promise<void> {
  if (!isReadableResourceLink(origin)) {
    return;
  }
  const keys = [origin, requestedUrl].map(normalizeMoodleUrl);
  if (keys.some((key) => downloaded.has(key))) {
    return;
  }
  keys.forEach((key) => downloaded.add(key));

  const url = new URL(origin);
  const basename = decodeURIComponent(path.basename(url.pathname)) || "Moodle-Ressource.pdf";
  const target = path.join(sourcesDir, readableFileName(`${downloaded.size}-${basename}`, origin));
  try {
    await config.diagnostics?.log(
      "info",
      "moodle_download",
      `Downloading opened Moodle resource: ${origin}`,
    );
    await downloadResourceWithPlaywright(config, origin, target);
    await config.diagnostics?.updateCoverage("moodle", { artifacts: [target] });
    const text = await extractReadableFileText(target);
    chunks.push(
      `[Linked file]\nTitle: ${basename}\nURL: ${origin}\nSaved path: ${target}\n\n${text.trim()}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await config.diagnostics?.log(
      "warn",
      "moodle_download",
      `Opened Moodle resource download failed: ${message}`,
    );
    chunks.push(
      `[Linked file]\nTitle: ${basename}\nURL: ${origin}\nDownload failed: ${message}`,
    );
  }
}

async function captureAgentBrowserFileLinks(
  client: AgentBrowserClient,
  snapshot: AgentBrowserSnapshot,
  sourcesDir: string,
  chunks: string[],
  config: MoodleRuntimeConfig,
  downloaded: Set<string>,
): Promise<void> {
  const fileLinks = selectRelevantFileLinks(
    extractSnapshotLinks(snapshot).filter(({ href }) => isReadableResourceLink(href)),
    config.prompt,
    config.intentDecision?.needsCourseMaterial ? 60 : 3,
    config.intentDecision?.needsCourseMaterial ? Number.NEGATIVE_INFINITY : 90,
  ).filter(({ href }) => {
    const normalized = normalizeMoodleUrl(href);
    if (downloaded.has(normalized)) {
      return false;
    }
    downloaded.add(normalized);
    return true;
  });
  const jobs = fileLinks.map((link, index) => async () => {
    throwIfAborted(config.abortSignal);
    const filename = readableFileName(
      `${index + 1}-${link.label || path.basename(new URL(link.href).pathname)}`,
      link.href,
    );
    const target = path.join(sourcesDir, filename);
    let downloadError: unknown = null;
    if (new URL(link.href).pathname.includes("/mod/resource/view.php")) {
      try {
        await config.diagnostics?.log(
          "info",
          "moodle_download",
          `Authenticated Moodle resource download: ${link.href}`,
        );
        await downloadResourceWithPlaywright(config, link.href, target);
      } catch (error) {
        downloadError = error;
      }
    } else {
      try {
        await config.diagnostics?.log("info", "moodle_download", `agent-browser download: ${link.href}`);
        await client.download(`@${link.ref}`, target);
        await assertNonEmptyFile(target);
        await assertReadableDownloadedFile(target);
      } catch (error) {
        await rm(target, { force: true }).catch(() => undefined);
        downloadError = error;
        await config.diagnostics?.log(
          "warn",
          "moodle_download",
          `agent-browser download failed; using authenticated Playwright fallback: ${link.href}`,
        );
        try {
          await downloadResourceWithPlaywright(config, link.href, target);
          downloadError = null;
        } catch (fallbackError) {
          downloadError = fallbackError;
        }
      }
    }
    if (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : String(downloadError);
      return `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nDownload failed: ${message}`;
    }
    await config.diagnostics?.updateCoverage("moodle", { artifacts: [target] });
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

async function downloadResourceWithPlaywright(
  config: MoodleRuntimeConfig,
  url: string,
  target: string,
): Promise<void> {
  throwIfAborted(config.abortSignal);
  const browser = await chromium.launch({ headless: config.headless });
  config.abortSignal?.addEventListener("abort", () => {
    void browser.close();
  }, { once: true });
  try {
    const context = await browser.newContext(
      config.storageState ? { storageState: config.storageState } : undefined,
    );
    const page = await context.newPage();
    await ensureLoggedIn(page, {
      serviceName: "Moodle",
      targetUrl: config.dashboardUrl || config.moodleUrl,
      username: config.username,
      password: config.password,
    });
    const response = await context.request.get(url, {
      failOnStatusCode: false,
      timeout: 60_000,
    });
    if (!response.ok()) {
      throw new Error(`Moodle resource download returned HTTP ${response.status()}.`);
    }
    await writeFile(target, await response.body());
    await assertNonEmptyFile(target);
    await assertReadableDownloadedFile(target);
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function assertNonEmptyFile(filePath: string): Promise<void> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size === 0) {
    throw new Error(`Download produced no file at ${filePath}.`);
  }
}

async function fetchSinglePageWithPlaywright(
  config: MoodleRuntimeConfig,
  url: string,
  index: number,
): Promise<PageFetchResult> {
  let browser: Browser | null = null;
  try {
    const openViolation = quizUrlPolicyViolation(config, url);
    if (openViolation) {
      await recordQuizPolicyBlock(config, openViolation);
      return {
        ok: false,
        chunk: formatWarning("Moodle quiz safety", openViolation.message),
        message: openViolation.message,
        failureKind: "unknown",
      };
    }
    await config.diagnostics?.log("info", "moodle_crawl", `Playwright diagnostic fallback: ${url}`);
    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext(
      config.storageState ? { storageState: config.storageState } : undefined,
    );
    const page = await context.newPage();
    await ensureLoggedIn(page, {
      serviceName: "Moodle",
      targetUrl: config.dashboardUrl || config.moodleUrl,
      username: config.username,
      password: config.password,
    });
    const opened = await gotoWithDiagnostics(page, config, url, index);
    if (!opened.ok) {
      return {
        ok: false,
        chunk: formatWarning("Moodle", opened.message),
        message: opened.message,
        failureKind: "timeout",
      };
    }
    const title = await page.title().catch(() => url);
    const readViolation = quizReadPolicyViolation(config, page.url() || url, title);
    if (readViolation) {
      await recordQuizPolicyBlock(config, readViolation);
      return {
        ok: false,
        chunk: formatWarning("Moodle quiz safety", readViolation.message),
        message: readViolation.message,
        failureKind: "unknown",
      };
    }
    const text = await page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
    const resolvedUrl = page.url() || url;
    return {
      ok: true,
      chunk: formatSourceChunk({ title, url: resolvedUrl, text }),
      url: resolvedUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = `Playwright diagnostic fallback failed for ${url}: ${message}`;
    return {
      ok: false,
      chunk: formatWarning("Moodle", detail),
      message: detail,
      failureKind: isAuthFailure(message) ? "auth" : "unknown",
    };
  } finally {
    await browser?.close();
  }
}

async function recoverAgentBrowserSnapshot(
  client: AgentBrowserClient,
  requestedUrl: string,
): Promise<AgentBrowserSnapshot | null> {
  const snapshot = await client
    .snapshot({ interactive: true, urls: true, compact: true })
    .catch(() => null);
  if (
    !snapshot ||
    !isMatchingMoodleLocation(requestedUrl, snapshot.origin) ||
    !snapshotToText(snapshot.snapshot).trim()
  ) {
    return null;
  }
  if (await looksLikeAgentBrowserLoginPage(client).catch(() => true)) {
    return null;
  }
  return snapshot;
}

function isMatchingMoodleLocation(requestedUrl: string, currentUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl);
    const current = new URL(currentUrl);
    if (requested.origin !== current.origin || requested.pathname !== current.pathname) {
      return false;
    }
    const requestedId = requested.searchParams.get("id");
    return !requestedId || requestedId === current.searchParams.get("id");
  } catch {
    return false;
  }
}

function isTimeoutFailure(message: string): boolean {
  return /\btime(?:d\s*out|out)\b/i.test(message);
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
      throw new Error("Moodle login is required or the session expired while opening the page.");
    }
    const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (!text.trim()) {
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    }
    return { ok: true };
  } catch (firstError) {
    await config.diagnostics?.capturePageDiagnostics(
      "moodle",
      page,
      `${index}-timeout-initial`,
      firstError,
    );
    await config.diagnostics?.log("warn", "moodle_crawl", `Initial Moodle open failed; retrying: ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      if (text.trim()) {
        await config.diagnostics?.updateCoverage("moodle", {
          status: "partial",
          detail: `Moodle URL loaded partially after retry: ${url}`,
        });
        return { ok: true };
      }
      throw firstError;
    } catch (secondError) {
      const message = secondError instanceof Error ? secondError.message : String(secondError);
      await config.diagnostics?.capturePageDiagnostics(
        "moodle",
        page,
        `${index}-timeout-final`,
        secondError,
      );
      await config.diagnostics?.markFailure("moodle", {
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

async function extractMoodleLinks(page: Page, config: MoodleRuntimeConfig): Promise<string[]> {
  const origin = new URL(config.baseUrl).origin;
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
  const seen = new Set<string>();
  const relevantLinks = hrefs
    .filter(({ href }) => href.startsWith(origin))
    .filter(
      ({ href }) =>
        href.includes("/course/") || href.includes("/mod/") || href.includes("/pluginfile.php"),
    )
    .filter(({ href }) => {
      if (seen.has(href)) {
        return false;
      }
      seen.add(href);
      return true;
    });
  const resolved = resolveCourseTargetsFromLinks(config.prompt, relevantLinks);
  if (resolved.selectedUrls.length > 0) {
    config.targetCourseUrls = resolved.selectedUrls;
  }
  return selectRelevantMoodleLinks(relevantLinks, config.prompt);
}

async function captureFileLinks(
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
  const fileLinks = selectRelevantFileLinks(
    hrefs.filter(({ href }) => isReadableResourceLink(href)),
    config.prompt,
    config.intentDecision?.needsCourseMaterial ? 60 : 3,
    config.intentDecision?.needsCourseMaterial ? Number.NEGATIVE_INFINITY : 90,
  ).filter(({ href }) => {
    const normalized = normalizeMoodleUrl(href);
    if (downloaded.has(normalized)) {
      return false;
    }
    downloaded.add(normalized);
    return true;
  });
  const jobs = fileLinks.map((link, index) => async () => {
    throwIfAborted(config.abortSignal);
    const filename = readableFileName(
      `${index + 1}-${link.label || path.basename(new URL(link.href).pathname)}`,
      link.href,
    );
    const target = path.join(sourcesDir, filename);
    await config.diagnostics?.log("info", "moodle_download", `Downloading Moodle file: ${link.href}`);
    const response = await page
      .context()
      .request.get(link.href)
      .catch(() => null);
    if (!response?.ok()) {
      return `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nDownload failed`;
    }

    const body = await response.body();
    try {
      await writeFile(target, body);
      await assertNonEmptyFile(target);
      await assertReadableDownloadedFile(target);
      await config.diagnostics?.updateCoverage("moodle", { artifacts: [target] });
      const text = await extractReadableFileText(target).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return `Readable text extraction failed: ${message}`;
      });
      return `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nSaved path: ${target}\n\n${text.trim()}`;
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      return `[Linked file]\nTitle: ${link.label || filename}\nURL: ${link.href}\nDownload failed: ${message}`;
    }
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

async function capturePlaywrightResourceSnapshot(
  page: Page,
  sourcesDir: string,
  index: number,
  title: string,
  origin: string,
): Promise<void> {
  const links = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor, anchorIndex) => {
      const element = anchor as HTMLAnchorElement;
      const section = element.closest("[data-sectionid], li.section, section");
      const sectionTitle = section
        ?.querySelector("h2, h3, h4, .sectionname")
        ?.textContent
        ?.replace(/\s+/g, " ")
        .trim() ?? "";
      return {
        ref: `pw-${anchorIndex + 1}`,
        href: element.href,
        label: (element.innerText || element.textContent || element.href).replace(/\s+/g, " ").trim(),
        sectionTitle,
      };
    }),
  );
  let currentSection = "";
  const lines: string[] = [];
  const refs: AgentBrowserSnapshot["refs"] = {};
  for (const link of links) {
    if (link.sectionTitle && link.sectionTitle !== currentSection) {
      currentSection = link.sectionTitle;
      lines.push(`- heading ${JSON.stringify(currentSection)} [level=3, ref=section-${link.ref}]`);
    }
    refs[link.ref] = { role: "link", name: link.label };
    lines.push(`- link ${JSON.stringify(link.label)} [ref=${link.ref}, url=${link.href}]`);
  }
  const snapshot: AgentBrowserSnapshot = {
    origin,
    refs,
    snapshot: lines.join("\n"),
  };
  await writeFile(
    path.join(sourcesDir, safeFileName(`${index}-${title}-resource-snapshot.json`)),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

function formatSourceChunk(input: { title: string; url: string; text: string }): string {
  return [
    "[Moodle page]",
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    "",
    input.text.trim(),
  ].join("\n");
}

function formatWarning(source: string, message: string): string {
  return [`[${source} warning]`, message].join("\n");
}

function quizUrlPolicyViolation(
  config: MoodleRuntimeConfig,
  url: string,
  context: QuizContext = {},
): QuizPolicyViolation | null {
  if (isMoodleQuizFinalSubmitUrl(url)) {
    return quizViolation(config, "final_submit", { ...context, url });
  }
  if (isMoodleQuizSaveOrMoveUrl(url)) {
    return quizViolation(config, "save_or_move_page", { ...context, url });
  }
  if (isMoodleQuizAttemptUrl(url)) {
    if (context.timed) {
      const timedViolation = quizViolation(config, "open_timed_quiz", { ...context, url });
      if (timedViolation) {
        return timedViolation;
      }
    }
    if (context.limitedAttempts) {
      const limitedAttemptViolation = quizViolation(config, "open_limited_attempt_quiz", { ...context, url });
      if (limitedAttemptViolation) {
        return limitedAttemptViolation;
      }
    }
    return quizViolation(config, "open_attempt", { ...context, url });
  }
  return null;
}

function quizReadPolicyViolation(
  config: MoodleRuntimeConfig,
  url: string,
  title: string,
): QuizPolicyViolation | null {
  return isMoodleQuizAttemptUrl(url)
    ? quizViolation(config, "read_questions", { url, title })
    : null;
}

function quizRestrictionPolicyViolations(
  config: MoodleRuntimeConfig,
  context: QuizContext,
): QuizPolicyViolation[] {
  return [
    context.timed ? quizViolation(config, "open_timed_quiz", context) : null,
    context.limitedAttempts ? quizViolation(config, "open_limited_attempt_quiz", context) : null,
  ].filter((violation): violation is QuizPolicyViolation => Boolean(violation));
}

function quizViolation(
  config: MoodleRuntimeConfig,
  action: Parameters<typeof assertQuizPolicyAllows>[1],
  context: QuizContext,
): QuizPolicyViolation | null {
  try {
    assertQuizPolicyAllows(config.quizPolicy, action, context);
    return null;
  } catch (error) {
    if (error instanceof QuizPolicyViolation) {
      return error;
    }
    throw error;
  }
}

async function recordQuizPolicyBlock(
  config: MoodleRuntimeConfig,
  violation: QuizPolicyViolation,
): Promise<void> {
  await config.diagnostics?.log("warn", "diagnostic", violation.message);
}

function snapshotToText(snapshot: string): string {
  return snapshot
    .split("\n")
    .map((line) => line.replace(/\s*\[ref=[^\]]+\]/g, "").replace(/\s*url=\S+/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

function extractMoodleLinksFromSnapshot(
  snapshot: AgentBrowserSnapshot,
  config: MoodleRuntimeConfig,
): string[] {
  const origin = new URL(config.baseUrl).origin;
  const links = extractSnapshotLinks(snapshot)
    .filter(({ href }) => href.startsWith(origin))
    .filter(
      ({ href }) =>
        href.includes("/course/") || href.includes("/mod/") || href.includes("/pluginfile.php"),
    );
  const resolved = resolveCourseTargetsFromLinks(config.prompt, links);
  if (resolved.selectedUrls.length > 0) {
    config.targetCourseUrls = resolved.selectedUrls;
  }
  return selectRelevantMoodleLinks(links, config.prompt);
}

function extractSnapshotLinks(
  snapshot: AgentBrowserSnapshot,
): Array<{ ref: string; href: string; label: string }> {
  return snapshot.snapshot
    .split("\n")
    .map((line) => {
      const ref = /ref=([a-z0-9_-]+)/i.exec(line)?.[1] ?? "";
      const href = /url=([^\]\s]+)/i.exec(line)?.[1] ?? "";
      const label = snapshot.refs[ref]?.name || /"([^"]+)"/.exec(line)?.[1] || line;
      return { ref, href, label };
    })
    .filter((link) => link.ref && link.href);
}

function hasBodyText(chunk: string): boolean {
  const lines = chunk.split("\n").slice(4).join("\n").trim();
  return lines.length > 0 && !/^download failed$/i.test(lines);
}

export function scoreMoodleLink(link: { href: string; label: string }, prompt: string): number {
  const haystack = `${link.href}\n${link.label}`.toLowerCase();
  const haystackTokens = new Set(textTokens(haystack));
  let score = 0;
  if (isLowValueMoodleUtilityLink(link)) {
    score -= 500;
  }
  if (link.href.includes("/course/view.php")) {
    score += 10;
    score += scoreCourseFocus(link.label, prompt);
  }
  if (link.href.includes("/mod/assign/")) {
    score += 25;
  }
  if (link.href.includes("/mod/page/")) {
    score += 20;
  }
  if (link.href.includes("/pluginfile.php")) {
    score -= 10;
  }
  if (link.href.includes("/mod/forum/")) {
    score -= 50;
  }
  const linkId = new URL(link.href).searchParams.get("id");
  if (linkId && explicitMoodleIds(prompt).has(linkId)) {
    score += 1_000;
  }
  for (const token of promptTokens(prompt)) {
    if (haystackTokens.has(token)) {
      score += 100;
    }
  }
  return score;
}

function promptTokens(prompt: string): string[] {
  const tokens = textTokens(prompt).filter(
    (token) => !PROMPT_TOKEN_STOPWORDS.has(token) && !/^\d+$/.test(token),
  );
  if (/\b(?:dc[\s_-]?dc|dcdc|gleichspannungswandler|wandler)\b/i.test(prompt)) {
    tokens.push("tiefsetzsteller", "hochsetzsteller", "buck", "boost");
  }
  return [...new Set(tokens)];
}

function explicitMoodleIds(prompt: string): Set<string> {
  return new Set(
    [...prompt.matchAll(/\bid\s*=\s*(\d{5,})/gi)].map((match) => match[1]),
  );
}

function textTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9äöüß]{3,}/gi) ?? [])];
}

export function selectRelevantMoodleLinks(
  links: { href: string; label: string }[],
  prompt: string,
): string[] {
  const resolvedTarget = resolveCourseTargetsFromLinks(prompt, links);
  if (resolvedTarget.selectedUrls.length > 0) {
    return resolvedTarget.selectedUrls;
  }
  const unique = new Map<string, { href: string; label: string; score: number }>();
  for (const link of links) {
    const normalized = normalizeMoodleUrl(link.href);
    const scoredLink = {
      href: normalized,
      label: link.label,
      score: scoreMoodleLink(link, prompt),
    };
    const current = unique.get(normalized);
    if (!current || scoredLink.score > current.score) {
      unique.set(normalized, scoredLink);
    }
  }
  const scored = [...unique.values()]
    .sort((left, right) => right.score - left.score);
  const focusedCourses = selectFocusedCourseLinks(scored, prompt);
  if (focusedCourses.length > 0) {
    return focusedCourses;
  }
  const relevant = scored.filter((link) => link.score >= 100);
  const selected = relevant.length > 0
    ? relevant
    : scored.filter((link) => link.href.includes("/course/view.php"));
  return selected.slice(0, 4).map(({ href }) => normalizeMoodleUrl(href));
}

function selectFocusedCourseLinks(
  scored: { href: string; label: string; score: number }[],
  prompt: string,
): string[] {
  const target = extractCourseTargetHint(prompt);
  if (target.requestedCodes.length === 0 && target.requestedNames.length === 0) {
    return [];
  }
  const courses = scored
    .filter((link) => link.href.includes("/course/view.php"))
    .map((link) => ({
      ...link,
      focusScore: scoreCourseFocus(link.label, prompt),
    }))
    .filter((link) => link.focusScore >= 900)
    .sort((left, right) => right.focusScore - left.focusScore || right.score - left.score);
  if (courses.length === 0) {
    return [];
  }

  const [best, second] = courses;
  if (!second || best.focusScore - second.focusScore >= 300) {
    return [normalizeMoodleUrl(best.href)];
  }

  return courses
    .filter((course) => best.focusScore - course.focusScore < 300)
    .slice(0, 4)
    .map(({ href }) => normalizeMoodleUrl(href));
}

export function scoreCourseFocus(label: string, prompt: string): number {
  let score = scoreCourseTargetLabel(label, extractCourseTargetHint(prompt));
  const labelTokens = textTokens(label);

  const promptTerms = promptTokens(prompt).filter((token) => token.length >= 4);
  for (let size = Math.min(4, promptTerms.length); size >= 2; size -= 1) {
    for (let index = 0; index <= promptTerms.length - size; index += 1) {
      const phrase = promptTerms.slice(index, index + size);
      if (hasOrderedTokens(labelTokens, phrase)) {
        score += size >= 3 ? 1_200 : 900;
        return score;
      }
    }
  }

  return score;
}

export function explicitCourseCodes(prompt: string): string[] {
  return explicitCourseCodesFromText(prompt);
}

export function isLowValueMoodleUtilityLink(link: { href: string; label: string }): boolean {
  const text = `${link.href} ${link.label}`.toLowerCase();
  return /(?:moodle\s*hilfe|moodle\s*tipps|generico|qr\s*codes?|particify|w3schools|fontawesome|\/mod\/forum\/|news|nachrichtenforum|ankündigungen|ankuendigungen)/i
    .test(text);
}

function hasOrderedTokens(haystack: string[], needle: string[]): boolean {
  let offset = 0;
  for (const token of needle) {
    const next = haystack.indexOf(token, offset);
    if (next === -1) {
      return false;
    }
    offset = next + 1;
  }
  return true;
}

export function selectRelevantFileLinks<T extends { href: string; label: string }>(
  links: T[],
  prompt: string,
  limit = 3,
  minimumScore = 90,
): T[] {
  const unique = new Map<string, T>();
  for (const link of links) {
    if (isReadableResourceLink(link.href)) {
      unique.set(normalizeMoodleUrl(link.href), link);
    }
  }
  return [...unique.values()]
    .map((link) => ({ link, score: scoreMoodleLink(link, prompt) }))
    .filter(({ score }) => score >= minimumScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ link }) => link);
}

function isReadableResourceLink(href: string): boolean {
  const url = new URL(href);
  return (
    /\.(pdf|txt|md)$/i.test(url.pathname) ||
    url.pathname.includes("/mod/resource/view.php") ||
    url.pathname.includes("/pluginfile.php")
  );
}

function readableFileName(label: string, href: string): string {
  const urlPath = new URL(href).pathname;
  const extension = /\.(pdf|txt|md)$/i.exec(urlPath)?.[0]?.toLowerCase() ??
    (urlPath.includes("/mod/resource/view.php") ? ".pdf" : "");
  const safe = safeFileName(label);
  return extension && !safe.toLowerCase().endsWith(extension) ? `${safe}${extension}` : safe;
}

function normalizeMoodleUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of ["time", "forcedownload"]) {
    parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const PROMPT_TOKEN_STOPWORDS = new Set([
  "alle",
  "als",
  "auf",
  "aus",
  "antworten",
  "aufgabe",
  "aufgaben",
  "aufgabenstellung",
  "auswertung",
  "bericht",
  "berichte",
  "brauchen",
  "course",
  "der",
  "das",
  "die",
  "doc",
  "dokument",
  "deutsches",
  "detaillierten",
  "detail",
  "eine",
  "ein",
  "einem",
  "einen",
  "einer",
  "erstelle",
  "erstellen",
  "extrahiere",
  "für",
  "ich",
  "im",
  "in",
  "infos",
  "id",
  "labor",
  "laborangabe",
  "messung",
  "messungen",
  "pdf",
  "protokoll",
  "protokollaufgabe",
  "quelle",
  "quellen",
  "skript",
  "theorie",
  "vorbereitung",
  "vorbereitungsdokument",
  "versuch",
  "meine",
  "mod",
  "moodle",
  "php",
  "resource",
  "assign",
  "view",
  "und",
  "verwende",
  "verwendet",
  "von",
  "wenn",
  "wie",
  "wir",
  "datum",
  "exact",
  "exaktem",
  "kommende",
  "lernunterlagen",
  "naechste",
  "nächste",
  "pruefung",
  "prüfung",
  "raum",
  "termin",
  "uhrzeit",
  "zu",
  "zur",
  "zum",
]);
