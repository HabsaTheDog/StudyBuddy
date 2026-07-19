import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StudyBuddyExecutionProfile, StudyBuddyModelTask, StudyBuddyReasoningEffort } from "./modelPolicy.js";
import type { StudyBuddyUserPhase } from "./runProgress.js";

export interface ModelTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ModelCallMetric extends ModelTokenUsage {
  id: string;
  task: StudyBuddyModelTask;
  attempt: number;
  model: string;
  reasoningEffort: StudyBuddyReasoningEffort;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  queuedAt?: string;
  queueWaitMs?: number;
  requestCharacters?: number;
  schemaCharacters?: number;
  status: "completed" | "failed" | "timeout" | "canceled";
  errorCategory?: string;
}

export interface PhaseMetric {
  phase: StudyBuddyUserPhase;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface ExecutionMetricsSnapshot {
  schemaVersion: 1;
  policyVersion: string;
  profile: StudyBuddyExecutionProfile;
  status: "running" | "success" | "partial" | "failed" | "timeout" | "canceled";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  wallMs: number;
  configuredDownloadConcurrency: number;
  totals: ModelTokenUsage & {
    modelCalls: number;
    modelDurationMs: number;
    modelQueueWaitMs: number;
    retries: number;
  };
  phases: PhaseMetric[];
  modelCalls: ModelCallMetric[];
  resources: {
    discovered: number;
    selected: number;
    started: number;
    completed: number;
    failed: number;
    timedOut: number;
    canceled: number;
    bytes: number;
  };
}

export class ExecutionTelemetry {
  readonly metricsPath: string;
  readonly spansPath: string;
  private readonly runDir: string;
  private snapshot: ExecutionMetricsSnapshot;
  private currentPhase: { phase: StudyBuddyUserPhase; startedAt: string } | null = null;
  private queue: Promise<void> = Promise.resolve();
  private runtimeBudgetPauseDepth = 0;
  private runtimeBudgetPausedAt: number | null = null;
  private runtimeBudgetPausedMs = 0;

  constructor(input: {
    runDir: string;
    policyVersion: string;
    profile: StudyBuddyExecutionProfile;
    configuredDownloadConcurrency: number;
  }) {
    this.runDir = input.runDir;
    this.metricsPath = path.join(input.runDir, "run-metrics.json");
    this.spansPath = path.join(input.runDir, "run-spans.jsonl");
    const now = new Date().toISOString();
    this.snapshot = {
      schemaVersion: 1,
      policyVersion: input.policyVersion,
      profile: input.profile,
      status: "running",
      startedAt: now,
      updatedAt: now,
      wallMs: 0,
      configuredDownloadConcurrency: input.configuredDownloadConcurrency,
      totals: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        modelCalls: 0,
        modelDurationMs: 0,
        modelQueueWaitMs: 0,
        retries: 0,
      },
      phases: [],
      modelCalls: [],
      resources: {
        discovered: 0,
        selected: 0,
        started: 0,
        completed: 0,
        failed: 0,
        timedOut: 0,
        canceled: 0,
        bytes: 0,
      },
    };
  }

  async init(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    await writeFile(this.spansPath, "", "utf8");
    await this.persist();
  }

  getSnapshot(): ExecutionMetricsSnapshot {
    return structuredClone(this.snapshot);
  }

  get runtimeBudgetPaused(): boolean {
    return this.runtimeBudgetPauseDepth > 0;
  }

  getRuntimeBudgetPausedMs(at = Date.now()): number {
    const activePauseMs = this.runtimeBudgetPausedAt === null
      ? 0
      : Math.max(0, at - this.runtimeBudgetPausedAt);
    return this.runtimeBudgetPausedMs + activePauseMs;
  }

