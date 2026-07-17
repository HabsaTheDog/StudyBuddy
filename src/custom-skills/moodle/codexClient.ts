import { Codex, type ModelReasoningEffort, type Usage } from "@openai/codex-sdk";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  resolveTaskModelPolicy,
  type StudyBuddyModelTask,
} from "./modelPolicy.js";
import { invalidateCodexRuntimeCache } from "./codexRuntime.js";

export interface CodexClient {
  run(prompt: string, options?: {
    outputSchema?: unknown;
    task?: StudyBuddyModelTask;
    attempt?: number;
  }): Promise<string>;
}

export type CodexErrorCategory =
  | "authentication"
  | "invalid_request"
  | "model_incompatible"
  | "model_unavailable"
  | "network"
  | "rate_limit"
  | "unknown";

export interface CodexErrorClassification {
  category: CodexErrorCategory;
  retryable: boolean;
}

/** A deterministic SDK/API rejection that another analyzer attempt cannot repair. */
export class NonRetryableCodexError extends Error {
  readonly category: CodexErrorCategory;

  constructor(message: string, category: CodexErrorCategory, options?: ErrorOptions) {
    super(message, options);
    this.name = "NonRetryableCodexError";
    this.category = category;
  }
}

export function createCodexClient(config: MoodleRuntimeConfig): CodexClient {
  const codex = new Codex(
    config.codexPath ? { codexPathOverride: config.codexPath } : undefined,
  );

  return {
    async run(prompt, options) {
      const task = options?.task ?? "analyzer";
      const attempt = Math.max(1, options?.attempt ?? 1);
      const policy = resolveTaskModelPolicy({
        profile: config.executionProfile,
        task,
        attempt,
        globalModel: config.codexModel,
        globalReasoningEffort: config.codexReasoningEffort,
        overrides: config.modelPolicyOverrides,
      });
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const callId = `${task}-${attempt}-${startedMs}`;
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), policy.timeoutMs);
      const signal = combineSignals(config.abortSignal, timeoutController.signal);
      const thread = codex.startThread({
        workingDirectory: config.runDir,
        skipGitRepoCheck: true,
        model: policy.model,
        modelReasoningEffort: policy.reasoningEffort as ModelReasoningEffort,
      });
      await config.diagnostics?.log("info", "model", `Starting ${task} model call.`, {
        callId,
        task,
        attempt,
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        timeoutMs: policy.timeoutMs,
      });
      try {
        const turn = await thread.run(prompt, {
          outputSchema: options?.outputSchema,
          signal,
        });
        await recordCall({
          config,
          callId,
          task,
          attempt,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          startedAt,
          startedMs,
          status: "completed",
          usage: turn.usage,
        });
        return turn.finalResponse;
      } catch (error) {
        const timeoutReached = timeoutController.signal.aborted && !config.abortSignal?.aborted;
        const status = timeoutReached ? "timeout" : config.abortSignal?.aborted ? "canceled" : "failed";
        const classification = status === "failed" ? classifyCodexError(error) : null;
        await recordCall({
          config,
          callId,
          task,
          attempt,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          startedAt,
          startedMs,
          status,
          usage: null,
          errorCategory: classification?.category ?? status,
        });
        if (timeoutReached) {
          throw new Error(`${task} model call timed out after ${policy.timeoutMs}ms.`);
        }
        if (classification && !classification.retryable) {
          if (
            classification.category === "model_incompatible" ||
            classification.category === "model_unavailable" ||
            classification.category === "authentication"
          ) {
            await invalidateCodexRuntimeCache(config.runtimeCacheDir).catch(() => undefined);
          }
          if (error instanceof NonRetryableCodexError) throw error;
          throw new NonRetryableCodexError(
            error instanceof Error ? error.message : String(error),
            classification.category,
            { cause: error },
          );
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function recordCall(input: {
  config: MoodleRuntimeConfig;
  callId: string;
  task: StudyBuddyModelTask;
  attempt: number;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  startedAt: string;
  startedMs: number;
  status: "completed" | "failed" | "timeout" | "canceled";
  usage: Usage | null;
  errorCategory?: string;
}): Promise<void> {
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - input.startedMs);
  const usage = input.usage ?? {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  await input.config.executionTelemetry?.recordModelCall({
    id: input.callId,
    task: input.task,
    attempt: input.attempt,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    startedAt: input.startedAt,
    completedAt,
    durationMs,
    status: input.status,
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
    ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
  });
  await input.config.diagnostics?.log(
    input.status === "completed" ? "info" : "warn",
    "model",
    `${input.task} model call ${input.status}.`,
    {
      callId: input.callId,
      task: input.task,
      attempt: input.attempt,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      durationMs,
      status: input.status,
      tokensIn: usage.input_tokens,
      tokensCached: usage.cached_input_tokens,
      tokensOut: usage.output_tokens,
      tokensReasoning: usage.reasoning_output_tokens,
      ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
    },
  );
}

function combineSignals(primary: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  return primary ? AbortSignal.any([primary, timeout]) : timeout;
}

export function classifyCodexError(error: unknown): CodexErrorClassification {
  if (error instanceof NonRetryableCodexError) {
    return { category: error.category, retryable: false };
  }

  const details = errorDetails(error);
  if (
    details.includes("requires a newer version of codex") ||
    details.includes("requires newer codex") ||
    details.includes("codex version is too old") ||
    (details.includes("codex") &&
      details.includes("version") &&
      (details.includes("update") || details.includes("upgrade")))
  ) {
    return { category: "model_incompatible", retryable: false };
  }
  if (
    (details.includes("model") &&
      (details.includes("not found") ||
        details.includes("not_found") ||
        details.includes("unsupported") ||
        details.includes("does not exist") ||
        details.includes("unavailable"))) ||
    details.includes("model_not_found") ||
    details.includes("unsupported_model")
  ) {
    return { category: "model_unavailable", retryable: false };
  }
  if (
    details.includes("authentication") ||
    details.includes("authentication_error") ||
    details.includes("unauthorized") ||
    details.includes("auth failed") ||
    details.includes("not logged in") ||
    details.includes("login required") ||
    details.includes("forbidden") ||
    details.includes("invalid api key") ||
    details.includes("incorrect api key") ||
    details.includes("missing api key") ||
    hasHttpStatus(error, 401) ||
    hasHttpStatus(error, 403)
  ) {
    return { category: "authentication", retryable: false };
  }
  if (
    details.includes("invalid_request_error") ||
    details.includes("invalid request") ||
    hasHttpStatus(error, 400) ||
    hasHttpStatus(error, 404)
  ) {
    return { category: "invalid_request", retryable: false };
  }
  if (details.includes("rate limit") || details.includes("rate_limit") || hasHttpStatus(error, 429)) {
    return { category: "rate_limit", retryable: true };
  }
  if (
    details.includes("network") ||
    details.includes("connect") ||
    details.includes("econnreset") ||
    details.includes("etimedout")
  ) {
    return { category: "network", retryable: true };
  }
  return { category: "unknown", retryable: true };
}

export function isNonRetryableCodexError(error: unknown): boolean {
  return !classifyCodexError(error).retryable;
}

function errorDetails(error: unknown): string {
  const values: unknown[] = [error];
  const details: string[] = [];
  const seen = new Set<unknown>();
  while (values.length > 0 && seen.size < 8) {
    const value = values.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "string" || typeof value === "number") {
      details.push(String(value));
      continue;
    }
    if (typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    for (const key of ["name", "message", "code", "type", "status", "statusCode"]) {
      const candidate = record[key];
      if (typeof candidate === "string" || typeof candidate === "number") {
        details.push(String(candidate));
      }
    }
    for (const key of ["cause", "error", "response", "data", "body"]) {
      if (record[key] !== undefined) values.push(record[key]);
    }
  }
  return details.join(" ").toLowerCase();
}

function hasHttpStatus(error: unknown, expected: number): boolean {
  const values: unknown[] = [error];
  const seen = new Set<unknown>();
  while (values.length > 0 && seen.size < 8) {
    const value = values.shift();
    if (value === null || value === undefined || seen.has(value) || typeof value !== "object") continue;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (record.status === expected || record.statusCode === expected) return true;
    for (const key of ["cause", "error", "response", "data", "body"]) {
      if (record[key] !== undefined) values.push(record[key]);
    }
  }
  return false;
}
