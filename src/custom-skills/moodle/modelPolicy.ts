export const STUDY_BUDDY_MODEL_POLICY_VERSION = "2026-09-13.1-task-overrides";

export type StudyBuddyExecutionProfile = "auto" | "fast" | "balanced" | "quality" | "custom";

import { STUDY_BUDDY_MODEL_TASKS, type StudyBuddyModelTask, type StudyBuddyModelOperation, type StudyBuddyModelPolicyKey } from "../shared/modelTaskCatalog.js";
export type { StudyBuddyModelTask, StudyBuddyModelOperation, StudyBuddyModelPolicyKey } from "../shared/modelTaskCatalog.js";

export type StudyBuddyReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface StudyBuddyTaskModelPolicy {
  model: string;
  reasoningEffort: StudyBuddyReasoningEffort;
  timeoutMs: number;
  escalationModel?: string;
  escalationEffort?: StudyBuddyReasoningEffort;
  escalationTimeoutMs?: number;
}

export type StudyBuddyModelPolicyOverrides = Partial<
  Record<StudyBuddyModelPolicyKey, Partial<StudyBuddyTaskModelPolicy>>
>;

export interface ResolveTaskModelPolicyInput {
  profile: StudyBuddyExecutionProfile;
  task: StudyBuddyModelTask;
  operation?: StudyBuddyModelOperation | undefined;
  attempt?: number;
  globalModel?: string;
  globalReasoningEffort?: StudyBuddyReasoningEffort;
  overrides?: StudyBuddyModelPolicyOverrides;
}

const PROFILE_POLICIES: Record<
  Exclude<StudyBuddyExecutionProfile, "custom">,
  Record<StudyBuddyModelTask, StudyBuddyTaskModelPolicy>
