import type { CodexClient } from "../codexClient.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import {
  buildVisualPageIndex,
  VisualRetrievalPlanSchema,
  type VisualPageIndex,
  type VisualRetrievalPlan,
  writeVisualRetrievalPlan,
} from "../visualPlanner.js";

export function createVisualPlannerNode(config: MoodleRuntimeConfig, _codex: CodexClient) {
  return async function visualPlannerNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    if (!config.visualsEnabled) {
      await config.diagnostics?.log("info", "diagnostic", "Visual planner skipped because visuals are disabled.");
      return { error_log: null };
    }

    try {
      const pageIndex = await buildVisualPageIndex(config, state);
      if (pageIndex.entries.length === 0) {
        await writeVisualRetrievalPlan(config.runDir, {
          schemaVersion: "1.0",
          strategy: "No local PDF page index was available; visual discovery will use deterministic source candidates only.",
          requests: [],
        });
        await config.diagnostics?.log("info", "diagnostic", "Visual planner found no PDF page index to plan from.");
        return { error_log: null };
      }

      const completePlan = buildDeterministicVisualPlan(config, state, pageIndex);

      await writeVisualRetrievalPlan(config.runDir, completePlan);
      await config.diagnostics?.log(
        "info",
        "diagnostic",
        `Deterministic visual planner selected ${completePlan.requests.reduce((sum, request) => sum + request.pages.length, 0)} page(s) across ${completePlan.requests.length} request(s) without a model call.`,
      );
      return { error_log: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await config.diagnostics?.log("warn", "diagnostic", `Visual planner skipped after failure: ${message}`);
      await writeVisualRetrievalPlan(config.runDir, {
        schemaVersion: "1.0",
        strategy: `Planner failed; deterministic visual discovery fallback is used. Reason: ${message}`,
        requests: [],
      }).catch(() => undefined);
      return { error_log: null };
    }
  };
}

/**
 * Visual page selection is intentionally deterministic. The previous model
 * planner repeated the full architecture, evidence summary, and page index,
 * which made it one of the largest prompts in a normal PDF run while adding
 * no new factual evidence. Page-text signals and architecture assignments are
 * sufficient to make a bounded, reproducible retrieval plan.
 */
