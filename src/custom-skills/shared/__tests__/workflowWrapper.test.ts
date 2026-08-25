import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const wrapper = resolve(repositoryRoot, "scripts/study_buddy_task.sh");
const temporary = mkdtempSync(join(tmpdir(), "study-buddy-wrapper-"));
const canonicalTemporary = realpathSync(temporary);

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function run(action: string | string[], env: Record<string, string> = {}) {
  return spawnSync(wrapper, Array.isArray(action) ? action : [action], {
    cwd: temporary,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...env,
    },
  });
}

function createRunFixture(input: {
  name: string;
  status: "success" | "partial" | "failed" | "running" | "canceled";
  config?: Record<string, unknown>;
  artifacts?: Record<string, string>;
  progressArtifacts?: Record<string, string>;
  interactionResult?: Record<string, unknown>;
}) {
  const runDir = join(temporary, input.name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "run-summary.md"),
    `Route: ${input.interactionResult ? `interactive_${input.interactionResult.kind}` : (input.config?.intentDecision as { intent?: string } | undefined)?.intent ?? "document"}\nRun status: ${input.status}\n`,
  );
  writeFileSync(join(runDir, "error.log"), "");
  if (input.config) {
    writeFileSync(join(runDir, "config.json"), `${JSON.stringify(input.config)}\n`);
    writeFileSync(
      join(runDir, "run-progress.json"),
      `${JSON.stringify({
        status: input.status,
        artifacts: input.progressArtifacts ?? {},
      })}\n`,
    );
  }
  if (input.interactionResult) {
    writeFileSync(
      join(runDir, "interaction-result.json"),
      `${JSON.stringify(input.interactionResult)}\n`,
    );
  }
  for (const [name, value] of Object.entries(input.artifacts ?? {})) {
    writeFileSync(join(runDir, name), value);
  }
  return runDir;
}

