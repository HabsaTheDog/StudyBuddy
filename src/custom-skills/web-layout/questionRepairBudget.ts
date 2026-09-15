import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashRequestContract, type RequestContract } from "../shared/requestContract.js";

export class QuestionRepairBudgetError extends Error {}
const recordSchema = z.object({
  version: z.literal(1), binding: z.string(), itemId: z.string(),
  attempts: z.number().int().min(0).max(3),
});

/** Persist before dispatch. Changing an item's content hash or resuming a run
 * does not replenish its repair budget. Distinct batches have disjoint IDs. */
export async function reserveQuestionRepair(input: {
  runDir: string; resumeRunDir?: string; sourceText: string;
  requestContract: RequestContract; itemId: string;
}): Promise<number> {
  const binding = createHash("sha256").update(hashRequestContract(input.requestContract))
    .update("\0").update(input.sourceText).digest("hex");
  const filename = createHash("sha256").update(binding).update("\0").update(input.itemId).digest("hex") + ".json";
  const relative = path.join("question-repair-budget", filename);
  let attempts = 0;
  for (const root of [...new Set([input.runDir, input.resumeRunDir].filter((value): value is string => Boolean(value)))]) {
    let text: string;
    try { text = await readFile(path.join(root, relative), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const record = recordSchema.parse(JSON.parse(text));
    if (record.binding !== binding || record.itemId !== input.itemId) throw new Error("Question repair budget binding mismatch.");
    attempts = Math.max(attempts, record.attempts);
  }
  if (attempts >= 3) throw new QuestionRepairBudgetError(`Question repair exhausted three attempts for ${input.itemId}; preserve the checkpoint for review.`);
  const destination = path.join(input.runDir, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, binding, itemId: input.itemId, attempts: attempts + 1 }) + "\n", { mode: 0o600 });
  await rename(temporary, destination);
  return attempts + 1;
}
