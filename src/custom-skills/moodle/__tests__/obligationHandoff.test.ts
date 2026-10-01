import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectAnswerEvidence, createObligationHandoff } from "../obligationAnswer.js";
import { createAnalyzerNode } from "../nodes/analyzerNode.js";
import { createAnswerWriterNode } from "../nodes/answerWriterNode.js";
import { initialAgentState } from "../state.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
import { classifyStudyBuddyIntent } from "../taskIntent.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it("hands the coordinator native dates, attempts and self-study without an answer template or another model", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-")); dirs.push(runDir);
  const prompt = "What must I do next week? Summarise the self-study sections too.";
  const course = { id: 12, title: "Signals", url: "https://m.example/course/view.php?id=12", status: "audited", reason: "" };
  const inventory = { schemaVersion: 1 as const, complete: true, scope: "current_semester", range: null, courses: [course], facts: [{ id: "quiz-3", disposition: "due" as const, dueDate: "2026-09-15", dateQuote: "Closes: 15 September 2026 23:59", evidence: "Your attempt: In progress.", status: "In progress", reason: "Open attempt", dateWarning: "Closing date to be set.", label: "Mini-test", url: "https://m.example/mod/quiz/view.php?id=3", courseId: 12, course: "Signals" }], gaps: [], answer: "OBSOLETE CANNED ANSWER" };
  await writeFile(path.join(runDir, "obligation-inventory.json"), JSON.stringify(inventory));
  await writeFile(path.join(runDir, "course-activities-12.json"), JSON.stringify({
    text: "Self-study: Fourier series. Work examples 1–4 before the lesson.",
    activities: [{ id: "resource-2", url: "https://m.example/mod/resource/view.php?id=2", label: "Worked examples", text: "Examples 1–4", context: "Fourier series" }],
  }));
  await writeFile(path.join(runDir, "obligation-evidence.json"), JSON.stringify([{
    id: "quiz-3", course: "Signals", label: "Mini-test", url: "https://m.example/mod/quiz/view.php?id=3",
    index: "Closes: 15 September 2026 23:59", landing: "Closing date to be set. Your attempt: In progress.", read: true, failed: false,
  }]));
  const evidence = await collectAnswerEvidence(runDir, inventory);
  expect(JSON.stringify(evidence)).not.toContain("OBSOLETE CANNED ANSWER");
  expect(evidence.sources.map(source => source.id)).toEqual(["course-12", "resource-2", "quiz-3"]);
  expect(evidence.sources[2].content).toContain("Closes: 15 September 2026 23:59");
  expect(evidence.sources[2].content).toContain("Your attempt: In progress.");
  expect(evidence.sources[0].content).toContain("Work examples 1–4");
  expect(evidence.sources.every(source => source.courseId === 12)).toBe(true);
  expect(evidence.activityIndex?.[0].metadata).toContain("Closes: 15 September 2026 23:59");
  const config = moodleTestConfig({ runDir, prompt, originalUserPrompt: prompt, sourceEvidenceOnly: true,
    intentDecision: classifyStudyBuddyIntent({ prompt, stage: "all", autoAnswer: false, diagnosticOnly: false, includeCis: false, hasCisUrls: false }),
  });
  const codex = { run: vi.fn() };
  const analyzed = await createAnalyzerNode(config, codex)(initialAgentState);
  const final = await createAnswerWriterNode(config)({ ...initialAgentState, ...analyzed });
  expect(codex.run).not.toHaveBeenCalled();
  expect(final.final_document).toContain("not the learner's final answer");
  const artifact = JSON.parse(await readFile(path.join(runDir, "answer.json"), "utf8"));
  expect(artifact.kind).toBe("source_evidence");
  expect(artifact.answer).not.toContain("OBSOLETE CANNED ANSWER");
  expect(artifact.answer).toContain(prompt);
  expect(artifact.answer).toContain('Source conflict to explain when discussing Mini-test');
  expect(artifact.answer).toContain('Closing date to be set.');
  expect(artifact.answer).toContain('Closes: 15 September 2026 23:59');
});

