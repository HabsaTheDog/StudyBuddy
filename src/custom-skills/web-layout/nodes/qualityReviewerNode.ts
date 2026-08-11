import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import {
  hashRequestContract,
  minimalRequestContract,
  type RequestContract,
} from "../../shared/requestContract.js";
import { adaptiveQualityCriteria } from "../learningInteractionGuidance.js";
import { balancedExcerpt, compactHtmlForModel } from "../modelText.js";
import { studyGuideBlockQualityCriteria } from "../studyGuideBlockContract.js";

const qualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "summary", "findings"],
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string" },
    findings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "deliverableId", "owner", "severity", "verdict", "targetId", "message", "repairInstruction"],
        properties: {
          requirementId: { type: ["string", "null"] },
          deliverableId: { type: ["string", "null"] },
          owner: { type: "string", enum: ["source", "content", "interaction", "visual", "technical"] },
          severity: { type: "string", enum: ["blocking", "advisory"] },
          verdict: { type: "string", enum: ["fail", "unsupported_disclosed", "not_applicable"] },
          targetId: { type: ["string", "null"] },
          message: { type: "string" },
          repairInstruction: { type: "string" },
        },
      },
    },
  },
} as const;

export function createQualityReviewerNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function qualityReviewerNode(
    state: LangGraphWebLayoutState,
  ): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const bundledHtml = await readFile(
        path.join(config.runDir, ".build", "document.html"),
        "utf8",
      ).catch(() => state.html_document);
      const requestContract = state.request_contract ?? minimalRequestContract(
        config.originalUserPrompt,
        ["interactive HTML study guide"],
      );
      const reviewScope = htmlReviewScope(requestContract);
      const response = await codex.run(buildPrompt(config, state, bundledHtml, requestContract, reviewScope), {
        task: "quality_reviewer",
        attempt: state.quality_retry_count + 1,
        outputSchema: qualityReviewSchema,
      });
      const review = keepHtmlFindingsOnly(
        removeOrchestrationFindings(parseReview(response)),
        requestContract,
        reviewScope,
      );
      await writeFile(
        path.join(config.runDir, "quality-review.json"),
        `${JSON.stringify(review, null, 2)}\n`,
        "utf8",
      );
      if (review.ok) {
        await config.diagnostics?.log("info", "validator", "Semantic quality review passed.");
        return { error_log: null };
      }
      const blocking = review.findings.filter((finding) => finding.severity === "blocking");
      if (blocking.length === 0) {
        await config.diagnostics?.log("info", "validator", "Semantic quality review passed with advisory findings.");
        return { error_log: null };
      }
      const message = `Semantic quality review failed:\n- ${blocking.map(formatFinding).join("\n- ")}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        quality_retry_count: state.quality_retry_count + 1,
      };
    } catch (error) {
      return {
        error_log: `Quality reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
        quality_retry_count: state.quality_retry_count + 1,
      };
    }
  };
}

