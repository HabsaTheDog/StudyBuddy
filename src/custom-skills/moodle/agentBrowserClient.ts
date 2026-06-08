import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MoodleRuntimeConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_AGENT_BROWSER_PACKAGE = "agent-browser@0.27.0";

export interface AgentBrowserClient {
  open(url: string): Promise<AgentBrowserCommandResult>;
  snapshot(options?: SnapshotOptions): Promise<AgentBrowserSnapshot>;
  getUrl(): Promise<string>;
  evalText(script: string): Promise<string>;
  fill(selector: string, value: string): Promise<AgentBrowserCommandResult>;
  click(selector: string): Promise<AgentBrowserCommandResult>;
  press(key: string): Promise<AgentBrowserCommandResult>;
  wait(ms: number): Promise<AgentBrowserCommandResult>;
  download(selector: string, targetPath: string): Promise<AgentBrowserCommandResult>;
  close(): Promise<AgentBrowserCommandResult>;
}

export interface AgentBrowserCommandResult {
  stdout: string;
  stderr: string;
}

export interface SnapshotOptions {
  interactive?: boolean;
  urls?: boolean;
  compact?: boolean;
}

export interface AgentBrowserSnapshot {
  origin: string;
  refs: Record<string, { role?: string; name?: string }>;
  snapshot: string;
}

interface CommandSpec {
  command: string;
  baseArgs: string[];
  sensitiveValues: string[];
  signal?: AbortSignal;
}

export class AgentBrowserCommandError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(input: { message: string; stdout: string; stderr: string; exitCode: number | null }) {
    super(input.message);
    this.name = "AgentBrowserCommandError";
    this.stdout = input.stdout;
    this.stderr = input.stderr;
    this.exitCode = input.exitCode;
  }
}

export function createAgentBrowserClient(config: MoodleRuntimeConfig): AgentBrowserClient {
  return new CliAgentBrowserClient(buildAgentBrowserCommandSpec(config));
}

function buildAgentBrowserCommandSpec(config: MoodleRuntimeConfig): CommandSpec {
  const session = `sb-${shortHash(`${config.requestName}:${config.runDir}`)}`;
  return {
    command: process.env.AGENT_BROWSER_BIN || "npx",
    baseArgs: [
      ...(process.env.AGENT_BROWSER_BIN
        ? []
        : ["-y", process.env.AGENT_BROWSER_PACKAGE || DEFAULT_AGENT_BROWSER_PACKAGE]),
      "--session",
      process.env.MOODLE_BROWSER_SESSION || session,
      "--session-name",
      process.env.MOODLE_BROWSER_SESSION_NAME || "study-buddy-technikum",
      "--allowed-domains",
      process.env.MOODLE_BROWSER_ALLOWED_DOMAINS ||
        "moodle.technikum-wien.at,cis.technikum-wien.at,*.technikum-wien.at",
      "--content-boundaries",
      "--max-output",
      process.env.MOODLE_BROWSER_MAX_OUTPUT || "50000",
    ],
    sensitiveValues: [
      config.username,
      config.password,
      config.cisUsername,
      config.cisPassword,
    ].filter((value): value is string => Boolean(value)),
    signal: config.abortSignal,
  };
}

class CliAgentBrowserClient implements AgentBrowserClient {
  constructor(private readonly spec: CommandSpec) {}

  async open(url: string): Promise<AgentBrowserCommandResult> {
    return this.run(["open", url]);
  }

  async snapshot(options: SnapshotOptions = {}): Promise<AgentBrowserSnapshot> {
    const args = ["snapshot", "--json"];
    if (options.interactive) {
      args.push("--interactive");
    }
    if (options.urls) {
      args.push("--urls");
    }
    if (options.compact) {
      args.push("--compact");
    }
    return parseAgentBrowserSnapshot((await this.run(args)).stdout);
  }

  async getUrl(): Promise<string> {
    return (await this.run(["get", "url"])).stdout.trim();
  }

  async evalText(script: string): Promise<string> {
    return extractContentBoundary((await this.run(["eval", script])).stdout).trim();
  }

  async fill(selector: string, value: string): Promise<AgentBrowserCommandResult> {
    return this.run(["fill", selector, value]);
  }

  async click(selector: string): Promise<AgentBrowserCommandResult> {
    return this.run(["click", selector]);
  }

  async press(key: string): Promise<AgentBrowserCommandResult> {
    return this.run(["press", key]);
  }

  async wait(ms: number): Promise<AgentBrowserCommandResult> {
    return this.run(["wait", String(ms)]);
  }

  async download(selector: string, targetPath: string): Promise<AgentBrowserCommandResult> {
    return this.run(["download", selector, targetPath]);
  }

  async close(): Promise<AgentBrowserCommandResult> {
    return this.run(["close"], true);
  }

  private async run(
    args: string[],
    ignoreAbort = false,
  ): Promise<AgentBrowserCommandResult> {
    const allArgs = [...this.spec.baseArgs, ...args];
    try {
      const result = await execFileAsync(this.spec.command, allArgs, {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
        signal: ignoreAbort ? undefined : this.spec.signal,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      throw toAgentBrowserCommandError(error, this.spec.sensitiveValues);
    }
  }
}

function parseAgentBrowserSnapshot(stdout: string): AgentBrowserSnapshot {
  const parsed = JSON.parse(stdout) as {
    success?: boolean;
    data?: AgentBrowserSnapshot;
    error?: unknown;
  };
  if (parsed.success === false || !parsed.data) {
    throw new AgentBrowserCommandError({
      message: `agent-browser snapshot failed: ${formatUnknownError(parsed.error)}`,
      stdout,
      stderr: "",
      exitCode: null,
    });
  }
  return parsed.data;
}

function extractContentBoundary(stdout: string): string {
  const match =
    /--- AGENT_BROWSER_PAGE_CONTENT[^\n]*---\n([\s\S]*?)\n--- END_AGENT_BROWSER_PAGE_CONTENT/.exec(
      stdout,
    );
  return match?.[1] ?? stdout;
}

function toAgentBrowserCommandError(
  error: unknown,
  sensitiveValues: string[],
): AgentBrowserCommandError {
  const stdout = sanitizeText(getStringProperty(error, "stdout"), sensitiveValues);
  const stderr = sanitizeText(getStringProperty(error, "stderr"), sensitiveValues);
  const message = sanitizeText(
    error instanceof Error
      ? [error.message, stdout, stderr].filter(Boolean).join("\n")
      : String(error),
    sensitiveValues,
  );
  return new AgentBrowserCommandError({
    message,
    stdout,
    stderr,
    exitCode: getNumberProperty(error, "code"),
  });
}

function sanitizeText(text: string, sensitiveValues: string[]): string {
  return sensitiveValues.reduce((message, secret) => message.split(secret).join("[redacted]"), text);
}

function formatUnknownError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getStringProperty(error: unknown, key: "stdout" | "stderr"): string {
  const value = (error as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

function getNumberProperty(error: unknown, key: "code"): number | null {
  const value = (error as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" ? value : null;
}

function shortHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
