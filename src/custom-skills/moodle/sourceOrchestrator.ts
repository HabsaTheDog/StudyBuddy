import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { createCisScraperNode } from "./nodes/cisScraperNode.js";
import { createCalendarNode } from "./nodes/calendarNode.js";
import { createScraperNode } from "./nodes/scraperNode.js";
import { assessFollowUpCrawl } from "./sourceNeedAssessment.js";
import { planSources } from "./sourcePlanner.js";
import type { SourceTarget } from "./sourcePlanner.js";
import { resolveTaskBudget } from "./taskBudget.js";
import { writeRunProgress } from "./runProgress.js";

export type SourceNode = (state: LangGraphAgentState) => Promise<Partial<LangGraphAgentState>>;

export interface SourceOrchestratorDependencies {
  scraperNode?: SourceNode;
  cisScraperNode?: SourceNode;
  calendarNode?: SourceNode;
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
    const budget = resolveTaskBudget(config.intentDecision);
    const boundedConfig = config.intentDecision?.wantsQuickAnswer
      ? {
          ...config,
          maxPages: Math.min(config.maxPages, budget.maxMoodlePages),
          maxDepth: Math.min(config.maxDepth, budget.maxMoodleDepth),
          maxCisPages: Math.min(config.maxCisPages, budget.maxCisPages),
        }
      : config;
    const targetedMoodleConfig = config.targetCourseUrls?.[0]
      ? { ...boundedConfig, moodleUrl: config.targetCourseUrls[0] }
      : boundedConfig;
    const scraperNode = dependencies.scraperNode ?? createScraperNode(targetedMoodleConfig);
    const cisScraperNode = dependencies.cisScraperNode ?? createCisScraperNode(boundedConfig);
    const calendarNode = dependencies.calendarNode ?? createCalendarNode(config);

    const initialResult = await runTargets({
      config,
      state,
      targets: initialPlan.targets,
      scraperNode,
      cisScraperNode,
      calendarNode,
    });
    let mergedText = mergeRawText([
      state.moodle_raw_text,
      initialResult.moodleText,
      initialResult.cisText,
      initialResult.calendarText,
      ...initialResult.warnings,
    ]);
    const completedFollowUpTargets: SourceTarget[] = [];
    if (initialPlan.targets.includes("calendar") && config.calendarSelection?.needsCisFallback) {
      const fallbackTargets: SourceTarget[] = [];
      const isScheduleLookup = config.intentDecision?.intent === "schedule_answer" ||
        (initialPlan.needsCurrentScheduleData && !initialPlan.needsCourseMaterial);
      if (
        isScheduleLookup &&
        !initialPlan.targets.includes("moodle")
      ) {
        fallbackTargets.push("moodle");
      }
      if (
        config.includeCis &&
        config.cisUrls.length > 0 &&
        !initialPlan.targets.includes("cis")
      ) {
        fallbackTargets.push("cis");
      }
      const reason = config.calendarSelection.status === "failed"
        ? "Calendar unavailable; loading bounded Moodle/CIS schedule fallbacks."
        : config.calendarSelection.events.length === 0
          ? "No matching calendar event; loading bounded Moodle/CIS schedule fallbacks."
          : `Calendar event is missing required fields (${config.calendarSelection.missingFields.join(", ")}); loading bounded Moodle/CIS schedule fallbacks.`;
      await config.diagnostics?.log("info", "diagnostic", reason);
      await writeRunProgress(config, {
        phase: "checking_missing_sources",
        followUpTargets: fallbackTargets,
      });
      const fallbackResult = await runTargets({
        config,
        state: { ...state, moodle_raw_text: mergedText },
        targets: fallbackTargets,
        scraperNode,
        cisScraperNode,
        calendarNode,
        followUp: true,
        reasonCodes: ["missing_cis_schedule"],
      });
      completedFollowUpTargets.push(...fallbackTargets);
      mergedText = mergeRawText([
        mergedText,
        fallbackResult.moodleText,
        fallbackResult.cisText,
        ...fallbackResult.warnings,
      ]);
    }
    const followUp = assessFollowUpCrawl({
      prompt: config.prompt,
      plan: initialPlan,
      coverage: config.diagnostics?.getCoverage() ?? emptyCoverage(),
      rawText: mergedText,
      completedTargets: completedFollowUpTargets,
    });

