export const STUDY_BUDDY_MODEL_POLICY_VERSION = "2026-07-14.1";

export type StudyBuddyExecutionProfile = "auto" | "fast" | "balanced" | "quality" | "custom";

export type StudyBuddyModelTask = "visual_planner" | "analyzer" | "formatter";

export type StudyBuddyReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface StudyBuddyTaskModelPolicy {
  model: string;
  reasoningEffort: StudyBuddyReasoningEffort;
  timeoutMs: number;
  escalationModel?: string;
  escalationEffort?: StudyBuddyReasoningEffort;
}

export type StudyBuddyModelPolicyOverrides = Partial<
  Record<StudyBuddyModelTask, Partial<StudyBuddyTaskModelPolicy>>
>;

export interface ResolveTaskModelPolicyInput {
  profile: StudyBuddyExecutionProfile;
  task: StudyBuddyModelTask;
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
    visual_planner: {
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "medium",
    },
    analyzer: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 6 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
    },
    formatter: {
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
    },
  },
  fast: {
    visual_planner: {
      model: "gpt-5.6-luna",
      reasoningEffort: "minimal",
      timeoutMs: 60_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "low",
    },
    analyzer: {
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "medium",
    },
    formatter: {
      model: "gpt-5.6-luna",
      reasoningEffort: "minimal",
      timeoutMs: 2 * 60_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "low",
    },
  },
  balanced: {
    visual_planner: {
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      timeoutMs: 90_000,
      escalationModel: "gpt-5.6-terra",
      escalationEffort: "medium",
    },
    analyzer: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 6 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
    },
    formatter: {
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      timeoutMs: 4 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "medium",
    },
  },
  quality: {
    visual_planner: {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      timeoutMs: 2 * 60_000,
      escalationModel: "gpt-5.6-sol",
      escalationEffort: "high",
    },
    analyzer: {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      timeoutMs: 8 * 60_000,
      escalationEffort: "xhigh",
    },
    formatter: {
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      timeoutMs: 6 * 60_000,
      escalationEffort: "high",
    },
  },
};

export function resolveTaskModelPolicy(
  input: ResolveTaskModelPolicyInput,
): StudyBuddyTaskModelPolicy {
  const profile = input.profile === "custom" ? "balanced" : input.profile;
  const base = PROFILE_POLICIES[profile][input.task];
  const override = input.overrides?.[input.task];
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
