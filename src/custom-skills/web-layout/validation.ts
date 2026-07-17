import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { STUDY_BUDDY_HTML_MARKS, STUDY_BUDDY_HTML_TOKENS } from "./designGuidelines.js";
import type { JsonObject } from "./state.js";
import type { WebLayoutKind } from "./types.js";

export interface HtmlValidationIssue {
  code: string;
  message: string;
}

export interface HtmlValidationReport {
  ok: boolean;
  issues: HtmlValidationIssue[];
  screenshotPaths: string[];
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
  const browserReport = await validateHtmlFileInBrowser(previewPath, options);
  return {
    ok: browserReport.ok,
    issues: [...staticReport.issues, ...browserReport.issues],
    screenshotPaths: browserReport.screenshotPaths,
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
  const browserReport = await validateHtmlFileInBrowser(filePath, options);
  return {
    ok: browserReport.ok,
    issues: [...staticReport.issues, ...browserReport.issues],
    screenshotPaths: browserReport.screenshotPaths,
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
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(trimmed) || /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(trimmed)) {
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

  return { ok: issues.length === 0, issues, screenshotPaths: [] };
}

export function validationReportToJson(report: HtmlValidationReport): JsonObject {
  return {
    ok: report.ok,
    issues: report.issues.map((entry) => ({
      code: entry.code,
      message: entry.message,
    })),
    screenshotPaths: report.screenshotPaths,
  };
}

async function validateHtmlFileInBrowser(filePath: string, options: BrowserValidationOptions): Promise<HtmlValidationReport> {
  const issues: HtmlValidationIssue[] = [];
  const screenshotsDir = path.join(options.runDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });
  const screenshotPaths = [
    path.join(screenshotsDir, "desktop.png"),
    path.join(screenshotsDir, "mobile.png"),
  ];
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await browser.newContext();
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
      await page.screenshot({ path: viewport.path, fullPage: true });
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

    const firstButton = page.locator("button").first();
    if (await firstButton.count()) {
      await firstButton.click({ timeout: 5_000 }).catch((error: unknown) => {
        issues.push(issue("button-click", error instanceof Error ? error.message : String(error)));
      });
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
  return { ok: issues.length === 0, issues, screenshotPaths };
}

function findExternalReferences(html: string): string[] {
  const refs: string[] = [];
  const attrPattern = /\b(?:src|poster|data)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attrPattern)) {
    const value = match[1];
    if (isExternalReference(value)) {
      refs.push(value);
    }
  }
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefPattern)) {
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
  const attributePattern = /\b(?:src|poster|data)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    const value = match[1].trim();
    if (isSiblingReference(value)) refs.push(value);
  }
  const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefPattern)) {
    const value = match[1].trim();
    if (isSiblingReference(value)) refs.push(value);
  }
  const srcsetPattern = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(srcsetPattern)) {
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
