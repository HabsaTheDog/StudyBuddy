import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AgentBrowserClient,
  AgentBrowserCommandResult,
  AgentBrowserSnapshot,
} from "../agentBrowserClient.js";
import { createQuizSafetyPolicy } from "../config.js";
import { createAssignmentWorkflowNode } from "../nodes/assignmentWorkflowNode.js";
import { initialAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("assignment workflow permission boundary", () => {
  it("writes a native permission request without mutating Moodle", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "assignment-workflow-"));
    const browser = new FakeAssignmentBrowser();
    const targetUrl = "https://moodle.example/mod/assign/view.php?id=42";
    const node = createAssignmentWorkflowNode(
      runtimeConfig({
        prompt: `upload and submit assignment ${targetUrl}`,
        moodleUrl: targetUrl,
        runDir: tempDir,
        quizSafetyPolicy: createQuizSafetyPolicy(
          {},
          {
            MOODLE_QUIZ_ACCESS_MODE: "full-study-assist",
          },
        ),
        assignmentFiles: [],
      }),
      { agentBrowser: browser },
    );

    const result = await node(initialAgentState);
    const request = JSON.parse(
      await readFile(path.join(tempDir, "assignment-permission-request.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(request.action).toBe("submit_assignment");
    expect(request.scope).toBe("exact_assignment_submission");
    expect(request.finalQuizSubmission).toBe("denied");
    expect(browser.calls.some((call) => call.startsWith("click:"))).toBe(false);
    expect(result.final_document).toContain("permission_required");
  });

  it("uses an approved assignment grant while preserving the quiz submit prohibition", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "assignment-workflow-"));
    const targetUrl = "https://moodle.example/mod/assign/view.php?id=42";
    const browser = new FakeAssignmentBrowser([
      {},
      { submit: { role: "button", name: "Submit assignment" } },
      { confirm: { role: "button", name: "Continue" } },
    ]);
    const node = createAssignmentWorkflowNode(
      runtimeConfig({
        prompt: `submit assignment ${targetUrl}`,
        moodleUrl: targetUrl,
        runDir: tempDir,
        quizSafetyPolicy: createQuizSafetyPolicy(
          {},
          {
            MOODLE_QUIZ_ACCESS_MODE: "full-study-assist",
          },
        ),
        assignmentFiles: [],
        approvedAssignmentPermission: {
          requestId: "request-1",
          targetUrl,
          action: "submit_assignment",
          scope: "exact_assignment_submission",
          approvedAt: "2026-07-17T12:00:00.000Z",
          expiresAt: "2026-07-17T12:30:00.000Z",
          files: [],
        },
      }),
      { agentBrowser: browser },
    );

    const result = await node(initialAgentState);
    const report = JSON.parse(
      await readFile(path.join(tempDir, "assignment-report.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(browser.calls).toContain("click:@submit");
    expect(browser.calls).toContain("click:@confirm");
    expect(report.final_assignment_submit_clicked).toBe(true);
    expect(report.final_quiz_submit_clicked).toBe(false);
    expect(result.error_log).toBeNull();
  });
});

class FakeAssignmentBrowser implements AgentBrowserClient {
  readonly calls: string[] = [];
  private snapshotIndex = 0;

  constructor(
    private readonly snapshots: Array<Record<string, { role: string; name: string }>> = [],
  ) {}

  async doctor(): Promise<AgentBrowserCommandResult> {
    return ok();
  }
  async open(url: string): Promise<AgentBrowserCommandResult> {
    this.calls.push(`open:${url}`);
    return ok();
  }
  async snapshot(): Promise<AgentBrowserSnapshot> {
    const refs = this.snapshots[this.snapshotIndex++] ?? {};
    return { origin: "https://moodle.example", refs, snapshot: "" };
  }
  async getText(): Promise<string> {
    return "Submitted for grading";
  }
  async getTitle(): Promise<string> {
    return "Lab 1";
  }
  async getUrl(): Promise<string> {
    return "https://moodle.example/mod/assign/view.php?id=42";
  }
  async evalJson<T>(): Promise<T> {
    return {} as T;
  }
  async fill(): Promise<AgentBrowserCommandResult> {
    return ok();
  }
  async click(selector: string): Promise<AgentBrowserCommandResult> {
    this.calls.push(`click:${selector}`);
    return ok();
  }
  async press(): Promise<AgentBrowserCommandResult> {
    return ok();
  }
  async wait(): Promise<AgentBrowserCommandResult> {
    return ok();
  }
  async download(): Promise<AgentBrowserCommandResult> {
    return ok();
  }
  async close(): Promise<AgentBrowserCommandResult> {
    return ok();
  }
}

function ok(): AgentBrowserCommandResult {
  return { stdout: "", stderr: "" };
}

function runtimeConfig(
  overrides: Partial<MoodleRuntimeConfig> &
    Pick<MoodleRuntimeConfig, "prompt" | "moodleUrl" | "runDir">,
): MoodleRuntimeConfig {
  return {
    outputPath: path.join(overrides.runDir, "document.typ"),
    maxDepth: 1,
    maxPages: 4,
    maxCisPages: 0,
    allowFileDownloads: false,
    baseUrl: new URL(overrides.moodleUrl).origin,
    dashboardUrl: overrides.moodleUrl,
    cisUrls: [],
    cisBaseUrl: "https://cis.example",
    cisDashboardUrl: "https://cis.example",
    headless: true,
    ...overrides,
    originalUserPrompt: overrides.originalUserPrompt ?? overrides.prompt,
    outputLanguage: overrides.outputLanguage ?? "de",
    outputLanguageReason: overrides.outputLanguageReason ?? "prompt_language",
  };
}
