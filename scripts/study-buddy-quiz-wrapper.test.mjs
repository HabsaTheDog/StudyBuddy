import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const wrapper = fileURLToPath(new URL("study_buddy_task.sh", import.meta.url));

test("repository fallback delegates the exact quiz request to the app broker wrapper", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "quiz-wrapper-routing-"));
  try {
    const appWrapper = path.join(workspace, "app-wrapper");
    await writeFile(appWrapper, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 23\n');
    await chmod(appWrapper, 0o700);
    const args = ["prompt", "Can you please do the mini test for my next math lesson?", "--original-user-prompt", "Can you please do the mini test for my next math lesson?", "--language", "en", "--auto-answer"];
    const result = spawnSync("bash", [wrapper, ...args], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace, STUDY_BUDDY_TASK_WRAPPER: appWrapper, STUDY_BUDDY_BROKER_EXECUTION: "" },
    });
    assert.equal(result.status, 23, result.stderr);
    assert.equal(result.stdout, `${args.join("\n")}\n`);
    assert.deepEqual(await readdir(workspace), ["app-wrapper"]);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("an unavailable configured app wrapper fails before creating a local run", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "quiz-wrapper-routing-"));
  try {
    const result = spawnSync("bash", [wrapper, "prompt", "Do my mini test"], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace, STUDY_BUDDY_TASK_WRAPPER: path.join(workspace, "missing"), STUDY_BUDDY_BROKER_EXECUTION: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /configured app wrapper is unavailable/);
    assert.deepEqual(await readdir(workspace), []);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

for (const kind of ["self", "symlink", "broker"]) {
  test(`wrapper routing avoids recursion for ${kind} execution`, async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "quiz-wrapper-routing-"));
    try {
      const link = path.join(workspace, "linked-wrapper");
      if (kind === "symlink") await symlink(wrapper, link);
      const result = spawnSync("bash", [wrapper, "workspace"], {
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace,
          STUDY_BUDDY_TASK_WRAPPER: kind === "self" ? wrapper : link,
          STUDY_BUDDY_BROKER_EXECUTION: kind === "broker" ? "1" : "" },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, `${workspace}\n`);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });
}

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
