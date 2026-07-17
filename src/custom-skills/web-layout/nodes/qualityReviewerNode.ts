import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexClient } from "../codexClient.js";
import type { LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";

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
      const response = await codex.run(buildPrompt(config, state), {
        task: "quality_reviewer",
        attempt: state.retry_count + 1,
        outputSchema: qualityReviewSchema,
      });
      const review = parseReview(response);
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
      return { error_log: message, retry_count: state.retry_count + 1 };
    } catch (error) {
      return {
        error_log: `Quality reviewer failed: ${error instanceof Error ? error.message : String(error)}`,
        retry_count: state.retry_count + 1,
      };
    }
  };
}

function buildPrompt(config: WebLayoutRuntimeConfig, state: LangGraphWebLayoutState): string {
  return [
    "Review this offline interactive Study Buddy page for source fidelity, mathematical correctness, pedagogy, usability, and appropriate interaction design.",
    "Do not rewrite it. Return JSON only. Mark ok=false only for concrete issues the HTML generator must repair.",
    `Requested kind: ${config.kind}`,
    `User request:\n${config.prompt}`,
    `Browser and static validation:\n${JSON.stringify(state.validation_report)}`,
    `Source:\n${state.source_text.slice(0, 60_000)}`,
    `HTML:\n${state.html_document.slice(0, 90_000)}`,
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
