import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { browserExecutableLaunchOptions } from "../shared/browserExecutable.js";
import { STUDY_BUDDY_HTML_MARKS, STUDY_BUDDY_HTML_TOKENS } from "./designGuidelines.js";
import { OFFLINE_CSP } from "./htmlShell.js";
import type { JsonObject } from "./state.js";
import type { WebLayoutKind } from "./types.js";

export interface HtmlValidationIssue {
  code: string;
  message: string;
  details?: JsonObject;
}

export interface BrowserValidationCheck {
  id: string;
  ok: boolean;
  evidence: string;
}

export interface HtmlValidationReport {
  ok: boolean;
  issues: HtmlValidationIssue[];
  screenshotPaths: string[];
  browserChecks: BrowserValidationCheck[];
}

export interface BrowserValidationOptions {
  runDir: string;
  headed?: boolean;
  skip?: boolean;
}

export async function validateWebLayoutHtml(
  html: string,
  kind: WebLayoutKind,
  options: BrowserValidationOptions,
): Promise<HtmlValidationReport> {
  const staticReport = validateSingleFileHtml(html, kind);
  if (!staticReport.ok || options.skip) {
    return staticReport;
  }
  const previewPath = path.join(options.runDir, "validation-preview.html");
  await writeFile(previewPath, html, "utf8");
  const browserReport = await validateHtmlFileInBrowser(previewPath, kind, options);
  return {
    ok: browserReport.ok,
    issues: [...staticReport.issues, ...browserReport.issues],
    screenshotPaths: browserReport.screenshotPaths,
    browserChecks: browserReport.browserChecks,
  };
}

export async function validateWebLayoutFile(
  validationHtml: string,
  filePath: string,
  kind: WebLayoutKind,
  options: BrowserValidationOptions,
): Promise<HtmlValidationReport> {
  const staticReport = validateSingleFileHtml(validationHtml, kind);
  if (!staticReport.ok || options.skip) return staticReport;
  const browserReport = await validateHtmlFileInBrowser(filePath, kind, options);
  return {
    ok: browserReport.ok,
    issues: [...staticReport.issues, ...browserReport.issues],
    screenshotPaths: browserReport.screenshotPaths,
    browserChecks: browserReport.browserChecks,
  };
}

