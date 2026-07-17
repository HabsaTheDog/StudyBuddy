import { Codex } from "@openai/codex-sdk";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
import { minimalValidStudyBuddyHtml } from "./htmlShell.js";
import type { WebLayoutRuntimeConfig } from "./types.js";
import {
  resolveTaskModelPolicy,
  type StudyBuddyModelTask,
} from "../shared/modelPolicy.js";

export interface CodexClient {
  run(
    prompt: string,
    options: { task: StudyBuddyModelTask; attempt?: number; outputSchema?: unknown },
  ): Promise<string>;
}

export function createCodexClient(config: WebLayoutRuntimeConfig): CodexClient {
  if (process.env.WEB_LAYOUT_TEST_CODEX === "1") {
    return createTestCodexClient(config);
  }
  const codex = new Codex();

  return {
    async run(prompt, options) {
      const policy = resolveTaskModelPolicy({
        profile: config.executionProfile,
        task: options.task,
        attempt: options.attempt,
        globalModel: config.codexModel,
        globalReasoningEffort: config.codexReasoningEffort,
        overrides: config.modelPolicyOverrides,
      });
      const thread = codex.startThread({
        workingDirectory: config.runDir,
        skipGitRepoCheck: true,
        model: policy.model,
        modelReasoningEffort: policy.reasoningEffort as ModelReasoningEffort,
      });
      const turn = await thread.run(prompt, {
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
        signal: config.abortSignal,
      });
      return turn.finalResponse;
    },
  };
}

function createTestCodexClient(config: WebLayoutRuntimeConfig): CodexClient {
  return {
    async run(prompt, options) {
      if (options.task === "quality_reviewer") {
        return JSON.stringify({ ok: true, summary: "Test review passed.", findings: [] });
      }
      if (prompt.includes("JSON-only implementation plan")) {
        return JSON.stringify({
          title: "Test Web Layout",
          language: config.language,
          kind: config.kind,
          audience: "Studierende",
          learningGoals: ["Konzepte wiederholen"],
          sections: [
            {
              id: "main",
              title: "Lernwerkzeug",
              purpose: "Interaktiv lernen",
              interactionType: config.kind === "reference" ? "reference" : "flashcards",
            },
          ],
          requiredInteractions: ["offline", "responsive", "study-buddy-branding"],
          dataModel: { source: "test" },
          designDirection: "Restrained technical Study Buddy interface",
          accessibilityNotes: ["Buttons are keyboard reachable"],
        });
      }
      return minimalValidStudyBuddyHtml({
        title: "Test Web Layout",
        kind: config.kind,
        language: config.language,
      });
    },
  };
}
