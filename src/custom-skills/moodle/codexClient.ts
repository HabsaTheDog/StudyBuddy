import { Codex, type ModelReasoningEffort, type Usage } from "@openai/codex-sdk";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  resolveTaskModelPolicy,
  type StudyBuddyModelTask,
} from "./modelPolicy.js";

export interface CodexClient {
  run(prompt: string, options?: {
    outputSchema?: unknown;
    task?: StudyBuddyModelTask;
    attempt?: number;
  }): Promise<string>;
}

export function createCodexClient(config: MoodleRuntimeConfig): CodexClient {
  const codex = new Codex();

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
          errorCategory: classifyError(error, status),
        });
        if (timeoutReached) {
          throw new Error(`${task} model call timed out after ${policy.timeoutMs}ms.`);
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

function classifyError(error: unknown, status: "failed" | "timeout" | "canceled" | "completed"): string {
  if (status !== "failed") return status;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("rate") && message.includes("limit")) return "rate_limit";
  if (message.includes("model") && (message.includes("not found") || message.includes("unsupported"))) {
    return "model_unavailable";
  }
  if (message.includes("auth") || message.includes("unauthorized")) return "authentication";
  if (message.includes("network") || message.includes("connect")) return "network";
  return "unknown";
}
