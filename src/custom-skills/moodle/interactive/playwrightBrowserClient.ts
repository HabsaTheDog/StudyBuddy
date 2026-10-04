import { readEnrolledCourses } from "../moodleInventory.js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { browserExecutableLaunchOptions } from "../../shared/browserExecutable.js";

import type {
  AgentBrowserClient,
  AgentBrowserCommandResult,
  AgentBrowserSnapshot,
  SnapshotOptions,
} from "./agentBrowserClient.js";
import { ensureLoggedIn, type BrowserLoginConfig } from "./browserAuth.js";
import {
  BrowserAuthenticationGate,
  isAuthenticationSnapshot,
  redactSensitiveValues,
  sanitizeBrowserSnapshot,
  sanitizeModelVisibleUrl,
} from "./browserSecurity.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { captureQuizQuestionEvidence, type QuizQuestionEvidence } from "./quizMedia.js";
import { assertNoFinalQuizSubmission, QuizRequestBlockedError, type QuizRequestGuard, type QuizHttpRequest } from "./quizAttemptRequestGuard.js";

const EMPTY_RESULT: AgentBrowserCommandResult = { stdout: "", stderr: "" };

export function createPlaywrightBrowserClient(config: MoodleRuntimeConfig): AgentBrowserClient {
  return new PlaywrightBrowserClient(config);
}

class PlaywrightBrowserClient implements AgentBrowserClient {
  readonly #config: MoodleRuntimeConfig;
  readonly #authenticationGate = new BrowserAuthenticationGate();
  #browser: Browser | null = null;
  #context: BrowserContext | null = null;
  #page: Page | null = null;
  #quizRequestGuard: QuizRequestGuard | undefined;
  #quizRequestError: QuizRequestBlockedError | null = null;
  readonly #pendingQuizGuards = new Set<Promise<void>>();

  setQuizRequestGuard(guard: QuizRequestGuard): void {
    this.#quizRequestGuard = guard;
  }

