import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { studyGuideContentJsonSchema, studyGuideContentSchema, validateStudyGuideContentQuality, type StudyGuideContent } from "../studyGuideContent.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import { buildContentFromPracticeCorpus } from "../practiceCorpusContent.js";
import { deriveStudyGuideRequirements, isMaes2PracticeCorpus, knownHandoffSourceUrls } from "../studyGuideProfile.js";

export function createStudyGuideContentNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function studyGuideContentNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    if (config.kind !== "study-guide") return { study_guide_content: {}, error_log: null };
    try {
      const requirements = deriveStudyGuideRequirements(state.source_text);
      // The reusable MAES corpus is authored in German. English artifacts use
      // the model-backed content builder so course material is translated
      // instead of being mislabeled as English metadata around German prose.
      const deterministic = config.language === "de" && isMaes2PracticeCorpus(state.source_text)
        ? buildContentFromPracticeCorpus(state.source_text, state.layout_spec)
        : null;
      if (deterministic) {
        const parsed = studyGuideContentSchema.parse(deterministic);
        const issues = [...validateStudyGuideContentQuality(parsed, requirements), ...validateSourceRegistry(parsed, state.source_text)];
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
      const issues = [...validateStudyGuideContentQuality(parsed, requirements), ...validateSourceRegistry(parsed, state.source_text)];
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
  const requirements = deriveStudyGuideRequirements(state.source_text);
  return [
    "Build the canonical, source-grounded content bank for a Study Buddy study guide. Return JSON only.",
    "This is a content-analysis task, not a UI task. Do not describe layouts, controls, colors, or implementation.",
    "Extract concrete exercises from supplied quizzes, worksheets, assignments, and worked examples whenever they exist. Preserve their substance, quantities, conditions, and original question type.",
    "For every exercise, sourceTask must identify the concrete source task (for example 'Minitest 4, Aufgabe 7'), not merely a chapter.",
    "Use provenance=source only when the exercise is directly represented in the evidence. Use provenance=adapted for a deliberate parameter variation of an evidenced exercise pattern. Use provenance=derived for new practice synthesized from a concrete cited slide, script section, learning objective, case, diagram, or definition.",
    "When direct exercises are sparse, create useful derived practice instead of generic filler. Quantitative sources should yield fully specified worked calculations. Conceptual sources should yield comparison, sequencing, classification, explanation, and misconception checks. Case-based sources should yield realistic decisions or scenarios grounded in the supplied facts. Never invent course facts, clinical recommendations, legal rules, official scoring, or unsupported numerical constants.",
    "Every derived sourceTask must name the concrete source concept, for example 'Abgeleitet aus Skript Kapitel 3: Lagerauswahl' or 'Abgeleitet aus Folie 18: Marktformen'. The source label must correspond to an entry in the source register.",
    "Never manufacture generic prompts such as 'Welche Aussage trifft zu?', 'Wähle alle sinnvollen Schritte', or 'Berechne den Wert' without a complete mathematical statement.",
    "Kreuzerl distractors must encode plausible course-specific misconceptions and each option needs targeted feedback.",
    "Calculation exercises must be fully specified, include accepted exact/decimal answers as needed, and include a real derivation plus a concrete common mistake. Do not force calculation exercises into a non-quantitative topic.",
    `Evidence-adaptive course profile: ${requirements.archetype}. Cover at least ${requirements.topicTarget} evidenced topics and create at least ${requirements.exerciseTarget} substantive exercises total, including at least ${requirements.selectionTarget} selection/retrieval exercises and ${requirements.calculationTarget} genuine calculations. The handoff exposes about ${requirements.sourceExerciseCount} direct source exercises, so at least ${requirements.derivedPracticeMinimum} tasks may need to be transparently derived from course content.`,
    `Profile rationale: ${requirements.rationale}`,
    "Write readable theory and a complete worked example for every topic. Formula strings must contain normal mathematical notation suitable for deterministic MathML rendering later; never output HTML or MathML here. Leave formulas empty for topics without meaningful mathematical notation.",
    "Set courseCode to the official short course identifier when present and courseTitle to the actual course title, never a generic 'Interaktiver Study Guide' label.",
    "Do not claim official exam scoring. Explain gaps such as inaccessible Minitests in scopeNote.",
    state.error_log?.startsWith("Study-guide content builder failed:") ? `Repair these content-bank validation findings:\n${state.error_log}` : "",
    `Language: ${config.language}`,
    `Layout plan for scope only:\n${JSON.stringify(state.layout_spec, null, 2)}`,
    `Required JSON schema:\n${JSON.stringify(studyGuideContentJsonSchema, null, 2)}`,
    `Canonical source corpus:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function validateSourceRegistry(content: StudyGuideContent, sourceText: string): string[] {
  const issues: string[] = [];
  const knownUrls = knownHandoffSourceUrls(sourceText);
  const labels = new Set(content.sources.map((source) => source.label));
  const references = content.topics.flatMap((topic) => [
    ...topic.workedExamples.map((example) => example.source),
    ...topic.exercises.map((exercise) => exercise.source),
  ]);
  for (const source of content.sources) {
    if (source.url && knownUrls.size > 0 && !knownUrls.has(source.url)) {
      issues.push(`Source ${source.id} uses a URL that is not present in the validated Moodle handoff.`);
    }
  }
  if (knownUrls.size > 0 && content.sources.every((source) => !source.url)) {
    issues.push("The validated Moodle handoff contains source URLs, but the study-guide source register dropped all of them.");
  }
  for (const reference of references) {
    if (reference.provenance !== "adapted" && !labels.has(reference.label)) issues.push(`Learning content cites '${reference.label}', but that label is missing from the source register.`);
  }
  return [...new Set(issues)];
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}
