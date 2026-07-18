import type { CodexClient } from "../codexClient.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray } from "../validation.js";
import {
  buildVisualPageIndex,
  compactVisualPageIndexForPrompt,
  VisualRetrievalPlanSchema,
  visualRetrievalPlanJsonSchema,
  writeVisualRetrievalPlan,
} from "../visualPlanner.js";

export function createVisualPlannerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
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

      const response = await codex.run(buildVisualPlannerPrompt(config, state, pageIndex), {
        outputSchema: visualRetrievalPlanJsonSchema,
        task: "artifact_planner",
        attempt: state.retry_count + 1,
      });
      const parsed = VisualRetrievalPlanSchema.parse(parseJsonObjectOrArray(response));
      const allowedResourceIds = new Set(pageIndex.entries.map((entry) => entry.resourceId));
      const pageCountsByResource = new Map(pageIndex.entries.map((entry) => [entry.resourceId, entry.pageCount]));
      const sanitized = VisualRetrievalPlanSchema.parse({
        ...parsed,
        requests: parsed.requests
          .filter((request) => allowedResourceIds.has(request.resourceId))
          .map((request) => {
            const pageCount = pageCountsByResource.get(request.resourceId) ?? 0;
            return {
              ...request,
              pages: [...new Set(request.pages)]
                .filter((page) => page >= 1 && page <= pageCount)
                .sort((left, right) => left - right),
            };
          })
          .filter((request) => request.pages.length > 0),
      });
      const completePlan = augmentLookupDependencies(sanitized, pageIndex);

      await writeVisualRetrievalPlan(config.runDir, completePlan);
      await config.diagnostics?.log(
        "info",
        "diagnostic",
        `Visual planner requested ${completePlan.requests.reduce((sum, request) => sum + request.pages.length, 0)} page(s) across ${completePlan.requests.length} request(s).`,
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

function buildVisualPlannerPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  pageIndex: Awaited<ReturnType<typeof buildVisualPageIndex>>,
): string {
  const evidence = {
    records: state.evidence_package.records.slice(0, 240).map((record) => ({
      resourceId: record.resourceId,
      kind: record.kind,
      locator: record.locator,
      content: record.content.slice(0, 500),
    })),
    warnings: state.evidence_package.warnings,
  };
  const chapters = state.resource_manifest.resources
    .filter((resource) => resource.sectionPath.length > 0)
    .map((resource) => ({
      id: resource.id,
      title: resource.title,
      sectionPath: resource.sectionPath,
      localPath: resource.localPath,
    }));
  return [
    "You are the Study Buddy Visual Planner for Moodle/CIS learning artifacts.",
    "Your job is not to write the document. Your job is to request visual retrieval from source PDFs before the final analyzer runs.",
    "Return only JSON matching the schema. Do not include Markdown fences.",
    "Planning principles:",
    "- Visuals are usually valuable for learning. Prefer requesting useful pages over being overly conservative.",
    "- Request pages for worked examples, exercises, solutions, tables, diagrams, formula reference pages, chapter-opening context, and relevant cover/title pages.",
    "- If examples or solutions are near the end of a PDF, explicitly request those late pages.",
    "- A worked example that explicitly says to use a table, table book (for example TB 2-1), diagram, characteristic curve, or nomogram is not self-contained without that lookup asset. Request both the example page and the relevant table/diagram pages, including nearby preceding reference pages.",
    "- Spread requests over Moodle chapters and sources; do not spend all requests on the first chapter unless the course material genuinely only covers that chapter.",
    "- Use source-related title/cover/logo/context visuals when they improve orientation, but do not request random decorative pages.",
    "- Keep requests focused: use concrete page numbers. Prefer 1-4 pages per reason; use more only for dense example/table sections.",
    "- Do not invent facts. Base page choices on page index signals, evidence records, and Moodle chapter/resource names.",
    `Artifact profile: ${config.artifactIntent.profile}.`,
    `User request:\n${config.prompt}`,
    `Moodle resource/chapter map:\n${JSON.stringify(chapters, null, 2)}`,
    `Evidence summary:\n${JSON.stringify(evidence, null, 2)}`,
    `Visual page index:\n${JSON.stringify(compactVisualPageIndexForPrompt(pageIndex), null, 2)}`,
  ].join("\n\n");
}

function augmentLookupDependencies(
  plan: ReturnType<typeof VisualRetrievalPlanSchema.parse>,
  pageIndex: Awaited<ReturnType<typeof buildVisualPageIndex>>,
): ReturnType<typeof VisualRetrievalPlanSchema.parse> {
  const requests = [...plan.requests];
  for (const entry of pageIndex.entries) {
    const dependencyPages = entry.pages.filter((page) => hasLookupDependency(page.hint));
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

function hasLookupDependency(text: string): boolean {
  return /(?:mit\s+den\s+werten\s+der\s+tabellen|tabellen?\s*TB\s*\d|TB\s*\d+\s*[-–]\s*\d+|nach\s+(?:der\s+)?tabelle|aus\s+(?:der\s+)?tabelle|tabellenbuch|nomogramm|aus\s+(?:dem\s+)?diagramm\s+ablesen)/i.test(text);
}
