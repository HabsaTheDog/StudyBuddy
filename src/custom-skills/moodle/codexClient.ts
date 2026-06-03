import { Codex } from "@openai/codex-sdk";
import type { MoodleRuntimeConfig } from "./types.js";

export interface CodexClient {
  run(prompt: string, options?: { outputSchema?: unknown }): Promise<string>;
}

export function createCodexClient(config: MoodleRuntimeConfig): CodexClient {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: process.cwd(),
    skipGitRepoCheck: true,
  });

  return {
    async run(prompt, options) {
      const turn = await thread.run(prompt, options);
      return turn.finalResponse;
    },
  };
}
