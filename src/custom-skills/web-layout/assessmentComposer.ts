import type {
  AssessmentBlueprint,
  QuestionBank,
} from "./adaptiveStudyModel.js";
import { isAssessmentMetaQuestionText } from "./assessmentQuestionPolicy.js";

type QuestionBankItem = QuestionBank["items"][number];
type AssessmentSection = AssessmentBlueprint["sections"][number];
type AssessmentQuestionType = AssessmentSection["questionTypes"][number];

export interface ComposedAssessmentSection {
  id: string;
  title: string;
  order: number;
  evidenceLevel: AssessmentSection["evidenceLevel"];
  documented: {
    taskCount: number | null;
    points: number | null;
    weight: number | null;
    durationMinutes: number | null;
  };
  selectionLimit: number;
  selectionLimitBasis: "documented_task_count" | "inferred_practice_session";
  requestedQuestionTypes: AssessmentQuestionType[];
  requestedLearningObjectiveIds: string[];
  items: QuestionBankItem[];
  uncoveredQuestionTypes: AssessmentQuestionType[];
  uncoveredLearningObjectiveIds: string[];
  insufficiency: string[];
}

export interface ExcludedAssessmentSection {
  id: string;
  title: string;
  order: number;
  deliveryMode: "external-performance";
  reason: string;
  documented: {
    taskCount: number | null;
    points: number | null;
    weight: number | null;
    durationMinutes: number | null;
  };
}

export interface ComposedAssessment {
  title: string;
  simulationKind: "exam_simulation" | "exercise_simulation";
  support: "supported" | "partial" | "insufficient";
  confidence: AssessmentBlueprint["confidence"];
  documented: {
    durationMinutes: number | null;
    maxPoints: number | null;
    passingPoints: number | null;
    allowedAids: string[];
    prohibitedAids: string[];
  };
  sections: ComposedAssessmentSection[];
  excludedSections: ExcludedAssessmentSection[];
  evidenceNotes: string[];
  insufficiency: string[];
  unassignedQuestionIds: string[];
}

/**
 * Builds a deterministic practice sequence from the blueprint without
 * manufacturing official task counts, point values, timing, or aid rules.
 *
 * Documented per-section task counts cap selection. Where a count is unknown,
 * the policy covers requested types/objectives first and then distributes
 * compatible bank items without presenting that count as official.
 */
