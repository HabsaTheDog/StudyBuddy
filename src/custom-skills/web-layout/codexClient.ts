import { Codex } from "@openai/codex-sdk";
import { minimalValidStudyBuddyHtml } from "./htmlShell.js";
import type { WebLayoutRuntimeConfig } from "./types.js";

export interface CodexClient {
  run(prompt: string, options?: { outputSchema?: unknown }): Promise<string>;
}

export function createCodexClient(config: WebLayoutRuntimeConfig): CodexClient {
  if (process.env.WEB_LAYOUT_TEST_CODEX === "1") {
    return createTestCodexClient(config);
  }
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: config.runDir,
    skipGitRepoCheck: true,
    ...(config.codexModel ? { model: config.codexModel } : {}),
  });

  return {
    async run(prompt, options) {
      const turn = await thread.run(prompt, {
        ...options,
        signal: config.abortSignal,
      });
      return turn.finalResponse;
    },
  };
}

function createTestCodexClient(config: WebLayoutRuntimeConfig): CodexClient {
  return {
    async run(prompt) {
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
