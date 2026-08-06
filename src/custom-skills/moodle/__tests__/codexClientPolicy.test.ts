import type { ThreadItem } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import {
  resolveCodexTaskAccessPolicy,
  resolveModelPromptCharacterBudget,
  summarizeCodexToolUsage,
} from "../codexClient.js";

describe("Codex task access policy", () => {
  it.each([
    "artifact_planner",
    "content_analyzer",
    "content_repair",
    "quality_reviewer",
  ] as const)("isolates %s as a read-only, offline leaf worker", (task) => {
    expect(resolveCodexTaskAccessPolicy(task)).toEqual({
      leafWorker: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      isolatedWorkingDirectory: true,
    });
  });

  it("retains the wider workspace profile for the renderer", () => {
    expect(resolveCodexTaskAccessPolicy("artifact_builder")).toMatchObject({
      leafWorker: false,
      sandboxMode: "workspace-write",
      isolatedWorkingDirectory: false,
    });
  });

  it("gives the artifact repairer only the local workspace and no network", () => {
    expect(resolveCodexTaskAccessPolicy("artifact_repair")).toMatchObject({
      leafWorker: false,
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      isolatedWorkingDirectory: false,
    });
  });

  it("keeps leaf prompt budgets below large document-builder budgets", () => {
    expect(resolveModelPromptCharacterBudget("quality_reviewer")).toBe(45_000);
    expect(resolveModelPromptCharacterBudget("content_analyzer"))
      .toBeLessThan(resolveModelPromptCharacterBudget("artifact_builder"));
  });

  it("counts expensive agentic tool rounds for telemetry", () => {
    const items = [
      { type: "command_execution" },
      { type: "command_execution" },
      { type: "mcp_tool_call" },
      { type: "web_search" },
      { type: "agent_message" },
    ] as ThreadItem[];

    expect(summarizeCodexToolUsage(items)).toEqual({
      toolCalls: 4,
      commandExecutions: 2,
      fileChanges: 0,
      mcpToolCalls: 1,
      webSearches: 1,
    });
  });
});