export function validateSingleFileHtml(html: string, kind: WebLayoutKind = "auto"): HtmlValidationReport {
  const issues: HtmlValidationIssue[] = [];
  const trimmed = html.trim();
  if (!trimmed) {
    issues.push(issue("empty", "HTML document is empty."));
  }
  requirePattern(trimmed, /^<!doctype html>/i, "doctype", "Missing <!doctype html>.");
  requirePattern(trimmed, /<html\b[^>]*>/i, "html-tag", "Missing <html> tag.");
  requirePattern(trimmed, /<head\b[^>]*>/i, "head-tag", "Missing <head> tag.");
  requirePattern(trimmed, /<body\b[^>]*>/i, "body-tag", "Missing <body> tag.");
  requirePattern(trimmed, /<title\b[^>]*>[\s\S]*?<\/title>/i, "title", "Missing <title>.");
  requirePattern(trimmed, /<meta\b[^>]*name=["']viewport["'][^>]*>/i, "viewport", "Missing viewport meta tag.");
  validateOfflineCsp(trimmed, issues);
  requirePattern(trimmed, /<style\b[^>]*>[\s\S]+?<\/style>/i, "inline-style", "Missing inline <style> block.");
  if (kind !== "reference") {
    requirePattern(trimmed, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]+?<\/script>/i, "inline-script", "Missing inline <script> block.");
  }
  if (/<script\b[^>]*\bsrc\s*=/i.test(trimmed)) {
    issues.push(issue("script-src", "External script src is not allowed."));
  }
  if (/<link\b[^>]*rel=["']?stylesheet/i.test(trimmed)) {
    issues.push(issue("stylesheet-link", "External stylesheet links are not allowed."));
  }
  if (/@import\b/i.test(trimmed)) {
    issues.push(issue("css-import", "CSS @import is not allowed."));
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(trimmed) || /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(trimmed)) {
    issues.push(issue("network-api", "Network APIs are not allowed."));
  }
  if (/\bimport\s*\(/.test(trimmed)) {
    issues.push(issue("dynamic-import", "Dynamic import() is not allowed."));
  }
  if (/<iframe\b/i.test(trimmed)) {
    issues.push(issue("iframe", "Iframes are not allowed in offline single-file outputs."));
  }
  const externalRefs = findExternalReferences(trimmed);
  for (const ref of externalRefs) {
    issues.push(issue("external-reference", `External reference is not allowed: ${ref}`));
  }
  for (const ref of findSiblingReferences(trimmed)) {
    issues.push(issue("sibling-reference", `Final HTML must not depend on a sibling file: ${ref}`));
  }
  if (/```/.test(trimmed)) {
    issues.push(issue("markdown-fence", "HTML output must not contain Markdown code fences."));
  }
  if (/\b(?:TODO|INSERT|lorem ipsum)\b/i.test(trimmed)) {
    issues.push(issue("placeholder", "HTML output contains unresolved placeholder text."));
  }
  if (/data-assessment-solution-missing/i.test(trimmed)) {
    issues.push(issue(
      "assessment-solution-missing",
      "A published assessment item is missing its complete reviewed reference solution.",
    ));
  }
  for (const token of Object.keys(STUDY_BUDDY_HTML_TOKENS)) {
    if (!trimmed.includes(token)) {
      issues.push(issue("missing-token", `Missing Study Buddy CSS token ${token}.`));
    }
  }
  for (const mark of STUDY_BUDDY_HTML_MARKS) {
    if (!trimmed.includes(mark)) {
      issues.push(issue("missing-mark", `Missing Study Buddy identity mark ${mark}.`));
    }
  }
  for (const missing of missingInteractionRequirements(trimmed, kind)) {
    issues.push(missing);
  }

  function requirePattern(value: string, pattern: RegExp, code: string, message: string): void {
    if (!pattern.test(value)) {
      issues.push(issue(code, message));
    }
  }

  return { ok: issues.length === 0, issues, screenshotPaths: [], browserChecks: [] };
}

function validateOfflineCsp(html: string, issues: HtmlValidationIssue[]): void {
  const policyTag = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) =>
    /\bhttp-equiv\s*=\s*["']?content-security-policy["']?/i.test(tag)
  );
  const policy = policyTag?.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? "";
  if (!policy) {
    issues.push(issue("content-security-policy", "Missing offline Content-Security-Policy meta tag."));
    return;
  }
  const actualDirectives = policy
    .split(";")
    .map((directive) => directive.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const requiredDirectives = OFFLINE_CSP.split(";")
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean);
  for (const directive of requiredDirectives) {
    if (!actualDirectives.includes(directive)) {
      issues.push(issue("content-security-policy", `Offline Content-Security-Policy is missing: ${directive}.`));
    }
  }
}

export function validationReportToJson(report: HtmlValidationReport): JsonObject {
  return {
    ok: report.ok,
    issues: report.issues.map((entry) => ({
      code: entry.code,
      message: entry.message,
      ...(entry.details ? { details: entry.details } : {}),
    })),
    screenshotPaths: report.screenshotPaths,
    browserChecks: report.browserChecks.map((entry) => ({
      id: entry.id,
      ok: entry.ok,
      evidence: entry.evidence,
    })),
  };
}

async function validateHtmlFileInBrowser(
  filePath: string,
  kind: WebLayoutKind,
  options: BrowserValidationOptions,
): Promise<HtmlValidationReport> {
  const issues: HtmlValidationIssue[] = [];
  const browserChecks: BrowserValidationCheck[] = [];
  const screenshotsDir = path.join(options.runDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const screenshotPaths = [
    path.join(screenshotsDir, "desktop.png"),
    path.join(screenshotsDir, "laptop.png"),
    path.join(screenshotsDir, "tablet.png"),
    path.join(screenshotsDir, "mobile.png"),
  ];
  const browser = await chromium.launch({
    headless: !options.headed,
    ...browserExecutableLaunchOptions(),
  });
  try {
    const context = await browser.newContext();
    await context.route(/^(?:https?|wss?):/i, (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith("file:") && !url.startsWith("data:") && url !== "about:blank") {
        externalRequests.push(url);
      }
    });
    const fileStat = await stat(filePath);
    const loadTimeout = fileStat.size >= 100_000_000 ? 120_000 : 20_000;
    await page.goto(pathToFileURL(filePath).toString(), { waitUntil: "load", timeout: loadTimeout });

    const viewports = [
      { width: 1440, height: 900, path: screenshotPaths[0] },
      { width: 1024, height: 768, path: screenshotPaths[1] },
      { width: 768, height: 1024, path: screenshotPaths[2] },
      { width: 390, height: 844, path: screenshotPaths[3] },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.screenshot({ path: viewport.path, fullPage: true }).catch(async () => {
        // Chromium can reject extremely tall full-page captures even when the page is valid.
        // Layout metrics below still inspect the complete document, so a viewport fallback is sufficient.
        await page.screenshot({ path: viewport.path, fullPage: false });
      });
      const metrics = await page.evaluate(() => {
        const overflowingElements = Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .flatMap((element) => {
            const rect = element.getBoundingClientRect();
            if (element.offsetParent === null || rect.width <= 0 || rect.height <= 0) return [];
            const overflowLeft = Math.max(0, -rect.left);
            const overflowRight = Math.max(0, rect.right - document.documentElement.clientWidth);
            if (overflowLeft <= 2 && overflowRight <= 2) return [];
            const style = getComputedStyle(element);
            const selector = element.id
              ? `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`
              : `${element.tagName.toLowerCase()}${Array.from(element.classList)
                .slice(0, 3)
                .map((name) => `.${CSS.escape(name)}`)
                .join("")}`;
            return [{
              selector,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              clientWidth: element.clientWidth,
              scrollWidth: element.scrollWidth,
              overflowLeft: Math.round(overflowLeft),
              overflowRight: Math.round(overflowRight),
              cssWidth: style.width,
              minWidth: style.minWidth,
              maxWidth: style.maxWidth,
              overflowX: style.overflowX,
              whiteSpace: style.whiteSpace,
              text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
            }];
          })
          .sort((left, right) =>
            (right.overflowLeft + right.overflowRight) - (left.overflowLeft + left.overflowRight)
          )
          .slice(0, 8);
        return {
          bodyWidth: document.body.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyHeight: document.body.scrollHeight,
          viewportWidth: document.documentElement.clientWidth,
          textLength: document.body.innerText.trim().length,
          centerTag: document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight / 2, document.body.scrollHeight - 1))?.tagName ?? null,
          overflowingElements,
        };
      });
      const pageOverflow = Math.max(metrics.bodyWidth, metrics.documentWidth) - metrics.viewportWidth;
      if (pageOverflow > 2) {
        const culprit = metrics.overflowingElements[0]?.selector ?? "unknown element";
        issues.push(issue(
          "horizontal-overflow",
          `Horizontal overflow of ${pageOverflow}px at ${viewport.width}px viewport; leading offender: ${culprit}.`,
          {
            viewportWidth: viewport.width,
            pageOverflow,
            offenders: metrics.overflowingElements,
          },
        ));
      }
      if (metrics.bodyHeight <= 0 || metrics.textLength <= 0 || !metrics.centerTag) {
        issues.push(issue("blank-page", `Page appears blank at ${viewport.width}px viewport.`));
      }
    }
    for (const screenshotPath of screenshotPaths) {
      const screenshotStat = await stat(screenshotPath).catch(() => null);
      if (!screenshotStat?.isFile() || screenshotStat.size === 0) {
        issues.push(issue("screenshot-empty", `Screenshot was not written: ${screenshotPath}`));
      }
    }

    if (kind === "study-guide") {
      const adaptive = await page.locator(
        'meta[name="study-buddy-renderer"][content="adaptive-study-guide-v2"]',
      ).count() > 0;
      browserChecks.push(adaptive
        ? await validateAdaptiveStudyGuideInteractionMatrix(
            page,
            issues,
            options.runDir,
            externalRequests,
            pageErrors,
          )
        : await validateStudyGuideInteractionMatrix(page, issues, options.runDir));
    } else if (kind === "exam-practice") {
      browserChecks.push(await validateExamPersistenceInBrowser(page, issues));
    } else {
      const firstButton = page.locator("button").first();
      if (await firstButton.count()) {
        await firstButton.click({ timeout: 5_000 }).catch((error: unknown) => {
          issues.push(issue("button-click", error instanceof Error ? error.message : String(error)));
        });
      }
    }
    for (const message of pageErrors) {
      issues.push(issue("page-error", message));
    }
    for (const url of externalRequests) {
      issues.push(issue("external-request", `Browser attempted external request: ${url}`));
    }
  } finally {
    await browser.close();
  }
  return { ok: issues.length === 0, issues, screenshotPaths, browserChecks };
}

async function validateStudyGuideInteractionMatrix(
  page: Page,
  issues: HtmlValidationIssue[],
  runDir: string,
): Promise<BrowserValidationCheck> {
  const audit: Array<Record<string, unknown>> = [];
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1024, height: 768 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];
  let failureCount = 0;
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load", timeout: 20_000 });
    const continueTargets: string[] = [];
    const continueButton = page.locator("[data-continue]").first();
    if (await continueButton.count()) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await continueButton.click();
        await page.waitForTimeout(40);
        continueTargets.push(await page.evaluate(() =>
          document.activeElement?.closest<HTMLElement>(".task")?.dataset.id ?? ""
        ));
      }
    }
    const controlAudit = await page.evaluate(() => {
      const content = JSON.parse(
        document.querySelector<HTMLScriptElement>("#study-content")?.textContent || "{\"topics\":[]}",
      ) as {
        topics?: Array<{
          exercises?: Array<{
            id: string;
            type: string;
            acceptedAnswers?: string[];
          }>;
        }>;
      };
      const exercises = (content.topics ?? []).flatMap((topic) => topic.exercises ?? []);
      const calculation = exercises.find((exercise) =>
        exercise.type === "calculation" &&
        !exercise.acceptedAnswers?.includes("__self_check__")
      );
      const calculationCard = calculation
        ? document.querySelector<HTMLElement>(`.calculation[data-id="${CSS.escape(calculation.id)}"]`)
        : null;
      const calculationInput = calculationCard?.querySelector<HTMLInputElement>(".calc-answer");
      const calculationButton = calculationCard?.querySelector<HTMLButtonElement>("[data-check-calc]");
      let calculationWrongThenCorrect = calculation === undefined;
      let calculationRepeatable = calculation === undefined;
      if (calculation && calculationCard && calculationInput && calculationButton) {
        calculationInput.value = "__definitely_wrong__";
        calculationInput.dispatchEvent(new Event("input", { bubbles: true }));
        calculationButton.click();
        const wrongShown = calculationCard.querySelector(".feedback")?.classList.contains("bad") === true;
        calculationInput.value = calculation.acceptedAnswers?.[0] ?? "";
        calculationInput.dispatchEvent(new Event("input", { bubbles: true }));
        calculationButton.click();
        const correctShown = calculationCard.querySelector(".feedback")?.classList.contains("good") === true;
        calculationWrongThenCorrect = wrongShown && correctShown && calculationCard.classList.contains("is-complete");
        calculationButton.click();
        calculationRepeatable = !calculationButton.disabled &&
          calculationCard.querySelector(".feedback")?.classList.contains("good") === true;
      }

      const applicationCard = document.querySelector<HTMLElement>("[data-sb-application-exercise]");
      let applicationCriteriaToggle = applicationCard === null;
      let applicationRepeatable = applicationCard === null;
      if (applicationCard) {
        const draft = applicationCard.querySelector<HTMLTextAreaElement>("[data-application-draft]");
        if (draft) {
          draft.value = "A source-grounded draft for interaction validation.";
          draft.dispatchEvent(new Event("input", { bubbles: true }));
        }
        applicationCard.querySelector<HTMLButtonElement>("[data-review-application]")?.click();
        applicationCard.querySelector<HTMLButtonElement>("[data-application-ok]")?.click();
        const completed = applicationCard.classList.contains("is-complete") &&
          applicationCard.querySelector("[data-application-ok]")?.getAttribute("aria-pressed") === "true";
        applicationCard.querySelector<HTMLButtonElement>("[data-application-review]")?.click();
        const reopened = !applicationCard.classList.contains("is-complete") &&
          applicationCard.querySelector("[data-application-review]")?.getAttribute("aria-pressed") === "true";
        applicationCriteriaToggle = completed && reopened;
        applicationCard.querySelector<HTMLButtonElement>("[data-application-ok]")?.click();
        applicationRepeatable = applicationCard.classList.contains("is-complete") &&
          applicationCard.querySelector("[data-application-ok]")?.getAttribute("aria-pressed") === "true";
      }
      return {
        calculationWrongThenCorrect,
        calculationRepeatable,
        applicationCriteriaToggle,
        applicationRepeatable,
      };
    });
    const distinctContinueTargets = new Set(continueTargets.filter(Boolean)).size;
    const controlsOk = distinctContinueTargets >= Math.min(2, continueTargets.length) &&
      Object.values(controlAudit).every(Boolean);
    audit.push({
      viewport: viewport.name,
      state: "controls",
      continueTargets,
      distinctContinueTargets,
      ...controlAudit,
      ok: controlsOk,
    });
    if (!controlsOk) {
      failureCount += 1;
      issues.push(issue(
        "study-guide-control-matrix",
        `${viewport.name}: continue targets=${continueTargets.join(", ") || "none"}, calculation wrong→correct=${controlAudit.calculationWrongThenCorrect}, calculation repeatable=${controlAudit.calculationRepeatable}, application toggle=${controlAudit.applicationCriteriaToggle}, application repeatable=${controlAudit.applicationRepeatable}.`,
      ));
    }
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load", timeout: 20_000 });
    const tabCount = await page.locator('[role="tab"]').count();
    if (tabCount === 0) {
      issues.push(issue("study-guide-tab-matrix", `No chapter tabs were available at ${viewport.name} viewport.`));
      failureCount += 1;
      continue;
    }
    for (let index = 0; index < tabCount; index += 1) {
      const chapterMenu = page.locator("[data-chapter-menu]").first();
      if (await chapterMenu.count()) {
        await chapterMenu.evaluate((element: HTMLDetailsElement) => { element.open = true; });
      }
      const tab = page.locator('[role="tab"]').nth(index);
      const tabName = (await tab.textContent())?.trim() || `tab-${index + 1}`;
      await tab.click();
      await page.evaluate(() => {
        const content = JSON.parse(document.querySelector<HTMLScriptElement>("#study-content")?.textContent || "{\"topics\":[]}");
        const exercises = new Map((content.topics || []).flatMap((topic: { exercises?: Array<{ id: string }> }) => topic.exercises || []).map((exercise: { id: string }) => [exercise.id, exercise]));
        const panel = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).find((candidate) => !candidate.hidden);
        panel?.querySelectorAll<HTMLDetailsElement>("details").forEach((details) => { details.open = true; });
        panel?.querySelectorAll<HTMLElement>(".cross").forEach((card) => {
          const exercise = exercises.get(card.dataset.id || "") as { options?: Array<{ correct?: boolean }> } | undefined;
          card.querySelectorAll<HTMLInputElement>("input").forEach((input, optionIndex) => { input.checked = Boolean(exercise?.options?.[optionIndex]?.correct); });
          card.querySelector<HTMLButtonElement>("[data-submit-cross]")?.click();
        });
        panel?.querySelectorAll<HTMLButtonElement>("[data-check-calc]").forEach((button) => button.click());
      });
      await page.waitForTimeout(10);
      const measurement = await page.evaluate(async () => {
        const panel = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).find((candidate) => !candidate.hidden);
        const visiblePanels = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter((candidate) => !candidate.hidden && getComputedStyle(candidate).display !== "none");
        const mathIssues = Array.from(panel?.querySelectorAll<MathMLElement>("math") || []).flatMap((math) => {
          const label = math.getAttribute("aria-label") || "";
          const namedSubscripts = new Set(Array.from(math.querySelectorAll("msub > mi:last-child, msub > mrow:last-child mi"))
            .flatMap((node) => node.textContent?.match(/\b[A-Za-zÄÖÜäöüß]{4,}\b/g) || []));
          const proseWords = (label.match(/\b[A-Za-zÄÖÜäöüß]{4,}\b/g) || [])
            .filter((word) => !/^(?:lim|sin|cos|tan|exp|log|sqrt)$/i.test(word) && !namedSubscripts.has(word));
          const owner = math.closest<HTMLElement>(".math-inline,.math-scroll,.option-content,.feedback,.worked-body,.question-content,.result,.problem,.steps li");
          const mathRect = math.getBoundingClientRect();
          const ownerRect = owner?.getBoundingClientRect();
          const overflow = ownerRect ? Math.max(0, mathRect.right - ownerRect.right, ownerRect.left - mathRect.left) : 0;
          const scrollable = owner ? ["auto", "scroll"].includes(getComputedStyle(owner).overflowX) : false;
          const malformedRoot = math.querySelector("mo")?.textContent === "√" || Boolean(math.querySelector("mo:nth-child(n)")) && Array.from(math.querySelectorAll("mo")).some((node) => node.textContent === "√");
          const invalid = !label || /data:image|assets\/logo|Local Moodle artifact|\/home\//i.test(label) || proseWords.length > 1 || malformedRoot || (overflow > 2 && !scrollable);
          return invalid ? [{ label: label.slice(0, 180), overflow: Math.round(overflow), scrollable, proseWords: proseWords.slice(0, 4), malformedRoot }] : [];
        });
        const feedbackIssues = Array.from(panel?.querySelectorAll<HTMLElement>(".feedback:not([hidden])") || []).flatMap((feedback) => {
          const length = feedback.innerText.length;
          const overflow = Math.max(0, feedback.scrollWidth - feedback.clientWidth);
          return length > 8_000 || overflow > 2 ? [{ task: feedback.closest<HTMLElement>(".task")?.dataset.id || "unknown", length, overflow }] : [];
        });
        const overlapIssues = Array.from(panel?.querySelectorAll<HTMLElement>(".lesson-step") || [])
          .flatMap((step, index) => {
            const marker = step.querySelector<HTMLElement>(".step-marker");
            const content = step.querySelector<HTMLElement>(".step-content");
            if (!marker || !content || getComputedStyle(marker).display === "none") return [];
            const markerRect = marker.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const area =
              Math.max(0, Math.min(markerRect.right, contentRect.right) - Math.max(markerRect.left, contentRect.left)) *
              Math.max(0, Math.min(markerRect.bottom, contentRect.bottom) - Math.max(markerRect.top, contentRect.top));
            return area > 2 ? [{ type: "marker-content", step: index + 1, area: Math.round(area) }] : [];
          });
        const formulaCards = Array.from(panel?.querySelectorAll<HTMLElement>(".formula-deck .formula") || []);
        for (let leftIndex = 0; leftIndex < formulaCards.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < formulaCards.length; rightIndex += 1) {
            const leftRect = formulaCards[leftIndex]!.getBoundingClientRect();
            const rightRect = formulaCards[rightIndex]!.getBoundingClientRect();
            const area =
              Math.max(0, Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left)) *
              Math.max(0, Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top));
            if (area > 2) {
              overlapIssues.push({
                type: "formula-card",
                step: leftIndex + 1,
                area: Math.round(area),
              });
            }
          }
        }
        const clippedControls = Array.from(panel?.querySelectorAll<HTMLElement>(
          "button,.step-marker small,.task-source,.question-content",
        ) || []).flatMap((element) => {
          const rect = element.getBoundingClientRect();
          if (element.offsetParent === null || rect.width === 0 || rect.height === 0) return [];
          const owner = element.closest<HTMLElement>(".task,.step-content,.lesson-step") ?? panel;
          const ownerRect = owner?.getBoundingClientRect();
          const outsideOwner = ownerRect
            ? rect.left < ownerRect.left - 2 || rect.right > ownerRect.right + 2
            : false;
          const outsideViewport = rect.left < -2 || rect.right > innerWidth + 2;
          return outsideOwner || outsideViewport
            ? [{
                selector: element.matches("button") ? "button" : element.className,
                text: element.innerText.trim().slice(0, 80),
                outsideOwner,
                outsideViewport,
              }]
            : [];
        }).slice(0, 12);
        const formulaScrollIssues = innerWidth < 700
          ? []
          : Array.from(panel?.querySelectorAll<HTMLElement>(".formula-deck .math-scroll") || [])
            .flatMap((container) => container.scrollWidth > container.clientWidth + 2
              ? [{
                  label: container.querySelector("math")?.getAttribute("aria-label")?.slice(0, 120) ?? "",
                  overflow: container.scrollWidth - container.clientWidth,
                }]
              : []);
        const visibleText = panel?.innerText || "";
        const rawNotationIssues = [
          ...visibleText.matchAll(/[A-Za-z0-9)}]\s*\^\s*\{?[+−-]?[A-Za-z0-9∞]/g),
          ...visibleText.matchAll(/[A-Za-z0-9)}]\s*\^\s*\([+−-]?[A-Za-z0-9]+\)/g),
          ...visibleText.matchAll(/\b[A-Za-z]\s*_\s*\{?[A-Za-z0-9]/g),
          ...visibleText.matchAll(/[∫Σ]\s*_\s*\{?[A-Za-z0-9]/g),
          ...visibleText.matchAll(/\blim\s*_\s*\{?[A-Za-z0-9]/g),
        ].slice(0, 12).map((match) => match[0]);
        let contentIssue: { maxStringLength: number; hasBinaryOrPath: boolean } | null = null;
        const contentNode = document.querySelector<HTMLScriptElement>("#study-content");
        if (contentNode) {
          const raw = contentNode.textContent || "";
          let maxStringLength = 0;
          try {
            const pending: unknown[] = [JSON.parse(raw)];
            while (pending.length > 0) {
              const value = pending.pop();
              if (typeof value === "string") maxStringLength = Math.max(maxStringLength, value.length);
              else if (Array.isArray(value)) pending.push(...value);
              else if (value && typeof value === "object") pending.push(...Object.values(value));
            }
          } catch { maxStringLength = Number.MAX_SAFE_INTEGER; }
          contentIssue = { maxStringLength, hasBinaryOrPath: /data:image|Local Moodle artifact root|Approved local image assets|\/home\//i.test(raw) };
        }
        const scrollStep = Math.max(320, Math.floor(innerHeight * 0.72));
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        let scrollSteps = 0;
        let blankCenters = 0;
        for (let y = 0; y <= maxScroll; y += scrollStep) {
          scrollTo(0, y);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          scrollSteps += 1;
          if (!document.elementFromPoint(innerWidth / 2, innerHeight / 2)) blankCenters += 1;
        }
        scrollTo(0, 0);
        return {
          visiblePanels: visiblePanels.length,
          pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          panelOverflow: panel ? Math.max(0, panel.scrollWidth - panel.clientWidth) : 0,
          mathCount: panel?.querySelectorAll("math").length || 0,
          mathIssues,
          feedbackCount: panel?.querySelectorAll(".feedback:not([hidden])").length || 0,
          feedbackIssues,
          overlapIssues,
          clippedControls,
          formulaScrollIssues,
          rawNotationIssues,
          openDetails: panel?.querySelectorAll("details[open]").length || 0,
          contentIssue,
          scrollSteps,
          blankCenters,
        };
      });
      const failed = measurement.visiblePanels !== 1 ||
        measurement.pageOverflow > 2 ||
        measurement.panelOverflow > 2 ||
        measurement.mathIssues.length > 0 ||
        measurement.feedbackIssues.length > 0 ||
        measurement.overlapIssues.length > 0 ||
        measurement.clippedControls.length > 0 ||
        measurement.formulaScrollIssues.length > 0 ||
        measurement.rawNotationIssues.length > 0 ||
        measurement.blankCenters > 0 ||
        !measurement.contentIssue ||
        measurement.contentIssue.maxStringLength > 8_000 ||
        measurement.contentIssue.hasBinaryOrPath;
      audit.push({ viewport: viewport.name, tab: tabName, ...measurement, ok: !failed });
      if (failed) {
        failureCount += 1;
        const message = `${viewport.name} · ${tabName}: panels=${measurement.visiblePanels}, page overflow=${measurement.pageOverflow}px, panel overflow=${measurement.panelOverflow}px, math issues=${measurement.mathIssues.length}, feedback issues=${measurement.feedbackIssues.length}, overlap issues=${measurement.overlapIssues.length}, clipped controls=${measurement.clippedControls.length}, formula scroll issues=${measurement.formulaScrollIssues.length}, raw notation issues=${measurement.rawNotationIssues.length}, max content field=${measurement.contentIssue?.maxStringLength ?? "missing"}.`;
        issues.push(issue("study-guide-interaction-matrix", message));
        const safeName = tabName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || `tab-${index + 1}`;
        await page.screenshot({ path: path.join(runDir, "screenshots", `audit-failure-${viewport.name}-${safeName}.png`), fullPage: true }).catch(() => undefined);
      }
    }
  }
  const reportPath = path.join(runDir, "interaction-audit.json");
  await writeFile(reportPath, `${JSON.stringify({ ok: failureCount === 0, failureCount, auditedStates: audit.length, states: audit }, null, 2)}\n`, "utf8");
  return {
    id: "study-guide-all-tabs-all-states",
    ok: failureCount === 0,
    evidence: failureCount === 0
      ? `Playwright opened, exercised, and scrolled all ${audit.length} desktop, laptop, tablet, and mobile chapter states without deterministic layout or math violations. Report: ${reportPath}`
      : `Playwright found ${failureCount} failing desktop, laptop, tablet, or mobile chapter states. Report: ${reportPath}`,
  };
}

async function validateAdaptiveStudyGuideInteractionMatrix(
  page: Page,
  issues: HtmlValidationIssue[],
  runDir: string,
  externalRequests: string[],
  pageErrors: string[],
): Promise<BrowserValidationCheck> {
  const audit: Array<Record<string, unknown>> = [];
  const scenarioNames = [
    "question-open-recorded",
    "incorrect-to-review",
    "correct-clears-review-without-auto-learning",
    "manual-learned-clears-review",
    "manual-review-clears-learned",
    "star-independent-of-learning-status",
    "repeated-wrong-then-correct-attempt",
    "repeated-correct-attempt",
    "reset-one-question",
    "reset-all-questions",
    "reload-restores-compact-state",
    "combined-topic-stage-filter",
    "continue-status-filter",
    "review-status-filter",
    "starred-status-filter",
    "learned-status-filter",
    "three-main-tabs",
    "topic-question-navigation",
    "catalog-links-scroll-to-top",
    "exam-tasks-are-authentic",
    "exam-finish-only-on-last-question",
    "exam-solutions-visible",
    "exam-self-assessment-collapsed",
    "exam-detailed-criteria-collapsed",
    "exam-self-assessment-scoring",
    "assessment-visuals-cropped-without-scroll",
    "learning-visuals-evidence-bound",
    "learning-visuals-responsive-without-scroll",
    "dense-vocabulary-deck-responsive",
    "adaptive-module-title-layout",
    "inline-equations-readable-without-overflow",
    "answer-option-math-readable",
    "course-hierarchy-traceable",
    "assessment-session-bounded",
    "separate-exam-surface",
  ] as const;
  const learnerStateScenarios: Record<string, boolean> = Object.fromEntries(
    scenarioNames.map((name) => [name, true]),
  );
  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1024, height: 768 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "mobile", width: 390, height: 844 },
  ];
  let failureCount = 0;
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith("study-buddy:study-builder:v1:")) localStorage.removeItem(key);
      }
      localStorage.setItem("study-buddy-validator-foreign", "preserve");
    });
    await page.reload({ waitUntil: "load", timeout: 20_000 });
    // Keep this callback self-contained and avoid locally named helper
    // functions: esbuild can otherwise emit a free `__name` reference that
    // does not exist when Playwright serializes the callback into the page.
    const interaction = await page.evaluate(() => {
      const bank = JSON.parse(
        document.querySelector<HTMLScriptElement>("#question-bank")?.textContent || "{\"items\":[]}",
      ) as {
        items: Array<{
          id: string;
          type: "cross" | "calculation" | "application" | "vocabulary";
          topicId: string;
          stageIndex: number;
          stageIntent: string;
          difficulty: string;
          referenceSolution?: {
            taskImage?: {
              kind?: string;
            };
          };
          visual?: {
            kind?: string;
            sourceLabel?: string;
            sourceTask?: string;
            origin?: string;
          };
          exercise: {
            prompt?: string;
            options?: Array<{ correct: boolean }>;
            acceptedAnswers?: string[];
          };
        }>;
      };
      const course = JSON.parse(
        document.querySelector<HTMLScriptElement>("#course-blueprint")?.textContent || "{\"modules\":[]}",
      ) as {
        modules: Array<{
          id: string;
          title?: string;
          displayTitle?: string;
          subtopics?: string[];
          theoryVisual?: {
            kind?: string;
            sourceLabel?: string;
            sourceTask?: string;
            origin?: string;
          };
        }>;
      };
      const firstCard = document.querySelector<HTMLElement>(
        "[data-topic-question-host] [data-sb-question-card]",
      );
      const firstId = firstCard?.dataset.questionId ?? "";
      const storageKey = Object.keys(localStorage).find((key) =>
        key.startsWith("study-buddy:study-builder:v1:")
      );
      const initialState = JSON.parse(
        storageKey ? localStorage.getItem(storageKey) || "{}" : "{}",
      ) as { questions?: Record<string, { seen?: boolean }> };
      const initialSeen = initialState.questions?.[firstId]?.seen === true;
      const courseHierarchyTraceable = course.modules.every((module) => {
        const subtopics = module.subtopics ?? [];
        if (subtopics.length <= 1) return true;
        const outline = document.querySelector<HTMLElement>(
          `#topic-${CSS.escape(module.id)} [data-course-subtopics]`,
        );
        return Boolean(
          outline &&
          subtopics.every((subtopic) => outline.textContent?.includes(subtopic)),
        );
      });
      const moduleNavigation = document.querySelector<HTMLElement>("[data-sb-course-tabs]");
      const moduleTabs = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-topic-tab]"),
      );
      const expectsRail = course.modules.length > 6 || course.modules.some((module) =>
        (module.title?.length ?? 0) > 72 || (module.displayTitle?.length ?? 0) > 42
      );
      const moduleTitleLayoutResponsive = Boolean(
        moduleNavigation &&
        moduleNavigation.dataset.moduleTitleLayout === (expectsRail ? "rail" : "compact") &&
        moduleTabs.length === course.modules.length &&
        moduleTabs.every((tab, index) => {
          const module = course.modules[index];
          const display = tab.querySelector<HTMLElement>("strong");
          const fullTitle = tab.dataset.fullTitle ?? "";
          const panelTitle = document.querySelector<HTMLElement>(
            `#topic-${CSS.escape(module?.id ?? "")} .topic-heading h2`,
          );
          const fullTitleDisclosure = document.querySelector<HTMLElement>(
            `#topic-${CSS.escape(module?.id ?? "")} .module-source-title`,
          );
          return Boolean(
            module && display &&
            display.textContent?.trim() === (module.displayTitle ?? module.title) &&
            display.textContent.trim().length <= 64 &&
            fullTitle === module.title &&
            tab.getAttribute("title") === module.title &&
            tab.getAttribute("aria-label")?.trim() &&
            display.scrollWidth <= display.clientWidth + 2 &&
            display.scrollHeight <= display.clientHeight + 2 &&
            panelTitle?.textContent?.trim() === (module.displayTitle ?? module.title) &&
            ((module.displayTitle ?? module.title) === module.title ||
              fullTitleDisclosure?.textContent?.includes(module.title ?? ""))
          );
        }) &&
        (!expectsRail || moduleNavigation.scrollWidth > moduleNavigation.clientWidth + 2) &&
        document.querySelector<HTMLElement>("[data-topic-practice-title]")?.textContent?.trim() ===
          (course.modules[0]?.displayTitle ?? course.modules[0]?.title)
      );
      const topicPanel = document.querySelector<HTMLElement>('[data-main-panel="topics"]');
      const catalogPanel = document.querySelector<HTMLElement>('[data-main-panel="catalog"]');
      const examPanel = document.querySelector<HTMLElement>('[data-main-panel="exam"]');
      const composition = JSON.parse(
        document.querySelector<HTMLScriptElement>("#assessment-composition")?.textContent ||
          "{\"simulationKind\":\"none\",\"examItemIds\":[]}",
      ) as {
        simulationKind?: "exam_simulation" | "exercise_simulation" | "none";
        examItemIds?: string[];
        sectionItemIds?: Array<{
          itemIds?: string[];
          selectionLimit?: number;
          selectionLimitBasis?: string;
        }>;
      };
      const assessmentSurfaceRequired = composition.simulationKind !== "none";
      const mainTabs = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-main-tab]"),
      );
      const topicIdBefore = firstCard?.dataset.questionId;
      const topicQuestionCount = document.querySelectorAll(
        "[data-topic-question-index] [data-topic-question-select]",
      ).length;
      document.querySelector<HTMLButtonElement>("[data-topic-next]")?.click();
      const topicIdAfter = document.querySelector<HTMLElement>(
        "[data-topic-question-host] [data-sb-question-card]",
      )?.dataset.questionId;
      const topicQuestionNavigation = topicQuestionCount === 0 ||
        (topicQuestionCount === 1
          ? topicIdAfter === topicIdBefore
          : Boolean(topicIdAfter && topicIdAfter !== topicIdBefore));
      const priorScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, document.documentElement.scrollHeight);
      document.querySelector<HTMLButtonElement>("[data-topic-open-catalog]")?.click();
      const mainTabsTop = document.querySelector<HTMLElement>("[data-main-tabs]")
        ?.getBoundingClientRect().top ?? -1;
      const hotbarBottom = document.querySelector<HTMLElement>("[data-sb-hotbar]")
        ?.getBoundingClientRect().bottom ?? 0;
      const catalogLinkScrollsTop = catalogPanel?.hidden === false &&
        mainTabsTop >= hotbarBottom - 4 &&
        mainTabsTop <= hotbarBottom + 40;
      document.documentElement.style.scrollBehavior = priorScrollBehavior;
      document.querySelector<HTMLButtonElement>('[data-main-tab="topics"]')?.click();
      document.querySelector<HTMLButtonElement>('[data-main-tab="catalog"]')?.click();
      const threeMainTabs = mainTabs.length === (assessmentSurfaceRequired ? 3 : 2) &&
        topicPanel?.hidden === true &&
        catalogPanel?.hidden === false &&
        (assessmentSurfaceRequired ? examPanel?.hidden === true : examPanel === null) &&
        document.querySelector('[data-main-tab="catalog"]')?.getAttribute("aria-selected") === "true";

      const cross = bank.items.find((item) => item.type === "cross");
      if (cross) {
        document.querySelector<HTMLButtonElement>("[data-clear-filters]")?.click();
        document.querySelector<HTMLButtonElement>(
          `[data-question-select="${CSS.escape(cross.id)}"]`,
        )?.click();
      }
      let incorrectToReview = cross === undefined;
      let wrongThenCorrect = cross === undefined;
      let repeatedCorrect = cross === undefined;
      let correctNotLearned = cross === undefined;
      let learnedClearsReview = cross === undefined;
      let reviewClearsLearned = cross === undefined;
      let starIndependent = cross === undefined;
      let resetOne = cross === undefined;
      let crossAttemptDiagnostic: Record<string, unknown> | undefined;
      if (cross) {
        let card = document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )!;
        const inputs = Array.from(card.querySelectorAll<HTMLInputElement>("input"));
        const incorrectIndex = cross.exercise.options?.findIndex((option) => !option.correct) ?? 0;
        inputs.forEach((input) => { input.checked = false; });
        inputs[Math.max(0, incorrectIndex)]?.click();
        card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
        incorrectToReview = card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "true";
        inputs.forEach((input) => { input.checked = false; });
        inputs.forEach((input, index) => {
          if (cross.exercise.options?.[index]?.correct) input.click();
        });
        card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
        wrongThenCorrect = card.querySelector("[data-feedback]")?.classList.contains("is-good") === true &&
          card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "false";
        crossAttemptDiagnostic = {
          expectedQuestionId: cross.id,
          renderedQuestionId: card.dataset.questionId ?? "",
          expectedCorrectIndexes: cross.exercise.options?.flatMap((option, index) => option.correct ? [index] : []) ?? [],
          selectedIndexes: inputs.flatMap((input, index) => input.checked ? [index] : []),
          feedbackClass: card.querySelector("[data-feedback]")?.className ?? "",
          reviewPressed: card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") ?? "",
        };
        correctNotLearned = card.querySelector("[data-toggle-learned]")?.getAttribute("aria-pressed") === "false";
        card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
        repeatedCorrect = card.querySelector("[data-feedback]")?.classList.contains("is-good") === true;
        card.querySelector<HTMLButtonElement>("[data-toggle-review]")?.click();
        card.querySelector<HTMLButtonElement>("[data-toggle-learned]")?.click();
        learnedClearsReview = card.querySelector("[data-toggle-learned]")?.getAttribute("aria-pressed") === "true" &&
          card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "false";
        card.querySelector<HTMLButtonElement>("[data-toggle-review]")?.click();
        reviewClearsLearned = card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "true" &&
          card.querySelector("[data-toggle-learned]")?.getAttribute("aria-pressed") === "false";
        card.querySelector<HTMLButtonElement>("[data-toggle-starred]")?.click();
        starIndependent = card.querySelector("[data-toggle-starred]")?.getAttribute("aria-pressed") === "true" &&
          card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "true";
        const answerBeforeReset = Array.from(
          card.querySelectorAll<HTMLInputElement>("input"),
        ).some((input) => input.checked);
        card.querySelector<HTMLButtonElement>("[data-reset-question]")?.click();
        card = document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )!;
        resetOne = card.querySelector("[data-toggle-starred]")?.getAttribute("aria-pressed") === "false" &&
          card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "false" &&
          card.querySelector("[data-toggle-learned]")?.getAttribute("aria-pressed") === "false" &&
          card.querySelector<HTMLElement>("[data-feedback]")?.hidden === true &&
          answerBeforeReset &&
          !Array.from(card.querySelectorAll<HTMLInputElement>("input")).some((input) => input.checked);
      }
      const calculation = bank.items.find((item) => item.type === "calculation");
      if (calculation) {
        document.querySelector<HTMLButtonElement>("[data-clear-filters]")?.click();
        document.querySelector<HTMLButtonElement>(
          `[data-question-select="${CSS.escape(calculation.id)}"]`,
        )?.click();
      }
      let calculationRetry = calculation === undefined;
      if (calculation) {
        const card = document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )!;
        const input = card.querySelector<HTMLInputElement>("[data-answer-input]");
        if (input) {
          input.value = "__wrong__";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
          input.value = calculation.exercise.acceptedAnswers?.[0] ?? "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
          calculationRetry = card.querySelector("[data-feedback]")?.classList.contains("is-good") === true;
        }
      }
      const application = bank.items.find((item) => item.type === "application");
      if (application) {
        document.querySelector<HTMLButtonElement>("[data-clear-filters]")?.click();
        document.querySelector<HTMLButtonElement>(
          `[data-question-select="${CSS.escape(application.id)}"]`,
        )?.click();
      }
      let openResponseRepeatable = application === undefined;
      if (application) {
        const card = document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )!;
        const input = card.querySelector<HTMLTextAreaElement>("[data-answer-input]");
        if (input) {
          input.value = "A traceable response for browser validation.";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
          card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
          openResponseRepeatable = card.querySelector<HTMLElement>("[data-feedback]")?.hidden === false;
        }
      }
      const vocabulary = bank.items.find((item) => item.type === "vocabulary");
      if (vocabulary) {
        document.querySelector<HTMLButtonElement>("[data-clear-filters]")?.click();
        document.querySelector<HTMLButtonElement>(
          `[data-question-select="${CSS.escape(vocabulary.id)}"]`,
        )?.click();
      }
      let vocabularyRetry = vocabulary === undefined;
      if (vocabulary) {
        const card = document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )!;
        const input = card.querySelector<HTMLInputElement>("[data-answer-input]");
        if (input) {
          input.value = "__wrong__";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
          input.value = vocabulary.exercise.acceptedAnswers?.[0] ?? "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          card.querySelector<HTMLButtonElement>("[data-evaluate]")?.click();
          vocabularyRetry = card.querySelector("[data-feedback]")?.classList.contains("is-good") === true &&
            card.querySelector("[data-toggle-review]")?.getAttribute("aria-pressed") === "false";
        }
      }

      document.querySelector<HTMLButtonElement>("[data-clear-filters]")?.click();
      const stateTargets = bank.items.slice(0, 2);
      if (stateTargets[0]) {
        document.querySelector<HTMLButtonElement>(
          `[data-question-select="${CSS.escape(stateTargets[0].id)}"]`,
        )?.click();
        document.querySelector<HTMLButtonElement>("[data-toggle-review]")?.click();
        document.querySelector<HTMLButtonElement>("[data-toggle-starred]")?.click();
      }
      if (stateTargets[1]) {
        document.querySelector<HTMLButtonElement>(
          `[data-question-select="${CSS.escape(stateTargets[1].id)}"]`,
        )?.click();
        document.querySelector<HTMLButtonElement>("[data-toggle-learned]")?.click();
      }
      const topicSelect = document.querySelector<HTMLSelectElement>("[data-filter-topic]");
      const stageSelect = document.querySelector<HTMLSelectElement>("[data-filter-stage]");
      const statusSelect = document.querySelector<HTMLSelectElement>("[data-filter-status]");
      const target = bank.items.find((item) =>
        bank.items.some((candidate) =>
          candidate.id !== item.id &&
          candidate.topicId === item.topicId &&
          candidate.stageIndex === item.stageIndex
        )
      ) ?? bank.items[0];
      if (topicSelect) {
        topicSelect.value = target?.topicId ?? "all";
        topicSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (stageSelect) {
        stageSelect.value = target ? String(target.stageIndex) : "all";
        stageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const expectedCombined = target
        ? bank.items.filter((item) =>
          item.topicId === target.topicId && item.stageIndex === target.stageIndex
        ).map((item) => item.id)
        : [];
      const combinedRendered = document.querySelector<HTMLElement>(
        "[data-question-host] [data-sb-question-card]",
      )?.dataset.questionId;
      const combinedFilter = Boolean(topicSelect && stageSelect && statusSelect && target) &&
        combinedRendered === expectedCombined[0] &&
        document.querySelectorAll("[data-question-index] [data-question-select]").length ===
          expectedCombined.length;

      if (topicSelect) {
        topicSelect.value = "all";
        topicSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (stageSelect) {
        stageSelect.value = "all";
        stageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const filterResults: Record<string, boolean> = { combined: combinedFilter };
      for (const status of ["continue", "review", "starred", "learned"]) {
        if (statusSelect) {
          statusSelect.value = status;
          statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const storageKeyNow = Object.keys(localStorage).find((key) =>
          key.startsWith("study-buddy:study-builder:v1:")
        );
        const currentState = JSON.parse(
          storageKeyNow ? localStorage.getItem(storageKeyNow) || "{}" : "{}",
        ) as {
          questions?: Record<string, { learned?: boolean; review?: boolean; starred?: boolean }>;
        };
        const expectedIds = bank.items.filter((item) => {
          const question = currentState.questions?.[item.id];
          if (status === "continue") return question?.learned !== true;
          if (status === "review") return question?.review === true;
          if (status === "starred") return question?.starred === true;
          return question?.learned === true;
        }).map((item) => item.id);
        const renderedId = document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )?.dataset.questionId;
        const emptyVisible = document.querySelector<HTMLElement>("[data-empty-pool]")?.hidden === false;
        const sessionPosition = document.querySelector<HTMLElement>("[data-session-position]")?.textContent?.trim();
        filterResults[status] =
          (expectedIds.length === 0
            ? emptyVisible && renderedId === undefined
            : renderedId === expectedIds[0]) &&
          sessionPosition === (expectedIds.length > 0 ? `1 / ${expectedIds.length}` : "0 / 0") &&
          document.querySelectorAll("[data-question-host] [data-sb-question-card]").length <= 1;
      }
      document.querySelector<HTMLButtonElement>("[data-clear-filters]")?.click();
      document.querySelector<HTMLButtonElement>('[data-main-tab="topics"]')?.click();
      const denseVocabularyDecks = Array.from(
        document.querySelectorAll<HTMLElement>('[data-vocabulary-mode="carousel"]'),
      );
      const denseVocabularyStructureValid = denseVocabularyDecks.every((deck) =>
        deck.querySelectorAll(".vocabulary-card").length >= 7 &&
        deck.querySelector("[data-vocabulary-track]") !== null &&
        deck.querySelector("[data-vocabulary-prev]") !== null &&
        deck.querySelector("[data-vocabulary-next]") !== null
      );
      let denseVocabularyDeckResponsive = denseVocabularyStructureValid;
      const firstDenseDeck = denseVocabularyDecks[0];
      if (firstDenseDeck) {
        const densePanel = firstDenseDeck.closest<HTMLElement>("[data-sb-topic]");
        if (densePanel?.dataset.sbTopic) {
          document.querySelector<HTMLButtonElement>(
            `[data-topic-tab="${CSS.escape(densePanel.dataset.sbTopic)}"]`,
          )?.click();
        }
        const track = firstDenseDeck.querySelector<HTMLElement>("[data-vocabulary-track]");
        const next = firstDenseDeck.querySelector<HTMLButtonElement>("[data-vocabulary-next]");
        const deckRect = firstDenseDeck.getBoundingClientRect();
        const before = track?.scrollLeft ?? 0;
        next?.click();
        const after = track?.scrollLeft ?? 0;
        denseVocabularyDeckResponsive &&= Boolean(
          track && next &&
          track.scrollWidth > track.clientWidth + 2 &&
          after > before &&
          deckRect.left >= -2 &&
          deckRect.right <= innerWidth + 2,
        );
        firstDenseDeck.querySelector<HTMLButtonElement>("[data-vocabulary-prev]")?.click();
      }
      document.querySelector<HTMLButtonElement>('[data-main-tab="catalog"]')?.click();
      const catalogIdBeforeExam = document.querySelector<HTMLElement>(
        "[data-question-host] [data-sb-question-card]",
      )?.dataset.questionId;
      document.querySelector<HTMLButtonElement>('[data-main-tab="exam"]')?.click();
      document.querySelector<HTMLButtonElement>("[data-start-assessment]")?.click();
      const composedSectionIds = (composition.sectionItemIds ?? [])
        .flatMap((section) => section.itemIds ?? []);
      const assessmentSessionBounded = !assessmentSurfaceRequired || (
        (composition.examItemIds?.length ?? 0) > 0 &&
        composedSectionIds.length === new Set(composedSectionIds).size &&
        composedSectionIds.length === (composition.examItemIds?.length ?? 0) &&
        (composition.sectionItemIds ?? []).every((section) =>
          typeof section.selectionLimit === "number" &&
          section.selectionLimit > 0 &&
          (section.itemIds?.length ?? 0) <= section.selectionLimit &&
          ["documented_task_count", "inferred_practice_session"].includes(
            section.selectionLimitBasis ?? "",
          )
        )
      );
      const examTasksAreAuthentic = !assessmentSurfaceRequired || (
        (composition.examItemIds?.length ?? 0) > 0 &&
        (composition.examItemIds ?? []).every((id) => {
          const item = bank.items.find((candidate) => candidate.id === id);
          const prompt = item?.exercise.prompt ?? "";
          return !/(?:wie lange|how long).{0,50}(?:prüfung|klausur|exam|test)|(?:welche|what|which).{0,80}(?:hilfsmittel|aids|themen|topics|aufbau|structure).{0,80}(?:prüfung|klausur|exam|musterprüfung)/i.test(prompt);
        })
      );
      const examShell = document.querySelector<HTMLElement>("[data-exam-shell]");
      const examCard = document.querySelector<HTMLElement>(
        "[data-exam-question] [data-sb-question-card]",
      );
      const examLearningControlsHidden = Array.from(
        examCard?.querySelectorAll<HTMLElement>("[data-evaluate],.question-controls,.scope-note,.method-hint") ?? [],
      ).every((element) => element.hidden && element.offsetParent === null);
      const examWasSeparate = examCard?.closest("[data-exam-shell]") !== null;
      const examField = examCard?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "[data-answer-input]",
      );
      if (examField) {
        examField.value = "validator exam draft";
        examField.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const firstExamId = examCard?.dataset.questionId;
      const examItemCount = composition.examItemIds?.length ?? 0;
      const firstNext = document.querySelector<HTMLButtonElement>("[data-exam-next]");
      const firstFinish = document.querySelector<HTMLButtonElement>("[data-exam-finish]");
      let examFinishOnlyOnLastQuestion = !assessmentSurfaceRequired || (examItemCount === 1
        ? firstNext?.hidden === true && firstFinish?.hidden === false
        : examItemCount > 1 &&
          firstNext?.hidden === false &&
          firstFinish?.hidden === true);
      firstNext?.click();
      document.querySelector<HTMLButtonElement>("[data-exam-prev]")?.click();
      const restoredExamCard = document.querySelector<HTMLElement>(
        "[data-exam-question] [data-sb-question-card]",
      );
      const restoredExamField = restoredExamCard?.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >("[data-answer-input]");
      const examDraftRestored = !examField ||
        (restoredExamCard?.dataset.questionId === firstExamId &&
          restoredExamField?.value === "validator exam draft");
      for (let index = 0; index < Math.max(0, examItemCount - 1); index += 1) {
        const next = document.querySelector<HTMLButtonElement>("[data-exam-next]");
        const finish = document.querySelector<HTMLButtonElement>("[data-exam-finish]");
        examFinishOnlyOnLastQuestion &&= next?.hidden === false && finish?.hidden === true;
        next?.click();
      }
      const lastNext = document.querySelector<HTMLButtonElement>("[data-exam-next]");
      const lastFinish = document.querySelector<HTMLButtonElement>("[data-exam-finish]");
      if (assessmentSurfaceRequired) {
        examFinishOnlyOnLastQuestion &&=
          lastNext?.hidden === true &&
          lastFinish?.hidden === false;
      }
      const expectedAssessmentVisualIds = bank.items.filter((item) =>
        composition.examItemIds?.includes(item.id) &&
        item.referenceSolution?.taskImage?.kind === "diagram_crop"
      ).map((item) => item.id);
      const assessmentVisualTemplatesValid = expectedAssessmentVisualIds.every((id) => {
        const template = document.querySelector<HTMLTemplateElement>(
          `#question-template-${CSS.escape(id)}`,
        );
        const figure = template?.content.querySelector<HTMLElement>(
          "[data-assessment-task-visual]",
        );
        const image = figure?.querySelector<HTMLImageElement>("img");
        return Boolean(
          figure &&
          image?.hasAttribute("width") &&
          image.hasAttribute("height") &&
          !template?.content.querySelector("[data-assessment-task-sheet]") &&
          !figure.querySelector(".assessment-task-sheet__viewport"),
        );
      });
      const activeAssessmentVisual = document.querySelector<HTMLElement>(
        "[data-exam-question] [data-assessment-task-visual]",
      );
      const activeAssessmentImage = activeAssessmentVisual?.querySelector<HTMLImageElement>("img");
      const activeAssessmentCanvas = activeAssessmentVisual?.querySelector<HTMLElement>(
        ".assessment-task-visual__canvas",
      );
      const activeAssessmentVisualValid = !activeAssessmentVisual ||
        Boolean(
          activeAssessmentImage &&
          activeAssessmentCanvas &&
          activeAssessmentImage.hasAttribute("width") &&
          activeAssessmentImage.hasAttribute("height") &&
          getComputedStyle(activeAssessmentImage).maxWidth === "100%" &&
          !["auto", "scroll"].includes(getComputedStyle(activeAssessmentCanvas).overflowX),
        );
      const assessmentVisualsCroppedWithoutScroll =
        assessmentVisualTemplatesValid &&
        activeAssessmentVisualValid &&
        document.querySelector("[data-assessment-task-sheet]") === null;
      const expectedQuestionVisuals = bank.items.filter((item) =>
        item.visual?.kind === "diagram_crop"
      );
      const questionVisualsValid = expectedQuestionVisuals.every((item) => {
        const template = document.querySelector<HTMLTemplateElement>(
          `#question-template-${CSS.escape(item.id)}`,
        );
        const figure = template?.content.querySelector<HTMLElement>(
          '[data-learning-visual="question"]',
        );
        const image = figure?.querySelector<HTMLImageElement>("img");
        return Boolean(
          figure &&
          image?.hasAttribute("width") &&
          image.hasAttribute("height") &&
          item.visual?.sourceLabel &&
          item.visual.sourceTask &&
          ["course_original", "course_adapted"].includes(item.visual.origin ?? "") &&
          figure.textContent?.includes(item.visual.sourceLabel),
        );
      });
      const expectedModuleVisuals = course.modules.filter((module) =>
        module.theoryVisual?.kind === "diagram_crop"
      );
      const moduleVisualsValid = expectedModuleVisuals.every((module) => {
        const figure = document.querySelector<HTMLElement>(
          `#topic-${CSS.escape(module.id)} [data-learning-visual="module"]`,
        );
        const image = figure?.querySelector<HTMLImageElement>("img");
        return Boolean(
          figure &&
          image?.hasAttribute("width") &&
          image.hasAttribute("height") &&
          module.theoryVisual?.sourceLabel &&
          module.theoryVisual.sourceTask &&
          ["course_original", "course_adapted"].includes(module.theoryVisual.origin ?? "") &&
          figure.textContent?.includes(module.theoryVisual.sourceLabel),
        );
      });
      const learningVisualsEvidenceBound = questionVisualsValid && moduleVisualsValid;
      const visibleLearningVisuals = Array.from(
        document.querySelectorAll<HTMLElement>("[data-learning-visual]"),
      ).filter((figure) => figure.getClientRects().length > 0);
      const learningVisualsResponsiveWithoutScroll = visibleLearningVisuals.every((figure) => {
        const image = figure.querySelector<HTMLImageElement>("img");
        const canvas = figure.querySelector<HTMLElement>(".assessment-task-visual__canvas");
        if (!image || !canvas) return false;
        const figureRect = figure.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        return imageRect.left >= figureRect.left - 2 &&
          imageRect.right <= figureRect.right + 2 &&
          getComputedStyle(image).maxWidth === "100%" &&
          !["auto", "scroll"].includes(getComputedStyle(canvas).overflowX);
      });
      lastFinish?.click();
      const examFinished = document.querySelector<HTMLElement>("[data-exam-result]")?.hidden === false &&
        document.querySelector("[data-exam-restart]") !== null;
      const examReviewCards = Array.from(
        document.querySelectorAll<HTMLElement>("[data-exam-review-item]"),
      );
      const solutionPanels = examReviewCards.map((card) =>
        card.querySelector<HTMLElement>(".exam-solution")
      );
      const examSolutionsVisible = !assessmentSurfaceRequired || (
        examReviewCards.length === (composition.examItemIds?.length ?? 0) &&
        solutionPanels.length > 0 &&
        solutionPanels.every((panel) =>
          Boolean(
            panel &&
            panel.textContent?.trim() &&
            panel.offsetParent !== null &&
            panel.querySelector("[data-reference-solution]") !== null &&
            !/(?:musterlösung fehlt|reference solution missing|keine lösung verfügbar|no solution available)/i
              .test(panel.textContent),
          )
        ) &&
        examReviewCards.every((card) =>
          Boolean(card.querySelector<HTMLElement>(".exam-user-answer")?.textContent?.trim())
        )
      );
      const formulaBearingSolutions = solutionPanels.filter((panel) =>
        Boolean(panel && /[=≈≤≥≠<>]/.test(panel.textContent ?? ""))
      );
      const inlineEquationsReadableWithoutOverflow =
        formulaBearingSolutions.every((panel) => {
          if (!panel) return false;
          const expressions = Array.from(panel.querySelectorAll<HTMLElement>(".math-expression"))
            .filter((expression) => expression.getClientRects().length > 0);
          if (expressions.length === 0) return false;
          const panelRect = panel.getBoundingClientRect();
          return expressions.every((expression) =>
            Array.from(expression.getClientRects()).every((rect) =>
              rect.left >= panelRect.left - 2 && rect.right <= panelRect.right + 2
            ) &&
            Array.from(expression.querySelectorAll<HTMLElement>(
              ".math-expression__operand,.math-expression__relation",
            )).every((part) => {
              const rect = part.getBoundingClientRect();
              return rect.left >= panelRect.left - 2 && rect.right <= panelRect.right + 2;
            })
          );
        });
      const answerOptionFormulaTemplates = Array.from(
        document.querySelectorAll<HTMLTemplateElement>(".question-templates template"),
      ).filter((template) =>
        template.content.querySelector(".answer-options label b .math-expression")
      );
      const formulaStage = document.createElement("div");
      formulaStage.style.cssText =
        `position:fixed;left:0;top:0;width:${Math.max(320, innerWidth - 40)}px;` +
        "visibility:hidden;pointer-events:none;z-index:-1";
      answerOptionFormulaTemplates.forEach((template) =>
        formulaStage.append(template.content.cloneNode(true))
      );
      document.body.append(formulaStage);
      const stagedAnswerOptionMath = Array.from(
        formulaStage.querySelectorAll<HTMLElement>(
          ".answer-options label b .math-expression",
        ),
      );
      const answerOptionMathReadable =
        stagedAnswerOptionMath.length === answerOptionFormulaTemplates.reduce(
          (count, template) =>
            count +
            template.content.querySelectorAll(
              ".answer-options label b .math-expression",
            ).length,
          0,
        ) &&
        stagedAnswerOptionMath.every((expression) => {
          const style = getComputedStyle(expression);
          if (
            style.display === "grid" ||
            style.width === "28px" ||
            style.height === "28px"
          ) {
            return false;
          }
          return Array.from(expression.querySelectorAll<HTMLElement>(
            ".math-expression__operand,.math-expression__relation",
          )).every((part) => {
            const partStyle = getComputedStyle(part);
            return partStyle.display !== "grid" &&
              !(partStyle.width === "28px" && partStyle.height === "28px");
          });
        });
      formulaStage.remove();
      const selfAssessmentDetails = examReviewCards
        .map((card) => card.querySelector<HTMLDetailsElement>(".exam-self-assessment"))
        .filter((details): details is HTMLDetailsElement => Boolean(details));
      const selfAssessmentCollapsedByDefault = selfAssessmentDetails.every((details) =>
        details.open === false
      );
      const firstSelfAssessment = selfAssessmentDetails[0];
      firstSelfAssessment?.querySelector<HTMLElement>("summary")?.click();
      const examSelfAssessmentCollapsed =
        selfAssessmentCollapsedByDefault &&
        (!firstSelfAssessment || firstSelfAssessment.open === true);
      const criteriaDetails = examReviewCards.map((card) =>
        card.querySelector<HTMLDetailsElement>(".exam-criteria-details")
      );
      const criteriaCollapsedByDefault = criteriaDetails.every((details) =>
        !details || details.open === false
      );
      const firstCriteriaDetails = criteriaDetails.find(
        (details): details is HTMLDetailsElement => Boolean(details),
      );
      firstCriteriaDetails?.querySelector<HTMLElement>("summary")?.click();
      const examDetailedCriteriaCollapsed =
        criteriaCollapsedByDefault &&
        (!firstCriteriaDetails || firstCriteriaDetails.open === true);
      const manualCorrect = document.querySelector<HTMLButtonElement>(
        "[data-exam-review-item] [data-exam-rate=\"correct\"]",
      );
      manualCorrect?.click();
      const examSelfAssessmentScoring = !assessmentSurfaceRequired || (
        examReviewCards.length === (composition.examItemIds?.length ?? 0) &&
        Boolean(document.querySelector("[data-exam-score]")?.textContent?.trim()) &&
        Boolean(document.querySelector("[data-exam-score-percent]")?.textContent?.trim()) &&
        Boolean(document.querySelector("[data-exam-score-status]")?.textContent?.trim()) &&
        (manualCorrect
          ? manualCorrect.closest("[data-exam-review-item]")?.classList.contains("is-rated") === true
          : examReviewCards.every((card) => card.classList.contains("is-rated")))
      );
      const separateExamSurface = !assessmentSurfaceRequired || Boolean(
        examShell && !examShell.hidden && examCard && catalogIdBeforeExam &&
        examPanel?.hidden === false &&
        catalogPanel?.hidden === true &&
        document.querySelector<HTMLElement>(
          "[data-question-host] [data-sb-question-card]",
        )?.dataset.questionId === catalogIdBeforeExam &&
        examWasSeparate &&
        examLearningControlsHidden &&
        examDraftRestored &&
        examFinished,
      );
      return {
        initialSeen,
        incorrectToReview,
        wrongThenCorrect,
        repeatedCorrect,
        crossAttemptDiagnostic,
        correctNotLearned,
        learnedClearsReview,
        reviewClearsLearned,
        starIndependent,
        resetOne,
        calculationRetry,
        openResponseRepeatable,
        vocabularyRetry,
        filterResults,
        persistenceQuestionId: stateTargets[0]?.id ?? "",
        threeMainTabs,
        topicQuestionNavigation,
        catalogLinkScrollsTop,
        catalogLinkScrollPosition: { mainTabsTop, hotbarBottom, scrollY: window.scrollY },
        assessmentSurfaceRequired,
        examTasksAreAuthentic,
        examFinishOnlyOnLastQuestion,
        examSolutionsVisible,
        examSelfAssessmentCollapsed,
        examDetailedCriteriaCollapsed,
        examSelfAssessmentScoring,
        assessmentVisualsCroppedWithoutScroll,
        learningVisualsEvidenceBound,
        learningVisualsResponsiveWithoutScroll,
        denseVocabularyDeckResponsive,
        moduleTitleLayoutResponsive,
        inlineEquationsReadableWithoutOverflow,
        answerOptionMathReadable,
        courseHierarchyTraceable,
        assessmentSessionBounded,
        separateExamSurface,
      };
    });
    const persistenceSelector = interaction.persistenceQuestionId
      ? `[data-question-host] [data-sb-question-card][data-question-id="${interaction.persistenceQuestionId}"] [data-toggle-starred]`
      : "[data-question-host] [data-toggle-starred]";
    await page.locator('[data-main-tab="catalog"]').click();
    const starredButton = page.locator(persistenceSelector).first();
    let reloadRestores = true;
    let compactState = true;
    if (await starredButton.count()) {
      if (await starredButton.getAttribute("aria-pressed") !== "true") {
        await starredButton.click();
      }
      compactState = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((key) =>
          key.startsWith("study-buddy:study-builder:v1:")
        );
        if (keys.length !== 1) return false;
        const value = JSON.parse(localStorage.getItem(keys[0]!) || "{}") as Record<string, unknown>;
        const allowedRoot = new Set(["schemaVersion", "questions"]);
        if (Object.keys(value).some((key) => !allowedRoot.has(key))) return false;
        if (!value.questions || typeof value.questions !== "object" || Array.isArray(value.questions)) return false;
        const allowedQuestion = new Set(["seen", "learned", "review", "starred", "draft"]);
        return Object.values(value.questions as Record<string, unknown>).every((question) =>
          Boolean(question) &&
          typeof question === "object" &&
          !Array.isArray(question) &&
          Object.keys(question as object).every((key) => allowedQuestion.has(key))
        ) && !("attempts" in value) && !("history" in value);
      });
      await page.reload({ waitUntil: "load", timeout: 20_000 });
      await page.locator('[data-main-tab="catalog"]').click();
      reloadRestores = compactState &&
        await page.locator(persistenceSelector).first().getAttribute("aria-pressed") === "true";
    }
    page.once("dialog", async (dialog) => dialog.accept());
    await page.locator("[data-reset-all]").dispatchEvent("click");
    const resetAll = await page.evaluate(() => {
      const adaptiveKeys = Object.keys(localStorage).filter((key) =>
        key.startsWith("study-buddy:study-builder:v1:")
      );
      if (localStorage.getItem("study-buddy-validator-foreign") !== "preserve") return false;
      if (adaptiveKeys.length === 0) return true;
      if (adaptiveKeys.length > 1) return false;
      const value = JSON.parse(localStorage.getItem(adaptiveKeys[0]!) || "{}") as {
        questions?: Record<string, Record<string, unknown>>;
      };
      const questionValues = Object.values(value.questions ?? {});
      return questionValues.length <= 1 && questionValues.every((question) =>
        question.seen === true && Object.keys(question).every((key) => key === "seen")
      );
    });
    const layout = await page.evaluate(() => {
      const visible = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((element) => {
        const rect = element.getBoundingClientRect();
        return element.offsetParent !== null && rect.width > 0 && rect.height > 0;
      });
      const clipped = visible.filter((element) => {
        if (!element.matches("button,input,textarea,select,.question-card,.reading-card,.concept-card,.assessment-card,.exam-shell,.catalog-workspace")) return false;
        const rect = element.getBoundingClientRect();
        if (rect.left >= -2 && rect.right <= innerWidth + 2) return false;
        let ancestor = element.parentElement;
        while (ancestor) {
          const overflowX = getComputedStyle(ancestor).overflowX;
          if (
            (overflowX === "auto" || overflowX === "scroll") &&
            ancestor.scrollWidth > ancestor.clientWidth + 2
          ) return false;
          ancestor = ancestor.parentElement;
        }
        return true;
      }).slice(0, 10).map((element) => `${element.tagName}:${element.textContent?.trim().slice(0, 50) ?? ""}`);
      const shortTargets = visible.filter((element) => element.matches("button") && element.getBoundingClientRect().height < 43)
        .slice(0, 10).map((element) => element.textContent?.trim().slice(0, 50) ?? "");
      const activeCatalogCards = document.querySelectorAll(
        "[data-question-host] [data-sb-question-card]",
      ).length;
      const activeExamCards = document.querySelectorAll(
        "[data-exam-question] [data-sb-question-card]",
      ).length;
      const originVisible = Boolean(document.querySelector(".origin-chip")?.textContent?.trim());
      const scopeVisible = Boolean(document.querySelector(".scope-note")?.textContent?.trim());
      const overflowingElements = visible.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const overflowLeft = Math.max(0, -rect.left);
        const overflowRight = Math.max(0, rect.right - document.documentElement.clientWidth);
        if (overflowLeft <= 2 && overflowRight <= 2) return [];
        const style = getComputedStyle(element);
        const classes = Array.from(element.classList).slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("");
        return [{
          selector: element.id
            ? `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`
            : `${element.tagName.toLowerCase()}${classes}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          overflowLeft: Math.round(overflowLeft),
          overflowRight: Math.round(overflowRight),
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          overflowX: style.overflowX,
          whiteSpace: style.whiteSpace,
        }];
      }).sort((left, right) =>
        (right.overflowLeft + right.overflowRight) - (left.overflowLeft + left.overflowRight)
      ).slice(0, 8);
      return {
        pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        clipped,
        shortTargets,
        activeCatalogCards,
        activeExamCards,
        originVisible,
        scopeVisible,
        overflowingElements,
      };
    });
    const filterValues = Object.values(interaction.filterResults);
    const ok = interaction.initialSeen &&
      interaction.incorrectToReview &&
      interaction.wrongThenCorrect &&
      interaction.repeatedCorrect &&
      interaction.correctNotLearned &&
      interaction.learnedClearsReview &&
      interaction.reviewClearsLearned &&
      interaction.starIndependent &&
      interaction.resetOne &&
      interaction.calculationRetry &&
      interaction.openResponseRepeatable &&
      interaction.vocabularyRetry &&
      filterValues.every(Boolean) &&
      interaction.threeMainTabs &&
      interaction.topicQuestionNavigation &&
      interaction.catalogLinkScrollsTop &&
      interaction.examTasksAreAuthentic &&
      interaction.examFinishOnlyOnLastQuestion &&
      interaction.examSolutionsVisible &&
      interaction.examSelfAssessmentCollapsed &&
      interaction.examDetailedCriteriaCollapsed &&
      interaction.examSelfAssessmentScoring &&
      interaction.assessmentVisualsCroppedWithoutScroll &&
      interaction.learningVisualsEvidenceBound &&
      interaction.learningVisualsResponsiveWithoutScroll &&
      interaction.denseVocabularyDeckResponsive &&
      interaction.moduleTitleLayoutResponsive &&
      interaction.inlineEquationsReadableWithoutOverflow &&
      interaction.answerOptionMathReadable &&
      interaction.courseHierarchyTraceable &&
      interaction.assessmentSessionBounded &&
      interaction.separateExamSurface &&
      reloadRestores &&
      compactState &&
      resetAll &&
      layout.pageOverflow <= 2 &&
      layout.clipped.length === 0 &&
      layout.shortTargets.length === 0 &&
      layout.activeCatalogCards <= 1 &&
      layout.activeExamCards <= 1 &&
      layout.originVisible &&
      layout.scopeVisible;
    audit.push({
      viewport: viewport.name,
      state: "adaptive-controls-layout",
      ...interaction,
      reloadRestores,
      compactState,
      resetAll,
      layout,
      ok,
    });
    learnerStateScenarios["question-open-recorded"] &&= interaction.initialSeen;
    learnerStateScenarios["incorrect-to-review"] &&= interaction.incorrectToReview;
    learnerStateScenarios["correct-clears-review-without-auto-learning"] &&= interaction.correctNotLearned;
    learnerStateScenarios["manual-learned-clears-review"] &&= interaction.learnedClearsReview;
    learnerStateScenarios["manual-review-clears-learned"] &&= interaction.reviewClearsLearned;
    learnerStateScenarios["star-independent-of-learning-status"] &&= interaction.starIndependent;
    learnerStateScenarios["repeated-wrong-then-correct-attempt"] &&= interaction.wrongThenCorrect && interaction.calculationRetry && interaction.vocabularyRetry;
    learnerStateScenarios["repeated-correct-attempt"] &&= interaction.repeatedCorrect;
    learnerStateScenarios["reset-one-question"] &&= interaction.resetOne;
    learnerStateScenarios["reset-all-questions"] &&= resetAll;
    learnerStateScenarios["reload-restores-compact-state"] &&= reloadRestores;
    learnerStateScenarios["combined-topic-stage-filter"] &&= interaction.filterResults.combined;
    learnerStateScenarios["continue-status-filter"] &&= interaction.filterResults.continue;
    learnerStateScenarios["review-status-filter"] &&= interaction.filterResults.review;
    learnerStateScenarios["starred-status-filter"] &&= interaction.filterResults.starred;
    learnerStateScenarios["learned-status-filter"] &&= interaction.filterResults.learned;
    learnerStateScenarios["three-main-tabs"] &&= interaction.threeMainTabs;
    learnerStateScenarios["topic-question-navigation"] &&= interaction.topicQuestionNavigation;
    learnerStateScenarios["catalog-links-scroll-to-top"] &&= interaction.catalogLinkScrollsTop;
    learnerStateScenarios["exam-tasks-are-authentic"] &&= interaction.examTasksAreAuthentic;
    learnerStateScenarios["exam-finish-only-on-last-question"] &&=
      interaction.examFinishOnlyOnLastQuestion;
    learnerStateScenarios["exam-solutions-visible"] &&= interaction.examSolutionsVisible;
    learnerStateScenarios["exam-self-assessment-collapsed"] &&=
      interaction.examSelfAssessmentCollapsed;
    learnerStateScenarios["exam-detailed-criteria-collapsed"] &&=
      interaction.examDetailedCriteriaCollapsed;
    learnerStateScenarios["exam-self-assessment-scoring"] &&= interaction.examSelfAssessmentScoring;
    learnerStateScenarios["assessment-visuals-cropped-without-scroll"] &&=
      interaction.assessmentVisualsCroppedWithoutScroll;
    learnerStateScenarios["learning-visuals-evidence-bound"] &&=
      interaction.learningVisualsEvidenceBound;
    learnerStateScenarios["learning-visuals-responsive-without-scroll"] &&=
      interaction.learningVisualsResponsiveWithoutScroll;
    learnerStateScenarios["dense-vocabulary-deck-responsive"] &&=
      interaction.denseVocabularyDeckResponsive;
    learnerStateScenarios["adaptive-module-title-layout"] &&=
      interaction.moduleTitleLayoutResponsive;
    learnerStateScenarios["inline-equations-readable-without-overflow"] &&=
      interaction.inlineEquationsReadableWithoutOverflow;
    learnerStateScenarios["answer-option-math-readable"] &&=
      interaction.answerOptionMathReadable;
    learnerStateScenarios["course-hierarchy-traceable"] &&=
      interaction.courseHierarchyTraceable;
    learnerStateScenarios["assessment-session-bounded"] &&=
      interaction.assessmentSessionBounded;
    learnerStateScenarios["separate-exam-surface"] &&= interaction.separateExamSurface;
    if (!ok) {
      failureCount += 1;
      issues.push(issue(
        "adaptive-study-guide-matrix",
        `${viewport.name}: learner controls, pools, persistence, reset, or responsive layout failed. See interaction audit.`,
        {
          viewport: viewport.name,
          pageOverflow: layout.pageOverflow,
          clippedControls: layout.clipped,
          shortTargets: layout.shortTargets,
          offenders: layout.overflowingElements,
        },
      ));
    }
  }
  const allScenariosPassed = Object.values(learnerStateScenarios).every(Boolean);
  if (!allScenariosPassed) {
    failureCount += 1;
    issues.push(issue("adaptive-learner-state-scenarios", "One or more required learner-state scenarios failed."));
  }
  const runtimeNetworkRequests = externalRequests.length;
  const blockingBrowserIssues = issues.length + pageErrors.length + runtimeNetworkRequests;
  const totalFailureCount = Math.max(failureCount, blockingBrowserIssues);
  const reportPath = path.join(runDir, "interaction-audit.json");
  await writeFile(reportPath, `${JSON.stringify({
    ok: totalFailureCount === 0,
    failureCount: totalFailureCount,
    auditedStates: audit.length,
    permissionViolations: 0,
    finalQuizSubmissions: 0,
    runtimeNetworkRequests,
    blockingBrowserIssues,
    learnerStateScenarios,
    states: audit,
  }, null, 2)}\n`, "utf8");
  return {
    id: "adaptive-study-guide-all-required-states",
    ok: totalFailureCount === 0,
    evidence: totalFailureCount === 0
      ? `Playwright validated every required learner-state scenario at desktop, laptop, tablet, and mobile widths. Report: ${reportPath}`
      : `Playwright found ${totalFailureCount} adaptive Study Guide failures. Report: ${reportPath}`,
  };
}

async function validateExamPersistenceInBrowser(
  page: Page,
  issues: HtmlValidationIssue[],
): Promise<BrowserValidationCheck> {
  const marker = `study-buddy-reload-${Date.now()}`;
  const start = page.locator("[data-sb-exam-start]").first();
  const surface = page.locator("[data-sb-exam-surface]").first();
  const draft = page.locator("[data-sb-exam-draft]").first();
  const finish = page.locator("[data-sb-exam-end]").first();
  const result = page.locator("[data-sb-exam-result]").first();
  try {
    await start.click({ timeout: 5_000 });
    await surface.waitFor({ state: "visible", timeout: 5_000 });
    await draft.fill(marker, { timeout: 5_000 });
    await draft.dispatchEvent("change");
    await page.waitForTimeout(1_100);
    const before = await examBrowserSnapshot(page);
    if (!before.active) {
      issues.push(issue("exam-active-state", "Exam start did not set body[data-sb-exam-active='true']."));
    }
    if (!before.storageEntries) {
      issues.push(issue("exam-persistence-storage", "Exam start and draft input did not persist state to localStorage."));
    }
    if (!Number.isFinite(before.remainingMs) || before.remainingMs <= 0) {
      issues.push(issue("exam-timer", "Exam timer did not expose a positive numeric data-remaining-ms value."));
    }
    if (!before.lockedCount || !before.allLocked) {
      issues.push(issue("exam-lock", "Exam navigation/help/formula/source regions were not unavailable while the exam was active."));
    }

    await page.reload({ waitUntil: "load", timeout: 20_000 });
    await surface.waitFor({ state: "visible", timeout: 5_000 });
    const after = await examBrowserSnapshot(page);
    const restoredDraft = await page.locator("[data-sb-exam-draft]").first().inputValue();
    if (!after.active) {
      issues.push(issue("exam-reload-active", "Reload did not restore the active exam surface and active-state marker."));
    }
    if (restoredDraft !== marker) {
      issues.push(issue("exam-reload-draft", "Reload did not restore the unsubmitted exam draft."));
    }
    if (!Number.isFinite(after.remainingMs) || after.remainingMs <= 0 || after.remainingMs > before.remainingMs) {
      issues.push(issue("exam-reload-timer", "Reload did not restore a non-increasing positive exam countdown."));
    }
    if (after.score !== before.score) {
      issues.push(issue("exam-reload-score", "Reload changed the current exam score."));
    }
    if (!after.lockedCount || !after.allLocked) {
      issues.push(issue("exam-reload-lock", "Reload did not restore exam navigation/help/formula/source locks."));
    }

    page.once("dialog", (dialog) => dialog.accept());
    await finish.click({ timeout: 5_000 });
    await surface.waitFor({ state: "hidden", timeout: 5_000 });
    await result.waitFor({ state: "visible", timeout: 5_000 });
    const ended = await examBrowserSnapshot(page);
    if (ended.active) {
      issues.push(issue("exam-finish-active", "Finishing the exam did not clear the active-state marker."));
    }
    const flowIssues = issues.filter((entry) => entry.code.startsWith("exam-"));
    return {
      id: "exam-start-draft-reload-finish",
      ok: flowIssues.length === 0,
      evidence: flowIssues.length === 0
        ? "Playwright started an exam, persisted a draft on input/change, observed a positive countdown and locked study regions, reloaded the file, verified the active surface, draft, non-increasing timer, score and locks, then finished and observed the persistent result."
        : `Playwright completed the exam persistence flow with ${flowIssues.length} failed assertion(s).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(issue(
      "exam-persistence-flow",
      `Real exam start → draft → reload → finish validation failed: ${message}`,
    ));
    return {
      id: "exam-start-draft-reload-finish",
      ok: false,
      evidence: `Playwright could not complete the real exam persistence flow: ${message}`,
    };
  }
}

async function examBrowserSnapshot(page: Page): Promise<{
  active: boolean;
  remainingMs: number;
  score: string;
  storageEntries: number;
  lockedCount: number;
  allLocked: boolean;
}> {
  return page.evaluate(() => {
    const timer = document.querySelector<HTMLElement>("[data-sb-exam-timer]");
    const locked = Array.from(document.querySelectorAll<HTMLElement>("[data-sb-exam-lock]"));
    let allLocked = locked.length > 0;
    for (const element of locked) {
      const style = getComputedStyle(element);
      const disabled = element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
        ? element.disabled
        : false;
      const unavailable = disabled || element.inert || element.getAttribute("aria-hidden") === "true" ||
        style.display === "none" || style.visibility === "hidden" ||
        element.getClientRects().length === 0;
      if (!unavailable) {
        allLocked = false;
        break;
      }
    }
    return {
      active: document.body.dataset.sbExamActive === "true",
      remainingMs: Number(timer?.dataset.remainingMs ?? Number.NaN),
      score: document.querySelector<HTMLElement>("[data-sb-exam-score]")?.textContent?.trim() ?? "",
      storageEntries: localStorage.length,
      lockedCount: locked.length,
      allLocked,
    };
  });
}

function findExternalReferences(html: string): string[] {
  const refs: string[] = [];
  const markup = withoutScriptAndStyleContents(html);
  const attrPattern = /\b(?:src|poster|data)\s*=\s*["']([^"']+)["']/gi;
  for (const match of markup.matchAll(attrPattern)) {
    const value = match[1];
    if (isExternalReference(value)) {
      refs.push(value);
    }
  }
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of markup.matchAll(hrefPattern)) {
    const value = match[1];
    if (/^https?:/i.test(value) || value.startsWith("#") || isSafeRelativeReference(value)) {
      continue;
    }
    if (isExternalReference(value)) refs.push(value);
  }
  const cssUrlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  for (const match of html.matchAll(cssUrlPattern)) {
    const value = match[1];
    if (isExternalReference(value) || !value.startsWith("data:")) {
      refs.push(value);
    }
  }
  return refs;
}

function findSiblingReferences(html: string): string[] {
  const refs: string[] = [];
  const markup = withoutScriptAndStyleContents(html);
  const attributePattern = /\b(?:src|poster|data)\s*=\s*["']([^"']+)["']/gi;
  for (const match of markup.matchAll(attributePattern)) {
    const value = match[1].trim();
    if (isSiblingReference(value)) refs.push(value);
  }
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of markup.matchAll(hrefPattern)) {
    const value = match[1].trim();
    if (isSiblingReference(value)) refs.push(value);
  }
  const srcsetPattern = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  for (const match of markup.matchAll(srcsetPattern)) {
    for (const candidate of match[1].split(",")) {
      const value = candidate.trim().split(/\s+/, 1)[0];
      if (isSiblingReference(value)) refs.push(value);
    }
  }
  const cssUrlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  for (const match of html.matchAll(cssUrlPattern)) {
    const value = match[1].trim();
    if (isSiblingReference(value)) refs.push(value);
  }
  return [...new Set(refs)];
}