function buildPrompt(
  config: WebLayoutRuntimeConfig,
  state: LangGraphWebLayoutState,
  bundledHtml: string,
  requestContract: RequestContract,
  reviewScope: HtmlReviewScope,
): string {
  return [
    "Review this offline interactive Study Buddy page against its assigned part of the exact original request and evaluated request contract, then for source fidelity, subject correctness, pedagogy, usability, and appropriate interaction design.",
    "This node reviews ONLY the interactive HTML deliverable(s) listed below. Other requested deliverables are built and reviewed by separate downstream workflows. Their absence from this HTML artifact is never an HTML defect and must not be reported. Do not ask this page to contain, link, prove, or replace a PDF or any other out-of-scope deliverable.",
    "Do not rewrite it. Return JSON only. Mark ok=false only for a violated explicit must requirement, an explicit prohibition, or a concrete correctness/safety/technical defect. Missing should recommendations may be findings but must not make ok=false by themselves.",
    "Return every finding as a structured object. Bind it to the exact requirementId and deliverableId when applicable, select the repair owner (source, content, interaction, visual, or technical), name the smallest stable targetId available, and provide an item-local repairInstruction. Use null only when no contract or artifact target exists. Evidence-derived should gaps are advisory. Set ok=false if and only if at least one finding is blocking.",
    "Do not invent a conventional study-guide requirement. In particular, examples, calculations, images, vocabulary, or any fixed item count are blockers only when the contract makes them explicit must requirements.",
    "The workflow is necessarily still marked running while this review executes. Do not inspect or reject run-summary.md, error.log presence, lock files, or terminal status; the graph writes terminal artifacts only after your approval. Review the bundled HTML and supplied validation evidence instead.",
    "Do not reject a clearly labelled unsourced demo merely because course materials were not supplied. Reject only unsupported claims that present themselves as real course facts.",
    adaptiveQualityCriteria(),
    config.kind === "study-guide" ? studyGuideBlockQualityCriteria() : "",
    `Requested kind: ${config.kind}`,
    `Exact original user request:\n${config.originalUserPrompt}`,
    `Verified full request-contract hash (trust binding only): ${hashRequestContract(requestContract)}`,
    `HTML review scope derived from that contract:\n${JSON.stringify(reviewScope.promptContext, null, 2)}`,
    `Browser and static validation:\n${balancedExcerpt(JSON.stringify(state.validation_report), 4_000)}`,
    config.kind === "study-guide"
      ? `Canonical validated content bank the HTML must faithfully render:\n${balancedExcerpt(JSON.stringify(state.study_guide_content ?? {}), 8_000)}`
      : `Source:\n${balancedExcerpt(state.source_text, 8_000)}`,
    "HTML below is the validated, bundled delivery artifact. Local asset references in the editable generator source are irrelevant if this artifact contains the corresponding data URI.",
    `HTML:\n${compactQualityReviewHtml(bundledHtml)}`,
  ].join("\n\n");
}

interface HtmlReviewScope {
  deliverableIds: Set<string>;
  requirementIds: Set<string>;
  promptContext: {
    deliverables: RequestContract["deliverables"];
    requirements: RequestContract["requirements"];
    notRequired: RequestContract["notRequired"];
    forbidden: RequestContract["forbidden"];
    reviewAssignments: Array<{ owner: string; requirementIds: string[] }>;
  };
}

function htmlReviewScope(contract: RequestContract): HtmlReviewScope {
  const explicitlyInteractive = contract.deliverables.filter((deliverable) =>
    /(?:interactive|html|web|study[-_ ]?guide)/i.test(deliverable.kind)
  );
  const nonDocumentDeliverables = contract.deliverables.filter((deliverable) =>
    !/(?:pdf|document|print)/i.test(deliverable.kind)
  );
  const deliverables = explicitlyInteractive.length > 0
    ? explicitlyInteractive
    : nonDocumentDeliverables.length > 0
      ? nonDocumentDeliverables
      : contract.deliverables;
  const deliverableIds = new Set(deliverables.map((deliverable) => deliverable.id));
  const requirements = contract.requirements.filter((requirement) =>
    requirement.appliesTo.some((deliverableId) => deliverableIds.has(deliverableId))
  );
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  return {
    deliverableIds,
    requirementIds,
    promptContext: {
      deliverables,
      requirements,
      notRequired: contract.notRequired,
      forbidden: contract.forbidden,
      reviewAssignments: contract.reviewAssignments
        .map((assignment) => ({
          owner: assignment.owner,
          requirementIds: assignment.requirementIds.filter((requirementId) =>
            requirementIds.has(requirementId)
          ),
        }))
        .filter((assignment) => assignment.requirementIds.length > 0),
    },
  };
}

function keepHtmlFindingsOnly(
  review: { ok: boolean; summary: string; findings: WebQualityFinding[] },
  contract: RequestContract,
  scope: HtmlReviewScope,
): { ok: boolean; summary: string; findings: WebQualityFinding[] } {
  const knownDeliverableIds = new Set(contract.deliverables.map((deliverable) => deliverable.id));
  const requirementsById = new Map(contract.requirements.map((requirement) => [requirement.id, requirement]));
  const findings = review.findings.filter((finding) => {
    if (
      finding.deliverableId &&
      knownDeliverableIds.has(finding.deliverableId) &&
      !scope.deliverableIds.has(finding.deliverableId)
    ) return false;
    if (
      finding.targetId &&
      knownDeliverableIds.has(finding.targetId) &&
      !scope.deliverableIds.has(finding.targetId)
    ) return false;
    if (finding.requirementId) {
      const requirement = requirementsById.get(finding.requirementId);
      if (requirement && !scope.requirementIds.has(requirement.id)) return false;
    }
    return true;
  });
  if (findings.length === review.findings.length) return review;
  const ok = !findings.some((finding) => finding.severity === "blocking");
  return {
    ok,
    summary: findings.length === 0
      ? "Die interaktive HTML-Ausgabe erfüllt ihren eigenen geprüften Lieferumfang; Befunde zu separaten Deliverables werden in deren Workflow geprüft."
      : review.summary,
    findings,
  };
}

