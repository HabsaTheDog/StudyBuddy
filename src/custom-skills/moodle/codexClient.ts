import { Codex, type ModelReasoningEffort, type Usage } from "@openai/codex-sdk";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  resolveTaskModelPolicy,
  type StudyBuddyModelTask,
} from "./modelPolicy.js";
import { invalidateCodexRuntimeCache } from "./codexRuntime.js";
import { acquireModelCallAdmission } from "./modelCallScheduler.js";

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
  | "model_capacity"
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

/** A model turn that never produced usage before its bounded timeout. */
export class ModelCallTimeoutError extends Error {
  readonly task: StudyBuddyModelTask;
  readonly model: string;
  readonly timeoutMs: number;
  readonly queueWaitMs: number;

  constructor(input: {
    task: StudyBuddyModelTask;
    model: string;
    timeoutMs: number;
    queueWaitMs: number;
  }) {
    super(`${input.task} model call timed out after ${input.timeoutMs}ms without token usage.`);
    this.name = "ModelCallTimeoutError";
    this.task = input.task;
    this.model = input.model;
    this.timeoutMs = input.timeoutMs;
    this.queueWaitMs = input.queueWaitMs;
  }
}

export function createCodexClient(config: MoodleRuntimeConfig): CodexClient {
  const codex = new Codex(
    config.codexPath ? { codexPathOverride: config.codexPath } : undefined,
  );
  let extractionCapacityFailure: ModelCallTimeoutError | null = null;

  return {
    async run(prompt, options) {
      // Optional planners may have a deterministic fallback and therefore
      // catch their own error. Once an extraction call has emitted no usage
      // for a full timeout, fail every later model stage immediately so the
      // analyzer/reviewer can establish one resumable checkpoint instead of
      // spending another 90 seconds probing the same unhealthy capacity.
      if (config.stage === "extract" && extractionCapacityFailure) {
        throw extractionCapacityFailure;
      }
      const task = options?.task ?? "content_analyzer";
      const attempt = Math.max(1, options?.attempt ?? 1);
      const sanitizedPrompt = sanitizeUnicode(prompt);
      const requestCharacters = sanitizedPrompt.length;
      const schemaCharacters = options?.outputSchema
        ? JSON.stringify(options.outputSchema).length
        : 0;
      const policyInput = {
        profile: config.executionProfile,
        task,
        attempt,
        globalModel: config.codexModel,
        globalReasoningEffort: config.codexReasoningEffort,
        overrides: config.modelPolicyOverrides,
      } as const;
      const selectedPolicy = resolveTaskModelPolicy(policyInput);
      const primaryPolicy = resolveTaskModelPolicy({ ...policyInput, attempt: 1 });
      const escalationPolicy = resolveTaskModelPolicy({ ...policyInput, attempt: 2 });
      const policies = uniqueModelPolicies([
        selectedPolicy,
        selectedPolicy.model === primaryPolicy.model ? escalationPolicy : primaryPolicy,
      ]);

      for (const [candidateIndex, policy] of policies.entries()) {
        const admission = await (async () => {
          const resumeRuntimeBudget = config.executionTelemetry?.pauseRuntimeBudget();
          try {
            return await acquireModelCallAdmission({
              task,
              model: policy.model,
              signal: config.abortSignal,
              onWait: async (position, activeSlots) => {
                await config.diagnostics?.log(
                  "info",
                  "model",
                  `${task} is queued for configured model admission.`,
                  { task, model: policy.model, queuePosition: position, activeSlots },
                );
              },
            });
          } finally {
            resumeRuntimeBudget?.();
          }
        })();
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        const callId = `${task}-${attempt}-${startedMs}`;
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), policy.timeoutMs);
        const signal = combineSignals(config.abortSignal, timeoutController.signal);
        try {
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
            queueWaitMs: admission.queueWaitMs,
            requestCharacters,
            schemaCharacters,
          });
          const turn = await thread.run(sanitizedPrompt, {
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
            queuedAt: admission.queuedAt,
            queueWaitMs: admission.queueWaitMs,
            requestCharacters,
            schemaCharacters,
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
            queuedAt: admission.queuedAt,
            queueWaitMs: admission.queueWaitMs,
            requestCharacters,
            schemaCharacters,
            status,
            usage: null,
            errorCategory: classification?.category ?? status,
          });
          const fallback = policies[candidateIndex + 1];
          if (
            fallback &&
            !config.abortSignal?.aborted &&
            shouldTryModelFallback(status, classification)
          ) {
            await config.diagnostics?.log(
              "warn",
              "model",
              `${task} model call could not complete; retrying the same stage with ${fallback.model}.`,
              {
                task,
                attempt,
                failedModel: policy.model,
                fallbackModel: fallback.model,
                reason: classification?.category ?? status,
              },
            );
            continue;
          }
          if (timeoutReached) {
            const timeoutError = new ModelCallTimeoutError({
              task,
              model: policy.model,
              timeoutMs: policy.timeoutMs,
              queueWaitMs: admission.queueWaitMs,
            });
            if (
              config.stage === "extract" &&
              (task === "content_analyzer" || task === "quality_reviewer")
            ) {
              extractionCapacityFailure = timeoutError;
            }
            throw timeoutError;
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
          await admission.release();
        }
      }

      throw new Error(`${task} model call failed without a usable model response.`);
    },
  };
}

function uniqueModelPolicies<T extends { model: string }>(policies: T[]): T[] {
  const seen = new Set<string>();
  return policies.filter((policy) => {
    if (seen.has(policy.model)) return false;
    seen.add(policy.model);
    return true;
  });
}

function shouldTryModelFallback(
  status: "completed" | "failed" | "timeout" | "canceled",
  classification: CodexErrorClassification | null,
): boolean {
  // A timeout is a bounded stage failure. LangGraph owns the retry and can
  // preserve successful chapter handoffs while escalating only the failed
  // chapter. An inline fallback would silently add both model timeouts and can
  // turn one slow chapter into a ten-minute call.
  if (status === "timeout") return false;
  return classification?.category === "model_capacity" ||
    classification?.category === "model_unavailable" ||
    classification?.category === "rate_limit";
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
  queuedAt: string;
  queueWaitMs: number;
  requestCharacters: number;
  schemaCharacters: number;
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
    queuedAt: input.queuedAt,
    queueWaitMs: input.queueWaitMs,
    requestCharacters: input.requestCharacters,
    schemaCharacters: input.schemaCharacters,
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
      queueWaitMs: input.queueWaitMs,
      requestCharacters: input.requestCharacters,
      schemaCharacters: input.schemaCharacters,
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

/** Replace lone UTF-16 surrogates produced by some PDF text extractors. */
export function sanitizeUnicode(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += "�";
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      output += "�";
    } else {
      output += value[index];
    }
  }
  return output;
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
    details.includes("selected model is at capacity") ||
    details.includes("model is at capacity") ||
    details.includes("model capacity") ||
    details.includes("model overloaded") ||
    details.includes("overloaded model")
  ) {
    return { category: "model_capacity", retryable: true };
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
