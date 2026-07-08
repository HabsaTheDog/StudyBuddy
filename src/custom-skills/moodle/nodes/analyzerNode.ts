import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import { extractedDataJsonSchema } from "../schemas.js";
import type { LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";
import { readVisualManifest } from "../visualAssets.js";
import {
  STUDENT_FIRST_POLICY,
  STUDENT_FIRST_POLICY_VERSION,
} from "../studentFirstPolicy.js";

export function createAnalyzerNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function analyzerNode(state: LangGraphAgentState): Promise<Partial<LangGraphAgentState>> {
    try {
      const response = await codex.run(await buildAnalyzerPrompt(config, state), {
        outputSchema: extractedDataJsonSchema,
      });
      const parsed = parseJsonObjectOrArray(response);
      const validated = validateExtractedData(parsed);
      await mkdir(path.join(config.runDir, "extraction"), { recursive: true });
      await writeFile(
        path.join(config.runDir, "extracted-data.json"),
        `${JSON.stringify(validated, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        path.join(config.runDir, "extraction", "extracted-data.json"),
        `${JSON.stringify(validated, null, 2)}\n`,
        "utf8",
      );
      await config.diagnostics?.log("info", "analyzer", "Validated and persisted extracted study data.");
      return {
        extracted_data: validated,
        error_log: null,
      };
    } catch (error) {
      return {
        error_log: `Analyzer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

async function buildAnalyzerPrompt(config: MoodleRuntimeConfig, state: LangGraphAgentState): Promise<string> {
  const visualManifest = await readVisualManifest(config.runDir);
  const evidenceView = compactEvidenceForAnalyzer(
    state.evidence_package,
    config.prompt,
    125_000,
  );
  const analyzerManifest = {
    schemaVersion: state.resource_manifest.schemaVersion,
    courseUrl: state.resource_manifest.courseUrl,
    resources: state.resource_manifest.resources.map((resource) => ({
      id: resource.id,
      sectionPath: resource.sectionPath,
      activityType: resource.activityType,
      title: resource.title,
      originUrl: resource.originUrl,
      status: resource.status,
    })),
  };
  const analyzerVisuals = visualManifest
    ? {
        tooling: visualManifest.tooling,
        warnings: visualManifest.warnings,
        candidates: visualManifest.candidates.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          relative_path: candidate.relative_path,
          mime_type: candidate.mime_type,
          width_px: candidate.width_px,
          height_px: candidate.height_px,
          source_id: candidate.source_id,
          source_url: candidate.source_url,
          source_path: candidate.source_path,
          source_page: candidate.source_page,
          confidence: candidate.confidence,
          caption_hint: candidate.caption_hint,
        })),
      }
    : null;
  const sourceOverview = state.evidence_package.records.length > 0
    ? state.moodle_raw_text.slice(0, 24_000)
    : state.moodle_raw_text;
  const figureLimit = analyzerVisuals
    ? analyzerVisuals.candidates.length
    : config.maxVisualAssets > 0
      ? config.maxVisualAssets
      : 0;
  return [
    "Extract structured study data from selected calendar events and relevant Moodle/CIS text for a mechatronics/engineering student.",
    `Student-first policy v${STUDENT_FIRST_POLICY_VERSION}: ${STUDENT_FIRST_POLICY}`,
    `Artifact profile: ${config.artifactIntent.profile}.`,
    "Return only JSON matching the requested schema. Do not include Markdown fences.",
    "Preserve German source language unless the user asks otherwise.",
    "Represent formulas in Typst math syntax where possible.",
    "Never invent source citations.",
    "Treat calendar_event as the primary source for dates, times, exams, and rooms.",
    "Treat CIS as the fallback for missing calendar facts and as the source for attendance or administrative LV information.",
    "The calendar input is already filtered; do not infer events that are not present.",
    "Visual policy:",
    figureLimit > 0
      ? `- Select at most ${figureLimit} figures from the available visual candidates. This is a candidate ceiling, not a target.`
      : "- No visual candidate ceiling is available; still create figures only when supported by the sources or by an approved didactic diagram/prompt.",
    "- Default to using visuals in learning artifacts. Images usually improve comprehension and orientation; choose zero figures only when no useful source image, title/cover image, logo/context image, diagram, table, sketch, or didactic visualization is available or appropriate.",
    "- Prefer Moodle/CIS visual candidates over generated or placeholder visuals.",
    "- Prefer directly extracted moodle_pdf_image candidates over full moodle_pdf_page screenshots when both explain the same content.",
    "- Treat moodle_pdf_page screenshots as fallback only. Do not use a full exercise, full solution, or text-heavy page as a figure when the text can be rewritten as a worked example.",
    "- Do not select mostly blank slide/background/logo candidates, cover/title crops, or screenshots whose meaningful content would be unreadable when placed as a figure.",
    "- When a source page contains a whole example, extract the problem statement, givens, method, and result into worked_examples instead of embedding the whole page image.",
    "- For multi-chapter engineering guides, distribute figures across the covered Moodle chapters. Select at least one suitable source figure for each covered chapter when candidates exist; never spend the visual budget on the first chapter alone.",
    "- Use two to three figures in a chapter when separate diagrams, tables, worked-example sketches, or formula reference tables materially improve learning.",
    "- A figure must be assigned to the chapter supported by its source_id/source_url and placement_hint.",
    "- Include visuals when they materially help the topic, especially circuits, measurement setups, block diagrams, lab workflows, plots, formula tables, tolerance tables, example sketches, and engineering mechanisms.",
    "- For text-heavy topics, use a relevant title image, source cover crop, organization/company logo already present in source material, process overview, or simple didactic diagram when it improves readability and memory.",
    "- If a worked example is based on a source table, sketch, diagram, plot, or page crop, include that source visual as a figure with the same source_ids and chapter placement so the renderer can place it next to the example.",
    "- Avoid random decorative visuals. Aesthetic/title visuals are allowed when they are source-related or clearly support orientation, not when they mislead about course content.",
    "- If no Moodle/CIS image is suitable but a simple technical visualization helps, create a typst_diagram visual asset with no relative_path and describe the intended approved component in caption_hint.",
    "- If neither source image nor approved Typst diagram fits, create a placeholder_prompt visual asset with a concrete generation_prompt.",
    "- Generated or placeholder visuals are didactic visualizations, not original Moodle/CIS sources.",
    "Use the source coverage JSON as a hard boundary: failed or empty sources can only support warnings, not factual claims.",
    "Use the evidence package as the factual input. Resource titles alone prove that a resource exists, not its subject content.",
    "Course structure policy:",
    "- Treat resource_manifest.sectionPath as the authoritative Moodle chapter structure.",
    "- Emit subject sections in the same order and with the same subject boundaries as the Moodle course; do not reorganize them into generic theory/formula/example buckets.",
    "- Keep formulas, figures, tables, and worked examples source-linked to the subject section where they are taught.",
    "- If a Moodle chapter is discovered but lacks usable evidence, do not invent content; preserve the gap through warnings so the renderer can show it as open.",
    config.artifactIntent.profile === "study_guide" || config.artifactIntent.profile === "exam_navigator"
      ? "Set quiz_style_questions to an empty array. These profiles use one learning checklist and no practice bank."
      : "Practice questions must test subject knowledge, have a concrete learning purpose, and cite subject evidence. Never ask about alias, date, time, room, teacher, or source-page metadata.",
    "Do not invent common mistakes, formulas, definitions, worked examples, or diagram relationships.",
    state.error_log ? `Previous validation error to repair:\n${state.error_log}` : "",
    `User request:\n${config.prompt}`,
    `Source coverage JSON:\n${JSON.stringify(config.diagnostics?.getCoverage() ?? {}, null, 2)}`,
    analyzerVisuals ? `Visual candidates JSON:\n${JSON.stringify(analyzerVisuals, null, 2)}` : "Visual candidates JSON: none",
    `Resource manifest JSON:\n${JSON.stringify(analyzerManifest, null, 2)}`,
    `Evidence package selection JSON:\n${JSON.stringify(evidenceView, null, 2)}`,
    `Moodle/CIS source overview:\n${sourceOverview}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function compactEvidenceForAnalyzer(
  evidence: LangGraphAgentState["evidence_package"],
  prompt: string,
  maxCharacters: number,
): LangGraphAgentState["evidence_package"] {
  const promptTokens = new Set(
    prompt.toLowerCase().match(/[a-z0-9äöüß]{4,}/gi) ?? [],
  );
  const records = [...evidence.records]
    .map((record, index) => ({
      record,
      index,
      score:
        (record.kind === "exercise" || record.kind === "solution" ? 100 : 0) +
        [...promptTokens].filter((token) =>
          `${record.locator.section ?? ""} ${record.content}`.toLowerCase().includes(token)
        ).length * 10,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [];
  const representedResources = new Set<string>();
  let characters = 0;
  for (const candidate of records) {
    const serializedLength = JSON.stringify(candidate.record).length;
    const firstForResource = !representedResources.has(candidate.record.resourceId);
    if (!firstForResource && characters + serializedLength > maxCharacters) continue;
    if (characters + serializedLength > maxCharacters && selected.length > 0) continue;
    selected.push(candidate.record);
    representedResources.add(candidate.record.resourceId);
    characters += serializedLength;
  }
  return {
    ...evidence,
    records: selected,
    warnings: [
      ...evidence.warnings,
      ...(selected.length < evidence.records.length
        ? [`Analyzer context selected ${selected.length} of ${evidence.records.length} evidence records; the complete package remains persisted.`]
        : []),
    ],
  };
}
