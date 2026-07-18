import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { studyGuideContentJsonSchema, studyGuideContentSchema, validateStudyGuideContentQuality } from "../studyGuideContent.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import { buildContentFromPracticeCorpus } from "../practiceCorpusContent.js";

export function createStudyGuideContentNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function studyGuideContentNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (config.kind !== "study-guide") return { study_guide_content: {}, error_log: null };
    try {
      const deterministic = buildContentFromPracticeCorpus(state.source_text, state.layout_spec);
      if (deterministic) {
        const parsed = studyGuideContentSchema.parse(deterministic);
        const issues = validateStudyGuideContentQuality(parsed);
        if (issues.length > 0) throw new Error(issues.join("\n- "));
        await writeFile(path.join(config.runDir, "study-guide-content.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        await config.diagnostics?.log("info", "planner", `Deterministically extracted and validated ${parsed.topics.flatMap((topic) => topic.exercises).length} concrete practice tasks from the Moodle corpus.`);
        return { study_guide_content: parsed as unknown as JsonObject, error_log: null };
      }
      const response = await codex.run(buildStudyGuideContentPrompt(config, state), {
        outputSchema: studyGuideContentJsonSchema,
        task: "quiz_solver",
        attempt: state.content_retry_count + 1,
      });
      const parsed = studyGuideContentSchema.parse(JSON.parse(stripJsonFence(response)));
      const issues = validateStudyGuideContentQuality(parsed);
      if (issues.length > 0) throw new Error(issues.join("\n- "));
      await writeFile(path.join(config.runDir, "study-guide-content.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      await config.diagnostics?.log("info", "planner", `Validated study-guide content bank with ${parsed.topics.length} topics and ${parsed.topics.flatMap((topic) => topic.exercises).length} exercises.`);
      return { study_guide_content: parsed as unknown as JsonObject, error_log: null };
    } catch (error) {
      const message = `Study-guide content builder failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "planner", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        content_retry_count: state.content_retry_count + 1,
      };
    }
  };
}

export function buildStudyGuideContentPrompt(config: WebLayoutRuntimeConfig, state: Pick<LangGraphWebLayoutState, "source_text" | "layout_spec" | "error_log">): string {
  return [
    "Build the canonical, source-grounded content bank for a Study Buddy study guide. Return JSON only.",
    "This is a content-analysis task, not a UI task. Do not describe layouts, controls, colors, or implementation.",
    "Extract and adapt concrete exercises from the supplied practice corpus. Preserve the mathematical substance, quantities, conditions, and original question type whenever evidence exists.",
    "For every exercise, sourceTask must identify the concrete source task (for example 'Minitest 4, Aufgabe 7'), not merely a chapter.",
    "Use provenance=source when the exercise is directly represented in the source and provenance=adapted only for a deliberate parameter variation of an evidenced pattern.",
    "Never manufacture generic prompts such as 'Welche Aussage trifft zu?', 'Wähle alle sinnvollen Schritte', or 'Berechne den Wert' without a complete mathematical statement.",
    "Kreuzerl distractors must encode plausible course-specific misconceptions and each option needs targeted feedback.",
    "Calculation exercises must be fully specified, include accepted exact/decimal answers as needed, and include a real derivation plus a concrete common mistake.",
    "Cover the full evidenced MAES2 topic range. Target 11 or more topics, at least 50 exercises total, at least 30 Kreuzerl/selection exercises, and at least 18 calculation exercises.",
    "Write readable theory and worked examples for every topic. Formula strings must contain normal mathematical notation suitable for deterministic MathML rendering later; never output HTML or MathML here.",
    "Do not claim official exam scoring. Explain gaps such as inaccessible Minitests in scopeNote.",
    state.error_log?.startsWith("Study-guide content builder failed:") ? `Repair these content-bank validation findings:\n${state.error_log}` : "",
    `Language: ${config.language}`,
    `Layout plan for scope only:\n${JSON.stringify(state.layout_spec, null, 2)}`,
    `Required JSON schema:\n${JSON.stringify(studyGuideContentJsonSchema, null, 2)}`,
    `Canonical source corpus:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}