    if (followUp.targets.length > 0) {
      await config.diagnostics?.log("info", "diagnostic", followUp.reason, {
        followUpTargets: followUp.targets,
        reasonCodes: followUp.reasonCodes,
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
        calendarNode,
        followUp: true,
        reasonCodes: followUp.reasonCodes,
      });
      mergedText = mergeRawText([
        mergedText,
        followUpResult.moodleText,
        followUpResult.cisText,
        followUpResult.calendarText,
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
  calendarNode: SourceNode;
  followUp?: boolean;
  reasonCodes?: string[];
}): Promise<{ moodleText: string; cisText: string; calendarText: string; warnings: string[] }> {
  const targets = [...new Set(input.targets)];
  const shouldRunMoodle = targets.includes("moodle");
  const shouldRunCis = targets.includes("cis");
  const shouldRunCalendar = targets.includes("calendar");
  if (!shouldRunMoodle && !shouldRunCis && !shouldRunCalendar) {
    return { moodleText: "", cisText: "", calendarText: "", warnings: [] };
  }

  const emptyState = { ...input.state, moodle_raw_text: "" };
  const progressPhase = shouldRunMoodle && !shouldRunCis
    ? shouldRunCalendar ? "reading_sources" : "reading_moodle"
    : shouldRunCis && !shouldRunMoodle
      ? "reading_cis"
      : shouldRunCalendar && !shouldRunMoodle && !shouldRunCis
        ? "reading_calendar"
      : "reading_sources";
  await writeRunProgress(input.config, { phase: progressPhase });
  const warnings: string[] = [];
  const effectiveScraperNode = shouldRunMoodle && input.followUp && targetCourseFollowUp(input.reasonCodes) && input.config.targetCourseUrls?.[0]
    ? createScraperNode({
        ...input.config,
        moodleUrl: input.config.targetCourseUrls[0],
        maxDepth: Math.min(input.config.maxDepth, resolveTaskBudget(input.config.intentDecision).maxMoodleDepth),
        maxPages: Math.min(input.config.maxPages, resolveTaskBudget(input.config.intentDecision).maxMoodlePages),
      })
    : input.scraperNode;
  if (shouldRunMoodle && input.followUp && targetCourseFollowUp(input.reasonCodes) && !input.config.targetCourseUrls?.[0]) {
    warnings.push("[Moodle warning]\nTarget-course follow-up requested, but no resolved Moodle course URL is known.");
  }

  const [moodleResult, cisResult, calendarResult] = await Promise.allSettled([
    shouldRunMoodle ? effectiveScraperNode(emptyState) : Promise.resolve({}),
    shouldRunCis ? input.cisScraperNode(emptyState) : Promise.resolve({}),
    shouldRunCalendar ? input.calendarNode(emptyState) : Promise.resolve({}),
  ]);
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
  if (calendarResult.status === "rejected") {
    const message = errorMessage(calendarResult.reason);
    warnings.push(`[Calendar warning]\nCalendar read failed in source orchestrator: ${message}`);
    await input.config.diagnostics?.markFailure("calendar", {
      detail: message,
      failureKind: message.toLowerCase().includes("timeout") ? "timeout" : "unknown",
    });
  }
  return {
    moodleText: fulfilledText(moodleResult),
    cisText: fulfilledText(cisResult),
    calendarText: fulfilledText(calendarResult),
    warnings,
  };
}

function targetCourseFollowUp(reasonCodes: string[] = []): boolean {
  return reasonCodes.includes("wrong_moodle_course") || reasonCodes.includes("missing_target_course");
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
    calendar: {
      status: "not_requested" as const,
      detail: "No coverage diagnostics available.",
      urls: [],
      attemptedUrls: [],
      pages: 0,
      artifacts: [],
    },
  };
}
