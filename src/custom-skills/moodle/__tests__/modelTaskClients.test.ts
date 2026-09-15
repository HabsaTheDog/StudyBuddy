import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ startThread: vi.fn(), run: vi.fn() }));
vi.mock("@openai/codex-sdk", () => ({ Codex: class { startThread = sdk.startThread; } }));
vi.mock("../modelCallScheduler.js", () => ({
  acquireModelCallAdmission: async () => ({ queuedAt: new Date().toISOString(), queueWaitMs: 0, release: async () => {} }),
}));
import { createCodexClient as createDocumentClient } from "../codexClient.js";
import { createCodexClient as createPageClient } from "../../web-layout/codexClient.js";
import { createCodexClient as createInteractiveClient } from "../interactive/codexClient.js";

const runDirs: string[] = [];
afterEach(async () => {
  await Promise.all(runDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("task model SDK boundary", () => {
  for (const lane of ["document", "page", "interactive"] as const) {
    it(`bounds and records a timed-out ${lane} SDK call`, async () => {
      const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-deadline-test-")); runDirs.push(runDir);
      const recordModelCall = vi.fn();
      sdk.startThread.mockReturnValue({ run: sdk.run });
      sdk.run.mockImplementation(async (_prompt, { signal }) => new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
      const operation = lane === "interactive" ? "quiz_verification" : "solution_generation";
      const task = lane === "interactive" ? "quiz_solver" : "content_analyzer";
      const config = { runDir, executionProfile: "balanced", stage: "render", executionTelemetry: { recordModelCall, pauseRuntimeBudget: () => () => {} }, modelPolicyOverrides: { [operation]: { model: "test-model", timeoutMs: 25 } } };
      const client = lane === "document" ? createDocumentClient(config as never) : lane === "page" ? createPageClient(config as never) : createInteractiveClient(config as never);
      const pending = client.run("Supplied evidence", { task: task as never, operation });
      const assertion = expect(pending).rejects.toThrow("timed out");
      await assertion;
      const calls = lane === "interactive" ? (await readFile(path.join(runDir, "run-model-calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) : recordModelCall.mock.calls.map(([entry]) => entry);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ status: "timeout", operation, attempt: 1 });
    });

    it(`rejects tool-using ${lane} leaf results while preserving observed usage`, async () => {
      const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-leaf-test-")); runDirs.push(runDir);
      const recordModelCall = vi.fn();
      sdk.startThread.mockReturnValue({ run: sdk.run });
      sdk.run.mockResolvedValue({ finalResponse: "{}", items: [{ type: "command_execution" }], usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 3 } });
      const config = { runDir, executionProfile: "balanced", stage: "render", executionTelemetry: { recordModelCall, pauseRuntimeBudget: () => () => {} } };
      const client = lane === "document" ? createDocumentClient(config as never) : lane === "page" ? createPageClient(config as never) : createInteractiveClient(config as never);
      const task = lane === "interactive" ? "quiz_solver" : "content_analyzer";
      const operation = lane === "interactive" ? "quiz_answer" : "solution_generation";
      await expect(client.run("Use supplied evidence", { task: task as never, operation })).rejects.toThrow("prohibited tool");
      const calls = lane === "interactive" ? (await readFile(path.join(runDir, "run-model-calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) : recordModelCall.mock.calls.map(([entry]) => entry);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ status: "failed", inputTokens: 100, toolCalls: 1, reasoningOutputTokens: 3 });
    });

    it(`passes the selected task and retry model to the ${lane} SDK and records task usage`, async () => {
      const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-model-task-test-"));
      runDirs.push(runDir);
      const recordModelCall = vi.fn();
      sdk.startThread.mockReturnValue({ run: sdk.run });
      sdk.run.mockResolvedValue({ finalResponse: "{}", items: [], usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 0 } });
      const operation = lane === "interactive" ? "quiz_verification" : "solution_generation";
      const task = lane === "interactive" ? "quiz_solver" : "content_analyzer";
      const config = {
        runDir, executionProfile: "custom", stage: "render",
        executionTelemetry: { recordModelCall, pauseRuntimeBudget: () => () => {} },
        modelPolicyOverrides: { [operation]: { model: "gpt-specialist", reasoningEffort: "low", escalationModel: "gpt-retry", escalationEffort: "high" } },
      };
      const client = lane === "document"
        ? createDocumentClient(config as unknown as Parameters<typeof createDocumentClient>[0])
        : lane === "page"
          ? createPageClient(config as unknown as Parameters<typeof createPageClient>[0])
          : createInteractiveClient(config as unknown as Parameters<typeof createInteractiveClient>[0]);
      for (const attempt of [1, 2]) {
        await (client as ReturnType<typeof createDocumentClient>).run("Use supplied evidence only.", { task, operation, attempt });
        expect(sdk.startThread).toHaveBeenLastCalledWith(expect.objectContaining({
          model: attempt === 1 ? "gpt-specialist" : "gpt-retry",
          modelReasoningEffort: attempt === 1 ? "low" : "high",
          sandboxMode: "read-only", networkAccessEnabled: false,
        }));
      }
      const calls = lane === "interactive"
        ? (await readFile(path.join(runDir, "run-model-calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
        : recordModelCall.mock.calls.map(([metric]) => metric);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({ operation, model: "gpt-retry", inputTokens: 100, attempt: 2, policySource: `task:${operation}` });
    });
  }
});
