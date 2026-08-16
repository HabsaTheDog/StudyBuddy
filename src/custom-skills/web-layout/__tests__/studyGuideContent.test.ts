import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { alignGeneratedBatchTopics, bindStudyGuideEvidenceRefs, buildEvidenceChunks, buildStudyGuideContentPrompt, createStudyGuideContentNode, normalizeSourceReferences } from "../nodes/studyGuideContentNode.js";
import { deriveStudyGuideRequirements } from "../studyGuideProfile.js";
import { initialWebLayoutState } from "../state.js";
import { minimalRequestContract } from "../../shared/requestContract.js";
import { studyGuideContentSchema, validateStudyGuideChapterQuality, validateStudyGuideContentQuality, type StudyGuideContent } from "../studyGuideContent.js";

const previousConcurrency = process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY;
const tempDirs: string[] = [];

describe("study-guide batch alignment", () => {
  it("keeps exact planned chapters in order and drops only an unsolicited extra", () => {
    const aligned = alignGeneratedBatchTopics([
      { title: "Unrequested overview" },
      { title: "Präsenz 2B: Vektorkinematik" },
      { title: "Eigenstudium 2A: Vektorkinematik" },
    ], [
      "Eigenstudium 2A: Vektorkinematik",
      "Präsenz 2B: Vektorkinematik",
    ]);

    expect(aligned).toEqual({
      topics: [
        { title: "Eigenstudium 2A: Vektorkinematik" },
        { title: "Präsenz 2B: Vektorkinematik" },
      ],
      droppedTitles: ["Unrequested overview"],
    });
  });

  it("requires selective repair when a planned chapter is missing or renamed", () => {
    expect(alignGeneratedBatchTopics([
      { title: "Vektorkinematik" },
      { title: "Unrequested overview" },
    ], [
      "Eigenstudium 2A: Vektorkinematik",
      "Präsenz 2B: Vektorkinematik",
    ])).toBeNull();
  });
});

