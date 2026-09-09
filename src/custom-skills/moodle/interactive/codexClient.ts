import { resolveTaskModelPolicy } from "../modelPolicy.js";
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
    options?: { outputSchema?: unknown; task?: CodexTask; attempt?: number; imagePaths?: string[] },
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
      const selection = resolveCodexModelSelection(config, options?.task, options?.attempt);
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
      const turn = await thread.run(options?.imagePaths?.length
        ? [{ type: "text", text: prompt }, ...options.imagePaths.map(imagePath => ({ type: "local_image" as const, path: imagePath }))]
        : prompt, { outputSchema: options?.outputSchema });
      return turn.finalResponse;
    },
  };
}

export function resolveCodexModelSelection(
  config: Pick<MoodleRuntimeConfig, "codexModel" | "quizSolverModelPolicy">,
  task?: CodexTask,
  attempt = 1,
): { model?: string; reasoningEffort?: ModelReasoningEffort } {
  if (task === "source_search") {
    const policy = resolveTaskModelPolicy({ profile: "balanced", task, attempt, globalModel: config.codexModel });
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
