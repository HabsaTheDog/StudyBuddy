import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { STUDY_BUDDY_HTML_MARKS, STUDY_BUDDY_HTML_TOKENS } from "./designGuidelines.js";
import { OFFLINE_CSP } from "./htmlShell.js";
import type { JsonObject } from "./state.js";
import type { WebLayoutKind } from "./types.js";

export interface HtmlValidationIssue {
  code: string;
  message: string;
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
    path.join(screenshotsDir, "mobile.png"),
  ];
  const browser = await chromium.launch({ headless: !options.headed });
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
      { width: 390, height: 844, path: screenshotPaths[1] },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.screenshot({ path: viewport.path, fullPage: true }).catch(async () => {
        // Chromium can reject extremely tall full-page captures even when the page is valid.
        // Layout metrics below still inspect the complete document, so a viewport fallback is sufficient.
        await page.screenshot({ path: viewport.path, fullPage: false });
      });
      const metrics = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        bodyHeight: document.body.scrollHeight,
        viewportWidth: window.innerWidth,
        textLength: document.body.innerText.trim().length,
        centerTag: document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight / 2, document.body.scrollHeight - 1))?.tagName ?? null,
      }));
      if (metrics.bodyWidth > metrics.viewportWidth + 2) {
        issues.push(issue("horizontal-overflow", `Horizontal overflow at ${viewport.width}px viewport.`));
      }
      if (metrics.bodyHeight <= 0 || metrics.textLength <= 0 || !metrics.centerTag) {
        issues.push(issue("blank-page", `Page appears blank at ${viewport.width}px viewport.`));
      }
    }

    if (kind === "exam-practice") {
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
    for (const screenshotPath of screenshotPaths) {
      const screenshotStat = await stat(screenshotPath).catch(() => null);
      if (!screenshotStat?.isFile() || screenshotStat.size === 0) {
        issues.push(issue("screenshot-empty", `Screenshot was not written: ${screenshotPath}`));
      }
    }
  } finally {
    await browser.close();
  }
  return { ok: issues.length === 0, issues, screenshotPaths, browserChecks };
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

function issue(code: string, message: string): HtmlValidationIssue {
  return { code, message };
}
