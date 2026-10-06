import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnswerEvidence } from "./obligationAnswer.js";
import type { ObligationInventory } from "./obligationInventory.js";

export const ANSWER_REVIEW_FILE = "answer-review.json";
const PAGE_CHARACTERS = 8000;

/** Small navigation index, not another answer classifier. Keep every native
 * activity available, including past dates and grades, in per-course pages. */
export async function writeAnswerReview(runDir: string, inventory: ObligationInventory, evidence: AnswerEvidence) {
  const courses = [];
  for (const course of inventory.courses.filter(course => course.status === "audited")) {
    const records = (evidence.activityIndex ?? []).filter(record => record.courseId === course.id);
    const batches: typeof records[] = [];
    let batch: typeof records = [];
    for (const record of records) {
      if (batch.length && JSON.stringify([...batch, record]).length > PAGE_CHARACTERS) {
        batches.push(batch); batch = [];
      }
      batch.push(record);
    }
    if (batch.length) batches.push(batch);
    const pages = [];
    for (const [index, records] of batches.entries()) {
      const file = `answer-activities-${course.id}-${index + 1}.json`;
      const oversized = JSON.stringify(records).length > PAGE_CHARACTERS;
      await writeFile(path.join(runDir, file), JSON.stringify({ courseId: course.id, records, oversized,
        nextPage: index + 1 < batches.length ? `answer-activities-${course.id}-${index + 2}.json` : null }) + "\n");
      pages.push({ file, count: records.length, oversized });
    }
    courses.push({ id: course.id, title: course.title, activityCount: records.length, pages });
  }
  const leads = inventory.facts.filter(fact => ["due", "no_deadline", "needs_read"].includes(fact.disposition) || fact.dateUncertain)
    .map(fact => ({ id: fact.id, courseId: fact.courseId, title: fact.label, url: fact.url,
      auditDisposition: fact.disposition, observedDateQuote: fact.dateQuote, observedStatus: fact.status,
      dateUncertain: fact.dateUncertain ?? false }));
  const review = { schemaVersion: 1, scope: inventory.scope, range: inventory.range,
    acquisitionComplete: inventory.complete, courses, leads, gaps: evidence.gaps };
  await writeFile(path.join(runDir, ANSWER_REVIEW_FILE), JSON.stringify(review) + "\n");
  return review;
}
