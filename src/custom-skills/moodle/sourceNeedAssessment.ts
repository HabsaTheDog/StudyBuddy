import type { SourceCoverage } from "./runDiagnostics.js";
import type { SourcePlan, SourceTarget } from "./sourcePlanner.js";

export interface FollowUpAssessment {
  targets: SourceTarget[];
  reason: string;
}

export function assessFollowUpCrawl(input: {
  prompt: string;
  plan: SourcePlan;
  coverage: SourceCoverage;
  rawText: string;
  completedTargets?: SourceTarget[];
}): FollowUpAssessment {
  if (!input.plan.allowFollowUpCrawl) {
    return { targets: [], reason: "Follow-up crawling is disabled for this run." };
  }
  const completed = new Set(input.completedTargets ?? []);
  const prompt = input.prompt.toLowerCase();
  const targets: SourceTarget[] = [];
  const reasons: string[] = [];
  const moodleOk = isUsable(input.coverage.moodle.status);
  const cisOk = isUsable(input.coverage.cis.status);

  if (
    !input.plan.targets.includes("cis") &&
    !completed.has("cis") &&
    scheduleSignal(prompt) &&
    !cisOk
  ) {
    targets.push("cis");
    reasons.push("schedule, room, exam, deadline, or lab-time facts are missing");
  }

  if (
    !input.plan.targets.includes("moodle") &&
    !completed.has("moodle") &&
    materialSignal(prompt) &&
    !moodleOk
  ) {
    targets.push("moodle");
    reasons.push("course material evidence is missing");
  }

  if (
    input.plan.targets.includes("moodle") &&
    !completed.has("moodle") &&
    fileSignal(prompt) &&
    input.coverage.moodle.artifacts.length === 0
  ) {
    targets.push("moodle");
    reasons.push("the request asks for files, slides, or PDFs but no readable Moodle file was captured");
  }

  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length === 0) {
    return { targets: [], reason: "Initial source coverage is sufficient for the planned request." };
  }
  return {
    targets: uniqueTargets,
    reason: `Follow-up source needed because ${reasons.join("; ")}.`,
  };
}

function isUsable(status: SourceCoverage["moodle"]["status"]): boolean {
  return status === "success" || status === "partial";
}

function scheduleSignal(prompt: string): boolean {
  return /(?:heute|morgen|diese woche|stundenplan|raum|räume|prüfung|pruefung|termin|deadline|frist|anwesenheit|fachlabor|laborslot|nächste einheit|naechste einheit)/i.test(prompt);
}

function materialSignal(prompt: string): boolean {
  return /(?:unterlagen|kursmaterial|moodle|folie|folien|pdf|skript|datei|lernzettel|formelsammlung|übungsblatt|uebungsblatt|quiz|assignment|aufgabenstellung)/i.test(prompt);
}

function fileSignal(prompt: string): boolean {
  return /(?:pdf|folie|folien|skript|datei|download|unterlagen|screenshot)/i.test(prompt);
}
