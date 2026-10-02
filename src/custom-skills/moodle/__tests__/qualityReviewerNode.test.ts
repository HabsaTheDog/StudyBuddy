import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyStudyModel } from "../examNavigatorContracts.js";
import {
  ModelCallTimeoutError,
  resolveModelPromptBodyCharacterBudget,
} from "../codexClient.js";
import {
  buildQualityReviewPrompt,
  createQualityReviewerNode,
  qualityReviewSchema,
  buildQualityReviewPackets,
} from "../nodes/qualityReviewerNode.js";
import { readPendingExtractionRepairs } from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError } from "../runtimeAbort.js";
import { RequestContractSchema } from "../../shared/requestContract.js";
import { MATHEMATICAL_INTEGRITY_POLICY } from "../studentFirstPolicy.js";
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
  const packetState = () => moodleTestState({ retry_count: 2, study_model: {
    ...emptyStudyModel(), courseChapters: [chapters[0]],
    workedExamples: Array.from({ length: 7 }, (_, i) => ({ id: `task-${i}`, chapterId: chapters[0].id,
      origin: "derived", learningGoal: `Goal ${i}`, prompt: `Unchanged givens ${i}`,
      steps: [`Complete mathematical step ${i}: ${"x".repeat(7_000)}`], result: `Complete result ${i}`, sourceIds: [],
    })),
  } });

  it("reviews bounded packets sequentially, retains more than twelve combined findings and counts one retry per round", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "review-packets-aggregate-"));
    try {
      const state = packetState();
      let calls = 0, active = 0;
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run(prompt, options) {
        expect(++active).toBe(1);
        expect(options?.attempt).toBe(3);
        expect(prompt.length).toBeLessThanOrEqual(resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - 512);
        expect(prompt).toContain("bookkeeping, not mathematical evidence");
        await Promise.resolve(); active--; calls++;
        return JSON.stringify({ ok: false, summary: `Packet ${calls}`, findings: Array.from({ length: 12 }, (_, i) => ({
          message: `Concrete contradiction packet ${calls} claim ${i}`, chapterTitle: i === 0 ? null : chapters[0].title,
          requirementId: null, deliverableId: null, owner: "content", severity: "blocking", defectKind: "mathematical_error", repairTarget: "content_analyzer",
        })) });
      } })(state);
      expect(calls).toBeGreaterThan(1);
      expect(result.retry_count).toBe(3);
      const review = JSON.parse(await readFile(path.join(runDir, "quality-review.json"), "utf8"));
      expect(review.complete_review).toBe(true);
      expect(review.blocking_findings).toHaveLength(calls * 12);
      expect(review.blocking_findings.filter((finding: { chapterTitle: string | null }) => finding.chapterTitle === null)).toHaveLength(calls);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("fails the whole round after a later packet error without leaving a partial or stale pass", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "review-packets-error-"));
    try {
      await writeFile(path.join(runDir, "quality-review.json"), '{"ok":true}');
      let calls = 0;
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run() {
        if (++calls === 2) throw new Error("Later review transport failed");
        return '{"ok":true,"summary":"First packet only","findings":[]}';
      } })(packetState());
      expect(result.error_log).toContain("Later review transport failed");
      expect(result.retry_count).toBe(3);
      expect(JSON.parse(await readFile(path.join(runDir, "quality-review.json"), "utf8"))).toMatchObject({ ok: false, complete_review: false });
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it.each(["atom", "packet_count"])("fails capacity preflight before any call for an unfit %s", async mode => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "review-packets-capacity-"));
    try {
      const state = packetState();
      if (mode === "packet_count") state.study_model.workedExamples = Array.from({ length: 19 }, (_, index) => ({ ...state.study_model.workedExamples[0], id: `capacity-${index}` }));
      for (const task of state.study_model.workedExamples) task.steps = ["Exact protected mathematical statement " + "x".repeat(mode === "atom" ? 60_000 : 22_000)];
      let calls = 0;
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), { async run() { calls++; return '{"ok":true,"summary":"pass","findings":[]}'; } })(state);
      expect(calls).toBe(0);
      expect(result.error_log).toContain(mode === "atom" ? "atom" : "18 packets");
      expect(result.retry_count).toBe(3);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("backfills complete unreferenced atoms into existing packet space before exceeding six calls", async () => {
    const config = moodleTestConfig();
    const state = packetState();
    state.study_model.workedExamples = state.study_model.workedExamples.slice(0, 6);
    for (const task of state.study_model.workedExamples) task.steps = ["Full original conditions and calculation: " + "x".repeat(20_000)];
    const last = state.study_model.workedExamples.at(-1)!;
    // Make the final packet almost full while earlier complete packets retain
    // holes. Derive this boundary from the unchanged production envelope.
    let low = 20_000, high = 45_000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      last.steps = ["x".repeat(middle)];
      try { await buildQualityReviewPackets(config, state); low = middle; }
      catch { high = middle; }
    }
    last.steps = ["x".repeat(low - 5)];
    state.study_model.checklist = Array.from({ length: 7 }, (_, i) => `Exact unreferenced condition ${i}: ${"c".repeat(35)}`);
    const packets = await buildQualityReviewPackets(config, state);
    expect(packets).toHaveLength(6);
    expect(packets.flatMap(packet => packet.claims.workedExamples)).toEqual(state.study_model.workedExamples);
    expect(packets.flatMap(packet => packet.claims.checklist)).toEqual(state.study_model.checklist);
    expect(packets[0].claims.checklist.length).toBeGreaterThan(0);
    for (const packet of packets) expect(packet.prompt.length).toBeLessThanOrEqual(resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - 512);
  });

  it("keeps null ownership and original key concepts and warnings intact", () => {
    const state = moodleTestState({ study_model: { ...emptyStudyModel(), courseChapters: [chapters[0]],
      formulas: [{ id: "global", chapterId: null, name: "Global formula", expression: "f(t) = c", variables: ["c: unknown initial value"], units: ["m/s"], assumptions: "The initial value is not determined", sourceIds: [] }],
    } });
    state.extracted_data = { document_title: "Actual handoff", language: "en", course: { title: "Course", url: "https://example.edu/course" }, sources: [],
      formulas: [], worked_examples: [], figures: [], visual_assets: [], learning_modules: [], quiz_style_questions: [], document_context: [],
      sections: [{ heading: "Original section", summary: "Actual included statement", key_concepts: Array.from({ length: 9 }, (_, i) => `Unabridged original concept ${i}`), source_ids: [] }], warnings: ["Original local condition warning"] };
    const prompt = buildQualityReviewPrompt(moodleTestConfig(), state);
    expect(prompt).toContain('"chapterId":null');
    expect(prompt).toContain("f(t) = c");
    expect(prompt).toContain("Unabridged original concept 8");
    expect(prompt).toContain("Original local condition warning");
  });

  it("reviews complete warnings and quiz claims once with explicit ownership and packet-scoped source provenance", async () => {
    const state = moodleTestState({ study_model: { ...emptyStudyModel(), courseChapters: [chapters[0]],
      warnings: Array.from({ length: 57 }, (_, i) => `${i % 3 ? `${i % 3 === 1 ? "Kapitel" : "Chapter"} «${chapters[0].title}»: ` : ""}Original complete warning ${i}: ${"w".repeat(900)}`),
      sources: [{ id: "question-source", title: "Actual question source", kind: "moodle_page", originUrl: "https://example.edu/question", localPath: null, previewPath: null },
        { id: "unused-source", title: "Uncited source", kind: "moodle_page", originUrl: "https://example.edu/unused", localPath: null, previewPath: null }],
    } });
    state.extracted_data = { document_title: "Actual", language: "en", course: { title: "Course", url: "https://example.edu/course" },
      sections: [], sources: [], formulas: [], worked_examples: [], figures: [], visual_assets: [], learning_modules: [], document_context: [], warnings: [],
      quiz_style_questions: [{ question: "Exact complete question", answer: "Full original answer", source_ids: ["question-source"] }],
    };
    const packets = await buildQualityReviewPackets(moodleTestConfig(), state);
    const views = packets.map(packet => JSON.parse(packet.prompt.split("Structured study model review view:\n")[1]));
    const warnings = views.flatMap(view => view.warnings);
    expect(warnings.map(warning => warning.message).sort()).toEqual([...state.study_model.warnings].sort());
    for (const warning of warnings) expect(warning.chapterId).toBe(warning.message.startsWith("Original") ? null : chapters[0].id);
    expect(views.flatMap(view => view.quizStyleQuestions)).toEqual(state.extracted_data.quiz_style_questions);
    for (const view of views) {
      expect(view.documentCoverage.warningCount).toBe(57);
      expect(view.documentCoverage.quizQuestionCount).toBe(1);
      expect(view.sources.some((source: { id: string }) => source.id === "unused-source")).toBe(false);
      expect(view.sources.some((source: { id: string }) => source.id === "question-source")).toBe(view.quizStyleQuestions.length > 0);
    }
  });

  it("retains source identity and URL for an original section omitted from normalized topics", () => {
    const state = moodleTestState({ study_model: { ...emptyStudyModel(), sources: [{
      id: "original-source", title: "Actual acquired source", kind: "moodle_page", originUrl: "https://example.edu/actual-source", localPath: null, previewPath: null,
    }] } });
    state.extracted_data = { document_title: "Actual", language: "en", course: { title: "Course", url: "https://example.edu/course" },
      sections: [{ heading: "Original unassigned section", summary: "Exact included source claim", key_concepts: [], source_ids: ["original-source"] }],
      sources: [{ id: "original-source", title: "Actual acquired source", kind: "moodle_page", url: "https://example.edu/actual-source", path: null, page: null }],
      formulas: [], worked_examples: [], quiz_style_questions: [{ question: "Original source question", answer: "Exact existing source answer", source_ids: ["original-source"] }], figures: [], visual_assets: [], learning_modules: [], document_context: [], warnings: [],
    };
    const view = JSON.parse(buildQualityReviewPrompt(moodleTestConfig(), state).split("Structured study model review view:\n")[1]);
    expect(view.unassignedClaims.topics[0]).toMatchObject({ chapterId: null, sourceIds: ["original-source"] });
    expect(view.sources).toEqual([expect.objectContaining({ id: "original-source", title: "Actual acquired source", originUrl: "https://example.edu/actual-source" })]);
  });

  it.each([false, true])("exposes global topic/formula coverage and checks exact operator operands in initial/repair packets (%s)", async repair => {
    const state = packetState();
    state.study_model.topics = [{ id: "whole-topic", chapterId: chapters[0].id, title: "Existing summary", summary: "Complete original explanation", learningGoals: [], sourceIds: [], priority: "essential", scopeStatus: "confirmed" }];
    state.study_model.formulas = [{ id: "whole-formula", chapterId: null, name: "Existing relation", expression: "p = q", variables: ["p and q: values"], units: ["m"], assumptions: "Original fixed basis", sourceIds: [] }];
    const packets = await buildQualityReviewPackets(moodleTestConfig(), state, repair ? "Previous concrete operand contradiction" : null);
    expect(packets.length).toBeGreaterThan(1);
    for (const packet of packets) {
      const view = JSON.parse(packet.prompt.split("Structured study model review view:\n")[1]);
      expect(view.documentCoverage).toMatchObject({ topicCount: 1, formulaCount: 1, topicIds: ["whole-topic"], formulaIds: ["whole-formula"] });
      expect(packet.prompt).toContain("Empty packet-local arrays do not mean whole-document absence");
      expect(packet.prompt).toContain("exact ordered operands, basis/index labels and source relation");
      expect(packet.prompt).toContain("Never transfer an identity for a different operand pair");
    }
  });
  it("preserves every included topic, formula condition and complete example including late steps", () => {
    const chapter = chapters[0];
    const model = {
      ...emptyStudyModel(), courseChapters: [chapter],
      topics: Array.from({ length: 18 }, (_, i) => ({ id: `topic-${i}`, chapterId: chapter.id, title: `Included topic ${i}`, summary: `Complete included claim ${i}`, priority: "essential" as const, scopeStatus: "confirmed" as const, learningGoals: [`Condition ${i}`], sourceIds: ["source-1"] })),
      formulas: Array.from({ length: 19 }, (_, i) => ({ id: `formula-${i}`, chapterId: chapter.id, name: `Included formula ${i}`, expression: `f_${i}(t) = c_${i}`, variables: [`c_${i}: unknown constant`], units: ["m/s"], assumptions: `Initial condition required ${i}`, sourceIds: ["source-1"] })),
      workedExamples: Array.from({ length: 8 }, (_, i) => ({ id: `example-${i}`, chapterId: chapter.id, origin: "derived" as const, learningGoal: `Included task ${i}`, prompt: `Given unchanged conditions ${i}`, steps: ["Compute the relation.", `Late claim ${i}: zero derivative does not determine the initial value.`], result: `Parameter family ${i}`, sourceIds: ["source-1"] })),
    };
    const prompt = buildQualityReviewPrompt(moodleTestConfig(), moodleTestState({ study_model: model }));
    for (const topic of model.topics) expect(prompt).toContain(topic.summary);
    for (const formula of model.formulas) {
      expect(prompt).toContain(formula.expression);
      expect(prompt).toContain(formula.assumptions);
    }
    for (const example of model.workedExamples) {
      expect(prompt).toContain(example.prompt);
      expect(prompt).toContain(example.steps[1]);
      expect(prompt).toContain(example.result);
    }
  });
  it.each([false, true])("independently audits semantic names and direction under unchanged givens in initial/repair review (%s)", repair => {
    const prompt = buildQualityReviewPrompt(moodleTestConfig(), moodleTestState(), repair ? "A term's interpretation contradicts its sign." : null);
    expect(prompt).toContain("Audit the meaning of included names and explanations separately from algebraic correctness");
    expect(prompt).toContain("test a simple allowed sign/direction configuration");
    expect(prompt).toContain("compare the computed behaviour with the term's defining meaning");
    expect(prompt).toContain("Where a quantitative/physical term implies sign or direction and the given assumptions permit a case");
    expect(prompt).toContain("Do not invent numeric or frame requirements for nonquantitative content");
    expect(prompt).toContain("not presentation, and is blocking even when its associated requirement is should");
    expect(prompt).toContain("Do not treat a citation or an algebraically valid expression as proof of its interpretation");
  });

  it("requires explicit defect classification and applies the shared mathematical review policy", () => {
    expect(qualityReviewSchema.properties.findings.items.required).toContain("defectKind");
    expect(buildQualityReviewPrompt(moodleTestConfig(), moodleTestState())).toContain(MATHEMATICAL_INTEGRITY_POLICY);
  });
  it("keeps an explicitly global contradiction global even when its text names another chapter", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-global-review-"));
    try {
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), {
        async run() { return JSON.stringify({ ok: false, summary: "Global contradiction", findings: [{
          message: "The global scopeNote claims Tribologie formulas are unavailable although later chapters include them.",
          chapterTitle: null, requirementId: null, deliverableId: "deliverable-1",
          owner: "content", severity: "blocking", repairTarget: "content_analyzer",
        }] }); },
      })(moodleTestState({ study_model: { ...emptyStudyModel(), courseChapters: chapters } }));

      expect(result.error_log).toContain("[scope: document]");
      expect(result.error_log).not.toContain("[chapter:");
      const review = JSON.parse(await readFile(path.join(runDir, "quality-review.json"), "utf8"));
      expect(review.blocking_findings[0].chapterTitle).toBeNull();
      expect(review.blocking_findings[0].severity).toBe("blocking");
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("shows every official topic in a grouped chapter to the quality reviewer", () => {
    const chapter = {
      ...chapters[0],
      title: "Differentialrechnung (Themen 2–5)",
      learningObjectives: [2, 3, 4, 5].map((number) =>
        `Thema ${number} – Differentialrechnung: offizieller Umfang`
      ),
    };
    const topics = [2, 3, 4, 5].map((number) => ({
      id: `topic-${number}`,
      chapterId: chapter.id,
      title: `Topic ${number} – method`,
      summary: `Substantive explanation for official topic ${number}.`,
      priority: "essential" as const,
      scopeStatus: "inferred" as const,
      learningGoals: [`Apply method ${number}.`],
      sourceIds: [],
    }));
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({
        study_model: {
          ...emptyStudyModel(),
          courseChapters: [chapter],
          topics,
        },
      }),
    );

    for (const number of [2, 3, 4, 5]) {
      expect(prompt).toContain(`Topic ${number} – method`);
    }
  });

  it("keeps repair verification on the original findings without demanding one example per topic", () => {
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({
        study_model: { ...emptyStudyModel(), courseChapters: chapters },
      }),
      "Semantic quality review failed:\n- [chapter: Toleranzen und Passungen] The lookup method is incomplete.",
    );

    expect(prompt).toContain("This is a repair verification");
    expect(prompt).toContain("Previous blocking review");
    expect(prompt).toContain("one worked example per official Moodle topic");
    expect(prompt).toContain("The lookup method is incomplete");
  });

  it("retains long mathematical fields intact instead of presenting a clipped validation marker", () => {
    const longStep = `A = (${Array.from({ length: 180 }, (_, index) => `x_${index}`).join(" + ")}) = kontrolliertes Ergebnis.`;
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({
        study_model: {
          ...emptyStudyModel(),
          courseChapters: [chapters[0]],
          workedExamples: [{
            id: "example-long",
            chapterId: chapters[0].id,
            origin: "derived",
            learningGoal: "Eine lange Gleichung vollständig prüfen",
            prompt: "Bestimme A.",
            steps: [longStep],
            result: "Die Einsetzprobe bestätigt das Ergebnis.",
            sourceIds: ["source-1"],
          }],
        },
      }),
    );

    expect(prompt).not.toContain("[review view shortened");
    expect(prompt).toContain(longStep);
    expect(prompt).toContain("kontrolliertes Ergebnis.");
  });

  it("shows every worked-example step in a coverage ledger when detailed review samples are truncated", () => {
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({
        study_model: {
          ...emptyStudyModel(),
          courseChapters: [chapters[0]],
          workedExamples: [{
            id: "example-nine-parts",
            chapterId: chapters[0].id,
            origin: "source",
            learningGoal: "Aufgabe 9: neun Teilaufgaben lösen",
            prompt: "Bestimme die Ergebnisse für f1 bis f9.",
            steps: Array.from({ length: 9 }, (_, index) =>
              `(${String.fromCharCode(97 + index)}) f_${index + 1}: Rechenweg und Begründung.`
            ),
            result: "Alle neun Teilaufgaben geprüft.",
            sourceIds: ["source-1"],
          }],
        },
      }),
    );

    expect(prompt).toContain("workedExampleCoverageLedger");
    expect(prompt).toContain('"stepCount":9');
    expect(prompt).toContain('(i) f_9: Rechenweg und Begründung.');
    expect(prompt).toContain("Never infer absent topics, formulas, examples or steps from this packet");
  });

  it("retains task and substep coverage for a twenty-task PDF within the reviewer budget", () => {
    const courseChapters = Array.from({ length: 5 }, (_, chapterIndex) => ({
      ...chapters[0],
      id: `chapter-${chapterIndex}`,
      title: `Topic ${chapterIndex + 1}`,
      learningObjectives: [`Solve every requested task in topic ${chapterIndex + 1}.`],
    }));
    const workedExamples = courseChapters.flatMap((chapter, chapterIndex) =>
      Array.from({ length: 4 }, (_, taskIndex) => ({
        id: `example-${chapterIndex}-${taskIndex}`,
        chapterId: chapter.id,
        origin: "source" as const,
        learningGoal: `${chapter.title} – Exercise ${taskIndex + 1}`,
        prompt: "Solve the supplied source exercise with all intermediate steps.",
        steps: Array.from({ length: taskIndex === 3 ? 9 : 5 }, (__, stepIndex) =>
          `(${String.fromCharCode(97 + stepIndex)}) f_${stepIndex + 1}: Derive and check this subresult.`
        ),
        result: "All requested subresults checked.",
        sourceIds: [`source-${chapterIndex}`],
      }))
    );
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({
        study_model: { ...emptyStudyModel(), courseChapters, workedExamples },
      }),
    );

    expect(prompt.length).toBeLessThanOrEqual(
      resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - 512,
    );
    expect(prompt).toContain('"stepCount":9');
    expect(prompt).toContain('(i) f_9: Derive and check this subresult.');
    expect((prompt.match(/"stepCount":/g) ?? [])).toHaveLength(20);
  });

  it("fails before any call when complete multi-chapter claims cannot fit bounded review", async () => {
    const long = "fachlich belegter Erklärungstext mit Formel, Einheit und Kontrolle ".repeat(30);
    const courseChapters = Array.from({ length: 8 }, (_, index) => ({
      id: `chapter-${index}`,
      title: `Dynamik Kapitel ${index + 1}`,
      subject: `Dynamik Kapitel ${index + 1}`,
      order: index,
      priority: "essential" as const,
      contentMode: "quantitative" as const,
      learningObjectives: Array.from({ length: 8 }, (__, topic) =>
        `Thema ${topic + 1} – Lernziel ${index + 1}: ${long}`
      ),
      assessmentSignals: Array.from({ length: 8 }, () => long),
      status: "covered" as const,
      topicIds: [`topic-${index}`],
      resourceIds: [`source-${index}`],
    }));
    const studyModel = {
      ...emptyStudyModel(),
      publicationStatus: "partial" as const,
      courseChapters,
      topics: courseChapters.flatMap((chapter, chapterIndex) =>
        Array.from({ length: 8 }, (_, topicIndex) => ({
          id: `topic-${chapterIndex}-${topicIndex}`,
          chapterId: chapter.id,
          title: `Topic ${topicIndex + 1} – Methode`,
          summary: long,
          priority: "essential" as const,
          scopeStatus: "confirmed" as const,
          learningGoals: [long, long, long, long],
          sourceIds: [`source-${chapterIndex}`],
        }))
      ),
      formulas: courseChapters.flatMap((chapter, chapterIndex) =>
        Array.from({ length: 4 }, (_, formulaIndex) => ({
          id: `formula-${chapterIndex}-${formulaIndex}`,
          chapterId: chapter.id,
          name: `Formel ${formulaIndex + 1}`,
          expression: long,
          variables: Array.from({ length: 10 }, () => long),
          units: Array.from({ length: 10 }, () => long),
          assumptions: long,
          sourceIds: [`source-${chapterIndex}`],
        }))
      ),
      workedExamples: courseChapters.flatMap((chapter, chapterIndex) =>
        Array.from({ length: 2 }, (_, exampleIndex) => ({
          id: `example-${chapterIndex}-${exampleIndex}`,
          chapterId: chapter.id,
          origin: "derived" as const,
          learningGoal: long,
          prompt: long,
          steps: Array.from({ length: 8 }, () => long),
          result: long,
          sourceIds: [`source-${chapterIndex}`],
        }))
      ),
      checklist: Array.from({ length: 12 }, () => long),
      sources: courseChapters.map((chapter, index) => ({
        id: `source-${index}`,
        title: long,
        originUrl: `https://moodle.example/course/${index}/${long}`,
        localPath: null,
        previewPath: null,
        kind: "moodle_pdf",
      })),
    };
    const state = moodleTestState({ study_model: studyModel });
    await expect(buildQualityReviewPackets(moodleTestConfig(), state)).rejects.toThrow(/Complete.*(budget|packet|review)/i);
    let calls = 0;
    const result = await createQualityReviewerNode(moodleTestConfig(), { async run() { calls++; return '{"ok":true,"summary":"pass","findings":[]}'; } })(state);
    expect(calls).toBe(0);
    expect(result.error_log).toContain("Quality reviewer failed");
    expect(result.retry_count).toBe(1);

  });

  it("reviews every structured chapter even when a generated document preview is present", () => {
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({
        final_document: `Rendered prefix without later chapters. ${"x".repeat(40_000)}`,
        study_model: {
          ...emptyStudyModel(),
          courseChapters: chapters,
        },
      }),
    );

    expect(prompt).toContain("Structured study model review view:");
    expect(prompt).toContain("Toleranzen und Passungen");
    expect(prompt).toContain("Tribologie und Viskosität");
    expect(prompt).not.toContain("Rendered prefix without later chapters.");
  });

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
                {
                  message: "Der Diagrammwert 30 widerspricht dem Textwert 40.",
                  chapterTitle: "Tribologie und Viskosität",
                  requirementId: null,
                  deliverableId: null,
                  owner: "content",
                  severity: "blocking",
                  repairTarget: "content_analyzer",
                },
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

  it("preserves requirement and deliverable ownership in blocking PDF findings", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-review-contract-"));
    try {
      const result = await createQualityReviewerNode(
        moodleTestConfig({ runDir }),
        {
          async run() {
            return JSON.stringify({
              ok: false,
              summary: "Explicit requirement missing",
              findings: [{
                message: "Die ausdrücklich verlangte Herleitung fehlt.",
                chapterTitle: "Toleranzen und Passungen",
                requirementId: "original-request",
                deliverableId: "deliverable-1",
                owner: "content",
                severity: "blocking",
                repairTarget: "content_analyzer",
              }],
            });
          },
        },
      )(moodleTestState({
        study_model: { ...emptyStudyModel(), courseChapters: chapters },
      }));

      expect(result.error_log).toContain("[requirement: original-request]");
      expect(result.error_log).toContain("[deliverable: deliverable-1]");
      expect(result.error_log).toContain("[repair: content_analyzer]");
      const review = JSON.parse(await readFile(path.join(runDir, "quality-review.json"), "utf8")) as {
        blocking_findings: Array<Record<string, unknown>>;
      };
      expect(review.blocking_findings[0]).toMatchObject({
        requirementId: "original-request",
        deliverableId: "deliverable-1",
        owner: "content",
        severity: "blocking",
        repairTarget: "content_analyzer",
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["A source figure could improve orientation.", "Die empfohlene Abbildung wurde nicht verwendet.", "requirement_gap"],
    ["Additional mathematics worked examples could broaden practice.", "Optional mathematical examples are missing; the included content is correct.", "requirement_gap"],
    ["Legacy source figure recommendation.", "Die empfohlene Abbildung wurde nicht verwendet.", undefined],
  ] as const)("keeps the should recommendation %s advisory even if the reviewer marks it blocking", async (statement, message, defectKind) => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-review-should-"));
    try {
      const baseContract = moodleTestState().request_contract;
      const requestContract = RequestContractSchema.parse({
        ...baseContract,
        requirements: [
          ...baseContract.requirements,
          {
            id: "recommended-visual",
            statement,
            origin: "evidence_derived",
            priority: "should",
            appliesTo: ["deliverable-1"],
            acceptanceCheck: "Use it only when materially useful.",
            evidenceRefs: [],
          },
        ],
      });
      const result = await createQualityReviewerNode(
        moodleTestConfig({ runDir }),
        {
          async run() {
            return JSON.stringify({
              ok: false,
              summary: "Optional visual absent",
              findings: [{
                message,
                chapterTitle: null,
                requirementId: "recommended-visual",
                deliverableId: "deliverable-1",
                owner: "visual",
                severity: "blocking",
                defectKind,
                repairTarget: "visual_pipeline",
              }],
            });
          },
        },
      )(moodleTestState({
        request_contract: requestContract,
        study_model: { ...emptyStudyModel(), courseChapters: chapters },
      }));

      expect(result).toEqual({ error_log: null });
      const review = JSON.parse(await readFile(path.join(runDir, "quality-review.json"), "utf8")) as {
        advisory_findings: Array<Record<string, unknown>>;
      };
      expect(review.advisory_findings[0]).toMatchObject({
        requirementId: "recommended-visual",
        severity: "advisory",
        defectKind: defectKind ?? null,
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["mathematical_error", "The shown 2 + 2 calculation concludes 5.", "Toleranzen und Passungen", "blocking"],
    ["factual_error", "The global scope note contradicts the included source-backed chapter content.", null, "blocking"],
    ["citation_error", "The included claim cites a source ID that does not exist.", "Tribologie und Viskosität", "advisory"],
    ["prohibition_violation", "The handoff includes an explicitly prohibited official scoring claim.", null, "advisory"],
  ] as const)("keeps concrete %s defects blocking when associated with a should requirement", async (defectKind, message, chapterTitle, severity) => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-concrete-review-"));
    try {
      const baseContract = moodleTestState().request_contract;
      const requestContract = RequestContractSchema.parse({
        ...baseContract,
        requirements: [...baseContract.requirements, {
          id: "recommended-practice",
          statement: "Source-backed worked practice can improve understanding.",
          origin: "evidence_derived", priority: "should", appliesTo: ["deliverable-1"],
          acceptanceCheck: "Include it when useful.", evidenceRefs: [],
        }],
      });
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), {
        async run() { return JSON.stringify({ ok: false, summary: "Concrete included-content defect", findings: [{
          message, chapterTitle, requirementId: "recommended-practice", deliverableId: "deliverable-1",
          owner: "content", severity, defectKind, repairTarget: "content_analyzer",
        }] }); },
      })(moodleTestState({ request_contract: requestContract, study_model: { ...emptyStudyModel(), courseChapters: chapters } }));
      expect(result.error_log).toContain(message);
      expect(result.error_log).toContain(chapterTitle ? `[chapter: ${chapterTitle}]` : "[scope: document]");
      expect(result.retry_count).toBe(1);
      const review = JSON.parse(await readFile(path.join(runDir, "quality-review.json"), "utf8"));
      expect(review.advisory_findings).toEqual([]);
      expect(review.blocking_findings).toEqual([expect.objectContaining({
        defectKind, severity: "blocking", chapterTitle, requirementId: "recommended-practice",
        deliverableId: "deliverable-1", owner: "content", repairTarget: "content_analyzer",
      })]);
      const pending = await readPendingExtractionRepairs(runDir);
      if (chapterTitle) expect(pending?.pendingChapterTitles).toEqual([chapterTitle]);
      else expect(pending).toBeNull();
    } finally { await rm(runDir, { recursive: true, force: true }); }
  });

  it("rejects unknown defect kinds without guessing from finding text", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-defect-kind-"));
    try {
      const result = await createQualityReviewerNode(moodleTestConfig({ runDir }), {
        async run() { return JSON.stringify({ ok: false, summary: "Invalid classification", findings: [{
          message: "Missing optional mathematical examples.", chapterTitle: null, requirementId: null,
          deliverableId: "deliverable-1", owner: "content", severity: "blocking",
          defectKind: "guessed_math", repairTarget: "content_analyzer",
        }] }); },
      })(moodleTestState());
      expect(result.error_log).toBe("Quality reviewer failed: Quality reviewer finding defectKind is invalid.");
    } finally { await rm(runDir, { recursive: true, force: true }); }
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
              findings: [{
                message: "Der konkrete Lernplan für die PDF fehlt.",
                chapterTitle: null,
                requirementId: null,
                deliverableId: "deliverable-1",
                owner: "technical",
                severity: "advisory",
                repairTarget: "formatter",
              }],
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
