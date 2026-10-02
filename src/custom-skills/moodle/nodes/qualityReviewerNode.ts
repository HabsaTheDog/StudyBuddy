import { mkdir, stat, writeFile } from "node:fs/promises";
import { readVisualManifest } from "../visualAssets.js";
import { canonicalizeResourceUrl, isResourceFailureStatus } from "../resourceAcquisition.js";
import { readVisualRetrievalPlan } from "../visualPlanner.js";
import { ExtractedDataSchema } from "../schemas.js";
import path from "node:path";
import {
  ModelCallTimeoutError,
  resolveModelPromptBodyCharacterBudget,
  type CodexClient,
} from "../codexClient.js";
import {
  clearPendingExtractionRepairs,
  persistPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError } from "../runtimeAbort.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray } from "../validation.js";
import {
  ASSESSMENT_SCORING_POLICY,
  MATHEMATICAL_INTEGRITY_POLICY,
  SOURCE_FIDELITY_POLICY,
} from "../studentFirstPolicy.js";

const QUALITY_DEFECT_KINDS = [
  "requirement_gap",
  "factual_error",
  "mathematical_error",
  "citation_error",
  "prohibition_violation",
  "presentation",
] as const;
type QualityDefectKind = typeof QUALITY_DEFECT_KINDS[number];
const CONCRETE_BLOCKING_DEFECTS = new Set<QualityDefectKind>([
  "factual_error", "mathematical_error", "citation_error", "prohibition_violation",
]);

export const qualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "summary", "findings"],
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "message",
          "chapterTitle",
          "requirementId",
          "deliverableId",
          "owner",
          "severity",
          "defectKind",
          "repairTarget",
        ],
        properties: {
          message: { type: "string" },
          chapterTitle: { type: ["string", "null"] },
          requirementId: { type: ["string", "null"] },
          deliverableId: { type: ["string", "null"] },
          owner: {
            type: "string",
            enum: ["source", "content", "interaction", "visual", "technical"],
          },
          severity: { type: "string", enum: ["blocking", "advisory"] },
          defectKind: { type: "string", enum: QUALITY_DEFECT_KINDS },
          repairTarget: {
            type: "string",
            enum: ["source_architect", "content_analyzer", "visual_pipeline", "formatter", "none"],
          },
        },
      },
      maxItems: 12,
    },
  },
} as const;

interface QualityFinding {
  message: string;
  chapterTitle: string | null;
  requirementId: string | null;
  deliverableId: string | null;
  owner: "source" | "content" | "interaction" | "visual" | "technical";
  severity: "blocking" | "advisory";
  /** Null preserves legacy responses that predate explicit defect classification. */
  defectKind: QualityDefectKind | null;
  repairTarget: "source_architect" | "content_analyzer" | "visual_pipeline" | "formatter" | "none";
}

const QUALITY_REVIEW_PROMPT_MARGIN = 512;

