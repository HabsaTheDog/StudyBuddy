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

export type WorkflowThreadOptions = ThreadOptions & {
  studyBuddyInstanceId?: string;
};

export interface WorkflowModelRuntime {
  startThread(options: WorkflowThreadOptions): {
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
    throw new Error(
      "Study Buddy model bridge must use its local loopback endpoint.",
    );
  }
  const token = environment.STUDY_BUDDY_MODEL_BRIDGE_TOKEN;
  const model = environment.STUDY_BUDDY_MODEL_BRIDGE_MODEL;
  const provider = environment.STUDY_BUDDY_MODEL_BRIDGE_PROVIDER;
  if (!token || !model || !provider)
    throw new Error("Study Buddy model bridge configuration is incomplete.");
  const threadId = environment.STUDY_BUDDY_MODEL_BRIDGE_THREAD;
  if (!threadId) throw new Error("Workflow thread context is missing.");
  return {
    url,
    token,
    model,
    provider,
    threadId,
    instanceId: environment.STUDY_BUDDY_MODEL_BRIDGE_INSTANCE ?? provider,
  };
}

/** Explicit profile assignments route through the server-owned provider registry. */
export function createWorkflowModelRuntime(
  options: CodexOptions,
): WorkflowModelRuntime {
  const bridge = workflowModelBridgeEnvironment();
  // The desktop provider owns its CLI version and account home. Using the
  // SDK's bundled binary here can reject models supported by the coordinator.
  const providerCodexPath = bridge?.provider === "codex"
    ? process.env.STUDY_BUDDY_CODEX_PATH?.trim()
    : undefined;
  const codex = new Codex({
    ...options,
    ...(providerCodexPath && !options.codexPathOverride
      ? { codexPathOverride: providerCodexPath }
      : {}),
  });
  if (!bridge)
    return {
      startThread: (thread) => {
        const { studyBuddyInstanceId, ...sdkOptions } = thread;
        if (studyBuddyInstanceId && studyBuddyInstanceId !== "codex")
          throw new Error(
            "Explicit provider assignments require an active Study Buddy desktop connection.",
          );
        return codex.startThread(sdkOptions);
      },
    };
  return {
    startThread: (thread) => {
      // Preserve the normal Codex SDK path and its usage accounting. A worker
      // assigned to another connection must use the authenticated bridge.
      const instanceId = thread.studyBuddyInstanceId ?? bridge.instanceId;
      if (bridge.provider === "codex" && instanceId === bridge.instanceId) {
        const { studyBuddyInstanceId: _instance, ...sdkOptions } = thread;
        return codex.startThread(sdkOptions);
      }
      return {
        run: async (input, turn) => {
          turn?.signal?.throwIfAborted();
          const parts =
            typeof input === "string"
              ? [{ type: "text" as const, text: input }]
              : input;
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
                if (!mimeType)
                  throw new Error("Unsupported workflow evidence image type.");
                return { mimeType, data: bytes.toString("base64") };
              }),
          );
          const response = await fetch(bridge.url, {
            method: "POST",
            redirect: "error",
            signal: turn?.signal,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${bridge.token}`,
            },
            body: JSON.stringify({
              threadId: bridge.threadId,
              instanceId,
              model: thread.model ?? bridge.model,
              reasoningEffort: thread.modelReasoningEffort,
              prompt,
              images,
              outputSchema: turn?.outputSchema,
            }),
          });
          if (!response.ok) {
            const failures: Record<number, string> = {
              401: "Provider authentication failed",
              402: "Provider usage limit reached",
              409: "Assigned provider or model unavailable",
              429: "Provider rate limit reached",
              503: "Provider model capacity unavailable",
            };
            throw new Error(
              `${failures[response.status] ?? "Selected provider workflow request failed"} (${response.status}).`,
            );
          }
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
      };
    },
  };
}
