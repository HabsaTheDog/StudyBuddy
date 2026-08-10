import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { createAgentBrowserClient, type AgentBrowserClient, type AgentBrowserSnapshot } from "../agentBrowserClient.js";
import { launchMoodleBrowser } from "../browserLaunch.js";
import {
  dismissCommonOverlays,
  ensureAgentBrowserLoggedIn,
  ensureLoggedIn,
  isAuthFailure,
  looksLikeAgentBrowserLoginPage,
  looksLikeLoginPage,
} from "../browserAuth.js";
import { assertReadableDownloadedFile, extractReadableFile, extractReadableFileText, type FileExtractionResult } from "../fileTextExtraction.js";
import { recordExtractionResult } from "../extractionReport.js";
import { safeFileName } from "../runDiagnostics.js";
import { throwIfAborted } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { runDownloadQueue } from "../downloadQueue.js";
import { ResourceAttemptRecorder } from "../resourceAttemptRecorder.js";
import {
  planInitialResourceProbe,
  planCourseResources,
  remainingInitialProbeSlots,
  writeResourcePlan,
  type PlannedResource,
  type ResourcePlanningCandidate,
} from "../resourcePlanning.js";
import { resolveTaskBudget } from "../taskBudget.js";
import { writeRunProgress } from "../runProgress.js";
import { assertPublicHttpsUrl, hasExactOrigin } from "../urlSecurity.js";
import {
  classifyResourceFailure,
  formatResourceFailureBlock,
  inspectResourcePayload,
  isKnownPdfEndpoint,
} from "../resourceAcquisition.js";
import {
  explicitCourseCodesFromText,
  extractCourseTargetHint,
  resolveCourseTargetsFromLinks,
  scoreCourseTargetLabel,
} from "../courseTargeting.js";
import { isLikelyMoodleUrl } from "../moodleSite.js";
import {
  assertQuizPolicyAllows,
  detectQuizRestrictions,
  isMoodleQuizAttemptUrl,
  isMoodleQuizFinalSubmitUrl,
  isMoodleQuizSaveOrMoveUrl,
  QuizPolicyViolation,
  type QuizContext,
} from "../quizPolicy.js";
import {
  createStudyBuilderQuizEvidenceCapability,
  type StudyBuilderQuizEvidenceAuditEntry,
  type StudyBuilderQuizEvidenceCapability,
} from "../interactive/quizEvidencePolicy.js";

interface CrawlPage {
  url: string;
  depth: number;
}

interface CompletedQuizReviewEvidence {
  title: string;
  url: string;
  text: string;
}

