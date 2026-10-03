// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  extractQuizMetadata,
  requiresFirstQuizAttempt,
  type QuizMetadata,
} from "./quizSafetyPolicy.js";
import type { AgentBrowserClient } from "./agentBrowserClient.js";
import type { MoodleRuntimeConfig } from "./types.js";
import {
  createFirstQuizAttemptRequestGuard,
  createReadOnlyQuizRequestGuard,
  assertNoFinalQuizSubmission,
} from "./quizAttemptRequestGuard.js";

/** These inputs are supplied by the authenticated broker, never a model request. */
export interface QuizAttemptGuardConfig {
  ledgerRoot: string;
  targetUrl: string;
  accountKey: string;
}
export interface FirstQuizAttemptBinding {
  version: 1;
  targetUrl: string;
  attemptId: string;
  attemptNumber: 1;
  boundAt: string;
}

export function installQuizInspectionGuard(client: AgentBrowserClient, targetUrl: string): void {
  if (!client.setQuizRequestGuard)
    throw new Error("Quiz inspection requires a browser with read-only request admission.");
  client.setQuizRequestGuard(createReadOnlyQuizRequestGuard(targetUrl));
}
export function releaseQuizInspectionForPractice(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
  metadata: QuizMetadata,
): void {
  if (!requiresFirstQuizAttempt(config.quizSafetyPolicy, metadata) && metadata.attemptsUnlimited) {
    client.setQuizRequestGuard?.(assertNoFinalQuizSubmission);
  }
}

