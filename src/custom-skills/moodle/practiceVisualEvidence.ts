import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodexClient } from "./codexClient.js";
import type { LangGraphAgentState } from "./state.js";
import type { MoodleRuntimeConfig } from "./types.js";
import { runBoundedProcess } from "../shared/boundedProcess.js";

export const PRACTICE_VISUAL_EVIDENCE_FILE = "practice-visual-evidence.json";
const PRACTICE_VISUAL_EVIDENCE_VERSION = "practice-visual-evidence-v1";
const IMAGE_PAGES_PER_CALL = 4;

export const practiceVisualExampleSchema = z.object({
  pages: z.array(z.number().int().positive()).min(1),
  evidenceStatus: z.enum(["complete_task", "method_only", "unusable"]),
  learningGoal: z.string(),
  taskPrompt: z.string(),
  givens: z.array(z.string()),
  targets: z.array(z.string()),
  solutionSteps: z.array(z.string()),
  result: z.string(),
  diagramDescription: z.string(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
}).superRefine((example, context) => {
  if (example.evidenceStatus === "complete_task" && (!example.taskPrompt.trim() || example.targets.length === 0)) {
    context.addIssue({
      code: "custom",
      message: "A complete visual task needs a self-contained visible prompt and at least one target.",
    });
  }
  if (example.evidenceStatus === "method_only" && !example.learningGoal.trim()) {
    context.addIssue({
      code: "custom",
      message: "Method-only visual evidence needs an explicit evidenced learning goal.",
    });
  }
});

export const practiceVisualResourceSchema = z.object({
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  sourceRole: z.enum(["worked_example", "sample_exam"]),
  sourcePath: z.string().min(1),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  pageCount: z.number().int().positive(),
  examples: z.array(practiceVisualExampleSchema),
  warnings: z.array(z.string()),
});

export const practiceVisualEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  resources: z.array(practiceVisualResourceSchema),
});

export type PracticeVisualExample = z.infer<typeof practiceVisualExampleSchema>;
export type PracticeVisualResource = z.infer<typeof practiceVisualResourceSchema>;
export type PracticeVisualEvidence = z.infer<typeof practiceVisualEvidenceSchema>;

const modelResponseSchema = z.object({
  examples: z.array(practiceVisualExampleSchema),
  warnings: z.array(z.string()),
});

const modelResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["examples", "warnings"],
  properties: {
    examples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "pages",
          "evidenceStatus",
          "learningGoal",
          "taskPrompt",
          "givens",
          "targets",
          "solutionSteps",
          "result",
          "diagramDescription",
          "confidence",
          "warnings",
        ],
        properties: {
          pages: { type: "array", items: { type: "integer" } },
          evidenceStatus: { type: "string", enum: ["complete_task", "method_only", "unusable"] },
          learningGoal: { type: "string" },
          taskPrompt: { type: "string" },
          givens: { type: "array", items: { type: "string" } },
          targets: { type: "array", items: { type: "string" } },
          solutionSteps: { type: "array", items: { type: "string" } },
          result: { type: "string" },
          diagramDescription: { type: "string" },
          confidence: { type: "number" },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export function createPracticeVisualEvidenceNode(config: MoodleRuntimeConfig, codex: CodexClient) {
  return async function practiceVisualEvidenceNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const candidates = state.resource_manifest.resources.filter((resource) =>
      resource.selection?.selected === true &&
      (resource.selection.role === "worked_example" || resource.selection.role === "sample_exam") &&
      Boolean(resource.localPath?.toLocaleLowerCase("en").endsWith(".pdf")) &&
      (resource.extraction?.status === "partial" || resource.extraction?.status === "unusable")
    );
    const resources = await mapWithConcurrency(candidates, 3, async (resource) => {
      try {
        return await analyzePracticeResource(config, codex, resource);
      } catch (error) {
        const sourceRole = resource.selection!.role as "worked_example" | "sample_exam";
        const warning = error instanceof Error ? error.message : String(error);
        return practiceVisualResourceSchema.parse({
          sourceId: resource.id,
          sourceTitle: resource.title,
          sourceRole,
          sourcePath: resource.localPath!,
          sourceHash: createHash("sha256").update(`${resource.id}\u0000${resource.localPath}`).digest("hex"),
          pageCount: Math.max(1, resource.extraction?.pageCount ?? 1),
          examples: [],
          warnings: [`Visual practice evidence remained unavailable without blocking the remaining course: ${warning}`],
        });
      }
    });
    const evidence = practiceVisualEvidenceSchema.parse({ schemaVersion: 1, resources });
    await writeFile(
      path.join(config.runDir, PRACTICE_VISUAL_EVIDENCE_FILE),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    await config.diagnostics?.log(
      "info",
      "analyzer",
      candidates.length === 0
        ? "No selected visual-required practice source needed image evidence extraction."
        : `Extracted bounded visual practice evidence from ${resources.length} selected source(s): ${resources.flatMap((resource) => resource.examples).filter((example) => example.evidenceStatus !== "unusable").length} usable evidence object(s).`,
    );
    return { error_log: null };
  };
}

export async function readPracticeVisualEvidence(runDir: string): Promise<PracticeVisualEvidence> {
  const text = await readFile(path.join(runDir, PRACTICE_VISUAL_EVIDENCE_FILE), "utf8").catch(() => "");
  return text
    ? practiceVisualEvidenceSchema.parse(JSON.parse(text))
    : { schemaVersion: 1, resources: [] };
}

async function analyzePracticeResource(
  config: MoodleRuntimeConfig,
  codex: CodexClient,
  resource: LangGraphAgentState["resource_manifest"]["resources"][number],
): Promise<PracticeVisualResource> {
  const sourcePath = resource.localPath!;
  const sourceHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
  const pageCount = resource.extraction?.pageCount || await pdfPageCount(sourcePath);
  const sourceRole = resource.selection!.role as "worked_example" | "sample_exam";
  const cachePath = path.join(
    process.cwd(),
    "study-buddy-data",
    "cache",
    "moodle",
    "practice-visual-evidence",
    `${createHash("sha256").update(JSON.stringify({ version: PRACTICE_VISUAL_EVIDENCE_VERSION, sourceHash, language: config.outputLanguage })).digest("hex")}.json`,
  );
  const cached = await readFile(cachePath, "utf8").catch(() => "");
  if (cached) {
    const parsed = practiceVisualResourceSchema.safeParse(JSON.parse(cached));
    if (parsed.success && parsed.data.sourceHash === sourceHash) {
      return { ...parsed.data, sourceId: resource.id, sourceTitle: resource.title, sourceRole, sourcePath };
    }
  }

  const pageDir = path.join(config.runDir, "practice-evidence-pages", resource.id);
  await mkdir(pageDir, { recursive: true });
  const pageImages = await renderPdfPages(sourcePath, pageDir, pageCount);
  const examples: PracticeVisualExample[] = [];
  const warnings: string[] = [];
  for (let start = 0; start < pageImages.length; start += IMAGE_PAGES_PER_CALL) {
    const batch = pageImages.slice(start, start + IMAGE_PAGES_PER_CALL);
    let parsed: z.infer<typeof modelResponseSchema> | null = null;
    let priorError = "";
    for (let attempt = 1; attempt <= 2 && !parsed; attempt += 1) {
      try {
        const response = await codex.run(
          buildPracticeVisualPrompt(config, resource.title, batch.map((entry) => entry.page), priorError),
          {
            task: attempt === 1 ? "content_analyzer" : "content_repair",
            attempt,
            outputSchema: modelResponseJsonSchema,
            localImages: batch.map((entry) => entry.path),
          },
        );
        const candidate = modelResponseSchema.parse(JSON.parse(stripJsonFence(response)));
        const availablePages = new Set(batch.map((entry) => entry.page));
        if (candidate.examples.some((example) => example.pages.some((page) => !availablePages.has(page)))) {
          throw new Error("Visual evidence response cited a page outside the attached batch.");
        }
        parsed = candidate;
      } catch (error) {
        priorError = error instanceof Error ? error.message : String(error);
      }
    }
    if (parsed) {
      examples.push(...parsed.examples);
      warnings.push(...parsed.warnings);
    } else {
      warnings.push(`Pages ${batch.map((entry) => entry.page).join(", ")} could not be converted into validated visual evidence: ${priorError}`);
    }
  }
  const result = practiceVisualResourceSchema.parse({
    sourceId: resource.id,
    sourceTitle: resource.title,
    sourceRole,
    sourcePath,
    sourceHash,
    pageCount,
    examples,
    warnings: [...new Set(warnings)],
  });
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

function buildPracticeVisualPrompt(
  config: MoodleRuntimeConfig,
  sourceTitle: string,
  pages: number[],
  priorError: string,
): string {
  return [
    "PRACTICE_VISUAL_EVIDENCE_EXTRACTOR",
    "Return JSON only. The attached images are authorized pages from one selected course worked-example or sample-assessment PDF. Each image corresponds to the page number at the same array index.",
    "Extract only what is visibly supported. This is source evidence extraction, not question generation and not a request to improve or complete the source.",
    "Use evidenceStatus=complete_task only when the visible pages contain a self-contained learner task: situation, all indispensable givens or diagram labels, and at least one explicit target. Transcribe it faithfully into taskPrompt, givens, and targets.",
    "Use evidenceStatus=method_only when a diagram, derivation, worked solution, or result reveals a useful method but the complete original task statement is absent. Describe the evidenced learningGoal, equations/steps, diagram, and visible result, but leave taskPrompt empty and explicitly warn that a new item must be labelled as a course-derived variant rather than a course original.",
    "Use evidenceStatus=unusable when the page is only a title/decorative page or is not legible enough to ground either a complete task or a method. Do not guess missing values, geometry, assumptions, targets, equations, or results.",
    "Preserve symbols, units, directions, constraints, and page-local distinctions. A title page and a handwritten solution do not together prove an unseen original prompt.",
    `Output language: ${config.outputLanguage}`,
    `Source title: ${sourceTitle}`,
    `Image/page mapping: ${JSON.stringify(pages.map((page, imageIndex) => ({ imageIndex, page })))}`,
    priorError ? `Repair the prior structured-output failure without changing evidence semantics:\n${priorError}` : "",
  ].filter(Boolean).join("\n\n");
}

async function renderPdfPages(
  sourcePath: string,
  pageDir: string,
  pageCount: number,
): Promise<Array<{ page: number; path: string }>> {
  const result: Array<{ page: number; path: string }> = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const prefix = path.join(pageDir, `page-${page}`);
    const rendered = await runBoundedProcess("pdftoppm", [
      "-png",
      "-singlefile",
      "-f",
      String(page),
      "-l",
      String(page),
      "-r",
      "144",
      sourcePath,
      prefix,
    ]);
    if (rendered.code !== 0) {
      throw new Error(rendered.stderr || rendered.stdout || `pdftoppm exited with ${rendered.code}`);
    }
    result.push({ page, path: `${prefix}.png` });
  }
  return result;
}

async function pdfPageCount(sourcePath: string): Promise<number> {
  const result = await runBoundedProcess("pdfinfo", [sourcePath]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || "pdfinfo failed");
  const pages = Number(/^Pages:\s*(\d+)/im.exec(result.stdout)?.[1] ?? 0);
  if (!Number.isInteger(pages) || pages < 1) throw new Error(`Could not determine PDF page count for ${sourcePath}.`);
  return pages;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await work(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}
