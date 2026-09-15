import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorOrDelegate, boundAuthoringBatches, validateDelegation } from "../authoringDelegation.js";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { studyGuideContentSchema } from "../studyGuideContent.js";
import type { CodexClient } from "../codexClient.js";
const dirs: string[] = [];
const directory = async () => { const value = await mkdtemp(path.join(os.tmpdir(), "author-delegate-")); dirs.push(value); return value; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(value => rm(value, { recursive: true, force: true }))); });
const chapters = ["Documented concepts", "Source interpretation"].map((title, index) => ({ index, chunk: { title, evidence: `Evidence for ${title}` } }));
const content = (titles: string[]) => ({ courseTitle: "Observed course", courseCode: "", scopeNote: "Supplied evidence only.",
  topics: titles.map((title, index) => ({ id: `topic-${index}`, title, learningGoals: ["Use the supplied evidence"],
    theory: { summary: "Evidence-based explanation", keyIdeas: ["Examine the claim"], formulas: [] },
    workedExamples: [], exercises: [], retrieval: [] })),
  sources: [{ id: "source", label: "Observed source", url: "", coverage: "Both chapters" }],
});
function input(runDir: string, run: CodexClient["run"]) {
  return { config: createWebLayoutRuntimeConfig({ prompt: "Teach the supplied objectives", kind: "study-guide", language: "en", runDir }),
    codex: { run }, chapters, contractHash: "a".repeat(64),
    buildPrompt: (selected: typeof chapters) => JSON.stringify(selected.map(chapter => chapter.chunk.title)),
    validate: (value: unknown, selected: typeof chapters) => {
      const result = studyGuideContentSchema.parse(value);
      expect(result.topics.map(topic => topic.title).sort()).toEqual(selected.map(chapter => chapter.chunk.title).sort());
      return result;
    },
  };
}
describe("bounded authoring delegation", () => {
  it("authors related chapters in one call without a mandatory planner call", async () => {
    const runDir = await directory();
    const run = vi.fn<CodexClient["run"]>(async () => JSON.stringify({ mode: "author", content: content(chapters.map(item => item.chunk.title)), groups: [] }));
    const result = await authorOrDelegate(input(runDir, run));
    expect(result.topics).toHaveLength(2); expect(run).toHaveBeenCalledTimes(1);
    await authorOrDelegate(input(runDir, run)); expect(run).toHaveBeenCalledTimes(1);
  });
  it("delegates exact evidence partitions and reuses completed siblings after interruption", async () => {
    const runDir = await directory(); let interrupted = false;
    const run = vi.fn<CodexClient["run"]>(async prompt => {
      if (prompt.includes("BOUNDED_AUTHOR_OR_DELEGATE")) return JSON.stringify({ mode: "delegate", content: null, groups: [
        { chapters: [1], reason: "Independent conceptual context" }, { chapters: [2], reason: "Independent source analysis" },
      ] });
      if (prompt.includes("Source interpretation") && !interrupted) { interrupted = true; throw new DOMException("Injected interruption", "AbortError"); }
      const titles = JSON.parse(prompt.trim().split("\n\n")[0]!) as string[];
      return JSON.stringify(content(titles));
    });
    await expect(authorOrDelegate(input(runDir, run))).rejects.toThrow("Injected interruption");
    const resumedDir = await directory();
    const resumed = input(resumedDir, run); resumed.config.resumeRunDir = runDir;
    expect((await authorOrDelegate(resumed)).topics).toHaveLength(2);
    expect(run.mock.calls.filter(([prompt]) => prompt.includes("BOUNDED_AUTHOR_OR_DELEGATE"))).toHaveLength(1);
    expect(run.mock.calls.filter(([prompt]) => !prompt.includes("BOUNDED_AUTHOR_OR_DELEGATE") && prompt.includes("Documented concepts"))).toHaveLength(1);
  });
  it("rejects dropped, duplicated or invented chapter IDs and unbounded delegation", () => {
    for (const numbers of [[[1], [1]], [[1], [3]], [[1, 2]], [[1], []]]) {
      expect(() => validateDelegation(numbers.map(chapters => ({ chapters, reason: "scope" })), 2)).toThrow();
    }
    expect(() => validateDelegation([{ chapters: [1], reason: "a" }, { chapters: [2], reason: "b" }], 2)).not.toThrow();
    expect(boundAuthoringBatches(["aaa", "bbb", "ccc"], group => group.join(""), 6)).toEqual([["aaa", "bbb"], ["ccc"]]);
  });
});
