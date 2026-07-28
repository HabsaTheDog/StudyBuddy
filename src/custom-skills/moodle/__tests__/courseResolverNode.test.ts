import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodexClient } from "../codexClient.js";
import {
  createCourseResolverNode,
  type CourseCandidate,
  type CourseCatalogReader,
  type CourseProbe,
} from "../nodes/courseResolverNode.js";
import type { SourcePlan } from "../sourcePlanner.js";
import { moodleTestConfig, sequenceCodex } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("courseResolverNode", () => {
  it("probes semantically shortlisted courses and selects from page evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 20, "MEL1 Maschinenelemente 1"),
      candidate("C3", 30, "ET2 Elektrotechnik 2"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Punktkinematik, Schwingungen und Drallsatz",
      C2: "Wellen, Lager, Passungen, Niet-, Klebe- und Lötverbindungen",
      C3: "Wechselstrom, Netzwerke und elektrische Leistung",
    });
    const codex = sequenceCodex([
      JSON.stringify({
        candidate_ids: ["C2", "C1"],
        reasoning: "Mechanical elements is the strongest title-level candidate.",
      }),
      JSON.stringify({
        selected_id: "C2",
        confidence: "high",
        reasoning: "The probed sections explicitly cover shafts, bearings, fits, and joints.",
        alternatives: [{ id: "C1", reason: "Mechanics-related, but focused on dynamics." }],
      }),
    ]);
    const config = resolverConfig(
      "Find the course about designing shafts, bearings, fits, and mechanical joints",
    );

    const result = await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
    expect(reader.probedIds).toEqual(["C2", "C1"]);
    expect(result.moodle_raw_text).toContain("Selected: MEL1 Maschinenelemente 1");
    expect(result.moodle_raw_text).toContain("Confidence: high");
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));
    expect(artifact.selected).toMatchObject({
      label: "MEL1 Maschinenelemente 1",
      method: "model_evidence",
    });
    expect(reader.closed).toBe(true);
  });

  it("uses an exact dashboard code match without probing or model guessing", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 20, "MEL1 Maschinenelemente 1"),
    ];
    const reader = fakeReader(candidates, {});
    let modelCalls = 0;
    const codex: CodexClient = {
      async run() {
        modelCalls += 1;
        throw new Error("model should not run");
      },
    };
    const config = resolverConfig("Create a study guide for MEL");

    await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
    expect(reader.probedIds).toEqual([]);
    expect(modelCalls).toBe(0);
  });

  it("rejects invented model IDs and falls back to the strongest probed evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "General Engineering"),
      candidate("C2", 20, "Energy Systems"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Project management and technical communication",
      C2: "Thermal systems, heat transfer, thermodynamics and energy balances",
    });
    const codex = sequenceCodex([
      JSON.stringify({ candidate_ids: ["C1", "C2"], reasoning: "Both are plausible." }),
      JSON.stringify({
        selected_id: "C99",
        confidence: "high",
        reasoning: "Invented candidate",
        alternatives: [],
      }),
    ]);
    const config = resolverConfig("Find my thermal systems and heat transfer course");

    const result = await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
    expect(result.moodle_raw_text).toContain("Method: deterministic_evidence");
  });

  it("can resolve a generic description from live titles and probe evidence without an alias", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "MAES2 Mathematik für Engineering Science 2"),
      candidate("C2", 20, "DYN2 Anwendungen der Dynamik"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Differentialrechnung, Integralrechnung, lineare Algebra und Formelsammlung",
      C2: "Punktkinematik, Schwingungen und Drallsatz",
    });
    const config = resolverConfig("Create an interactive guide for my math exam");

    await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(reader.probedIds).toEqual(["C1", "C2"]);
  });

  it("persists an unseen non-technical course title from Moodle evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "HUM-204 World Literature"),
      candidate("C2", 20, "BIO-110 Cell Biology"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Modernism, postcolonial fiction, close reading, seminar discussion and essays",
      C2: "Cell membranes, genetics and microscopy",
    });
    const codex = sequenceCodex([
      JSON.stringify({
        candidate_ids: ["C1", "C2"],
        reasoning: "World Literature is the direct subject match.",
      }),
      JSON.stringify({
        selected_id: "C1",
        confidence: "high",
        reasoning: "The page evidence covers literary analysis and the requested readings.",
        alternatives: [],
      }),
    ]);
    const config = resolverConfig(
      "Create an English study guide for my modern literature and close-reading course",
    );

    const result = await createCourseResolverNode(config, codex, { reader })();
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));

    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(result.error_log).toBeNull();
    expect(result.moodle_raw_text).toContain("Course title: HUM-204 World Literature");
    expect(artifact.selected.title).toBe("HUM-204 World Literature");
  });

  it("blocks a low-confidence unknown-course guess instead of crawling the wrong class", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "Introduction to Biology"),
      candidate("C2", 20, "Introduction to History"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Weekly lectures and readings",
      C2: "Weekly lectures and readings",
    });
    const codex = sequenceCodex([
      JSON.stringify({ candidate_ids: ["C1", "C2"], reasoning: "Both are plausible." }),
      JSON.stringify({
        selected_id: "C1",
        confidence: "low",
        reasoning: "The request does not identify a subject.",
        alternatives: [{ id: "C2", reason: "Equally plausible." }],
      }),
    ]);
    const config = resolverConfig("Create a study guide for my class");

    const result = await createCourseResolverNode(config, codex, { reader })();
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(artifact).toMatchObject({ selected: null, status: "ambiguous" });
  });

  it("fails closed when dashboard discovery itself fails", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([], {});
    reader.readDashboard = async () => {
      throw new Error("Custom Moodle theme did not expose a readable course list");
    };
    const config = resolverConfig("Create a study guide for World Literature");

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toBe(
      "Course resolution failed: Custom Moodle theme did not expose a readable course list",
    );
    expect(result.moodle_raw_text).toContain("Course discovery failed");
    expect(reader.closed).toBe(true);
  });

  it("skips discovery when a direct course URL is already known", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([], {});
    const config = resolverConfig("Build a guide from this course");
    config.moodleUrl = "https://moodle.example/course/view.php?id=42";

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result).toEqual({ error_log: null });
    expect(reader.dashboardReads).toBe(0);
  });

  it("skips discovery when a direct Moodle activity URL is already known", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([], {});
    const config = resolverConfig("Build a guide from this exact resource");
    config.moodleUrl = "https://moodle.example/mod/resource/view.php?id=2186227";

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result).toEqual({ error_log: null });
    expect(reader.dashboardReads).toBe(0);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it("keeps the dashboard scope for cross-course quiz discovery", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([
      candidate("C1", 10, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 20, "MAES2 Mathematik"),
    ], {});
    const config = resolverConfig("Find open quizzes and self-checks across all Moodle courses");
    config.intentDecision = {
      ...config.intentDecision!,
      intent: "quiz_assist",
      wantsQuizAssistance: true,
      wantsQuizDiscovery: true,
      wantsQuickAnswer: true,
    };

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result).toEqual({ error_log: null });
    expect(reader.dashboardReads).toBe(0);
    expect(config.targetCourseUrls).toBeUndefined();
  });
});

