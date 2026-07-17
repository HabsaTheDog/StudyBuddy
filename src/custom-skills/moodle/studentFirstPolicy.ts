import type {
  ArtifactProfile,
  OutputFormat,
  SourcePolicy,
  LinkPolicy,
} from "./examNavigatorContracts.js";

export const STUDENT_FIRST_POLICY_VERSION = "1.1";

export const STUDENT_FIRST_POLICY = [
  "Optimize verified learning value per minute.",
  "Never create content to fill a page, section, widget, or requested count.",
  "A missing section is better than redundant or unsupported content.",
  "Course-specific claims require primary evidence.",
  "Organizational metadata is not a subject-matter practice question.",
  "Renderers may arrange verified content but may not create new facts.",
  "A study guide has one learning checklist and no detached practice bank; worked examples belong inside the relevant chapter.",
  "Practice items require a concrete learning goal and source evidence.",
].join(" ");

export interface ArtifactIntent {
  profile: ArtifactProfile;
  formats: OutputFormat[];
  sourcePolicy: SourcePolicy;
  linkPolicy: LinkPolicy;
  wantsPractice: boolean;
  wantsCalculations: boolean;
  wantsInteractive: boolean;
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
  const wantsInteractive =
    /\b(?:interaktiv|interactive|karteikarten|flashcards?|lernfortschritt|quiz|trainer|simulation)\b/i
      .test(prompt);
  const wantsCalculations =
    /\b(?:rechen|berechn|calculation|worked examples?|übungen?|uebungen?|aufgaben?)\b/i
      .test(prompt);
  const wantsPractice =
    wantsInteractive ||
    /\b(?:practice pack|fragenkatalog|probeprüfung|probepruefung|selbsttest|exam practice)\b/i
      .test(prompt);

  const profile = overrides.profile ?? inferProfile(normalized, {
    wantsInteractive,
    wantsPractice,
  });
  const formats = uniqueFormats(
    overrides.formats ??
      inferFormats(normalized, profile),
  );

  return {
    profile,
    formats,
    sourcePolicy: overrides.sourcePolicy ?? "course_first",
    linkPolicy: overrides.linkPolicy ?? "local_preview_and_origin",
    wantsPractice: profile === "practice_pack" || profile === "interactive_learning" || wantsPractice,
    wantsCalculations,
    wantsInteractive: profile === "interactive_learning" || wantsInteractive,
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

function inferProfile(
  normalized: string,
  signals: { wantsInteractive: boolean; wantsPractice: boolean },
): ArtifactProfile {
  if (/\b(?:source audit|quellenbericht|coverage report|quellenaudit)\b/.test(normalized)) {
    return "source_audit";
  }
  if (/\b(?:practice pack|fragenkatalog|probeprüfung|probepruefung)\b/.test(normalized)) {
    return "practice_pack";
  }
  if (signals.wantsInteractive) {
    return "interactive_learning";
  }
  if (/\b(?:navigator|stofflandkarte|exam navigator)\b/.test(normalized)) {
    return "exam_navigator";
  }
  return "study_guide";
}

function inferFormats(normalized: string, profile: ArtifactProfile): OutputFormat[] {
  const asksHtml = /\b(?:html|webseite|website|navigator|interaktiv)\b/.test(normalized);
  const asksPdf = /\b(?:pdf|lernzettel|study guide|dokument|skript)\b/.test(normalized);
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
