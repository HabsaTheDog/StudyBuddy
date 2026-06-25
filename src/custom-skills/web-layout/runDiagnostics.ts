import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebLayoutRunPhase, WebLayoutRunSummaryInput } from "./types.js";

export interface WebLayoutRunEvent {
  timestamp: string;
  level: "info" | "warn" | "error";
  phase: WebLayoutRunPhase;
  message: string;
  data?: Record<string, unknown>;
}

export class WebLayoutRunDiagnostics {
  readonly runDir: string;
  private readonly eventsPath: string;
  private readonly summaryPath: string;
  private lastEventAt = Date.now();

  constructor(input: { runDir: string }) {
    this.runDir = input.runDir;
    this.eventsPath = path.join(input.runDir, "run-events.jsonl");
    this.summaryPath = path.join(input.runDir, "run-summary.md");
  }

  get runSummaryPath(): string {
    return this.summaryPath;
  }

  get lastActivityAt(): number {
    return this.lastEventAt;
  }

  async init(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    await writeFile(this.eventsPath, "", "utf8");
    await this.writeSummary({
      status: "running",
      prompt: "",
      stateHasSource: false,
      stateHasLayoutSpec: false,
      stateHasHtml: false,
    });
  }

  async log(
    level: WebLayoutRunEvent["level"],
    phase: WebLayoutRunPhase,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    this.lastEventAt = Date.now();
    const event: WebLayoutRunEvent = {
      timestamp: new Date().toISOString(),
      level,
      phase,
      message,
      data,
    };
    await writeFile(this.eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
    const prefix = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";
    console.error(`[web-layout] ${prefix} ${phase}: ${message}`);
  }

  async writeSummary(input: WebLayoutRunSummaryInput): Promise<void> {
    const lines = [
      "# Study Buddy Web Layout Run Summary",
      "",
      `Prompt: ${input.prompt || "n/a"}`,
      "",
      `Run status: ${input.status}`,
      `Last event at: ${new Date(this.lastEventAt).toISOString()}`,
      "",
      "## Generated artifacts",
      input.outputPath ? `- HTML: ${input.outputPath}` : "- HTML: none",
      input.validationReportPath ? `- Validation report: ${input.validationReportPath}` : "- Validation report: none",
      input.screenshotPaths?.length ? `- Screenshots: ${input.screenshotPaths.join(", ")}` : "- Screenshots: none",
      "",
      "## State",
      `- Source text: ${input.stateHasSource ? "yes" : "no"}`,
      `- Layout spec: ${input.stateHasLayoutSpec ? "yes" : "no"}`,
      `- HTML document: ${input.stateHasHtml ? "yes" : "no"}`,
      "",
      "## Failure cause",
      input.error || "None.",
      "",
    ];
    await writeFile(this.summaryPath, `${lines.join("\n")}\n`, "utf8");
  }
}
