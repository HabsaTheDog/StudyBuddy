import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActivityCard } from "./moodleInventory.js";
import type { EvidenceCard, ObligationInventory } from "./obligationInventory.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { validateExtractedData } from "./validation.js";

export const ANSWER_EVIDENCE_FILE = "answer-evidence.json";
export interface AnswerSource {
  id: string;
  title: string;
  url: string;
  content: string;
  access: "course_outline" | "activity_metadata" | "unavailable";
}
export interface AnswerEvidence {
  schemaVersion: 1;
  sources: AnswerSource[];
  gaps: string[];
}

/** Native observations, not classifier conclusions. Retain learning sections and
 * linked-resource descriptions even when they are not assessed activities. */
export async function collectAnswerEvidence(runDir: string, inventory: ObligationInventory): Promise<AnswerEvidence> {
  const sources = new Map<string, AnswerSource>();
  const gaps = [...inventory.gaps];
  for (const course of inventory.courses.filter(c => c.status === "audited")) {
    try {
      const outline = JSON.parse(await readFile(path.join(runDir, `course-activities-${course.id}.json`), "utf8")) as {
        text: string; activities: ActivityCard[]; references?: ActivityCard[];
      };
      sources.set(`course-${course.id}`, { id: `course-${course.id}`, title: course.title, url: course.url,
        content: outline.text, access: "course_outline" });
      for (const a of [...outline.activities, ...(outline.references ?? [])]) {
        sources.set(a.id, { id: a.id, title: `${course.title}: ${a.label}`, url: a.url,
          content: [a.context, a.text].filter(Boolean).join("\n"), access: "course_outline" });
      }
    } catch {
      gaps.push(`Native course outline unavailable: ${course.title}`);
    }
  }
  try {
    const cards = JSON.parse(await readFile(path.join(runDir, "obligation-evidence.json"), "utf8")) as EvidenceCard[];
    for (const card of cards) {
      sources.set(card.id, { id: card.id, title: `${card.course}: ${card.label}`, url: card.url,
        content: [card.context, card.text, card.index, card.landing].filter(Boolean).join("\n"),
        access: card.failed ? "unavailable" : card.read ? "activity_metadata" : "course_outline" });
    }
  } catch {
    gaps.push("Native activity observations unavailable.");
  }
  const evidence: AnswerEvidence = { schemaVersion: 1, sources: [...sources.values()], gaps };
  await writeFile(path.join(runDir, ANSWER_EVIDENCE_FILE), JSON.stringify(evidence, null, 2) + "\n");
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
    `Native observations: ${path.join(config.runDir, ANSWER_EVIDENCE_FILE)}`,
    `Calendar: ${path.join(config.runDir, "calendar-events.json")}`,
    `Course outlines and resource links: ${path.join(config.runDir, "course-activities-<course-id>.json")}`,
    ...inventory.courses.filter(course => course.status === "audited").map(course => `${course.id}: ${course.title} — ${course.url}`),
    `Coverage: ${inventory.complete ? "complete inventory" : "partial inventory"}; ${evidence.sources.length} native sources. Gaps: ${JSON.stringify(evidence.gaps)}`,
    "Inspect the native observations relevant to every part of the request. Compose your own helpful answer with direct source links, explicit personal status, displayed dates, conflicts and preparation. Do not present this handoff or classification labels as the final answer. Course outlines do not prove the contents of unread PDFs/videos.",
  ].join("\n\n");
  return { ...validated, answer: handoff, answer_missing: evidence.gaps };
}
