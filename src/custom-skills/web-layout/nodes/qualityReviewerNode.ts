import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import { adaptiveQualityCriteria } from "../learningInteractionGuidance.js";
import { balancedExcerpt, compactHtmlForModel } from "../modelText.js";
import { studyGuideBlockQualityCriteria } from "../studyGuideBlockContract.js";

const qualityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "summary", "findings"],
  properties: {
    ok: { type: "boolean" },
    summary: { type: "string" },
    findings: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
} as const;

export function createQualityReviewerNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function qualityReviewerNode(
    state: LangGraphWebLayoutState,
  ): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      const bundledHtml = await readFile(
        path.join(config.runDir, ".build", "document.html"),
        "utf8",
      ).catch(() => state.html_document);
      if (config.kind === "study-guide" && /name="study-buddy-renderer"\s+content="standard-study-guide-v1"/i.test(bundledHtml)) {
        const findings = deterministicStandardGuideFindings(state, bundledHtml);
        const review = { ok: findings.length === 0, summary: findings.length === 0 ? "Standardisierter Study Guide erfüllt die deterministischen Qualitätskriterien." : "Standardisierter Study Guide benötigt Reparaturen.", findings };
        await writeFile(path.join(config.runDir, "quality-review.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
        if (review.ok) {
          await config.diagnostics?.log("info", "validator", "Deterministic semantic quality review passed for standard study-guide renderer.");
          return { error_log: null };
        }
        const message = `Semantic quality review failed:\n- ${findings.join("\n- ")}`;
        return { error_log: message, retry_count: state.retry_count + 1, quality_retry_count: state.quality_retry_count + 1 };
      }
      const response = await codex.run(buildPrompt(config, state, bundledHtml), {
        task: "quality_reviewer",
        attempt: state.retry_count + 1,
        outputSchema: qualityReviewSchema,
      });
      const review = removeOrchestrationFindings(parseReview(response));
      await writeFile(
        path.join(config.runDir, "quality-review.json"),
        `${JSON.stringify(review, null, 2)}\n`,
        "utf8",
      );
      if (review.ok) {
        await config.diagnostics?.log("info", "validator", "Semantic quality review passed.");
        return { error_log: null };
      }
      const message = `Semantic quality review failed:\n- ${review.findings.join("\n- ")}`;
      await config.diagnostics?.log("warn", "validator", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        quality_retry_count: state.quality_retry_count + 1,
      };
    } catch (error) {
      return {
        error_log: `Quality reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
        quality_retry_count: state.quality_retry_count + 1,
      };
    }
  };
}

function deterministicStandardGuideFindings(state: LangGraphWebLayoutState, html: string): string[] {
  const findings: string[] = [];
  const topics = Array.isArray(state.study_guide_content.topics) ? state.study_guide_content.topics : [];
  const exercises = topics.flatMap((topic) => topic && !Array.isArray(topic) && typeof topic === "object" && Array.isArray(topic.exercises) ? topic.exercises : []);
  if (topics.length < 11) findings.push(`Nur ${topics.length} statt mindestens 11 Themen gerendert.`);
  if (exercises.length < 50) findings.push(`Nur ${exercises.length} statt mindestens 50 Aufgaben gerendert.`);
  if (!/data-sb-hotbar/i.test(html) || /class="[^"]*(?:sidebar|side-nav|navigation-rail)/i.test(html)) findings.push("Hotbar-/Sidebar-Vertrag verletzt.");
  if (!/data-sb-course-tabs/i.test(html) || !/role="tab"/i.test(html) || !/role="tabpanel"/i.test(html)) findings.push("Standardisierte Kapitel-Tabs mit Tab-Semantik fehlen.");
  if (!/localStorage/i.test(html) || !/drafts/i.test(html) || !/completed/i.test(html)) findings.push("Persistenz von Entwürfen und Fortschritt fehlt.");
  if (!/<math\b/i.test(html) || !/<(?:msup|msub|mi|mn|mo)\b/i.test(html)) findings.push("Strukturiertes MathML fehlt.");
  if (!/data-sb-cross-exercise/i.test(html) || !/data-sb-calculation-exercise/i.test(html)) findings.push("Kreuzerl- oder Rechenblock fehlt.");
  if (!/data-sb-sources/i.test(html)) findings.push("Quellenregister fehlt.");
  return findings;
}

function buildPrompt(
  config: WebLayoutRuntimeConfig,
  state: LangGraphWebLayoutState,
  bundledHtml: string,
): string {
  return [
    "Review this offline interactive Study Buddy page for source fidelity, mathematical correctness, pedagogy, usability, and appropriate interaction design.",
    "Do not rewrite it. Return JSON only. Mark ok=false only for concrete issues the HTML generator must repair.",
    "The workflow is necessarily still marked running while this review executes. Do not inspect or reject run-summary.md, error.log presence, lock files, or terminal status; the graph writes terminal artifacts only after your approval. Review the bundled HTML and supplied validation evidence instead.",
    "Do not reject a clearly labelled unsourced demo merely because course materials were not supplied. Reject only unsupported claims that present themselves as real course facts.",
    adaptiveQualityCriteria(),
    config.kind === "study-guide" ? studyGuideBlockQualityCriteria() : "",
    `Requested kind: ${config.kind}`,
    `User request:\n${config.prompt}`,
    `Browser and static validation:\n${JSON.stringify(state.validation_report)}`,
    config.kind === "study-guide"
      ? `Canonical validated content bank the HTML must faithfully render:\n${balancedExcerpt(JSON.stringify(state.study_guide_content ?? {}), 120_000)}`
      : `Source:\n${balancedExcerpt(state.source_text, 100_000)}`,
    "HTML below is the validated, bundled delivery artifact. Local asset references in the editable generator source are irrelevant if this artifact contains the corresponding data URI.",
    `HTML:\n${compactHtmlForModel(bundledHtml)}`,
  ].join("\n\n");
}

function parseReview(value: string): { ok: boolean; summary: string; findings: string[] } {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (typeof parsed.ok !== "boolean" || typeof parsed.summary !== "string") {
    throw new Error("Quality reviewer response is missing ok or summary.");
  }
  if (!Array.isArray(parsed.findings) || !parsed.findings.every((item) => typeof item === "string")) {
    throw new Error("Quality reviewer findings must be a string array.");
  }
  return {
    ok: parsed.ok,
    summary: parsed.summary,
    findings: parsed.findings.slice(0, 12) as string[],
  };
}

function removeOrchestrationFindings(
  review: { ok: boolean; summary: string; findings: string[] },
): { ok: boolean; summary: string; findings: string[] } {
  const orchestrationOnly = /(run-summary\.md|error\.log|lock files?|terminal(?:er|en|status)?|run status|laufstatus|artefakt-run|abschlussartefakt)/i;
  const findings = review.findings.filter((finding) => !orchestrationOnly.test(finding));
  if (findings.length === review.findings.length) return review;
  return {
    ok: findings.length === 0,
    summary: findings.length === 0
      ? "Keine reparaturpflichtigen HTML-Fehler; reine Orchestrierungsbefunde werden separat geprüft."
      : review.summary,
    findings,
  };
}
