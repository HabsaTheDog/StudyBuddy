import { expect, it, vi } from "vitest";
import { verifyPurposeExclusions, triageNonObligations, classifyDirectEvidence, classifyEvidence, formatObligationInventory, type EvidenceCard } from "../obligationInventory.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
import { resolveTemporalRequest } from "../temporalRequest.js";
const request = resolveTemporalRequest("bis morgen", new Date("2026-09-08T12:00:00Z"));
const card: EvidenceCard = { id: "assign-4", label: "Worksheet", courseId: 12, course: "Mechanics", kind: "assign", url: "https://m.example/mod/assign/view.php?id=4", text: "", context: "", dates: [], index: "Abgabefrist bis 9. September 2026. Nicht abgegeben.", landing: "", read: false, failed: false };
const fact = { id: card.id, disposition: "due", dueDate: "2026-09-09", dateQuote: "Abgabefrist bis 9. September 2026", evidence: card.index, status: "Nicht abgegeben", reason: "Source deadline" };
const config = moodleTestConfig({ temporalRequest: request });
const model = (value: unknown) => ({ run: vi.fn(async (prompt: string) => {
  const fact = value as { id: string; evidence: string };
  return JSON.stringify(prompt.startsWith("Independent obligation exclusion review")
    ? { decisions: [{ exclude: true, id: fact.id, quote: fact.evidence, reason: "Observed purpose" }] } : { facts: [value] });
}) });
it("validates a model deadline against the date quoted in the source", async () => {
  expect((await classifyEvidence(config, model(fact), [card]))[0]).toMatchObject({ disposition: "due", dueDate: "2026-09-09" });
});
it("rejects date-year hallucination and keeps the real2028 deadline outside the window", async () => {
  const future = { ...card, index: "Geschlossen: 9. September 2028" };
  const proposal = { ...fact, dateQuote: future.index, evidence: future.index };
  expect((await classifyEvidence(config, model(proposal), [future]))[0].disposition).toBe("needs_read");
  expect((await classifyEvidence(config, model({ ...proposal, dueDate: "2028-09-09" }), [future]))[0].disposition).toBe("outside_range");
});
it("does not infer completion from Nicht abgegeben", async () => {
  expect((await classifyEvidence(config, model({ ...fact, disposition: "completed" }), [card]))[0].disposition).toBe("needs_read");
});
it("exposes an exact completion-status field buried in long concatenated quiz text", async () => {
  const finished = { ...card, kind: "quiz", read: true, index: "", landing: `${"Detailed assessment instructions. ".repeat(10)}Ihre Versuche Versuch 1 Status Beendet Begonnen Montag, 12. Januar 2026, 08:10 Abgeschlossen Montag, 12. Januar 2026, 08:34` };
  const m = model({ ...fact, disposition: "completed", dueDate: null, dateQuote: "", evidence: "e0", status: "Beendet" });
  expect((await classifyEvidence(config, m, [finished]))[0]).toMatchObject({ disposition: "completed", evidence: "Status Beendet" });
  expect(m.run.mock.calls[0][0]).toContain('"text":"Status Beendet"');
});
it("requires a landing read before interpreting an absent index date as no deadline", async () => {
  const undated = { ...card, index: "Worksheet without a deadline" };
  const proposal = { ...fact, disposition: "no_deadline", evidence: undated.index, dueDate: null };
  expect((await classifyEvidence(config, model(proposal), [undated]))[0].disposition).toBe("needs_read");
  expect((await classifyEvidence(config, model(proposal), [{ ...undated, read: true, landing: undated.index }]))[0].disposition).toBe("no_deadline");
});
it("does not let the model silently omit an activity", async () => {
  const m = model(fact);
  const results = await classifyEvidence(config, m, [card, { ...card, id: "assign-5" }]);
  expect(m.run).toHaveBeenCalledTimes(3);
  expect(results[0].disposition).toBe("due");
  expect(results[1].disposition).toBe("needs_read");
});
it("retains explicit native no-deadline evidence without interpreting a zero grade as ungraded", () => {
  const lesson = { ...card, kind: "lesson", label: "Reports and the Presentation of Data", index: "Grade: 0\nDeadline: No deadline", read: true, landing: "Introduction: describe financial reports and present data effectively." };
  expect(classifyDirectEvidence(config, lesson)).toMatchObject({ disposition: "no_deadline", evidence: "Deadline: No deadline", status: "unknown", dueDate: null });
  expect(classifyDirectEvidence(config, { ...lesson, read: false })).toBeNull();
  expect(classifyDirectEvidence(config, { ...lesson, failed: true })).toBeNull();
  expect(classifyDirectEvidence(config, { ...lesson, index: "Grade: 0" })).toBeNull();
  expect(classifyDirectEvidence(config, { ...lesson, landing: "Submit your report after the final class." })).toBeNull();
  expect(classifyDirectEvidence(config, { ...lesson, landing: "Abgabe: 9. September 2026" })).toBeNull();
  expect(classifyDirectEvidence(config, { ...lesson, context: "9. September 2026" })).toBeNull();
  expect(classifyDirectEvidence(config, { ...lesson, landing: "You have completed this lesson." })).toBeNull();
});
it("renders the actual task link and personal status from validated facts", () => {
  const answer = formatObligationInventory({ schemaVersion: 1, complete: true, scope: "all_enrolled", range: { start: request.start!, end: request.end! }, courses: [{ id: 12, title: "Mechanics", url: "https://m.example/course/view.php?id=12", status: "audited", reason: "" }], facts: [{ ...fact, ...card, disposition: "due" }], gaps: [], answer: "" }, "de", "Europe/Vienna");
  expect(answer).toContain("[Worksheet](https://m.example/mod/assign/view.php?id=4)");
  expect(answer).toContain("Nicht abgegeben");
  expect(answer).toContain("vollständig");
});

