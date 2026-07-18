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
      if (options.task === "quiz_solver") {
        const topics = Array.from({ length: 11 }, (_, topicIndex) => ({
          id: `topic-${topicIndex + 1}`,
          title: `Thema ${topicIndex + 1}`,
          learningGoals: ["Konkrete Aufgaben lösen"],
          theory: { summary: "Eine ausreichend ausführliche und fachlich konkrete Zusammenfassung für den automatisierten Testlauf, die das Thema verständlich erklärt und den Lösungsweg einordnet.", keyIdeas: ["Idee A", "Idee B"], formulas: [] },
          workedExamples: [{ title: "Beispiel", prompt: "Bestimme den konkreten Wert für x = 1.", steps: ["Setze x ein.", "Vereinfache den Ausdruck."], answer: "1", source: { label: "Testquelle", sourceTask: `Aufgabe ${topicIndex + 1}`, provenance: "source" } }],
          exercises: Array.from({ length: 6 }, (_, exerciseIndex) => exerciseIndex < 4 ? ({ id: `x-${topicIndex}-${exerciseIndex}`, type: "cross", prompt: `Welche konkrete Aussage ${topicIndex + 1}.${exerciseIndex + 1} ist richtig?`, selectionMode: "single", options: [{ text: "Richtig", correct: true, feedback: "Das folgt aus der Definition." }, { text: "Falsch A", correct: false, feedback: "Hier wurde die Bedingung vertauscht." }, { text: "Falsch B", correct: false, feedback: "Dieser Schluss ist nicht zulässig." }], explanation: "Die richtige Option folgt direkt aus der angegebenen Definition.", source: { label: "Testquelle", sourceTask: `Aufgabe ${topicIndex + 1}.${exerciseIndex + 1}`, provenance: "source" } }) : ({ id: `c-${topicIndex}-${exerciseIndex}`, type: "calculation", prompt: `Berechne den vollständig angegebenen Wert ${topicIndex + 1}.${exerciseIndex + 1} für x = 1.`, givens: ["x = 1"], acceptedAnswers: ["1"], unit: "", steps: ["Setze x = 1 ein.", "Vereinfache zu 1."], commonMistake: "Die gegebene Zahl wird nicht eingesetzt.", source: { label: "Testquelle", sourceTask: `Aufgabe ${topicIndex + 1}.${exerciseIndex + 1}`, provenance: "source" } })),
          retrieval: [{ prompt: "Was ist die Kernidee?", answer: "Die Definition korrekt anwenden." }],
        }));
        return JSON.stringify({ courseTitle: "Testkurs", scopeNote: "Testabdeckung", topics, sources: [{ id: "test", label: "Testquelle", url: "", coverage: "Test" }] });
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
