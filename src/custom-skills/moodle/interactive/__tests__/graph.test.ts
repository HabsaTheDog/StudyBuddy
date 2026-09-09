import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { buildInteractiveMoodleGraph, deriveWorkflowStatus, runInteractiveMoodleGraph } from "../graph.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { initialAgentState } from "../state.js";

let workspace: string | null = null;

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = null;
});

describe("interactive Moodle graph", () => {
  it("captures solver images from the same authenticated browser used for quiz navigation", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-quiz-image-graph-"));
    const browser = { ...fakeBrowser(), captureQuestionImage: vi.fn(async () => {}) };
    const codex = { run: vi.fn(async () => JSON.stringify({ confidence: 0, risk_flags: [] })) };
    const workflow = { kind: "quiz_workflow", target_url: "https://moodle.example/mod/quiz/view.php?id=7",
      done: false, page_number: 1, fill_results: [], page: { title: "Diagram", url: "https://moodle.example/mod/quiz/attempt.php?attempt=1", body_text: "Diagram", questions: [
        { question_id: "question-42-1", question_index: 1, question_type: "ddimageortext", prompt: "Place labels", controls: [], options: [], visible_context: "Diagram", response_model: {adapter:"drag-drop-image",support:"supported"} },
      ] } };
    await buildInteractiveMoodleGraph({ prompt:"Bearbeite Quiz",originalUserPrompt:"Bearbeite Quiz",runDir:workspace,autoAnswer:true,quizSafetyPolicy:{allowSuggestingAnswers:true} } as MoodleRuntimeConfig, {
      browser, codex,
      quizTargetNode: async () => ({ extracted_data: { quiz_workflow: workflow } }),
      quizPageNode: async () => ({}),
      quizFillNode: async () => ({ extracted_data: { quiz_workflow: { ...workflow, done:true } } }),
    }).invoke(initialAgentState);
    expect(browser.captureQuestionImage).toHaveBeenCalledWith("question-42-1",expect.stringContaining("question.png"));
    expect(codex.run).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({imagePaths:[expect.stringContaining("question.png")]}));
  });
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
      expect(result.quizUrl).toBe("https://moodle.example/mod/quiz/view.php?id=7");
      await expect(
        readFile(path.join(result.runDir, "interaction-result.json"), "utf8"),
      ).resolves.toContain('"workflowStatus": "permission_required"');
      await expect(readFile(path.join(result.runDir, "run-summary.md"), "utf8")).resolves.toContain(
        "Run status: success",
      );
    } finally {
      restoreWorkspace(previousWorkspace);
    }
  });

  it("preserves saved answers and reports progress when a later page fails", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-interactive-failure-"));
    const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    try {
      const result = await runInteractiveMoodleGraph({prompt:"Bearbeite Quiz",moodleUrl:"https://moodle.example/mod/quiz/view.php?id=7"}, {
        browser: fakeBrowser(), codex: {run:async()=>"{}"},
        quizTargetNode: async () => ({extracted_data:{quiz_workflow:{done:false,page_number:2,target_url:"https://moodle.example/mod/quiz/view.php?id=7",fill_results:[{filled:true,persisted:true}]}}}),
        quizPageNode: async () => {throw new Error("Browser closed after saving page 1");},
      });
      expect(result.workflowStatus).toBe("failed");
      expect(result.state.extracted_data).toMatchObject({quiz_workflow:{fill_results:[{filled:true,persisted:true}]}});
      expect(JSON.parse(await readFile(path.join(result.runDir,"interaction-progress.json"),"utf8"))).toMatchObject({status:"failed",savedAnswers:1,finalSubmitClicked:false});
      expect(result.quizUrl).toContain("id=7");
    } finally { restoreWorkspace(previousWorkspace); }
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

  it("redacts credential-like prompt and URL values in persisted configuration", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-interactive-"));
    const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    try {
      const result = await runInteractiveMoodleGraph(
        {
          prompt: "Review https://moodle.example/mod/quiz/view.php?id=7&token=prompt-secret",
          originalUserPrompt: "Use https://moodle.example/?access_token=original-secret",
          moodleUrl: "https://moodle.example/mod/quiz/view.php?id=7&token=url-secret#private",
        },
        {
          browser: fakeBrowser(),
          codex: { run: async () => "{}" },
          quizTargetNode: async () => ({
            extracted_data: {
              quiz_workflow: {
                kind: "quiz_workflow",
                target_url: null,
                done: true,
                stop_reason: "no-quiz-target",
              },
            },
          }),
        },
      );

      const persisted = await readFile(path.join(result.runDir, "interaction-config.json"), "utf8");
      expect(persisted).not.toContain("prompt-secret");
      expect(persisted).not.toContain("original-secret");
      expect(persisted).not.toContain("url-secret");
      expect(persisted).not.toContain("#private");
      expect(persisted).toContain("[REDACTED]");
    } finally {
      restoreWorkspace(previousWorkspace);
    }
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
