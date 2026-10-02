import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = await readFile(new URL("study_buddy_task.sh", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("workflow_budget_ms_for_run() {"), source.indexOf("run_staged_document() {"));
for (const [owner, expected] of [["", 2281000], ["2000", 2000], ["9000000", 2281000], ["invalid", 2281000]]) {
  test(`workflow deadline preserves bounded total and owner ${owner || "unset"}`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runtime-wrapper-"));
    try {
      await writeFile(path.join(dir, "adaptive-budget.json"), JSON.stringify({ totalWorkflowBudgetMs: 9999999 }));
      const result = spawnSync("bash", ["-c", functions + '\nworkflow_deadline_ms_for_run "$1" 1000', "runtime-test", dir], {
        encoding: "utf8", env: { ...process.env, STUDY_BUDDY_WORKFLOW_DEADLINE_MS: owner }, timeout: 5000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(Number(result.stdout), expected);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
