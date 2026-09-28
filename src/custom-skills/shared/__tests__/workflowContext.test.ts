import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectWorkflowContext } from "../workflowContext.js";

afterEach(() => vi.unstubAllGlobals());
const env = { STUDY_BUDDY_THREAD_ID: "owner", STUDY_BUDDY_MODEL_BRIDGE_URL: "http://127.0.0.1:1234/api/study-buddy/model", STUDY_BUDDY_MODEL_BRIDGE_TOKEN: "fixture" };
const context = { turnId: "turn-one", originalUserPrompt: "Exact α\nUse my image.", images: ["/tmp/card.png"] };

describe("workflow owner context", () => {
  it("keeps standalone CLI requests independent", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await connectWorkflowContext(new AbortController(), {})).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["https://127.0.0.1/x", "http://example.com/x", "http://user@127.0.0.1/x"])("rejects non-local or credentialed endpoints: %s", async (url) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(connectWorkflowContext(new AbortController(), { ...env, STUDY_BUDDY_MODEL_BRIDGE_URL: url })).rejects.toThrow("local Study Buddy");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["stopped", "replaced"])("cancels when the owning turn is %s", async (mode) => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(context)).mockImplementation(async () =>
      mode === "stopped" ? new Response(null, { status: 409 }) : Response.json({ ...context, turnId: "turn-two" }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const owner = await connectWorkflowContext(controller, env, 10);
    try {
      expect(owner).toMatchObject(context);
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ threadId: "owner", context: true, prompt: "", images: [] });
      await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
    } finally { owner?.dispose(); }
  });

  it("loads Codex context from app runtime state without changing its model routing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-context-"));
    const fetcher = vi.fn().mockResolvedValue(Response.json(context)); vi.stubGlobal("fetch", fetcher);
    await writeFile(path.join(dir, "server-runtime.json"), JSON.stringify({ port: 4567, workflowToken: "local-token" }));
    const owner = await connectWorkflowContext(new AbortController(), { STUDY_BUDDY_THREAD_ID: "codex-owner", STUDY_BUDDY_CONFIG_ROOT: dir });
    try {
      expect(owner).toMatchObject(context);
      expect(String(fetcher.mock.calls[0][0])).toBe("http://127.0.0.1:4567/api/study-buddy/model");
      expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer local-token");
    } finally { owner?.dispose(); await rm(dir, { recursive: true, force: true }); }
  });
});
