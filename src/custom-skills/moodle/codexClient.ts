import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Codex,
  type ModelReasoningEffort,
  type ThreadItem,
  type Usage,
  type UserInput,
} from "@openai/codex-sdk";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  resolveTaskModelPolicy,
  type StudyBuddyModelTask,
} from "./modelPolicy.js";
import { invalidateCodexRuntimeCache } from "./codexRuntime.js";
import { acquireModelCallAdmission } from "./modelCallScheduler.js";
import {
  buildCodexChildEnvironment,
  buildCodexShellEnvironmentConfig,
} from "../shared/childProcessSecurity.js";

export interface CodexClient {
  run(prompt: string, options?: {
    outputSchema?: unknown;
    task?: StudyBuddyModelTask;
    attempt?: number;
    /** Preselected evidence images attached to the initial turn without a tool round. */
    localImages?: string[];
  }): Promise<string>;
}

export interface CodexTaskAccessPolicy {
  leafWorker: boolean;
  sandboxMode: "read-only" | "workspace-write";
  approvalPolicy: "never" | "on-failure";
  networkAccessEnabled: boolean;
  webSearchMode: "disabled" | "cached";
  isolatedWorkingDirectory: boolean;
}

export interface CodexToolUsage {
  toolCalls: number;
  commandExecutions: number;
  fileChanges: number;
  mcpToolCalls: number;
  webSearches: number;
}

const LEAF_MODEL_TASKS = new Set<StudyBuddyModelTask>([
  "artifact_planner",
  "content_analyzer",
  "content_repair",
  "quality_reviewer",
]);
const MODEL_PROMPT_CHARACTER_BUDGETS: Record<StudyBuddyModelTask, number> = {
  artifact_planner: 60_000,
  content_analyzer: 60_000,
  content_repair: 60_000,
  quality_reviewer: 45_000,
  quiz_solver: 120_000,
  artifact_builder: 120_000,
  artifact_repair: 120_000,
};

const LEAF_WORKER_BOUNDARY = [
  "Internal Study Buddy leaf-worker boundary:",
  "- Complete this transformation directly from the supplied prompt, schema, and attached images.",
  "- Do not invoke skills, shell commands, filesystem search, web search, MCP tools, apps, or other external tools.",
  "- Do not open source paths or gather more context. If evidence is insufficient, preserve the gap in the requested JSON instead of researching.",
].join("\n");

export function resolveCodexTaskAccessPolicy(task: StudyBuddyModelTask): CodexTaskAccessPolicy {
  if (LEAF_MODEL_TASKS.has(task)) {
    return {
      leafWorker: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      isolatedWorkingDirectory: true,
    };
  }
  return {
    leafWorker: false,
    sandboxMode: "workspace-write",
    approvalPolicy: "on-failure",
    networkAccessEnabled: false,
    webSearchMode: "cached",
    isolatedWorkingDirectory: false,
  };
}

export function resolveModelPromptCharacterBudget(task: StudyBuddyModelTask): number {
  return MODEL_PROMPT_CHARACTER_BUDGETS[task];
}

/**
 * Return the characters available to the caller-provided prompt after the
 * Codex client has added its fixed leaf-worker boundary and output schema.
 * Producers use this to compact evidence before calling `run`, instead of
 * discovering the hard request limit only after assembling an oversized
 * payload.
 */
export function resolveModelPromptBodyCharacterBudget(
  task: StudyBuddyModelTask,
  outputSchema?: unknown,
): number {
  const accessPolicy = resolveCodexTaskAccessPolicy(task);
  const boundaryCharacters = accessPolicy.leafWorker
    ? sanitizeUnicode(`${LEAF_WORKER_BOUNDARY}\n\n`).length
    : 0;
  const schemaCharacters = outputSchema ? JSON.stringify(outputSchema).length : 0;
  return Math.max(
    0,
    resolveModelPromptCharacterBudget(task) - boundaryCharacters - schemaCharacters,
  );
}