function target(value: string): string {
  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    !/\/mod\/quiz\/view\.php$/.test(url.pathname) ||
    !/^\d+$/.test(url.searchParams.get("id") ?? "")
  ) {
    throw new Error("First-attempt guard requires an exact quiz view target.");
  }
  return `${url.origin}${url.pathname}?id=${url.searchParams.get("id")}`;
}
async function directory(config: QuizAttemptGuardConfig): Promise<string> {
  if (!path.isAbsolute(config.ledgerRoot) || !config.accountKey.trim())
    throw new Error("Missing trusted quiz ledger configuration.");
  const root = path.resolve(config.ledgerRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error("Quiz ledger root must not contain symlinks.");
  const key = createHash("sha256")
    .update(JSON.stringify([config.accountKey, target(config.targetUrl)]))
    .digest("hex");
  const dir = path.join(root, key);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink() || (await realpath(dir)) !== dir)
    throw new Error("Quiz ledger directory must not contain symlinks.");
  return dir;
}
async function read(
  config: QuizAttemptGuardConfig,
  name: string,
): Promise<Record<string, unknown> | null> {
  let handle;
  try {
    handle = await open(
      path.join(await directory(config), name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16_384)
      throw new Error("Invalid quiz ledger file.");
    const value: unknown = JSON.parse(await handle.readFile("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).version !== 1 ||
      (value as Record<string, unknown>).targetUrl !== target(config.targetUrl)
    )
      throw new Error("Invalid quiz ledger identity.");
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}
async function writeOnce(
  config: QuizAttemptGuardConfig,
  name: string,
  value: Record<string, unknown>,
): Promise<void> {
  const handle = await open(path.join(await directory(config), name), "wx", 0o600);
  try {
    await handle.writeFile(
      JSON.stringify({ version: 1, targetUrl: target(config.targetUrl), ...value }) + "\n",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function alreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

export async function reserveFirstQuizAttempt(
  config: QuizAttemptGuardConfig,
  metadata: QuizMetadata,
): Promise<void> {
  if (
    metadata.attemptsUsed !== 0 ||
    metadata.hasActiveAttempt ||
    metadata.activeAttemptId ||
    metadata.activeAttemptNumber != null ||
    !metadata.canStartNewAttempt ||
    metadata.availabilityStatus !== "open"
  ) {
    throw new Error("Positive first-attempt evidence is required before a new start.");
  }
  try {
    await writeOnce(config, "reservation.json", { reservedAt: new Date().toISOString() });
  } catch (error) {
    if (alreadyExists(error))
      throw new Error("First quiz attempt is already reserved; never start a replacement attempt.");
    throw error;
  }
}

/** Debit before forwarding the actual Moodle start POST, including after restarts. */
export async function consumeFirstQuizStartRequest(config: QuizAttemptGuardConfig): Promise<void> {
  if (!(await read(config, "reservation.json")))
    throw new Error("First quiz start requires a durable reservation.");
  try {
    await writeOnce(config, "start-requested.json", { requestedAt: new Date().toISOString() });
  } catch (error) {
    if (alreadyExists(error))
      throw new Error("First quiz start request was already consumed; never retry a new start.");
    throw error;
  }
}

export async function loadFirstQuizAttemptBinding(
  config: QuizAttemptGuardConfig,
): Promise<FirstQuizAttemptBinding | null> {
  const value = await read(config, "binding.json");
  if (!value) return null;
  if (
    value.attemptNumber !== 1 ||
    !/^\d+$/.test(String(value.attemptId ?? "")) ||
    typeof value.boundAt !== "string"
  )
    throw new Error("Invalid first quiz attempt binding.");
  return value as unknown as FirstQuizAttemptBinding;
}
export async function bindFirstQuizAttempt(
  config: QuizAttemptGuardConfig,
  proof: { attemptId: string; attemptNumber: number },
): Promise<FirstQuizAttemptBinding> {
  if (proof.attemptNumber !== 1 || !/^\d+$/.test(proof.attemptId))
    throw new Error("Only a positively identified first attempt can be bound.");
  if (!(await read(config, "reservation.json")))
    throw new Error("First attempt binding requires a start reservation.");
  if (!(await read(config, "start-requested.json")))
    throw new Error("First attempt binding requires a consumed start request or proven recovery.");
  const existing = await loadFirstQuizAttemptBinding(config);
  if (existing) {
    if (existing.attemptId !== proof.attemptId)
      throw new Error("A different quiz attempt is already bound.");
    return existing;
  }
  const binding: FirstQuizAttemptBinding = {
    version: 1,
    targetUrl: target(config.targetUrl),
    attemptId: proof.attemptId,
    attemptNumber: 1,
    boundAt: new Date().toISOString(),
  };
  try {
    await writeOnce(config, "binding.json", { ...binding });
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
  const stored = await loadFirstQuizAttemptBinding(config);
  if (!stored || stored.attemptId !== proof.attemptId)
    throw new Error("A different quiz attempt is already bound.");
  return stored;
}
export async function reconcileFirstQuizAttempt(
  config: QuizAttemptGuardConfig,
  metadata: QuizMetadata,
): Promise<FirstQuizAttemptBinding> {
  if (
    !metadata.hasActiveAttempt ||
    metadata.attemptsUsed !== 1 ||
    metadata.activeAttemptNumber !== 1
  )
    throw new Error("Recovery requires the active first attempt, never a new start.");
  if (!metadata.activeAttemptId)
    throw new Error("Recovery requires positive active attempt identity.");
  if (!(await read(config, "reservation.json"))) {
    try {
      await writeOnce(config, "reservation.json", {
        reservedAt: new Date().toISOString(),
        recovered: true,
      });
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
  }
  // A recovered existing first attempt also exhausts the right to issue any new start.
  try {
    await writeOnce(config, "start-requested.json", {
      requestedAt: new Date().toISOString(),
      recovered: true,
    });
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
  return bindFirstQuizAttempt(config, { attemptId: metadata.activeAttemptId, attemptNumber: 1 });
}
export function assertSameQuizAttempt(binding: FirstQuizAttemptBinding, attemptUrl: string): void {
  const expected = new URL(binding.targetUrl),
    actual = new URL(attemptUrl);
  if (
    actual.origin !== expected.origin ||
    actual.username ||
    actual.password ||
    !/\/mod\/quiz\/(?:attempt|summary)\.php$/.test(actual.pathname) ||
    actual.searchParams.get("attempt") !== binding.attemptId
  ) {
    throw new Error("Recovery and mutations must remain in the same bound first quiz attempt.");
  }
}

function installGuard(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
  targetUrl: string,
): QuizAttemptGuardConfig {
  if (
    !config.quizAttemptLedgerRoot ||
    !config.quizAttemptAccountKey ||
    !client.setQuizRequestGuard
  ) {
    throw new Error(
      "First-attempt mutations require the trusted ledger and guarded browser backend.",
    );
  }
  const guard = {
    ledgerRoot: config.quizAttemptLedgerRoot,
    accountKey: config.quizAttemptAccountKey,
    targetUrl,
  };
  client.setQuizRequestGuard(
    createFirstQuizAttemptRequestGuard({
      targetUrl,
      loadBinding: () => loadFirstQuizAttemptBinding(guard),
      debitStartBeforeForward: () => consumeFirstQuizStartRequest(guard),
    }),
  );
  return guard;
}
async function bindLiveFirst(
  config: QuizAttemptGuardConfig,
  client: AgentBrowserClient,
): Promise<FirstQuizAttemptBinding> {
  const attemptUrl = await client.getUrl();
  let live = await extractQuizMetadata(client);
  if (live.activeAttemptNumber !== 1 || !live.activeAttemptId) {
    // The attempt page may omit its ordinal. Read the native overview, never a start endpoint.
    await client.open(config.targetUrl);
    live = await extractQuizMetadata(client);
    const binding = await reconcileFirstQuizAttempt(config, live);
    assertSameQuizAttempt(binding, attemptUrl);
    await client.open(attemptUrl);
    return binding;
  }
  const binding = await reconcileFirstQuizAttempt(config, live);
  assertSameQuizAttempt(binding, attemptUrl);
  return binding;
}
/** Both legacy start sites share this guard; direct tools use the same primitives. */
export async function openFirstQuizAttempt<T>(input: {
  config: MoodleRuntimeConfig;
  client: AgentBrowserClient;
  targetUrl: string;
  metadata: QuizMetadata;
  open: (continueOnly: boolean) => Promise<T>;
}): Promise<T> {
  if (!requiresFirstQuizAttempt(input.config.quizSafetyPolicy, input.metadata))
    return input.open(input.metadata.hasActiveAttempt);
  const guard = installGuard(input.config, input.client, input.targetUrl);
  if (input.metadata.hasActiveAttempt) await reconcileFirstQuizAttempt(guard, input.metadata);
  else await reserveFirstQuizAttempt(guard, input.metadata);
  const result = await input.open(input.metadata.hasActiveAttempt);
  await bindLiveFirst(guard, input.client);
  return result;
}
export async function assertFirstQuizAttemptContext(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
  targetUrl: string,
  metadata: QuizMetadata | undefined,
): Promise<void> {
  if (!requiresFirstQuizAttempt(config.quizSafetyPolicy, metadata)) return;
  const guard = installGuard(config, client, targetUrl);
  const binding =
    (await loadFirstQuizAttemptBinding(guard)) ?? (await bindLiveFirst(guard, client));
  assertSameQuizAttempt(binding, await client.getUrl());
}
