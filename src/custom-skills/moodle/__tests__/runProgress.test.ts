import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunDiagnostics } from "../runDiagnostics.js";
import { writeRunProgress } from "../runProgress.js";
import { publishObligationProgress, type EvidenceCard } from "../obligationInventory.js";
import { planSourcesForPrompt } from "../sourcePlanner.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("runProgress", () => {
  it("replaces a calendar-only snapshot with real ongoing obligation progress without claiming completion", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "obligation-progress-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({ runDir, diagnostics });
    await diagnostics.updateCoverage("calendar", { status: "success", detail: "Calendar read" });
    await writeRunProgress(config, { phase: "reading_calendar" });
    await diagnostics.log("info", "moodle_crawl", "Read a real task landing page");
    const card: EvidenceCard = { id: "quiz-1", kind: "quiz", label: "Task", url: "https://m.example/mod/quiz/view.php?id=1", courseId: 12, course: "Course", context: "", dates: [], index: "", landing: "Task metadata", read: true, failed: false };
    await publishObligationProgress(config, { schemaVersion: 1, complete: false, scope: "all_enrolled", range: null, courses: [{ id: 12, title: "Course", url: "https://m.example/course/view.php?id=12", status: "audited", reason: "Read" }], facts: [], gaps: [], answer: "" }, [card, { ...card, id: "quiz-2", read: false, failed: true }], 46);
    const progress = JSON.parse(await readFile(path.join(runDir, "run-progress.json"), "utf8"));
    expect(progress).toMatchObject({ status: "running", phase: "reading_moodle", sourceCoverage: { calendar: { status: "success" }, moodle: { status: "attempted", pages: 2 } } });
    expect(progress.sourceCoverage.moodle.detail).toContain("1/46 courses");
    expect(progress.sourceCoverage.moodle.detail).toContain("1 successful detail reads, 1 failed reads");
    expect(progress.sourceCoverage.moodle.detail).toContain("No complete result yet");
    expect(progress.technicalEventsTail.at(-1).message).toBe("Read a real task landing page");
    expect(progress.publicSteps.find((step: { id: string }) => step.id === "moodle").status).toBe("running");
  });
  it("creates a progress file at run start", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "run-progress-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({ runDir, diagnostics });

    await writeRunProgress(config, { phase: "planning_sources" });

    const progress = JSON.parse(await readFile(path.join(runDir, "run-progress.json"), "utf8"));
    expect(progress.schemaVersion).toBe(2);
    expect(progress.status).toBe("running");
    expect(progress.phase).toBe("planning_sources");
    expect(progress).not.toHaveProperty("estimatedTotalMs");
    expect(progress).not.toHaveProperty("estimatedRemainingMs");
    expect(progress).not.toHaveProperty("etaLabel");
    expect(progress).not.toHaveProperty("etaConfidence");
  });

  it("records Moodle-only and CIS skipped public source steps", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "run-progress-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({ runDir, diagnostics });
    const sourcePlan = planSourcesForPrompt("Erstelle einen Lernzettel aus PDF-Unterlagen");
    config.sourcePlan = sourcePlan;
    await diagnostics.markSuccess("moodle", {
      detail: "Moodle ok.",
      urls: [config.moodleUrl],
      pages: 1,
    });

    await writeRunProgress(config, { phase: "analyzing", sourcePlan });

    const progress = JSON.parse(await readFile(path.join(runDir, "run-progress.json"), "utf8"));
    expect(progress.publicSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "moodle", status: "done" }),
      expect.objectContaining({ id: "cis", status: "skipped" }),
    ]));
  });

  it("records terminal success with PDF path", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "run-progress-"));
    const diagnostics = new RunDiagnostics({ runDir });
    await diagnostics.init();
    const config = moodleTestConfig({ runDir, diagnostics });
    const pdfPath = path.join(runDir, "document.pdf");

    await writeRunProgress(config, {
      status: "success",
      phase: "finalizing",
      artifacts: { pdfPath },
    });

    const progress = JSON.parse(await readFile(path.join(runDir, "run-progress.json"), "utf8"));
    expect(progress.status).toBe("success");
    expect(progress.completedAt).toEqual(expect.any(String));
    expect(progress.artifacts.pdfPath).toBe(pdfPath);
    await expect(stat(path.join(runDir, "run-progress.json"))).resolves.toMatchObject({
      size: expect.any(Number),
    });
  });
});
