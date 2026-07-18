import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { deriveWorkflowStatus, runInteractiveMoodleGraph } from "../graph.js";
import { initialAgentState } from "../state.js";

let workspace: string | null = null;

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = null;
});

describe("interactive Moodle graph", () => {
  it("routes quiz actions through the canonical root graph", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-interactive-"));
    const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    try {
      const result = await runInteractiveMoodleGraph(
        {
          prompt: "Bearbeite den nächsten Quiz",
          moodleUrl: "https://moodle.example/mod/quiz/view.php?id=7",
        },
        {
          browser: fakeBrowser(),
          codex: { run: async () => "{}" },
          quizTargetNode: async () => ({
            extracted_data: {
              quiz_workflow: {
                kind: "quiz_workflow",
                target_url: "https://moodle.example/mod/quiz/view.php?id=7",
                done: true,
                pending_permission: { requestId: "quiz-request" },
              },
            },
          }),
        },
      );

      expect(result.ok).toBe(true);
      expect(result.workflowStatus).toBe("permission_required");
      expect(result.permissionRequestPath).toContain("quiz-permission-request.json");
    } finally {
      restoreWorkspace(previousWorkspace);
    }
  });

  it("routes assignment submissions without entering the document pipeline", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-interactive-"));
    const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    try {
      const result = await runInteractiveMoodleGraph(
        {
          prompt: "Assignment hochladen und abgeben",
          moodleUrl: "https://moodle.example/mod/assign/view.php?id=4",
        },
        {
          browser: fakeBrowser(),
          codex: { run: async () => "{}" },
          assignmentWorkflowNode: async () => ({
            extracted_data: {
              assignment_workflow: {
                kind: "assignment_workflow",
                status: "blocked",
                reason: "Full study assist is disabled.",
              },
            },
          }),
        },
      );

      expect(result.ok).toBe(false);
      expect(result.workflowStatus).toBe("blocked");
    } finally {
      restoreWorkspace(previousWorkspace);
    }
  });

  it("does not treat a missing quiz target as a successful report", () => {
    expect(
      deriveWorkflowStatus({
        ...initialAgentState,
        final_document: "Diagnostic text",
        extracted_data: {
          quiz_workflow: {
            kind: "quiz_workflow",
            target_url: null,
            done: true,
            stop_reason: "no-quiz-target",
          },
        },
      }),
    ).toBe("target_not_found");
  });
});

function fakeBrowser(): AgentBrowserClient {
  return {
    doctor: async () => ({ stdout: "", stderr: "" }),
    open: async () => ({ stdout: "", stderr: "" }),
    snapshot: async () => ({ origin: "https://moodle.example", refs: {}, snapshot: "" }),
    getText: async () => "",
    getTitle: async () => "",
    getUrl: async () => "https://moodle.example",
    evalJson: async <T>() => ({}) as T,
    fill: async () => ({ stdout: "", stderr: "" }),
    click: async () => ({ stdout: "", stderr: "" }),
    press: async () => ({ stdout: "", stderr: "" }),
    wait: async () => ({ stdout: "", stderr: "" }),
    download: async () => ({ stdout: "", stderr: "" }),
    close: async () => ({ stdout: "", stderr: "" }),
  };
}

function restoreWorkspace(value: string | undefined): void {
  if (value === undefined) delete process.env.STUDY_BUDDY_WORKSPACE;
  else process.env.STUDY_BUDDY_WORKSPACE = value;
}
