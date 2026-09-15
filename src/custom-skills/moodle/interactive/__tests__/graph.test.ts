import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { buildInteractiveMoodleGraph, deriveWorkflowStatus, runInteractiveMoodleGraph } from "../graph.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { initialAgentState, type AgentState, type JsonObject } from "../state.js";

let workspace: string | null = null;

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
  workspace = null;
});

describe("interactive Moodle graph", () => {
  it("passes the authenticated navigation browser to the capture/solve/fill attempt workflow", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-quiz-image-graph-"));
    const browser = { ...fakeBrowser(), captureQuestionImage: vi.fn(async () => {}) };
    const codex = { run: vi.fn(async () => JSON.stringify({ confidence: 0, risk_flags: [] })) };
    const workflow = { kind: "quiz_workflow", target_url: "https://moodle.example/mod/quiz/view.php?id=7",
      done: false, page_number: 1, fill_results: [], page: { title: "Diagram", url: "https://moodle.example/mod/quiz/attempt.php?attempt=1", body_text: "Diagram", questions: [
        { question_id: "question-42-1", question_index: 1, question_type: "ddimageortext", prompt: "Place labels", controls: [], options: [], visible_context: "Diagram", response_model: {adapter:"drag-drop-image",support:"supported"} },
      ] } };
    const attemptFactory = vi.fn((_config, dependencies) => async (state: AgentState) => {
      expect(dependencies.agentBrowser).toBe(browser);
      expect(dependencies.codex).toBe(codex);
      return { ...state, extracted_data: { quiz_workflow: { ...workflow, done: true } } };
    });
    await buildInteractiveMoodleGraph({ prompt:"Bearbeite Quiz",originalUserPrompt:"Bearbeite Quiz",runDir:workspace,autoAnswer:true,quizSafetyPolicy:{allowSuggestingAnswers:true} } as MoodleRuntimeConfig, {
      browser, codex,
      quizTargetNode: async () => ({ extracted_data: { quiz_workflow: workflow } }),
      quizPageNode: async () => ({}),
      quizAttemptFactory: attemptFactory,
    }).invoke(initialAgentState);
    expect(attemptFactory).toHaveBeenCalledOnce();
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

  it("runs two quiz attempts concurrently in isolated browsers without sharing an exact grant", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-quiz-batch-"));
    const targets = [1, 2].map(id => `https://moodle.example/mod/quiz/view.php?id=${id}`);
    const configs: MoodleRuntimeConfig[] = [];
    const browsers: AgentBrowserClient[] = [];
    let entered = 0;
    let release!: () => void;
    const bothEntered = new Promise<void>(resolve => { release = resolve; });
    const result = await runInteractiveMoodleGraph({
      prompt: `Bearbeite beide Quizzes ${targets.join(" und ")}`, moodleUrl: targets[0],
      runDir: workspace,
      quizSafetyPolicy: { askBeforeStartingOrContinuingAttempts: true, allowFillingAnswers: false },
      approvedQuizPermission: { requestId: "one-only", requestPath: path.join(workspace, "grant.json"),
        targetUrl: targets[0], action: "execute_quiz_attempt", scope: "exact_quiz_attempt",
        approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() },
    }, {
      browser: fakeBrowser(), codex: { run: async () => "{}" },
      quizTargetNode: async () => ({ extracted_data: { quiz_workflow: {
        target_url: targets[0], target_urls: targets, done: false, missing_quiz_count: 0,
      } } }),
      quizBrowserFactory: config => { configs.push(config); const browser = { ...fakeBrowser(), close: vi.fn(async () => ({ stdout: "", stderr: "" })) }; browsers.push(browser); return browser; },
      quizPageNode: async () => ({}),
      quizAttemptFactory: config => async state => {
        entered += 1;
        if (entered === 2) release();
        await bothEntered;
        return { ...state, extracted_data: { quiz_workflow: { target_url: config.moodleUrl, done: true, stop_reason: "attempt-summary-reached",
          fill_results: [{ filled: true, persisted: true }], final_submit_clicked: false } },
          source_coverage: { ...state.source_coverage, moodle: { status: "success", detail: "Fixture pages", urls: [config.moodleUrl], pages: 2 } },
          final_document: "Saved fixture answers" };
      },
    });
    expect(result.workflowStatus).toBe("completed");
    expect(entered).toBe(2);
    expect(browsers[0]).not.toBe(browsers[1]);
    expect(configs[0].runDir).not.toBe(configs[1].runDir);
    expect(configs[0].browserSession).not.toBe(configs[1].browserSession);
    expect(configs[0].browserSessionName).not.toBe(configs[1].browserSessionName);
    expect(configs[0].approvedQuizPermission?.targetUrl).toBe(targets[0]);
    expect(configs[1].approvedQuizPermission).toBeUndefined();
    expect(configs[1].quizSafetyPolicy?.askBeforeStartingOrContinuingAttempts).toBe(true);
    for (const browser of browsers) expect(browser.close).toHaveBeenCalledOnce();
    expect(result.state.extracted_data).toMatchObject({ quiz_batch: { results: [
      { targetUrl: targets[0], workflowStatus: "completed" }, { targetUrl: targets[1], workflowStatus: "completed" },
    ] } });
    expect(JSON.parse(await readFile(path.join(workspace, "interaction-progress.json"), "utf8"))).toMatchObject({ savedAnswers: 2 });
  });

  it("keeps an unfulfilled second quiz visible instead of declaring completion", () => {
    expect(deriveWorkflowStatus({ ...initialAgentState, extracted_data: { quiz_workflow: {
      target_url: "https://moodle.example/mod/quiz/view.php?id=1", done: true, missing_quiz_count: 1,
    } } })).toBe("blocked");
  });

  it("returns both permission cards with existing child artifact paths", async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-quiz-permissions-"));
    const targets = [1, 2].map(id => `https://moodle.example/mod/quiz/view.php?id=${id}`);
    const result = await runInteractiveMoodleGraph({ prompt: "Bearbeite beide Quizzes", moodleUrl: "https://moodle.example/my/", runDir: workspace }, {
      browser: fakeBrowser(), codex: { run: async () => "{}" }, quizBrowserFactory: () => fakeBrowser(),
      quizTargetNode: async () => ({ extracted_data: { quiz_workflow: { target_url: targets[0], target_urls: targets, done: false } } }),
      quizPageNode: async state => {
        const quiz = (state.extracted_data as JsonObject).quiz_workflow as JsonObject;
        const index = targets.indexOf(String(quiz.target_url));
        await writeFile(path.join(workspace!, "quizzes", `quiz-${index + 1}`, "quiz-permission-request.json"), "{}");
        return { extracted_data: { quiz_workflow: { ...quiz, done: true, pending_permission: { requestId: `request-${index + 1}` } } } };
      },
    });
    expect(result.workflowStatus).toBe("permission_required");
    expect(result.permissionRequestPaths).toHaveLength(2);
    for (const file of result.permissionRequestPaths!) expect(await readFile(file, "utf8")).toBe("{}");
    expect(JSON.parse(await readFile(path.join(workspace, "interaction-result.json"), "utf8"))).toMatchObject({ requiredArtifacts: [
      "quiz-review.typ", "quiz-review.json", "quizzes/quiz-1/quiz-permission-request.json", "quizzes/quiz-2/quiz-permission-request.json",
    ] });
  });

  it.each(["attempt", "browser", "configuration"])("retains a completed sibling when another quiz fails during %s", async failurePoint => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "study-buddy-quiz-partial-"));
    const targets = [1, 2].map(id => `https://moodle.example/mod/quiz/view.php?id=${id}`);
    if (failurePoint === "configuration") {
      await mkdir(path.join(workspace, "quizzes"));
      await writeFile(path.join(workspace, "quizzes", "quiz-2"), "fixture blocking directory creation");
    }
    const result = await runInteractiveMoodleGraph({ prompt: "Bearbeite beide Quizzes", moodleUrl: "https://moodle.example/my/", runDir: workspace }, {
      browser: fakeBrowser(), codex: { run: async () => "{}" }, quizBrowserFactory: config => {
        if (failurePoint === "browser" && config.moodleUrl === targets[1]) throw new Error("Fixture browser disconnected");
        return fakeBrowser();
      },
      quizTargetNode: async () => ({ extracted_data: { quiz_workflow: { target_url: targets[0], target_urls: targets, done: false } } }),
      quizPageNode: async () => ({}),
      quizAttemptFactory: config => async () => {
        if (failurePoint === "attempt" && config.moodleUrl === targets[1]) throw new Error("Fixture browser disconnected");
        return { extracted_data: { quiz_workflow: { target_url: targets[0], done: true, stop_reason: "attempt-summary-reached", fill_results: [{ filled: true, persisted: true }] } } };
      },
    });
    expect(result.workflowStatus).toBe("failed");
    expect(result.state.extracted_data).toMatchObject({ quiz_batch: { results: [
      { workflowStatus: "completed", quiz_workflow: { fill_results: [{ persisted: true }] } },
      { workflowStatus: "failed", error: expect.any(String) },
    ] } });
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
