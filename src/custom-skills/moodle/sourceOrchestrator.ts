import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { createCisScraperNode } from "./nodes/cisScraperNode.js";
import { createScraperNode } from "./nodes/scraperNode.js";
import { assessFollowUpCrawl } from "./sourceNeedAssessment.js";
import { planSources } from "./sourcePlanner.js";
import type { SourceTarget } from "./sourcePlanner.js";
import { writeRunProgress } from "./runProgress.js";

export type SourceNode = (state: LangGraphAgentState) => Promise<Partial<LangGraphAgentState>>;

export interface SourceOrchestratorDependencies {
  scraperNode?: SourceNode;
  cisScraperNode?: SourceNode;
}

export function createSourcePlannerNode(config: MoodleRuntimeConfig) {
  return async function sourcePlannerNode(): Promise<Partial<LangGraphAgentState>> {
    const plan = planSources(config);
    config.sourcePlan = plan;
    await config.diagnostics?.log("info", "config", `Source plan: ${plan.targets.join(", ") || "none"} (${plan.confidence})`, {
      reason: plan.reason,
      needsCurrentScheduleData: plan.needsCurrentScheduleData,
      needsCourseMaterial: plan.needsCourseMaterial,
      needsFiles: plan.needsFiles,
      needsQuizOrAssignment: plan.needsQuizOrAssignment,
    });
    await writeRunProgress(config, { phase: "planning_sources", sourcePlan: plan });
    return { error_log: null };
  };
}

export function createSourceOrchestratorNode(
  config: MoodleRuntimeConfig,
  dependencies: SourceOrchestratorDependencies = {},
) {
  return async function sourceOrchestratorNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const initialPlan = config.sourcePlan ?? planSources(config);
    config.sourcePlan = initialPlan;
    const scraperNode = dependencies.scraperNode ?? createScraperNode(config);
    const cisScraperNode = dependencies.cisScraperNode ?? createCisScraperNode(config);

    const initialResult = await runTargets({
      config,
      state,
      targets: initialPlan.targets,
      scraperNode,
      cisScraperNode,
    });
    let mergedText = mergeRawText([
      state.moodle_raw_text,
      initialResult.moodleText,
      initialResult.cisText,
      ...initialResult.warnings,
    ]);
    const followUp = assessFollowUpCrawl({
      prompt: config.prompt,
      plan: initialPlan,
      coverage: config.diagnostics?.getCoverage() ?? emptyCoverage(),
      rawText: mergedText,
    });

    if (followUp.targets.length > 0) {
      await config.diagnostics?.log("info", "diagnostic", followUp.reason, {
        followUpTargets: followUp.targets,
      });
      await writeRunProgress(config, {
        phase: "checking_missing_sources",
        followUpTargets: followUp.targets,
      });
      const followUpResult = await runTargets({
        config,
        state: { ...state, moodle_raw_text: mergedText },
        targets: followUp.targets,
        scraperNode,
        cisScraperNode,
        followUp: true,
      });
      mergedText = mergeRawText([
        mergedText,
        followUpResult.moodleText,
        followUpResult.cisText,
        ...followUpResult.warnings,
      ]);
    }

    await writeRunProgress(config, { phase: "analyzing" });
    return {
      moodle_raw_text: mergedText,
      error_log: null,
    };
  };
}

async function runTargets(input: {
  config: MoodleRuntimeConfig;
  state: LangGraphAgentState;
  targets: SourceTarget[];
  scraperNode: SourceNode;
  cisScraperNode: SourceNode;
  followUp?: boolean;
}): Promise<{ moodleText: string; cisText: string; warnings: string[] }> {
  const targets = [...new Set(input.targets)];
  const shouldRunMoodle = targets.includes("moodle");
  const shouldRunCis = targets.includes("cis");
  if (!shouldRunMoodle && !shouldRunCis) {
    return { moodleText: "", cisText: "", warnings: [] };
  }

  const emptyState = { ...input.state, moodle_raw_text: "" };
  const progressPhase = shouldRunMoodle && !shouldRunCis
    ? "reading_moodle"
    : shouldRunCis && !shouldRunMoodle
      ? "reading_cis"
      : "reading_sources";
  await writeRunProgress(input.config, { phase: progressPhase });
  const [moodleResult, cisResult] = await Promise.allSettled([
    shouldRunMoodle ? input.scraperNode(emptyState) : Promise.resolve({}),
    shouldRunCis ? input.cisScraperNode(emptyState) : Promise.resolve({}),
  ]);
  const warnings: string[] = [];
  if (moodleResult.status === "rejected") {
    const message = errorMessage(moodleResult.reason);
    warnings.push(`[Moodle warning]\nMoodle crawl failed in source orchestrator: ${message}`);
    await input.config.diagnostics?.markFailure("moodle", {
      detail: message,
      attemptedUrls: [input.config.moodleUrl],
      failureKind: message.toLowerCase().includes("timeout") ? "timeout" : "unknown",
    });
  }
  if (cisResult.status === "rejected") {
    const message = errorMessage(cisResult.reason);
    warnings.push(`[CIS warning]\nCIS crawl failed in source orchestrator: ${message}`);
    await input.config.diagnostics?.markFailure("cis", {
      detail: message,
      attemptedUrls: input.config.cisUrls,
      failureKind: message.toLowerCase().includes("timeout") ? "timeout" : "unknown",
    });
  }
  return {
    moodleText: fulfilledText(moodleResult),
    cisText: fulfilledText(cisResult),
    warnings,
  };
}

function fulfilledText(result: PromiseSettledResult<Partial<LangGraphAgentState>>): string {
  return result.status === "fulfilled" ? result.value.moodle_raw_text ?? "" : "";
}

function mergeRawText(parts: string[]): string {
  const seen = new Set<string>();
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      if (seen.has(part)) {
        return false;
      }
      seen.add(part);
      return true;
    })
    .join("\n\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyCoverage() {
  return {
    moodle: {
      status: "not_requested" as const,
      detail: "No coverage diagnostics available.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
    cis: {
      status: "not_requested" as const,
      detail: "No coverage diagnostics available.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
  };
}
