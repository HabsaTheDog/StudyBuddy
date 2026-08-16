import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const emailAddress = z.string().email().max(320);
const attachmentSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const EmailDraftSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(128),
  sourceId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  from: emailAddress,
  to: z.array(emailAddress).min(1).max(100),
  cc: z.array(emailAddress).max(100).default([]),
  bcc: z.array(emailAddress).max(100).default([]),
  subject: z.string().max(998),
  body: z.string().max(5_000_000),
  attachments: z.array(attachmentSchema).max(100).default([]),
});
export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export interface EmailSendProposal {
  version: 1;
  id: string;
  draftId: string;
  draftRevision: number;
  sourceId: string;
  accountId: string;
  sessionEpoch: number;
  payloadHash: string;
  createdAt: string;
  expiresAt: string;
  nonce: string;
  status: "pending";
}

export interface EmailSendGrant {
  version: 1;
  proposalId: string;
  payloadHash: string;
  approvedAt: string;
  approvalNonce: string;
  status: "approved" | "consumed";
  consumedAt?: string;
}

export class EmailApprovalError extends Error {}

export function hashEmailDraft(value: EmailDraft): string {
  const draft = EmailDraftSchema.parse(value);
  return createHash("sha256").update(canonicalJson(draft)).digest("hex");
}

export function createEmailSendProposal(
  value: EmailDraft,
  input: { sessionEpoch: number; now?: Date; ttlMs?: number; id?: string; nonce?: string },
): EmailSendProposal {
  const draft = EmailDraftSchema.parse(value);
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? 10 * 60_000;
  if (!Number.isInteger(input.sessionEpoch) || input.sessionEpoch < 0) {
    throw new EmailApprovalError("Email session epoch must be a non-negative integer.");
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 30 * 60_000) {
    throw new EmailApprovalError("Email send approval must expire within 30 minutes.");
  }
  return {
    version: 1,
    id: input.id ?? randomUUID(),
    draftId: draft.id,
    draftRevision: draft.revision,
    sourceId: draft.sourceId,
    accountId: draft.accountId,
    sessionEpoch: input.sessionEpoch,
    payloadHash: hashEmailDraft(draft),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    nonce: input.nonce ?? randomUUID(),
    status: "pending",
  };
}

export function approveEmailSendProposal(
  proposal: EmailSendProposal,
  draft: EmailDraft,
  input: { now?: Date; sessionEpoch: number; approvalNonce?: string },
): EmailSendGrant {
  assertProposalMatches(proposal, draft, input.now ?? new Date(), input.sessionEpoch);
  return {
    version: 1,
    proposalId: proposal.id,
    payloadHash: proposal.payloadHash,
    approvedAt: (input.now ?? new Date()).toISOString(),
    approvalNonce: input.approvalNonce ?? randomUUID(),
    status: "approved",
  };
}

export function consumeEmailSendGrant(
  proposal: EmailSendProposal,
  grant: EmailSendGrant,
  draft: EmailDraft,
  input: { now?: Date; sessionEpoch: number },
): EmailSendGrant {
  if (grant.status !== "approved") throw new EmailApprovalError("Email send grant was already consumed.");
  if (grant.proposalId !== proposal.id || grant.payloadHash !== proposal.payloadHash) {
    throw new EmailApprovalError("Email send grant does not match the proposal.");
  }
  const now = input.now ?? new Date();
  assertProposalMatches(proposal, draft, now, input.sessionEpoch);
  return { ...grant, status: "consumed", consumedAt: now.toISOString() };
}

function assertProposalMatches(
  proposal: EmailSendProposal,
  value: EmailDraft,
  now: Date,
  sessionEpoch: number,
): void {
  const draft = EmailDraftSchema.parse(value);
  if (Date.parse(proposal.expiresAt) <= now.getTime()) {
    throw new EmailApprovalError("Email send approval expired.");
  }
  if (proposal.sessionEpoch !== sessionEpoch) {
    throw new EmailApprovalError("Email browser session changed after approval was proposed.");
  }
  if (
    proposal.draftId !== draft.id ||
    proposal.draftRevision !== draft.revision ||
    proposal.sourceId !== draft.sourceId ||
    proposal.accountId !== draft.accountId ||
    proposal.payloadHash !== hashEmailDraft(draft)
  ) {
    throw new EmailApprovalError("Email draft changed after approval was proposed.");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

