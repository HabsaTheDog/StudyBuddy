import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/custom-skills/shared/modelTaskCatalog.ts", root), "utf8");
const target = new URL("t3code-fork/packages/shared/src/studyBuddyModelTasks.ts", root);
const generated = "// Generated from Study Buddy src/custom-skills/shared/modelTaskCatalog.ts. Do not edit.\n" + source;
if (process.argv.includes("--check")) {
  if (await readFile(target, "utf8") !== generated) throw new Error("Task catalogue is stale. Run node scripts/sync-model-task-catalog.mjs");
} else {
  await writeFile(target, generated);
}
