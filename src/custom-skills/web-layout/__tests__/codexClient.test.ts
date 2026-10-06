import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ run: vi.fn(), startThread: vi.fn() }));
vi.mock("../../shared/workflowModelRuntime.js", () => ({
  createWorkflowModelRuntime: () => ({ startThread: harness.startThread }),
  workflowModelBridgeEnvironment: () => null,
}));
import { createCodexClient } from "../codexClient.js";
import { createWebLayoutRuntimeConfig } from "../config.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function client(modelPolicyOverrides?: Parameters<typeof createWebLayoutRuntimeConfig>[0]["modelPolicyOverrides"]) {
  vi.stubEnv("WEB_LAYOUT_TEST_CODEX", "0");
  const runDir = await mkdtemp(path.join(os.tmpdir(), "web-client-regression-"));
  dirs.push(runDir);
  harness.startThread.mockReturnValue({ run: harness.run });
  return { runDir, client: createCodexClient(createWebLayoutRuntimeConfig({
    prompt: "Create a worksheet", kind: "worksheet", language: "en", runDir, modelPolicyOverrides,
  })) };
}
describe("web layout worker isolation", () => {
  it.each([["model is at capacity", 2], ["authentication failed", 1]] as const)("honors mixed-account fallbacks for %s", async (failure, calls) => {
    const { client: worker } = await client({ artifact_builder: {
      instanceId: "account-one", model: "shared-model", reasoningEffort: "medium",
      escalationInstanceId: "account-two", escalationModel: "shared-model", escalationEffort: "high",
    } });
    harness.run.mockRejectedValueOnce(new Error(failure)).mockResolvedValue({ finalResponse: "<html>verified</html>", items: [], usage: null });
    const result = worker.run("Exact evidence α", { task: "artifact_builder" });
    if (calls === 2) await expect(result).resolves.toBe("<html>verified</html>");
    else await expect(result).rejects.toThrow(failure);
    expect(harness.startThread).toHaveBeenCalledTimes(calls);
    expect(harness.startThread.mock.calls[0]![0]).toMatchObject({ studyBuddyInstanceId: "account-one", model: "shared-model" });
    if (calls === 2) expect(harness.startThread.mock.calls[1]![0]).toMatchObject({ studyBuddyInstanceId: "account-two", model: "shared-model", modelReasoningEffort: "high" });
  });
  it.each(["artifact_builder", "artifact_repair"] as const)("isolates %s from repository skills and tool execution", async (task) => {
    const { runDir, client: worker } = await client();
    harness.run.mockResolvedValue({ finalResponse: "<html>α</html>", items: [], usage: null });
    expect(await worker.run("Keep α = 42\nexactly", { task })).toBe("<html>α</html>");
    expect(harness.startThread).toHaveBeenCalledWith(expect.objectContaining({
      sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, webSearchMode: "disabled",
    }));
    expect(harness.startThread.mock.calls[0]![0].workingDirectory).not.toBe(runDir);
    expect(harness.run.mock.calls[0]![0]).toContain("Do not use skills, shell commands");
    expect(harness.run.mock.calls[0]![0]).toContain("Keep α = 42\nexactly");
  });
  it("rejects a builder that invokes a tool instead of accepting its output", async () => {
    const { client: worker } = await client();
    harness.run.mockResolvedValue({ finalResponse: "<html>ignored</html>", items: [
      { type: "command_execution", id: "tool", command: "read a skill", aggregated_output: "", exit_code: 0, status: "completed" },
    ], usage: null });
    await expect(worker.run("Build HTML", { task: "artifact_builder" })).rejects.toThrow("prohibited tool");
    expect(harness.run).toHaveBeenCalledTimes(1);
  });
});
