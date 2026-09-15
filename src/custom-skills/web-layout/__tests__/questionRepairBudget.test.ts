import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { minimalRequestContract } from "../../shared/requestContract.js";
import { reserveQuestionRepair } from "../questionRepairBudget.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

it("preserves per-item exhaustion on resume while independent items retain their budget", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "question-budget-"));
  const resumedDir = await mkdtemp(path.join(os.tmpdir(), "question-budget-resume-"));
  directories.push(runDir, resumedDir);
  const input = { runDir, itemId: "q1", sourceText: "Verified original evidence", requestContract: minimalRequestContract("Explain the observed topic", ["html"]) };
  expect(await reserveQuestionRepair(input)).toBe(1);
  expect(await reserveQuestionRepair(input)).toBe(2);
  const resumed = { ...input, runDir: resumedDir, resumeRunDir: runDir };
  expect(await reserveQuestionRepair(resumed)).toBe(3);
  await expect(reserveQuestionRepair(resumed)).rejects.toThrow("exhausted three attempts");
  expect(await reserveQuestionRepair({ ...resumed, itemId: "q2" })).toBe(1);
});