afterEach(async () => {
  process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY = previousConcurrency;
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("study-guide canonical content bank", () => {
  it("system-binds chapter-local section indexes to the exact global extraction section", () => {
    const content = studyGuideContentSchema.parse(modelChapter("Chapter 2/4"));
    const topic = content.topics[0]!;
    const refs = [
      ...(topic.evidenceRefs ?? []),
      ...topic.exercises.flatMap((exercise) => exercise.evidenceRefs ?? []),
      ...topic.retrieval.flatMap((retrieval) => retrieval.evidenceRefs ?? []),
    ];
    refs.forEach((ref) => { ref.sectionIndex = 0; });
    const sourceText = `## Extracted data\n\n${JSON.stringify({
      sections: [
        { heading: "Unit 1", summary: "First unit evidence.", source_ids: ["reader_ch1"] },
        { heading: "Unit 2", summary: "Second unit evidence.", source_ids: ["reader_ch2"] },
      ],
    })}`;

    expect(bindStudyGuideEvidenceRefs(content, sourceText)).toBe(refs.length);
    expect(refs.every((ref) => ref.sectionIndex === 1)).toBe(true);
  });

  it("restores an exact handoff source referenced by evidence when the model source list uses an alias", () => {
    const content = studyGuideContentSchema.parse(modelChapter("Chapter 2/4"));
    content.sources = [{
      id: "model-alias",
      label: "Model alias",
      url: "",
      coverage: "Unit 2",
    }];

    bindStudyGuideEvidenceRefs(content, languageHandoff());

    expect(content.sources).toContainEqual({
      id: "reader_ch2",
      label: "Course Reader",
      url: "https://learn.example.edu/moodle/mod/resource/view.php?id=2",
      coverage: "Unit 2",
    });
  });

  it("canonicalizes a model source alias against a uniquely headed local source file", () => {
    const content = studyGuideContentSchema.parse(modelChapter("Chapter 2/4"));
    content.sources = [{
      id: "source-1",
      label: "Unit 2",
      url: "",
      coverage: "Second unit evidence",
    }];
    const refs = [
      ...(content.topics[0]!.evidenceRefs ?? []),
      ...content.topics[0]!.exercises.flatMap((exercise) => exercise.evidenceRefs ?? []),
      ...content.topics[0]!.retrieval.flatMap((retrieval) => retrieval.evidenceRefs ?? []),
    ];
    for (const ref of refs) {
      ref.sectionIndex = 0;
      ref.sourceIds = ["source-1"];
    }
    const sourceText = [
      "# User prompt",
      "Build a study guide.",
      "",
      "---",
      "",
      "# Source file: /tmp/synthetic-notes.md",
      "# Unit 2",
      "Second unit evidence.",
    ].join("\n");

    expect(bindStudyGuideEvidenceRefs(content, sourceText)).toBeGreaterThan(0);
    expect(content.sources[0]?.id).toBe("synthetic-notes");
    expect(refs.every((ref) => ref.sectionIndex === 0 && ref.sourceIds[0] === "synthetic-notes")).toBe(true);
  });

  it("does not rebind an unrelated source alias merely because a local heading matches", () => {
    const content = studyGuideContentSchema.parse(modelChapter("Chapter 2/4"));
    const ref = content.topics[0]!.evidenceRefs![0]!;
    ref.sectionIndex = 0;
    ref.sourceIds = ["remote-reader"];
    content.sources = [{
      id: "remote-reader",
      label: "Remote Reader",
      url: "https://learn.example.edu/moodle/mod/resource/view.php?id=2",
      coverage: "Unit 2",
    }];
    const sourceText = [
      "# Source file: /tmp/synthetic-notes.md",
      "# Unit 2",
      "Local evidence with the same heading.",
    ].join("\n");

    expect(bindStudyGuideEvidenceRefs(content, sourceText)).toBe(0);
    expect(ref.sourceIds).toEqual(["remote-reader"]);
    expect(content.sources[0]?.id).toBe("remote-reader");
  });

  it("rejects chapter evidence refs that use aggregate goal indexes instead of topic-local indexes", () => {
    const malformed = modelChapter("Chapter 1/12");
    const topic = (malformed.topics as Array<Record<string, unknown>>)[0]!;
    topic.learningGoals = ["Distinguish two concepts.", "Connect two motions.", "Build a simplified model."];
    topic.evidenceRefs = [{
      sourceIds: ["reader_ch1"],
      sectionIndex: 0,
      sectionHeading: "Unit 1",
      learningGoalIndexes: [0, 1, 2, 3, 4, 5],
      exactSpan: null,
    }];

    const parsed = studyGuideContentSchema.safeParse(malformed);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["topics", 0, "evidenceRefs", 0, "learningGoalIndexes", 3],
          message: expect.stringContaining("zero-based indexes into this topic's learningGoals array (length 3)"),
        }),
      ]));
    }
  });

  it("rejects generic task templates without imposing a task-count quota", () => {
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
    const findings = validateStudyGuideContentQuality(content).join("\n");
    expect(findings).toContain("Generic exercise-template prompts are not allowed");
    expect(findings).not.toContain("at least 12");
  });

  it("forces concrete source-bound exercises in the model prompt", () => {
    const prompt = buildStudyGuideContentPrompt({
      kind: "study-guide", language: "de",
    } as never, {
      source_text: "Minitest 1 Aufgabe 1",
      layout_spec: {},
      request_contract: initialWebLayoutState.request_contract,
      error_log: null,
    });
    expect(prompt).toContain("sourceTask must identify the concrete source task");
    expect(prompt).toContain("never by a fixed subject archetype, per-topic quota");
    expect(prompt).toContain("every exercise type are optional");
    expect(prompt).toContain("Do not describe layouts");
    expect(prompt).toContain("Never create learner questions asking what topics an exam contains");
    expect(prompt).toContain("preserve those technical, conceptual, writing, language, case, or calculation tasks");
    expect(prompt).toContain("Generated practice values are allowed");
    expect(prompt).toContain("navigationTitle as a concise learner-facing label");
    expect(prompt).toContain("at most 64 characters");
    expect(prompt).toContain("zero-based positions in that same topic's returned learningGoals array");
    expect(prompt).not.toContain('"$defs"');
  });

  it("normalizes chapter-title source shorthand to a concrete chapter source", () => {
    const content = {
      courseTitle: "Anwendungen der Dynamik",
      courseCode: "DYN2",
      scopeNote: "Test",
      topics: [{
        id: "punktkinematik",
        title: "Eigenstudium 1A: Punktkinematik",
        navigationTitle: "Punktkinematik",
        learningGoals: ["Punktbewegungen beschreiben."],
        theory: { summary: "x".repeat(90), keyIdeas: ["Ort", "Geschwindigkeit"], formulas: [] },
        workedExamples: [{
          title: "Beispiel",
          prompt: "Bestimme die Geschwindigkeit.",
          steps: ["Ableiten", "Einsetzen"],
          answer: "v",
          source: {
            label: "Eigenstudium 1A: Punktkinematik",
            sourceTask: "Lernpfad zu Punktkinematik und Berechnungsschritten",
            provenance: "source",
          },
        }],
        exercises: [],
        retrieval: [{ prompt: "Was ist v?", answer: "Die Ableitung des Ortes." }],
      }],
      sources: [
        { id: "course", label: "Blöcke", url: "https://moodle.example/course/view.php?id=1", coverage: "Kurs" },
        { id: "point", label: "1_Folien_Punktkinematik", url: "https://moodle.example/point.pdf", coverage: "Punktkinematik" },
        { id: "exam", label: "Musterprüfung Datei", url: "https://moodle.example/exam.pdf", coverage: "Prüfung" },
      ],
    } as StudyGuideContent;

    normalizeSourceReferences(content);

    expect(content.topics[0]?.workedExamples[0]?.source.label).toBe("1_Folien_Punktkinematik");
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
        return modelOrReviewResponse(prompt);
      },
    });
    const result = await node({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]),
    });

    expect(result.error_log).toBeNull();
    expect(maximumActive).toBe(3);
    expect(tasks.filter((task) => task === "content_analyzer")).toHaveLength(5);
    expect(tasks.filter((task) => task === "quality_reviewer")).toHaveLength(2);
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

    const repairTasks: string[] = [];
    const repairAttempts: number[] = [];
    const repairNode = createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (options.task !== "quality_reviewer") {
          repairTasks.push(options.task);
          repairAttempts.push(options.attempt ?? -1);
        }
        return modelOrReviewResponse(prompt);
      },
    });
    const repaired = await repairNode({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]),
      error_log: "chunk 2 needs repair",
    });

    expect(repaired.error_log).toBeNull();
    expect(repairTasks).toEqual(["content_repair"]);
    expect(repairAttempts).toEqual([1]);
    const repairedContent = JSON.parse(await readFile(path.join(runDir, "study-guide-content.json"), "utf8")) as StudyGuideContent;
    expect(repairedContent.topics.map((topic) => topic.title)).toEqual([
      "Unit 1",
      "Unit 2",
      "Unit 3",
      "Unit 4",
    ]);
  });

  it("regenerates a cached chapter whose item fails chapter-local quality before aggregate retries are spent", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-local-quality-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an English language study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    const requestContract = minimalRequestContract(config.originalUserPrompt, [config.kind]);
    const state = {
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: requestContract,
    };
    const first = await createStudyGuideContentNode(config, {
      run: async (prompt) => modelOrReviewResponse(prompt),
    })(state);
    expect(first.error_log).toBeNull();

    const chunkPath = path.join(runDir, "study-guide-content-chunk-2.json");
    const cached = JSON.parse(await readFile(chunkPath, "utf8")) as StudyGuideContent;
    const topic = cached.topics[0]!;
    topic.exercises = [{
      id: "vocab-purpose",
      type: "vocabulary",
      prompt: "What does purpose mean?",
      direction: "term-to-meaning",
      term: "Purpose",
      acceptedAnswers: ["Purpose"],
      context: "Purpose guides the response.",
      explanation: "Purpose identifies the intended communicative outcome.",
      source: { label: "Course Reader", sourceTask: "Unit 2", provenance: "source" },
      evidenceRefs: topic.evidenceRefs,
    }];
    await writeFile(chunkPath, `${JSON.stringify(cached, null, 2)}\n`, "utf8");

    const contentPrompts: string[] = [];
    const second = await createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (options.task === "content_analyzer") contentPrompts.push(prompt);
        return modelOrReviewResponse(prompt);
      },
    })(state);

    expect(second.error_log).toBeNull();
    expect(contentPrompts).toHaveLength(1);
    expect(contentPrompts[0]).toContain("Chapter 2/4");
    expect(contentPrompts[0]).toContain("self-contained on its visible learner card");
    expect(contentPrompts[0]).toContain("estimatedMinutes");
    expect(contentPrompts[0]).toContain("One item per objective is not automatically sufficient");
    const repaired = JSON.parse(await readFile(chunkPath, "utf8")) as StudyGuideContent;
    expect(validateStudyGuideChapterQuality(repaired)).toEqual([]);
  });

  it("does not regenerate chapters for item-local review diagnostics", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-item-local-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an English language study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    const requestContract = minimalRequestContract(config.originalUserPrompt, [config.kind]);
    const initial = await createStudyGuideContentNode(config, {
      run: async (prompt) => modelOrReviewResponse(prompt),
    })({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: requestContract,
    });
    expect(initial.error_log).toBeNull();

    const repairedChapters: number[] = [];
    const errorLog = [
      "Study-guide content builder failed: Question-bank item review failed:",
      "- [item question-chapter-7; exercise unit-2-selection; hash abc] The answer is not present in the validated Moodle handoff. Repair only this item.",
      "- [item question-chapter-11; exercise unit-4-selection-2; hash def] The explanation is inconsistent. Repair only this item.",
    ].join("\n");
    const repaired = await createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (options.task === "content_repair") {
          repairedChapters.push(Number(prompt.match(/Chapter\s+(\d+)\//)?.[1] ?? 0));
        }
        return modelOrReviewResponse(prompt);
      },
    })({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: requestContract,
      error_log: errorLog,
      content_retry_count: 1,
    });

    expect(repaired.error_log).toBeNull();
    expect(repairedChapters).toEqual([]);
  });

  it("repairs one rejected item and reviews only its new hash without chapter repair", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-exact-item-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Build an English language study guide", kind: "study-guide", language: "en", runDir });
    const reviewedBatches: Array<Array<{ itemId: string; contentHash: string }>> = [];
    let rejected = false;
    let repairedItemId = "";
    let rejectedHash = "";
    let itemRepairCalls = 0;
    let chapterRepairCalls = 0;
    let assessmentPlanCalls = 0;
    let progressionCalls = 0;
    const result = await createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (prompt.includes("ASSESSMENT_ARCHITECTURE_PLANNER")) assessmentPlanCalls += 1;
        if (prompt.includes("LEARNING_PROGRESSION_PLANNER")) progressionCalls += 1;
        if (prompt.includes("QUESTION_BANK_ITEM_LOCAL_REPAIR")) {
          itemRepairCalls += 1;
          const targets = [...prompt.matchAll(/Repair target:\n([^\n]+)/g)].map((match) =>
            (JSON.parse(match[1]!) as { item: { id: string; contentHash: string; exercise: Record<string, unknown> } }).item
          );
          if (targets.length === 0) throw new Error("Missing rejected item payload.");
          return JSON.stringify({ repairs: targets.map((item) => ({
            itemId: item.id, previousContentHash: item.contentHash,
            exercise: item.exercise.type === "application"
              ? { ...item.exercise, sampleAnswer: `${String(item.exercise.sampleAnswer)} Repaired with an explicit evidence-grounded justification.` }
              : { ...item.exercise, explanation: `${String(item.exercise.explanation)} Repaired with an explicit evidence-grounded distinction.` },
          })) });
        }
        if (prompt.includes("QUESTION_BANK_ITEM_REVIEWER")) {
          const itemsMatch = /Items to review:\n(\[[\s\S]*?\])\n\nComplete item-local evidence capsules:/.exec(prompt);
          if (!itemsMatch) throw new Error("Malformed review prompt.");
          const items = JSON.parse(itemsMatch[1]) as Array<{ itemId: string; contentHash: string; exercise: { type: string } }>;
          reviewedBatches.push(items);
          const rejectIndex = rejected ? -1 : 0;
          return JSON.stringify({ records: items.map((item, index) => {
            const reject = !rejected && index === rejectIndex;
            if (reject) {
              rejected = true;
              repairedItemId = item.itemId;
              rejectedHash = item.contentHash;
            }
            return {
              itemId: item.itemId, contentHash: item.contentHash,
              verdict: reject ? "rejected" : "approved",
              checks: { schema: true, scope: true, answer: !reject, provenance: true, rendering: true, selfContained: true, feedback: true },
              findings: reject ? [{ code: "answer", severity: "blocking", message: "The explanation is incomplete.", repairInstruction: "Repair only this explanation." }] : [],
            };
          }) });
        }
        if (options.task === "content_repair") chapterRepairCalls += 1;
        if (options.task === "content_analyzer" && /Chapter\s+1\//.test(prompt)) {
          const chapter = modelChapter(prompt) as { topics: Array<{ exercises: unknown[]; retrieval: unknown[] }> };
          chapter.topics[0]!.exercises = chapter.topics[0]!.exercises.slice(0, 1);
          chapter.topics[0]!.retrieval = [];
          return JSON.stringify(chapter);
        }
        return modelOrReviewResponse(prompt);
      },
    })({ ...initialWebLayoutState, source_text: languageHandoff(), request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]) });

    expect(result.error_log).toBeNull();
    expect(itemRepairCalls).toBe(1);
    expect(chapterRepairCalls).toBe(0);
    expect(assessmentPlanCalls).toBe(1);
    expect(progressionCalls).toBe(2);
    expect(reviewedBatches.at(-1)).toHaveLength(1);
    expect(reviewedBatches.at(-1)?.[0]?.itemId).toBe(repairedItemId);
    expect(reviewedBatches.at(-1)?.[0]?.contentHash).not.toBe(rejectedHash);
    const unchanged = reviewedBatches[0]!.find((item) => item.itemId !== repairedItemId)!;
    const finalItems = (result.question_bank as { items: Array<{ id: string; contentHash: string; review: { record?: { contentHash: string } } }> }).items;
    expect(finalItems.find((item) => item.id === unchanged.itemId)?.contentHash).toBe(unchanged.contentHash);
    expect(finalItems.find((item) => item.id === unchanged.itemId)?.review.record?.contentHash).toBe(unchanged.contentHash);
  });

  it("rejects a model-authored evidence-unavailable verdict and retries the same review batch", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-capsule-rebuild-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Build evidence-grounded interactive practice", kind: "study-guide", language: "en", runDir });
    let unavailableId = "";
    let unavailableHash = "";
    let returnedUnavailable = false;
    const reviewedBatches: Array<Array<{ itemId: string; contentHash: string }>> = [];
    let contentRepairCalls = 0;
    const result = await createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (prompt.includes("QUESTION_BANK_ITEM_REVIEWER")) {
          const match = /Items to review:\n(\[[\s\S]*?\])\n\nComplete item-local evidence capsules:/.exec(prompt);
          if (!match) throw new Error("Malformed capsule review prompt.");
          const items = JSON.parse(match[1]) as Array<{ itemId: string; contentHash: string }>;
          reviewedBatches.push(items);
          return JSON.stringify({ records: items.map((item, index) => {
            const unavailable = !returnedUnavailable && index === 0;
            if (unavailable) {
              returnedUnavailable = true;
              unavailableId = item.itemId;
              unavailableHash = item.contentHash;
            }
            return {
              itemId: item.itemId, contentHash: item.contentHash,
              verdict: unavailable ? "evidence_unavailable" : "approved",
              checks: unavailable
                ? { schema: false, scope: false, answer: false, provenance: false, rendering: false, selfContained: false, feedback: false }
                : { schema: true, scope: true, answer: true, provenance: true, rendering: true, selfContained: true, feedback: true },
              findings: unavailable ? [{ code: "evidence-unavailable", severity: "blocking", message: "Capsule could not establish the cited claim.", repairInstruction: "Rebuild the unchanged item capsule." }] : [],
            };
          }) });
        }
        if (options.task === "content_repair") contentRepairCalls += 1;
        return modelOrReviewResponse(prompt);
      },
    })({ ...initialWebLayoutState, source_text: languageHandoff(), request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]) });

    expect(result.error_log).toBeNull();
    expect(unavailableId).not.toBe("");
    expect(unavailableHash).not.toBe("");
    const batchesContainingRejectedVerdict = reviewedBatches.filter((batch) =>
      batch.some((item) => item.itemId === unavailableId && item.contentHash === unavailableHash)
    );
    expect(batchesContainingRejectedVerdict).toHaveLength(2);
    expect(batchesContainingRejectedVerdict[1]).toEqual(batchesContainingRejectedVerdict[0]);
    expect(contentRepairCalls).toBe(0);
    await expect(readFile(path.join(runDir, "question-bank-evidence-diagnostics.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("drops ordinary inferred-practice renderer-type rejects when objectives survive", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-nine-item-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Build broad adaptive English practice", kind: "study-guide", language: "en", runDir });
    const rejectedHashes = new Map<string, string>();
    const rereviewed: Array<{ itemId: string; contentHash: string }> = [];
    let repairCalls = 0;
    let activeRepairs = 0;
    let maxActiveRepairs = 0;
    let progressionCalls = 0;
    let assessmentCalls = 0;
    let chapterRepairCalls = 0;
    const result = await createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (prompt.includes("ASSESSMENT_ARCHITECTURE_PLANNER")) assessmentCalls += 1;
        if (prompt.includes("LEARNING_PROGRESSION_PLANNER")) progressionCalls += 1;
        if (prompt.includes("QUESTION_BANK_ITEM_LOCAL_REPAIR")) {
          repairCalls += 1;
          activeRepairs += 1;
          maxActiveRepairs = Math.max(maxActiveRepairs, activeRepairs);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeRepairs -= 1;
          const targets = [...prompt.matchAll(/Repair target:\n([^\n]+)/g)].map((match) =>
            (JSON.parse(match[1]!) as { item: { id: string; contentHash: string; exercise: Record<string, unknown> } }).item
          );
          return JSON.stringify({ repairs: targets.map((item) => ({
            itemId: item.id, previousContentHash: item.contentHash,
            exercise: { ...item.exercise, sampleAnswer: `${String(item.exercise.sampleAnswer)} Complete repaired justification.` },
          })) });
        }
        if (prompt.includes("QUESTION_BANK_ITEM_REVIEWER")) {
          const match = /Items to review:\n(\[[\s\S]*?\])\n\nComplete item-local evidence capsules:/.exec(prompt);
          if (!match) throw new Error("Malformed review prompt.");
          const items = JSON.parse(match[1]) as Array<{ itemId: string; contentHash: string; exercise: { type: string } }>;
          return JSON.stringify({ records: items.map((item) => {
            const original = item.exercise.type === "application" && !rejectedHashes.has(item.itemId);
            if (original) rejectedHashes.set(item.itemId, item.contentHash);
            else if (rejectedHashes.has(item.itemId) && rejectedHashes.get(item.itemId) !== item.contentHash) rereviewed.push(item);
            return {
              itemId: item.itemId, contentHash: item.contentHash, verdict: original ? "rejected" : "approved",
              checks: { schema: true, scope: true, answer: !original, provenance: true, rendering: true, selfContained: true, feedback: true },
              findings: original ? [{ code: "answer", severity: "blocking", message: "Incomplete.", repairInstruction: "Complete only this answer." }] : [],
            };
          }) });
        }
        if (options.task === "content_repair") chapterRepairCalls += 1;
        return modelOrReviewResponse(prompt);
      },
    })({ ...initialWebLayoutState, source_text: languageHandoff(9), request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]) });

    expect(result.error_log).toBeNull();
    expect(rejectedHashes.size).toBe(9);
    expect(repairCalls).toBe(0);
    expect(maxActiveRepairs).toBeLessThanOrEqual(3);
    expect(progressionCalls).toBe(1);
    expect(assessmentCalls).toBe(1);
    expect(rereviewed).toHaveLength(0);
    expect(chapterRepairCalls).toBe(0);
  });

  it("settles sibling batches and retries only the failed chapter", async () => {
    process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY = "3";
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-targeted-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an English language study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    const firstPassChapters: number[] = [];
    const firstNode = createStudyGuideContentNode(config, {
      run: async (prompt) => {
        const chapter = Number(prompt.match(/Chapter\s+(\d+)\//)?.[1] ?? 1);
        firstPassChapters.push(chapter);
        if (chapter === 2) throw new Error("chunk 2 failed validation");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return JSON.stringify(modelChapter(prompt));
      },
    });
    const failed = await firstNode({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]),
    });

    expect(failed.error_log).toContain("chunk 2 failed validation");
    expect(firstPassChapters.sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
    expect(await readFile(path.join(runDir, "study-guide-content-chunk-1.json"), "utf8")).toContain("Unit 1");
    expect(await readFile(path.join(runDir, "study-guide-content-chunk-3.json"), "utf8")).toContain("Unit 3");
    expect(await readFile(path.join(runDir, "study-guide-content-chunk-4.json"), "utf8")).toContain("Unit 4");

    const repairChapters: number[] = [];
    const repairAttempts: number[] = [];
    const repairNode = createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (options.task === "content_repair") {
          repairChapters.push(Number(prompt.match(/Chapter\s+(\d+)\//)?.[1] ?? 1));
          repairAttempts.push(options.attempt ?? -1);
        }
        return modelOrReviewResponse(prompt);
      },
    });
    const repaired = await repairNode({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]),
      error_log: failed.error_log ?? null,
      content_retry_count: failed.content_retry_count ?? 1,
    });

    expect(repaired.error_log).toBeNull();
    expect(repairChapters).toEqual([2]);
    expect(repairAttempts).toEqual([1]);

    const timeoutFallback = await createStudyGuideContentNode(config, {
      run: async (prompt) => {
        if (prompt.includes("QUESTION_BANK_ITEM_REVIEWER")) return modelOrReviewResponse(prompt);
        throw new Error("content_repair model call timed out after 180000ms");
      },
    })({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]),
      error_log: "chunk 2 needs repair",
      content_retry_count: 1,
    });
    expect(timeoutFallback.error_log).toContain("timed out");
    const partialContent = JSON.parse(
      await readFile(path.join(runDir, "study-guide-content.json"), "utf8"),
    ) as StudyGuideContent;
    expect(partialContent.scopeNote).not.toContain("[partial-repair-timeout]");
  });

  it("repairs every missing chapter in one bounded graph pass", async () => {
    process.env.STUDY_BUDDY_WEB_CONTENT_CONCURRENCY = "3";
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-content-all-missing-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an English language study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    const repairChapters: number[] = [];
    const result = await createStudyGuideContentNode(config, {
      run: async (prompt, options) => {
        if (options.task === "content_repair" && prompt.includes("Chapter")) {
          repairChapters.push(Number(prompt.match(/Chapter\s+(\d+)\//)?.[1] ?? 1));
        }
        return modelOrReviewResponse(prompt);
      },
    })({
      ...initialWebLayoutState,
      source_text: languageHandoff(),
      request_contract: minimalRequestContract(config.originalUserPrompt, [config.kind]),
      error_log: "The previous pass did not produce complete chapter files.",
      content_retry_count: 1,
    });

    expect(result.error_log).toBeNull();
    expect(repairChapters.sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
  });

  it("keeps explicit learning modules separate when they share a Moodle course-page source", () => {
    const source = `## Extracted data

${JSON.stringify({
  course: { title: "BMR Business English" },
  learning_modules: [
    { id: "unit-a", title: "Self-Study A + Class 1", content_mode: "procedural" },
    { id: "unit-b", title: "Self-Study B + Class 2", content_mode: "procedural" },
  ],
  sections: [
    { heading: "Self-Study A + Class 1", summary: "Business forms and investor vocabulary.", source_ids: ["course_page"] },
    { heading: "Self-Study B + Class 2", summary: "Diplomatic meeting language and summarising.", source_ids: ["course_page"] },
  ],
  sources: [{ id: "course_page", title: "Moodle course page", url: "https://learn.example.edu/course/view.php?id=1" }],
})}`;
    const chunks = buildEvidenceChunks(source, deriveStudyGuideRequirements(source));

    expect(chunks.map((chunk) => chunk.title)).toEqual([
      "Self-Study A + Class 1",
      "Self-Study B + Class 2",
    ]);
  });
});

function languageHandoff(unitCount = 4): string {
  return `## Extracted data

${JSON.stringify({
  course: { title: "LANG Academic English" },
  learning_modules: [{ content_mode: "procedural" }],
  sections: Array.from({ length: unitCount }, (_, index) => ({
    heading: `Unit ${index + 1}`,
    summary: `Course evidence for unit ${index + 1}. ${"Grounded detail. ".repeat(10)}`,
    source_ids: [`reader_ch${index + 1}`],
  })),
  sources: Array.from({ length: unitCount }, (_, index) => ({
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
  const evidenceRefs = [{
    sourceIds: [`reader_ch${chapter}`],
    sectionIndex: chapter - 1,
    sectionHeading: `Unit ${chapter}`,
    learningGoalIndexes: [0],
    exactSpan: null,
  }];
  return {
    courseTitle: "LANG Academic English",
    courseCode: "LANG",
    scopeNote: `Covers Unit ${chapter}.`,
    topics: [{
      id: `unit-${chapter}`,
      title: `Unit ${chapter}`,
      navigationTitle: `Unit ${chapter}`,
      evidenceRefs,
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
            evidenceRefs,
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
          evidenceRefs,
        };
      }),
      retrieval: [{ prompt: "What determines register?", answer: "Purpose, audience, and context.", evidenceRefs }],
    }],
    sources: [{
      id: `reader_ch${chapter}`,
      label: "Course Reader",
      url: `https://learn.example.edu/moodle/mod/resource/view.php?id=${chapter}`,
      coverage: `Unit ${chapter}`,
    }],
  };
}

