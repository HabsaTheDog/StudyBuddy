import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceEvidenceCache, sourceCacheRoot, sourceBackedStatus, evidenceSourceText, missingExternalTaskEvidence } from "../sourceEvidenceCache.js";
import type { EvidenceCard, ObligationFact } from "../obligationInventory.js";
import { moodleTestConfig } from "./support/moodleTestBlocks.js";
import { resolveTemporalRequest } from "../temporalRequest.js";

const dirs: string[] = [];
async function root() { const dir = await mkdtemp(path.join(os.tmpdir(), "sb-proof-cache-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const config = moodleTestConfig({ username: "account-a", originalUserPrompt: "Which graded tasks are due tomorrow?", temporalRequest: resolveTemporalRequest("tomorrow", new Date("2026-09-08T12:00:00Z")) });
const card: EvidenceCard = { id: "resource-4", kind: "resource", label: "Textbook", url: "https://m.example/mod/resource/view.php?id=4", courseId: 12, course: "Course", context: "Reading", text: "Textbook", dates: [], index: "", landing: "", read: false, failed: false };
const fact: ObligationFact = { id: card.id, label: card.label, url: card.url, courseId: card.courseId, course: card.course, disposition: "not_obligation", evidence: "Textbook", dateQuote: "", dueDate: null, status: "not_applicable", reason: "Explicit textbook reference" };

it("does not expose generic module purpose as assessment evidence or cache a grade-only exclusion", async () => {
  const lesson = { ...card, kind: "lesson", purpose: "administration", index: "Grade: 0" };
  expect(evidenceSourceText(lesson)).not.toContain("Moodle module purpose");
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir);
  await cache.write(lesson, { ...fact, evidence: lesson.index });
  expect(await readdir(dir)).toEqual([]);
});

it("requires a fresh external landing and rejects a scored exercise exclusion without an ungraded statement", async () => {
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir);
  const external = { ...card, kind: "lti", label: "Example with solution help", text: "Example with solution help" };
  const proposal = { ...fact, evidence: external.text };
  await cache.write(external, proposal);
  expect(await cache.read(external)).toBeNull();
  const interactive = { ...external, read: true, landing: "Textbook example. New exercise. Record results." };
  await cache.write(interactive, proposal);
  expect(await cache.read(interactive)).toBeNull();
  const ungraded = { ...interactive, landing: interactive.landing + " Explicitly ungraded practice." };
  await cache.write(ungraded, { ...proposal, evidence: "Explicitly ungraded practice." });
  expect(await cache.read(ungraded)).toMatchObject({ disposition: "not_obligation" });
  expect(await readdir(dir)).toHaveLength(1);
});

it("does not infer negative completion from available exercise controls, including cached facts", async () => {
  const read = { ...card, read: true, landing: "Exercise: Record results" };
  const guessed = { ...fact, disposition: "no_deadline" as const, evidence: read.landing, status: "not completed" };
  expect(sourceBackedStatus(read, guessed, "en")).toBe("unknown");
  expect(sourceBackedStatus({ ...read, landing: "Submission status: Not submitted" }, { ...guessed, status: "Not submitted" }, "en")).toBe("Not submitted");
  const cache = new SourceEvidenceCache({ ...config, outputLanguage: "en" }, await root());
  await cache.write(read, guessed);
  expect(await cache.read(read)).toMatchObject({ status: "unknown" });
});

it("reuses a source-verified proof but invalidates any changed source context", async () => {
  const cache = new SourceEvidenceCache(config, await root());
  await cache.write(card, fact);
  expect(await cache.read({ ...card })).toMatchObject(fact);
  expect(await cache.read({ ...card, text: "Textbook. This worksheet is graded." })).toBeNull();
  expect(await cache.read({ ...card, course: "Different course context" })).toBeNull();
  expect(cache.hits).toBe(1);
});
it("cannot reuse personal status until the landing source has been freshly read", async () => {
  const cache = new SourceEvidenceCache(config, await root());
  const read = { ...card, read: true, landing: "Submitted and completed" };
  await cache.write(read, { ...fact, disposition: "completed", evidence: read.landing });
  expect(await cache.read(card)).toBeNull();
  expect(await cache.read(read)).toMatchObject({ disposition: "completed" });
  expect(await cache.read({ ...read, landing: "Not submitted" })).toBeNull();
});
it("re-evaluates a cached date against the new authoritative time window", async () => {
  const dir = await root();
  const dated = { ...card, index: "Due date: 9 September 2026" };
  await new SourceEvidenceCache(config, dir).write(dated, { ...fact, disposition: "due", dueDate: "2026-09-09", evidence: dated.index, dateQuote: dated.index });
  const later = { ...config, temporalRequest: resolveTemporalRequest("tomorrow", new Date("2026-09-09T12:00:00Z")) };
  expect(await new SourceEvidenceCache(later, dir).read(dated)).toMatchObject({ disposition: "outside_range", dueDate: "2026-09-09" });
});
it("never saves unresolved or failed-source facts", async () => {
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir);
  await cache.write(card, { ...fact, disposition: "needs_read" });
  await cache.write({ ...card, failed: true }, fact);
  expect(await readdir(dir)).toEqual([]);
});
it("expires proofs and rejects altered quotations without leaking account names", async () => {
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir, () => 1000);
  await cache.write(card, fact);
  expect(await new SourceEvidenceCache(config, dir, () => 1000 + 24 * 60 * 60000).read(card)).toBeNull();
  const file = path.join(dir, (await readdir(dir))[0]);
  // Windows exposes synthesized POSIX mode bits; file privacy there is enforced
  // by the user's directory ACL, not chmod. Retain the exact POSIX assertion.
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  const text = await readFile(file, "utf8"); expect(text).not.toContain("account-a");
  const altered = JSON.parse(text); altered.fact.evidence = "Invented proof";
  await writeFile(file, JSON.stringify(altered));
  expect(await cache.read(card)).toBeNull();
});
it("isolates desktop accounts and keeps anonymous sessions in their workspace", async () => {
  const environment = { STUDY_BUDDY_CONFIG_ROOT: "/study-buddy-userdata" };
  const a = sourceCacheRoot(config, environment);
  expect(a).toContain(path.join("study-buddy-data", "cache", "sources") + path.sep);
  expect(a).not.toContain("account-a");
  expect(sourceCacheRoot({ ...config, username: "account-b" }, environment)).not.toBe(a);
  expect(path.dirname(sourceCacheRoot({ ...config, username: undefined }, environment)))
    .toBe(path.join(config.runtimeCacheDir, "sources"));
  const dir = await root(); await new SourceEvidenceCache(config, dir).write(card, fact);
  expect(await new SourceEvidenceCache({ ...config, username: "account-b" }, dir).read(card)).toBeNull();
});

