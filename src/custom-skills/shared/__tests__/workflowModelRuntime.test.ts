import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createWorkflowModelRuntime,
  workflowModelBridgeEnvironment,
} from "../workflowModelRuntime.js";
import { resolveTaskModelPolicy } from "../../moodle/modelPolicy.js";
import {
  classifyCodexError,
  shouldTryModelFallback,
} from "../../moodle/codexClient.js";

function bridge(provider: string, model: string) {
  vi.stubEnv(
    "STUDY_BUDDY_MODEL_BRIDGE_URL",
    "http://127.0.0.1:12345/api/study-buddy/model",
  );
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
  it("runs Codex workers with the desktop-selected CLI and isolated account environment", async () => {
    bridge("codex", "catalog-current-model");
    const directory = await mkdtemp(path.join(os.tmpdir(), "workflow-cli-"));
    try {
      // Use a real executable on every OS; Windows cannot spawn a shebang file.
      const executable = process.execPath;
      const fixture = path.join(directory, "provider-codex.mjs");
      const capture = path.join(directory, "invocation.json");
      await writeFile(fixture, `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args: process.argv.slice(2), home: process.env.CODEX_HOME, password: process.env.MOODLE_PASSWORD}));
process.stdin.resume();
await new Promise(resolve => process.stdin.on("end", resolve));
const events = [
    {type:"thread.started",thread_id:"fixture"},
    {type:"turn.started"},
    {type:"item.completed",item:{id:"answer",type:"agent_message",text:"ok"}},
    {type:"turn.completed",usage:{input_tokens:12,cached_input_tokens:2,output_tokens:3}}
];
await new Promise(resolve => process.stdout.write(events.map(event => JSON.stringify(event) + "\\n").join(""), resolve));
process.exit(0);
`);
      vi.stubEnv("STUDY_BUDDY_CODEX_PATH", executable);
      vi.stubEnv("MOODLE_PASSWORD", "portal-secret-canary");
      const runtime = createWorkflowModelRuntime({
        env: { PATH: process.env.PATH!, CODEX_HOME: "/private/selected-codex-home",
          NODE_OPTIONS: `--import=${pathToFileURL(fixture).href}` },
      });
      const result = await runtime.startThread({
        model: "catalog-current-model", sandboxMode: "read-only", approvalPolicy: "never",
        networkAccessEnabled: false, webSearchMode: "disabled",
      }).run("supplied evidence");
      expect(result.finalResponse).toBe("ok");
      expect(result.usage).toMatchObject({ input_tokens: 12, output_tokens: 3 });
      const invocation = JSON.parse(await readFile(capture, "utf8"));
      expect(invocation.home).toBe("/private/selected-codex-home");
      expect(invocation.password).toBeUndefined();
      expect(invocation.args).toContain("catalog-current-model");
      expect(invocation.args).toContain("read-only");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each([
    ["claude", "claude-sonnet"],
    ["antigravity", "gemini-pro"],
  ])(
    "routes %s workers and retries without GPT fallback",
    async (provider, model) => {
      bridge(provider, model);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ text: '{"answer":42}' })),
        );
      vi.stubGlobal("fetch", fetchMock);
      for (const attempt of [1, 2, 3]) {
        expect(
          resolveTaskModelPolicy({
            profile: "balanced",
            task: "content_analyzer",
            attempt,
          }).model,
        ).toBe(model);
      }
      const runtime = createWorkflowModelRuntime({});
      const prompt = "Preserve this evidence exactly.\nα = 42\n";
      const outputSchema = {
        type: "object",
        properties: { answer: { type: "number" } },
      };
      const result = await runtime
        .startThread({ model, modelReasoningEffort: "high" })
        .run(prompt, { outputSchema });
      expect(result.finalResponse).toBe('{"answer":42}');
      expect(result.usage).toBeNull();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("http://127.0.0.1:12345/api/study-buddy/model");
      expect(JSON.parse(init.body)).toEqual({
        threadId: "parent-thread",
        instanceId: provider,
        model,
        reasoningEffort: "high",
        prompt,
        images: [],
        outputSchema,
      });
      expect(init.headers.authorization).toBe("Bearer test-capability");
      expect(init.redirect).toBe("error");
    },
  );

  it("preserves primary and fallback connection/model assignments across the bridge", async () => {
    bridge("antigravity", "gemini-coordinator");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(
          async () => new Response(JSON.stringify({ text: "ok" })),
        ),
    );
    const overrides = {
      artifact_builder: {
        instanceId: "codex-work",
        model: "gpt-builder",
        reasoningEffort: "medium" as const,
        escalationInstanceId: "claude-personal",
        escalationModel: "claude-review",
        escalationEffort: "high" as const,
      },
    };
    for (const attempt of [1, 2]) {
      const policy = resolveTaskModelPolicy({
        profile: "balanced",
        task: "artifact_builder",
        attempt,
        overrides,
      });
      expect(policy.instanceId).toBe(
        attempt === 1 ? "codex-work" : "claude-personal",
      );
      expect(policy.model).toBe(
        attempt === 1 ? "gpt-builder" : "claude-review",
      );
      await createWorkflowModelRuntime({})
        .startThread({
          studyBuddyInstanceId: policy.instanceId,
          model: policy.model,
          modelReasoningEffort: policy.reasoningEffort,
        })
        .run("Exact evidence α");
      const init = vi.mocked(fetch).mock.lastCall![1]!;
      expect(JSON.parse(init.body as string)).toMatchObject({
        instanceId: policy.instanceId,
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        prompt: "Exact evidence α",
      });
    }
  });

  it("refuses explicit native assignments outside the authenticated desktop", () => {
    expect(() =>
      createWorkflowModelRuntime({}).startThread({
        studyBuddyInstanceId: "antigravity",
        model: "gemini",
      }),
    ).toThrow("active Study Buddy desktop connection");
  });

  it("fails closed on unavailable providers and honors cancellation", async () => {
    bridge("claude", "claude-sonnet");
    const request = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 409 }));
    vi.stubGlobal("fetch", request);
    const thread = createWorkflowModelRuntime({}).startThread({});
    await expect(thread.run("evidence")).rejects.toThrow(
      "Assigned provider or model unavailable (409)",
    );
    await expect(
      thread.run("evidence", { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, false],
    [402, false],
    [429, true],
    [503, true],
    [409, true],
    [502, false],
  ] as const)(
    "preserves safe failure categories for HTTP %s",
    async (status, fallback) => {
      bridge("antigravity", "gemini");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("private stderr must not escape", { status }),
          ),
      );
      const failure = await createWorkflowModelRuntime({})
        .startThread({})
        .run("evidence")
        .catch((error: unknown) => error);
      expect(String(failure)).not.toContain("private stderr");
      expect(
        shouldTryModelFallback("failed", classifyCodexError(failure)),
      ).toBe(fallback);
    },
  );

  it("rejects remote endpoints and incomplete credentials", () => {
    expect(() =>
      workflowModelBridgeEnvironment({
        STUDY_BUDDY_MODEL_BRIDGE_URL: "https://example.com",
      }),
    ).toThrow("loopback");
    expect(() =>
      workflowModelBridgeEnvironment({
        STUDY_BUDDY_MODEL_BRIDGE_URL: "http://127.0.0.1:12345",
      }),
    ).toThrow("incomplete");
  });

  it.each(["claudeAgent", "antigravity"])(
    "cancels an in-flight %s worker without a fallback request",
    async (provider) => {
      bridge(provider, "selected-model");
      const controller = new AbortController();
      let started!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const request = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            expect(init.signal).toBe(controller.signal);
            init.signal!.addEventListener(
              "abort",
              () => reject(init.signal!.reason),
              { once: true },
            );
            started();
          }),
      );
      vi.stubGlobal("fetch", request);
      const result = createWorkflowModelRuntime({})
        .startThread({})
        .run("Evidence", { signal: controller.signal });
      const rejected = expect(result).rejects.toThrow("cancelled by user");
      await entered;
      controller.abort(new Error("cancelled by user"));
      await rejected;
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["claudeAgent", "antigravity"])(
    "rejects malformed %s worker responses",
    async (provider) => {
      bridge(provider, "selected-model");
      const request = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ text: 42 })));
      vi.stubGlobal("fetch", request);
      await expect(
        createWorkflowModelRuntime({}).startThread({}).run("Evidence"),
      ).rejects.toThrow("Invalid workflow provider response");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
});
