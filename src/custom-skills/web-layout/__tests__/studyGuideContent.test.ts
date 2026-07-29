import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { buildStudyGuideContentPrompt, createStudyGuideContentNode } from "../nodes/studyGuideContentNode.js";
import { initialWebLayoutState } from "../state.js";
import { validateStudyGuideContentQuality, type StudyGuideContent } from "../studyGuideContent.js";

const previousConcurrency = process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY;
const tempDirs: string[] = [];

afterEach(async () => {
  process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY = previousConcurrency;
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("study-guide canonical content bank", () => {
  it("rejects a small generic task bank before HTML generation", () => {
    const content = {
      courseTitle: "MAES2",
      courseCode: "MAES2",
      scopeNote: "Test",
      topics: [{
        id: "t1",
        title: "Folgen",
        learningGoals: ["Folgen berechnen"],
        theory: { summary: "x".repeat(90), keyIdeas: ["A", "B"], formulas: [] },
        workedExamples: [{ title: "B", prompt: "Berechne den Folgenwert.", steps: ["A", "B"], answer: "1", source: { label: "M1", sourceTask: "Aufgabe 1", provenance: "source" } }],
        exercises: [{ id: "x1", type: "cross", prompt: "Welche Aussage trifft zu?", selectionMode: "single", options: [{ text: "A", correct: true, feedback: "A" }, { text: "B", correct: false, feedback: "B" }, { text: "C", correct: false, feedback: "C" }], explanation: "Eine konkrete Erklärung.", source: { label: "M1", sourceTask: "Aufgabe 1", provenance: "source" } }],
        retrieval: [{ prompt: "A?", answer: "B" }],
      }],
      sources: [{ id: "m1", label: "M1", url: "", coverage: "Folgen" }],
    } as StudyGuideContent;
    expect(validateStudyGuideContentQuality(content).join("\n")).toContain("at least 40");
    expect(validateStudyGuideContentQuality(content).join("\n")).toContain(
      "at least 20 selection/retrieval exercises",
    );
  });

  it("forces concrete source-bound exercises in the model prompt", () => {
    const prompt = buildStudyGuideContentPrompt({
      kind: "study-guide", language: "de",
    } as never, {
      source_text: "Minitest 1 Aufgabe 1",
      layout_spec: {},
      error_log: null,
    });
    expect(prompt).toContain("sourceTask must identify the concrete source task");
    expect(prompt).toContain("at least 12 substantive exercises");
    expect(prompt).toContain("open applications");
    expect(prompt).toContain("Do not describe layouts");
    expect(prompt).not.toContain('"$defs"');
  });

  it("uses bounded parallel content-analyzer calls and preserves chapter order", async () => {
    process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY = "3";
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-parallel-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an English language study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    let active = 0;
    let maximumActive = 0;
    const tasks: string[] = [];
    const node = createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        tasks.push(options.task);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return JSON.stringify(modelChapter(prompt));
      },
    });
    const result = await node({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
    });

    expect(result.error_log).toBeNull();
    expect(maximumActive).toBe(3);
    expect(tasks).toEqual(["content_analyzer", "content_analyzer", "content_analyzer", "content_analyzer"]);
    const content = JSON.parse(await readFile(path.join(runDir, "study-guide-content.json"), "utf8")) as StudyGuideContent;
    expect(content.topics.map((topic) => topic.title)).toEqual([
      "Unit 1",
      "Unit 2",
      "Unit 3",
      "Unit 4",
    ]);
    const exercises = content.topics.flatMap((topic) => topic.exercises);
    expect(exercises).toHaveLength(12);
    expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(12);
    expect(new Set(exercises.map((exercise) => exercise.prompt)).size).toBe(12);
    expect(exercises.every((exercise) => exercise.source.label === "Course Reader")).toBe(true);
    expect(content.topics[0].theory.formulas[0]?.expression).toBe("P = I_Bohrung − I_Welle");
  });
});

