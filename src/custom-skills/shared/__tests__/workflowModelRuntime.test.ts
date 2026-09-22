import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkflowModelRuntime,
  workflowModelBridgeEnvironment,
} from "../workflowModelRuntime.js";
import { resolveTaskModelPolicy } from "../../moodle/modelPolicy.js";

function bridge(provider: string, model: string) {
  vi.stubEnv("STUDY_BUDDY_MODEL_BRIDGE_URL", "http://127.0.0.1:12345/api/study-buddy/model");
  vi.stubEnv("STUDY_BUDDY_MODEL_BRIDGE_TOKEN", "test-capability");
  vi.stubEnv("STUDY_BUDDY_MODEL_BRIDGE_PROVIDER", provider);
  vi.stubEnv("STUDY_BUDDY_MODEL_BRIDGE_MODEL", model);
  vi.stubEnv("STUDY_BUDDY_MODEL_BRIDGE_THREAD", "parent-thread");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("selected-provider workflow execution", () => {
  it.each([
    ["claude", "claude-sonnet"],
    ["antigravity", "gemini-pro"],
  ])("routes %s workers and retries without GPT fallback", async (provider, model) => {
    bridge(provider, model);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ text: '{"answer":42}' })));
    vi.stubGlobal("fetch", fetchMock);
    for (const attempt of [1, 2, 3]) {
      expect(
        resolveTaskModelPolicy({ profile: "balanced", task: "content_analyzer", attempt }).model,
      ).toBe(model);
    }
    const runtime = createWorkflowModelRuntime({});
    const prompt = "Preserve this evidence exactly.\nα = 42\n";
    const outputSchema = { type: "object", properties: { answer: { type: "number" } } };
    const result = await runtime
      .startThread({ model: "gpt-stale-profile" })
      .run(prompt, { outputSchema });
    expect(result.finalResponse).toBe('{"answer":42}');
    expect(result.usage).toBeNull();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:12345/api/study-buddy/model");
    expect(JSON.parse(init.body)).toEqual({
      threadId: "parent-thread",
      prompt,
      images: [],
      outputSchema,
    });
    expect(init.headers.authorization).toBe("Bearer test-capability");
    expect(init.redirect).toBe("error");
  });

  it("fails closed on unavailable providers and honors cancellation", async () => {
    bridge("claude", "claude-sonnet");
    const request = vi.fn().mockResolvedValue(new Response("", { status: 409 }));
    vi.stubGlobal("fetch", request);
    const thread = createWorkflowModelRuntime({}).startThread({});
    await expect(thread.run("evidence")).rejects.toThrow("claude workflow request failed (409)");
    await expect(thread.run("evidence", { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects remote endpoints and incomplete credentials", () => {
    expect(() =>
      workflowModelBridgeEnvironment({ STUDY_BUDDY_MODEL_BRIDGE_URL: "https://example.com" }),
    ).toThrow("loopback");
    expect(() =>
      workflowModelBridgeEnvironment({ STUDY_BUDDY_MODEL_BRIDGE_URL: "http://127.0.0.1:12345" }),
    ).toThrow("incomplete");
  });
});
