import { writeFile } from "node:fs/promises";
import path from "node:path";
import { layoutSpecJsonSchema, layoutSpecSchema } from "../schemas.js";
import type { JsonObject, LangGraphWebLayoutState } from "../state.js";
import type { WebLayoutRuntimeConfig } from "../types.js";
import type { CodexClient } from "../codexClient.js";
import { adaptiveLearningInteractionGuidance } from "../learningInteractionGuidance.js";
import { studyGuideBlockGuidance } from "../studyGuideBlockContract.js";

export function createPlannerNode(config: WebLayoutRuntimeConfig, codex: CodexClient) {
  return async function plannerNode(state: LangGraphWebLayoutState): Promise<Partial<LangGraphWebLayoutState>> {
    try {
      if (config.kind === "study-guide" && state.source_text.includes("## Full extracted practice corpus")) {
        const parsed = layoutSpecSchema.parse(deterministicStudyGuidePlan(config)) as JsonObject;
        await writeFile(path.join(config.runDir, "layout-spec.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        await config.diagnostics?.log("info", "planner", "Built standardized study-guide layout plan deterministically from the reusable block contract.");
        return { layout_spec: parsed, error_log: null };
      }
      const response = await codex.run(buildPlannerPrompt(config, state), {
        outputSchema: layoutSpecJsonSchema,
        task: "artifact_planner",
        attempt: state.retry_count + 1,
      });
      const parsed = layoutSpecSchema.parse(JSON.parse(stripJsonFence(response))) as JsonObject;
      // A later generator or quality-review failure must not make a validated
      // plan disappear. Resume runs can use this checkpoint without starting
      // another planner model call.
      await writeFile(
        path.join(config.runDir, "layout-spec.json"),
        `${JSON.stringify(parsed, null, 2)}\n`,
        "utf8",
      );
      await config.diagnostics?.log("info", "planner", "Validated layout spec.");
      return {
        layout_spec: parsed,
        error_log: null,
      };
    } catch (error) {
      const message = `Layout planner failed: ${error instanceof Error ? error.message : String(error)}`;
      await config.diagnostics?.log("warn", "planner", message);
      return {
        error_log: message,
        retry_count: state.retry_count + 1,
        planner_retry_count: state.planner_retry_count + 1,
      };
    }
  };
}

function deterministicStudyGuidePlan(config: WebLayoutRuntimeConfig) {
  const titles = ["Folgen und Reihen", "Grenzwerte und Stetigkeit", "Ableitungsregeln", "Taylorpolynome", "Funktionsuntersuchung", "Stammfunktionen", "Bestimmte Integrale und Flächen", "Uneigentliche Integrale", "DGL-Grundlagen", "DGL erster Ordnung", "DGL zweiter Ordnung"];
  return {
    title: "MAES2 – Interaktiver Study Guide",
    language: config.language,
    kind: "study-guide",
    audience: "Studierende in einer quellenbasierten Prüfungsvorbereitung",
    learningGoals: ["Alle belegten Kursthemen anhand konkreter Aufgaben trainieren", "Kreuzerl-Entscheidungen begründen", "Rechenwege schrittweise kontrollieren"],
    sections: titles.map((title, index) => ({ id: `topic-${index + 1}`, title, purpose: "Standardisierter Lernpfad aus Orientierung, Theorie, Beispiel, Übung und Auswertung", interactionType: "Kreuzerl- und Rechentraining" })),
    requiredInteractions: ["Sticky Hotbar ohne Sidebar", "Persistenter Fortschritt", "Quellengebundene Aufgaben und Rückmeldungen"],
    dataModel: {},
    designDirection: "Standardisiertes Study-Buddy-Blocksystem mit Top-Hotbar und horizontaler Themenleiste.",
    accessibilityNotes: ["Tastaturbedienbare Controls", "Semantische Formulare und MathML", "Kein horizontaler Dokumentüberlauf"],
  };
}

export function buildPlannerPrompt(config: WebLayoutRuntimeConfig, state: Pick<LangGraphWebLayoutState, "source_text" | "error_log">): string {
  return [
    "Create a JSON-only implementation plan for a Study Buddy offline interactive HTML learning tool.",
    `Requested kind: ${config.kind}`,
    `Language: ${config.language}`,
    "Keep scope proportional to the request. Choose one primary learning interaction and only add supporting interactions that directly serve it.",
    adaptiveLearningInteractionGuidance(),
    config.kind === "study-guide" ? studyGuideBlockGuidance() : "",
    "Do not invent authoring systems, editable content builders, imports, exports, source search/filter interfaces, or modal source browsers unless the user explicitly requested them.",
    config.sourceMode === "prompt"
      ? "Only the user prompt is available. Plan a clearly labelled demo without course-specific factual claims, citations, or source-management UI."
      : "Plan source-aware citations only for sources actually present in the supplied handoff or files.",
    "Return exactly this schema with no Markdown fences and no prose:",
    JSON.stringify(layoutSpecJsonSchema, null, 2),
    state.error_log ? `Previous error to repair:\n${state.error_log}` : "",
    `Source text:\n${state.source_text}`,
  ].filter(Boolean).join("\n\n");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}
