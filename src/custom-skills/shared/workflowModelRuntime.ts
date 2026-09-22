import {
  Codex,
  type CodexOptions,
  type ThreadOptions,
  type Input,
  type TurnOptions,
  type RunResult,
} from "@openai/codex-sdk";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface WorkflowModelRuntime {
  startThread(options: ThreadOptions): {
    run(input: Input, options?: TurnOptions): Promise<RunResult>;
  };
}

export function workflowModelBridgeEnvironment(environment = process.env) {
  const url = environment.STUDY_BUDDY_MODEL_BRIDGE_URL;
  if (!url) {
    if (environment.STUDY_BUDDY_MODEL_BRIDGE_PROVIDER)
      throw new Error("Selected provider is missing its workflow endpoint.");
    return null;
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Study Buddy model bridge must use its local loopback endpoint.");
  }
  const token = environment.STUDY_BUDDY_MODEL_BRIDGE_TOKEN;
  const model = environment.STUDY_BUDDY_MODEL_BRIDGE_MODEL;
  const provider = environment.STUDY_BUDDY_MODEL_BRIDGE_PROVIDER;
  if (!token || !model || !provider)
    throw new Error("Study Buddy model bridge configuration is incomplete.");
  const threadId = environment.STUDY_BUDDY_MODEL_BRIDGE_THREAD;
  if (!threadId) throw new Error("Workflow thread context is missing.");
  return { url, token, model, provider, threadId };
}

/** Every workflow client uses the same selected, server-owned provider instance. */
export function createWorkflowModelRuntime(options: CodexOptions): WorkflowModelRuntime {
  const bridge = workflowModelBridgeEnvironment();
  if (!bridge) return new Codex(options);
  return {
    startThread: (_thread) => ({
      run: async (input, turn) => {
        turn?.signal?.throwIfAborted();
        const parts = typeof input === "string" ? [{ type: "text" as const, text: input }] : input;
        const prompt = parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        const images = await Promise.all(
          parts
            .filter((part) => part.type === "local_image")
            .map(async (part) => {
              if ((await stat(part.path)).size > 10 * 1024 * 1024)
                throw new Error("Workflow evidence image exceeds 10 MiB.");
              const bytes = await readFile(part.path);
              if (bytes.length > 10 * 1024 * 1024)
                throw new Error("Workflow evidence image exceeds 10 MiB.");
              const mimeType = (
                {
                  ".png": "image/png",
                  ".jpg": "image/jpeg",
                  ".jpeg": "image/jpeg",
                  ".webp": "image/webp",
                } as Record<string, string>
              )[path.extname(part.path).toLowerCase()];
              if (!mimeType) throw new Error("Unsupported workflow evidence image type.");
              return { mimeType, data: bytes.toString("base64") };
            }),
        );
        const response = await fetch(bridge.url, {
          method: "POST",
          redirect: "error",
          signal: turn?.signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${bridge.token}` },
          body: JSON.stringify({
            threadId: bridge.threadId,
            prompt,
            images,
            outputSchema: turn?.outputSchema,
          }),
        });
        if (!response.ok)
          throw new Error(
            `Selected ${bridge.provider} workflow request failed (${response.status}).`,
          );
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("text" in result) ||
          typeof result.text !== "string"
        )
          throw new Error("Invalid workflow provider response.");
        return { finalResponse: result.text, items: [], usage: null };
      },
    }),
  };
}
