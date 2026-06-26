import type { SourceCoverage } from "./runDiagnostics.js";
import type { SourcePlan, SourceTarget } from "./sourcePlanner.js";
import { extractCourseTargetHint, rawTextContainsRequestedCourse } from "./courseTargeting.js";

export interface FollowUpAssessment {
  targets: SourceTarget[];
  reason: string;
  reasonCodes: Array<
    | "missing_cis_schedule"
    | "missing_moodle_material"
    | "missing_downloaded_files"
    | "wrong_moodle_course"
    | "missing_target_course"
  >;
}

export function assessFollowUpCrawl(input: {
  prompt: string;
  plan: SourcePlan;
  coverage: SourceCoverage;
  rawText: string;
  completedTargets?: SourceTarget[];
}): FollowUpAssessment {
  if (!input.plan.allowFollowUpCrawl) {
    return { targets: [], reason: "Follow-up crawling is disabled for this run.", reasonCodes: [] };
  }
  const completed = new Set(input.completedTargets ?? []);
  const prompt = input.prompt.toLowerCase();
  const targets: SourceTarget[] = [];
  const reasons: string[] = [];
  const reasonCodes: FollowUpAssessment["reasonCodes"] = [];
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
    reasonCodes.push("missing_cis_schedule");
  }

  if (
    !input.plan.targets.includes("moodle") &&
    !completed.has("moodle") &&
    materialSignal(prompt) &&
    !moodleOk
  ) {
    targets.push("moodle");
    reasons.push("course material evidence is missing");
    reasonCodes.push("missing_moodle_material");
  }

  const target = extractCourseTargetHint(input.prompt);
  if (
    input.plan.targets.includes("moodle") &&
    (target.requestedCodes.length > 0 || target.requestedNames.length > 0) &&
    moodleOk &&
    !rawTextContainsRequestedCourse(input.prompt, input.rawText)
  ) {
    targets.push("moodle");
    reasons.push("the Moodle crawl did not reach the requested course");
    reasonCodes.push("wrong_moodle_course", "missing_target_course");
  }

  if (
    input.plan.targets.includes("moodle") &&
    !completed.has("moodle") &&
    input.plan.needsFiles &&
    fileSignal(prompt) &&
    input.coverage.moodle.artifacts.length === 0
  ) {
    targets.push("moodle");
    reasons.push("the request asks for files, slides, or PDFs but no readable Moodle file was captured");
    reasonCodes.push("missing_downloaded_files");
  }

  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length === 0) {
    return { targets: [], reason: "Initial source coverage is sufficient for the planned request.", reasonCodes: [] };
  }
  return {
    targets: uniqueTargets,
    reason: `Follow-up source needed because ${reasons.join("; ")}.`,
    reasonCodes: [...new Set(reasonCodes)],
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
