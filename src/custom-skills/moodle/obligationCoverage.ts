import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MoodleRuntimeConfig } from "./types.js";
import { normalizeObligationUrl } from "./obligationDiscovery.js";

export const OBLIGATION_COVERAGE_FILE = "obligation-coverage.json";

export interface ObligationCoverage {
  schemaVersion: 1;
  requested: true;
  scope: "targeted" | "all_relevant";
  requestedRange: { start: string; end: string } | null;
  calendar: { required: boolean; status: "success" | "empty" | "failed" | "not_requested"; complete: boolean };
  calendarCourseHints: { total: number; unresolved: string[] };
  budget: { maxPages: number; maxDepth: number };
  discovered: { courses: string[]; sections: string[]; activities: string[] };
  visited: string[];
  failed: string[];
  pending: string[];
  enumeration?: { complete: boolean; observed: number; advertised: number | null };
  frontierTruncated: boolean;
  complete: boolean;
  detail: string;
}

export class ObligationCoverageTracker {
  private readonly required = new Set<string>();
  private readonly courses = new Set<string>();
  private readonly sections = new Set<string>();
  private readonly activities = new Set<string>();
  private readonly visited = new Set<string>();
  private readonly failed = new Set<string>();
  private frontierTruncated = false;
  private enumeration: ObligationCoverage["enumeration"];

  constructor(private readonly config: MoodleRuntimeConfig) {
    if (!config.intentDecision?.obligationDiscovery?.requested) return;
    for (const url of config.targetCourseUrls ?? []) this.discover([url]);
    if (isCourseUrl(config.moodleUrl)) this.discover([config.moodleUrl]);
  }

  get enabled(): boolean {
    return this.config.intentDecision?.obligationDiscovery?.requested === true;
  }

  discover(urls: string[]): void {
    if (!this.enabled) return;
    for (const candidate of urls) {
      const url = normalize(candidate);
      if (!url) continue;
      if (isCourseUrl(url)) this.courses.add(url);
      else if (isSectionUrl(url)) this.sections.add(url);
      else this.activities.add(url);
      this.required.add(url);
    }
  }

  markSuccess(url: string): void {
    const normalized = normalize(url);
    if (!normalized || !this.enabled) return;
    this.visited.add(normalized);
    this.failed.delete(normalized);
  }

  markFailure(url: string): void {
    const normalized = normalize(url);
    if (!normalized || !this.enabled) return;
    this.failed.add(normalized);
  }

  markEnumeration(complete: boolean, observed: number, advertised: number | null): void {
    this.enumeration = { complete, observed, advertised };
    if (!complete) this.markTruncated();
  }

  markTruncated(): void {
    if (this.enabled) this.frontierTruncated = true;
  }

  async persist(): Promise<ObligationCoverage | null> {
    if (!this.enabled) return null;
    const policy = this.config.intentDecision!.obligationDiscovery!;
    const selection = this.config.calendarSelection;
    const calendarStatus = selection?.status ?? "not_requested";
    const calendarComplete = !policy.calendarFirst || !this.config.calendarUrl || this.config.sourceMode === "moodle" || (
      (calendarStatus === "success" || calendarStatus === "empty") &&
      selection?.truncated !== true &&
      Boolean(selection?.requestedRange)
    );
    const pending = [...this.required].filter((url) => !this.visited.has(url));
    const failed = [...this.failed];
    const unresolvedHints = this.config.obligationUnresolvedCourseHints ?? [];
    const timeResolved = !policy.temporal || this.config.temporalRequest?.status === "resolved" || Boolean(selection?.requestedRange);
    const complete = timeResolved && calendarComplete && unresolvedHints.length === 0 && this.courses.size > 0 &&
      pending.length === 0 && failed.length === 0 && !this.frontierTruncated;
    const result: ObligationCoverage = {
      schemaVersion: 1,
      requested: true,
      scope: policy.scope,
      requestedRange: this.config.temporalRequest?.status === "resolved"
        ? { start: this.config.temporalRequest.start!, end: this.config.temporalRequest.end! }
        : selection?.requestedRange ?? null,
      calendar: {
        required: policy.calendarFirst,
        status: calendarStatus,
        complete: calendarComplete,
      },
      calendarCourseHints: {
        total: this.config.obligationCourseHints?.length ?? 0,
        unresolved: unresolvedHints,
      },
      budget: { maxPages: this.config.maxPages, maxDepth: this.config.maxDepth },
      discovered: {
        courses: [...this.courses],
        sections: [...this.sections],
        activities: [...this.activities],
      },
      visited: [...this.visited],
      failed,
      pending,
      enumeration: this.enumeration,
      frontierTruncated: this.frontierTruncated,
      complete,
      detail: complete
        ? `Audited ${this.courses.size} course(s) and ${this.activities.size + this.sections.size} deep page(s).`
        : `Audit incomplete: ${pending.length} pending, ${failed.length} failed, ${unresolvedHints.length} calendar course hint(s) unresolved, frontierTruncated=${this.frontierTruncated}.`,
    };
    const artifactPath = path.join(this.config.runDir, OBLIGATION_COVERAGE_FILE);
    await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await this.config.diagnostics?.updateCoverage("moodle", { artifacts: [artifactPath] });
    return result;
  }
}

export async function readObligationCoverage(runDir: string): Promise<ObligationCoverage | null> {
  try {
    return JSON.parse(await readFile(path.join(runDir, OBLIGATION_COVERAGE_FILE), "utf8")) as ObligationCoverage;
  } catch {
    return null;
  }
}

function normalize(value: string): string | null {
  try {
    return normalizeObligationUrl(value);
  } catch {
    return null;
  }
}

function isCourseUrl(value: string): boolean {
  return new URL(value).pathname.endsWith("/course/view.php");
}

function isSectionUrl(value: string): boolean {
  return new URL(value).pathname.endsWith("/course/section.php");
}