export function buildDeterministicVisualPlan(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  pageIndex: VisualPageIndex,
): VisualRetrievalPlan {
  const maxPages = {
    auto: 16,
    fast: 8,
    balanced: 14,
    quality: 24,
    custom: 14,
  }[config.executionProfile];
  const maxPagesPerResource = config.executionProfile === "quality"
    ? 3
    : config.executionProfile === "fast"
      ? 1
      : 2;
  const architectureUrls = new Set(
    (state.source_architect_decision.learningArchitecture?.modules ?? [])
      .flatMap((module) => module.resourceUrls),
  );
  const directResourceIds = new Set(
    state.resource_manifest.resources
      .filter((resource) =>
        architectureUrls.has(resource.originUrl) ||
        (resource.resolvedUrl ? architectureUrls.has(resource.resolvedUrl) : false)
      )
      .map((resource) => resource.id),
  );
  const candidates = pageIndex.entries.map((entry, entryIndex) => ({
    entry,
    entryIndex,
    direct: directResourceIds.has(entry.resourceId),
    pages: entry.pages
      .map((page) => ({ page, score: visualPageScore(page.signals) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.page.page - right.page.page),
  }));
  const selected = new Map<string, typeof pageIndex.entries[number]["pages"]>();
  const add = (
    entry: typeof pageIndex.entries[number],
    page: typeof entry.pages[number] | undefined,
  ) => {
    if (!page) return;
    if ([...selected.values()].reduce((sum, pages) => sum + pages.length, 0) >= maxPages) return;
    const pages = selected.get(entry.resourceId) ?? [];
    if (pages.length >= maxPagesPerResource || pages.some((candidate) => candidate.page === page.page)) return;
    selected.set(entry.resourceId, [...pages, page]);
  };

  // First preserve architecture breadth, then add one stronger second visual
  // per resource. This avoids allowing one long slide deck to consume the run.
  for (let rank = 0; rank < maxPagesPerResource; rank += 1) {
    for (const candidate of [...candidates].sort((left, right) =>
      Number(right.direct) - Number(left.direct) || left.entryIndex - right.entryIndex
    )) {
      add(candidate.entry, candidate.pages[rank]?.page);
    }
  }

  const base = VisualRetrievalPlanSchema.parse({
    schemaVersion: "1.0",
    strategy:
      `Deterministic bounded selection from PDF page-text signals (${maxPages} page ceiling; ` +
      `${maxPagesPerResource} per resource) with architecture-assigned resources prioritized.`,
    requests: pageIndex.entries.flatMap((entry) => {
      const pages = selected.get(entry.resourceId);
      if (!pages?.length) return [];
      const signals = new Set(pages.flatMap((page) => page.signals));
      return [{
        resourceId: entry.resourceId,
        pages: pages.map((page) => page.page).sort((left, right) => left - right),
        purpose: visualPurpose(signals),
        priority: directResourceIds.has(entry.resourceId) ? "high" : "medium",
        placementHint: "Place beside the matching explanation or worked example in the assigned chapter.",
        reason: "Selected deterministically from source-backed page signals and bounded for broad chapter coverage.",
      }];
    }),
  });
  return augmentLookupDependencies(base, pageIndex);
}

function augmentLookupDependencies(
  plan: ReturnType<typeof VisualRetrievalPlanSchema.parse>,
  pageIndex: Awaited<ReturnType<typeof buildVisualPageIndex>>,
): ReturnType<typeof VisualRetrievalPlanSchema.parse> {
  const requests = [...plan.requests];
  const plannedResourceIds = new Set(requests.map((request) => request.resourceId));
  for (const entry of pageIndex.entries.filter((candidate) =>
    plannedResourceIds.has(candidate.resourceId)
  )) {
    const dependencyPages = entry.pages
      .filter((page) => hasLookupDependency(page.hint))
      .slice(0, 2);
    if (dependencyPages.length === 0) continue;
    const pages = new Set<number>();
    for (const dependency of dependencyPages) {
      pages.add(dependency.page);
      for (const candidate of entry.pages) {
        if (
          candidate.page < dependency.page &&
          candidate.page >= Math.max(1, dependency.page - 4) &&
          (candidate.signals.includes("table") || candidate.signals.includes("diagram_or_figure"))
        ) {
          pages.add(candidate.page);
        }
      }
      if (![...pages].some((page) => page < dependency.page)) {
        if (dependency.page > 2) pages.add(dependency.page - 2);
        if (dependency.page > 1) pages.add(dependency.page - 1);
      }
    }
    const existing = requests.find((request) =>
      request.resourceId === entry.resourceId && request.purpose === "table"
    );
    if (existing) {
      existing.pages = [...new Set([...existing.pages, ...pages])].sort((left, right) => left - right);
    } else {
      requests.push({
        resourceId: entry.resourceId,
        pages: [...pages].sort((left, right) => left - right),
        purpose: "table",
        priority: "high",
        placementHint: "Place the lookup table/diagram immediately before or beside the dependent worked example in the same chapter.",
        reason: "The source explicitly requires a table/diagram lookup; retrieve the dependency and its worked-example page together.",
      });
    }
  }
  return VisualRetrievalPlanSchema.parse({ ...plan, requests });
}

function visualPageScore(signals: string[]): number {
  const values = new Set(signals);
  return (
    Number(values.has("solution")) * 9 +
    Number(values.has("worked_example")) * 8 +
    Number(values.has("table")) * 7 +
    Number(values.has("diagram_or_figure")) * 6 +
    Number(values.has("formula_or_math")) * 3 -
    Number(values.has("context_logo")) * 10
  );
}

function visualPurpose(
  signals: Set<string>,
): VisualRetrievalPlan["requests"][number]["purpose"] {
  if (signals.has("table")) return "table";
  if (signals.has("solution") || signals.has("worked_example")) return "worked_example";
  if (signals.has("diagram_or_figure")) return "diagram";
  if (signals.has("formula_or_math")) return "formula_reference";
  return "context";
}

function hasLookupDependency(text: string): boolean {
  return /(?:mit\s+den\s+werten\s+der\s+tabellen|tabellen?\s*TB\s*\d|TB\s*\d+\s*[-–]\s*\d+|nach\s+(?:der\s+)?tabelle|aus\s+(?:der\s+)?tabelle|tabellenbuch|nomogramm|aus\s+(?:dem\s+)?diagramm\s+ablesen)/i.test(text);
}