function modelOrReviewResponse(prompt: string): string {
  if (prompt.includes("ASSESSMENT_ARCHITECTURE_PLANNER")) {
    return JSON.stringify({
      title: "No documented assessment architecture",
      mode: "none",
      confidence: "low",
      durationMinutes: null,
      maxPoints: null,
      passingPoints: null,
      allowedAids: [],
      prohibitedAids: [],
      basisRequirementIds: [],
      rationale: "The supplied evidence does not document an assessment structure.",
      sections: [],
    });
  }
  if (prompt.includes("LEARNING_PROGRESSION_PLANNER")) {
    const itemsMatch = /Validated items:\n(\[[\s\S]*?\])\n\nEvidence excerpt:/.exec(prompt);
    if (!itemsMatch) throw new Error("Malformed progression prompt.");
    const items = JSON.parse(itemsMatch[1]) as Array<[
      itemNumber: number,
    ]>;
    return JSON.stringify({
      schemaVersion: 2,
      stages: [{
        label: "Course practice",
        description: "Evidence-bound practice for the requested guide.",
        intent: "application",
      }],
      placements: items.map((item) => ({
        itemNumber: item[0],
        stageNumber: 1,
        difficulty: "standard",
        evidenceReason: "The evaluated request asks for interactive course practice.",
      })),
    });
  }
  if (!prompt.includes("QUESTION_BANK_ITEM_REVIEWER")) {
    return JSON.stringify(modelChapter(prompt));
  }
  const contextMatch = /Contract reference:\n(\{[^\n]+\})/.exec(prompt);
  const itemsMatch = /Items to review:\n(\[[\s\S]*?\])\n\nComplete item-local evidence capsules:/.exec(prompt);
  if (!contextMatch || !itemsMatch) throw new Error("Malformed question review prompt.");
  const items = JSON.parse(itemsMatch[1]) as Array<{ itemId: string; contentHash: string }>;
  return JSON.stringify({
    records: items.map((item) => ({
      itemId: item.itemId,
      contentHash: item.contentHash,
      verdict: "approved",
      checks: { schema: true, scope: true, answer: true, provenance: true, rendering: true, selfContained: true, feedback: true },
      findings: [],
    })),
  });
}
