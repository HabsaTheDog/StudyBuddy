import path from "node:path";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

// The native broker and packaged workflow runtime belong to separate repos.
// Root CI installs both pinned checkouts and owns this integration boundary;
// the UI repository's standalone suite covers its broker with mocked workers.
describe("coordinated native document workflow", () => {
  it("prepares a real template through the broker and packaged CLI in the stable owner tree", async () => {
    const appRoot = fileURLToPath(new URL("../../../../", import.meta.url));
    // Import the real implementation from the pinned UI checkout. This test
    // needs the parent runtime and templates as well as its CLI entrypoint.
    const { executeStudyBuddyWorkflow } = await import(
      pathToFileURL(
        path.join(appRoot, "t3code-fork/apps/server/src/custom-skills/sources/workflowBroker.ts"),
      ).href
    );
    const { spawnWorkflow: spawnNativeWorkflow } = await import(
      pathToFileURL(
        path.join(appRoot, "t3code-fork/apps/server/src/custom-skills/sources/workflowBrokerHttp.ts"),
      ).href
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "broker-direct-doc-"));
    const prompt = 'Create concise notes. "Exact original"';
    const invocationSpy = vi.fn(
      spawnNativeWorkflow as (input: { readonly args: readonly string[] }) => Promise<unknown>,
    );
    try {
      const result = await executeStudyBuddyWorkflow(
        {
          args: ["doc", prompt, "--language", "en", "--execution-profile=quality"],
          workspace,
          threadId: "broker-call-id",
        },
        {
          packagedRoot: appRoot,
          taskModulePath: path.join(appRoot, "t3code-fork/scripts/study-buddy-packaged-task.mjs"),
          nodeExecutable: process.execPath,
          baseEnvironment: {
            PATH: process.env.PATH,
            STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "stable-owner",
            STUDY_BUDDY_WORKSPACE_KIND: "project",
          },
          resolveWorkflowEnvironment: async () => ({}),
          spawnWorkflow: invocationSpy,
        },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const prepared = JSON.parse(result.stdout);
      expect(prepared).toMatchObject({
        ok: true,
        kind: "direct_document",
        op: "prepare",
        status: "prepared",
        retry_count: 0,
      });
      expect(prepared.runDir).toContain(
        path.join(workspace, "study-buddy-data", "threads", "stable-owner", "direct-documents"),
      );
      const state = JSON.parse(
        await readFile(path.join(prepared.runDir, "direct-document.json"), "utf8"),
      );
      expect(state).toMatchObject({
        ownerThreadId: "stable-owner",
        prompt,
        status: "prepared",
        retry_count: 0,
        error_log: null,
      });
      expect(await readFile(prepared.templatePath, "utf8")).toContain(
        '#import "study-buddy-components.typ": *',
      );
      expect(await readFile(prepared.syntaxExamplePath, "utf8")).toContain(
        "frac(dif bold(q), dif t)",
      );
      expect(await readdir(path.join(workspace, "study-buddy-data", "threads"))).toEqual([
        "stable-owner",
      ]);
      expect(
        await readdir(path.join(workspace, "study-buddy-data", "threads", "stable-owner")),
      ).toEqual(["direct-documents"]);
      expect(invocationSpy).toHaveBeenCalledTimes(1);
      expect(invocationSpy.mock.calls[0]![0].args.slice(1)).toEqual([
        "document",
        JSON.stringify({ op: "prepare", prompt }),
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 20_000);
});
