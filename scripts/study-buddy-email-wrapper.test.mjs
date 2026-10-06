import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const wrapper = fileURLToPath(new URL("study_buddy_task.sh", import.meta.url));
const packagedTask = fileURLToPath(
  new URL("../t3code-fork/scripts/study-buddy-packaged-task.mjs", import.meta.url),
);
const request = JSON.stringify({ op: "search", sourceId: "mail-fixture", query: 'deadline "Friday"' });

test("email fallback delegates the unchanged request to the configured app wrapper", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "email-wrapper-"));
  try {
    const appWrapper = path.join(workspace, "app-wrapper");
    await writeFile(appWrapper, '#!/bin/sh\nprintf "%s\\n" "$@"\nexit 23\n');
    await chmod(appWrapper, 0o700);
    const result = spawnSync("bash", [wrapper, "email", request], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace,
        STUDY_BUDDY_TASK_WRAPPER: appWrapper, STUDY_BUDDY_BROKER_EXECUTION: "" },
    });
    assert.equal(result.status, 23, result.stderr);
    assert.equal(result.stdout, `email\n${request}\n`);
    assert.deepEqual(await readdir(workspace), ["app-wrapper"]);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

for (const surface of ["repository", "packaged"]) {
  test(`${surface} email fallback fails without a broker and creates no workflow`, async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "email-wrapper-"));
    try {
      const result = spawnSync(
        surface === "repository" ? "bash" : process.execPath,
        [surface === "repository" ? wrapper : packagedTask, "email", request],
        { encoding: "utf8", timeout: 10_000,
          env: { ...process.env, STUDY_BUDDY_WORKSPACE: workspace,
            STUDY_BUDDY_TASK_WRAPPER: "", STUDY_BUDDY_BROKER_EXECUTION: "1",
            STUDY_BUDDY_WORKFLOW_AUTH_TOKEN: "email-secret-canary" } },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /Email tools require the authenticated Study Buddy desktop service/);
      assert.doesNotMatch(result.stderr, /email-secret-canary/);
      assert.deepEqual(await readdir(workspace), []);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });
}
