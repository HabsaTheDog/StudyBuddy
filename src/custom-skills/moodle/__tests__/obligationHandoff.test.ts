import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { collectAnswerEvidence } from "../obligationAnswer.js";
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
  const inventory = { schemaVersion: 1 as const, complete: true, scope: "current_semester", range: null, courses: [course], facts: [], gaps: [], answer: "OBSOLETE CANNED ANSWER" };
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
});

it("exposes absent native course observations as a gap instead of reusing classified prose", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "source-handoff-gap-")); dirs.push(runDir);
  const evidence = await collectAnswerEvidence(runDir, { schemaVersion: 1, complete: true, scope: "current_semester", range: null,
    courses: [{ id: 7, title: "Course", url: "https://m.example/course/view.php?id=7", status: "audited", reason: "" }], facts: [], gaps: [], answer: "Nothing due" });
  expect(evidence.sources).toEqual([]);
  expect(evidence.gaps).toHaveLength(2);
});