> = {
  auto: {
    source_search: { model: "gpt-5.6-luna", reasoningEffort: "medium", timeoutMs: 90_000, escalationModel: "gpt-5.6-terra", escalationEffort: "medium", escalationTimeoutMs: 90_000 },
    artifact_planner: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
      escalationTimeoutMs: 3 * 60_000,
    },
    content_analyzer: {
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "medium",
      escalationTimeoutMs: 90_000,
    },
    content_repair: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 150_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "xhigh",
      escalationTimeoutMs: 180_000,
    },
    quiz_solver: {
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 6 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
      escalationTimeoutMs: 8 * 60_000,
    },
    artifact_builder: {
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
      escalationTimeoutMs: 6 * 60_000,
    },
    artifact_repair: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "xhigh",
      escalationTimeoutMs: 6 * 60_000,
    },
    quality_reviewer: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 2 * 60_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "medium",
      escalationTimeoutMs: 2 * 60_000,
    },
  },
  fast: {
    source_search: { model: "gpt-5.6-luna", reasoningEffort: "medium", timeoutMs: 90_000, escalationModel: "gpt-5.6-terra", escalationEffort: "medium", escalationTimeoutMs: 90_000 },
    artifact_planner: {
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "high",
      escalationTimeoutMs: 2 * 60_000,
    },
    content_analyzer: {
      model: "gpt-5.6-luna",
      // Luna high-effort requests can remain queued without token usage on the
      // current runtime. Medium is the validated low-latency operating point.
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "high",
      escalationTimeoutMs: 90_000,
    },
    content_repair: {
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 120_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
      escalationTimeoutMs: 180_000,
    },
    quiz_solver: {
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "high",
      escalationTimeoutMs: 6 * 60_000,
    },
    artifact_builder: {
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      timeoutMs: 2 * 60_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "high",
      escalationTimeoutMs: 4 * 60_000,
    },
    artifact_repair: {
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 3 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
      escalationTimeoutMs: 5 * 60_000,
    },
    quality_reviewer: {
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 2 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
      escalationTimeoutMs: 4 * 60_000,
    },
  },
  balanced: {
    source_search: { model: "gpt-5.6-luna", reasoningEffort: "medium", timeoutMs: 90_000, escalationModel: "gpt-5.6-terra", escalationEffort: "medium", escalationTimeoutMs: 90_000 },
    artifact_planner: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
      escalationTimeoutMs: 3 * 60_000,
    },
    content_analyzer: {
      // Live cross-checks showed that Luna needed targeted repairs for half of
      // the quantitative DYN2 chapter fragments and emitted surplus topics in
      // both HTML batches. Starting bounded Balanced analysis on Terra avoids
      // those duplicate calls while Sol remains reserved for true escalation.
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 120_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
      escalationTimeoutMs: 180_000,
    },
    content_repair: {
      // One bounded Terra worker is the validated repair path for compact,
      // structured chapter batches. Sol high/xhigh repeatedly exhausted the
      // 180-second leaf-worker window without tokens; keep Sol medium as the
      // second escalation instead of making the first repair slower.
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 150_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
      escalationTimeoutMs: 180_000,
    },
    quiz_solver: {
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 6 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
      escalationTimeoutMs: 8 * 60_000,
    },
    artifact_builder: {
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
      escalationTimeoutMs: 6 * 60_000,
    },
    artifact_repair: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "xhigh",
      escalationTimeoutMs: 6 * 60_000,
    },
    quality_reviewer: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "medium",
      escalationTimeoutMs: 2 * 60_000,
    },
  },
  quality: {
    source_search: { model: "gpt-5.6-luna", reasoningEffort: "medium", timeoutMs: 90_000, escalationModel: "gpt-5.6-terra", escalationEffort: "medium", escalationTimeoutMs: 90_000 },
    artifact_planner: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 150_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "xhigh",
      escalationTimeoutMs: 180_000,
    },
    content_analyzer: {
      // Chapter analyzers run concurrently. Terra provides the necessary
      // structured depth without the long queue observed when parallel Sol
      // calls are used; a failed validation still escalates to Sol.
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 120_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
      escalationTimeoutMs: 150_000,
    },
    content_repair: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 150_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "xhigh",
      escalationTimeoutMs: 210_000,
    },
    quiz_solver: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 4 * 60_000,
      escalationEffort: "xhigh",
      escalationTimeoutMs: 6 * 60_000,
    },
    artifact_builder: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 3 * 60_000,
      escalationEffort: "xhigh",
      escalationTimeoutMs: 4 * 60_000,
    },
    artifact_repair: {
      model: "gpt-5.6-sol",
      reasoningEffort: "xhigh",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "xhigh",
      escalationTimeoutMs: 5 * 60_000,
    },
    quality_reviewer: {
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "high",
      escalationTimeoutMs: 120_000,
    },
  },
};

export function resolveTaskModelPolicy(
  input: ResolveTaskModelPolicyInput,
): StudyBuddyTaskModelPolicy {
  const profile = input.profile === "custom"
    ? "balanced"
    : input.profile === "auto"
      ? "quality"
      : input.profile;
  const base = PROFILE_POLICIES[profile][input.task];
  const operation = input.operation && STUDY_BUDDY_MODEL_TASKS.find((entry) => entry.id === input.operation);
  if (input.operation && (!operation || operation.task !== input.task)) {
    throw new Error(`Unknown or mismatched model task ${input.operation} (${input.task}).`);
  }
  const inheritedTask = input.task === "content_repair" || input.task === "source_search"
    ? "content_analyzer"
    : input.task === "artifact_repair" ? "artifact_builder" : input.task;
  const override = {
    ...input.overrides?.[inheritedTask],
    ...input.overrides?.[input.task],
    ...(input.operation ? input.overrides?.[input.operation] : undefined),
  };
  const configured: StudyBuddyTaskModelPolicy = {
    ...base,
    ...override,
    model: input.globalModel ?? override?.model ?? base.model,
    reasoningEffort:
      input.globalReasoningEffort ?? override?.reasoningEffort ?? base.reasoningEffort,
  };

  if ((input.attempt ?? 1) <= 1) {
    return configured;
  }

  return {
    ...configured,
    model: input.globalModel ?? configured.escalationModel ?? configured.model,
    reasoningEffort:
      input.globalReasoningEffort ??
      configured.escalationEffort ??
      nextReasoningEffort(configured.reasoningEffort),
    timeoutMs: configured.escalationTimeoutMs ?? configured.timeoutMs,
  };
}