export function composeAssessment(
  blueprint: AssessmentBlueprint,
  questionBank: QuestionBank,
): ComposedAssessment {
  const allSections = [...blueprint.sections]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const sections = allSections.filter((section) => section.deliveryMode !== "external-performance");
  const excludedSections: ExcludedAssessmentSection[] = allSections
    .filter((section) => section.deliveryMode === "external-performance")
    .map((section) => ({
      id: section.id,
      title: section.title,
      order: section.order,
      deliveryMode: "external-performance",
      reason: "This documented component requires live performance, human judgement, or external conditions and cannot be simulated or graded honestly in the offline page.",
      documented: {
        taskCount: section.taskCount ?? null,
        points: section.points,
        weight: section.weight,
        durationMinutes: section.durationMinutes,
      },
    }));
  const items = [...questionBank.items].sort(compareQuestionPriority);
  const selectedBySection = new Map(sections.map((section) => [
    section,
    [] as QuestionBankItem[],
  ]));
  const selectionLimits = new Map(sections.map((section) => [
    section,
    sectionSelectionLimit(blueprint, section, sections),
  ]));
  const usedIds = new Set<string>();

  // Give each section one compatible item before expanding any one section.
  for (const section of sections) {
    selectFirst(
      section,
      items,
      selectedBySection,
      selectionLimits.get(section)!,
      usedIds,
      () => true,
    );
  }

  // Cover each requested response type and objective where the bank permits it.
  for (const section of sections) {
    for (const type of unique(section.questionTypes)) {
      if (selectedBySection.get(section)!.some((item) => responseType(item) === type)) {
        continue;
      }
      selectFirst(
        section,
        items,
        selectedBySection,
        selectionLimits.get(section)!,
        usedIds,
        (item) => responseType(item) === type,
      );
    }
  }
  for (const section of sections) {
    for (const objectiveId of unique(section.learningObjectiveIds)) {
      if (selectedBySection.get(section)!.some((item) =>
        item.learningObjectiveIds.includes(objectiveId)
      )) {
        continue;
      }
      selectFirst(
        section,
        items,
        selectedBySection,
        selectionLimits.get(section)!,
        usedIds,
        (item) => item.learningObjectiveIds.includes(objectiveId),
      );
    }
  }

  // Reuse the bank without duplicating content. Compatible leftovers go to the
  // least-populated eligible section, with documented section order as tie-break.
  for (const item of items) {
    if (usedIds.has(item.id)) continue;
    const eligible = sections
      .filter((section) =>
        isEligible(item, section) &&
        hasSelectionCapacity(
          selectedBySection.get(section)!.length,
          selectionLimits.get(section)!,
        )
      )
      .sort((left, right) =>
        selectedBySection.get(left)!.length - selectedBySection.get(right)!.length ||
        left.order - right.order ||
        left.id.localeCompare(right.id)
      );
    const section = eligible[0];
    if (!section) continue;
    selectedBySection.get(section)!.push(item);
    usedIds.add(item.id);
  }

  const composedSections = sections.map((section) =>
    describeSection(
      section,
      selectedBySection.get(section)!,
      selectionLimits.get(section)!,
    )
  );
  const insufficiency = unique([
    ...(sections.some((section) => section.taskCount == null)
      ? ["At least one assessment section has no documented task count; a bounded representative practice selection is inferred and is not presented as an official count."]
      : []),
    ...composedSections.flatMap((section) =>
      section.insufficiency.map((finding) => `${section.title}: ${finding}`)
    ),
  ]);
  const hasEmptySection = composedSections.some((section) => section.items.length === 0);
  const hasCoverageGap = composedSections.some((section) =>
    section.uncoveredQuestionTypes.length > 0 ||
    section.uncoveredLearningObjectiveIds.length > 0
  );
  const support = hasEmptySection
    ? "insufficient"
    : hasCoverageGap
      ? "partial"
      : "supported";
  const simulationKind = blueprint.mode === "explicit" && blueprint.confidence !== "low"
    ? "exam_simulation"
    : "exercise_simulation";
  const evidenceNotes = blueprint.evidence.map((evidence) =>
    `${evidence.level}: ${evidence.label}`
  );
  if (excludedSections.length > 0) {
    evidenceNotes.push(`Excluded from the offline simulation because external performance is required: ${excludedSections.map((section) => section.title).join(", ")}.`);
  }
  if (blueprint.mode === "inferred") {
    evidenceNotes.push("Substantial assessment structure is inferred from course evidence.");
  } else if (blueprint.confidence === "low") {
    evidenceNotes.push("Explicit assessment evidence has low confidence; official exam status is not claimed.");
  }

  return {
    title: blueprint.title,
    simulationKind,
    support,
    confidence: blueprint.confidence,
    documented: {
      durationMinutes: blueprint.durationMinutes,
      maxPoints: blueprint.maxPoints,
      passingPoints: blueprint.passingPoints,
      allowedAids: [...blueprint.allowedAids],
      prohibitedAids: [...blueprint.prohibitedAids],
    },
    sections: composedSections,
    excludedSections,
    evidenceNotes,
    insufficiency,
    unassignedQuestionIds: items
      .filter((item) => !usedIds.has(item.id))
      .map((item) => item.id),
  };
}

function describeSection(
  section: AssessmentSection,
  items: QuestionBankItem[],
  selectionLimit: number,
): ComposedAssessmentSection {
  const questionTypes = unique(section.questionTypes);
  const objectiveIds = unique(section.learningObjectiveIds);
  const uncoveredQuestionTypes = questionTypes.filter((type) =>
    !items.some((item) => responseType(item) === type)
  );
  const representativeWeightedSection = section.evidenceLevel === "explicit" &&
    section.weight != null &&
    section.taskCount == null;
  const uncoveredLearningObjectiveIds = representativeWeightedSection
    ? []
    : objectiveIds.filter((objectiveId) =>
        !items.some((item) => item.learningObjectiveIds.includes(objectiveId))
      );
  const insufficiency: string[] = [];
  if (items.length === 0) {
    insufficiency.push("No compatible approved question-bank item is available.");
  }
  if (uncoveredQuestionTypes.length > 0) {
    insufficiency.push(`Missing response types: ${uncoveredQuestionTypes.join(", ")}.`);
  }
  if (uncoveredLearningObjectiveIds.length > 0) {
    insufficiency.push(`Missing learning objectives: ${uncoveredLearningObjectiveIds.join(", ")}.`);
  }
  return {
    id: section.id,
    title: section.title,
    order: section.order,
    evidenceLevel: section.evidenceLevel,
    documented: {
      taskCount: section.taskCount ?? null,
      points: section.points,
      weight: section.weight,
      durationMinutes: section.durationMinutes,
    },
    selectionLimit,
    selectionLimitBasis: section.taskCount != null
      ? "documented_task_count"
      : "inferred_practice_session",
    requestedQuestionTypes: questionTypes,
    requestedLearningObjectiveIds: objectiveIds,
    items,
    uncoveredQuestionTypes,
    uncoveredLearningObjectiveIds,
    insufficiency,
  };
}

