import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { ModelReasoningEffort, Usage, UserInput } from "@openai/codex-sdk";
import { minimalValidStudyBuddyHtml } from "./htmlShell.js";
import type { WebLayoutRuntimeConfig } from "./types.js";
import {
  resolveTaskModelPolicy,
  type StudyBuddyModelTask,
} from "../shared/modelPolicy.js";
import {
  resolveCodexTaskAccessPolicy,
  resolveModelPromptCharacterBudget,
  summarizeCodexToolUsage,
  type CodexToolUsage,
} from "../moodle/codexClient.js";
import {
  buildCodexChildEnvironment,
  buildCodexShellEnvironmentConfig,
} from "../shared/childProcessSecurity.js";

const LEAF_WORKER_BOUNDARY = [
  "Internal Study Buddy leaf-worker boundary:",
  "- Transform only the supplied evidence into the requested structured output.",
  "- Do not use skills, shell commands, files, web search, MCP tools, apps, or external research.",
  "- Preserve evidence gaps instead of gathering new context.",
].join("\n");

export interface CodexClient {
  run(
    prompt: string,
    options: {
      task: StudyBuddyModelTask;
      attempt?: number;
      outputSchema?: unknown;
      timeoutMs?: number;
      localImages?: string[];
    },
  ): Promise<string>;
}