export function parseExecutionProfile(value: string | undefined): StudyBuddyExecutionProfile {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "fast" ||
    normalized === "balanced" ||
    normalized === "quality" ||
    normalized === "custom"
  ) {
    return normalized;
  }
  if (!normalized) return "auto";
  throw new Error(`Expected execution profile auto, fast, balanced, quality, or custom, got ${value}`);
}

export function parseReasoningEffort(value: string | undefined): StudyBuddyReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "none") return "minimal";
  if (
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized;
  }
  throw new Error(`Expected reasoning effort none/minimal, low, medium, high, or xhigh, got ${value}`);
}

export function parseModelPolicyOverrides(
  value: string | undefined,
): StudyBuddyModelPolicyOverrides | undefined {
  if (!value?.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Expected profile overrides to be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected profile overrides to be a JSON object.");
  }

  const tasks: StudyBuddyModelPolicyKey[] = [
    "source_search",
    "content_analyzer",
    "content_repair",
    "quiz_solver",
    "artifact_planner",
    "artifact_builder",
    "artifact_repair",
    "quality_reviewer",
    ...STUDY_BUDDY_MODEL_TASKS.map((entry) => entry.id),
  ];
  for (const key of Object.keys(parsed)) {
    if (!tasks.includes(key as StudyBuddyModelPolicyKey)) throw new Error(`Unknown model task override: ${key}`);
  }
  const result: StudyBuddyModelPolicyOverrides = {};
  for (const task of tasks) {
    const raw = (parsed as Record<string, unknown>)[task];
    if (raw === undefined) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Expected ${task} profile override to be an object.`);
    }
    const record = raw as Record<string, unknown>;
    const model = requiredModel(record.model, `${task}.model`);
    const escalationModel = requiredModel(
      record.escalationModel ?? record.retryModel,
      `${task}.retryModel`,
    );
    const reasoningEffort = parseReasoningEffort(
      requiredString(record.reasoningEffort, `${task}.reasoningEffort`),
    );
    const escalationEffort = parseReasoningEffort(
      requiredString(
        record.escalationEffort ?? record.retryReasoningEffort,
        `${task}.retryReasoningEffort`,
      ),
    );
    result[task] = {
      model,
      reasoningEffort,
      escalationModel,
      escalationEffort,
    };
  }
  return result;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected ${field} to be a non-empty string.`);
  }
  return value.trim();
}

function requiredModel(value: unknown, field: string): string {
  const model = requiredString(value, field);
  if (!/^[a-zA-Z0-9._:/-]{1,160}$/.test(model)) {
    throw new Error(`Expected ${field} to be a valid model slug.`);
  }
  return model;
}

function nextReasoningEffort(value: StudyBuddyReasoningEffort): StudyBuddyReasoningEffort {
  switch (value) {
    case "minimal":
      return "low";
    case "low":
      return "medium";
    case "medium":
      return "high";
    case "high":
    case "xhigh":
      return "xhigh";
  }
}

/** Origin of the selected model/effort, persisted beside usage for task-level comparisons. */
export function taskModelPolicySource(input: ResolveTaskModelPolicyInput): string {
  if (input.globalModel || input.globalReasoningEffort) return "global override";
  if (input.operation && input.overrides?.[input.operation]) return `task:${input.operation}`;
  if (input.overrides?.[input.task]) {
    const kind = ["source_search", "content_repair", "artifact_repair"].includes(input.task) ? "task" : "role";
    return `${kind}:${input.task}`;
  }
  const parent = input.task === "content_repair" || input.task === "source_search" ? "content_analyzer"
    : input.task === "artifact_repair" ? "artifact_builder" : input.task;
  if (input.overrides?.[parent]) return `role:${parent}`;
  return `built-in:${input.profile === "custom" ? "balanced" : input.profile === "auto" ? "quality" : input.profile}`;
}
