export const STUDY_GUIDE_BLOCK_MARKERS = {
  hotbar: "data-sb-hotbar",
  courseMap: "data-sb-course-map",
  courseTabs: "data-sb-course-tabs",
  topic: "data-sb-topic",
  theory: "data-sb-theory",
  workedExample: "data-sb-worked-example",
  practice: "data-sb-practice",
  crossExercise: "data-sb-cross-exercise",
  calculationExercise: "data-sb-calculation-exercise",
  retrieval: "data-sb-retrieval",
  progress: "data-sb-progress",
  sources: "data-sb-sources",
} as const;

export function studyGuideBlockGuidance(): string {
  return [
    "Standard Study Buddy study-guide block contract:",
    "- Use a sticky top hotbar marked data-sb-hotbar. It contains the real Study Buddy logo, course identity, mode jumps, and progress. Do not use a persistent left sidebar or navigation rail.",
    "- Place a compact horizontally scrollable chapter tablist marked data-sb-course-tabs directly below the hotbar. Tabs use proper tab/tabpanel semantics, show exactly one chapter workspace at a time, support arrow keys, and restore the active chapter locally.",
    "- Mark the compact orientation and coverage map data-sb-course-map.",
    "- Render every real chapter in the same data-sb-topic shell. Within a topic use only the blocks supported by its evidence, in the learner-facing order Orientierung → Theorie → Beispiel → Üben → Auswertung.",
    "- Mark readable explanation data-sb-theory and complete stepwise examples data-sb-worked-example. Examples must show the prompt, method choice, calculation/reasoning, result, check, and exact source or a visible derived-practice label.",
    "- Mark the coherent task workspace data-sb-practice. Use data-sb-cross-exercise for checkbox/multiple-response or structured selection practice and data-sb-calculation-exercise for quantitative multi-step practice.",
    "- A cross exercise is not a generic yes/no card. Preserve the source-backed option structure, allow multiple selections where appropriate, award its local practice points at most once, and explain each selected and missed option after submission. Never imply an official scoring formula unless the source provides it.",
    "- A calculation exercise exposes givens and the question before input, then reveals hints, method, intermediate checks, and a complete worked solution progressively. Accept decimal comma and decimal point where applicable.",
    "- Mark optional retrieval practice data-sb-retrieval, the persistent objective/task progress data-sb-progress, and the grouped source register data-sb-sources.",
    "- Blocks are reusable presentation and interaction primitives, not equally styled cards. Topic shells provide structure; theory is editorial, examples read like worked mathematics, and practice looks unmistakably interactive.",
    "- Store active topic, task drafts, submitted results, practice points, and review flags locally. A reload restores the learner to the same meaningful state.",
  ].join("\n");
}

export function studyGuideBlockQualityCriteria(): string {
  return [
    "Standard study-guide quality criteria:",
    "- Reject a study guide that uses a persistent left sidebar, omits the sticky data-sb-hotbar, or lacks a mobile-safe data-sb-course-tabs tablist with one visible chapter panel.",
    "- Reject inconsistent topic markup that makes chapters feel like unrelated pages rather than instances of the same reusable block system.",
    "- Reject a source-rich mathematics guide that samples only a handful of questions. Require representative exercise coverage across every sourced topic, with source-authentic selection types and substantive calculations where available.",
    "- Reject cross exercises that use radio buttons for source questions with multiple correct options, reveal the answer before submission, reward repeated submissions, or provide only generic feedback.",
    "- Reject calculations without complete givens, a derivable result, progressive help, and a topic-specific worked solution.",
    "- Reject visible claims that local practice points reproduce official exam scoring unless that rule is explicitly present in the supplied evidence.",
  ].join("\n");
}