  pauseRuntimeBudget(at = Date.now()): (resumedAt?: number) => void {
    if (this.runtimeBudgetPauseDepth === 0) this.runtimeBudgetPausedAt = at;
    this.runtimeBudgetPauseDepth += 1;
    let resumed = false;
    return (resumedAt = Date.now()) => {
      if (resumed) return;
      resumed = true;
      this.runtimeBudgetPauseDepth = Math.max(0, this.runtimeBudgetPauseDepth - 1);
      if (this.runtimeBudgetPauseDepth === 0 && this.runtimeBudgetPausedAt !== null) {
        this.runtimeBudgetPausedMs += Math.max(0, resumedAt - this.runtimeBudgetPausedAt);
        this.runtimeBudgetPausedAt = null;
      }
    };
  }

  async transitionPhase(phase: StudyBuddyUserPhase, at = new Date().toISOString()): Promise<void> {
    if (this.currentPhase?.phase === phase) return;
    return this.enqueue(async () => {
      if (this.currentPhase) {
        const closed = closePhase(this.currentPhase, at);
        this.snapshot.phases.push(closed);
        await this.appendSpan({ type: "phase", ...closed });
      }
      this.currentPhase = { phase, startedAt: at };
      await this.persist();
    });
  }

  async recordModelCall(metric: ModelCallMetric): Promise<void> {
    return this.enqueue(async () => {
      this.snapshot.modelCalls.push(metric);
      this.snapshot.totals.inputTokens += metric.inputTokens;
      this.snapshot.totals.cachedInputTokens += metric.cachedInputTokens;
      this.snapshot.totals.outputTokens += metric.outputTokens;
      this.snapshot.totals.reasoningOutputTokens += metric.reasoningOutputTokens;
      this.snapshot.totals.modelCalls += 1;
      this.snapshot.totals.modelDurationMs += metric.durationMs;
      this.snapshot.totals.modelQueueWaitMs += metric.queueWaitMs ?? 0;
      if (metric.attempt > 1) this.snapshot.totals.retries += 1;
      await this.appendSpan({ type: "model_call", ...metric });
      await this.persist();
    });
  }

  async recordResourcePlan(discovered: number, selected: number): Promise<void> {
    return this.enqueue(async () => {
      this.snapshot.resources.discovered = Math.max(this.snapshot.resources.discovered, discovered);
      this.snapshot.resources.selected = Math.max(this.snapshot.resources.selected, selected);
      await this.persist();
    });
  }

  async recordResourceAttempt(
    status: "started" | "completed" | "failed" | "timed_out" | "canceled",
    bytes = 0,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (status === "started") this.snapshot.resources.started += 1;
      if (status === "completed") this.snapshot.resources.completed += 1;
      if (status === "failed") this.snapshot.resources.failed += 1;
      if (status === "timed_out") this.snapshot.resources.timedOut += 1;
      if (status === "canceled") this.snapshot.resources.canceled += 1;
      if (status === "completed") this.snapshot.resources.bytes += Math.max(0, bytes);
      await this.persist();
    });
  }

  async complete(status: ExecutionMetricsSnapshot["status"]): Promise<void> {
    const completedAt = new Date().toISOString();
    return this.enqueue(async () => {
      if (this.currentPhase) {
        const closed = closePhase(this.currentPhase, completedAt);
        this.snapshot.phases.push(closed);
        await this.appendSpan({ type: "phase", ...closed });
        this.currentPhase = null;
      }
      this.snapshot.status = status;
      this.snapshot.completedAt = completedAt;
      await this.persist();
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async appendSpan(value: Record<string, unknown>): Promise<void> {
    await appendFile(this.spansPath, `${JSON.stringify(value)}\n`, "utf8");
  }

  private async persist(): Promise<void> {
    const now = new Date().toISOString();
    this.snapshot.updatedAt = now;
    this.snapshot.wallMs = Math.max(0, Date.parse(now) - Date.parse(this.snapshot.startedAt));
    const temporaryPath = `${this.metricsPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.metricsPath);
  }
}

function closePhase(
  current: { phase: StudyBuddyUserPhase; startedAt: string },
  completedAt: string,
): PhaseMetric {
  return {
    phase: current.phase,
    startedAt: current.startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(current.startedAt)),
  };
}