const STUDY_BUILDER_QUIZ_EVIDENCE_AUDIT_FILE = "quiz-evidence-audit.json";
const MAX_RESOURCE_DOWNLOAD_BYTES = 100 * 1024 * 1024;

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
    const taskBudget = resolveTaskBudget(config.intentDecision);

    try {
      if (config.browserBackend === "agent-browser") {
        return scrapeWithAgentBrowser(config, state);
      }

      await diagnostics?.log("info", "moodle_login", "Opening Moodle dashboard...");
      browser = await launchMoodleBrowser({
        headless: config.headless,
        abortSignal: config.abortSignal,
        purpose: "Moodle scraper",
      });
      const closeOnAbort = () => {
        void browser?.close();
      };
      config.abortSignal?.addEventListener("abort", closeOnAbort, { once: true });
      const context = await browser.newContext(
        config.storageState ? { storageState: config.storageState } : undefined,
      );
      const activePage = await context.newPage();
      page = activePage;
      await ensureLoggedIn(activePage, {
        serviceName: "Moodle",
        targetUrl: config.dashboardUrl || config.moodleUrl,
        username: config.username,
        password: config.password,
        allowedOrigins: config.moodleLoginAllowedOrigins,
      });
      await diagnostics?.log("info", "moodle_login", "Moodle login ok.");
      const quizEvidenceCapability =
        createPlaywrightStudyBuilderQuizEvidenceCapability(config, activePage);

      const queue: CrawlPage[] = [{ url: config.moodleUrl, depth: 0 }];
      const sourcesDir = path.join(config.runDir, "sources");
      await mkdir(sourcesDir, { recursive: true });

      while (queue.length > 0 && visited.size < config.maxPages) {
        throwIfAborted(config.abortSignal);
        const next = queue.shift();
        if (!next || visited.has(next.url)) {
          continue;
        }
        if (isOutsideResolvedCourseScope(next.url, configuredCourseScope(config))) {
          await diagnostics?.log(
            "info",
            "moodle_crawl",
            `Skipped cross-course Moodle URL outside the resolved course scope: ${next.url}`,
          );
          continue;
        }
        if (
          config.evidenceHandoffOnly &&
          isMoodleCompletedAttemptReviewUrl(next.url)
        ) {
          visited.add(next.url);
          await diagnostics?.markAttempt(
            "moodle",
            next.url,
            "Opening an already-discovered completed quiz review through the read-only Study Builder adapter.",
          );
          try {
            const reviewResult =
              await quizEvidenceCapability.readCompletedAttemptReview({
                completionState: "completed",
                reviewUrl: next.url,
              });
            if (reviewResult.status === "read") {
              const evidence = reviewResult.evidence;
              successfulUrls.add(evidence.url);
              chunks.push(formatSourceChunk(evidence));
              await capturePlaywrightResourceSnapshot(
                activePage,
                sourcesDir,
                visited.size,
                evidence.title,
                evidence.url,
              );
            } else {
              chunks.push(
                formatWarning(
                  "Moodle quiz safety",
                  `Completed-attempt review was not read: ${reviewResult.decision.reason}.`,
                ),
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            chunks.push(
              formatWarning(
                "Moodle quiz safety",
                `Completed-attempt review could not be read safely: ${message}`,
              ),
            );
          } finally {
            await persistStudyBuilderQuizEvidenceAudit(
              config,
              quizEvidenceCapability.getAuditEntries(),
            );
          }
          // Review pages are evidence leaves. Never follow their controls or links.
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
        await expandPlaywrightScheduleSections(page, config);

        const title = await page.title().catch(() => next.url);
        const resolvedUrl = page.url() || next.url;
        if (isOutsideResolvedCourseScope(resolvedUrl, configuredCourseScope(config))) {
          await diagnostics?.log(
            "warn",
            "moodle_crawl",
            `Ignored Moodle redirect outside the resolved course scope: ${next.url} -> ${resolvedUrl}`,
          );
          continue;
        }
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

        if (
          config.allowFileDownloads &&
          taskBudget.maxDownloadedFiles > 0 &&
          shouldCaptureFilesOnPage(config, resolvedUrl)
        ) {
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
            if (config.allowFileDownloads && taskBudget.maxDownloadedFiles > 0 && isReadableResourceLink(link)) {
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
  const taskBudget = resolveTaskBudget(config.intentDecision);
  const failures: PageFetchFailure[] = [];
  let recoveredPages = 0;

  try {
    await diagnostics?.log("info", "moodle_login", "Opening Moodle dashboard with agent-browser...");
    await ensureAgentBrowserLoggedIn(client, {
      serviceName: "Moodle",
      targetUrl: config.dashboardUrl || config.moodleUrl,
      username: config.username,
      password: config.password,
      allowedOrigins: config.moodleLoginAllowedOrigins,
    });
    await diagnostics?.log("info", "moodle_login", "Moodle login ok with agent-browser.");
    const quizEvidenceCapability =
      createAgentBrowserStudyBuilderQuizEvidenceCapability(config, client);

    const queue: CrawlPage[] = [{ url: config.moodleUrl, depth: 0 }];
    const sourcesDir = path.join(config.runDir, "sources");
    await mkdir(sourcesDir, { recursive: true });

    while (queue.length > 0 && visited.size < config.maxPages) {
      throwIfAborted(config.abortSignal);
      const next = queue.shift();
      if (!next || visited.has(next.url)) {
        continue;
      }
      if (isOutsideResolvedCourseScope(next.url, configuredCourseScope(config))) {
        await diagnostics?.log(
          "info",
          "moodle_crawl",
          `Skipped cross-course Moodle URL outside the resolved course scope: ${next.url}`,
        );
        continue;
      }
      if (
        config.evidenceHandoffOnly &&
        isMoodleCompletedAttemptReviewUrl(next.url)
      ) {
        visited.add(next.url);
        await diagnostics?.markAttempt(
          "moodle",
          next.url,
          "Opening an already-discovered completed quiz review through the read-only Study Builder adapter.",
        );
        try {
          const reviewResult =
            await quizEvidenceCapability.readCompletedAttemptReview({
              completionState: "completed",
              reviewUrl: next.url,
            });
          if (reviewResult.status === "read") {
            const evidence = reviewResult.evidence;
            successfulUrls.add(evidence.url);
            chunks.push(formatSourceChunk(evidence));
            await writeFile(
              path.join(
                sourcesDir,
                safeFileName(`${visited.size}-${evidence.title || "quiz-review"}.json`),
              ),
              `${JSON.stringify(
                {
                  origin: evidence.url,
                  kind: "completed-quiz-review",
                  text: evidence.text,
                },
                null,
                2,
              )}\n`,
              "utf8",
            );
          } else {
            chunks.push(
              formatWarning(
                "Moodle quiz safety",
                `Completed-attempt review was not read: ${reviewResult.decision.reason}.`,
              ),
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          chunks.push(
            formatWarning(
              "Moodle quiz safety",
              `Completed-attempt review could not be read safely: ${message}`,
            ),
          );
        } finally {
          await persistStudyBuilderQuizEvidenceAudit(
            config,
            quizEvidenceCapability.getAuditEntries(),
          );
        }
        // Review pages are evidence leaves. Never follow their controls or links.
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
      if (isOutsideResolvedCourseScope(snapshot.origin || next.url, configuredCourseScope(config))) {
        await diagnostics?.log(
          "warn",
          "moodle_crawl",
          `Ignored agent-browser result outside the resolved course scope: ${next.url} -> ${snapshot.origin}`,
        );
        continue;
      }
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

      if (
        config.allowFileDownloads &&
        taskBudget.maxDownloadedFiles > 0 &&
        shouldCaptureFilesOnPage(config, snapshot.origin || next.url)
      ) {
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
        const links = [
          ...(isBoundedScheduleProbe(config) ? scheduleSectionUrlsFromSnapshot(snapshot) : []),
          ...extractMoodleLinksFromSnapshot(snapshot, config),
        ];
        for (const link of links) {
          const linkViolation = quizUrlPolicyViolation(config, link, quizContext);
          if (linkViolation) {
            await recordQuizPolicyBlock(config, linkViolation);
            continue;
          }
          if (config.allowFileDownloads && taskBudget.maxDownloadedFiles > 0 && isReadableResourceLink(link)) {
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
  if (downloaded.size >= resolveTaskBudget(config.intentDecision).maxDownloadedFiles) {
    return;
  }
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
    const metadata = await downloadResourceWithPlaywright(config, origin, target);
    const savedTarget = metadata.localPath;
    await config.diagnostics?.updateCoverage("moodle", { artifacts: [savedTarget] });
    const text = await extractReadableFileText(savedTarget);
    chunks.push(
      formatResourceSuccessBlock({
        title: basename,
        url: origin,
        target: savedTarget,
        text,
        metadata,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await config.diagnostics?.log(
      "warn",
      "moodle_download",
      `Opened Moodle resource download failed: ${message}`,
    );
    chunks.push(resourceFailureBlock(basename, origin, error));
  }
}

async function captureAgentBrowserFileLinks(
  _client: AgentBrowserClient,
  snapshot: AgentBrowserSnapshot,
  sourcesDir: string,
  chunks: string[],
  config: MoodleRuntimeConfig,
  downloaded: Set<string>,
): Promise<void> {
  const budget = resolveTaskBudget(config.intentDecision);
  const remaining = Math.max(0, budget.maxDownloadedFiles - downloaded.size);
  if (remaining === 0) return;
  const scheduleLookup = isBoundedScheduleProbe(config);
  const eligibleLinks = extractSnapshotLinks(snapshot)
    .filter(({ href }) => isReadableResourceLink(href))
    .filter((link) => !scheduleLookup || isScheduleDocumentLink(link));
  const plannedLinks = await planFileLinks(eligibleLinks, config, remaining);
  const fileLinks = plannedLinks.filter(({ candidate: { href } }) => {
    const normalized = normalizeMoodleUrl(href);
    if (downloaded.has(normalized)) {
      return false;
    }
    downloaded.add(normalized);
    return true;
  });
  let sharedSessionPromise: Promise<ResourceDownloadSession> | null = null;
  const sharedSession = () => {
    sharedSessionPromise ??= createResourceDownloadSession(config);
    return sharedSessionPromise;
  };
  const attemptRecorder = new ResourceAttemptRecorder(config.runDir);
  await attemptRecorder.init();
  const jobs = fileLinks.map((planned, index) => async ({ signal }: { signal: AbortSignal }) => {
    const link = planned.candidate;
    throwIfAborted(signal);
    const filename = readableFileName(
      `${index + 1}-${link.label || path.basename(new URL(link.href).pathname)}`,
      link.href,
    );
    const target = path.join(sourcesDir, filename);
    const transport = isExternalResource(link.href) ? "external_request" : "authenticated_request";
    const startedAt = Date.now();
    await attemptRecorder.record({
      resourceIndex: index,
      title: link.label || filename,
      url: link.href,
      status: "started",
      transport,
      attempt: 1,
    });
    await config.executionTelemetry?.recordResourceAttempt("started");
    try {
      await config.diagnostics?.log(
        "info",
        "moodle_download",
        `Authenticated resource download: ${link.href}`,
      );
      const downloadMetadata = await (await sharedSession()).download(link.href, target, signal);
      throwIfAborted(signal);
      const savedTarget = downloadMetadata.localPath;
      await config.diagnostics?.updateCoverage("moodle", { artifacts: [savedTarget] });
      const extraction = await extractReadableFile(savedTarget, { signal, commandTimeoutMs: 60_000 });
      await recordExtractionResult(config.runDir, extraction);
      await attemptRecorder.record({
        resourceIndex: index,
        title: link.label || filename,
        url: link.href,
        status: "completed",
        transport,
        attempt: 1,
        durationMs: Date.now() - startedAt,
        bytes: downloadMetadata.bytes,
        resolvedUrl: downloadMetadata.resolvedUrl,
        localPath: savedTarget,
      });
      await config.executionTelemetry?.recordResourceAttempt("completed", downloadMetadata.bytes);
      return formatResourceSuccessBlock({
        title: link.label || filename,
        url: link.href,
        target: savedTarget,
        text: extraction.text || extractionFailureText(extraction),
        metadata: downloadMetadata,
        planned,
        extraction,
      });
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      const status = signal.aborted
        ? /timed out/i.test(errorMessage(error)) ? "timed_out" : "canceled"
        : "failed";
      await attemptRecorder.record({
        resourceIndex: index,
        title: link.label || filename,
        url: link.href,
        status,
        transport,
        attempt: 1,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error),
      });
      await config.executionTelemetry?.recordResourceAttempt(status);
      return resourceFailureBlock(link.label || filename, link.href, error, planned, {
        status,
        transport,
        attempts: 1,
        durationMs: Date.now() - startedAt,
      });
    }
  });
  const results = await runClassifiedResourceJobs(
    fileLinks,
    jobs,
    config.downloadConcurrency,
    config.abortSignal,
    config.executionProfile,
  );
  for (const [index, result] of results.entries()) {
    chunks.push(result.status === "fulfilled"
      ? result.value
      : resourceFailureBlock(
        fileLinks[index]?.candidate.label || `Ressource ${index + 1}`,
        fileLinks[index]?.candidate.href || snapshot.origin,
        result.reason,
        fileLinks[index],
      ));
  }
  const sessionToClose = sharedSessionPromise as Promise<ResourceDownloadSession> | null;
  if (sessionToClose) {
    await sessionToClose.then((session) => session.close()).catch(() => undefined);
  }
}

async function downloadResourceWithPlaywright(
  config: MoodleRuntimeConfig,
  url: string,
  target: string,
): Promise<ResourceDownloadMetadata> {
  throwIfAborted(config.abortSignal);
  const session = await createResourceDownloadSession(config);
  try {
    return await session.download(url, target);
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await session.close();
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
    browser = await launchMoodleBrowser({
      headless: config.headless,
      abortSignal: config.abortSignal,
      purpose: "Moodle diagnostic fallback",
    });
    const context = await browser.newContext(
      config.storageState ? { storageState: config.storageState } : undefined,
    );
    const page = await context.newPage();
    await ensureLoggedIn(page, {
      serviceName: "Moodle",
      targetUrl: config.dashboardUrl || config.moodleUrl,
      username: config.username,
      password: config.password,
      allowedOrigins: config.moodleLoginAllowedOrigins,
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
    .filter(({ href }) => hasExactOrigin(href, origin))
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
  let courseScope = configuredCourseScope(config);
  if (courseScope.length === 0) {
    const resolved = resolveCourseTargetsFromLinks(config.prompt, relevantLinks);
    if (resolved.selectedUrls.length > 0) {
      config.targetCourseUrls = resolved.selectedUrls;
      courseScope = configuredCourseScope(config);
    }
  }
  return selectMoodleCrawlLinks(
    filterMoodleLinksToCourseScope(relevantLinks, courseScope),
    config,
  );
}

async function captureFileLinks(
  page: Page,
  sourcesDir: string,
  chunks: string[],
  config: MoodleRuntimeConfig,
  downloaded: Set<string>,
): Promise<void> {
  const budget = resolveTaskBudget(config.intentDecision);
  const remaining = Math.max(0, budget.maxDownloadedFiles - downloaded.size);
  if (remaining === 0) return;
  const scheduleLookup = isBoundedScheduleProbe(config);
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
  const eligibleLinks = hrefs
    .filter(({ href }) => isReadableResourceLink(href))
    .filter((link) => !scheduleLookup || isScheduleDocumentLink(link));
  const plannedLinks = await planFileLinks(eligibleLinks, config, remaining);
  const fileLinks = plannedLinks.filter(({ candidate: { href } }) => {
    const normalized = normalizeMoodleUrl(href);
    if (downloaded.has(normalized)) {
      return false;
    }
    downloaded.add(normalized);
    return true;
  });
  const attemptRecorder = new ResourceAttemptRecorder(config.runDir);
  await attemptRecorder.init();
  const jobs = fileLinks.map((planned, index) => async ({ signal }: { signal: AbortSignal }) => {
    const link = planned.candidate;
    throwIfAborted(signal);
    const filename = readableFileName(
      `${index + 1}-${link.label || path.basename(new URL(link.href).pathname)}`,
      link.href,
    );
    const target = path.join(sourcesDir, filename);
    const transport = isExternalResource(link.href) ? "external_request" : "authenticated_request";
    const startedAt = Date.now();
    await attemptRecorder.record({
      resourceIndex: index,
      title: link.label || filename,
      url: link.href,
      status: "started",
      transport,
      attempt: 1,
    });
    await config.executionTelemetry?.recordResourceAttempt("started");
    await config.diagnostics?.log("info", "moodle_download", `Authenticated resource download: ${link.href}`);
    try {
      const metadata = await downloadResourceWithRequest(page.context(), link.href, target, signal);
      await config.diagnostics?.updateCoverage("moodle", { artifacts: [metadata.localPath] });
      const extraction = await extractReadableFile(metadata.localPath, { signal, commandTimeoutMs: 60_000 });
      await recordExtractionResult(config.runDir, extraction);
      await attemptRecorder.record({
        resourceIndex: index,
        title: link.label || filename,
        url: link.href,
        status: "completed",
        transport,
        attempt: 1,
        durationMs: Date.now() - startedAt,
        bytes: metadata.bytes,
        resolvedUrl: metadata.resolvedUrl,
        localPath: metadata.localPath,
      });
      await config.executionTelemetry?.recordResourceAttempt("completed", metadata.bytes);
      return formatResourceSuccessBlock({
        title: link.label || filename,
        url: link.href,
        target: metadata.localPath,
        text: extraction.text || extractionFailureText(extraction),
        metadata,
        planned,
        extraction,
      });
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      const status = signal.aborted
        ? /timed out/i.test(errorMessage(error)) ? "timed_out" : "canceled"
        : "failed";
      await attemptRecorder.record({
        resourceIndex: index,
        title: link.label || filename,
        url: link.href,
        status,
        transport,
        attempt: 1,
        durationMs: Date.now() - startedAt,
        error: errorMessage(error),
      });
      await config.executionTelemetry?.recordResourceAttempt(status);
      return resourceFailureBlock(link.label || filename, link.href, error, planned, {
        status,
        transport,
        attempts: 1,
        durationMs: Date.now() - startedAt,
      });
    }
  });
  const results = await runClassifiedResourceJobs(
    fileLinks,
    jobs,
    config.downloadConcurrency,
    config.abortSignal,
    config.executionProfile,
  );
  for (const [index, result] of results.entries()) {
    chunks.push(result.status === "fulfilled"
      ? result.value
      : resourceFailureBlock(
        fileLinks[index]?.candidate.label || `Ressource ${index + 1}`,
        fileLinks[index]?.candidate.href || page.url(),
        result.reason,
        fileLinks[index],
      ));
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

function createPlaywrightStudyBuilderQuizEvidenceCapability(
  config: MoodleRuntimeConfig,
  page: Page,
): StudyBuilderQuizEvidenceCapability<CompletedQuizReviewEvidence> {
  return createStudyBuilderQuizEvidenceCapability({
    policy: config.quizSafetyPolicy,
    reader: {
      async openCompletedAttemptReview(reference) {
        const opened = await gotoWithDiagnostics(page, config, reference.reviewUrl, 1);
        if (!opened.ok) {
          throw new Error(opened.message);
        }
        await dismissCommonOverlays(page);
        const resolvedUrl = page.url() || reference.reviewUrl;
        const statusText = await page
          .locator(
            ".quizreviewsummary, .quizattemptsummary, table.quizattemptsummary, .quizinfo",
          )
          .innerText({ timeout: 3_000 })
          .catch(() => "");
        return {
          completionState: completedAttemptReviewState(
            reference.reviewUrl,
            resolvedUrl,
            statusText,
          ),
          handle: page,
        };
      },
      async readVisibleCompletedAttemptReview(openedPage) {
        const title = await openedPage.title().catch(() => "Completed Moodle quiz review");
        const url = openedPage.url();
        const text = await openedPage
          .locator("body")
          .innerText({ timeout: 15_000 })
          .catch(() => "");
        return { title, url, text };
      },
    },
  });
}

function createAgentBrowserStudyBuilderQuizEvidenceCapability(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
): StudyBuilderQuizEvidenceCapability<CompletedQuizReviewEvidence> {
  return createStudyBuilderQuizEvidenceCapability({
    policy: config.quizSafetyPolicy,
    reader: {
      async openCompletedAttemptReview(reference) {
        await client.open(reference.reviewUrl);
        const resolvedUrl = await client.getUrl();
        const statusText = await client.evalText(String.raw`
(() => {
  const root = document.querySelector(
    ".quizreviewsummary, .quizattemptsummary, table.quizattemptsummary, .quizinfo"
  );
  return String(root?.innerText || root?.textContent || "").replace(/\s+/g, " ").trim();
})()
        `);
        return {
          completionState: completedAttemptReviewState(
            reference.reviewUrl,
            resolvedUrl,
            statusText,
          ),
          handle: { requestedUrl: reference.reviewUrl, resolvedUrl },
        };
      },
      async readVisibleCompletedAttemptReview(handle) {
        const snapshot = await client.snapshot({
          interactive: true,
          urls: true,
          compact: true,
        });
        if (
          !sameCompletedAttemptReview(
            handle.requestedUrl,
            snapshot.origin || handle.resolvedUrl,
          )
        ) {
          throw new Error("Completed quiz review changed location before evidence read.");
        }
        return {
          title: snapshot.origin || "Completed Moodle quiz review",
          url: snapshot.origin || handle.resolvedUrl,
          text: snapshotToText(snapshot.snapshot),
        };
      },
    },
  });
}

export function isMoodleCompletedAttemptReviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.pathname.endsWith("/mod/quiz/review.php") &&
      Boolean(parsed.searchParams.get("attempt"))
    );
  } catch {
    return false;
  }
}

export function completedAttemptReviewState(
  requestedUrl: string,
  resolvedUrl: string,
  statusText: string,
): "completed" | "active" | "unknown" {
  if (!sameCompletedAttemptReview(requestedUrl, resolvedUrl)) {
    return "unknown";
  }
  const normalized = statusText.replace(/\s+/g, " ").trim();
  if (
    /\b(?:in progress|laufend(?:er|en)? versuch|versuch läuft|versuch laeuft|nicht beendet|not finished)\b/i.test(
      normalized,
    )
  ) {
    return "active";
  }
  if (
    /\b(?:state|status)\s*:?\s*(?:finished|completed|beendet|abgeschlossen)\b/i.test(
      normalized,
    ) ||
    /\b(?:completed on|finished on|beendet am|abgeschlossen am)\b/i.test(normalized)
  ) {
    return "completed";
  }
  return "unknown";
}

function sameCompletedAttemptReview(requestedUrl: string, resolvedUrl: string): boolean {
  try {
    const requested = new URL(requestedUrl);
    const resolved = new URL(resolvedUrl);
    return (
      requested.origin === resolved.origin &&
      requested.pathname.endsWith("/mod/quiz/review.php") &&
      resolved.pathname.endsWith("/mod/quiz/review.php") &&
      Boolean(requested.searchParams.get("attempt")) &&
      requested.searchParams.get("attempt") === resolved.searchParams.get("attempt")
    );
  } catch {
    return false;
  }
}

async function persistStudyBuilderQuizEvidenceAudit(
  config: MoodleRuntimeConfig,
  entries: readonly StudyBuilderQuizEvidenceAuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const filePath = path.join(config.runDir, STUDY_BUILDER_QUIZ_EVIDENCE_AUDIT_FILE);
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        lane: "study-builder-quiz-evidence",
        entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await config.diagnostics?.updateCoverage("moodle", { artifacts: [filePath] });
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
  if (config.evidenceHandoffOnly) {
    if (isMoodleQuizFinalSubmitUrl(url)) {
      return studyBuilderEvidenceLaneViolation("final_submit");
    }
    if (isMoodleQuizSaveOrMoveUrl(url)) {
      return studyBuilderEvidenceLaneViolation("save_or_move_page");
    }
    if (isMoodleQuizAttemptUrl(url)) {
      return studyBuilderEvidenceLaneViolation("open_attempt");
    }
  }
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

function studyBuilderEvidenceLaneViolation(
  action: "open_attempt" | "save_or_move_page" | "final_submit",
): QuizPolicyViolation {
  return new QuizPolicyViolation(
    action,
    `Study Builder quiz evidence blocked ${action}: completed-attempt reviews are read-only.`,
    { reason: "study-builder-quiz-evidence-read-only" },
  );
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

export function scheduleSectionRefs(snapshot: AgentBrowserSnapshot): string[] {
  return scheduleSectionControls(snapshot).map((control) => control.ref);
}

function scheduleSectionControls(
  snapshot: AgentBrowserSnapshot,
): Array<{ ref: string; label: string }> {
  return snapshot.snapshot
    .split("\n")
    .filter((line) => /expanded=false/i.test(line))
    .filter((line) => SCHEDULE_SECTION_PATTERN.test(line))
    .map((line) => ({
      ref: /ref=([a-z0-9_-]+)/i.exec(line)?.[1] ?? "",
      label: /"([^"]+)"/.exec(line)?.[1]?.trim() ?? line,
    }))
    .filter((control) => control.ref)
    .slice(0, 4);
}

export function scheduleSectionUrlsFromSnapshot(
  snapshot: AgentBrowserSnapshot,
): string[] {
  const urls: string[] = [];
  let awaitingSectionId = false;
  for (const line of snapshot.snapshot.split("\n")) {
    const label = /"([^"]+)"/.exec(line)?.[1] ?? "";
    if (
      /url=https?:\/\/[^\]\s]+\/course\/view\.php[^\]\s]*#section-\d+/i.test(line)
      && SCHEDULE_SECTION_PATTERN.test(label)
    ) {
      awaitingSectionId = true;
      continue;
    }
    if (!awaitingSectionId) continue;
    const editUrl = /url=(https?:\/\/[^\]\s]+\/course\/editsection\.php\?id=\d+)/i.exec(line)?.[1];
    if (!editUrl) continue;
    const directUrl = new URL(editUrl.replace(/&amp;/g, "&"));
    directUrl.pathname = directUrl.pathname.replace(/\/editsection\.php$/i, "/section.php");
    urls.push(directUrl.toString());
    awaitingSectionId = false;
  }
  return [...new Set(urls)].slice(0, 3);
}

async function expandPlaywrightScheduleSections(
  page: Page,
  config: MoodleRuntimeConfig,
): Promise<void> {
  if (!isBoundedScheduleProbe(config)) return;
  const controls = page.locator("button[aria-expanded='false'], [role='button'][aria-expanded='false']");
  const count = Math.min(await controls.count().catch(() => 0), 40);
  let expanded = 0;
  for (let index = 0; index < count && expanded < 4; index += 1) {
    const control = controls.nth(index);
    const label = await control.innerText({ timeout: 300 }).catch(() => "");
    if (!SCHEDULE_SECTION_PATTERN.test(label)) continue;
    if (!(await control.isVisible().catch(() => false))) continue;
    await control.click({ timeout: 1_000 }).catch(() => undefined);
    expanded += 1;
  }
  if (expanded > 0) {
    await config.diagnostics?.log(
      "info",
      "moodle_crawl",
      `Expanded ${expanded} schedule-related Moodle section(s).`,
    );
  }
}

function extractMoodleLinksFromSnapshot(
  snapshot: AgentBrowserSnapshot,
  config: MoodleRuntimeConfig,
): string[] {
  const origin = new URL(config.baseUrl).origin;
  const links = extractSnapshotLinks(snapshot)
    .filter(({ href }) => hasExactOrigin(href, origin))
    .filter(
      ({ href }) =>
        href.includes("/course/") || href.includes("/mod/") || href.includes("/pluginfile.php"),
    );
  let courseScope = configuredCourseScope(config);
  if (courseScope.length === 0) {
    const resolved = resolveCourseTargetsFromLinks(config.prompt, links);
    if (resolved.selectedUrls.length > 0) {
      config.targetCourseUrls = resolved.selectedUrls;
      courseScope = configuredCourseScope(config);
    }
  }
  return selectMoodleCrawlLinks(
    filterMoodleLinksToCourseScope(links, courseScope),
    config,
  );
}

function selectMoodleCrawlLinks(
  links: Array<{ href: string; label: string }>,
  config: MoodleRuntimeConfig,
): string[] {
  const selected = selectRelevantMoodleLinks(links, config.prompt);
  if (!config.evidenceHandoffOnly) {
    return selected;
  }
  // Consume only review URLs that the existing course crawl already exposed.
  // This does not discover quiz activities or start a second crawl.
  const completedReviewLinks = links
    .map(({ href }) => normalizeMoodleUrl(href))
    .filter(isMoodleCompletedAttemptReviewUrl)
    .slice(0, 4);
  return [...new Set([...selected, ...completedReviewLinks])];
}

function configuredCourseScope(config: MoodleRuntimeConfig): string[] {
  const resolvedTargets = (config.targetCourseUrls ?? []).filter((url) => moodleCourseIdentity(url));
  if (resolvedTargets.length > 0) {
    return resolvedTargets;
  }
  return moodleCourseIdentity(config.moodleUrl) ? [config.moodleUrl] : [];
}

/**
 * Once course resolution has selected one or more concrete Moodle courses, links
 * to any other course are outside the crawl. Activity, section, and file links
 * remain eligible because Moodle does not encode their owning course in the URL.
 */
export function filterMoodleLinksToCourseScope<T extends { href: string }>(
  links: T[],
  selectedCourseUrls: string[],
): T[] {
  if (selectedCourseUrls.length === 0) return links;
  const allowedCourses = new Set(
    selectedCourseUrls
      .map((url) => moodleCourseIdentity(url))
      .filter((identity): identity is string => Boolean(identity)),
  );
  if (allowedCourses.size === 0) return links;
  return links.filter((link) => {
    const identity = moodleCourseIdentity(link.href);
    return !identity || allowedCourses.has(identity);
  });
}

export function isOutsideResolvedCourseScope(
  url: string,
  selectedCourseUrls: string[],
): boolean {
  return filterMoodleLinksToCourseScope([{ href: url }], selectedCourseUrls).length === 0;
}

function moodleCourseIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith("/course/view.php")) return null;
    const id = parsed.searchParams.get("id");
    return id ? `${parsed.origin}${parsed.pathname}?id=${id}` : null;
  } catch {
    return null;
  }
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
  if (isQuizDiscoveryPrompt(prompt) && isQuizDiscoveryActivityLink(link)) {
    score += link.href.includes("/mod/quiz/") ? 1_000 : 700;
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
  if (isSchedulePrompt(prompt) && isScheduleDocumentLink(link)) {
    score += 500;
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
  if (isQuizDiscoveryPrompt(prompt)) {
    const activities = scored.filter(isQuizDiscoveryActivityLink);
    if (activities.length > 0) {
      return activities.slice(0, 20).map(({ href }) => normalizeMoodleUrl(href));
    }
    return scored
      .filter((link) => link.href.includes("/course/view.php"))
      .slice(0, 8)
      .map(({ href }) => normalizeMoodleUrl(href));
  }
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

function isQuizDiscoveryPrompt(prompt: string): boolean {
  return /\b(?:quiz(?:zes)?|tests?|minitests?|kurztests?|moodle-tests?|testblocks?|self[ -]?checks?|selbsttests?|selbstkontrollen?)\b/i.test(prompt) &&
    /\b(?:find|list|scan|look through|show|search|discover|available|attemptable|still open|currently open|offen|verfügbar|verfuegbar|durchsuch|auflist|anzeig|finde|suche)\w*\b/i.test(prompt);
}

function isQuizDiscoveryActivityLink(link: { href: string; label: string }): boolean {
  return /\/mod\/(?:quiz|hotquestion|questionnaire|feedback|choice)\/view\.php/i.test(link.href) ||
    /\b(?:quiz|test|minitest|kurztest|testblock|self[ -]?check|selbsttest|selbstkontrolle)\b/i.test(link.label);
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

async function planFileLinks<T extends { href: string; label: string; sectionTitle?: string }>(
  links: T[],
  config: MoodleRuntimeConfig,
  remaining: number,
): Promise<Array<PlannedResource<T & ResourcePlanningCandidate>>> {
  const minimumScore = config.intentDecision?.needsCourseMaterial ? Number.NEGATIVE_INFINITY : 90;
  const relevant = selectRelevantFileLinks(links, config.prompt, links.length, minimumScore)
    .map((link) => ({ ...link, score: scoreMoodleLink(link, config.prompt) }));
  const profile = config.intentDecision?.needsCourseMaterial
    ? config.executionProfile
    : "fast";
  const planLimit = config.intentDecision?.needsCourseMaterial && !config.evidenceHandoffOnly
    ? await remainingInitialProbeSlots(config.runDir, profile, remaining)
    : remaining;
  const plan = config.intentDecision?.needsCourseMaterial
    ? config.evidenceHandoffOnly
      ? planCourseResources(relevant, profile, planLimit)
      : planInitialResourceProbe(relevant, profile, planLimit)
    : planCourseResources(relevant, profile, planLimit);
  await writeRunProgress(config, { phase: "downloading_sources" });
  const planPath = await writeResourcePlan(config.runDir, plan);
  const persistedPlan = await readFile(planPath, "utf8")
    .then((text) => JSON.parse(text) as { discovered: number; selected: number })
    .catch(() => ({ discovered: plan.discovered, selected: plan.selected }));
  await config.executionTelemetry?.recordResourcePlan(
    persistedPlan.discovered,
    persistedPlan.selected,
  );
  await config.diagnostics?.updateCoverage("moodle", { artifacts: [planPath] });
  await config.diagnostics?.log(
    "info",
    "moodle_download",
    `Resource catalog discovered ${plan.discovered} candidate file(s); ${config.evidenceHandoffOnly ? "the deterministic evidence handoff selected" : "the initial probe selected"} ${plan.selected} for profile ${profile}.`,
    { selected: plan.selected, discovered: plan.discovered, profile },
  );
  return plan.entries.filter((entry) => entry.selected);
}

function isReadableResourceLink(href: string): boolean {
  const url = new URL(href);
  return (
    /\.(pdf|txt|md)$/i.test(url.pathname) ||
    isKnownPdfEndpoint(href) ||
    url.pathname.includes("/mod/resource/view.php") ||
    url.pathname.includes("/pluginfile.php")
  );
}

function isSchedulePrompt(prompt: string): boolean {
  return /\b(?:termin|prüfung|pruefung|klausur|exam|datum|date|uhrzeit|time|raum|room|wann|wo)\b/i.test(prompt);
}

function isScheduleDocumentLink(link: { href: string; label: string }): boolean {
  const text = `${link.label} ${decodeURIComponent(new URL(link.href).pathname)}`;
  return /\b(?:prüfung|pruefung|klausur|exam|termin|semesterplan|zeitplan|schedule|allgemeines|administrativ|organisation|organisatorisch|kursinfo|kursinformation|course info|lv-info|lvinfo|syllabus)\b/i.test(text);
}

function isBoundedScheduleProbe(config: MoodleRuntimeConfig): boolean {
  return config.intentDecision?.intent === "schedule_answer" &&
    !config.intentDecision.needsCourseMaterial;
}

function shouldCaptureFilesOnPage(config: MoodleRuntimeConfig, url: string): boolean {
  if (!isBoundedScheduleProbe(config)) return true;
  try {
    const pathname = new URL(url).pathname;
    return pathname.includes("/course/view.php") || isReadableResourceLink(url);
  } catch {
    return false;
  }
}

const SCHEDULE_SECTION_PATTERN = /(?:prüf|pruef|exam|klausur|termin|leistungsbeurteilung|beurteilungskriterien|organisation|allgemein|kursinfo|course info|lv-info)/i;

function readableFileName(label: string, href: string): string {
  const urlPath = new URL(href).pathname;
  const extension = /\.(pdf|txt|md)$/i.exec(urlPath)?.[0]?.toLowerCase() ??
    (urlPath.includes("/mod/resource/view.php") || isKnownPdfEndpoint(href) ? ".pdf" : "");
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

interface ResourceDownloadMetadata {
  resolvedUrl: string;
  contentType: string | null;
  localPath: string;
  bytes: number;
  durationMs: number;
}

interface ResourceDownloadSession {
  download(url: string, target: string, signal?: AbortSignal): Promise<ResourceDownloadMetadata>;
  close(): Promise<void>;
}

export interface TargetedResourceRequest {
  href: string;
  label: string;
  role: PlannedResource<ResourcePlanningCandidate>["role"];
  topic: string | null;
  priority: number;
  reason: string;
}

/** Acquire exact catalog entries selected by the source architect in one session. */
export async function acquireTargetedResources(
  config: MoodleRuntimeConfig,
  requests: TargetedResourceRequest[],
): Promise<string[]> {
  if (requests.length === 0) return [];
  const sourcesDir = path.join(config.runDir, "sources");
  await mkdir(sourcesDir, { recursive: true });
  const session = await createResourceDownloadSession(config);
  const attemptRecorder = new ResourceAttemptRecorder(config.runDir);
  await attemptRecorder.init();
  try {
    const planned = requests.map((request) => ({
      candidate: {
        href: request.href,
        label: request.label,
        score: 0,
      },
      selected: true,
      role: request.role,
      topic: request.topic,
      priority: request.priority,
      reason: request.reason,
    } satisfies PlannedResource<ResourcePlanningCandidate>));
    const jobs = planned.map((entry, index) => async ({ signal }: { signal: AbortSignal }) => {
      const target = path.join(
        sourcesDir,
        readableFileName(`targeted-${index + 1}-${entry.candidate.label}`, entry.candidate.href),
      );
      const startedAt = Date.now();
      const transport = isExternalResource(entry.candidate.href)
        ? "external_request" as const
        : "authenticated_request" as const;
      await attemptRecorder.record({
        resourceIndex: index,
        title: entry.candidate.label,
        url: entry.candidate.href,
        status: "started",
        transport,
        attempt: 1,
      });
      await config.executionTelemetry?.recordResourceAttempt("started");
      try {
        const metadata = await session.download(entry.candidate.href, target, signal);
        const extraction = await extractReadableFile(metadata.localPath, {
          signal,
          commandTimeoutMs: 60_000,
        });
        await recordExtractionResult(config.runDir, extraction);
        await config.diagnostics?.updateCoverage("moodle", { artifacts: [metadata.localPath] });
        await attemptRecorder.record({
          resourceIndex: index,
          title: entry.candidate.label,
          url: entry.candidate.href,
          status: "completed",
          transport,
          attempt: 1,
          durationMs: Date.now() - startedAt,
          bytes: metadata.bytes,
          resolvedUrl: metadata.resolvedUrl,
          localPath: metadata.localPath,
        });
        await config.executionTelemetry?.recordResourceAttempt("completed", metadata.bytes);
        return formatResourceSuccessBlock({
          title: entry.candidate.label,
          url: entry.candidate.href,
          target: metadata.localPath,
          text: extraction.text || extractionFailureText(extraction),
          metadata,
          planned: entry,
          extraction,
        });
      } catch (error) {
        await rm(target, { force: true }).catch(() => undefined);
        await attemptRecorder.record({
          resourceIndex: index,
          title: entry.candidate.label,
          url: entry.candidate.href,
          status: "failed",
          transport,
          attempt: 1,
          durationMs: Date.now() - startedAt,
          error: errorMessage(error),
        });
        await config.executionTelemetry?.recordResourceAttempt("failed");
        return resourceFailureBlock(entry.candidate.label, entry.candidate.href, error, entry, {
          status: "failed",
          transport,
          attempts: 1,
          durationMs: Date.now() - startedAt,
        });
      }
    });
    const settled = await runClassifiedResourceJobs(
      planned,
      jobs,
      config.downloadConcurrency,
      config.abortSignal,
      config.executionProfile,
    );
    return settled.map((result, index) => result.status === "fulfilled"
      ? result.value
      : resourceFailureBlock(
        planned[index].candidate.label,
        planned[index].candidate.href,
        result.reason,
        planned[index],
      ));
  } finally {
    await session.close().catch(() => undefined);
  }
}

async function createResourceDownloadSession(
  config: MoodleRuntimeConfig,
): Promise<ResourceDownloadSession> {
  throwIfAborted(config.abortSignal);
  const browser = await launchMoodleBrowser({
    headless: config.headless,
    abortSignal: config.abortSignal,
    purpose: "Moodle resource download",
  });
  const closeOnAbort = () => {
    void browser.close();
  };
  config.abortSignal?.addEventListener("abort", closeOnAbort, { once: true });
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
      allowedOrigins: config.moodleLoginAllowedOrigins,
    });
    return {
      download: (url, target, signal) => downloadResourceWithRequest(context, url, target, signal),
      close: async () => {
        config.abortSignal?.removeEventListener("abort", closeOnAbort);
        await browser.close().catch(() => undefined);
      },
    };
  } catch (error) {
    config.abortSignal?.removeEventListener("abort", closeOnAbort);
    await browser.close().catch(() => undefined);
    throw error;
  }
}

class ResourceDownloadFailure extends Error {
  readonly resolvedUrl: string | null;
  readonly contentType: string | null;
  readonly htmlTitle: string | null;
  readonly httpStatus: number | undefined;

  constructor(
    message: string,
    input: {
      resolvedUrl?: string | null;
      contentType?: string | null;
      htmlTitle?: string | null;
      httpStatus?: number;
    } = {},
  ) {
    super(message);
    this.name = "ResourceDownloadFailure";
    this.resolvedUrl = input.resolvedUrl ?? null;
    this.contentType = input.contentType ?? null;
    this.htmlTitle = input.htmlTitle ?? null;
    this.httpStatus = input.httpStatus;
  }
}

export async function downloadResourceWithRequest(
  context: BrowserContext,
  url: string,
  target: string,
  signal?: AbortSignal,
): Promise<ResourceDownloadMetadata> {
  const maximumAttempts = 2;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await downloadResourceWithRequestAttempt(context, url, target, signal);
    } catch (error) {
      const failure = error instanceof ResourceDownloadFailure ? error : null;
      const classification = classifyResourceFailure(errorMessage(error), {
        requestedUrl: url,
        htmlTitle: failure?.htmlTitle,
        httpStatus: failure?.httpStatus,
      });
      if (
        attempt >= maximumAttempts ||
        classification.status !== "transient_failure" ||
        signal?.aborted
      ) {
        throw error;
      }
      await waitForResourceRetry(300, signal);
    }
  }
  throw new Error("Resource download retry loop exhausted unexpectedly.");
}

async function downloadResourceWithRequestAttempt(
  context: BrowserContext,
  url: string,
  target: string,
  signal?: AbortSignal,
): Promise<ResourceDownloadMetadata> {
  throwIfAborted(signal);
  const startedAt = Date.now();
  let currentUrl = url;
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    throwIfAborted(signal);
    await assertPublicHttpsUrl(currentUrl);
    const cookies = await context.cookies(currentUrl);
    response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: cookies.length > 0
        ? { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") }
        : undefined,
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirects === 5) {
      throw new ResourceDownloadFailure("Resource download redirect could not be followed.", {
        resolvedUrl: currentUrl,
        httpStatus: response.status,
      });
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  if (!response) throw new ResourceDownloadFailure("Resource download did not return a response.");
  const resolvedUrl = currentUrl;
  const contentType = response.headers.get("content-type");
  const contentDisposition = response.headers.get("content-disposition");
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResourceDownloadFailure(`Resource download returned HTTP ${response.status}.`, {
      resolvedUrl,
      contentType,
      httpStatus: response.status,
    });
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOURCE_DOWNLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResourceDownloadFailure("Resource download exceeds the 100 MiB safety limit.", {
      resolvedUrl,
      contentType,
      httpStatus: response.status,
    });
  }
  if (!response.body) throw new ResourceDownloadFailure("Resource download returned an empty body.");
  const temporaryPath = `${target}.${process.pid}.${Date.now()}.part`;
  const handle = await open(temporaryPath, "wx", 0o600);
  const reader = response.body.getReader();
  const inspectionChunks: Uint8Array[] = [];
  let inspectionBytes = 0;
  let bytes = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESOURCE_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new ResourceDownloadFailure("Resource download exceeds the 100 MiB safety limit.", {
          resolvedUrl,
          contentType,
          httpStatus: response.status,
        });
      }
      await handle.write(value);
      if (inspectionBytes < 64 * 1024) {
        const sample = value.subarray(0, Math.min(value.byteLength, 64 * 1024 - inspectionBytes));
        inspectionChunks.push(sample);
        inspectionBytes += sample.byteLength;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
  const inspection = inspectResourcePayload(Buffer.concat(inspectionChunks), contentType ?? undefined);
  let localPath = target;
  let renamed = false;
  try {
    const expectsPdf = isKnownPdfEndpoint(url);
    const isMoodleResource = new URL(url).pathname.includes("/mod/resource/view.php");
    if ((expectsPdf && inspection.kind !== "pdf") || (isMoodleResource && inspection.kind === "html")) {
      const titleSuffix = inspection.title ? ` (${inspection.title})` : "";
      throw new ResourceDownloadFailure(
        inspection.kind === "html"
          ? `Downloaded file is not a PDF; Moodle returned an HTML page instead${titleSuffix}.`
          : `Downloaded resource has unexpected content type ${inspection.contentType ?? inspection.kind}.`,
        {
          resolvedUrl,
          contentType: inspection.contentType,
          htmlTitle: inspection.title,
          httpStatus: response.status,
        },
      );
    }
    localPath = resolveDownloadedPath(target, inspection, contentDisposition);
    if (inspection.kind === "binary" && localPath === target && target.toLowerCase().endsWith(".pdf")) {
      throw new ResourceDownloadFailure(
        `Downloaded resource has unsupported content type ${inspection.contentType ?? "binary"}.`,
        { resolvedUrl, contentType: inspection.contentType, httpStatus: response.status },
      );
    }
    throwIfAborted(signal);
    await rename(temporaryPath, localPath);
    renamed = true;
    await assertNonEmptyFile(localPath);
    await assertReadableDownloadedFile(localPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (renamed) await rm(localPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    resolvedUrl,
    contentType: inspection.contentType,
    localPath,
    bytes,
    durationMs: Date.now() - startedAt,
  };
}

async function waitForResourceRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Resource retry canceled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resourceFailureBlock(
  title: string,
  url: string,
  error: unknown,
  planned?: PlannedResource<ResourcePlanningCandidate>,
  acquisition?: {
    status: "completed" | "failed" | "timed_out" | "canceled" | "skipped";
    transport: "authenticated_request" | "agent_browser" | "external_request";
    attempts: number;
    durationMs: number;
  },
): string {
  const failure = error instanceof ResourceDownloadFailure ? error : null;
  return [formatResourceFailureBlock({
    title,
    url,
    message: errorMessage(error),
    resolvedUrl: failure?.resolvedUrl,
    contentType: failure?.contentType,
    htmlTitle: failure?.htmlTitle,
    httpStatus: failure?.httpStatus,
  }),
  ...selectionMetadata(planned),
  `Acquisition status: ${acquisition?.status ?? (/timed out/i.test(errorMessage(error)) ? "timed_out" : "failed")}`,
  `Acquisition transport: ${acquisition?.transport ?? (isExternalResource(url) ? "external_request" : "authenticated_request")}`,
  `Acquisition attempts: ${acquisition?.attempts ?? 1}`,
  `Acquisition duration ms: ${acquisition?.durationMs ?? 0}`,
  ].join("\n");
}

function formatResourceSuccessBlock(input: {
  title: string;
  url: string;
  target: string;
  text: string;
  metadata: ResourceDownloadMetadata | null;
  planned?: PlannedResource<ResourcePlanningCandidate>;
  extraction?: FileExtractionResult;
}): string {
  return [
    "[Linked file]",
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    input.metadata?.resolvedUrl ? `Resolved URL: ${input.metadata.resolvedUrl}` : null,
    input.metadata?.contentType ? `Content-Type: ${input.metadata.contentType}` : null,
    "Resource status: acquired",
    `Saved path: ${input.target}`,
    ...selectionMetadata(input.planned),
    "Acquisition status: completed",
    `Acquisition transport: ${isExternalResource(input.url) ? "external_request" : "authenticated_request"}`,
    "Acquisition attempts: 1",
    input.metadata ? `Acquisition bytes: ${input.metadata.bytes}` : null,
    input.metadata ? `Acquisition duration ms: ${input.metadata.durationMs}` : null,
    input.extraction ? `Extraction status: ${input.extraction.status}` : null,
    input.extraction ? `Extraction method: ${input.extraction.method}` : null,
    input.extraction ? `Extraction characters: ${input.extraction.characterCount}` : null,
    input.extraction?.pageCount !== null && input.extraction?.pageCount !== undefined
      ? `Extraction pages: ${input.extraction.pageCount}`
      : null,
    input.extraction ? `Extraction warnings: ${input.extraction.warnings.join(" | ") || "none"}` : null,
    "",
    input.text.trim(),
  ].filter((line): line is string => line !== null).join("\n");
}

function selectionMetadata(planned: PlannedResource<ResourcePlanningCandidate> | undefined): string[] {
  if (!planned) return [];
  return [
    `Selection: ${planned.selected ? "selected" : "skipped"}`,
    `Resource role: ${planned.role}`,
    `Resource topic: ${planned.topic ?? "none"}`,
    `Resource priority: ${planned.priority}`,
    `Selection reason: ${planned.reason}`,
  ];
}

function extractionFailureText(result: FileExtractionResult): string {
  return `Readable text extraction failed: ${result.warnings.join(" ") || "No usable text was extracted."}`;
}

async function runClassifiedResourceJobs<T>(
  links: Array<{ candidate: { href: string } }>,
  jobs: Array<(context: { signal: AbortSignal }) => Promise<T>>,
  internalConcurrency: number,
  signal?: AbortSignal,
  profile: MoodleRuntimeConfig["executionProfile"] = "balanced",
): Promise<Array<PromiseSettledResult<T>>> {
  const indexed = jobs.map((job, index) => ({
    job,
    index,
    external: isExternalResource(links[index]?.candidate.href),
  }));
  const groups = [
    { entries: indexed.filter((entry) => !entry.external), concurrency: internalConcurrency },
    { entries: indexed.filter((entry) => entry.external), concurrency: 1 },
  ];
  const output = new Array<PromiseSettledResult<T>>(jobs.length);
  const budgetSignal = AbortSignal.timeout(sourceAcquisitionBudgetMs(profile));
  const queueSignal = signal ? AbortSignal.any([signal, budgetSignal]) : budgetSignal;
  await Promise.all(groups.map(async (group) => {
    const settled = await runDownloadQueue(
      group.entries.map((entry) => entry.job),
      {
        concurrency: group.concurrency,
        timeoutMs: 120_000,
        cancellationGraceMs: 5_000,
        signal: queueSignal,
      },
    );
    settled.forEach((result, groupIndex) => {
      output[group.entries[groupIndex].index] = result;
    });
  }));
  return output;
}

function sourceAcquisitionBudgetMs(profile: MoodleRuntimeConfig["executionProfile"]): number {
  if (profile === "fast") return 2 * 60_000;
  if (profile === "quality") return 8 * 60_000;
  return 5 * 60_000;
}

function isExternalResource(value: string | undefined): boolean {
  if (!value) return false;
  try {
    new URL(value);
    return !isLikelyMoodleUrl(value);
  } catch {
    return false;
  }
}

function resolveDownloadedPath(
  target: string,
  inspection: ReturnType<typeof inspectResourcePayload>,
  contentDisposition: string | null,
): string {
  const dispositionName = contentDisposition
    ? /filename\*?=(?:UTF-8''|["']?)([^"';]+)/i.exec(contentDisposition)?.[1]
    : null;
  const dispositionExtension = dispositionName
    ? path.extname(decodeURIComponent(dispositionName.trim().replace(/["']+$/g, "")))
    : "";
  const contentTypeExtension = extensionForContentType(inspection.contentType);
  const extension = inspection.kind === "pdf"
    ? ".pdf"
    : dispositionExtension || contentTypeExtension || (inspection.kind === "text" ? ".txt" : "");
  if (!extension || path.extname(target).toLowerCase() === extension.toLowerCase()) return target;
  return `${target.slice(0, target.length - path.extname(target).length)}${extension}`;
}

function extensionForContentType(contentType: string | null): string {
  switch (contentType) {
    case "application/pdf": return ".pdf";
    case "text/plain": return ".txt";
    case "text/markdown": return ".md";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return ".docx";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return ".pptx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return ".xlsx";
    case "application/msword": return ".doc";
    case "application/vnd.ms-powerpoint": return ".ppt";
    case "application/vnd.ms-excel": return ".xls";
    case "application/zip": return ".zip";
    default: return "";
  }
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
