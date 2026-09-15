import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const wrapper = fileURLToPath(new URL("study_buddy_task.sh", import.meta.url));

for (const [argument, status] of [
  ["--help", 0], ["-h", 0], ["help", 0], ["--unknown", 2],
  ["https://example.org/info", 2], ["https://moodle.example/mod/quiz/view.php", 2],
  ["https://moodle.example/mod/quiz/startattempt.php?id=1", 2],
  ["https://user:secret@moodle.example/mod/quiz/view.php?id=1", 2],
]) {
  test(`quiz-url ${argument} never creates a run`, async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "quiz-wrapper-"));
    try {
      const result = spawnSync("bash", [wrapper, "quiz-url", argument], {
        encoding: "utf8", env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace }, timeout: 10_000,
      });
      assert.equal(result.status, status, result.stderr);
      assert.deepEqual(await readdir(workspace), []);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
}

test("quiz-url URL --help does not create a run either", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "quiz-wrapper-"));
  try {
    const result = spawnSync("bash", [wrapper, "quiz-url", "https://moodle.example/mod/quiz/view.php?id=1", "--help"], {
      encoding: "utf8", env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace }, timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(workspace), []);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