function selectFirst(
  section: AssessmentSection,
  items: QuestionBankItem[],
  selectedBySection: Map<AssessmentSection, QuestionBankItem[]>,
  selectionLimit: number,
  usedIds: Set<string>,
  requirement: (item: QuestionBankItem) => boolean,
): void {
  if (!hasSelectionCapacity(selectedBySection.get(section)!.length, selectionLimit)) return;
  const item = items.find((candidate) =>
    !usedIds.has(candidate.id) &&
    requirement(candidate) &&
    isEligible(candidate, section)
  );
  if (!item) return;
  selectedBySection.get(section)!.push(item);
  usedIds.add(item.id);
}

function isEligible(item: QuestionBankItem, section: AssessmentSection): boolean {
  if (isAssessmentMetaQuestion(item)) return false;
  if (item.assessmentSectionId && item.assessmentSectionId !== section.id) return false;
  if (!section.questionTypes.includes(responseType(item))) return false;
  if (section.learningObjectiveIds.length === 0) {
    return section.evidenceLevel === "derived";
  }
  return item.learningObjectiveIds.some((id) => section.learningObjectiveIds.includes(id));
}

function hasSelectionCapacity(selectedCount: number, selectionLimit: number): boolean {
  return selectedCount < selectionLimit;
}

function sectionSelectionLimit(
  blueprint: AssessmentBlueprint,
  section: AssessmentSection,
  simulatableSections: AssessmentSection[],
): number {
  if (section.taskCount != null) return section.taskCount;
  const sectionCount = simulatableSections.length;
  if (blueprint.mode === "explicit" && blueprint.confidence === "high" && section.weight != null) {
    const simulatableWeight = simulatableSections.reduce(
      (total, candidate) => total + (candidate.weight ?? 0),
      0,
    );
    const normalizedWeight = simulatableWeight > 0
      ? section.weight / simulatableWeight
      : 1 / Math.max(1, sectionCount);
    return Math.max(1, Math.min(12, Math.round(normalizedWeight * 10)));
  }
  const duration = section.durationMinutes ??
    (blueprint.durationMinutes
      ? blueprint.durationMinutes / Math.max(1, sectionCount)
      : null);
  if (duration) return Math.max(1, Math.min(6, Math.round(duration / 8)));
  return sectionCount === 1 ? 4 : 2;
}

function isAssessmentMetaQuestion(item: QuestionBankItem): boolean {
  return isAssessmentMetaQuestionText({
    prompt: item.exercise.prompt,
    sourceTask: item.scopeBasis.sourceTask,
  });
}

function responseType(item: QuestionBankItem): AssessmentQuestionType {
  switch (item.type) {
    case "cross":
      return "selection";
    case "calculation":
      return "calculation";
    case "application":
      return "open-response";
    case "vocabulary":
      return "flashcard";
  }
}

function compareQuestionPriority(left: QuestionBankItem, right: QuestionBankItem): number {
  return stagePriority(left.stageIntent) - stagePriority(right.stageIntent) ||
    left.stageIndex - right.stageIndex ||
    left.id.localeCompare(right.id);
}

function stagePriority(intent: QuestionBankItem["stageIntent"]): number {
  switch (intent) {
    case "assessment":
      return 0;
    case "depth":
      return 1;
    case "application":
      return 2;
    case "foundation":
      return 3;
    case "minimum":
      return 4;
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