it("preserves native preparation instructions and grades even for activities audited outside the date range", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-old-date-")); dirs.push(runDir);
  const course = { id: 77, title: "Course A", url: "https://m.example/course/view.php?id=77", status: "audited", reason: "" };
  const card = { id: "quiz-88", courseId: 77, course: course.title, label: "Preparation test", url: "https://m.example/mod/quiz/view.php?id=88",
    context: "Self-study before the lesson", text: "Complete this graded preparation before the corresponding class.",
    index: "Closing date: 30 September 2026. Grade: 10/10", landing: "", read: false, failed: false };
  const inventory = { schemaVersion: 1 as const, complete: true, scope: "requested_course: Course A", range: null, courses: [course],
    facts: [{ ...card, disposition: "outside_range" as const, dueDate: "2026-09-30", dateQuote: "Closing date: 30 September 2026", evidence: card.index,
      status: "unknown", reason: "Outside requested window" }], gaps: [], answer: "" };
  await writeFile(path.join(runDir, "course-activities-77.json"), JSON.stringify({ text: "Course A", activities: [card] }));
  await writeFile(path.join(runDir, "obligation-evidence.json"), JSON.stringify([card]));
  await collectAnswerEvidence(runDir, inventory);
  const handoff = await createObligationHandoff(moodleTestConfig({ runDir, originalUserPrompt: "What preparation do I need for Course A?" }), inventory);
  const nativePage = await readFile(path.join(runDir, "answer-activities-77-1.json"), "utf8");
  expect(nativePage).toContain(card.text);
  expect(nativePage).toContain(card.index);
  expect(nativePage).toContain('"courseId":77');
  expect(handoff.answer).toContain("answer-review.json");
  expect(handoff.answer).toContain("requested_course: Course A");
  expect(handoff.answer).not.toContain("current_semester");
});

it("makes a late discovered deadline navigable when its landing uses different date wording", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-sequence-")); dirs.push(runDir);
  const course = { id: 12, title: "Signals", url: "https://m.example/course/view.php?id=12", status: "audited", reason: "" };
  const source = { id: "quiz-404", courseId: 12, course: "Signals", label: "Assessment 4", url: "https://m.example/mod/quiz/view.php?id=404",
    context: "Preparation", text: "Complete before the lesson.", index: "Closes: 6 October 2026, 23:59", landing: "Schließt: 6 October 2026, 23:59", read: true, failed: false };
  const inventory = { schemaVersion: 1 as const, complete: true, scope: "current_semester", range: { start: "2026-10-05", end: "2026-10-11" },
    courses: [course], facts: [{ ...source, disposition: "due" as const, dueDate: "2026-10-06", dateQuote: source.index, evidence: source.landing,
      status: "unknown", reason: "Source deadline within requested range" }], gaps: [], answer: "" };
  await writeFile(path.join(runDir, "course-activities-12.json"), JSON.stringify({ text: "Preparation instructions", activities: [
    ...Array.from({ length: 400 }, (_, i) => ({ id: `resource-${i}`, url: `https://m.example/mod/resource/view.php?id=${i}`, label: `Reading ${i}`, text: "Learning material" })),
    source,
  ] }));
  await writeFile(path.join(runDir, "obligation-evidence.json"), JSON.stringify([source]));
  const evidence = await collectAnswerEvidence(runDir, inventory);
  expect(evidence.sources.findIndex(record => record.id === source.id)).toBeGreaterThan(400);
  const observation = evidence.sources.find(record => record.id === source.id)!;
  expect(observation.courseId).toBe(12);
  expect(observation.content).toContain(source.index);
  expect(observation.content).toContain(source.landing);
  const handoff = await createObligationHandoff(moodleTestConfig({ runDir, originalUserPrompt: "What tasks do I have next week?" }), inventory);
  expect(handoff.answer).toContain('"id":"quiz-404"');
  expect(handoff.answer).toContain(source.index);
  expect(handoff.answer).toContain(source.url);
  expect(handoff.answer).toContain("obligation-inventory.json");
  expect(handoff.answer).toContain("do not prescribe the final answer");
});

it("exposes absent native course observations as a gap instead of reusing classified prose", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-gap-")); dirs.push(runDir);
  const evidence = await collectAnswerEvidence(runDir, { schemaVersion: 1, complete: true, scope: "current_semester", range: null,
    courses: [{ id: 7, title: "Course", url: "https://m.example/course/view.php?id=7", status: "audited", reason: "" }], facts: [], gaps: [], answer: "Nothing due" });
  expect(evidence.sources).toEqual([]);
  expect(evidence.gaps).toHaveLength(2);
});

