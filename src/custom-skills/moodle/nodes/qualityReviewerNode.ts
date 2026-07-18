import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray } from "../validation.js";

const qualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "summary", "findings"],
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
    },
  },
} as const;

export function createQualityReviewerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function qualityReviewerNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    try {
      const response = await codex.run(buildQualityReviewPrompt(config, state), {
        outputSchema: qualityReviewSchema,
        task: "quality_reviewer",
        attempt: state.retry_count + 1,
      });
      const parsed = validateQualityReview(parseJsonObjectOrArray(response));
      await writeFile(
        path.join(config.runDir, "quality-review.json"),
        `${JSON.stringify(parsed, null, 2)}\n`,
        "utf8",
      );
      if (parsed.ok) {
        await config.diagnostics?.log("info", "analyzer", "Semantic quality review passed.");
        return { error_log: null };
      }
      const message = `Semantic quality review failed:\n- ${parsed.findings.join("\n- ")}`;
      await config.diagnostics?.log("warn", "analyzer", message);
      return { error_log: message, retry_count: state.retry_count + 1 };
    } catch (error) {
      return {
        error_log: `Quality reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

function buildQualityReviewPrompt(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
): string {
  const artifact = state.final_document.trim()
    ? `Generated artifact:\n${state.final_document.slice(0, 90_000)}`
    : `Structured study model:\n${JSON.stringify(state.study_model).slice(0, 90_000)}`;
  return [
    "Review this Study Buddy artifact for factual grounding, mathematical consistency, pedagogical usefulness, and alignment with the requested output.",
    "Do not rewrite the artifact. Return JSON only. Mark ok=false only for concrete issues that require a new analysis or build attempt.",
    "Review only the supplied artifact and deterministic review. Do not claim that omitted source material contains facts, formulas, or examples that are not present in this review input.",
    "Formula strings in structured study data use Typst math syntax, not TeX. Typst functions such as frac and dot intentionally have no leading backslash; do not flag that syntax as malformed TeX.",
    "Worked examples with origin='derived' are explicitly didactic examples. They are allowed when their method and result are reproducible from the cited source-backed rules or formulas; do not reject them merely because their numeric values were newly chosen.",
    "The study_guide profile intentionally keeps practiceItems empty; its application layer is workedExamples embedded in each chapter. Do not report an empty detached practice bank as a defect when chapter examples are complete.",
    "For a study guide, reject chapter-sized content that functions only as a short overview. A learner needs explanations, conditions, methods, and worked application—not just one paragraph and a few bullets.",
    "A publicationStatus or chapter status of 'partial' is not by itself a blocking defect. A guide may publish with a clearly named, narrowly scoped source gap when the supplied evidence does not support that subtopic. Never demand invented material merely to turn partial coverage into complete coverage.",
    "Judge each chapter by whether it contains at least one complete representative application. Do not require one example to cover every formula, strength proof, or calculation method in the chapter.",
    "An example is blocking only when it presents itself as reproducible but omits necessary givens, substitutions, units, or reasoning, or when its result contradicts its shown method. A clearly scoped limitation is acceptable.",
    "When the supplied evidence or deterministic review identifies a mandatory table/diagram lookup, reject an example that merely copies the looked-up values from a solution. The learner must see the lookup asset and the row/column or interval-selection method before subsequent calculations.",
    "A missing optional formula, subtopic, or additional worked example is not a defect unless the user explicitly required it and the supplied artifact itself demonstrates that suitable source-backed material was available.",
    "Set ok=false only for a concrete factual contradiction, mathematical inconsistency, unusably shallow covered chapter, missing representative chapter example, invalid citation, or an example that cannot be followed from its stated givens. Put non-blocking coverage observations in summary, not findings.",
    `User request:\n${config.prompt}`,
    `Deterministic review:\n${JSON.stringify(state.review_report)}`,
    artifact,
  ].join("\n\n");
}

function validateQualityReview(value: unknown): {
  ok: boolean;
  summary: string;
  findings: string[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Quality reviewer returned a non-object response.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.summary !== "string") {
    throw new Error("Quality reviewer response is missing ok or summary.");
  }
  if (!Array.isArray(record.findings) || !record.findings.every((item) => typeof item === "string")) {
    throw new Error("Quality reviewer findings must be a string array.");
  }
  return {
    ok: record.ok,
    summary: record.summary,
    findings: record.findings.slice(0, 12),
  };
}
