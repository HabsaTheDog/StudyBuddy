import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const contextSchema = z.object({
  turnId: z.string().min(1),
  originalUserPrompt: z.string().min(1),
  images: z.array(z.string().refine(path.isAbsolute)),
});

/** App-owned evidence is authoritative; coordinator paraphrases are not source material. */
export async function connectWorkflowContext(
  cancellation: AbortController,
  environment: NodeJS.ProcessEnv = process.env,
  pollMs = 3_000,
) {
  const threadId = environment.STUDY_BUDDY_THREAD_ID ?? environment.STUDY_BUDDY_MODEL_BRIDGE_THREAD;
  if (!threadId) return null;
  let url = environment.STUDY_BUDDY_MODEL_BRIDGE_URL;
  let token = environment.STUDY_BUDDY_MODEL_BRIDGE_TOKEN;
  if (!url && environment.STUDY_BUDDY_CONFIG_ROOT) {
    const runtime = z.object({
      port: z.number().int().min(1).max(65535), workflowToken: z.string().min(1),
    }).parse(JSON.parse(await readFile(path.join(environment.STUDY_BUDDY_CONFIG_ROOT, "server-runtime.json"), "utf8")));
    url = `http://127.0.0.1:${runtime.port}/api/study-buddy/model`;
    token = runtime.workflowToken;
  }
  if (!url || !token) throw new Error("Workflow owner context is unavailable.");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password)
    throw new Error("Workflow context must use the local Study Buddy endpoint.");
  const readContext = async () => {
    const response = await fetch(endpoint, {
      method: "POST", redirect: "error",
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10_000)]),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ threadId, context: true, prompt: "", images: [] }),
    });
    if (!response.ok) throw new Error(`Workflow owner is unavailable (${response.status}).`);
    return contextSchema.parse(await response.json());
  };
  const context = await readContext();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const poll = async () => {
    try {
      const current = await readContext();
      if (current.turnId !== context.turnId) throw new Error("Workflow owner turn changed.");
    } catch (error) {
      if (!stopped) cancellation.abort(error);
    }
    if (!stopped && !cancellation.signal.aborted) timer = setTimeout(poll, pollMs);
  };
  timer = setTimeout(poll, pollMs);
  return { ...context, dispose: () => { stopped = true; clearTimeout(timer); } };
}