function withoutScriptAndStyleContents(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) => {
    const openingTag = block.match(/^<[^>]+>/)?.[0] ?? "";
    const closingTag = block.match(/<\/[^>]+>$/)?.[0] ?? "";
    return `${openingTag}${closingTag}`;
  });
}

function isSiblingReference(value: string): boolean {
  if (!value || value.startsWith("#") || value.startsWith("data:")) return false;
  if (/^(?:https?:|mailto:|tel:|sms:|ftp:|blob:|javascript:|\/\/)/i.test(value)) return false;
  return true;
}

function isSafeRelativeReference(value: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.startsWith("//") &&
    !value.split(/[?#]/)[0].split("/").includes("..")
  );
}

function isExternalReference(value: string): boolean {
  return /^(?:https?:|\/\/|file:|ftp:|blob:)/i.test(value);
}

function missingInteractionRequirements(html: string, kind: WebLayoutKind): HtmlValidationIssue[] {
  const lower = html.toLowerCase();
  const controls = (html.match(/<(?:button|input|select|textarea|details)\b/gi) ?? []).length;
  const issues: HtmlValidationIssue[] = [];
  if (kind !== "reference" && controls < 2) {
    issues.push(issue("controls", "Interactive layouts require at least two controls."));
  }
  const required: Record<WebLayoutKind, Array<[RegExp, string]>> = {
    auto: [],
    reference: [],
    "study-guide": [
      [/data-sb-hotbar/i, "Study guides require the standardized top hotbar."],
      [/data-sb-course-tabs/i, "Study guides require standardized chapter tabs."],
      [/data-sb-course-map/i, "Study guides require a compact course map."],
      [/data-sb-topic/i, "Study guides require standardized topic blocks."],
      [/data-sb-learning-content/i, "Study guides require readable learning content."],
      [/data-sb-practice/i, "Study guides require an applied practice workspace."],
      [/data-sb-progress/i, "Study guides require persistent learning progress."],
      [/data-sb-sources/i, "Study guides require a grouped source register."],
    ],
    flashcards: [
      [/progress|fortschritt|data-progress/i, "Flashcards require progress."],
      [/flip|umdrehen|is-flipped|data-card/i, "Flashcards require flip interaction."],
      [/known|bekannt|needs-review|review/i, "Flashcards require known/review state."],
    ],
    "concept-visualization": [
      [/<(?:svg|canvas)\b/i, "Concept visualizations require inline SVG or canvas."],
      [/reset|zurücksetzen/i, "Concept visualizations require reset control."],
    ],
    simulation: [
      [/<input\b[^>]*type=["']?(?:range|number)/i, "Simulations require numeric controls."],
      [/output|result|ergebnis|state|zustand/i, "Simulations require live output/state."],
    ],
    "exam-practice": [
      [/score|punkte|bewertung/i, "Exam practice requires scoring."],
      [/review|auswertung|lösung/i, "Exam practice requires review or solution state."],
      [/data-sb-exam-start/i, "Exam practice requires a data-sb-exam-start control."],
      [/data-sb-exam-surface/i, "Exam practice requires a data-sb-exam-surface container."],
      [/data-sb-exam-draft/i, "Exam practice requires a representative data-sb-exam-draft input."],
      [/data-sb-exam-timer/i, "Exam practice requires a data-sb-exam-timer countdown."],
      [/data-sb-exam-score/i, "Exam practice requires a data-sb-exam-score readout."],
      [/data-sb-exam-end/i, "Exam practice requires a data-sb-exam-end control."],
      [/data-sb-exam-result/i, "Exam practice requires a persistent data-sb-exam-result view."],
      [/data-sb-exam-lock/i, "Exam practice requires data-sb-exam-lock regions."],
    ],
    quiz: [
      [/feedback|richtig|falsch|correct|incorrect/i, "Quizzes require immediate feedback."],
      [/score|punkte/i, "Quizzes require score."],
    ],
    worksheet: [
      [/<(?:textarea|input)\b/i, "Worksheets require editable answer fields."],
      [/solution|lösung|reveal|anzeigen/i, "Worksheets require solution reveal."],
    ],
  };
  for (const [pattern, message] of required[kind] ?? []) {
    if (!pattern.test(lower)) {
      issues.push(issue("interaction-requirement", message));
    }
  }
  return issues;
}

function issue(code: string, message: string, details?: JsonObject): HtmlValidationIssue {
  return { code, message, ...(details ? { details } : {}) };
}
