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
    options?: { outputSchema?: unknown; task?: CodexTask; operation?: StudyBuddyModelOperation; attempt?: number; imagePaths?: string[] },
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
      const selection = resolveCodexModelSelection(config, options?.task, options?.attempt, options?.operation);
      const thread = codex.startThread({
        workingDirectory: config.runDir,
        skipGitRepoCheck: true,
        approvalPolicy: "never",
        sandboxMode: "read-only",
        networkAccessEnabled: false,
        webSearchMode: "disabled",
        ...(selection.model ? { model: selection.model } : {}),
        ...(selection.reasoningEffort ? { modelReasoningEffort: selection.reasoningEffort } : {}),
      });
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const task = options?.task ?? "quiz_solver";
      const metric = {
        id: randomUUID(), task, operation: options?.operation ?? task,
        attempt: options?.attempt ?? 1, model: selection.model ?? "provider-default",
        reasoningEffort: selection.reasoningEffort ?? "medium", startedAt,
        policySource: config.executionProfile || config.modelPolicyOverrides || task === "source_search"
          ? taskModelPolicySource({ profile: config.executionProfile ?? "balanced", task, operation: options?.operation, overrides: config.modelPolicyOverrides, globalModel: config.codexModel, globalReasoningEffort: config.codexReasoningEffort })
          : "legacy quiz configuration",
      };
      let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
      let status = "failed";
      try {
        const turn = await thread.run(options?.imagePaths?.length
          ? [{ type: "text", text: prompt }, ...options.imagePaths.map(imagePath => ({ type: "local_image" as const, path: imagePath }))]
          : prompt, { outputSchema: options?.outputSchema });
        usage = turn.usage ?? usage;
        status = "completed";
        return turn.finalResponse;
      } finally {
        await appendFile(path.join(config.runDir, "run-model-calls.jsonl"), JSON.stringify({
          ...metric, status, completedAt: new Date().toISOString(), durationMs: Date.now() - startedMs,
          inputTokens: usage.input_tokens, cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
        }) + "\n", "utf8");
      }
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
    return { model: policy.model, reasoningEffort: policy.reasoningEffort === "minimal" ? "low" : policy.reasoningEffort };
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
