import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActivityCard } from "./moodleInventory.js";
import type { EvidenceCard, ObligationInventory } from "./obligationInventory.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { validateExtractedData } from "./validation.js";
import { ANSWER_REVIEW_FILE, writeAnswerReview } from "./obligationReview.js";

export const ANSWER_EVIDENCE_FILE = "answer-evidence.json";
export interface AnswerSource {
  id: string;
  courseId?: number;
  title: string;
  url: string;
  content: string;
  access: "course_outline" | "activity_metadata" | "unavailable";
}
export interface AnswerEvidence {
  schemaVersion: 1;
  sources: AnswerSource[];
  gaps: string[];
  activityIndex?: Array<{
    id: string; courseId?: number; course: string; title: string; url: string;
    context: string; instructions: string; metadata: string; observation: string; access: AnswerSource["access"];
  }>;
}

/** Native observations, not classifier conclusions. Retain learning sections and
 * linked-resource descriptions even when they are not assessed activities. */
export async function collectAnswerEvidence(runDir: string, inventory: ObligationInventory): Promise<AnswerEvidence> {
  const sources = new Map<string, AnswerSource>();
  const gaps = [...inventory.gaps];
  const activityIndex: NonNullable<AnswerEvidence["activityIndex"]> = [];
  for (const course of inventory.courses.filter(c => c.status === "audited")) {
    try {
      const outline = JSON.parse(await readFile(path.join(runDir, `course-activities-${course.id}.json`), "utf8")) as {
        text: string; activities: ActivityCard[]; references?: ActivityCard[];
      };
      sources.set(`course-${course.id}`, { id: `course-${course.id}`, courseId: course.id, title: course.title, url: course.url,
        content: outline.text, access: "course_outline" });
      for (const a of [...outline.activities, ...(outline.references ?? [])]) {
        sources.set(a.id, { id: a.id, courseId: course.id, title: `${course.title}: ${a.label}`, url: a.url,
          content: [a.context, a.text].filter(Boolean).join("\n"), access: "course_outline" });
      }
    } catch {
      gaps.push(`Native course outline unavailable: ${course.title}`);
    }
  }
  try {
    const cards = JSON.parse(await readFile(path.join(runDir, "obligation-evidence.json"), "utf8")) as EvidenceCard[];
    for (const card of cards) {
      activityIndex.push({ id: card.id, courseId: card.courseId ?? inventory.courses.find(course => course.title === card.course)?.id,
        course: card.course, title: card.label, url: card.url, context: card.context ?? "", instructions: card.text ?? "",
        metadata: card.index ?? "", observation: card.landing ?? "",
        access: card.failed ? "unavailable" : card.read ? "activity_metadata" : "course_outline" });
      sources.set(card.id, { id: card.id, courseId: card.courseId ?? inventory.courses.find(course => course.title === card.course)?.id,
        title: `${card.course}: ${card.label}`, url: card.url,
        content: [card.context, card.text, card.index, card.landing].filter(Boolean).join("\n"),
        access: card.failed ? "unavailable" : card.read ? "activity_metadata" : "course_outline" });
    }
  } catch {
    gaps.push("Native activity observations unavailable.");
  }
  const evidence: AnswerEvidence = { schemaVersion: 1, sources: [...sources.values()], gaps, activityIndex };
  await writeFile(path.join(runDir, ANSWER_EVIDENCE_FILE), JSON.stringify(evidence, null, 2) + "\n");
  await writeAnswerReview(runDir, inventory, evidence);
  return evidence;
}

/** Conversational agents receive observations rather than a prescribed final
 * answer. Authentication/acquisition stays inside the supervised workflow. */
