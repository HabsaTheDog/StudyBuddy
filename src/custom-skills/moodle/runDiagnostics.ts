import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { inspectHtmlSource, replaceHtmlSourceRanges } from "../../shared/htmlSource.js";
import type { AgentBrowserClient } from "./agentBrowserClient.js";
import { formatCodexRuntimeSummary, type CodexRuntimeReport } from "./codexRuntime.js";

export type SourceName = "moodle" | "cis" | "calendar";

export type SourceFetchStatus =
  | "not_requested"
  | "attempted"
  | "success"
  | "partial"
  | "empty"
  | "failed"
  | "failed_auth"
  | "timeout";

export type FailureKind =
  | "timeout"
  | "auth"
  | "network"
  | "selector"
  | "access_denied"
  | "unknown";

export interface SourceCoverageEntry {
  status: SourceFetchStatus;
  detail: string;
  urls: string[];
  attemptedUrls: string[];
  pages: number;
  lastUrl?: string;
  lastSuccessfulStep?: string;
  failureKind?: FailureKind;
  artifacts: string[];
}

export interface SourceCoverage {
  moodle: SourceCoverageEntry;
  cis: SourceCoverageEntry;
  calendar: SourceCoverageEntry;
}

export interface RunEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase:
    | "config"
    | "moodle_login"
    | "moodle_crawl"
    | "moodle_download"
    | "cis_login"
    | "cis_crawl"
    | "cis_download"
    | "calendar"
    | "answer"
    | "runtime"
    | "model"
    | "analyzer"
    | "formatter"
    | "typst"
    | "diagnostic"
    | "cleanup";
  message: string;
  data?: Record<string, unknown>;
}

export interface RunSummaryInput {
  route: string;
  status: "success" | "partial" | "failed" | "canceled" | "timeout";
  prompt: string;
  taskPrompt?: string;
  error?: string;
  outputPath?: string;
  pdfPath?: string;
  answerPath?: string;
  answerJsonPath?: string;
  stateHasRawText: boolean;
  stateHasDocument: boolean;
  extractedDataPath?: string;
  codexRuntime?: CodexRuntimeReport;
}

export const initialSourceCoverage: SourceCoverage = {
  moodle: {
    status: "not_requested",
    detail: "Moodle was not queried.",
    urls: [],
    attemptedUrls: [],
    pages: 0,
    artifacts: [],
  },
  cis: {
    status: "not_requested",
    detail: "CIS was not queried.",
    urls: [],
    attemptedUrls: [],
    pages: 0,
    artifacts: [],
  },
  calendar: {
    status: "not_requested",
    detail: "Personal calendar was not queried.",
    urls: [],
    attemptedUrls: [],
    pages: 0,
    artifacts: [],
  },
};

export class RunDiagnostics {
  readonly runDir: string;
  private readonly eventsPath: string;
  private readonly coveragePath: string;
  private readonly summaryPath: string;
  private readonly secrets: string[];
  private readonly packagedApp: boolean;
  private coverage: SourceCoverage = structuredClone(initialSourceCoverage);
  private lastEventAt = Date.now();
  private persistenceQueue: Promise<void> = Promise.resolve();

  constructor(input: {
    runDir: string;
    secrets?: string[];
    initialCoverage?: SourceCoverage;
    packagedApp?: boolean;
  }) {
    this.runDir = input.runDir;
    this.eventsPath = path.join(input.runDir, "run-events.jsonl");
    this.coveragePath = path.join(input.runDir, "source_coverage.json");
    this.summaryPath = path.join(input.runDir, "run-summary.md");
    this.secrets = (input.secrets ?? []).filter(Boolean);
    this.packagedApp = input.packagedApp ?? Boolean(process.versions.electron);
    if (input.initialCoverage) {
      this.coverage = {
        ...structuredClone(input.initialCoverage),
        calendar: structuredClone(input.initialCoverage.calendar ?? initialSourceCoverage.calendar),
      };
    }
  }

  get runSummaryPath(): string {
    return this.summaryPath;
  }

  get lastActivityAt(): number {
    return this.lastEventAt;
  }

  getCoverage(): SourceCoverage {
    return structuredClone(this.coverage);
  }

  async init(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    await this.enqueuePersistence(async () => {
      await this.writeCoverage();
      await writePrivateFile(this.eventsPath, "");
      await this.writeRunningSummary();
    });
  }