it("uses explicit index dates for old tasks but leaves current or conflicting deadlines to the reader", () => {
  expect(classifyDirectEvidence(config, { ...card, index: "Abgabefrist: 9. September 2025" })).toMatchObject({ disposition: "outside_range", dueDate: "2025-09-09" });
  expect(classifyDirectEvidence(config, { ...card, index: "Test schließt: 9. September 2028" })).toMatchObject({ dueDate: "2028-09-09" });
  expect(classifyDirectEvidence(config, { ...card, index: "Abgabefrist: 9. September 2026" })).toBeNull();
  expect(classifyDirectEvidence(config, { ...card, index: "Abgabefrist: 9. September 2025", text: "Abgabefrist: 9. September 2026" })).toBeNull();
  expect(classifyDirectEvidence(config, { ...card, index: "Kursbeginn: 9. September 2025" })).toBeNull();
});

it("keeps a template date visibly unresolved instead of excluding the task as due in2028", async () => {
  const placeholder = { ...card, read: true, landing: "Schließt: 9. September 2028 <Termin Testschließung noch von den Lehrenden individuell festzulegen>" };
  const result = await classifyEvidence(config, model({ ...fact, disposition: "outside_range", dueDate: "2028-09-09", evidence: placeholder.landing, dateQuote: "Schließt: 9. September 2028" }), [placeholder]);
  expect(result[0]).toMatchObject({ disposition: "no_deadline", dateUncertain: true, dueDate: null });
});
it("repairs only an invalid detail quote using validation feedback", async () => {
  const detail = { ...card, read: true, landing: card.index };
  const m = { run: vi.fn().mockResolvedValueOnce(JSON.stringify({ facts: [{ ...fact, evidence: "invented quotation" }] })).mockResolvedValueOnce(JSON.stringify({ facts: [fact] })) };
  expect((await classifyEvidence(config, m, [detail]))[0].disposition).toBe("due");
  expect(m.run).toHaveBeenCalledTimes(2);
  expect(m.run.mock.calls[1][0]).toContain("Extraction lacks verbatim source evidence");
});