function createStudyGuideFixture(input: {
  name: string;
  status: "queued" | "running" | "success" | "failed";
  withHtml?: boolean;
  withPdf?: boolean;
  outputPath?: string;
}) {
  const runDir = join(temporary, input.name);
  const webLayoutRunDir = join(runDir, "web-layout");
  const pdfRenderRunDir = input.withPdf ? join(runDir, "pdf-render") : undefined;
  const outputPath = input.outputPath ?? join(webLayoutRunDir, "document.html");
  mkdirSync(webLayoutRunDir, { recursive: true });
  if (input.withHtml) writeFileSync(outputPath, "<!doctype html><title>Study Guide</title>\n");
  if (pdfRenderRunDir) {
    mkdirSync(pdfRenderRunDir, { recursive: true });
    writeFileSync(join(pdfRenderRunDir, "document.pdf"), "pdf\n");
  }
  writeFileSync(
    join(runDir, "workflow-summary.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      status: input.status,
      ok: input.status === "success",
      runDir,
      webLayoutRunDir,
      pdfRenderRunDir,
      outputPath,
      pdfPath: pdfRenderRunDir ? join(pdfRenderRunDir, "document.pdf") : undefined,
      error: input.status === "failed" ? "render failed" : undefined,
    })}\n`,
  );
  writeFileSync(join(runDir, "workflow-summary.md"), `Run status: ${input.status}\n`);
  return runDir;
}

describe("canonical Study Buddy workflow wrapper", () => {
  it("contains no maintainer-local path", () => {
    const source = readFileSync(wrapper, "utf8");
    expect(source).not.toContain("/home/alvaroschroll");
    expect(source).not.toContain(".agents/skills");
  });

  it.skipIf(process.platform === "win32")(
    "is executable and syntactically valid",
    () => {
      accessSync(wrapper, constants.X_OK);
      expect(spawnSync("bash", ["-n", wrapper]).status).toBe(0);
    },
  );

  it.skipIf(process.platform === "win32")(
    "resolves its repository root and invocation workspace without HOME",
    () => {
      const root = run("root");
      expect(root.status).toBe(0);
      expect(root.stdout.trim()).toBe(repositoryRoot);
      const workspace = run("workspace");
      expect(workspace.status).toBe(0);
      expect(workspace.stdout.trim()).toBe(canonicalTemporary);
    },
  );

  it.skipIf(process.platform === "win32")("accepts the explicit packaged workflow root", () => {
    const packagedRoot = join(temporary, "packaged-workflow");
    mkdirSync(packagedRoot);
    writeFileSync(join(packagedRoot, "package.json"), "{}\n");
    const result = run("root", { STUDY_BUDDY_WORKFLOW_ROOT: packagedRoot });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packagedRoot);
  });

  it.skipIf(process.platform === "win32")(
    "uses route-aware terminal contracts for answers, diagnostics, extraction, and documents",
    () => {
      const quick = createRunFixture({
        name: "quick-answer",
        status: "success",
        config: {
          stage: "all",
          intentDecision: { intent: "quick_answer", wantsQuickAnswer: true },
        },
        artifacts: { "answer.md": "answer\n", "answer.json": "{}\n" },
      });
      const diagnostic = createRunFixture({
        name: "diagnostic",
        status: "partial",
        config: { stage: "all", diagnosticOnly: true, intentDecision: { intent: "diagnostic" } },
        artifacts: { "moodle_raw.txt": "diagnostic\n", "source_coverage.json": "{}\n" },
      });
      const extraction = createRunFixture({
        name: "extraction",
        status: "partial",
        config: { stage: "extract", intentDecision: { intent: "extraction" } },
        artifacts: { "extracted-data.json": "{}\n" },
      });
      const document = createRunFixture({
        name: "document",
        status: "success",
        config: { stage: "render", intentDecision: { intent: "render" } },
        artifacts: { "document.typ": "document\n", "document.pdf": "pdf\n" },
      });

      for (const runDir of [quick, diagnostic, extraction, document]) {
        const checkpoint = run(["checkpoint", runDir]);
        expect(checkpoint.status).toBe(0);
        expect(JSON.parse(checkpoint.stdout)).toMatchObject({ report: "completed" });
        expect(run(["wait", runDir, "1"]).status).toBe(0);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "accepts completed and permission-required native interaction artifacts",
    () => {
      const quiz = createRunFixture({
        name: "native-quiz",
        status: "success",
        interactionResult: {
          schemaVersion: 1,
          ok: true,
          workflowStatus: "completed",
          kind: "quiz",
          requiredArtifacts: ["quiz-review.typ", "quiz-review.json"],
        },
        artifacts: { "quiz-review.typ": "review\n", "quiz-review.json": "{}\n" },
      });
      const permission = createRunFixture({
        name: "native-quiz-permission",
        status: "success",
        interactionResult: {
          schemaVersion: 1,
          ok: true,
          workflowStatus: "permission_required",
          kind: "quiz",
          requiredArtifacts: [
            "quiz-review.typ",
            "quiz-review.json",
            "quiz-permission-request.json",
          ],
        },
        artifacts: {
          "quiz-review.typ": "review\n",
          "quiz-review.json": "{}\n",
          "quiz-permission-request.json": "{}\n",
        },
      });

      expect(run(["wait", quiz, "1"]).status).toBe(0);
      const checkpoint = run(["checkpoint", permission]);
      expect(JSON.parse(checkpoint.stdout)).toMatchObject({
        report: "completed",
        workflow_status: "permission_required",
        next_action: "Deliver the permission request and wait for explicit approval",
      });
      expect(run(["wait", permission, "1"]).status).toBe(0);
    },
  );

  it.skipIf(process.platform === "win32")(
    "validates interactive Study Guide workflow-root completion",
    () => {
      const htmlOnly = createStudyGuideFixture({
        name: "study-guide-html",
        status: "success",
        withHtml: true,
      });
      const htmlAndPdf = createStudyGuideFixture({
        name: "study-guide-pdf",
        status: "success",
        withHtml: true,
        withPdf: true,
      });
      for (const runDir of [htmlOnly, htmlAndPdf]) {
        expect(JSON.parse(run(["checkpoint", runDir]).stdout)).toMatchObject({
          report: "completed",
          contract: "interactive_study_guide",
          workflow_status: "success",
        });
        expect(run(["wait", runDir, "1"]).status).toBe(0);
      }

      const missing = createStudyGuideFixture({ name: "study-guide-missing", status: "success" });
      const outside = createStudyGuideFixture({
        name: "study-guide-outside",
        status: "success",
        outputPath: join(temporary, "outside-guide.html"),
      });
      writeFileSync(join(temporary, "outside-guide.html"), "outside\n");
      const staleFailed = createStudyGuideFixture({
        name: "study-guide-failed",
        status: "failed",
        withHtml: true,
      });
      const htmlDirectory = createStudyGuideFixture({
        name: "study-guide-html-directory",
        status: "success",
      });
      const htmlDirectoryPath = join(htmlDirectory, "web-layout", "not-an-html-file");
      mkdirSync(htmlDirectoryPath);
      const htmlDirectorySummary = JSON.parse(
        readFileSync(join(htmlDirectory, "workflow-summary.json"), "utf8"),
      );
      htmlDirectorySummary.outputPath = htmlDirectoryPath;
      writeFileSync(
        join(htmlDirectory, "workflow-summary.json"),
        `${JSON.stringify(htmlDirectorySummary)}\n`,
      );
      const pdfDirectory = createStudyGuideFixture({
        name: "study-guide-pdf-directory",
        status: "success",
        withHtml: true,
        withPdf: true,
      });
      const pdfDirectoryPath = join(pdfDirectory, "pdf-render", "document.pdf");
      rmSync(pdfDirectoryPath);
      mkdirSync(pdfDirectoryPath);
      for (const runDir of [missing, outside, staleFailed, htmlDirectory, pdfDirectory]) {
        expect(JSON.parse(run(["checkpoint", runDir]).stdout)).toMatchObject({ report: "blocked" });
        expect(run(["wait", runDir, "1"]).status).toBe(1);
      }

      const live = createStudyGuideFixture({ name: "study-guide-live", status: "running" });
      writeFileSync(join(live, "pid.json"), `${JSON.stringify({ child_pid: process.pid })}\n`);
      expect(JSON.parse(run(["checkpoint", live]).stdout)).toMatchObject({
        report: "progress",
        process_alive: true,
        contract: "interactive_study_guide",
        blocker: null,
      });

      const resumeSkew = createStudyGuideFixture({
        name: "study-guide-resume-skew",
        status: "success",
        withHtml: true,
      });
      writeFileSync(join(resumeSkew, "workflow-summary.md"), "Run status: running\n");
      writeFileSync(
        join(resumeSkew, "pid.json"),
        `${JSON.stringify({ child_pid: process.pid })}\n`,
      );
      expect(JSON.parse(run(["checkpoint", resumeSkew]).stdout)).toMatchObject({
        report: "progress",
        process_alive: true,
        blocker: null,
      });
      writeFileSync(
        join(resumeSkew, "pid.json"),
        `${JSON.stringify({ child_pid: 2_147_483_647 })}\n`,
      );
      expect(JSON.parse(run(["checkpoint", resumeSkew]).stdout)).toMatchObject({
        report: "blocked",
        process_alive: false,
      });
      expect(run(["wait", resumeSkew, "1"]).status).toBe(1);
    },
    15_000,
  );

  it.skipIf(process.platform === "win32")(
    "rejects missing, failed, contradictory, and out-of-run artifacts",
    () => {
      const missingAnswer = createRunFixture({
        name: "missing-answer-data",
        status: "success",
        config: {
          stage: "all",
          intentDecision: { intent: "quick_answer", wantsQuickAnswer: true },
        },
        artifacts: { "answer.md": "answer\n" },
      });
      const failedWithStalePdf = createRunFixture({
        name: "failed-stale-pdf",
        status: "failed",
        config: { stage: "render", intentDecision: { intent: "render" } },
        artifacts: { "document.typ": "stale\n", "document.pdf": "stale\n" },
      });
      const escapedArtifact = createRunFixture({
        name: "escaped-artifact",
        status: "success",
        config: { stage: "render", intentDecision: { intent: "render" } },
        artifacts: { "document.typ": "document\n", "document.pdf": "pdf\n" },
        progressArtifacts: { pdfPath: join(temporary, "outside.pdf") },
      });
      const nativeArtifactDirectory = createRunFixture({
        name: "native-artifact-directory",
        status: "success",
        interactionResult: {
          schemaVersion: 1,
          ok: true,
          workflowStatus: "completed",
          kind: "quiz",
          requiredArtifacts: ["quiz-review.typ", "quiz-review.json"],
        },
        artifacts: { "quiz-review.json": "{}\n" },
      });
      mkdirSync(join(nativeArtifactDirectory, "quiz-review.typ"));

      for (const runDir of [
        missingAnswer,
        failedWithStalePdf,
        escapedArtifact,
        nativeArtifactDirectory,
      ]) {
        expect(JSON.parse(run(["checkpoint", runDir]).stdout)).toMatchObject({ report: "blocked" });
        expect(run(["wait", runDir, "1"]).status).toBe(1);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps a live nonterminal run in progress and rejects a later-canceled interaction",
    () => {
      const active = createRunFixture({
        name: "active-answer",
        status: "running",
        config: {
          stage: "all",
          intentDecision: { intent: "quick_answer", wantsQuickAnswer: true },
        },
      });
      writeFileSync(join(active, "pid.json"), `${JSON.stringify({ child_pid: process.pid })}\n`);
      expect(JSON.parse(run(["checkpoint", active]).stdout)).toMatchObject({
        report: "progress",
        process_alive: true,
        terminal_status: "running",
        blocker: null,
      });

      const terminalWriteSkew = createRunFixture({
        name: "terminal-write-skew",
        status: "success",
        config: {
          stage: "all",
          intentDecision: { intent: "quick_answer", wantsQuickAnswer: true },
        },
        artifacts: { "answer.md": "answer\n", "answer.json": "{}\n" },
      });
      writeFileSync(
        join(terminalWriteSkew, "run-progress.json"),
        `${JSON.stringify({ status: "running", artifacts: {} })}\n`,
      );
      writeFileSync(
        join(terminalWriteSkew, "pid.json"),
        `${JSON.stringify({ child_pid: process.pid })}\n`,
      );
      expect(JSON.parse(run(["checkpoint", terminalWriteSkew]).stdout)).toMatchObject({
        report: "progress",
        process_alive: true,
        terminal_status: "success",
        blocker: null,
      });
      writeFileSync(
        join(terminalWriteSkew, "pid.json"),
        `${JSON.stringify({ child_pid: 2_147_483_647 })}\n`,
      );
      expect(JSON.parse(run(["checkpoint", terminalWriteSkew]).stdout)).toMatchObject({
        report: "blocked",
        process_alive: false,
        terminal_status: "success",
      });
      expect(run(["wait", terminalWriteSkew, "1"]).status).toBe(1);

      const interactionWriteSkew = join(temporary, "interaction-write-skew");
      mkdirSync(interactionWriteSkew, { recursive: true });
      writeFileSync(join(interactionWriteSkew, "error.log"), "");
      writeFileSync(join(interactionWriteSkew, "quiz-review.typ"), "review\n");
      writeFileSync(join(interactionWriteSkew, "quiz-review.json"), "{}\n");
      writeFileSync(
        join(interactionWriteSkew, "interaction-result.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          ok: true,
          workflowStatus: "completed",
          kind: "quiz",
          requiredArtifacts: ["quiz-review.typ", "quiz-review.json"],
        })}\n`,
      );
      writeFileSync(
        join(interactionWriteSkew, "pid.json"),
        `${JSON.stringify({ child_pid: process.pid })}\n`,
      );
      expect(JSON.parse(run(["checkpoint", interactionWriteSkew]).stdout)).toMatchObject({
        report: "progress",
        process_alive: true,
        terminal_status: "unknown",
        blocker: null,
      });

      const canceled = createRunFixture({
        name: "canceled-native-quiz",
        status: "canceled",
        interactionResult: {
          schemaVersion: 1,
          ok: true,
          workflowStatus: "completed",
          kind: "quiz",
          requiredArtifacts: ["quiz-review.typ", "quiz-review.json"],
        },
        artifacts: { "quiz-review.typ": "review\n", "quiz-review.json": "{}\n" },
      });
      const canceledCheckpoint = JSON.parse(run(["checkpoint", canceled]).stdout);
      expect(canceledCheckpoint).toMatchObject({ report: "blocked" });
      expect(canceledCheckpoint.blocker).toContain("contradicts run summary status canceled");
      expect(run(["wait", canceled, "1"]).status).toBe(1);
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when an artifact lock exists without owner metadata",
    () => {
      const workspace = join(temporary, "ownerless-lock-workspace");
      const packagedRoot = join(temporary, "ownerless-lock-root");
      const lockDir = join(workspace, "study-buddy-data", "locks", ".artifact-workflow.lock");
      mkdirSync(workspace, { recursive: true });
      mkdirSync(packagedRoot, { recursive: true });
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(join(packagedRoot, "package.json"), "{}\n");
      writeFileSync(join(lockDir, "sentinel"), "preserve\n");

      const result = run(["interactive-study-guide", "test lock"], {
        STUDY_BUDDY_ROOT: packagedRoot,
        STUDY_BUDDY_WORKSPACE: workspace,
        STUDY_BUDDY_THREAD_ID: "",
        STUDY_BUDDY_WORKSPACE_KIND: "",
        CODEX_THREAD_ID: "",
      });
      expect(result.status).toBe(73);
      expect(result.stderr).toContain("active, initializing, or left a stale lock");
      expect(readFileSync(join(lockDir, "sentinel"), "utf8")).toBe("preserve\n");
    },
  );
});