function resolverConfig(prompt: string) {
  return moodleTestConfig({
    prompt,
    runDir: runDir!,
    moodleUrl: "https://moodle.example/my/",
    dashboardUrl: "https://moodle.example/my/",
    sourcePlan: sourcePlan(),
  });
}

function sourcePlan(): SourcePlan {
  return {
    targets: ["moodle"],
    confidence: "high",
    reason: "Course materials requested.",
    needsCurrentScheduleData: false,
    needsCourseMaterial: true,
    needsFiles: true,
    needsQuizOrAssignment: false,
    allowFollowUpCrawl: true,
  };
}

function candidate(id: string, moodleId: number, label: string): CourseCandidate {
  return {
    id,
    url: `https://moodle.example/course/view.php?id=${moodleId}`,
    label,
  };
}

function fakeReader(
  candidates: CourseCandidate[],
  evidence: Record<string, string>,
): CourseCatalogReader & {
  dashboardReads: number;
  probedIds: string[];
  closed: boolean;
} {
  return {
    dashboardReads: 0,
    probedIds: [],
    closed: false,
    async readDashboard() {
      this.dashboardReads += 1;
      return candidates;
    },
    async probeCourse(entry): Promise<CourseProbe> {
      this.probedIds.push(entry.id);
      return {
        ...entry,
        title: entry.label,
        text: evidence[entry.id] ?? entry.label,
      };
    },
    async close() {
      this.closed = true;
    },
  };
}