it("keeps completed, upcoming and unknown statuses across two courses instead of selecting a sequence by title", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-status-")); dirs.push(runDir);
  const courses = [
    { id: 31, title: "Course A", url: "https://m.example/course/view.php?id=31", status: "audited", reason: "" },
    { id: 52, title: "Course B", url: "https://m.example/course/view.php?id=52", status: "audited", reason: "" },
  ];
  const observations = [
    { id: "quiz-5", course: "Course A", label: "Test 1", index: "Grade: 10/10", landing: "Attempt finished", read: true, failed: false },
    { id: "quiz-9", course: "Course A", label: "Test 2", index: "Closes: 6 October 2026 23:59. Grade: ", landing: "Schließt: 6 October 2026 23:59", read: true, failed: false },
    { id: "quiz-2", course: "Course B", label: "Preparation", index: "Closes: 30 September 2026. Grade: 10/10", landing: "", read: false, failed: false },
    { id: "quiz-7", course: "Course B", label: "Further preparation", index: "Grade: ", landing: "", read: false, failed: true },
  ].map(card => ({ ...card, url: `https://m.example/mod/quiz/view.php?id=${card.id.split("-")[1]}`,
    context: "Self-study", text: "Complete before the corresponding lesson." }));
  for (const course of courses) {
    await writeFile(path.join(runDir, `course-activities-${course.id}.json`), JSON.stringify({
      text: course.title, activities: observations.filter(card => card.course === course.title),
    }));
  }
  await writeFile(path.join(runDir, "obligation-evidence.json"), JSON.stringify(observations));
  const inventory = { schemaVersion: 1 as const, complete: true, scope: "requested_courses", range: null, courses, facts: [], gaps: [], answer: "" };
  const evidence = await collectAnswerEvidence(runDir, inventory);
  const records = evidence.activityIndex!;
  expect(records).toHaveLength(4);
  expect(records.map(record => record.courseId)).toEqual([31, 31, 52, 52]);
  expect(records.find(record => record.id === "quiz-5")?.observation).toBe("Attempt finished");
  expect(records.find(record => record.id === "quiz-9")?.observation).toContain("Schließt:");
  expect(records.find(record => record.id === "quiz-2")?.metadata).toContain("Grade: 10/10");
  expect(records.find(record => record.id === "quiz-7")?.access).toBe("unavailable");
  const handoff = await createObligationHandoff(moodleTestConfig({ runDir, originalUserPrompt: "Which tests do I need for Course A and Course B?" }), inventory);
  const review = JSON.parse(await readFile(path.join(runDir, "answer-review.json"), "utf8"));
  const pages = await Promise.all(review.courses.flatMap((course: { pages: { file: string }[] }) =>
    course.pages.map(page => readFile(path.join(runDir, page.file), "utf8"))));
  expect(pages.join("\n")).toContain("Attempt finished");
  expect(pages.join("\n")).toContain('"access":"unavailable"');
  expect(review.courses.map((course: { activityCount: number }) => course.activityCount)).toEqual([2, 2]);
  expect(handoff.answer).not.toContain("Attempt finished");
});

it("pages a large native catalogue without losing the last record or hiding an oversized source", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-pages-")); dirs.push(runDir);
  const course = { id: 19, title: "Course", url: "https://m.example/course/view.php?id=19", status: "audited", reason: "" };
  const cards = Array.from({ length: 90 }, (_, index) => ({
    id: `quiz-${index}`, courseId: 19, course: course.title, label: `Assessment ${index}`,
    url: `https://m.example/mod/quiz/view.php?id=${index}`, text: `Instructions ${index}: ${"source text ".repeat(35)}`,
    index: index === 89 ? "Closes: 6 October 2026 23:59" : "Grade: 10/10", landing: "", read: false, failed: false,
  }));
  cards[45].text = "long source ".repeat(2000);
  await writeFile(path.join(runDir, "course-activities-19.json"), JSON.stringify({ text: "Course", activities: cards }));
  await writeFile(path.join(runDir, "obligation-evidence.json"), JSON.stringify(cards));
  const inventory = { schemaVersion: 1 as const, complete: true, scope: "requested_course", range: null, courses: [course], facts: [], gaps: [], answer: "" };
  await collectAnswerEvidence(runDir, inventory);
  const review = JSON.parse(await readFile(path.join(runDir, "answer-review.json"), "utf8"));
  const entries = review.courses[0].pages as { file: string; count: number; oversized: boolean }[];
  const recovered = [];
  for (const [index, entry] of entries.entries()) {
    const raw = await readFile(path.join(runDir, entry.file), "utf8");
    const page = JSON.parse(raw);
    if (!entry.oversized) expect(raw.length).toBeLessThan(8200);
    expect(page.nextPage).toBe(entries[index + 1]?.file ?? null);
    expect(page.records).toHaveLength(entry.count);
    if (entry.oversized) expect(page.records).toHaveLength(1);
    recovered.push(...page.records);
  }
  expect(recovered.map(record => record.id)).toEqual(cards.map(card => card.id));
  expect(recovered[45].instructions).toBe(cards[45].text);
  expect(recovered[89].metadata).toBe(cards[89].index);
  expect(review.courses[0].activityCount).toBe(90);
  expect(entries.some(entry => entry.oversized)).toBe(true);
  const handoff = await createObligationHandoff(moodleTestConfig({ runDir }), inventory);
  expect(handoff.answer.length).toBeLessThan(8000);
  expect(handoff.answer).not.toContain(cards[45].text);
});
