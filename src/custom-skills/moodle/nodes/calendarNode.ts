import {
  formatCalendarEventsForWorkflow,
  readCalendarEvents,
  writeFilteredCalendarArtifact,
} from "../calendarAdapter.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";

export function createCalendarNode(config: MoodleRuntimeConfig) {
  return async function calendarNode(
    _state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    if (!config.calendarUrl) {
      await config.diagnostics?.updateCoverage("calendar", {
        status: "not_requested",
        detail: "No personal calendar feed was configured.",
      });
      return {};
    }

    await config.diagnostics?.log("info", "calendar", "Checking personal university calendar.");
    const selection = await readCalendarEvents(config.calendarUrl, config.prompt);
    config.calendarSelection = selection;
    const artifact = await writeFilteredCalendarArtifact(config.runDir, selection.events);
    if (selection.status === "failed") {
      await config.diagnostics?.markFailure("calendar", {
        detail: selection.detail,
        failureKind: selection.detail.toLowerCase().includes("timed out") ? "timeout" : "network",
      });
    } else {
      await config.diagnostics?.markSuccess("calendar", {
        detail: selection.detail,
        urls: [],
        pages: selection.events.length,
        partial: !selection.complete,
      });
      await config.diagnostics?.updateCoverage("calendar", { artifacts: [artifact] });
    }
    return {
      moodle_raw_text: formatCalendarEventsForWorkflow(selection.events),
      error_log: null,
    };
  };
}