  async log(
    level: RunEvent["level"],
    phase: RunEvent["phase"],
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (phase !== "diagnostic") {
      this.lastEventAt = Date.now();
    }
    const event: RunEvent = {
      timestamp: new Date().toISOString(),
      level,
      phase,
      message: this.redact(message),
      data: data ? (JSON.parse(this.redact(JSON.stringify(data))) as Record<string, unknown>) : undefined,
    };
    await this.enqueuePersistence(() =>
      writeFile(this.eventsPath, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "a",
        mode: 0o600,
      }),
    );
    const prefix = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      `[study-buddy] ${prefix} ${phase}: ${event.message}`,
    );
  }

  async updateCoverage(source: SourceName, update: Partial<SourceCoverageEntry>): Promise<void> {
    const current = this.coverage[source];
    this.coverage = {
      ...this.coverage,
      [source]: {
        ...current,
        ...update,
        urls: unique([...(current.urls ?? []), ...(update.urls ?? [])]),
        attemptedUrls: unique([...(current.attemptedUrls ?? []), ...(update.attemptedUrls ?? [])]),
        artifacts: unique([...(current.artifacts ?? []), ...(update.artifacts ?? [])]),
      },
    };
    await this.enqueuePersistence(async () => {
      await this.writeCoverage();
      await this.writeRunningSummary();
    });
  }

  async markAttempt(source: SourceName, url: string, detail: string): Promise<void> {
    await this.updateCoverage(source, {
      status: this.coverage[source].status === "not_requested" ? "attempted" : this.coverage[source].status,
      detail,
      attemptedUrls: [url],
      lastUrl: url,
    });
  }

  async markSuccess(
    source: SourceName,
    input: { detail: string; urls: string[]; pages: number; partial?: boolean },
  ): Promise<void> {
    await this.updateCoverage(source, {
      status: input.partial ? "partial" : input.pages > 0 ? "success" : "empty",
      detail: input.detail,
      urls: input.urls,
      pages: input.pages,
      lastSuccessfulStep: input.detail,
      failureKind: undefined,
    });
  }

  async markFailure(
    source: SourceName,
    input: { detail: string; urls?: string[]; attemptedUrls?: string[]; failureKind?: FailureKind },
  ): Promise<void> {
    await this.updateCoverage(source, {
      status: input.failureKind === "timeout" ? "timeout" : input.failureKind === "auth" ? "failed_auth" : "failed",
      detail: this.redact(input.detail),
      urls: input.urls ?? [],
      attemptedUrls: input.attemptedUrls ?? [],
      failureKind: input.failureKind ?? "unknown",
    });
  }

  async capturePageDiagnostics(
    source: SourceName,
    page: Page,
    label: string,
    error: unknown,
  ): Promise<string[]> {
    const dir = path.join(this.runDir, "diagnostics");
    await mkdir(dir, { recursive: true });
    const safeLabel = safeFileName(`${source}-${label}`);
    const base = path.join(dir, safeLabel);
    const artifacts: string[] = [];
    const currentUrl = page.url();
    const errorText = error instanceof Error ? error.message : String(error);

    await writePrivateFile(`${base}-current-url.txt`, `${this.redactDiagnosticContent(currentUrl)}\n`);
    artifacts.push(`${base}-current-url.txt`);
    await writePrivateFile(`${base}-error.txt`, `${this.redactDiagnosticContent(errorText)}\n`);
    artifacts.push(`${base}-error.txt`);

    if (diagnosticPageContentEnabled()) {
      const visibleText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      await writePrivateFile(`${base}-visible-text.txt`, this.redactDiagnosticContent(visibleText));
      artifacts.push(`${base}-visible-text.txt`);

      const html = await page.content().catch(() => "");
      await writePrivateFile(`${base}-page.html`, this.sanitizeDiagnosticHtml(html));
      artifacts.push(`${base}-page.html`);
    }

    if (diagnosticScreenshotsEnabled()) {
      const screenshotPath = `${base}-screenshot.png`;
      const screenshotWritten = await page
        .screenshot({ path: screenshotPath, fullPage: true })
        .then(() => true)
        .catch(() => false);
      if (screenshotWritten) artifacts.push(screenshotPath);
    }

    await this.updateCoverage(source, { artifacts, lastUrl: currentUrl });
    return artifacts;
  }

  async captureAgentBrowserDiagnostics(
    source: SourceName,
    client: AgentBrowserClient,
    label: string,
    error: unknown,
  ): Promise<string[]> {
    const dir = path.join(this.runDir, "diagnostics");
    await mkdir(dir, { recursive: true });
    const safeLabel = safeFileName(`${source}-${label}`);
    const base = path.join(dir, safeLabel);
    const artifacts: string[] = [];
    const errorText = error instanceof Error ? error.message : String(error);

    await writePrivateFile(`${base}-error.txt`, `${this.redactDiagnosticContent(errorText)}\n`);
    artifacts.push(`${base}-error.txt`);

    const currentUrl = await client.getUrl().catch(() => "");
    await writePrivateFile(`${base}-current-url.txt`, `${this.redactDiagnosticContent(currentUrl)}\n`);
    artifacts.push(`${base}-current-url.txt`);

    if (diagnosticPageContentEnabled()) {
      const snapshot = await client.snapshot({ interactive: true, urls: true, compact: true }).catch(() => null);
      if (snapshot) {
        await writePrivateFile(
          `${base}-snapshot.json`,
          `${this.redactDiagnosticContent(JSON.stringify(snapshot, null, 2))}\n`,
        );
        await writePrivateFile(
          `${base}-visible-text.txt`,
          this.redactDiagnosticContent(snapshotToText(snapshot.snapshot)),
        );
        artifacts.push(`${base}-snapshot.json`, `${base}-visible-text.txt`);
      }

      const html = await client
        .evalText("document.documentElement ? document.documentElement.outerHTML : ''")
        .catch(() => "");
      if (html) {
        await writePrivateFile(`${base}-page.html`, this.sanitizeDiagnosticHtml(html));
        artifacts.push(`${base}-page.html`);
      }
    }

    await this.updateCoverage(source, { artifacts, lastUrl: currentUrl });
    return artifacts;
  }

  async writeSummary(input: RunSummaryInput): Promise<void> {
    const coverage = this.getCoverage();
    const lines = [
      "# Study Buddy Run Summary",
      "",
      `Prompt: ${this.redactDiagnosticContent(input.prompt)}`,
      ...(input.taskPrompt && input.taskPrompt !== input.prompt
        ? [`Task prompt: ${this.redactDiagnosticContent(input.taskPrompt)}`]
        : []),
      "",
      `Route: ${input.route}`,
      `Run status: ${input.status}`,
      `Last successful step: ${latestSuccessfulStep(coverage)}`,
      "",
      "## Moodle coverage",
      formatCoverage(coverage.moodle),
      "",
      "## CIS coverage",
      formatCoverage(coverage.cis),
      "",
      "## Calendar coverage",
      formatCoverage(coverage.calendar),
      "",
      "## Codex runtime",
      ...formatCodexRuntimeSummary(input.codexRuntime),
      "",
      "## Generated artifacts",
      input.extractedDataPath ? `- Extracted data: ${input.extractedDataPath}` : "- Extracted data: none",
      input.answerPath ? `- Answer: ${input.answerPath}` : "- Answer: none",
      input.answerJsonPath ? `- Answer data: ${input.answerJsonPath}` : "- Answer data: none",
      input.answerPath ? "- Typst: none" : input.outputPath ? `- Typst: ${input.outputPath}` : "- Typst: none",
      input.answerPath ? "- PDF: none" : input.pdfPath ? `- PDF: ${input.pdfPath}` : "- PDF: none",
      `- Raw source text: ${input.stateHasRawText ? "moodle_raw.txt" : "none"}`,
      `- Final document in state: ${input.stateHasDocument ? "yes" : "no"}`,
      "",
      "## Failure cause",
      input.error ? this.redact(input.error) : "None.",
      "",
      "## Recommended next attempt",
      recommendation(input, coverage, this.packagedApp),
      "",
    ];
    await this.enqueuePersistence(() => this.writeAtomically(this.summaryPath, `${lines.join("\n")}\n`));
  }

  async readEvents(): Promise<string> {
    return readFile(this.eventsPath, "utf8").catch(() => "");
  }

  private async writeCoverage(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    await this.writeAtomically(
      this.coveragePath,
      `${this.redactDiagnosticContent(JSON.stringify(this.coverage, null, 2))}\n`,
    );
  }

  private async writeRunningSummary(): Promise<void> {
    const lines = [
      "# Study Buddy Run Summary",
      "",
      "Run status: running",
      `Last event at: ${new Date(this.lastEventAt).toISOString()}`,
      "",
      "## Moodle coverage",
      formatCoverage(this.coverage.moodle),
      "",
      "## CIS coverage",
      formatCoverage(this.coverage.cis),
      "",
      "## Calendar coverage",
      formatCoverage(this.coverage.calendar),
      "",
      "Final summary will be written when the run exits cleanly.",
      "",
    ];
    await this.writeAtomically(this.summaryPath, `${lines.join("\n")}\n`);
  }

  private redact(text: string): string {
    return this.secrets.reduce((current, secret) => current.split(secret).join("[redacted]"), text);
  }

  private redactDiagnosticContent(text: string): string {
    return this.redact(text)
      .replace(
        /([?&](?:sesskey|token|access_token|refresh_token|auth|authorization|password|passwd|secret|signature|code|key)=)[^&#\s"'<>]*/gi,
        "$1[redacted]",
      )
      .replace(
        /((?:"|')?(?:sesskey|token|access_token|refresh_token|authorization|password|passwd|secret|signature|api[_-]?key)(?:"|')?\s*[:=]\s*)(["'])[^"']*\2/gi,
        "$1$2[redacted]$2",
      );
  }

  private sanitizeDiagnosticHtml(html: string): string {
    const redacted = this.redactDiagnosticContent(html);
    const document = inspectHtmlSource(redacted);
    return replaceHtmlSourceRanges(redacted, document.elements.flatMap((element) => {
      if (element.tagName === "script") {
        return [{
          startOffset: element.startOffset,
          endOffset: element.endOffset,
          value: "<!-- script removed from diagnostics -->",
        }];
      }
      if (element.tagName === "textarea") {
        return [{
          startOffset: element.contentStartOffset,
          endOffset: element.contentEndOffset,
          value: "[redacted]",
        }];
      }
      const valueRange = element.tagName === "input" ? element.attributeRanges.get("value") : undefined;
      if (valueRange) {
        return [{
          ...valueRange,
          value: 'value="[redacted]"',
        }];
      }
      return [];
    }));
  }

  private enqueuePersistence(operation: () => Promise<void>): Promise<void> {
    const next = this.persistenceQueue.then(operation, operation);
    this.persistenceQueue = next.catch(() => undefined);
    return next;
  }

  private async writeAtomically(filePath: string, content: string): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writePrivateFile(temporaryPath, content);
    await rename(temporaryPath, filePath);
  }
}

