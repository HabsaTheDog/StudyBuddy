import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildAdaptiveStudyModel,
  type AdaptiveStudyModel,
} from "../adaptiveStudyModel.js";
import { renderAdaptiveStudyGuide } from "../adaptiveStudyGuideRenderer.js";
import type { AssessmentArchitecturePlan } from "../assessmentArchitecturePlan.js";
import { STUDY_BUDDY_HTML_TOKENS } from "../designGuidelines.js";
import { questionBankItemReviewRecordId } from "../questionBankReview.js";
import type { StudyGuideContent } from "../studyGuideContent.js";
import { approveQuestionBankForRendering } from "./fixtures/approvedQuestionBank.js";

describe("adaptive study-guide renderer contracts", () => {
  it("fails closed for pending, rejected, stale, or tampered item review records", () => {
    const pending = fixture();
    pending.model.questionBank.items[0]!.review = {
      status: "pending",
      checks: { schema: false, scope: false, answer: false, provenance: false, rendering: false },
      findings: [],
    };
    expect(() => renderAdaptiveStudyGuide(pending.content, pending.model, "en"))
      .toThrow(/review is not approved/i);

    const rejected = fixture();
    const rejectedReview = rejected.model.questionBank.items[0]!.review;
    if (rejectedReview.status !== "approved") throw new Error("Expected approved fixture review.");
    rejectedReview.record.reviewer.verdict = "rejected";
    rejectedReview.record.recordId = questionBankItemReviewRecordId(rejectedReview.record);
    expect(() => renderAdaptiveStudyGuide(rejected.content, rejected.model, "en"))
      .toThrow(/verdict is not publishable/i);

    const stale = fixture();
    const staleReview = stale.model.questionBank.items[0]!.review;
    if (staleReview.status !== "approved") throw new Error("Expected approved fixture review.");
    staleReview.record.contentHash = "f".repeat(64);
    staleReview.record.recordId = questionBankItemReviewRecordId(staleReview.record);
    expect(() => renderAdaptiveStudyGuide(stale.content, stale.model, "en"))
      .toThrow(/record is stale/i);

    const tampered = fixture();
    const tamperedReview = tampered.model.questionBank.items[0]!.review;
    if (tamperedReview.status !== "approved") throw new Error("Expected approved fixture review.");
    tamperedReview.record.findings.push({
      code: "tampered",
      severity: "advisory",
      message: "This record was changed after sealing.",
      repairInstruction: "Restore the sealed record.",
    });
    tamperedReview.findings.push("This record was changed after sealing.");
    expect(() => renderAdaptiveStudyGuide(tampered.content, tampered.model, "en"))
      .toThrow(/seal is invalid/i);

    const changedContent = fixture();
    changedContent.model.questionBank.items[0]!.exercise.prompt += " Changed after review.";
    expect(() => renderAdaptiveStudyGuide(changedContent.content, changedContent.model, "en"))
      .toThrow(/content does not match its reviewed content hash/i);
  });

  it("renders an item carrying an exact internally consistent independent review record", () => {
    const { content, model } = fixture();
    expect(renderAdaptiveStudyGuide(content, model, "en")).toContain("data-sb-practice");
  });

  it("omits the assessment tab and surface when the verified architecture mode is none", () => {
    const { content } = fixture();
    const model = approveQuestionBankForRendering(buildAdaptiveStudyModel(content, "Course material only.", "en"));
    const html = renderAdaptiveStudyGuide(content, model, "en");
    expect(model.assessmentBlueprint.mode).toBe("none");
    expect(html).not.toContain('data-main-tab="exam"');
    expect(html).not.toContain('data-main-panel="exam"');
    expect(html).not.toMatch(/<button[^>]+data-start-assessment/);
    expect(html).toContain("Learn along the actual course topics and practise selectively in the question catalogue.");
  });

  it("exposes required semantic containers and type-specific exercise markers", () => {
    const { content, model } = fixture();
    const html = renderAdaptiveStudyGuide(content, model, "en");

    for (const marker of [
      "data-sb-hotbar",
      "data-sb-course-map",
      "data-sb-learning-content",
      "data-sb-practice",
      "data-sb-progress",
      "data-sb-sources",
      "data-sb-cross-exercise",
      "data-sb-calculation-exercise",
      "data-sb-application-exercise",
      "data-application-draft",
      'data-main-tab="topics"',
      'data-main-tab="catalog"',
      'data-main-tab="exam"',
      'data-main-panel="topics"',
      'data-main-panel="catalog"',
      'data-main-panel="exam"',
      "data-progress-ring",
      "data-topic-question-host",
      "data-topic-question-index",
    ]) {
      expect(html).toContain(marker);
    }
    for (const [token, value] of Object.entries(STUDY_BUDDY_HTML_TOKENS)) {
      expect(html).toContain(`${token}: ${value};`);
    }
    expect(html).toContain('data-learning-visual="module"');
    expect(html).toContain('data-learning-visual="question"');
    expect(html).toContain("The task statement remains available below as searchable text.");
    expect(html).not.toContain("assessment-task-sheet__viewport");
  });

  it("persists only compact learner state and keeps correctness separate from mastery", () => {
    const { content, model } = fixture();
    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain("study-buddy:study-builder:v1:");
    expect(html).toContain("const empty=()=>({schemaVersion:SCHEMA_VERSION,questions:{}})");
    expect(html).not.toContain("bankRevision:");
    expect(html).not.toContain("state.session");
    expect(html).not.toContain("state.exam");
    expect(html).not.toContain("startedAt");
    expect(html).not.toContain("endsAt");
    expect(html).toContain("if(ok)delete qs.review;else{qs.review=true;delete qs.learned}");
    expect(html).not.toContain("if(ok)qs.learned");
    expect(html).toContain("if(next)qs[key]=true;else delete qs[key]");
    expect(html).toContain("selected.length?JSON.stringify(selected):''");
    expect(html).toContain("localStorage.removeItem(KEY);state=empty();applyFilters(false)");
    expect(html).toContain("delete state.questions[item.id];save();applyFilters(false)");
    expect(html).toContain("let catalogSession=");
    expect(html).toContain("let topicSession=");
    expect(html).toContain("let activeView='topics'");
  });

  it("presents one useful course summary and three distinct learning workspaces", () => {
    const { content, model } = fixture();
    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain(`<dt>Questions</dt><dd>${model.questionBank.items.length}</dd>`);
    expect(html).toContain(`<dt>Topics</dt><dd>${content.topics.length}</dd>`);
    expect(html).toContain("data-progress-percent");
    expect(html).toContain("conic-gradient(var(--gold) var(--progress)");
    expect(html.match(/data-main-tab="/g)).toHaveLength(3);
    expect(html.match(/data-main-panel="/g)).toHaveLength(3);
    expect(html).toContain("if(view==='catalog')renderCatalog(true)");
    expect(html).toContain("setTopicSession(id,true,true)");
    expect(html).toContain("BANK.items.filter(item=>item.topicId===topicId)");
    expect(html).toContain("selectMainView('catalog',true);setFilters({topic:topicSession.topicId},false)");
    expect(html).toContain("tabs.getBoundingClientRect().top-(hotbar?.offsetHeight||0)-12");
    expect(html).toContain("behavior:'instant'");
  });

  it("styles only the direct answer marker and leaves nested inline math unconstrained", () => {
    const { content, model } = fixture();
    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain(".answer-options label>span{display:grid");
    expect(html).not.toContain(".answer-options label span{display:grid");
  });

  it("wraps unbroken source labels instead of widening tablet layouts", () => {
    const { content, model } = fixture();
    content.sources[0]!.label = "2_Beispiel_Kopplung_Scheibe_Stab";
    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain(
      ".source-card strong,.source-card p,.source-card a{overflow-wrap:anywhere;word-break:break-word}",
    );
    expect(html).toContain("2_Beispiel_Kopplung_Scheibe_Stab");
  });

  it("shows grouped Moodle subtopics without creating duplicate learning workspaces", () => {
    const { content, model } = fixture();
    model.courseBlueprint.modules[0]!.title = "Topics 2–5";
    model.courseBlueprint.modules[0]!.displayTitle = "Topics 2–5";
    model.courseBlueprint.modules[0]!.subtopics = [
      "Topic 2 – Limits",
      "Topic 3 – Derivatives",
      "Topic 4 – Taylor series",
      "Topic 5 – Extrema",
    ];

    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain("<strong>Topics 2–5</strong>");
    expect(html).toContain("data-course-subtopics");
    for (const subtopic of model.courseBlueprint.modules[0]!.subtopics) {
      expect(html).toContain(`<li>${subtopic}</li>`);
    }
    expect(html.match(/data-main-panel="/g)).toHaveLength(3);
  });

  it("switches long course titles to a readable rail with concise labels and full-title access", () => {
    const { content, model } = fixture();
    const fullTitle = "Self-Study D: Financial Reports and Expressions; The Presentation of Data and Trends + Class 4: The Presentation of Data; The Business Plan";
    model.courseBlueprint.modules[0]!.title = fullTitle;
    model.courseBlueprint.modules[0]!.displayTitle = "Financial Reports & Expressions · Data & Trends · Business Plan";

    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain('data-module-title-layout="rail"');
    expect(html).toContain("<strong>Financial Reports &amp; Expressions · Data &amp; Trends · Business Plan</strong>");
    expect(html).toContain(`title="${fullTitle.replaceAll("&", "&amp;")}"`);
    expect(html).toContain("Full course title");
    expect(html).toContain("grid-auto-columns:minmax(220px,270px)");
    expect(html).toContain('grid-auto-columns:min(78vw,270px)');
  });

  it("uses combinable topic, stage, and status filters without an unseen category", () => {
    const { content, model } = fixture();
    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain("data-filter-topic");
    expect(html).toContain("data-filter-stage");
    expect(html).toContain("data-filter-status");
    expect(html).toContain("filters.topic!=='all'&&item.topicId!==filters.topic");
    expect(html).toContain("filters.stage!=='all'&&String(item.stageIndex)!==filters.stage");
    expect(html).toContain("filters.status==='continue'&&qs?.learned===true");
    expect(html).not.toContain('value="unseen"');
    expect(html).not.toContain("data-count-unseen");
  });

  it("starts a separate ephemeral exam surface without duplicating the embedded question bank", () => {
    const { content, model } = fixture();
    const html = renderAdaptiveStudyGuide(content, model, "en");
    const composition = embeddedJson<{
      sectionItemIds: Array<{ id: string; itemIds: string[] }>;
      scoringSections: Array<{
        id: string;
        title: string;
        points: number | null;
        itemIds: string[];
      }>;
      examItemIds: string[];
      support: string;
    }>(html, "assessment-composition");
    const selectedIds = composition.sectionItemIds.flatMap((section) => section.itemIds);

    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    expect(selectedIds.length).toBeGreaterThan(0);
    expect(html).toContain("data-exam-shell");
    expect(html).toContain("data-exam-question");
    expect(html).toContain("data-exam-next");
    expect(html).toContain("data-exam-finish hidden");
    expect(html).toContain("document.querySelector('[data-exam-next]').hidden=last");
    expect(html).toContain("document.querySelector('[data-exam-finish]').hidden=!last");
    expect(html).not.toContain("data-exam-save");
    expect(html).not.toContain("Save answer & continue");
    expect(html).toContain("const ids=[...new Set(COMPOSITION.examItemIds||[])]");
    expect(html).toContain("let examSession=");
    expect(html).not.toContain("Date.now()");
    expect(html).not.toContain("state.exam");
    expect(composition.examItemIds).toEqual(selectedIds);
    expect(composition.scoringSections.flatMap((section) => section.itemIds))
      .toEqual(selectedIds);
    expect(composition.support).toMatch(/supported|partial|insufficient/);
    expect(html.match(/id="question-bank"/g)).toHaveLength(1);
    expect(html).toContain("data-exam-review-item");
    expect(html).toContain("data-exam-score");
    expect(html).toContain("data-exam-rate");
    expect(html).toContain("data-exam-criterion");
    expect(html).toContain("Detailed scoring and criteria");
    expect(html).toContain("exam-comparison");
    expect(html).toContain("exam-user-answer");
    expect(html).toContain("exam-solution");
    expect(html).toContain("exam-self-assessment");
    expect(html).toContain("Self-assessment");
    expect(html).toContain("exam-criteria-details");
    expect(html).toContain("data-reference-solution");
    expect(html).not.toContain("assessment-task-sheet__viewport");
    expect(html).not.toContain('<details class="exam-solution"');
    expect(html).not.toContain("Reference solution missing");
    expect(html).not.toContain("data-assessment-solution-missing");
    expect(html).toContain("examSession.ratings");
  });

  it("omits a low-confidence assessment surface when no approved item is compatible", () => {
    const { content, model } = fixture();
    const changed = structuredClone(model);
    changed.assessmentBlueprint.confidence = "low";
    changed.assessmentBlueprint.title = "Official Exam Simulation";
    changed.assessmentBlueprint.sections = [{
      ...changed.assessmentBlueprint.sections[0],
      id: "unsupported-flashcards",
      title: "Vocabulary",
      questionTypes: ["flashcard"],
    }];

    const html = renderAdaptiveStudyGuide(content, changed, "en");
    const composition = embeddedJson<{
      simulationKind: string;
      support: string;
      sectionItemIds: Array<{ itemIds: string[] }>;
    }>(html, "assessment-composition");

    expect(composition.simulationKind).toBe("none");
    expect(composition.support).toBe("insufficient");
    expect(composition.sectionItemIds[0].itemIds).toEqual([]);
    expect(html).not.toContain('data-main-tab="exam"');
    expect(html).not.toContain('data-main-panel="exam"');
    expect(html).not.toMatch(/<button[^>]+data-start-assessment/);
  });

  it("renders course vocabulary as a reusable learning block and excludes live performance from the exam", () => {
    const { content } = fixture();
    content.topics[0].exercises.push({
      id: "vocabulary-stakeholder",
      type: "vocabulary",
      prompt: "What does stakeholder mean in this business-course context?",
      direction: "term-to-meaning",
      term: "stakeholder",
      acceptedAnswers: ["a person or group affected by an organisation"],
      context: "A company considers employees, customers, suppliers, and owners in its stakeholder analysis.",
      explanation: "A stakeholder can affect or be affected by the organisation and its decisions.",
      source: {
        label: "Course notes",
        sourceTask: "Derived from course notes: stakeholder analysis vocabulary",
        provenance: "derived",
      },
    });
    const assessmentEvidence = [
      "Pecha Kucha presentation (60%).",
      "Content questions answered orally (30%).",
      "Vocabulary test (10%).",
    ];
    const plan = rendererAssessmentPlan([
      { title: "Pecha Kucha presentation", questionTypes: ["open-response"], deliveryMode: "external-performance", evidenceExcerpt: assessmentEvidence[0]! },
      { title: "content questions to be answered orally", questionTypes: ["open-response"], deliveryMode: "external-performance", evidenceExcerpt: assessmentEvidence[1]! },
      { title: "vocabulary test", questionTypes: ["flashcard"], deliveryMode: "interactive", evidenceExcerpt: assessmentEvidence[2]! },
    ]);
    const model = approveQuestionBankForRendering(buildAdaptiveStudyModel(
      content,
      assessmentEvidence.join("\n"),
      "en",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    ));
    const html = renderAdaptiveStudyGuide(content, model, "en");
    const composition = embeddedJson<{
      examItemIds: string[];
      sectionItemIds: Array<{ id: string; itemIds: string[] }>;
      excludedSections: Array<{ id: string; title: string }>;
    }>(html, "assessment-composition");

    expect(html).toContain("data-vocabulary-deck");
    expect(html).toContain('data-vocabulary-mode="grid"');
    expect(html).toContain("data-sb-vocabulary-exercise");
    expect(html).toContain("Active vocabulary");
    expect(composition.sectionItemIds).toHaveLength(1);
    expect(composition.sectionItemIds[0].itemIds).toHaveLength(1);
    expect(composition.excludedSections.map((section) => section.title)).toEqual([
      "Pecha Kucha presentation",
      "content questions to be answered orally",
    ]);
    expect(composition.examItemIds).toEqual(composition.sectionItemIds[0].itemIds);
    expect(html).toContain("Not simulated as a website exam");
  });

  it("switches a dense vocabulary block to a responsive navigable carousel", () => {
    const { content } = fixture();
    for (let index = 0; index < 10; index += 1) {
      content.topics[0].exercises.push({
        id: `vocabulary-business-${index + 1}`,
        type: "vocabulary",
        prompt: `What does business term ${index + 1} mean in this course context?`,
        direction: "term-to-meaning",
        term: `business term ${index + 1}`,
        acceptedAnswers: [`course-grounded meaning ${index + 1}`],
        context: `The course applies business term ${index + 1} in a realistic professional situation.`,
        explanation: `The expression is required for business topic ${index + 1}.`,
        source: {
          label: "Course notes",
          sourceTask: `Derived from course notes: business vocabulary ${index + 1}`,
          provenance: "derived",
        },
      });
    }
    const model = approveQuestionBankForRendering(
      buildAdaptiveStudyModel(content, "Vocabulary test covering all course modules.", "en"),
    );
    const html = renderAdaptiveStudyGuide(content, model, "en");

    expect(html).toContain('data-vocabulary-mode="carousel"');
    expect(html).toContain("data-vocabulary-track");
    expect(html).toContain("data-vocabulary-prev");
    expect(html).toContain("data-vocabulary-next");
    expect(html).toContain("track.scrollLeft=Math.max(0,Math.min(track.scrollWidth-track.clientWidth");
    expect(html).toContain(".vocabulary-deck--carousel .vocabulary-card{flex:0 0 calc((100% - 20px)/3)");
    expect(html).toContain(".vocabulary-deck--carousel .vocabulary-card{flex-basis:min(82vw,340px)}");
  });
});

function embeddedJson<T>(html: string, id: string): T {
  const match = new RegExp(
    `<script type="application/json" id="${id}">([\\s\\S]*?)<\\/script>`,
  ).exec(html);
  if (!match?.[1]) throw new Error(`Missing embedded JSON: ${id}`);
  return JSON.parse(match[1]) as T;
}

function fixture(): { content: StudyGuideContent; model: AdaptiveStudyModel } {
  const source = {
    label: "Course notes",
    sourceTask: "Sample exam chapter one",
    provenance: "source" as const,
  };
  const content: StudyGuideContent = {
    courseTitle: "Contract Course",
    courseCode: "CC",
    scopeNote: "Only the documented contract objective is in scope.",
    topics: [{
      id: "topic",
      title: "Documented topic",
      learningGoals: ["Apply the documented objective"],
      theory: {
        summary: "This documented topic explains one course objective with enough detail to support retrieval, calculation, and open application practice.",
        keyIdeas: ["The objective remains course-scoped.", "Practice uses reviewed evidence."],
        formulas: [{ expression: "x = 1", meaning: "Documented example value" }],
      },
      workedExamples: [{
        title: "Worked example",
        prompt: "Apply the documented relationship to the supplied value.",
        steps: ["Identify the supplied value.", "Apply the documented relationship."],
        answer: "1",
        source,
      }],
      exercises: [
        {
          id: "cross",
          type: "cross",
          prompt: "Which statement matches the documented course objective?",
          selectionMode: "single",
          options: [
            { text: "The scoped statement.", correct: true, feedback: "Correct." },
            { text: "An unrelated statement.", correct: false, feedback: "Outside scope." },
          ],
          explanation: "The first statement is supported by the documented objective.",
          source,
        },
        {
          id: "calculation",
          type: "calculation",
          prompt: "Calculate the documented example value from x = 1.",
          givens: ["x = 1"],
          acceptedAnswers: ["1"],
          unit: "",
          steps: ["Read the supplied value.", "Report the documented value."],
          commonMistake: "Do not replace the supplied value.",
          source,
        },
        {
          id: "application",
          type: "application",
          prompt: "Explain how the documented objective applies in this course.",
          instructions: ["State the objective.", "Connect it to the supplied evidence."],
          sampleAnswer: "The objective applies through the relationship explicitly documented in the course evidence.",
          selfCheck: ["The objective is named.", "The evidence is connected."],
          source,
        },
      ],
      retrieval: [{
        prompt: "What value is documented?",
        answer: "The documented value is 1.",
      }],
    }],
    sources: [{
      id: "notes",
      label: "Course notes",
      url: "",
      coverage: "The documented topic and objective.",
    }],
  };
  const assessmentTask = "Given x = 3 and y = 2x, determine y and show the calculation.";
  const plan = rendererAssessmentPlan([{
    title: "Calculation",
    questionTypes: ["calculation"],
    deliveryMode: "interactive",
    evidenceExcerpt: assessmentTask,
  }]);
  return {
    content,
    model: approveQuestionBankForRendering(buildAdaptiveStudyModel(
      content,
      assessmentTask,
      "en",
      {
        schemaVersion: 1,
        items: [{
          legacyExerciseId: `assessment-source-task-${plan.sections[0]!.id}`,
          completeness: "complete",
          summary: "Apply the documented proportional relationship to the supplied value.",
          steps: [
            "Start with the documented relationship y = 2x.",
            "Substitute x = 3 to obtain y = 2 × 3.",
            "Evaluate the product: y = 6.",
            "The positive result is plausible because y is twice x.",
          ],
          finalAnswer: "y = 6",
          assumptions: [],
          evidenceBasis: ["Sample exam task 1", "Course reader: y = 2x"],
          missingEvidence: [],
          solutionOrigin: "study_buddy_generated",
          taskImage: {
            dataUri: "data:image/png;base64,iVBORw0KGgo=",
            alt: "Original task page",
            sourceLabel: "Sample assessment task page",
            kind: "diagram_crop",
            width: 640,
            height: 360,
          },
          review: { status: "approved", findings: [] },
        }],
      },
      {
        schemaVersion: 1,
        modules: {
          topic: {
            dataUri: "data:image/png;base64,iVBORw0KGgo=",
            alt: "A labelled concept diagram",
            sourceLabel: "Course notes",
            sourceTask: "Documented topic",
            kind: "diagram_crop",
            origin: "course_original",
            width: 720,
            height: 400,
          },
        },
        questions: {
          calculation: {
            dataUri: "data:image/png;base64,iVBORw0KGgo=",
            alt: "A labelled calculation diagram",
            sourceLabel: "Course notes",
            sourceTask: "Original calculation task",
            kind: "diagram_crop",
            origin: "course_original",
            width: 640,
            height: 360,
          },
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    )),
  };
}

function rendererAssessmentPlan(
  sections: Array<{
    title: string;
    questionTypes: string[];
    deliveryMode: "interactive" | "self-assessed" | "external-performance";
    evidenceExcerpt: string;
  }>,
): AssessmentArchitecturePlan {
  const boundSections = sections.map((section, index) => ({
    ...section,
    id: `assessment-section-${String(index + 1).padStart(20, "0")}`,
    evidenceLevel: "explicit" as const,
    taskCount: 1,
    points: null,
    weight: null,
    durationMinutes: null,
    learningObjectiveIds: ["topic-objective-1"],
  }));
  const content = {
    title: "Documented assessment",
    mode: "documented" as const,
    confidence: "high" as const,
    durationMinutes: 60,
    maxPoints: 100,
    passingPoints: 50,
    allowedAids: [],
    prohibitedAids: [],
    basisRequirementIds: [],
    rationale: "The evaluator retained the documented assessment structure.",
    sections: boundSections,
  };
  const hash = "a".repeat(64);
  return {
    schemaVersion: 1,
    binding: {
      cacheVersion: "assessment-architecture-v1-open-contract",
      contractHash: hash,
      originalPromptHash: hash,
      courseHash: hash,
      evidenceHash: hash,
      semanticCacheKey: hash,
    },
    contentHash: createHash("sha256").update(canonicalJson(content)).digest("hex"),
    ...content,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
