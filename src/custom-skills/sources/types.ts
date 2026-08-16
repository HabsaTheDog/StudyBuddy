import { z } from "zod";

const stableId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);

export const SourceKindSchema = z.enum([
  "moodle-course",
  "calendar",
  "website",
  "resource-portal",
  "email",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceCapabilitySchema = z.enum([
  "content.search",
  "content.list",
  "content.read",
  "content.download",
  "calendar.events.read",
  "course.structure.read",
  "quiz.completed-attempt.read",
  "mail.threads.list",
  "mail.message.read",
  "mail.attachment.read",
  "mail.draft.local",
  "mail.draft.remote",
  "mail.send",
]);
export type SourceCapability = z.infer<typeof SourceCapabilitySchema>;

export const SourceOperationEffectSchema = z.enum([
  "read",
  "local-only",
  "reversible-write",
  "external-commit",
  "forbidden",
]);
export type SourceOperationEffect = z.infer<typeof SourceOperationEffectSchema>;

export const SourceAuthModeSchema = z.enum([
  "none",
  "password",
  "interactive-session",
  "oauth",
  "bearer-url",
]);
export type SourceAuthMode = z.infer<typeof SourceAuthModeSchema>;

export const SourceAuthStatusSchema = z.object({
  mode: SourceAuthModeSchema,
  state: z.enum(["not-required", "not-configured", "configured", "expired", "action-required"]),
});
export type SourceAuthStatus = z.infer<typeof SourceAuthStatusSchema>;

export const SourceConnectionSchema = z.object({
  version: z.literal(1),
  id: stableId,
  adapterId: stableId,
  adapterVersion: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  displayOrigin: z.string().url().max(2_000),
  allowedOrigins: z.array(z.string().url().max(2_000)).min(1).max(32),
  auth: SourceAuthStatusSchema,
  revision: z.number().int().nonnegative(),
});
export type SourceConnection = z.infer<typeof SourceConnectionSchema>;

export const SourceScopeSchema = z.object({
  allowedOrigins: z.array(z.string().url().max(2_000)).min(1).max(32),
  pathPrefixes: z.array(z.string().startsWith("/").max(2_000)).max(64).default([]),
  courseIds: z.array(z.string().min(1).max(256)).max(128).default([]),
  mailFolders: z.array(z.string().min(1).max(256)).max(64).default([]),
  tags: z.array(z.string().min(1).max(128)).max(64).default([]),
});
export type SourceScope = z.infer<typeof SourceScopeSchema>;

export const SourcePolicySchema = z.object({
  authenticatedReads: z.enum(["allowed", "approval-required", "denied"]).default("allowed"),
  downloads: z.enum(["allowed", "approval-required", "denied"]).default("allowed"),
  remoteDrafts: z.enum(["allowed", "approval-required", "denied"]).default("denied"),
  emailSend: z.enum(["approval-required", "denied"]).default("denied"),
});
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

export const SourceHealthSchema = z.object({
  status: z.enum(["unknown", "connected", "action-required", "expired", "failed"]),
  checkedAt: z.string().datetime().optional(),
  safeMessage: z.string().max(500).optional(),
});
export type SourceHealth = z.infer<typeof SourceHealthSchema>;

export const SourceBlockSchema = z.object({
  version: z.literal(1),
  id: stableId,
  label: z.string().min(1).max(160),
  kind: SourceKindSchema,
  enabled: z.boolean(),
  connectionId: stableId,
  parentSourceId: stableId.optional(),
  priority: z.number().int().min(0).max(10_000).default(100),
  scope: SourceScopeSchema,
  capabilities: z.array(SourceCapabilitySchema).min(1).max(32),
  policy: SourcePolicySchema,
  health: SourceHealthSchema,
  revision: z.number().int().nonnegative(),
});
export type SourceBlock = z.infer<typeof SourceBlockSchema>;

export const SourceCatalogSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  connections: z.array(SourceConnectionSchema).max(256),
  sources: z.array(SourceBlockSchema).max(2_000),
});
export type SourceCatalog = z.infer<typeof SourceCatalogSchema>;

export const SourceRecordSchema = z.object({
  version: z.literal(1),
  id: stableId,
  sourceId: stableId,
  capability: SourceCapabilitySchema,
  title: z.string().min(1),
  content: z.string(),
  mimeType: z.string().min(1).max(256),
  observedAt: z.string().datetime(),
  locator: z.object({
    origin: z.string().url(),
    path: z.string().startsWith("/").optional(),
    label: z.string().max(500).optional(),
  }),
  provenance: z.object({
    adapterId: stableId,
    sourceRevision: z.number().int().nonnegative(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  artifactRefs: z.array(stableId).max(256).default([]),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