export function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "artifact";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function formatCoverage(entry: SourceCoverageEntry): string {
  return [
    `- status: ${entry.status}`,
    `- detail: ${entry.detail}`,
    `- attempted URLs: ${entry.attemptedUrls.length ? entry.attemptedUrls.join(", ") : "none"}`,
    `- extracted URLs: ${entry.urls.length ? entry.urls.join(", ") : "none"}`,
    `- pages: ${entry.pages}`,
    `- artifacts: ${entry.artifacts.length ? entry.artifacts.join(", ") : "none"}`,
  ].join("\n");
}

function latestSuccessfulStep(coverage: SourceCoverage): string {
  return coverage.calendar.lastSuccessfulStep ||
    coverage.cis.lastSuccessfulStep ||
    coverage.moodle.lastSuccessfulStep ||
    "none";
}

function recommendation(input: RunSummaryInput, coverage: SourceCoverage, packagedApp: boolean): string {
  if (input.status === "success") {
    return "No retry needed.";
  }
  if (
    input.error?.startsWith("Codex runtime preflight failed") ||
    input.error?.toLowerCase().includes("requires a newer version of codex")
  ) {
    if (packagedApp) {
      return "Update Study Buddy to the latest available build, then retry the same request. If no update is available, report this run so the packaged runtime can be repaired; no Moodle reconnect or source crawl is needed to diagnose this failure.";
    }
    return `Update the pinned Study Buddy runtime with \`${input.codexRuntime?.updateCommand ?? "npm install --save-exact @openai/codex-sdk@latest"}\`, run \`npm run moodle:doctor -- --no-cache\`, then retry the same request. No source crawl is needed to diagnose this failure.`;
  }
  if (coverage.moodle.status === "timeout") {
    return "Retry with diagnostic mode or browser-headed mode, then inspect diagnostics/* for the timed-out Moodle page.";
  }
  if (coverage.moodle.status === "failed_auth" || coverage.cis.status === "failed_auth") {
    return "Refresh credentials or browser storage state, then run diagnostic mode before a document run.";
  }
  if (coverage.calendar.status === "failed" || coverage.calendar.status === "timeout") {
    return "Check the private calendar URL locally; CIS fallback remains available.";
  }
  if (coverage.moodle.status === "not_requested") {
    return "Check the route selection because Moodle was not attempted.";
  }
  return "Inspect run-events.jsonl, source_coverage.json, and diagnostics/*, then retry with a narrower prompt or direct course URL.";
}

function snapshotToText(snapshot: string): string {
  return snapshot
    .split("\n")
    .map((line) => line.replace(/\s*\[ref=[^\]]+\]/g, "").replace(/\s*url=\S+/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

function diagnosticScreenshotsEnabled(): boolean {
  return process.env.STUDY_BUDDY_DIAGNOSTICS_INCLUDE_SCREENSHOTS === "true";
}

function diagnosticPageContentEnabled(): boolean {
  return process.env.STUDY_BUDDY_DIAGNOSTICS_INCLUDE_PAGE_CONTENT === "true";
}

async function writePrivateFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
}
