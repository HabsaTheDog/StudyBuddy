import type {
  ArtifactProfile,
  OutputFormat,
  SourcePolicy,
  LinkPolicy,
} from "./examNavigatorContracts.js";

export const STUDENT_FIRST_POLICY_VERSION = "1.6";

export const SOURCE_FIDELITY_POLICY = [
  "Cite direct selected-assessment statements for dates, topics and format. Portal announcements/titles with an actual URL and record locator are evidence; arbitrary filenames are not.",
  "Separate confirmed attributes from uncertainty about exclusive or complete assessment coverage; describe the exact remaining gap or conflict.",
  "For conflicting course-group labels and a specific assessment announcement, preserve the conflict and use the announcement for its stated attributes. Never merge their scopes silently.",
  "The absence of a calendar entry cannot negate a documented Moodle date or announcement. A missing source role describes only that role's coverage.",
  "Reconcile chapter-local warnings and contract interpretations against document_context before global claims. A local packet gap cannot deny available document evidence. Cite directly confirmed attributes even if the contract calls an interpretation probable; retain only the actual uncertainty.",
  "Respect each subtask's own instructions, assumptions and givens; reuse previous numerical results only when these permit it.",
].join(" ");

export const MATHEMATICAL_INTEGRITY_POLICY = [
  "Every generated task must be feasible under its stated assumptions. Solve with unchanged givens; label hypothetical changes explicitly, never as solutions within those givens.",
  "An instantaneous function value does not determine its derivative. Distinguish a value at one instant from an identity over an interval before removing derivative terms.",
  "Check mathematical claims in prose and checklists as well as displayed calculations. Distinguish necessary conditions from sufficient conditions; do not reverse an implication or assert an equivalence without justification.",
  "Test relevant counterexamples and zero, boundary, parallel, orthogonal and singular cases before claiming an expression is always nonzero or a condition guarantees a result. For example, nonzero parallel vectors can have a zero cross product.",
  "Preserve scalar, vector and matrix types, operator meaning, derivative order and units; state the assumptions and domain restrictions required by each formula and inference. Conditions on operands alone do not establish a nonzero operator result.",
  "Typst math `times` renders × and can correctly denote a vector cross product. Check the intended operator against the operands and source convention. Do not reject an operator solely because of its Typst token or replace a valid cross product with scalar or dot multiplication.",
].join(" ");

export const ASSESSMENT_SCORING_POLICY = [
  "Never invent point allocations, weights, pass thresholds, or official grading for generated or derived exercises and simulations.",
  "The absence of documented scoring means no point badges or totals, even if a made-up score would be labelled non-official.",
  "Use the optional points argument only when the exact official allocation for the reproduced source task is explicitly documented and cited; a source-backed formula alone is not scoring evidence.",
  "A clear local label must identify Study Buddy-derived/generated tasks and distinguish them from official source tasks.",
  "Where useful, offer an explicitly non-official percentage self-rating or met/not-met checklist instead.",
].join(" ");

export const STUDENT_FIRST_POLICY = [
  "Optimize verified learning value per minute.",
  "Never create content to fill a page, section, widget, or requested count.",
  "A missing section is better than redundant or unsupported content.",
  "Course-specific claims require primary evidence.",
  "Organizational metadata is not a subject-matter practice question.",
  "Renderers may arrange verified content but may not create new facts.",
  "Select learning blocks and their placement from the evaluated request contract and course evidence; do not impose a universal practice, example, or checklist shape.",
  "Related course topics may share a chapter, but official topic labels, subtopics, and practice routes must remain visibly traceable.",
  "Practice items require a concrete learning goal and source evidence.",
  MATHEMATICAL_INTEGRITY_POLICY,
  SOURCE_FIDELITY_POLICY,
].join(" ");

export interface ArtifactIntent {
  profile: ArtifactProfile;
  formats: OutputFormat[];
  sourcePolicy: SourcePolicy;
  linkPolicy: LinkPolicy;
}

export function classifyArtifactIntent(
  prompt: string,
  overrides: {
    profile?: ArtifactProfile;
    formats?: OutputFormat[];
    sourcePolicy?: SourcePolicy;
    linkPolicy?: LinkPolicy;
  } = {},
): ArtifactIntent {
  const normalized = prompt.toLowerCase();
  const profile = overrides.profile ?? inferProfile(normalized);
  const formats = uniqueFormats(
    overrides.formats ??
      inferFormats(normalized, profile),
  );

  return {
    profile,
    formats,
    sourcePolicy: overrides.sourcePolicy ?? "course_first",
    linkPolicy: overrides.linkPolicy ?? "local_preview_and_origin",
  };
}

export function isOrganizationalPracticeQuestion(question: string): boolean {
  return /\b(?:kursalias|course alias|wann|uhrzeit|raum|room|termin|datum|date|lektor|lehrende|teacher|semester|wo findet)\b/i
    .test(question);
}

export function isGenericLearningGoal(goal: string): boolean {
  const normalized = goal.trim().toLowerCase();
  return (
    normalized.length < 12 ||
    /^(?:überblick|ueberblick|verständnis|verstaendnis|funktion|fachvokabular|theorie|lernen|verstehen)$/
      .test(normalized)
  );
}

function inferProfile(normalized: string): ArtifactProfile {
  if (/\b(?:source audit|quellenbericht|coverage report|quellenaudit)\b/.test(normalized)) {
    return "source_audit";
  }
  if (/\b(?:practice pack|fragenkatalog|probeprüfung|probepruefung)\b/.test(normalized)) {
    return "practice_pack";
  }
  if (/\b(?:interaktiv|interactive|karteikarten|flashcards?|lernfortschritt|quiz|trainer|simulation)\b/i.test(normalized)) {
    return "interactive_learning";
  }
  if (/\b(?:navigator|stofflandkarte|exam navigator)\b/.test(normalized)) {
    return "exam_navigator";
  }
  return "study_guide";
}

function inferFormats(normalized: string, profile: ArtifactProfile): OutputFormat[] {
  const forbidsHtml = /\b(?:kein(?:e[snm]?)?|ohne|not|no)\s+(?:(?:interaktive[snm]?|interactive)\s+)?(?:html|webseite|website|navigator|study guide)\b/.test(normalized);
  const forbidsPdf = /\b(?:kein(?:e[snm]?)?|ohne|not|no)\s+(?:pdf|lernzettel|dokument|skript)\b/.test(normalized);
  const asksHtml = !forbidsHtml && /\b(?:html|webseite|website|navigator|interaktiv)\b/.test(normalized);
  const asksPdf = !forbidsPdf && /\b(?:pdf|lernzettel|study guide|dokument|skript)\b/.test(normalized);
  if (asksHtml && asksPdf) return ["html", "pdf"];
  if (asksHtml) return ["html"];
  if (asksPdf) return ["pdf"];
  if (profile === "exam_navigator" || profile === "interactive_learning") {
    return ["html", "pdf"];
  }
  if (profile === "source_audit") return ["html"];
  return ["pdf"];
}

function uniqueFormats(formats: OutputFormat[]): OutputFormat[] {
  return [...new Set(formats)];
}