  async #admitQuizRequest(input: QuizHttpRequest): Promise<void> {
    try {
      assertNoFinalQuizSubmission(input);
      await this.#quizRequestGuard?.(input);
    } catch {
      this.#quizRequestError = new QuizRequestBlockedError();
      throw this.#quizRequestError;
    }
  }

  async #settleQuizGuards(): Promise<void> {
    while (this.#pendingQuizGuards.size) await Promise.all([...this.#pendingQuizGuards]);
    if (this.#quizRequestError) throw this.#quizRequestError;
  }

  async #guarded<T>(operation: () => Promise<T>): Promise<T> {
    await this.#settleQuizGuards();
    try {
      const result = await operation();
      await this.#settleQuizGuards();
      return result;
    } catch (error) {
      await this.#settleQuizGuards();
      throw error;
    }
  }

  constructor(config: MoodleRuntimeConfig) {
    this.#config = config;
  }

  get authenticationState() {
    return this.#authenticationGate.state;
  }

  lockAuthentication(): void {
    this.#authenticationGate.lock();
  }

  completeAuthentication(): void {
    this.#authenticationGate.authenticate();
  }

  failAuthentication(): void {
    this.#authenticationGate.fail();
  }

  async secureLogin(config: BrowserLoginConfig): Promise<void> {
    const page = await this.#getPage();
    this.#authenticationGate.lock();
    try {
      await this.#guarded(() => ensureLoggedIn(page, config));
      this.#authenticationGate.authenticate();
    } catch (error) {
      this.#authenticationGate.fail();
      throw error;
    }
  }

  async enrolledCourses() {
    this.#authenticationGate.assertReadable("enrolled course inventory");
    return readEnrolledCourses(await this.#getPage(), this.#config.dashboardUrl);
  }

  async captureQuestionImage(questionId: string, targetPath: string): Promise<void> {
    this.#authenticationGate.assertReadable("question image");
    if (!/^question-[a-zA-Z0-9_-]+$/.test(questionId)) throw new Error("Invalid question image target");
    const page = await this.#getPage();
    const question = page.locator(`[id="${questionId}"]`);
    await question.screenshot({ path: targetPath, animations: "disabled" });
  }

  async captureQuestionEvidence(questionId: string, directory: string): Promise<QuizQuestionEvidence> {
    this.#authenticationGate.assertReadable("question evidence");
    const page = await this.#getPage();
    return this.#guarded(() => captureQuizQuestionEvidence(page, questionId, directory, this.#sensitiveValues(), input => this.#admitQuizRequest(input)));
  }

  async doctor(): Promise<AgentBrowserCommandResult> {
    await this.#getPage();
    return EMPTY_RESULT;
  }

  async open(url: string): Promise<AgentBrowserCommandResult> {
    this.#assertAllowedUrl(url);
    const page = await this.#getPage();
    // Moodle pages can keep analytics, media or polling requests alive after the
    // document is usable. Those requests must not turn navigation into a failure.
    const response = await this.#guarded(() => page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }));
    if (response && !response.ok())
      throw new Error(`Browser navigation failed with HTTP ${response.status()}.`);
    this.#assertAllowedUrl(page.url());
    return EMPTY_RESULT;
  }

  async snapshot(options: SnapshotOptions = {}): Promise<AgentBrowserSnapshot> {
    this.#authenticationGate.assertReadable("snapshot");
    const page = await this.#getPage();
    const data = await page.evaluate(
      ({ interactive, urls, compact, depth }) => {
        const selector = interactive
          ? "a,button,input,select,textarea,[role],[contenteditable='true']"
          : "body *";
        const refs: Record<string, { role?: string; name?: string; href?: string }> = {};
        const lines: string[] = [];
        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(
          0,
          Math.max(50, (depth ?? 10) * 100),
        );
        let index = 0;
        for (const element of elements) {
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const ref = `sb${++index}`;
          element.dataset.studyBuddyRef = ref;
          const input = element instanceof HTMLInputElement ? element : null;
          const inputRole = input
            ? ["submit", "button", "reset"].includes(input.type.toLowerCase())
              ? "button"
              : ["checkbox", "radio"].includes(input.type.toLowerCase())
                ? input.type.toLowerCase()
                : "textbox"
            : null;
          const role =
            element.getAttribute("role") ||
            (element.tagName === "A"
              ? "link"
              : element.tagName === "BUTTON"
                ? "button"
                : inputRole || element.tagName === "TEXTAREA"
                  ? inputRole || "textbox"
                  : element.tagName.toLowerCase());
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
            : "";
          const label = input?.labels?.[0]?.textContent ?? "";
          const inputButtonValue =
            input && ["submit", "button", "reset"].includes(input.type.toLowerCase())
              ? input.value
              : "";
          const name = (
            element.getAttribute("aria-label") ||
            labelledText ||
            label ||
            input?.placeholder ||
            inputButtonValue ||
            element.textContent ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300);
          const href =
            urls && element instanceof HTMLAnchorElement && /^https?:$/i.test(element.protocol)
              ? element.href
              : undefined;
          refs[ref] = { role, ...(name ? { name } : {}), ...(href ? { href } : {}) };
          const sensitive =
            input?.type === "password" ||
            /(?:password|passwd|passcode|secret|token|credential)/i.test(`${role} ${name}`);
          lines.push(
            `${role} "${sensitive ? "Credential" : name}" [ref=${ref}${
              href ? `, url=${href}` : ""
            }${sensitive ? ", sensitive=true, state=credential-field" : ""}]`,
          );
          if (compact && lines.length >= 500) break;
        }
        return { refs, snapshot: lines.join("\n") };
      },
      {
        interactive: options.interactive ?? false,
        urls: options.urls ?? false,
        compact: options.compact ?? false,
        depth: options.depth,
      },
    );
    const sensitiveValues = this.#sensitiveValues();
    const snapshot = sanitizeBrowserSnapshot(
      {
        origin: sanitizeModelVisibleUrl(page.url(), sensitiveValues),
        refs: data.refs,
        snapshot: data.snapshot,
      },
      sensitiveValues,
    );
    if (this.#authenticationGate.state !== "authenticated" && isAuthenticationSnapshot(snapshot)) {
      this.#authenticationGate.lock();
      this.#authenticationGate.assertReadable("snapshot");
    }
    return snapshot;
  }

  async getText(selector = "body"): Promise<string> {
    this.#authenticationGate.assertReadable("text extraction");
    const locator = (await this.#getPage()).locator(this.#selector(selector)).first();
    return redactSensitiveValues((await locator.innerText()).trim(), this.#sensitiveValues());
  }

  async getTitle(): Promise<string> {
    this.#authenticationGate.assertReadable("title extraction");
    return redactSensitiveValues(await (await this.#getPage()).title(), this.#sensitiveValues());
  }

  async getUrl(): Promise<string> {
    this.#authenticationGate.assertReadable("URL extraction");
    return sanitizeModelVisibleUrl((await this.#getPage()).url(), this.#sensitiveValues());
  }

  async evalJson<T = unknown>(script: string): Promise<T> {
    this.#authenticationGate.assertReadable("DOM evaluation");
    const page = await this.#getPage();
    const value = await this.#guarded(() => page.evaluate(script));
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw new Error("Browser DOM evaluation did not return JSON.");
    }
    try {
      return JSON.parse(redactSensitiveValues(serialized, this.#sensitiveValues())) as T;
    } catch (error) {
      throw new Error("Browser DOM evaluation returned invalid JSON.", { cause: error });
    }
  }

  async fill(selector: string, value: string): Promise<AgentBrowserCommandResult> {
    if (this.#sensitiveValues().some((secret) => secret && value.includes(secret))) {
      throw new Error("Credential filling must use the locked secureLogin transaction.");
    }
    const page = await this.#getPage();
    await this.#guarded(() => page.locator(this.#selector(selector)).first().fill(value));
    return EMPTY_RESULT;
  }

  async click(selector: string): Promise<AgentBrowserCommandResult> {
    const page = await this.#getPage();
    await this.#guarded(async () => {
      await page.locator(this.#selector(selector)).first().click();
      // Capture only after the destination DOM, without waiting for background polling.
      await page.waitForLoadState("domcontentloaded", { timeout: 45_000 });
    });
    return EMPTY_RESULT;
  }

  async press(key: string): Promise<AgentBrowserCommandResult> {
    const page = await this.#getPage();
    await this.#guarded(() => page.keyboard.press(key));
    return EMPTY_RESULT;
  }

  async wait(ms: number): Promise<AgentBrowserCommandResult> {
    await (await this.#getPage()).waitForTimeout(ms);
    return EMPTY_RESULT;
  }

  async download(selector: string, targetPath: string): Promise<AgentBrowserCommandResult> {
    const page = await this.#getPage();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(this.#selector(selector)).first().click(),
    ]);
    await download.saveAs(targetPath);
    return EMPTY_RESULT;
  }

  async upload(selector: string, filePaths: string[]): Promise<AgentBrowserCommandResult> {
    if (filePaths.length === 0) throw new Error("At least one assignment file is required.");
    await (
      await this.#getPage()
    )
      .locator(this.#selector(selector))
      .first()
      .setInputFiles(filePaths);
    return EMPTY_RESULT;
  }

  async close(): Promise<AgentBrowserCommandResult> {
    await this.#context?.close().catch(() => undefined);
    await this.#browser?.close().catch(() => undefined);
    this.#context = null;
    this.#browser = null;
    this.#page = null;
    return EMPTY_RESULT;
  }

  async #getPage(): Promise<Page> {
    await this.#settleQuizGuards();
    if (this.#page) return this.#page;
    this.#browser = await chromium.launch({
      headless: this.#config.headless,
      ...browserExecutableLaunchOptions(),
    });
    this.#context = await this.#browser.newContext(
      { serviceWorkers: "block", ...(this.#config.storageState ? { storageState: this.#config.storageState } : {}) },
    );
    await this.#context.route("**/*", async route => {
      const request = route.request();
      const prior = request.redirectedFrom();
      const input = { url: request.url(), method: request.method(), postData: request.postData(),
        ...(prior ? { redirectedFrom: { url: prior.url(), method: prior.method() } } : {}) };
      const admission = (async () => {
        try {
          await this.#admitQuizRequest(input);
          if (this.#quizRequestGuard && request.method().toUpperCase() === "POST" &&
              /\/mod\/quiz\/startattempt\.php$/i.test(new URL(request.url()).pathname)) {
            // Playwright routing only sees the first request in a redirect chain.
            // Fetch this already-admitted start exactly once and validate its real
            // redirect before exposing it to the browser or replaying any POST.
            const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
            try {
              const status = response.status();
              if (status >= 300 && status < 400) {
                if (status !== 302 && status !== 303) throw new QuizRequestBlockedError();
                const location = response.headers()["location"];
                if (!location) throw new QuizRequestBlockedError();
                const start = new URL(request.url());
                const target = new URL(location, start);
                if (target.origin !== start.origin || target.username || target.password ||
                    target.pathname !== start.pathname.replace(/startattempt\.php$/i, "attempt.php")) {
                  throw new QuizRequestBlockedError();
                }
                await this.#admitQuizRequest({ url: target.toString(), method: "GET", postData: null,
                  redirectedFrom: { url: request.url(), method: request.method() } });
              }
              await route.fulfill({ response });
            } finally { await response.dispose(); }
          } else {
            await route.continue();
          }
        } catch {
          // Never expose URLs, sesskeys, request bodies or callback errors. A
          // denied autosave remains a sticky failure, not a successful write.
          this.#quizRequestError = new QuizRequestBlockedError();
          await route.abort("blockedbyclient").catch(() => undefined);
        }
      })();
      this.#pendingQuizGuards.add(admission);
      try { await admission; } finally { this.#pendingQuizGuards.delete(admission); }
    });
    this.#page = await this.#context.newPage();
    return this.#page;
  }

  #selector(selector: string): string {
    return selector.startsWith("@")
      ? `[data-study-buddy-ref="${selector.slice(1).replace(/[^a-zA-Z0-9_-]/g, "")}"]`
      : selector;
  }

  #sensitiveValues(): Array<string | undefined> {
    return [
      this.#config.username,
      this.#config.password,
      this.#config.cisUsername,
      this.#config.cisPassword,
      this.#config.calendarUrl,
    ];
  }

  #assertAllowedUrl(value: string): void {
    const url = new URL(value);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      throw new Error("Browser navigation requires HTTPS.");
    }
    const allowed = this.#config.browserAllowedDomains ?? [];
    const matches = allowed.some((entry) => {
      const domain = entry.toLowerCase();
      const hostname = url.hostname.toLowerCase();
      return domain.startsWith("*.")
        ? hostname === domain.slice(2) || hostname.endsWith(domain.slice(1))
        : hostname === domain;
    });
    if (allowed.length > 0 && !matches)
      throw new Error("Browser navigation target is not allowlisted.");
  }
}