it("allows evidenced support exclusions but requires an actual read for assessment modules", async () => {
  const support = { ...card, kind: "hotquestion", label: "Fragen zur Lehrveranstaltung", index: "Hier sammeln Sie Fragen für die nächste Vorlesung" };
  const proposal = { ...fact, disposition: "not_obligation", evidence: support.index, dueDate: null };
  expect((await classifyEvidence(config, model(proposal), [support]))[0].disposition).toBe("not_obligation");
  expect((await classifyEvidence(config, model({ ...proposal, evidence: card.index }), [card]))[0].disposition).toBe("needs_read");
});
it("lets independent purpose review evaluate a read tutorial without required purpose keywords", async () => {
  const tutorial = { ...card, kind: "hvp", read: true, label: "Platform icons", index: "Content type: Memory Game", landing: "This tour teaches how to use the learning platform." };
  const proposal = { ...fact, disposition: "not_obligation", evidence: tutorial.landing, dueDate: null };
  const m = model(proposal);
  expect((await classifyEvidence(config, m, [tutorial]))[0].disposition).toBe("not_obligation");
  expect(m.run).toHaveBeenCalledTimes(2);
  expect(m.run.mock.calls[1][0]).toContain("Independent obligation exclusion review");
  const rejected = { run: vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith("Independent obligation exclusion review")
    ? { decisions: [{ id: card.id, exclude: false, quote: "", reason: "The full context requires assessed work." }] }
    : { facts: [proposal] })) };
  expect((await classifyEvidence(config, rejected, [tutorial]))[0].disposition).toBe("needs_read");
});
it("recognizes the native German quiz index deadline heading", () => {
  expect(classifyDirectEvidence(config, { ...card, kind: "quiz", index: "Testschließung: Donnerstag, 14. Mai 2026, 23:59" })).toMatchObject({ disposition: "outside_range", dueDate: "2026-05-14" });
});

it("keeps triage omissions and invented IDs for the full audit and never sends core assessment IDs for exclusion", async () => {
  const support = { ...card, id: "hotquestion-9", kind: "hotquestion", index: "Sammlung: Fragen zur Lehrveranstaltung" };
  const m = { run: vi.fn(async (_prompt: string) => JSON.stringify(_prompt.startsWith("Independent obligation exclusion review") ? { decisions: [{ exclude: true, id: support.id, quote: support.index, reason: "Questions to teachers" }] } : { exclusions: [{ id: support.id, quote: support.index }, { id: card.id, quote: card.index }, { id: "invented", quote: "fake source" }] })) };
  const persist = vi.fn(async () => undefined);
  const result = await triageNonObligations(config, m, [support, card, { ...card, id: "lesson-2", kind: "lesson", index: "Grade: 0" }, { ...card, id: "attendance-3", kind: "attendance" }], persist);
  expect(result.map(f => f.id)).toEqual([support.id]);
  expect(m.run.mock.calls[0][0]).not.toContain('"id":"assign-4"');
  expect(m.run.mock.calls[0][0]).not.toContain('"id":"lesson-2"');
  expect(m.run.mock.calls[0][0]).not.toContain('"id":"attendance-3"');
  expect(persist).toHaveBeenCalledWith(result);
});

it("accounts for explicitly ungraded quizzes without opening an attempt or calling a model", () => {
  expect(classifyDirectEvidence({ ...config, originalUserPrompt: "Show all graded tasks" }, { ...card, kind: "quiz", label: "Self-test (ungraded)" })).toMatchObject({ disposition: "not_obligation" });
  expect(classifyDirectEvidence(config, { ...card, kind: "quiz", label: "Self-test", index: "Grade: -" })).toBeNull();
});
it("recognizes graded offline participation without mistaking an ordinary grade for completion", () => {
  const offline = { ...card, read: true, landing: "This assignment does not require you to submit anything online Grading status Graded Feedback Grade 3.00 / 3.00" };
  expect(classifyDirectEvidence(config, offline)).toMatchObject({ disposition: "completed" });
  expect(classifyDirectEvidence(config, { ...offline, landing: "Submission status Draft Grading status Graded" })).toBeNull();
});
it("handles explicitly unsettled landing dates without asking the model to reinterpret the year", () => {
  expect(classifyDirectEvidence(config, { ...card, read: true, landing: "Schließt: 9. September 2028 <Termin noch individuell festzulegen>" })).toMatchObject({ disposition: "no_deadline", dateUncertain: true, dueDate: null });
});
it("uses the checkmark index deadline heading", () => {
  expect(classifyDirectEvidence(config, { ...card, index: "Abgabeende: Mittwoch, 30. September 2026, 03:00" })).toMatchObject({ disposition: "outside_range", dueDate: "2026-09-30" });
});

