import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isNonRetryableCodexError, NonRetryableCodexError } from "../moodle/codexClient.js";
import { resolveTaskModelPolicy, STUDY_BUDDY_MODEL_POLICY_VERSION, type ResolveTaskModelPolicyInput, type StudyBuddyModelOperation } from "./modelPolicy.js";
import { STUDY_BUDDY_MODEL_TASKS } from "./modelTaskCatalog.js";

export const semanticHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function operationPolicyFingerprint(
  config: { executionProfile?: ResolveTaskModelPolicyInput["profile"]; codexModel?: string; codexReasoningEffort?: ResolveTaskModelPolicyInput["globalReasoningEffort"]; modelPolicyOverrides?: ResolveTaskModelPolicyInput["overrides"]; modelCompatibilityFallbacks?: Record<string, string> },
  operation: StudyBuddyModelOperation,
): string {
  const task = STUDY_BUDDY_MODEL_TASKS.find(entry => entry.id === operation)!.task;
  const input = { profile: config.executionProfile ?? "balanced", task, operation,
    globalModel: config.codexModel, globalReasoningEffort: config.codexReasoningEffort,
    overrides: config.modelPolicyOverrides, compatibilityFallbacks: config.modelCompatibilityFallbacks };
  return semanticHash([STUDY_BUDDY_MODEL_POLICY_VERSION, ...[1, 2].map(attempt => resolveTaskModelPolicy({ ...input, attempt }))]);
}

export class OperationBudgetError extends NonRetryableCodexError {
  constructor(key: string) { super(`Operation ${key} exhausted three persisted attempts; preserve the checkpoint for review.`, "invalid_request"); }
}

const recordSchema = z.object({
  version: z.literal(1), key: z.string(), bindingHash: z.string(), policy: z.string(),
  attempts: z.number().int().min(0).max(3), status: z.enum(["pending", "failed", "complete"]),
  value: z.unknown().optional(), valueHash: z.string().optional(), error: z.string().optional(),
});
const locks = new Map<string, Promise<unknown>>();

/** One owner for a logical operation across nested retries and resume. Provider
 * transport fallback is separately bounded and does not reset this budget. */
export async function checkpointOperation<T>(input: {
  runDir: string; resumeRunDir?: string; key: string; binding: unknown; policy: string;
  signal?: AbortSignal;
  run: (attempt: number, previousError: string | undefined) => Promise<T>;
  validate: (value: unknown) => T;
}): Promise<T> {
  const bindingHash = semanticHash(input.binding);
  const filename = `${semanticHash([input.key, bindingHash])}.json`;
  const destination = path.join(input.runDir, "operation-checkpoints", filename);
  const previous = locks.get(destination) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    let attempts = 0;
    let previousError: string | undefined;
    let completed: z.infer<typeof recordSchema> | undefined;
    for (const root of [...new Set([input.runDir, input.resumeRunDir].filter((value): value is string => Boolean(value)))]) {
      let raw: string;
      try { raw = await readFile(path.join(root, "operation-checkpoints", filename), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      const record = recordSchema.parse(JSON.parse(raw));
      if (record.key !== input.key || record.bindingHash !== bindingHash) throw new Error("Operation checkpoint binding mismatch.");
      attempts = Math.max(attempts, record.attempts);
      previousError ??= record.error;
      if (record.status === "complete" && record.policy === input.policy) {
        if (record.valueHash !== semanticHash(record.value)) throw new Error("Operation checkpoint content hash mismatch.");
        completed ??= record;
      }
    }
    const persist = async (record: z.infer<typeof recordSchema>) => {
      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(record) + "\n", { mode: 0o600 });
      await rename(temporary, destination);
    };
    const event = async (status: string) => appendFile(path.join(input.runDir, "operation-events.jsonl"), JSON.stringify({
      key: input.key, bindingHash, policy: input.policy, attempts, status, at: new Date().toISOString(),
    }) + "\n");
    input.signal?.throwIfAborted();
    if (completed) {
      const value = input.validate(completed.value);
      await persist({ ...completed, attempts });
      await event("reused");
      return value;
    }
    while (attempts < 3) {
      input.signal?.throwIfAborted();
      attempts += 1;
      const record = { version: 1 as const, key: input.key, bindingHash, policy: input.policy, attempts, status: "pending" as const };
      await persist(record); // Crash/cancellation cannot replenish an attempt.
      try {
        const value = input.validate(await input.run(attempts, previousError));
        input.signal?.throwIfAborted();
        await persist({ ...record, status: "complete", value, valueHash: semanticHash(value) });
        await event("completed");
        return value;
      } catch (error) {
        previousError = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
        await persist({ ...record, status: "failed", error: previousError });
        await event("failed");
        if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError") || isNonRetryableCodexError(error)) throw error;
      }
    }
    throw new OperationBudgetError(input.key);
  });
  locks.set(destination, work);
  try { return await work; }
  finally { if (locks.get(destination) === work) locks.delete(destination); }
}

/** Reserve before a call when its caller already owns validation and retries.
 * The stable unit key deliberately excludes model, attempt and repair feedback. */
export async function reserveOperationAttempt(input: {
  runDir: string; resumeRunDir?: string; key: string; binding: unknown; signal?: AbortSignal;
}): Promise<number> {
  const fingerprint = semanticHash([input.key, input.binding]);
  const relative = path.join("operation-budgets", `${fingerprint}.json`);
  const destination = path.join(input.runDir, relative);
  const previous = locks.get(destination) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    input.signal?.throwIfAborted();
    let attempts = 0;
    for (const root of [...new Set([input.runDir, input.resumeRunDir].filter((value): value is string => Boolean(value)))]) {
      try {
        const record = z.object({ fingerprint: z.literal(fingerprint), attempts: z.number().int().min(1).max(3) })
          .parse(JSON.parse(await readFile(path.join(root, relative), "utf8")));
        attempts = Math.max(attempts, record.attempts);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (attempts >= 3) throw new OperationBudgetError(input.key);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ fingerprint, attempts: attempts + 1 }) + "\n", { mode: 0o600 });
    await rename(temporary, destination);
    return attempts + 1;
  });
  locks.set(destination, work);
  try { return await work; }
  finally { if (locks.get(destination) === work) locks.delete(destination); }
}
