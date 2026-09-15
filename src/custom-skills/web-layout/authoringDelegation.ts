import { appendFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { checkpointOperation, operationPolicyFingerprint, semanticHash } from "../shared/operationCheckpoint.js";
import type { CodexClient } from "./codexClient.js";
import { studyGuideContentJsonSchema, studyGuideContentSchema, type StudyGuideContent } from "./studyGuideContent.js";
import type { WebLayoutRuntimeConfig } from "./types.js";

export type AuthoringChapter = { index: number; chunk: { title: string; evidence: string } };
const decisionSchema = z.object({
  mode: z.enum(["author", "delegate"]), content: studyGuideContentSchema.nullable(),
  groups: z.array(z.object({ chapters: z.array(z.number().int().positive()).min(1), reason: z.string().min(1).max(600) }).strict()),
}).strict();
const responseSchema = {
  type: "object", additionalProperties: false, required: ["mode", "content", "groups"],
  properties: {
    mode: { type: "string", enum: ["author", "delegate"] },
    content: { anyOf: [studyGuideContentJsonSchema, { type: "null" }] },
    groups: { type: "array", items: { type: "object", additionalProperties: false, required: ["chapters", "reason"], properties: {
      chapters: { type: "array", items: { type: "integer", minimum: 1 } }, reason: { type: "string" },
    } } },
  },
};

export function validateDelegation(groups: Array<{ chapters: number[]; reason: string }>, count: number): void {
  const ids = groups.flatMap(group => group.chapters);
  if (groups.length < 2 || groups.length > count || ids.length !== count || new Set(ids).size !== count || ids.some(id => id < 1 || id > count)) {
    throw new Error("Delegation must partition every supplied chapter exactly once into at least two nonempty groups.");
  }
}

/** Fits actual producer prompts, not subject labels or course-size quotas. */
export function boundAuthoringBatches<T>(chapters: T[], prompt: (group: T[]) => string, maxCharacters = 40_000): T[][] {
  const batches: T[][] = [];
  for (const chapter of chapters) {
    const last = batches.at(-1);
    if (last && prompt([...last, chapter]).length <= maxCharacters) last.push(chapter);
    else batches.push([chapter]);
  }
  return batches;
}

/** The application delegates at depth one. Returned plans cannot acquire
 * sources, run tools, alter permissions, skip chapters, or publish artifacts. */
export async function authorOrDelegate(input: {
  config: WebLayoutRuntimeConfig; codex: CodexClient; chapters: AuthoringChapter[];
  contractHash: string; buildPrompt: (chapters: AuthoringChapter[]) => string;
  validate: (value: unknown, chapters: AuthoringChapter[]) => StudyGuideContent;
}): Promise<StudyGuideContent> {
  const policy = semanticHash([operationPolicyFingerprint(input.config, "learning_content"), operationPolicyFingerprint(input.config, "learning_content_repair")]);
  const binding = { version: 1, contractHash: input.contractHash, chapters: input.chapters };
  const groupKey = semanticHash(input.chapters.map(chapter => chapter.index)).slice(0, 16);
  const base = { runDir: input.config.runDir, resumeRunDir: input.config.resumeRunDir, signal: input.config.abortSignal, binding, policy };
  const decision = await checkpointOperation<z.infer<typeof decisionSchema>>({
    ...base, key: `authoring-plan:${groupKey}`,
    validate: value => {
      // Old mock/provider responses remain usable only after the full content
      // validation; this does not admit partially populated envelopes.
      if (value && typeof value === "object" && !("mode" in value)) return { mode: "author" as const, content: input.validate(value, input.chapters), groups: [] };
      const parsed = decisionSchema.parse(value);
      if (parsed.mode === "author") {
        if (parsed.groups.length || !parsed.content) throw new Error("Author mode requires content and zero delegates.");
        parsed.content = input.validate(parsed.content, input.chapters);
      } else {
        if (parsed.content !== null) throw new Error("Delegate mode may not also provide content.");
        validateDelegation(parsed.groups, input.chapters.length);
      }
      return parsed;
    },
    run: async (attempt, failure) => {
      const prompt = [
        "BOUNDED_AUTHOR_OR_DELEGATE",
        "You own this evidence-bounded authoring unit. Write all supplied chapters directly when manageable (mode=author, content=complete content, groups=[]). Otherwise choose independent delegate groups (mode=delegate, content=null). Delegate only for real context isolation or parallel authoring, not one call per operation name.",
        "Delegation is depth one and cannot acquire evidence, change scope, change permissions or publish. Each one-based chapter number from the supplied ordered batch must occur exactly once. Groups may combine related chapters but must preserve each chapter's identity. Explain each boundary briefly. Do not delegate a single group containing all chapters.",
        `Chapter numbers: ${JSON.stringify(input.chapters.map((chapter, index) => ({ number: index + 1, title: chapter.chunk.title })))}`,
        input.buildPrompt(input.chapters), failure ? `Validation feedback: ${failure}` : "",
      ].join("\n\n");
      return JSON.parse(stripFence(await input.codex.run(prompt, {
        task: attempt > 1 ? "content_repair" : "content_analyzer",
        operation: attempt > 1 ? "learning_content_repair" : "learning_content",
        attempt: attempt > 1 ? attempt - 1 : 1, outputSchema: responseSchema, timeoutMs: 180_000,
      })));
    },
  });
  await appendFile(path.join(input.config.runDir, "authoring-decisions.jsonl"), JSON.stringify({
    key: groupKey, bindingHash: semanticHash(binding), policy, mode: decision.mode,
    groups: decision.groups.map(group => ({ chapterIndexes: group.chapters.map(number => input.chapters[number - 1]!.index), reason: group.reason })),
    at: new Date().toISOString(),
  }) + "\n");
  if (decision.mode === "author") return decision.content!;
  const results = new Array<StudyGuideContent>(decision.groups.length);
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(3, decision.groups.length) }, async () => {
    while (next < decision.groups.length) {
      const index = next++;
      const chapters = decision.groups[index]!.chapters.map(number => input.chapters[number - 1]!);
      results[index] = await checkpointOperation({
        ...base, binding: { ...binding, chapters }, key: `authoring-delegate:${semanticHash(chapters.map(chapter => chapter.index)).slice(0, 16)}`,
        validate: value => input.validate(value, chapters),
        run: async (attempt, failure) => JSON.parse(stripFence(await input.codex.run([
          input.buildPrompt(chapters), failure ? `Validation feedback: ${failure}` : "",
        ].join("\n\n"), {
          task: attempt > 1 ? "content_repair" : "content_analyzer",
          operation: attempt > 1 ? "learning_content_repair" : "learning_content",
          attempt: attempt > 1 ? attempt - 1 : 1, outputSchema: studyGuideContentJsonSchema, timeoutMs: 180_000,
        }))),
      });
    }
  }));
  const failure = workers.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
  return input.validate({
    ...results[0], topics: results.flatMap(result => result.topics),
    sources: results.flatMap(result => result.sources),
    scopeNote: [...new Set(results.map(result => result.scopeNote))].join(" "),
  }, input.chapters);
}
function stripFence(value: string): string { return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""); }