export async function createObligationHandoff(config: MoodleRuntimeConfig, inventory: ObligationInventory) {
  const evidence = JSON.parse(await readFile(path.join(config.runDir, ANSWER_EVIDENCE_FILE), "utf8")) as AnswerEvidence;
  const validated = validateExtractedData({
    document_title: "Source evidence", language: config.outputLanguage,
    course: { title: inventory.scope, url: config.dashboardUrl },
    sources: evidence.sources.map(source => ({ id: source.id, title: source.title, kind: "moodle_page", url: source.url })),
    sections: [], warnings: evidence.gaps,
  });
  const handoff = [
    "Source evidence is ready for the coordinating agent. This is a tool handoff, not the learner's final answer.",
    `Original request: ${config.originalUserPrompt || config.prompt}`,
    `Scope: ${inventory.scope}; requested range: ${JSON.stringify(inventory.range)}.`,
    ...inventory.facts.filter(fact => fact.dateWarning).map(fact =>
      `Source conflict to explain when discussing ${fact.label} (${fact.url}): displayed field ${JSON.stringify(fact.dateQuote)}; source note ${JSON.stringify(fact.dateWarning)}. Report the displayed date and personal status, and briefly explain this conflict instead of silently removing either observation.`),
    `Read the compact review index first: ${path.join(config.runDir, ANSWER_REVIEW_FILE)}. It lists scoped courses, activity counts, native per-course pages and attention leads. Check each lead's relevance against the actual request before finalizing. For broad task requests, keep an internal accounted-for checklist; include relevant work or explain uncertainty, and exclude completed/out-of-scope work from the evidence. Do not turn this checklist into a fixed final-answer template.`,
    `Full native observations for selective source-id reads: ${path.join(config.runDir, ANSWER_EVIDENCE_FILE)}`,
    `Activity audit index: ${path.join(config.runDir, "obligation-inventory.json")}. Use its structured facts as navigation leads, then check the corresponding native source by id. Classifications are not a substitute for source observations.`,
    "Attention leads from the requested acquisition scope (verify relevance to the user's actual question; these do not prescribe the final answer):",
    ...inventory.facts.filter(fact => ["due", "no_deadline", "needs_read"].includes(fact.disposition) || fact.dateUncertain)
      .map(fact => JSON.stringify({ id: fact.id, courseId: fact.courseId, title: fact.label, url: fact.url,
        auditDisposition: fact.disposition, observedDateQuote: fact.dateQuote, observedStatus: fact.status,
        dateUncertain: fact.dateUncertain ?? false })),
    `Calendar: ${path.join(config.runDir, "calendar-events.json")}`,
    `Course outlines and resource links: ${path.join(config.runDir, "course-activities-<course-id>.json")}`,
    ...inventory.courses.filter(course => course.status === "audited").map(course => `${course.id}: ${course.title} — ${course.url}`),
    "For a broad what-to-do request, use the course list as an internal coverage checklist. Review native instructions and status for preparation or outstanding activities as well as dated deadlines. For a narrow request, inspect only its relevant subset. Uncertain links between tasks and upcoming lessons remain explicit questions, not silent exclusions; an old date alone does not resolve contradictory preparation instructions. Choose the final presentation yourself.",
    "Native instructions, metadata, grades and attempts are in the per-course pages listed by the review index, independent of audit classifications. Read relevant pages through nextPage=null; if a single record is marked oversized, read its fields selectively. Do not dump the full catalogue or answer.json into context. Missing grades or attempt information mean unknown status, not proof of outstanding work. An old displayed date does not settle conflicting lesson instructions.",
    `Coverage: ${inventory.complete ? "complete inventory" : "partial inventory"}; ${evidence.sources.length} native sources. Gaps: ${JSON.stringify(evidence.gaps)}`,
    "Let the user's request determine which courses, records and details to inspect. Native sources have stable id and courseId fields for selective JSON reads. Inspect all relevant metadata fields, not just matching date words or the beginning of a catalogue. An acquisition-complete inventory does not establish that your answer covers the requested facts. Reconcile the relevant evidence before finalizing and identify any remaining gaps. Compose your own helpful answer with direct source links, explicit personal status, displayed dates, conflicts and preparation where requested. Do not present this handoff or classification labels as the final answer. Course outlines do not prove the contents of unread PDFs/videos.",
  ].join("\n\n");
  return { ...validated, answer: handoff, answer_missing: evidence.gaps };
}