it("can exclude a broken administrative reference with existing positive purpose evidence, but never invent its deadline", async () => {
  const admin = { ...card, label: 'hier', index: '', text: 'Die Bekanntgabe eines externen Themas erfolgt hier.', failed: true };
  const proposal = { ...fact, disposition: 'not_obligation', evidence: admin.text, dueDate: null };
  expect((await classifyEvidence(config, model(proposal), [admin]))[0].disposition).toBe('not_obligation');
  const fallback = (await classifyEvidence(config, model({ ...proposal, disposition: 'no_deadline' }), [admin]))[0];
  expect(fallback.disposition).toBe('not_obligation');
  expect(fallback.dueDate).toBeNull();
  expect(fallback.evidence).toBe(admin.text);
});
it("keeps a failed possible assignment unresolved when purpose review cannot exclude it", async () => {
  const failed = { ...card, failed: true, index: '', text: 'Assessed worksheet' };
  const m = { run: vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith('Independent obligation exclusion review')
    ? { decisions: [{ id: card.id, exclude: false, quote: '', reason: 'A possible assessed task remains inaccessible.' }] }
    : { facts: [{ ...fact, disposition: 'needs_read', reason: 'Read failed', evidence: '' }] })) };
  expect((await classifyEvidence(config, m, [failed]))[0].disposition).toBe('needs_read');
  expect(m.run).toHaveBeenCalledTimes(2);
  expect(m.run).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ task: 'source_search', attempt: 2 }));
});
it("allows a read illustrative quiz while requiring actual homework acquisition", async () => {
  const example = { ...card, kind: 'quiz', label: 'Example quiz', index: '', read: true, landing: 'An illustrative worked example.' };
  expect((await classifyEvidence(config, model({ ...fact, disposition: 'not_obligation', evidence: example.label }), [example]))[0].disposition).toBe('not_obligation');
  expect((await classifyEvidence(config, model({ ...fact, disposition: 'not_obligation', evidence: 'Worksheet' }), [{ ...example, label: 'Worksheet', read: false, landing: '' }]))[0].disposition).toBe('needs_read');
});

it("does not repeat a model call when an inspected source explicitly needs additional acquisition", async () => {
  const m = model({ ...fact, disposition: 'needs_read', reason: 'Only a launcher is visible; external task metadata is missing' });
  const result = await classifyEvidence(config, m, [{ ...card, kind: 'lti', read: true, landing: 'Open the external application' }]);
  expect(result[0].disposition).toBe('needs_read');
  expect(m.run).toHaveBeenCalledTimes(1);
});

it("resolves evidence handles to actual source spans without requiring a model to copy captions", async () => {
  const video = { ...card, kind: 'lti', label: 'Worked example', index: '', read: true, landing: 'Video Player is loading.Play Video0:08A narrated example.' };
  const m = { run: vi.fn(async (prompt: string) => {
    if (prompt.startsWith('Independent obligation exclusion review')) return JSON.stringify({ decisions: [{ exclude: true, id: video.id, quote: 'Video Player is loading.', reason: 'Video player' }] });
    const activities = JSON.parse(prompt.split('Activities: ')[1]);
    const span = activities[0].evidenceOptions.find((e: { text: string }) => e.text === 'Video Player is loading.');
    return JSON.stringify({ facts: [{ ...fact, disposition: 'not_obligation', dueDate: null, evidence: span.id }] });
  }) };
  expect((await classifyEvidence(config, m, [video]))[0]).toMatchObject({ disposition: 'not_obligation', evidence: 'Video Player is loading.' });
  expect(m.run).toHaveBeenCalledTimes(2);
});