export function createQualityReviewerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function qualityReviewerNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      await mkdir(config.runDir, { recursive: true });
      await writeFile(path.join(config.runDir, "quality-review.json"), JSON.stringify({
        ok: false, complete_review: false, summary: "Complete content review has not finished.",
        findings: [], blocking_findings: [], advisory_findings: [],
      }, null, 2) + "\n");
      const previousReview = await readPendingExtractionRepairs(config.runDir);
      const packets = await buildQualityReviewPackets(config, state, previousReview?.reviewError ?? null);
      const reviews = [];
      for (const [index, packet] of packets.entries()) {
        await config.diagnostics?.log("info", "analyzer", `Reviewing complete content packet ${index + 1}/${packets.length}.`);
        const response = await codex.run(packet.prompt, {
          outputSchema: qualityReviewSchema, task: "quality_reviewer", operation: "content_review",
          localImages: packet.sourceVisuals.map(visual => visual.imagePath), attempt: state.retry_count + 1,
        });
        const review = validateQualityReview(parseJsonObjectOrArray(response));
        if (!review.ok && !review.findings.length) throw new Error("Content-review packet rejected without localized findings; complete review did not pass.");
        reviews.push(review);
        const progress = localizeQualityFindings(reviews.flatMap(review => review.findings), state);
        await writeFile(path.join(config.runDir, "quality-review.json"), JSON.stringify({
          ok: false, complete_review: false, completed_packets: reviews.length, packet_count: packets.length,
          summary: "Complete content review has not finished.", findings: reviews.flatMap(review => review.findings),
          blocking_findings: progress.blocking, advisory_findings: progress.advisory,
        }, null, 2) + "\n");
      }
      const parsed = { ok: reviews.every(review => review.ok), summary: reviews.map(review => review.summary).join("\n"), findings: reviews.flatMap(review => review.findings) };
      const localized = localizeQualityFindings(parsed.findings, state);
      await writeFile(
        path.join(config.runDir, "quality-review.json"),
        `${JSON.stringify({
          ...parsed,
          complete_review: true,
          packet_count: packets.length,
          blocking_findings: localized.blocking,
          advisory_findings: localized.advisory,
        }, null, 2)}\n`,
        "utf8",
      );
      if (localized.blocking.length === 0) {
        await clearPendingExtractionRepairs(config.runDir);
        if (!parsed.ok && localized.advisory.length > 0) {
          await config.diagnostics?.log(
            "warn",
            "analyzer",
            `Semantic review returned ${localized.advisory.length} non-localized/presentation finding(s); extraction remains valid and rendering owns those concerns.`,
          );
        }
        await config.diagnostics?.log("info", "analyzer", "Semantic quality review passed.");
        return { error_log: null };
      }
      const message = `Semantic quality review failed:\n- ${localized.blocking
        .map(formatFindingForRepair)
        .join("\n- ")}`;
      await persistPendingExtractionRepairs(
        config.runDir,
        message,
        state.retry_count + 1,
      );
      await config.diagnostics?.log("warn", "analyzer", message);
      return { error_log: message, retry_count: state.retry_count + 1 };
    } catch (error) {
      if (config.stage === "extract" && error instanceof ModelCallTimeoutError) {
        throw new StudyBuddyCheckpointError(
          `Extraction capacity checkpoint required: ${error.task} on ${error.model} ` +
          `produced no token usage within ${error.timeoutMs}ms. Resume after fair model admission.`,
        );
      }
      return {
        error_log: `Quality reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

export interface QualitySourceVisual {
  assetId: string;
  sourceId: string;
  sourceUrl: string | null;
  sourcePage: number | null;
  title: string;
  imagePath: string;
}

/** Use the existing review call and at most two already acquired compositions. */
export async function selectQualitySourceVisuals(runDir: string, state: LangGraphAgentState, selection?: { sourceIds: string[]; plannedPages: boolean }): Promise<QualitySourceVisual[]> {
  if (Array.isArray(state.extracted_data)) return [];
  const parsed = ExtractedDataSchema.safeParse(state.extracted_data);
  if (!parsed.success) return [];
  const data = parsed.data;
  const citedIds = new Set(selection?.sourceIds ?? [
    ...data.formulas.flatMap(formula => formula.source_ids),
    ...data.worked_examples.flatMap(example => example.source_ids),
    ...data.figures.flatMap(figure => figure.source_ids),
  ]);
  const sources = data.sources.filter(source => citedIds.has(source.id));
  const selectedAssets = new Set(data.figures.filter(figure => !selection || figure.source_ids.some(id => citedIds.has(id))).map(figure => figure.asset_id));
  const plan = selection?.plannedPages ? await readVisualRetrievalPlan(runDir) : null;
  const plannedSourcePages = new Set((plan?.requests ?? []).flatMap(request => {
    const resource = state.resource_manifest.resources.find(resource => resource.id === request.resourceId);
    return resource ? request.pages.map(page => `${canonicalizeResourceUrl(resource.originUrl)}|${page}`) : [];
  }));
  const selectedSourcePages = new Set(data.visual_assets.filter(asset => selectedAssets.has(asset.id) && asset.source_page != null)
    .flatMap(asset => {
      const url = asset.source_url ?? data.sources.find(source => source.id === asset.source_id)?.url;
      return url ? [`${canonicalizeResourceUrl(url)}|${asset.source_page}`] : [];
    }));
  const excluded = new Set((state.source_architect_decision.learningArchitecture?.excludedResourceUrls ?? []).map(canonicalizeResourceUrl));
  const vetoedResources = state.resource_manifest.resources.filter(resource => resource.selection?.selected === false ||
    resource.status === "skipped" || isResourceFailureStatus(resource.status) || excluded.has(canonicalizeResourceUrl(resource.originUrl)));
  const vetoed = new Set(vetoedResources.map(resource => resource.id));
  const vetoedUrls = new Set([...excluded, ...vetoedResources.map(resource => canonicalizeResourceUrl(resource.originUrl))]);
  const manifest = await readVisualManifest(runDir);
  const root = path.resolve(runDir);
  const eligible = (manifest?.candidates ?? []).flatMap(candidate => {
    if (!candidate.relative_path || !/\.(?:png|jpe?g)$/i.test(candidate.relative_path) ||
      (candidate.mime_type !== "image/png" && candidate.mime_type !== "image/jpeg") ||
      (candidate.source_id && vetoed.has(candidate.source_id)) ||
      (candidate.source_url && vetoedUrls.has(canonicalizeResourceUrl(candidate.source_url)))) return [];
    const source = sources.find(source => source.id === candidate.source_id ||
      (source.url && candidate.source_url && canonicalizeResourceUrl(source.url) === canonicalizeResourceUrl(candidate.source_url)));
    if (!source || (source.url && vetoedUrls.has(canonicalizeResourceUrl(source.url)))) return [];
    const imagePath = path.resolve(root, candidate.relative_path);
    const relative = path.relative(root, imagePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return [];
    return [{ visual: { assetId: candidate.id, sourceId: source.id, sourceUrl: candidate.source_url,
      sourcePage: candidate.source_page, title: candidate.title, imagePath },
      score: (candidate.source_url && plannedSourcePages.has(`${canonicalizeResourceUrl(candidate.source_url)}|${candidate.source_page}`) ? 200 : 0) + (selectedAssets.has(candidate.id) || (candidate.source_url && selectedSourcePages.has(`${canonicalizeResourceUrl(candidate.source_url)}|${candidate.source_page}`)) ? 100 : 0) + (source.page === candidate.source_page && source.page != null ? 20 : 0) }];
  }).sort((left, right) => right.score - left.score);
  const usable = [];
  for (const entry of eligible) {
    const file = await stat(entry.visual.imagePath).catch(() => null);
    if (file?.isFile() && file.size > 0) usable.push(entry.visual);
  }
  const selected: QualitySourceVisual[] = [];
  for (const visual of usable) {
    if (selected.some(prior => prior.sourceId === visual.sourceId)) continue;
    selected.push(visual);
    if (selected.length === 2) return selected;
  }
  for (const visual of usable) {
    if (selected.some(prior => prior.assetId === visual.assetId)) continue;
    selected.push(visual);
    if (selected.length === 2) break;
  }
  return selected;
}

export function buildQualityReviewPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  previousReviewError: string | null = null,
  sourceVisuals: QualitySourceVisual[] = [],
): string {
  const claims = completeReviewClaims(state);
  const prompt = composeQualityReviewPrompt(config, state, previousReviewError, sourceVisuals, claims, { index: 1, total: 1 });
  const budget = resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - QUALITY_REVIEW_PROMPT_MARGIN;
  if (prompt.length > budget) throw new QualityReviewCapacityError(`Complete content review needs ${prompt.length} prompt characters; use bounded complete packets. Budget ${budget}.`);
  return prompt;
}

function composeQualityReviewPrompt(
  config: MoodleRuntimeConfig, state: LangGraphAgentState, previousReviewError: string | null,
  sourceVisuals: QualitySourceVisual[], claims: QualityReviewClaims, packet: { index: number; total: number },
): string {
    const artifact = `Structured study model review view:\n${JSON.stringify(faithfulStudyModelForReview(state, claims))}`;
    return [
    "Review this Study Buddy artifact against the exact original request and evaluated request contract, then for factual grounding, disciplinary and internal consistency, pedagogical usefulness, and alignment with the requested output.",
    "Return JSON only and do not rewrite, invoke tools, open files, or infer facts from omitted source material.",
    SOURCE_FIDELITY_POLICY,
    "An explicit request-level source record contradicts a global denial of its date/topic/format: factual_error. Uncertain exclusive/full syllabus coverage cannot deny confirmed attributes.",
    "Extraction-handoff review: deterministic gates check schema/citations/formula metadata/file integrity. Renderer-owned layout/navigation/schedules/presentation cannot block.",
    "Set ok=false only for a localized must/prohibition violation or concrete factual/citation/math/unit defect, including examples whose givens/steps cannot yield the result. Missing should recommendations are advisory.",
    "Only contract/evidence establish required examples/calculations/applications/figures/questions/counts/length, never subject labels or guide conventions.",
    "Derived examples with declared values are valid when the cited rule is source-backed. A lookup-dependent example is invalid if it merely copies table/diagram values without showing the visible asset and selection method.",
    ASSESSMENT_SCORING_POLICY,
    MATHEMATICAL_INTEGRITY_POLICY,
    "Audit the meaning of included names and explanations separately from algebraic correctness. Where a quantitative/physical term implies sign or direction and the given assumptions permit a case, test a simple allowed sign/direction configuration in the stated frame and compare the computed behaviour with the term's defining meaning. Do not invent numeric or frame requirements for nonquantitative content. Do not treat a citation or an algebraically valid expression as proof of its interpretation. A contradictory label/direction/frame is a concrete factual_error or mathematical_error, not presentation, and is blocking even when its associated requirement is should. If a source uses a different convention, require that convention to be stated and reconciled.",
    "Unsupported claims of official grading are factual contradictions. Check any included grading claim against exact cited scoring evidence; do not confuse a task's source basis with an official allocation. Do not speculate about scoring absent from this extraction handoff or demand a grading scheme for ordinary practice.",
    "For any countercalculation, verify the exact ordered operands, basis/index labels and source relation against the supplied original. Never transfer an identity for a different operand pair. Derive the counterexample from unchanged givens and the declared basis; distinguish an original-source error from a transcription error.",
    "Documented gaps and partial status are acceptable. No optional breadth, detached practice bank, invented content, one example per formula or one worked example per official Moodle topic.",
    `Complete content-review packet ${packet.index}/${packet.total}. All included claim atoms here are complete. Other packets review the remaining claims; this is not the whole artifact. Never infer absent topics, formulas, examples or steps from this packet. Whole-document example coverage is recorded in workedExampleCoverageLedger; that ledger is bookkeeping, not mathematical evidence. Review the complete givens, conditions, steps and results actually included in this packet. Empty packet-local arrays do not mean whole-document absence: documentCoverage contains the complete global counts and topic/formula IDs. Do not allege missing document-wide summaries or relations from local arrays.`,
    previousReviewError
      ? "This is a repair verification: check prior blockers. No stricter example counts or unrelated breadth; new blockers require a visible concrete contradiction, invalid math/citation or unusable method."
      : "",
    previousReviewError
      ? `Previous blocking review:\n${previousReviewError}`
      : "",
    "Formula strings use Typst, not TeX. Source-index mappings are valid citations.",
    "Compare reproduced symbols, basis/index labels and geometry against the attached original source compositions. Preserve distinct source symbols and stated assumptions; flag a concrete transcription or geometry contradiction as mathematical_error. Unattached source images are not inspected: never infer correctness or missing evidence from this bounded image selection.",
    `Attached original source images (in attachment order): ${JSON.stringify(sourceVisuals.map(({ imagePath: _path, ...metadata }) => metadata))}`,
    "Return structured findings with exact contract requirement/deliverable IDs, or null when inapplicable; chapterTitle is an exact allowed title or null. Blocking requires a must/prohibition violation or concrete factual/citation/math defect; should gaps and renderer presentation are advisory.",
    "Classify defectKind: requirement_gap covers unmet requirements (should gaps advisory), never incorrect included content. factual_error/mathematical_error/citation_error/prohibition_violation remain blocking even for should; describe the exact contradiction, invalid calculation/citation or prohibition, never optional breadth/missing examples/speculation. presentation is renderer-owned/advisory.",
    "chapterTitle owns the defect; null for global/cross-chapter findings, even if a chapter topic is mentioned. Local source notes cannot establish document-wide exclusions.",
    "Narrowest repairTarget: source_architect=missing/unavailable evidence; content_analyzer=source-backed semantics; visual_pipeline=visual selection; formatter=presentation; none=no suitable automated repair.",
    `Exact original user request:\n${config.originalUserPrompt}`,
    `Evaluated request contract:\n${JSON.stringify(state.request_contract)}`,
    `Direct request-level document source evidence:\n${JSON.stringify(!Array.isArray(state.extracted_data) && "document_context" in state.extracted_data ? state.extracted_data.document_context : [])}`,
    `Allowed exact chapter titles:\n${JSON.stringify(state.study_model.courseChapters.map((chapter) => chapter.title))}`,
    `Deterministic review:\n${JSON.stringify(state.review_report)}`,
    artifact,
    ].join("\n\n");

}

function localizeQualityFindings(
  findings: QualityFinding[],
  state: LangGraphAgentState,
): { blocking: QualityFinding[]; advisory: QualityFinding[] } {
  const chapters = state.study_model.courseChapters.map((chapter) => ({
    title: chapter.title,
    normalizedTitle: normalizeReviewText(chapter.title),
  }));
  const requirementById = new Map(
    state.request_contract.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const deliverableIds = new Set(state.request_contract.deliverables.map((deliverable) => deliverable.id));
  const blocking: QualityFinding[] = [];
  const advisory: QualityFinding[] = [];

  for (const finding of findings) {
    // The reviewer contract owns localization. Null denotes a global finding;
    // matching words name affected content, not necessarily the defect's owner.
    const explicit = finding.chapterTitle?.trim();
    const matched = explicit
      ? chapters.filter((chapter) => chapter.normalizedTitle === normalizeReviewText(explicit))
      : [];
    const requirement = finding.requirementId
      ? requirementById.get(finding.requirementId)
      : undefined;
    const normalizedFinding: QualityFinding = {
      ...finding,
      message: finding.message.replace(/\[chapter:\s*[^\]]+\]\s*/i, "").trim(),
      chapterTitle: matched.length === 1 ? matched[0].title : null,
      requirementId: requirement ? finding.requirementId : null,
      deliverableId: finding.deliverableId && deliverableIds.has(finding.deliverableId)
        ? finding.deliverableId
        : null,
      severity: finding.defectKind && CONCRETE_BLOCKING_DEFECTS.has(finding.defectKind)
        ? "blocking"
        : finding.defectKind === "presentation" || requirement?.priority === "should"
          ? "advisory"
          : finding.severity,
    };
    if (normalizedFinding.severity === "blocking") blocking.push(normalizedFinding);
    else advisory.push(normalizedFinding);
  }
  return {
    blocking: uniqueQualityFindings(blocking),
    advisory: uniqueQualityFindings(advisory),
  };
}

function formatFindingForRepair(finding: QualityFinding): string {
  return [
    finding.chapterTitle ? `[chapter: ${finding.chapterTitle}]` : "[scope: document]",
    finding.requirementId ? `[requirement: ${finding.requirementId}]` : "",
    finding.deliverableId ? `[deliverable: ${finding.deliverableId}]` : "",
    `[owner: ${finding.owner}]`,
    finding.defectKind ? `[defect: ${finding.defectKind}]` : "",
    `[repair: ${finding.repairTarget}]`,
    finding.message,
  ].filter(Boolean).join(" ");
}

function uniqueQualityFindings(findings: QualityFinding[]): QualityFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = JSON.stringify(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReviewText(value: string): string {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ReviewModel = LangGraphAgentState["study_model"];
export type QualityReviewClaims = Omit<Pick<ReviewModel, "topics" | "formulas" | "workedExamples" | "figures" | "checklist">, "topics"> & { topics: (ReviewModel["topics"][number] & { originalKeyConcepts?: string[] })[] };
export interface QualityReviewPacket {
  prompt: string;
  sourceVisuals: QualitySourceVisual[];
  claims: QualityReviewClaims;
}
export class QualityReviewCapacityError extends Error {
  constructor(message: string) { super(message); this.name = "QualityReviewCapacityError"; }
}
const MAX_QUALITY_REVIEW_PACKETS = 6;
const emptyReviewClaims = (): QualityReviewClaims => ({ topics: [], formulas: [], workedExamples: [], figures: [], checklist: [] });

function completeReviewClaims(state: LangGraphAgentState): QualityReviewClaims {
  const model = state.study_model;
  const data = ExtractedDataSchema.safeParse(state.extracted_data);
  const topics = model.topics.map(topic => ({ ...topic,
    originalKeyConcepts: data.success ? data.data.sections.find(section => section.heading === topic.title && section.summary === topic.summary)?.key_concepts : undefined,
  }));
  if (data.success) for (const [index, section] of data.data.sections.entries()) {
    if (topics.some(topic => topic.title === section.heading && topic.summary === section.summary)) continue;
    topics.push({ id: `original-handoff-section-${index}`, chapterId: null, title: section.heading,
      summary: section.summary, learningGoals: [], originalKeyConcepts: section.key_concepts,
      priority: "supplementary", scopeStatus: "inferred", sourceIds: section.source_ids });
  }
  return { topics, formulas: model.formulas, workedExamples: model.workedExamples, figures: model.figures, checklist: model.checklist };
}

/** Coverage bookkeeping is not a substitute for reviewing complete claims. */
function workedExampleCoverageLedger(model: ReviewModel) {
  return model.workedExamples.map(example => ({
    exampleId: example.id, chapterId: example.chapterId,
    stepCount: example.steps.length,
  }));
}

function faithfulStudyModelForReview(state: LangGraphAgentState, claims: QualityReviewClaims) {
  const model = state.study_model;
  const knownChapterIds = new Set(model.courseChapters.map(chapter => chapter.id));
  const original = ExtractedDataSchema.safeParse(state.extracted_data);
  const referenced = new Set([
    ...model.topics.flatMap(item => item.sourceIds), ...model.formulas.flatMap(item => item.sourceIds),
    ...model.workedExamples.flatMap(item => item.sourceIds), ...model.figures.flatMap(item => item.sourceIds),
    ...claims.topics.flatMap(item => item.sourceIds), ...claims.formulas.flatMap(item => item.sourceIds),
    ...claims.workedExamples.flatMap(item => item.sourceIds), ...claims.figures.flatMap(item => item.sourceIds),
    ...(original.success ? original.data.quiz_style_questions.flatMap(question => question.source_ids) : []),
  ]);
  const sourceIndex = new Map(model.sources.map(source => [source.id, {
    id: source.id, title: source.title, kind: source.kind, originUrl: source.originUrl,
  }]));
  if (original.success) for (const source of original.data.sources) {
    if (!sourceIndex.has(source.id)) sourceIndex.set(source.id, {
      id: source.id, title: source.title, kind: source.kind, originUrl: source.url,
    });
  }
  return {
    profile: model.profile, title: model.title, courseTitle: model.courseTitle,
    publicationStatus: model.publicationStatus, scopeNote: model.scopeNote,
    documentCoverage: {
      topicCount: completeReviewClaims(state).topics.length, topicIds: completeReviewClaims(state).topics.map(item => item.id),
      formulaCount: model.formulas.length, formulaIds: model.formulas.map(item => item.id),
      exampleCount: model.workedExamples.length, figureCount: model.figures.length, checklistCount: model.checklist.length,
    },
    workedExampleCoverageLedger: workedExampleCoverageLedger(model),
    chapters: model.courseChapters.map(chapter => ({
      id: chapter.id, title: chapter.title, status: chapter.status, priority: chapter.priority,
      contentMode: chapter.contentMode, learningObjectives: chapter.learningObjectives,
      assessmentSignals: chapter.assessmentSignals,
      topics: claims.topics.filter(item => item.chapterId === chapter.id).map(item => ({
        id: item.id, title: item.title, summary: item.summary, learningGoals: item.learningGoals, originalKeyConcepts: item.originalKeyConcepts, sourceIds: item.sourceIds,
      })),
      formulas: claims.formulas.filter(item => item.chapterId === chapter.id).map(item => ({
        id: item.id, name: item.name, expression: item.expression, variables: item.variables,
        units: item.units, assumptions: item.assumptions, sourceIds: item.sourceIds,
      })),
      workedExamples: claims.workedExamples.filter(item => item.chapterId === chapter.id).map(item => ({
        id: item.id, origin: item.origin, learningGoal: item.learningGoal, prompt: item.prompt,
        steps: item.steps, result: item.result, sourceIds: item.sourceIds,
      })),
      figures: claims.figures.filter(item => item.chapterId === chapter.id).map(item => ({
        id: item.id, kind: item.kind, title: item.title, caption: item.caption,
        sourcePage: item.sourcePage, sourceIds: item.sourceIds,
      })),
    })),
    unassignedClaims: {
      topics: claims.topics.filter(item => !knownChapterIds.has(item.chapterId ?? "")),
      formulas: claims.formulas.filter(item => !knownChapterIds.has(item.chapterId ?? "")),
      workedExamples: claims.workedExamples.filter(item => !knownChapterIds.has(item.chapterId ?? "")),
      figures: claims.figures.filter(item => !knownChapterIds.has(item.chapterId ?? "")),
    },
    checklist: claims.checklist,
    warnings: [...new Set([...model.warnings, ...(original.success ? original.data.warnings : [])])],
    quizStyleQuestions: original.success ? original.data.quiz_style_questions : [],
    sources: [...sourceIndex.values()].filter(source => referenced.has(source.id)),
  };
}

/** Preflight every complete atom and packet before starting any model call. */
export async function buildQualityReviewPackets(
  config: MoodleRuntimeConfig, state: LangGraphAgentState, previousReviewError: string | null = null,
): Promise<QualityReviewPacket[]> {
  const model = completeReviewClaims(state);
  const kinds = ["topics", "formulas", "workedExamples", "figures", "checklist"] as const;
  type Atom = { kind: typeof kinds[number]; value: QualityReviewClaims[typeof kinds[number]][number]; sourceIds: string[] };
  const groups = new Map<string, Atom[]>();
  for (const kind of kinds) for (const value of model[kind]) {
    const sourceIds = typeof value === "string" ? [] : value.sourceIds;
    const key = sourceIds[0] ?? "document";
    const list = groups.get(key) ?? [];
    list.push({ kind, value, sourceIds }); groups.set(key, list);
  }
  const add = (claims: QualityReviewClaims, atom: Atom): QualityReviewClaims => ({
    ...claims, [atom.kind]: [...claims[atom.kind], atom.value],
  });
  const primarySourceIds = (claims: QualityReviewClaims) => [...new Set([
    ...claims.topics, ...claims.formulas, ...claims.workedExamples, ...claims.figures,
  ].flatMap(item => item.sourceIds.slice(0, 1)))];
  const plan = await readVisualRetrievalPlan(config.runDir);
  const extracted = ExtractedDataSchema.safeParse(state.extracted_data);
  const imageDemands = new Map<string, number>();
  for (const id of [...new Set([...groups.values()].flatMap(group => group.flatMap(atom => atom.sourceIds)))]) {
    const visuals = await selectQualitySourceVisuals(config.runDir, state, { sourceIds: [id], plannedPages: true });
    const source = extracted.success ? extracted.data.sources.find(source => source.id === id) : undefined;
    const native = state.resource_manifest.resources.find(resource => source?.url && canonicalizeResourceUrl(resource.originUrl) === canonicalizeResourceUrl(source.url));
    const requested = plan?.requests.find(request => request.resourceId === native?.id)?.pages ?? [];
    const suppliedRequested = visuals.filter(visual => visual.sourcePage != null && requested.includes(visual.sourcePage));
    imageDemands.set(id, visuals.length ? Math.max(1, suppliedRequested.length) : 0);
  }
  const demand = (claims: QualityReviewClaims) => primarySourceIds(claims).reduce((sum, id) => sum + (imageDemands.get(id) ?? 0), 0);
  const packets: QualityReviewPacket[] = [];
  let current = emptyReviewClaims();
  let count = 0;
  const prepare = async (claims: QualityReviewClaims) => {
    const ids = primarySourceIds(claims);
    const visuals = await selectQualitySourceVisuals(config.runDir, state, ids.length ? { sourceIds: ids, plannedPages: true } : undefined);
    return { claims, sourceVisuals: visuals, prompt: composeQualityReviewPrompt(config, state, previousReviewError, visuals, claims, { index: 6, total: 6 }) };
  };
  const fits = (packet: QualityReviewPacket) => packet.prompt.length <= resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - QUALITY_REVIEW_PROMPT_MARGIN;
  const finish = async () => {
    const packet = await prepare(current);
    if (!fits(packet)) throw new QualityReviewCapacityError(`Complete content-review packet needs ${packet.prompt.length} prompt characters; budget ${resolveModelPromptBodyCharacterBudget("quality_reviewer", qualityReviewSchema) - QUALITY_REVIEW_PROMPT_MARGIN}. No claim was shortened or reviewed.`);
    packets.push(packet);
    if (packets.length > MAX_QUALITY_REVIEW_PACKETS) throw new QualityReviewCapacityError(`Complete content review exceeds ${MAX_QUALITY_REVIEW_PACKETS} packets. No sampled pass or model call is allowed.`);
    current = emptyReviewClaims(); count = 0;
  };
  // Source cohorts preserve nearby source context and avoid unrelated global figures
  // consuming the two original-image slots. Large cohorts split only between atoms.
  for (const group of groups.values()) for (const atom of group) {
    let candidate = add(current, atom);
    if (count && (demand(candidate) > 2 || !fits(await prepare(candidate)))) {
      // A complete atom with no source binding needs no new original-image
      // slots. Reuse an already prepared packet's free envelope before opening
      // another one solely because the current greedy packet is full.
      let backfilled = false;
      if (!atom.sourceIds.length) {
        for (let index = 0; index < packets.length; index++) {
          const earlier = await prepare(add(packets[index].claims, atom));
          if (!fits(earlier)) continue;
          packets[index] = earlier;
          backfilled = true;
          break;
        }
      }
      if (backfilled) continue;
      await finish(); candidate = add(current, atom);
    }
    const packet = await prepare(candidate);
    if (!fits(packet)) throw new QualityReviewCapacityError(`Complete ${atom.kind} atom needs ${packet.prompt.length} prompt characters; it cannot fit the existing review budget. No atom was shortened or reviewed.`);
    current = candidate; count++;
  }
  if (count || !packets.length) await finish();
  return packets.map((packet, index) => ({ ...packet, prompt: composeQualityReviewPrompt(config, state, previousReviewError, packet.sourceVisuals, packet.claims, { index: index + 1, total: packets.length }) }));
}

function validateQualityReview(value: unknown): {
  ok: boolean;
  summary: string;
  findings: QualityFinding[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality reviewer returned a non-object response.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.summary !== "string") {
    throw new Error("Quality reviewer response is missing ok or summary.");
  }
  if (!Array.isArray(record.findings)) throw new Error("Quality reviewer findings must be an array.");
  const findings = record.findings.map(validateQualityFinding);
  return {
    ok: record.ok,
    summary: record.summary,
    findings: findings.slice(0, 12),
  };
}

function validateQualityFinding(value: unknown): QualityFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality reviewer finding must be an object.");
  }
  const record = value as Record<string, unknown>;
  const nullableString = (field: string): string | null => {
    const fieldValue = record[field];
    if (fieldValue === null) return null;
    if (typeof fieldValue !== "string") {
      throw new Error(`Quality reviewer finding ${field} must be a string or null.`);
    }
    return fieldValue;
  };
  if (typeof record.message !== "string" || !record.message.trim()) {
    throw new Error("Quality reviewer finding message must be a non-empty string.");
  }
  const owners = ["source", "content", "interaction", "visual", "technical"] as const;
  const severities = ["blocking", "advisory"] as const;
  const repairTargets = ["source_architect", "content_analyzer", "visual_pipeline", "formatter", "none"] as const;
  if (!owners.includes(record.owner as typeof owners[number])) {
    throw new Error("Quality reviewer finding owner is invalid.");
  }
  if (!severities.includes(record.severity as typeof severities[number])) {
    throw new Error("Quality reviewer finding severity is invalid.");
  }
  if (record.defectKind !== undefined && record.defectKind !== null && !QUALITY_DEFECT_KINDS.includes(record.defectKind as QualityDefectKind)) {
    throw new Error("Quality reviewer finding defectKind is invalid.");
  }
  if (!repairTargets.includes(record.repairTarget as typeof repairTargets[number])) {
    throw new Error("Quality reviewer finding repairTarget is invalid.");
  }
  return {
    message: record.message.trim(),
    chapterTitle: nullableString("chapterTitle"),
    requirementId: nullableString("requirementId"),
    deliverableId: nullableString("deliverableId"),
    owner: record.owner as QualityFinding["owner"],
    severity: record.severity as QualityFinding["severity"],
    defectKind: record.defectKind == null ? null : record.defectKind as QualityDefectKind,
    repairTarget: record.repairTarget as QualityFinding["repairTarget"],
  };
}