export function createCodexClient(config: WebLayoutRuntimeConfig): CodexClient {
  if (process.env.WEB_LAYOUT_TEST_CODEX === "1") {
    return createTestCodexClient(config);
  }
  const codexEnvironment = buildCodexChildEnvironment();
  const codex = new Codex({
    env: codexEnvironment,
    config: buildCodexShellEnvironmentConfig(codexEnvironment),
  });
  const leafWorkspaceRoot = path.join(os.tmpdir(), "study-buddy-web-leaf-workers");

  return {
    async run(prompt, options) {
      const task = options.task;
      const attempt = Math.max(1, options.attempt ?? 1);
      const policy = resolveTaskModelPolicy({
        profile: config.executionProfile,
        task,
        attempt,
        globalModel: config.codexModel,
        globalReasoningEffort: config.codexReasoningEffort,
        overrides: config.modelPolicyOverrides,
      });
      const accessPolicy = resolveCodexTaskAccessPolicy(task);
      const sanitizedPrompt = accessPolicy.leafWorker
        ? `${LEAF_WORKER_BOUNDARY}\n\n${prompt}`
        : prompt;
      const requestCharacters = sanitizedPrompt.length;
      const schemaCharacters = options.outputSchema
        ? JSON.stringify(options.outputSchema).length
        : 0;
      const localImages = [...new Set(options.localImages ?? [])]
        .map((imagePath) => path.resolve(imagePath))
        .filter((imagePath) => existsSync(imagePath))
        .slice(0, 4);
      const promptBudget = resolveModelPromptCharacterBudget(task);
      if (requestCharacters + schemaCharacters > promptBudget) {
        throw new Error(
          `${task} request has ${requestCharacters + schemaCharacters} prompt/schema characters and exceeds its ${promptBudget}-character budget.`,
        );
      }
      const workingDirectory = accessPolicy.isolatedWorkingDirectory
        ? path.join(leafWorkspaceRoot, task)
        : config.runDir;
      await mkdir(workingDirectory, { recursive: true });
      const thread = codex.startThread({
        workingDirectory,
        skipGitRepoCheck: true,
        model: policy.model,
        modelReasoningEffort: policy.reasoningEffort as ModelReasoningEffort,
        sandboxMode: accessPolicy.sandboxMode,
        approvalPolicy: accessPolicy.approvalPolicy,
        networkAccessEnabled: accessPolicy.networkAccessEnabled,
        webSearchMode: accessPolicy.webSearchMode,
      });
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const callId = `${task}-${attempt}-${startedMs}`;
      const timeoutController = new AbortController();
      const timeoutMs = options.timeoutMs ?? policy.timeoutMs;
      const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = combineSignals(config.abortSignal, timeoutController.signal);
      await config.diagnostics?.log("info", "planner", `Starting ${task} model call.`, {
        task,
        attempt,
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        requestCharacters,
        schemaCharacters,
        leafWorker: accessPolicy.leafWorker,
      });
      let observedToolUsage = emptyToolUsage();
      let observedUsage: Usage | null = null;
      try {
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
          ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
          signal,
        });
        observedToolUsage = summarizeCodexToolUsage(turn.items);
        observedUsage = turn.usage;
        if (accessPolicy.leafWorker && observedToolUsage.toolCalls > 0) {
          throw new Error(`${task} leaf worker used ${observedToolUsage.toolCalls} prohibited tool(s).`);
        }
        await recordCall({
          config,
          callId,
          task,
          attempt,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          startedAt,
          startedMs,
          requestCharacters,
          schemaCharacters,
          leafWorker: accessPolicy.leafWorker,
          toolUsage: observedToolUsage,
          status: "completed",
          usage: observedUsage,
        });
        return turn.finalResponse;
      } catch (error) {
        const timedOut = timeoutController.signal.aborted && !config.abortSignal?.aborted;
        await recordCall({
          config,
          callId,
          task,
          attempt,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          startedAt,
          startedMs,
          requestCharacters,
          schemaCharacters,
          leafWorker: accessPolicy.leafWorker,
          toolUsage: observedToolUsage,
          status: timedOut ? "timeout" : config.abortSignal?.aborted ? "canceled" : "failed",
          usage: observedUsage,
        });
        if (timedOut) {
          throw new Error(`${task} model call timed out after ${timeoutMs}ms.`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createTestCodexClient(config: WebLayoutRuntimeConfig): CodexClient {
  return {
    async run(prompt, options) {
      if (prompt.includes("ASSESSMENT_VISUAL_CROP_PLANNER")) {
        const ids = [...prompt.matchAll(/"legacyExerciseId"\s*:\s*"([^"]+)"/g)]
          .map((match) => match[1]);
        return JSON.stringify({
          items: [...new Set(ids)].map((legacyExerciseId) => ({
            legacyExerciseId,
            crop: { x: 100, y: 100, width: 500, height: 400 },
            alt: "Technische Zeichnung mit Bemaßung",
            reason: "Die Zeichnung enthält lösungsrelevante Geometrie.",
          })),
        });
      }
      if (prompt.includes("ASSESSMENT_SOLUTION_REVIEWER")) {
        const ids = [...prompt.matchAll(/"legacyExerciseId"\s*:\s*"([^"]+)"/g)]
          .map((match) => match[1]);
        return JSON.stringify({
          items: [...new Set(ids)].map((legacyExerciseId) => ({
            legacyExerciseId,
            approved: true,
            findings: [],
          })),
        });
      }
      if (prompt.includes("ASSESSMENT_SOLUTION_AUTHOR")) {
        const ids = [...prompt.matchAll(/"legacyExerciseId"\s*:\s*"([^"]+)"/g)]
          .map((match) => match[1]);
        return JSON.stringify({
          items: [...new Set(ids)].map((legacyExerciseId) => ({
            legacyExerciseId,
            completeness: "complete",
            summary: "Vollständige Test-Musterlösung mit nachvollziehbarem Ergebnis.",
            steps: [
              "Ausgangsbeziehung angeben und nach der gesuchten Größe umformen.",
              "Gegebene Werte mit Einheiten einsetzen und das Ergebnis prüfen.",
            ],
            finalAnswer: "Das vollständig geprüfte Testergebnis lautet 1.",
            assumptions: [],
            evidenceBasis: ["Validierte Testaufgabe"],
            missingEvidence: [],
          })),
        });
      }
      if (options.task === "quality_reviewer") {
        return JSON.stringify({ ok: true, summary: "Test review passed.", findings: [] });
      }
      if (options.task === "content_analyzer") {
        const topicIndex = Number(prompt.match(/Chapter\s+(\d+)\//i)?.[1] ?? 1) - 1;
        const exerciseTarget = Number(prompt.match(/exactly\s+(\d+)\s+substantive exercises/i)?.[1] ?? 3);
        const calculations = Number(prompt.match(/,\s*(\d+)\s+genuine calculation/i)?.[1] ?? 0);
        const applications = Number(prompt.match(/,\s*(?:and\s+)?(\d+)\s+open application/i)?.[1] ?? 0);
        const topics = [{
          id: `topic-${topicIndex + 1}`,
          title: `Thema ${topicIndex + 1}`,
          learningGoals: ["Konkrete Aufgaben lösen"],
          theory: { summary: "Eine ausreichend ausführliche und fachlich konkrete Zusammenfassung für den automatisierten Testlauf, die das Thema verständlich erklärt und den Lösungsweg einordnet.", keyIdeas: ["Idee A", "Idee B"], formulas: [] },
          workedExamples: [{ title: "Beispiel", prompt: "Bestimme den konkreten Wert für x = 1.", steps: ["Setze x ein.", "Vereinfache den Ausdruck."], answer: "1", source: { label: "Testquelle", sourceTask: `Aufgabe ${topicIndex + 1}`, provenance: "source" } }],
          exercises: Array.from({ length: exerciseTarget }, (_, exerciseIndex) =>
            exerciseIndex < calculations
              ? ({ id: `c-${topicIndex}-${exerciseIndex}`, type: "calculation", prompt: `Berechne den vollständig angegebenen Wert ${topicIndex + 1}.${exerciseIndex + 1} für x = 1.`, givens: ["x = 1"], acceptedAnswers: ["1"], unit: "", steps: ["Setze x = 1 ein.", "Vereinfache zu 1."], commonMistake: "Die gegebene Zahl wird nicht eingesetzt.", source: { label: "Testquelle", sourceTask: `Aufgabe ${topicIndex + 1}.${exerciseIndex + 1}`, provenance: "source" } })
              : exerciseIndex < calculations + applications
                ? ({ id: `a-${topicIndex}-${exerciseIndex}`, type: "application", prompt: `Wende das konkrete Konzept ${topicIndex + 1}.${exerciseIndex + 1} auf einen Fall an.`, instructions: ["Analysiere die Evidenz.", "Begründe eine Entscheidung."], sampleAnswer: "Eine begründete Beispielantwort mit Bezug auf die Evidenz.", selfCheck: ["Die Evidenz wird genannt.", "Die Schlussfolgerung wird begründet."], source: { label: "Testquelle", sourceTask: `Abgeleitet aus Quelle Testquelle: Kapitel ${topicIndex + 1}`, provenance: "derived" } })
                : ({ id: `x-${topicIndex}-${exerciseIndex}`, type: "cross", prompt: `Welche konkrete Aussage ${topicIndex + 1}.${exerciseIndex + 1} ist richtig?`, selectionMode: "single", options: [{ text: "Richtig", correct: true, feedback: "Das folgt aus der Definition." }, { text: "Falsch A", correct: false, feedback: "Hier wurde die Bedingung vertauscht." }, { text: "Falsch B", correct: false, feedback: "Dieser Schluss ist nicht zulässig." }], explanation: "Die richtige Option folgt direkt aus der angegebenen Definition.", source: { label: "Testquelle", sourceTask: `Aufgabe ${topicIndex + 1}.${exerciseIndex + 1}`, provenance: "source" } })
          ),
          retrieval: [{ prompt: "Was ist die Kernidee?", answer: "Die Definition korrekt anwenden." }],
        }];
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

async function recordCall(input: {
  config: WebLayoutRuntimeConfig;
  callId: string;
  task: StudyBuddyModelTask;
  attempt: number;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
  startedAt: string;
  startedMs: number;
  requestCharacters: number;
  schemaCharacters: number;
  leafWorker: boolean;
  toolUsage: CodexToolUsage;
  status: "completed" | "failed" | "timeout" | "canceled";
  usage: Usage | null;
}): Promise<void> {
  const usage = input.usage ?? {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  const estimatedPromptTokens = Math.max(
    1,
    Math.ceil((input.requestCharacters + input.schemaCharacters) / 4),
  );
  const freshInputTokens = Math.max(0, usage.input_tokens - usage.cached_input_tokens);
  await input.config.executionTelemetry?.recordModelCall({
    id: input.callId,
    task: input.task,
    attempt: input.attempt,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - input.startedMs),
    requestCharacters: input.requestCharacters,
    schemaCharacters: input.schemaCharacters,
    leafWorker: input.leafWorker,
    estimatedPromptTokens,
    freshInputTokens,
    cacheHitRate: usage.input_tokens > 0 ? usage.cached_input_tokens / usage.input_tokens : 0,
    inputAmplification: usage.input_tokens > 0 ? usage.input_tokens / estimatedPromptTokens : 0,
    ...input.toolUsage,
    status: input.status,
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  });
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

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0];
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