it("keeps a real topic-name quotation unresolved when independent review cannot establish purpose", async () => {
  const topic = { ...card, kind: "lti", label: "Units Conversion: Speed", text: "Units Conversion: Speed", index: "", read: false };
  const proposed = { ...fact, disposition: "not_obligation", dueDate: null, evidence: topic.label };
  const m = { run: vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith("Independent obligation exclusion review") ? { decisions: [{ id: topic.id, exclude: false, quote: "", reason: "Topic name alone cannot establish learning-material purpose" }] } : { facts: [proposed] })) };
  expect((await classifyEvidence(config, m, [topic]))[0]).toMatchObject({ disposition: "needs_read", reason: expect.stringContaining("fresh source reading") });
  expect(m.run).toHaveBeenCalledTimes(1);
});
it("independent exclusion review rejects invented IDs, paraphrases and omitted activities", async () => {
  const resource = { ...card, kind: "lti", index: "Textbook chapter", label: "Reading" };
  const proposed = { ...fact, ...resource, disposition: "not_obligation" as const };
  const m = { run: vi.fn(async () => JSON.stringify({ decisions: [{ exclude: true, id: resource.id, quote: "Book excerpt", reason: "Paraphrase" }, { id: "invented", exclude: true, quote: resource.index, reason: "Unobserved" }] })) };
  expect(await verifyPurposeExclusions(config, m, [resource], [proposed])).toEqual(new Set());
});

it("rejects a numeric student grade even when the semantic reviewer calls it ungraded", async () => {
  const lesson = { ...card, kind: "lesson", label: "Lesson", index: "Grade: 0", read: true };
  const proposal = { ...fact, ...lesson, disposition: "not_obligation" as const, evidence: lesson.index };
  const m = { run: vi.fn(async () => JSON.stringify({ decisions: [{ id: lesson.id, exclude: true, quote: "Grade: 0", reason: "Zero grade means ungraded" }] })) };
  expect(await verifyPurposeExclusions(config, m, [lesson], [proposal])).toEqual(new Set());
  expect(lesson.purposeReviewReason).toContain("earned grade");
});

it("reclassifies a read bonus task after a rejected exclusion without repeating accepted facts", async () => {
  const bonus = { ...card, id: "lti-8", kind: "lti", label: "Bonus exercise", index: "", read: true, landing: "Bonus exercise. Score up to 5 points. Solution assistance." };
  const m = { run: vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ facts: [fact, { ...fact, id: bonus.id, disposition: "not_obligation", evidence: bonus.landing }] }))
    .mockResolvedValueOnce(JSON.stringify({ decisions: [{ id: bonus.id, exclude: false, quote: "", reason: "Scored exercise; no evidence of ungraded practice" }] }))
    .mockResolvedValueOnce(JSON.stringify({ facts: [{ ...fact, id: bonus.id, disposition: "no_deadline", dueDate: null, dateQuote: "", evidence: bonus.landing, status: "unknown", reason: "No published deadline in the read source; grading remains unknown" }] })) };
  const result = await classifyEvidence(config, m, [card, bonus]);
  expect(result.map(f => f.disposition)).toEqual(["due", "no_deadline"]);
  expect(m.run).toHaveBeenCalledTimes(3);
  expect(m.run.mock.calls[2][0]).toContain("Scored exercise; no evidence of ungraded practice");
  const activities = JSON.parse(m.run.mock.calls[2][0].split("Activities: ")[1]);
  expect(activities.map((c: EvidenceCard) => c.id)).toEqual([bonus.id]);
});

it("bounds repeated rejected exclusions after a full source read", async () => {
  const bonus = { ...card, kind: "lti", label: "Bonus exercise", index: "", read: true, landing: "Bonus exercise" };
  const m = { run: vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith("Independent obligation exclusion review")
    ? { decisions: [{ id: bonus.id, exclude: false, quote: "", reason: "No positive exclusion proof" }] }
    : { facts: [{ ...fact, disposition: "not_obligation", evidence: bonus.landing }] })) };
  expect((await classifyEvidence(config, m, [bonus]))[0].disposition).toBe("needs_read");
  expect(m.run).toHaveBeenCalledTimes(6);
});

it("keeps an interactive textbook example as a possible undated assessment", async () => {
  const exercise = { ...card, kind: "lti", label: "Example with solution help", index: "", read: true, landing: "Textbook example. New problem. Record results. Solution hint costs 5%." };
  const m = { run: vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ facts: [{ ...fact, disposition: "not_obligation", evidence: "Textbook example." }] }))
    .mockResolvedValueOnce(JSON.stringify({ facts: [{ ...fact, disposition: "no_deadline", dueDate: null, dateQuote: "", evidence: exercise.landing, status: "unknown" }] })) };
  expect((await classifyEvidence(config, m, [exercise]))[0].disposition).toBe("no_deadline");
  expect(m.run).toHaveBeenCalledTimes(2);
  expect(m.run.mock.calls[1][0]).toContain("explicit ungraded evidence");
});

