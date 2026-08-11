import { createHash } from "node:crypto";
import { z } from "zod";

export const REQUEST_CONTRACT_FILE = "request-contract.json";
export const REQUEST_CONTRACT_INTEGRITY_FILE = "request-contract-integrity.json";

export const RequestContractRequirementSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  origin: z.enum(["explicit", "evidence_derived"]),
  priority: z.enum(["must", "should"]),
  appliesTo: z.array(z.string().min(1)).min(1),
  acceptanceCheck: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
});

const RequestContractBaseSchema = z.object({
  schemaVersion: z.literal(1),
  evaluationStatus: z.enum(["evaluated", "degraded"]),
  originalPrompt: z.string().min(1),
  userGoal: z.string().min(1),
  deliverables: z.array(z.object({
    id: z.string().min(1),
    kind: z.string().min(1),
    purpose: z.string().min(1),
  })).min(1),
  requirements: z.array(RequestContractRequirementSchema),
  notRequired: z.array(z.string().min(1)),
  forbidden: z.array(z.string().min(1)),
  contentStrategy: z.object({
    summary: z.string().min(1),
    quantityBasis: z.string().min(1),
    completionRule: z.string().min(1),
  }),
  reviewAssignments: z.array(z.object({
    owner: z.enum(["source", "content", "interaction", "visual", "technical"]),
    requirementIds: z.array(z.string().min(1)),
    checks: z.array(z.string().min(1)).min(1),
  })).min(1),
});

export const RequestContractSchema = RequestContractBaseSchema.superRefine((contract, context) => {
  const deliverableIds = new Set<string>();
  for (const [index, deliverable] of contract.deliverables.entries()) {
    if (deliverableIds.has(deliverable.id)) {
      context.addIssue({ code: "custom", path: ["deliverables", index, "id"], message: "Deliverable IDs must be unique." });
    }
    deliverableIds.add(deliverable.id);
  }
  const requirementIds = new Set<string>();
  for (const [index, requirement] of contract.requirements.entries()) {
    if (requirementIds.has(requirement.id)) {
      context.addIssue({ code: "custom", path: ["requirements", index, "id"], message: "Requirement IDs must be unique." });
    }
    requirementIds.add(requirement.id);
    if (requirement.origin === "evidence_derived" && requirement.priority === "must") {
      context.addIssue({ code: "custom", path: ["requirements", index, "priority"], message: "Evidence-derived requirements may only be recommendations." });
    }
    for (const appliesTo of requirement.appliesTo) {
      if (!deliverableIds.has(appliesTo)) {
        context.addIssue({ code: "custom", path: ["requirements", index, "appliesTo"], message: `Unknown deliverable ID: ${appliesTo}` });
      }
    }
  }
  for (const [index, assignment] of contract.reviewAssignments.entries()) {
    for (const requirementId of assignment.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        context.addIssue({ code: "custom", path: ["reviewAssignments", index, "requirementIds"], message: `Unknown requirement ID: ${requirementId}` });
      }
    }
  }
});

export type RequestContract = z.infer<typeof RequestContractSchema>;

export const RequestContractIntegritySchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal("sha256"),
  contractHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type RequestContractIntegrity = z.infer<typeof RequestContractIntegritySchema>;

export const requestContractJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "evaluationStatus",
    "originalPrompt",
    "userGoal",
    "deliverables",
    "requirements",
    "notRequired",
    "forbidden",
    "contentStrategy",
    "reviewAssignments",
  ],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    evaluationStatus: { type: "string", enum: ["evaluated", "degraded"] },
    originalPrompt: { type: "string" },
    userGoal: { type: "string" },
    deliverables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "purpose"],
        properties: {
          id: { type: "string" },
          kind: { type: "string" },
          purpose: { type: "string" },
        },
      },
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "origin", "priority", "appliesTo", "acceptanceCheck", "evidenceRefs"],
        properties: {
          id: { type: "string" },
          statement: { type: "string" },
          origin: { type: "string", enum: ["explicit", "evidence_derived"] },
          priority: { type: "string", enum: ["must", "should"] },
          appliesTo: { type: "array", items: { type: "string" } },
          acceptanceCheck: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
    notRequired: { type: "array", items: { type: "string" } },
    forbidden: { type: "array", items: { type: "string" } },
    contentStrategy: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "quantityBasis", "completionRule"],
      properties: {
        summary: { type: "string" },
        quantityBasis: { type: "string" },
        completionRule: { type: "string" },
      },
    },
    reviewAssignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["owner", "requirementIds", "checks"],
        properties: {
          owner: { type: "string", enum: ["source", "content", "interaction", "visual", "technical"] },
          requirementIds: { type: "array", items: { type: "string" } },
          checks: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export function minimalRequestContract(prompt: string, formats: string[]): RequestContract {
  const resolvedFormats = formats.length > 0 ? formats : ["artifact"];
  const deliverableIds = resolvedFormats.map((_kind, index) => `deliverable-${index + 1}`);
  return RequestContractSchema.parse({
    schemaVersion: 1,
    evaluationStatus: "degraded",
    originalPrompt: prompt.trim() || "Create the requested Study Buddy artifact.",
    userGoal: prompt.trim() || "Create the requested Study Buddy artifact.",
    deliverables: resolvedFormats.map((kind, index) => ({
      id: `deliverable-${index + 1}`,
      kind,
      purpose: "Fulfil the original user request without adding unsupported requirements.",
    })),
    requirements: [{
      id: "original-request",
      statement: prompt.trim() || "Create the requested Study Buddy artifact.",
      origin: "explicit",
      priority: "must",
      appliesTo: deliverableIds,
      acceptanceCheck: "A reviewer can trace the delivered content directly to the original request.",
      evidenceRefs: [],
    }],
    notRequired: [],
    forbidden: [],
    contentStrategy: {
      summary: "Interpret the original request against the available course evidence.",
      quantityBasis: "Use evidence-backed coverage and usefulness, not a fixed template quota.",
      completionRule: "All explicit requirements are satisfied or transparently reported as unsupported.",
    },
    reviewAssignments: [
      { owner: "source", requirementIds: ["original-request"], checks: ["Course-specific claims are traceable to authorized evidence."] },
      { owner: "content", requirementIds: ["original-request"], checks: ["The artifact fulfils the original request without invented obligations."] },
      { owner: "technical", requirementIds: [], checks: ["The requested deliverables are readable and valid."] },
    ],
  });
}

/**
 * Hashes the semantic contract rather than its on-disk whitespace or key order.
 * This lets extraction, recovery, and rendering prove that they consumed the
 * same validated contract even when the JSON file was formatted again.
 */
export function hashRequestContract(contract: RequestContract): string {
  const parsed = RequestContractSchema.parse(contract);
  return createHash("sha256").update(canonicalJson(parsed)).digest("hex");
}

export function createRequestContractIntegrity(
  contract: RequestContract,
): RequestContractIntegrity {
  return {
    schemaVersion: 1,
    algorithm: "sha256",
    contractHash: hashRequestContract(contract),
  };
}

export function verifyRequestContractIntegrity(
  contract: RequestContract,
  integrity: unknown,
): RequestContractIntegrity {
  const parsedIntegrity = RequestContractIntegritySchema.parse(integrity);
  const actualHash = hashRequestContract(contract);
  if (parsedIntegrity.contractHash !== actualHash) {
    throw new Error(
      `Request contract integrity mismatch: expected ${parsedIntegrity.contractHash}, computed ${actualHash}.`,
    );
  }
  return parsedIntegrity;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