function compactQualityReviewHtml(html: string): string {
  const visibleArtifact = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style>[stylesheet omitted]</style>")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script>[runtime omitted]</script>");
  return compactHtmlForModel(visibleArtifact, 12_000);
}

export interface WebQualityFinding {
  requirementId: string | null;
  deliverableId: string | null;
  owner: "source" | "content" | "interaction" | "visual" | "technical";
  severity: "blocking" | "advisory";
  verdict: "fail" | "unsupported_disclosed" | "not_applicable";
  targetId: string | null;
  message: string;
  repairInstruction: string;
}

function parseReview(value: string): { ok: boolean; summary: string; findings: WebQualityFinding[] } {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.ok !== "boolean" || typeof parsed.summary !== "string") {
    throw new Error("Quality reviewer response is missing ok or summary.");
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error("Quality reviewer findings must be an array.");
  }
  const findings = parsed.findings.map(parseFinding);
  const hasBlocking = findings.some((finding) => finding.severity === "blocking");
  if (parsed.ok === hasBlocking) throw new Error("Quality reviewer ok flag contradicts finding severities.");
  return {
    ok: parsed.ok,
    summary: parsed.summary,
    findings: findings.slice(0, 12),
  };
}

function removeOrchestrationFindings(
  review: { ok: boolean; summary: string; findings: WebQualityFinding[] },
): { ok: boolean; summary: string; findings: WebQualityFinding[] } {
  const orchestrationOnly = /(run-summary\.md|error\.log|lock files?|terminal(?:er|en|status)?|run status|laufstatus|artefakt-run|abschlussartefakt)/i;
  const findings = review.findings.filter((finding) => !orchestrationOnly.test(finding.message));
  if (findings.length === review.findings.length) return review;
  return {
    ok: !findings.some((finding) => finding.severity === "blocking"),
    summary: findings.length === 0
      ? "Keine reparaturpflichtigen HTML-Fehler; reine Orchestrierungsbefunde werden separat geprüft."
      : review.summary,
    findings,
  };
}

function parseFinding(value: unknown): WebQualityFinding {
  if (!value || typeof value !== "object") throw new Error("Quality reviewer findings must be structured objects.");
  const finding = value as Record<string, unknown>;
  const owner = finding.owner;
  const severity = finding.severity;
  const verdict = finding.verdict;
  if (!(owner === "source" || owner === "content" || owner === "interaction" || owner === "visual" || owner === "technical")) {
    throw new Error("Quality reviewer finding has an invalid repair owner.");
  }
  if (!(severity === "blocking" || severity === "advisory")) throw new Error("Quality reviewer finding has an invalid severity.");
  if (!(verdict === "fail" || verdict === "unsupported_disclosed" || verdict === "not_applicable")) {
    throw new Error("Quality reviewer finding has an invalid verdict.");
  }
  if (typeof finding.message !== "string" || typeof finding.repairInstruction !== "string") {
    throw new Error("Quality reviewer finding is missing its message or repair instruction.");
  }
  return {
    requirementId: typeof finding.requirementId === "string" ? finding.requirementId : null,
    deliverableId: typeof finding.deliverableId === "string" ? finding.deliverableId : null,
    owner,
    severity,
    verdict,
    targetId: typeof finding.targetId === "string" ? finding.targetId : null,
    message: finding.message,
    repairInstruction: finding.repairInstruction,
  };
}

function formatFinding(finding: WebQualityFinding): string {
  return [
    `[owner:${finding.owner}]`,
    finding.requirementId ? `[requirement:${finding.requirementId}]` : "",
    finding.deliverableId ? `[deliverable:${finding.deliverableId}]` : "",
    finding.targetId ? `[target:${finding.targetId}]` : "",
    finding.message,
    `Repair: ${finding.repairInstruction}`,
  ].filter(Boolean).join(" ");
}