it("accounts for a failed demonstration using independent tutorial context without inventing a deadline", async () => {
  const demo = { ...card, kind: "lti", course: "Software tutorial and setup examples", label: "Example external tool", index: "", text: "For instructors: configure this demonstration tool with the provider URL.", failed: true };
  const proposal = { ...fact, disposition: "not_obligation", evidence: demo.text, dueDate: null };
  expect((await classifyEvidence(config, model(proposal), [demo]))[0].disposition).toBe("not_obligation");
  expect((await classifyEvidence(config, model({ ...proposal, disposition: "no_deadline" }), [demo]))[0]).toMatchObject({ disposition: "not_obligation", dueDate: null, evidence: demo.text });
});


it("accounts for exclusive unmet group prerequisites without treating a future opening as another group", () => {
  const restricted = { ...card, accessible: false, availabilityText: 'Nicht verfügbar: Sie sind in Team A oder Team B', accessRequirements: ['Sie sind in Team A', 'Sie sind in Team B'] };
  expect(classifyDirectEvidence(config, restricted)).toMatchObject({ disposition: 'not_obligation', status: 'not_in_assigned_group', evidence: restricted.availabilityText });
  expect(classifyDirectEvidence(config, { ...restricted, accessible: true })).toBeNull();
  expect(classifyDirectEvidence(config, { ...restricted, accessRequirements: ['Sie sind in Team A', 'Available from 10 September 2026'] })).toBeNull();
});


it("escalates an unresolved failed-source purpose review through the existing retry model policy", async () => {
  const bibliography = { ...card, kind: 'lti', label: 'Bibliography', index: 'Appendix: Bibliography', text: 'Bibliography', failed: true };
  const m = { run: vi.fn(async (prompt: string, options?: { attempt?: number }) => {
    if (!prompt.startsWith('Independent obligation exclusion review')) return JSON.stringify({ facts: [{ ...fact, disposition: 'not_obligation', dueDate: null, evidence: bibliography.index }] });
    return JSON.stringify({ decisions: [{ id: card.id, exclude: options?.attempt === 2, quote: bibliography.index, reason: options?.attempt === 2 ? 'The native appendix identifies a bibliography reference.' : 'Primary review remains uncertain.' }] });
  }) };
  expect((await classifyEvidence(config, m, [bibliography]))[0]).toMatchObject({ disposition: 'not_obligation', evidence: bibliography.index, dueDate: null });
  expect(m.run.mock.calls.map(call => call[1]?.attempt)).toEqual([1, 1, 2]);
});


it("reconciles dated closing instructions instead of treating an empty index field as no deadline", async () => {
  const closing = 'Vorsicht: Abgabe ist nur bis 23.Sep 2025 23:50 geöffnet!';
  const dated = { ...card, read: true, index: 'Fälligkeitsdatum: -', landing: closing };
  const m = { run: vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ facts: [{ ...fact, disposition: 'no_deadline', dueDate: null, dateQuote: '', evidence: dated.index }] }))
    .mockResolvedValueOnce(JSON.stringify({ facts: [{ ...fact, disposition: 'outside_range', dueDate: '2025-09-23', dateQuote: closing, evidence: closing }] })) };
  expect((await classifyEvidence(config, m, [dated]))[0]).toMatchObject({ disposition: 'outside_range', dueDate: '2025-09-23', evidence: closing });
  expect(m.run).toHaveBeenNthCalledWith(2, expect.stringContaining('Opening dates alone are not deadlines'), expect.objectContaining({ attempt: 2 }));
});

it("allows genuinely undated tasks with opening dates after considering their actual activity evidence", async () => {
  const source = 'Geöffnet: 16. September 2025. No closing deadline is set.';
  const undated = { ...card, read: true, index: 'Fälligkeitsdatum: -', landing: source };
  expect((await classifyEvidence(config, model({ ...fact, disposition: 'no_deadline', dueDate: null, dateQuote: '', evidence: source }), [undated]))[0].disposition).toBe('no_deadline');
});