it("rejects a legacy blank-index no-deadline proof when the actual activity has dated instructions", async () => {
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir);
  const closing = 'Vorsicht: Abgabe ist nur bis 23.Sep 2025 23:50 geöffnet!';
  const dated = { ...card, kind: 'assign', read: true, index: 'Fälligkeitsdatum: -', landing: closing };
  await cache.write(dated, { ...fact, disposition: 'outside_range', dueDate: '2025-09-23', dateQuote: closing, evidence: closing });
  const [file] = await readdir(dir); const target = path.join(dir, file);
  const legacy = JSON.parse(await readFile(target, 'utf8'));
  legacy.fact = { ...legacy.fact, disposition: 'no_deadline', dueDate: null, dateQuote: '', evidence: dated.index };
  await writeFile(target, JSON.stringify(legacy));
  expect(await cache.read(dated)).toBeNull();
});

it.each([
  ['8.4 - Task ***\nExternal source: https://source.example/home\nGeneral book home', true],
  ['8.4 - Task ***\nExternal source: https://source.example/8.40\n8.40 exercise', true],
  ['8.4 - Task ***\nExternal source: https://source.example/chapter\nMechanics textbook. Chapter 8 Friction. 8.1 Sliding ** 8.4 Friction *** 8.6 Support **** Solutions', true],
  ['8.4 - Task ***\nExternal source: https://source.example/8.4\nGeneral chapter navigation without the task', true],
  ['8.4 - Task ***\nExternal source: https://source.example/task\nExample 8.4 friction', true],
  ['8.4 - Task ***\nExternal source: https://source.example/task\nNew exercise. Record results.', true],
  ['8.4 - Task ***\nExternal source: https://source.example/task\nExample 8.4 friction. New exercise. Record results.', false],
  ['8.4 - Task ***\nExternal source: https://source.example/task\nExample 8.5 friction. New exercise. Record results.', true],
  ['8.4 - Task ***\nExternal source: https://source.example/task\nChapter 8.4 friction. Example 8.5 forces. New exercise. Record results.', true],
  ['8.4 - Task ***\nExternal source: https://source.example/task\nExample 8.4 friction. Due date: no deadline', false],
])("requires evidence from the actual external task: %s", (landing, missing) => {
  expect(missingExternalTaskEvidence({ ...card, kind: 'lti', label: '8.4 - Task ***', read: true, landing })).toBe(missing);
});

it("rejects unsupported date quotes from a legacy undated proof", async () => {
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir);
  const source = { ...card, read: true, landing: 'Textbook reading with no published deadline' };
  await cache.write(source, { ...fact, disposition: 'no_deadline', evidence: source.landing });
  const [file] = await readdir(dir); const target = path.join(dir, file!);
  const legacy = JSON.parse(await readFile(target, 'utf8')); legacy.fact.dateQuote = 'e4';
  await writeFile(target, JSON.stringify(legacy));
  expect(await cache.read(source)).toBeNull();
});

it("invalidates a legacy generic-home proof and never writes another no-deadline proof for it", async () => {
  const dir = await root(); const cache = new SourceEvidenceCache(config, dir);
  const external = { ...card, kind: 'lti', label: '8.4 - Task ***', read: true, landing: '8.4 - Task ***\nExternal source: https://source.example/home\nGeneral book home' };
  // A legacy entry retains a valid fingerprint and quotation; only its evidence
  // sufficiency is obsolete. Seed an allowed record then emulate that old fact.
  await cache.write(external, { ...fact, evidence: 'General book home' });
  const [file] = await readdir(dir); const target = path.join(dir, file!);
  const legacy = JSON.parse(await readFile(target, 'utf8'));
  legacy.fact.disposition = 'no_deadline';
  await writeFile(target, JSON.stringify(legacy));
  expect(await cache.read(external)).toBeNull();
  const before = await readFile(target, 'utf8');
  await cache.write(external, legacy.fact);
  expect(await readFile(target, 'utf8')).toBe(before);
  expect(cache.writes).toBe(1);
});