export function summarizeCodexToolUsage(items: ThreadItem[]): CodexToolUsage {
  const usage: CodexToolUsage = {
    toolCalls: 0,
    commandExecutions: 0,
    fileChanges: 0,
    mcpToolCalls: 0,
    webSearches: 0,
  };
  for (const item of items) {
    if (item.type === "command_execution") usage.commandExecutions += 1;
    if (item.type === "file_change") usage.fileChanges += 1;
    if (item.type === "mcp_tool_call") usage.mcpToolCalls += 1;
    if (item.type === "web_search") usage.webSearches += 1;
  }
  usage.toolCalls =
    usage.commandExecutions + usage.fileChanges + usage.mcpToolCalls + usage.webSearches;
  return usage;
}

export type CodexErrorCategory =
  | "authentication"
  | "invalid_request"
  | "model_incompatible"
  | "model_capacity"
  | "model_unavailable"
  | "network"
  | "rate_limit"
  | "usage_limit"
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
  const codexOptions = config.codexPath ? { codexPathOverride: config.codexPath } : {};
  const codexEnvironment = buildCodexChildEnvironment();
  const shellEnvironmentConfig = buildCodexShellEnvironmentConfig(codexEnvironment);
  const codex = new Codex({
    ...codexOptions,
    env: codexEnvironment,
    config: shellEnvironmentConfig,
  });
  const studyBuddySkillPath = path.join(
    os.homedir(),
    ".agents",
    "skills",
    "study-buddy",
    "SKILL.md",
  );
  const leafCodex = new Codex({
    ...codexOptions,
    env: codexEnvironment,
    config: {
      ...shellEnvironmentConfig,
      ...(existsSync(studyBuddySkillPath)
        ? {
            skills: {
              config: [{
                path: studyBuddySkillPath,
                enabled: false,
              }],
            },
          }
        : {}),
    },
  });
  // Keep leaf-worker CWDs stable across runs. The former run-directory hash
  // changed an otherwise identical SDK context every time and reduced the
  // reusable prompt prefix. These directories are read-only worker shells and
  // contain no run data.
  const leafWorkspaceRoot = path.join(os.tmpdir(), "study-buddy-leaf-workers");
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
      const accessPolicy = resolveCodexTaskAccessPolicy(task);
      const sanitizedPrompt = sanitizeUnicode(
        accessPolicy.leafWorker ? `${LEAF_WORKER_BOUNDARY}\n\n${prompt}` : prompt,
      );
      const requestCharacters = sanitizedPrompt.length;
      const promptCharacterBudget = resolveModelPromptCharacterBudget(task);
      const leafWorkspace = path.join(leafWorkspaceRoot, task);
      const schemaCharacters = options?.outputSchema
        ? JSON.stringify(options.outputSchema).length
        : 0;
      const totalRequestCharacters = requestCharacters + schemaCharacters;
      const localImages = [...new Set(options?.localImages ?? [])]
        .map((imagePath) => path.resolve(imagePath))
        .filter((imagePath) => existsSync(imagePath))
        .slice(0, 2);
      if (accessPolicy.isolatedWorkingDirectory) {
        await mkdir(leafWorkspace, { recursive: true });
      }
      if (totalRequestCharacters > promptCharacterBudget) {
        await config.diagnostics?.log(
          "warn",
          "model",
          `${task} request exceeds its ${promptCharacterBudget}-character budget.`,
          {
            task,
            requestCharacters,
            schemaCharacters,
            totalRequestCharacters,
            promptCharacterBudget,
            overBudgetCharacters: totalRequestCharacters - promptCharacterBudget,
          },
        );
        throw new NonRetryableCodexError(
          `${task} request has ${totalRequestCharacters} prompt/schema characters and exceeds its hard ` +
          `${promptCharacterBudget}-character budget; compact the producer payload before retrying.`,
          "invalid_request",
        );
      }
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
          const thread = (accessPolicy.leafWorker ? leafCodex : codex).startThread({
            workingDirectory: accessPolicy.isolatedWorkingDirectory
              ? leafWorkspace
              : config.runDir,
            skipGitRepoCheck: true,
            model: policy.model,
            modelReasoningEffort: policy.reasoningEffort as ModelReasoningEffort,
            sandboxMode: accessPolicy.sandboxMode,
            approvalPolicy: accessPolicy.approvalPolicy,
            networkAccessEnabled: accessPolicy.networkAccessEnabled,
            webSearchMode: accessPolicy.webSearchMode,
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
            promptCharacterBudget,
            attachedImages: localImages.length,
            leafWorker: accessPolicy.leafWorker,
            sandboxMode: accessPolicy.sandboxMode,
            networkAccessEnabled: accessPolicy.networkAccessEnabled,
            webSearchMode: accessPolicy.webSearchMode,
          });
          const input: string | UserInput[] = localImages.length > 0
            ? [
                { type: "text", text: sanitizedPrompt },
                ...localImages.map((imagePath): UserInput => ({
                  type: "local_image",
                  path: imagePath,
                })),
              ]
            : sanitizedPrompt;
          const turn = await thread.run(input, {
            outputSchema: options?.outputSchema,
            signal,
          });
          const toolUsage = summarizeCodexToolUsage(turn.items);
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
            attachedImages: localImages.length,
            leafWorker: accessPolicy.leafWorker,
            toolUsage,
            status: "completed",
            usage: turn.usage,
          });
          if (accessPolicy.leafWorker && toolUsage.toolCalls > 0) {
            await config.diagnostics?.log(
              "warn",
              "model",
              `${task} leaf worker used ${toolUsage.toolCalls} prohibited tool(s); the result is retained but flagged for prompt-policy regression.`,
              { task, callId, ...toolUsage },
            );
          }
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
            attachedImages: localImages.length,
            leafWorker: accessPolicy.leafWorker,
            toolUsage: emptyToolUsage(),
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
              (task === "content_analyzer" || task === "content_repair" || task === "quality_reviewer")
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
  attachedImages: number;
  leafWorker: boolean;
  toolUsage: CodexToolUsage;
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
  const freshInputTokens = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  const estimatedPromptTokens = Math.max(
    1,
    Math.ceil((input.requestCharacters + input.schemaCharacters) / 4),
  );
  const cacheHitRate = usage.input_tokens > 0
    ? usage.cached_input_tokens / usage.input_tokens
    : 0;
  const inputAmplification = usage.input_tokens > 0
    ? usage.input_tokens / estimatedPromptTokens
    : 0;
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
    attachedImages: input.attachedImages,
    leafWorker: input.leafWorker,
    estimatedPromptTokens,
    freshInputTokens,
    cacheHitRate,
    inputAmplification,
    ...input.toolUsage,
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
      attachedImages: input.attachedImages,
      leafWorker: input.leafWorker,
      status: input.status,
      tokensIn: usage.input_tokens,
      tokensCached: usage.cached_input_tokens,
      tokensFresh: freshInputTokens,
      tokensOut: usage.output_tokens,
      tokensReasoning: usage.reasoning_output_tokens,
      estimatedPromptTokens,
      cacheHitRate,
      inputAmplification,
      ...input.toolUsage,
      ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
    },
  );
  if (input.leafWorker && input.status === "completed" && inputAmplification > 4) {
    await input.config.diagnostics?.log(
      "warn",
      "model",
      `${input.task} leaf worker exceeded the 4x input-amplification guardrail.`,
      {
        callId: input.callId,
        task: input.task,
        inputAmplification,
        inputTokens: usage.input_tokens,
        estimatedPromptTokens,
        toolCalls: input.toolUsage.toolCalls,
      },
    );
  }
}

function emptyToolUsage(): CodexToolUsage {
  return {
    toolCalls: 0,
    commandExecutions: 0,
    fileChanges: 0,
    mcpToolCalls: 0,
    webSearches: 0,
  };
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
  if (
    details.includes("usage limit") ||
    details.includes("purchase more credits") ||
    details.includes("insufficient_quota") ||
    details.includes("billing_hard_limit_reached")
  ) {
    return { category: "usage_limit", retryable: false };
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
