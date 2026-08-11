import { describe, expect, it } from "vitest";
import { executeStudyWorkflowPlan, type StudyWorkflowPlan } from "../studyWorkflowPlan.js";

describe("modular Study Buddy workflow plan", () => {
  it("runs independent artifact branches in parallel", async () => {
    let active = 0;
    let maximumActive = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const plan = workflow([
      module("html", "artifact.interactive_html"),
      module("pdf", "artifact.study_pdf"),
    ]);
    const execution = await executeStudyWorkflowPlan(plan, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (active === 2) release();
      await bothStarted;
      active -= 1;
      return item.kind;
    });

    expect(execution.ok).toBe(true);
    expect(maximumActive).toBe(2);
  });

  it("serializes modules that claim the same exclusive Moodle resource", async () => {
    let active = 0;
    let maximumActive = 0;
    const plan = workflow([
      module("quiz-a", "quiz.inspect", [], ["moodle-browser-session"]),
      module("quiz-b", "quiz.inspect", [], ["moodle-browser-session"]),
    ]);
    const execution = await executeStudyWorkflowPlan(plan, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return "review";
    });

    expect(execution.ok).toBe(true);
    expect(maximumActive).toBe(1);
  });

  it("preserves independent work and skips only dependants of a failed module", async () => {
    const executed: string[] = [];
    const plan = workflow([
      module("quiz-a", "quiz.inspect"),
      module("quiz-b", "quiz.inspect"),
      module("pdf", "artifact.study_pdf", ["quiz-a", "quiz-b"]),
      module("html", "artifact.interactive_html"),
    ]);
    const execution = await executeStudyWorkflowPlan(plan, async (item) => {
      executed.push(item.id);
      if (item.id === "quiz-b") throw new Error("quiz unavailable");
      return item.id;
    });

    expect(execution.ok).toBe(false);
    expect(executed).toContain("html");
    expect(executed).not.toContain("pdf");
    expect(execution.results.find((result) => result.moduleId === "pdf")).toMatchObject({ status: "skipped" });
  });

  it("joins multiple quiz-inspection outputs before starting their PDF summary", async () => {
    const completed = new Set<string>();
    let quizReadersActive = 0;
    let maximumQuizReaders = 0;
    let releaseReaders!: () => void;
    const bothReadersStarted = new Promise<void>((resolve) => { releaseReaders = resolve; });
    const plan = workflow([
      module("quiz-a", "quiz.inspect", [], ["quiz:11"]),
      module("quiz-b", "quiz.inspect", [], ["quiz:22"]),
      module("pdf", "artifact.study_pdf", ["quiz-a", "quiz-b"], ["artifact:pdf"]),
    ]);
    const execution = await executeStudyWorkflowPlan(plan, async (item) => {
      if (item.kind === "quiz.inspect") {
        quizReadersActive += 1;
        maximumQuizReaders = Math.max(maximumQuizReaders, quizReadersActive);
        if (quizReadersActive === 2) releaseReaders();
        await bothReadersStarted;
        completed.add(item.id);
        quizReadersActive -= 1;
        return `review:${item.id}`;
      }
      expect(completed).toEqual(new Set(["quiz-a", "quiz-b"]));
      completed.add(item.id);
      return "document.pdf";
    });

    expect(execution.ok).toBe(true);
    expect(maximumQuizReaders).toBe(2);
    expect(completed).toEqual(new Set(["quiz-a", "quiz-b", "pdf"]));
  });

  it("rejects dependency cycles before executing a module", async () => {
    let calls = 0;
    await expect(executeStudyWorkflowPlan(workflow([
      module("a", "quiz.inspect", ["b"]),
      module("b", "artifact.study_pdf", ["a"]),
    ]), async () => {
      calls += 1;
      return null;
    })).rejects.toThrow("dependency cycle");
    expect(calls).toBe(0);
  });
});

function workflow(modules: StudyWorkflowPlan["modules"]): StudyWorkflowPlan {
  return { schemaVersion: 1, modules };
}

function module(
  id: string,
  kind: string,
  dependsOn: string[] = [],
  exclusiveResourceKeys: string[] = [],
): StudyWorkflowPlan["modules"][number] {
  return { id, kind, dependsOn, exclusiveResourceKeys, required: true };
}
