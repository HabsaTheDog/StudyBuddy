import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyStudyModel } from "../examNavigatorContracts.js";
import { ModelCallTimeoutError } from "../codexClient.js";
import { createQualityReviewerNode } from "../nodes/qualityReviewerNode.js";
import { readPendingExtractionRepairs } from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError } from "../runtimeAbort.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

const chapters = [
  {
    id: "chapter_tolerances",
    title: "Toleranzen und Passungen",
    subject: "Toleranzen und Passungen",
    order: 0,
    priority: "essential" as const,
    contentMode: "quantitative" as const,
    learningObjectives: [],
    assessmentSignals: [],
    status: "covered" as const,
    topicIds: [],
    resourceIds: [],
  },
  {
    id: "chapter_tribology",
    title: "Tribologie und Viskosität",
    subject: "Tribologie und Viskosität",
    order: 1,
    priority: "essential" as const,
    contentMode: "quantitative" as const,
    learningObjectives: [],
    assessmentSignals: [],
    status: "covered" as const,
    topicIds: [],
    resourceIds: [],
  },
];

describe("qualityReviewerNode", () => {
  it("emits exact chapter tags so analyzer repair stays localized", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-review-localized-"));
    try {
      const result = await createQualityReviewerNode(
        moodleTestConfig({ runDir }),
        {
          async run() {
            return JSON.stringify({
              ok: false,
              summary: "One contradiction",
              findings: [
                "[chapter: Tribologie und Viskosität] Der Diagrammwert 30 widerspricht dem Textwert 40.",
              ],
            });
          },
        },
      )(moodleTestState({
        study_model: { ...emptyStudyModel(), courseChapters: chapters },
      }));

      expect(result.error_log).toContain("[chapter: Tribologie und Viskosität]");
      expect(result.error_log).not.toContain("Toleranzen und Passungen");
      expect(result.retry_count).toBe(1);
      await expect(readFile(path.join(runDir, "quality-review.json"), "utf8"))
        .resolves.toContain("blocking_findings");
      await expect(readPendingExtractionRepairs(runDir)).resolves.toMatchObject({
        pendingChapterTitles: ["Tribologie und Viskosität"],
        retryCount: 1,
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("keeps renderer-owned global presentation feedback advisory", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-review-advisory-"));
    try {
      const result = await createQualityReviewerNode(
        moodleTestConfig({ runDir }),
        {
          async run() {
            return JSON.stringify({
              ok: false,
              summary: "Presentation request",
              findings: ["Der konkrete Lernplan für die PDF fehlt."],
            });
          },
        },
      )(moodleTestState({
        study_model: { ...emptyStudyModel(), courseChapters: chapters },
      }));

      expect(result).toEqual({ error_log: null });
      await expect(readFile(path.join(runDir, "quality-review.json"), "utf8"))
        .resolves.toContain("advisory_findings");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("turns the first tokenless extraction review timeout into a resumable checkpoint", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-review-timeout-"));
    try {
      const review = createQualityReviewerNode(
        moodleTestConfig({ runDir, stage: "extract" }),
        {
          async run() {
            throw new ModelCallTimeoutError({
              task: "quality_reviewer",
              model: "gpt-5.6-terra",
              timeoutMs: 90_000,
              queueWaitMs: 4_000,
            });
          },
        },
      );

      const result = review(moodleTestState({
        study_model: { ...emptyStudyModel(), courseChapters: chapters },
      }));
      await expect(result).rejects.toMatchObject({
        name: StudyBuddyCheckpointError.name,
        message: expect.stringContaining("Resume after fair model admission"),
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
