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
  private lastProgressAt = Date.now();

  constructor(input: { runDir: string }) {
    this.runDir = input.runDir;
    this.eventsPath = path.join(input.runDir, "run-events.jsonl");
    this.summaryPath = path.join(input.runDir, "run-summary.md");
  }

  get runSummaryPath(): string {
    return this.summaryPath;
  }

  get lastActivityAt(): number {
    return this.lastProgressAt;
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
    if (phase !== "cleanup" || !message.startsWith("Heartbeat:")) {
      this.lastProgressAt = this.lastEventAt;
    }
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
      ...(input.taskPrompt && input.taskPrompt !== input.prompt
        ? [`Task prompt: ${input.taskPrompt}`]
        : []),
      "",
      `Run status: ${input.status}`,
      `Last event at: ${new Date(this.lastEventAt).toISOString()}`,
      "",
      "## Generated artifacts",
      input.outputPath ? `- HTML: ${input.outputPath}` : "- HTML: none",
      input.validationReportPath ? `- Validation report: ${input.validationReportPath}` : "- Validation report: none",
      input.screenshotPaths?.length ? `- Screenshots: ${input.screenshotPaths.join(", ")}` : "- Screenshots: none",
      input.sourceBundlePath ? `- Editable source: ${input.sourceBundlePath}` : "- Editable source: none",
      input.mediaManifestPath ? `- Media manifest: ${input.mediaManifestPath}` : "- Media manifest: none",
      input.artifactBytes !== undefined ? `- Final HTML size: ${formatBytes(input.artifactBytes)}` : "- Final HTML size: unknown",
      input.embeddedAssetBytes !== undefined ? `- Embedded media before Base64: ${formatBytes(input.embeddedAssetBytes)}` : "- Embedded media before Base64: unknown",
      input.estimatedDecodedImageBytes !== undefined ? `- Estimated decoded raster memory: ${formatBytes(input.estimatedDecodedImageBytes)}` : "- Estimated decoded raster memory: unknown",
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

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} bytes`;
}
