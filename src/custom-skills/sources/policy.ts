import type { SourceBlock, SourceCapability, SourceOperationEffect } from "./types.js";

const CAPABILITY_EFFECTS: Readonly<Record<SourceCapability, SourceOperationEffect>> = {
  "content.search": "read",
  "content.list": "read",
  "content.read": "read",
  "content.download": "read",
  "calendar.events.read": "read",
  "course.structure.read": "read",
  "quiz.completed-attempt.read": "read",
  "mail.threads.list": "read",
  "mail.message.read": "read",
  "mail.attachment.read": "read",
  "mail.draft.local": "local-only",
  "mail.draft.remote": "reversible-write",
  "mail.send": "external-commit",
};

export interface SourceOperationDecision {
  capability: SourceCapability;
  effect: SourceOperationEffect;
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
}

export function decideSourceOperation(
  source: SourceBlock,
  capability: SourceCapability,
): SourceOperationDecision {
  if (!source.enabled || !source.capabilities.includes(capability)) {
    return denied(capability, "forbidden", "The source is disabled or does not declare this capability.");
  }

  const effect = CAPABILITY_EFFECTS[capability];
  if (capability === "mail.send") {
    return source.policy.emailSend === "approval-required"
      ? approved(capability, effect, true, "Exact, one-time native approval is required.")
      : denied(capability, "forbidden", "Automated email send is disabled for this source.");
  }
  if (capability === "mail.draft.remote") {
    return policyDecision(capability, effect, source.policy.remoteDrafts, "remote draft");
  }
  if (capability === "content.download" || capability === "mail.attachment.read") {
    return policyDecision(capability, effect, source.policy.downloads, "download");
  }
  if (effect === "read" && source.connectionId && source.policy.authenticatedReads !== "allowed") {
    return policyDecision(capability, effect, source.policy.authenticatedReads, "authenticated read");
  }
  return approved(capability, effect, false, "Allowed by the source policy.");
}

function policyDecision(
  capability: SourceCapability,
  effect: SourceOperationEffect,
  policy: "allowed" | "approval-required" | "denied",
  label: string,
): SourceOperationDecision {
  if (policy === "denied") return denied(capability, "forbidden", `The ${label} is denied.`);
  return approved(
    capability,
    effect,
    policy === "approval-required",
    policy === "approval-required"
      ? `The ${label} requires explicit approval.`
      : `The ${label} is allowed.`,
  );
}

function approved(
  capability: SourceCapability,
  effect: SourceOperationEffect,
  approvalRequired: boolean,
  reason: string,
): SourceOperationDecision {
  return { capability, effect, allowed: true, approvalRequired, reason };
}

function denied(
  capability: SourceCapability,
  effect: SourceOperationEffect,
  reason: string,
): SourceOperationDecision {
  return { capability, effect, allowed: false, approvalRequired: false, reason };
}

