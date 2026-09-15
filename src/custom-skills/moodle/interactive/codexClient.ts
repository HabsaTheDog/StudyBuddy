import os from "node:os";
import { mkdir } from "node:fs/promises";
import { acquireModelCallControl } from "../../shared/modelCallControl.js";
import { summarizeCodexToolUsage, classifyCodexError, shouldTryModelFallback, NonRetryableCodexError, resolveModelPromptCharacterBudget } from "../codexClient.js";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveTaskModelPolicy, taskModelPolicySource, type StudyBuddyModelOperation } from "../modelPolicy.js";
import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  buildCodexChildEnvironment,
  buildCodexShellEnvironmentConfig,
} from "../../shared/childProcessSecurity.js";

export type CodexTask = "quiz_solver" | "source_search";

export interface CodexClient {
  run(
    prompt: string,
    options?: { outputSchema?: unknown; task?: CodexTask; operation?: StudyBuddyModelOperation; attempt?: number; timeoutMs?: number; imagePaths?: string[] },
  ): Promise<string>;
}

/** The model subprocess receives operational values only, never Study Buddy secrets. */
export function buildCodexProcessEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return buildCodexChildEnvironment(source);
}

export function buildNestedCodexConfig(environment: Record<string, string>) {
  return {
    ...buildCodexShellEnvironmentConfig(environment),
    web_search: "disabled",
  };
}