function languageHandoff(): string {
  return `## Extracted data

${JSON.stringify({
  course: { title: "LANG Academic English" },
  learning_modules: [{ content_mode: "procedural" }],
  sections: Array.from({ length: 4 }, (_, index) => ({
    heading: `Unit ${index + 1}`,
    summary: `Course evidence for unit ${index + 1}. ${"Grounded detail. ".repeat(10)}`,
    source_ids: [`reader_ch${index + 1}`],
  })),
  sources: Array.from({ length: 4 }, (_, index) => ({
    id: `reader_ch${index + 1}`,
    title: "Course Reader",
    url: `https://learn.example.edu/moodle/mod/resource/view.php?id=${index + 1}`,
  })),
  formulas: [],
})}
`;
}

function modelChapter(prompt: string): Record<string, unknown> {
  const chapter = Number(prompt.match(/Chapter\s+(\d+)\//)?.[1] ?? 1);
  const exerciseTarget = Number(prompt.match(/exactly\s+(\d+)\s+substantive exercises/i)?.[1] ?? 3);
  const calculationTarget = Number(prompt.match(/,\s*(\d+)\s+genuine calculation/i)?.[1] ?? 0);
  const applicationTarget = Number(prompt.match(/,\s*(?:and\s+)?(\d+)\s+open application/i)?.[1] ?? 0);
  const source = {
    label: "Course Reader",
    sourceTask: `Unit ${chapter}`,
    provenance: "source",
  };
  return {
    courseTitle: "LANG Academic English",
    courseCode: "LANG",
    scopeNote: `Covers Unit ${chapter}.`,
    topics: [{
      id: `unit-${chapter}`,
      title: `Unit ${chapter}`,
      learningGoals: [`Apply the communication pattern from Unit ${chapter}.`],
      theory: {
        summary: `This chapter explains the supplied communication pattern in context and connects form, purpose, and audience so learners can apply it accurately. ${"Course evidence. ".repeat(3)}`,
        keyIdeas: ["Match language to purpose.", "Use evidence from the supplied context."],
        formulas: chapter === 1
          ? [{ expression: "P = IBohrung − IWelle", meaning: "Fit from bore and shaft dimensions." }]
          : [],
      },
      workedExamples: [{
        title: `Worked response ${chapter}`,
        prompt: "How should the response be adapted for the stated audience?",
        steps: ["Identify purpose and audience.", "Choose and justify an appropriate formulation."],
        answer: "The response uses a formulation appropriate to its audience and purpose.",
        source,
      }],
      exercises: Array.from({ length: exerciseTarget }, (_, index) => {
        if (index < calculationTarget) throw new Error("This procedural fixture should not request calculations.");
        if (index < calculationTarget + applicationTarget) {
          return {
            id: "application",
            type: "application",
            prompt: "Draft an audience-appropriate response for the supplied situation.",
            instructions: ["Identify purpose and audience.", "Draft and justify the selected wording."],
            sampleAnswer: "The sample uses clear wording matched to the audience and explains why that register is suitable.",
            selfCheck: ["Purpose and audience are explicit.", "The wording is justified with course evidence."],
            source,
          };
        }
        return {
          id: "selection",
          type: "cross",
          prompt: "Which response best fits the stated communicative purpose?",
          selectionMode: "single",
          options: [
            { text: "The response matched to the stated audience.", correct: true, feedback: "Correct." },
            { text: "A response that ignores purpose.", correct: false, feedback: "Purpose matters." },
            { text: "A response in an unrelated register.", correct: false, feedback: "The register is unsuitable." },
          ],
          explanation: "The supported option matches both the stated audience and communicative purpose.",
          source: {
            ...source,
            label: chapter === 2 ? "Course Reader; Supplemental task" : source.label,
          },
        };
      }),
      retrieval: [{ prompt: "What determines register?", answer: "Purpose, audience, and context." }],
    }],
    sources: [{
      id: `reader_ch${chapter}`,
      label: "Course Reader",
      url: `https://learn.example.edu/moodle/mod/resource/view.php?id=${chapter}`,
      coverage: `Unit ${chapter}`,
    }],
  };
}
