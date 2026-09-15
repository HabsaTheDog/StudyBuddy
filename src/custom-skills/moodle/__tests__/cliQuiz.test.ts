import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runInteractive: vi.fn(), runSource: vi.fn(), loadApproval: vi.fn(),
}));
vi.mock("../interactive/graph.js", () => ({ runInteractiveMoodleGraph: mocks.runInteractive }));
vi.mock("../graph.js", () => ({ runMoodleGraph: mocks.runSource }));
vi.mock("../interactive/quizPermissions.js", () => ({ loadApprovedQuizPermission: mocks.loadApproval }));
vi.mock("../../shared/runLease.js", () => ({ acquireRunLease: async () => async () => {} }));
vi.mock("../../shared/deliverables.js", () => ({ publishStudyBuddyDeliverables: async () => [] }));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.runInteractive.mockResolvedValue({ ok: true, workflowStatus: "permission_required", runDir: "/run",
    permissionRequestPaths: ["/run/a/quiz-permission-request.json", "/run/b/quiz-permission-request.json"],
    quizUrls: ["https://moodle.example/mod/quiz/view.php?id=1", "https://moodle.example/mod/quiz/view.php?id=2"] });
  mocks.runSource.mockResolvedValue({ ok: true, runDir: "/run" });
  mocks.loadApproval.mockImplementation(async (requestPath: string) => ({ requestPath, targetUrl: `https://moodle.example/mod/quiz/view.php?id=${requestPath === "/a.json" ? 1 : 2}` }));
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("Moodle CLI quiz batch routing", () => {
  it("passes every repeated exact approval to one interactive run and prints every result", async () => {
    process.argv = ["node", "moodle-agent", "Bitte beide Quizzes erledigen", "--url", "https://moodle.example/my/",
      "--approve-quiz-request", "/a.json", "--approve-quiz-request", "/b.json", "--approve-quiz-request", "/a.json",
      "--quiz-solver-concurrency", "8"];
    await import("../cli.js");
    expect(mocks.loadApproval.mock.calls).toEqual([["/a.json"], ["/b.json"]]);
    expect(mocks.runInteractive).toHaveBeenCalledOnce();
    expect(mocks.runInteractive).toHaveBeenCalledWith(expect.objectContaining({
      moodleUrl: "https://moodle.example/my/", approvedQuizPermission: undefined, quizSolverConcurrency: 8,
      approvedQuizPermissions: [expect.objectContaining({ requestPath: "/a.json" }), expect.objectContaining({ requestPath: "/b.json" })],
    }));
    expect(console.log).toHaveBeenCalledWith("Permission request: /run/a/quiz-permission-request.json");
    expect(console.log).toHaveBeenCalledWith("Permission request: /run/b/quiz-permission-request.json");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("view.php?id=2"));
  });

  it("routes plural quiz execution with auto-answer without requiring an approval argument", async () => {
    process.argv = ["node", "moodle-agent", "Bitte die zwei Mini-Tests erledigen", "--url", "https://moodle.example/my/", "--auto-answer"];
    await import("../cli.js");
    expect(mocks.runInteractive).toHaveBeenCalledOnce();
    expect(mocks.runSource).not.toHaveBeenCalled();
  });

  it("keeps read-only source evidence available when no quiz approval was supplied", async () => {
    process.argv = ["node", "moodle-agent", "Welche Tests stehen an?", "--url", "https://moodle.example/my/", "--source-evidence-only"];
    await import("../cli.js");
    expect(mocks.runSource).toHaveBeenCalledOnce();
    expect(mocks.runInteractive).not.toHaveBeenCalled();
  });
});
