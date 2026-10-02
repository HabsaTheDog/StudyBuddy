import type { LangGraphAgentState } from "./state.js";
import type { ExtractedData } from "./schemas.js";
import { canonicalizeResourceUrl, isResourceFailureStatus } from "./resourceAcquisition.js";

export const DOCUMENT_CONTEXT_CHARACTER_LIMIT = 8_000;

/** Carry acquired document context separately from the topical chapter budget. */
export function buildDocumentContext(state: LangGraphAgentState): ExtractedData["document_context"] {
  const architecture = state.source_architect_decision.learningArchitecture;
  const excluded = new Set((architecture?.excludedResourceUrls ?? []).map(canonicalizeResourceUrl));
  const generalUrls = new Set((architecture?.supportResources ?? [])
    .filter(support => support.purpose === "general_reference")
    .flatMap(support => support.resourceUrls).map(canonicalizeResourceUrl));
  const courseUrl = canonicalizeResourceUrl(state.resource_manifest.courseUrl ?? "");
  const resources = state.resource_manifest.resources.filter(resource => {
    const url = canonicalizeResourceUrl(resource.originUrl);
    return !excluded.has(url) && resource.selection?.selected !== false && resource.status !== "skipped" &&
      !isResourceFailureStatus(resource.status) &&
      // Native page context is document-wide. Topical reference PDFs retain
      // the existing chapter relevance gates and never enter every packet.
      (!resource.localPath || ["course", "quiz", "page", "assignment"].includes(resource.activityType)) &&
      (generalUrls.has(url) || (resource.activityType === "course" && url === courseUrl)) &&
      state.evidence_package.records.some(record => record.resourceId === resource.id && record.content.trim());
  }).sort((left, right) => Number(generalUrls.has(canonicalizeResourceUrl(right.originUrl))) -
    Number(generalUrls.has(canonicalizeResourceUrl(left.originUrl))));
  const context: ExtractedData["document_context"] = [];
  for (const resource of resources) {
    const entry = { source_id: resource.id, title: resource.title, url: resource.originUrl, records: [],
      omitted_records: state.evidence_package.records.filter(record => record.resourceId === resource.id).length };
    if (JSON.stringify([...context, entry]).length <= DOCUMENT_CONTEXT_CHARACTER_LIMIT) context.push(entry);
  }
  const tokens = [...new Set((state.request_contract.originalPrompt.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []))];
  const perSourceBudget = Math.floor((DOCUMENT_CONTEXT_CHARACTER_LIMIT - JSON.stringify(context).length) / Math.max(1, context.length));
  for (const entry of context) {
    const ranked = state.evidence_package.records.filter(record => record.resourceId === entry.source_id)
      .map((record, index) => ({ record, index,
        // A course page often carries the exact announcement of a separately
        // selected reference. Preserve that identity before generic vocabulary.
        identityMatches: context.filter(source => source.source_id !== entry.source_id &&
          record.content.toLocaleLowerCase().includes(source.title.toLocaleLowerCase())).length,
        score: tokens.filter(token => record.content.toLocaleLowerCase().includes(token)).length }))
      .sort((left, right) => right.identityMatches - left.identityMatches || right.score - left.score || left.index - right.index);
    let used = 0;
    for (const { record } of ranked) {
      const excerpt = { record_id: record.id, locator: { ...record.locator }, excerpt: record.content };
      const size = JSON.stringify(excerpt).length + 1;
      // Retain complete source-exact excerpts, not arbitrary prefixes that may
      // cut out the actual announcement. Omitted records remain explicit.
      if (used + size > perSourceBudget) continue;
      entry.records.push(excerpt);
      entry.omitted_records -= 1;
      used += size;
    }
  }
  return context;
}

export function documentContextPrompt(state: LangGraphAgentState): string {
  const context = buildDocumentContext(state);
  if (context.length === 0) return "";
  return `Document-level source context (native titles and exact excerpts, separate from chapter learning scope; source_id values are allowed citation IDs):\n${JSON.stringify(context)}`;
}