export function createCodexClient(config: MoodleRuntimeConfig): CodexClient {
  const environment = buildCodexProcessEnvironment();
  const codex = new Codex({
    env: environment,
    config: buildNestedCodexConfig(environment),
  });
  return {
    async run(prompt, options) {
      const task = options?.task ?? "quiz_solver";
      const attempt = Math.max(1, options?.attempt ?? 1);
      const selectionAttempts = [attempt, attempt > 1 ? 1 : 2];
      const candidates = selectionAttempts.map(selectionAttempt => ({
        ...resolveCodexModelSelection(config, task, selectionAttempt, options?.operation), selectionAttempt,
      })).filter((candidate, index, all) => all.findIndex(item => item.model === candidate.model) === index);
      const logicalCallId = randomUUID();
      for (const [candidateIndex, selection] of candidates.entries()) {
      const policyInput = { profile: config.executionProfile ?? "balanced", task, operation: options?.operation,
        attempt: selection.selectionAttempt, overrides: config.modelPolicyOverrides, globalModel: config.codexModel,
        globalReasoningEffort: config.codexReasoningEffort } as const;
      const timeoutMs = options?.timeoutMs ?? resolveTaskModelPolicy(policyInput).timeoutMs;
      const boundedPrompt = "Transform only the supplied question/evidence. Do not use tools, skills, shell, files, network or external research. Preserve evidence gaps.\n\n" + prompt;
      if (boundedPrompt.length + JSON.stringify(options?.outputSchema ?? {}).length > resolveModelPromptCharacterBudget(task)) {
        throw new NonRetryableCodexError(`${task} request exceeds its prompt/schema budget.`, "invalid_request");
      }
      const workingDirectory = path.join(os.tmpdir(), "study-buddy-leaf-workers", task);
      await mkdir(workingDirectory, { recursive: true });
      const control = await acquireModelCallControl({ task, model: selection.model ?? "provider-default", timeoutMs, signal: config.abortSignal });
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const metric = {
        id: randomUUID(), logicalCallId, transportAttempt: candidateIndex + 1, task, operation: options?.operation ?? task,
        attempt, model: selection.model ?? "provider-default",
        reasoningEffort: selection.reasoningEffort ?? "medium", startedAt,
        policySource: config.executionProfile || config.modelPolicyOverrides || task === "source_search"
          ? taskModelPolicySource(policyInput) : "legacy quiz configuration",
        queuedAt: control.queuedAt, queueWaitMs: control.queueWaitMs, timeoutMs,
      };
      let usageAvailable = false;
      let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
      let toolUsage = summarizeCodexToolUsage([]);
      let status = "failed";
      try {
        const thread = codex.startThread({
          workingDirectory, skipGitRepoCheck: true, approvalPolicy: "never", sandboxMode: "read-only",
          networkAccessEnabled: false, webSearchMode: "disabled",
          ...(selection.model ? { model: selection.model } : {}),
          ...(selection.reasoningEffort ? { modelReasoningEffort: selection.reasoningEffort } : {}),
        });
        const turn = await thread.run(options?.imagePaths?.length
          ? [{ type: "text", text: boundedPrompt }, ...options.imagePaths.map(imagePath => ({ type: "local_image" as const, path: imagePath }))]
          : boundedPrompt, { outputSchema: options?.outputSchema, signal: control.signal });
        usageAvailable = Boolean(turn.usage);
        usage = turn.usage ?? usage;
        toolUsage = summarizeCodexToolUsage(turn.items ?? []);
        control.signal.throwIfAborted();
        if (toolUsage.toolCalls > 0) throw new NonRetryableCodexError(`${task} leaf worker used ${toolUsage.toolCalls} prohibited tool(s).`, "invalid_request");
        status = "completed";
        return turn.finalResponse;
      } catch (error) {
        status = control.timedOut() ? "timeout" : config.abortSignal?.aborted ? "canceled" : "failed";
        if (control.timedOut()) throw new Error(`${task} model call timed out after ${timeoutMs}ms.`, { cause: error });
        const classification = classifyCodexError(error);
        if (!config.abortSignal?.aborted && candidates[candidateIndex + 1] && shouldTryModelFallback("failed", classification)) continue;
        if (!classification.retryable && !(error instanceof NonRetryableCodexError)) {
          throw new NonRetryableCodexError(error instanceof Error ? error.message : String(error), classification.category);
        }
        throw error;
      } finally {
        // Release capacity even when persisting the metric itself fails.
        await control.release();
        await appendFile(path.join(config.runDir, "run-model-calls.jsonl"), JSON.stringify({
          ...metric, status, usageAvailable, completedAt: new Date().toISOString(), durationMs: Date.now() - startedMs,
          inputTokens: usage.input_tokens, cachedInputTokens: usage.cached_input_tokens,
          freshInputTokens: Math.max(0, usage.input_tokens - usage.cached_input_tokens),
          outputTokens: usage.output_tokens, reasoningOutputTokens: usage.reasoning_output_tokens,
          leafWorker: true, ...toolUsage,
        }) + "\n", "utf8");
      }
      }
      throw new Error("Model candidates exhausted.");
    },
  };
}

export function resolveCodexModelSelection(
  config: Pick<MoodleRuntimeConfig, "codexModel" | "quizSolverModelPolicy" | "executionProfile" | "codexReasoningEffort" | "modelPolicyOverrides">,
  task?: CodexTask,
  attempt = 1,
  operation?: StudyBuddyModelOperation,
): { model?: string; reasoningEffort?: ModelReasoningEffort } {
  if (task && (config.executionProfile || config.modelPolicyOverrides || task === "source_search")) {
    const policy = resolveTaskModelPolicy({ profile: config.executionProfile ?? "balanced", task, operation, attempt, globalModel: config.codexModel, globalReasoningEffort: config.codexReasoningEffort, overrides: config.modelPolicyOverrides });
    return { model: policy.model, reasoningEffort: policy.reasoningEffort };
  }
  if (task === "quiz_solver" && config.quizSolverModelPolicy) {
    return attempt > 1
      ? {
          model: config.quizSolverModelPolicy.retryModel,
          reasoningEffort: config.quizSolverModelPolicy.retryReasoningEffort,
        }
      : {
          model: config.quizSolverModelPolicy.model,
          reasoningEffort: config.quizSolverModelPolicy.reasoningEffort,
        };
  }
  return config.codexModel ? { model: config.codexModel } : {};
}
