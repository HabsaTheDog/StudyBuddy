import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("marks shortened review fields instead of presenting them as truncated source content", () => {
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

    expect(prompt).toContain("[review view shortened; full field passed deterministic validation]");
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
    expect(prompt).toContain('"(i) f_9"');
    expect(prompt).toContain("never infer a missing task or step solely because it is absent");
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
    expect(prompt).toContain('"(i) f_9"');
    expect((prompt.match(/"stepCount":/g) ?? [])).toHaveLength(20);
  });

  it("compacts a large multi-chapter review below the hard reviewer budget", () => {
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
    const prompt = buildQualityReviewPrompt(
      moodleTestConfig(),
      moodleTestState({ study_model: studyModel }),
    );
    expect(prompt.length).toBeLessThanOrEqual(
      resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - 512,
    );
    for (const chapter of courseChapters) {
      expect(prompt).toContain(chapter.title);
    }
    for (let topic = 1; topic <= 8; topic += 1) {
      expect(prompt).toContain(`Topic ${topic} – Methode`);
    }
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
