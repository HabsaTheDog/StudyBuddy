import { randomUUID } from "node:crypto";
import { acquireModelCallControl } from "../shared/modelCallControl.js";
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
  taskModelPolicySource,
  type StudyBuddyModelOperation,
  type StudyBuddyModelTask,
} from "../shared/modelPolicy.js";
import {
  classifyCodexError, shouldTryModelFallback, uniqueModelPolicies, NonRetryableCodexError,
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
      operation?: StudyBuddyModelOperation;
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
      const policyInput = {
        operation: options.operation,
        profile: config.executionProfile,
        task,
        attempt,
        globalModel: config.codexModel,
        globalReasoningEffort: config.codexReasoningEffort,
        overrides: config.modelPolicyOverrides,
      };
      const selectedPolicy = resolveTaskModelPolicy(policyInput);
      const primaryPolicy = resolveTaskModelPolicy({ ...policyInput, attempt: 1 });
      const alternateAttempt = selectedPolicy.model === primaryPolicy.model ? 2 : 1;
      const policies = uniqueModelPolicies([selectedPolicy, resolveTaskModelPolicy({ ...policyInput, attempt: alternateAttempt })]);
      const logicalCallId = randomUUID();
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
      for (const [candidateIndex, policy] of policies.entries()) {
      const policySource = taskModelPolicySource({ ...policyInput, attempt: candidateIndex === 0 ? attempt : alternateAttempt });
      const timeoutMs = options.timeoutMs ?? policy.timeoutMs;
      const control = await acquireModelCallControl({
        task, model: policy.model, timeoutMs, signal: config.abortSignal,
        pauseRuntimeBudget: config.executionTelemetry ? () => config.executionTelemetry!.pauseRuntimeBudget() : undefined,
      });
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const callId = `${task}-${attempt}-${randomUUID()}`;
      const signal = control.signal;
      let observedToolUsage = emptyToolUsage();
      let observedUsage: Usage | null = null;
      try {
        await config.diagnostics?.log("info", "planner", `Starting ${task} model call.`, {
          task,
          attempt,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          requestCharacters,
          schemaCharacters,
          leafWorker: accessPolicy.leafWorker,
        });
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
        signal.throwIfAborted();
        if (accessPolicy.leafWorker && observedToolUsage.toolCalls > 0) {
          throw new NonRetryableCodexError(`${task} leaf worker used ${observedToolUsage.toolCalls} prohibited tool(s).`, "invalid_request");
        }
        await recordCall({
          config,
          callId,
          logicalCallId, transportAttempt: candidateIndex + 1,
          task,
          attempt,
          operation: options.operation ?? task,
          policySource,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          startedAt,
          startedMs,
          queuedAt: control.queuedAt,
          queueWaitMs: control.queueWaitMs,
          requestCharacters,
          schemaCharacters,
          leafWorker: accessPolicy.leafWorker,
          toolUsage: observedToolUsage,
          status: "completed",
          usage: observedUsage,
        });
        return turn.finalResponse;
      } catch (error) {
        const timedOut = control.timedOut();
        await recordCall({
          config,
          callId,
          logicalCallId, transportAttempt: candidateIndex + 1,
          task,
          attempt,
          operation: options.operation ?? task,
          policySource,
          model: policy.model,
          reasoningEffort: policy.reasoningEffort,
          startedAt,
          startedMs,
          queuedAt: control.queuedAt,
          queueWaitMs: control.queueWaitMs,
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
        const classification = classifyCodexError(error);
        if (!config.abortSignal?.aborted && policies[candidateIndex + 1] && shouldTryModelFallback("failed", classification)) continue;
        if (!classification.retryable && !(error instanceof NonRetryableCodexError)) {
          throw new NonRetryableCodexError(error instanceof Error ? error.message : String(error), classification.category);
        }
        throw error;
      } finally {
        await control.release();
      }
      }
      throw new Error("Model candidates exhausted.");
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
  operation: string;
  policySource: string;
  config: WebLayoutRuntimeConfig;
  callId: string;
  logicalCallId: string;
  transportAttempt: number;
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
    logicalCallId: input.logicalCallId, transportAttempt: input.transportAttempt, usageAvailable: input.usage !== null,
    task: input.task,
    operation: input.operation,
    policySource: input.policySource,
    attempt: input.attempt,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - input.startedMs),
    queuedAt: input.queuedAt,
    queueWaitMs: input.queueWaitMs,
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
