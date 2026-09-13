import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { STUDY_BUDDY_MODEL_TASKS } from "../../shared/modelTaskCatalog.js";
import { parseModelPolicyOverrides, resolveTaskModelPolicy } from "../modelPolicy.js";

describe("model task integration", () => {
  it("keeps the packaged editor catalogue identical to the standalone workflow", async () => {
    const canonical = await readFile("src/custom-skills/shared/modelTaskCatalog.ts", "utf8");
    const desktop = await readFile("t3code-fork/packages/shared/src/studyBuddyModelTasks.ts", "utf8");
    expect(desktop.slice(desktop.indexOf("\n") + 1)).toBe(canonical);
  });

  it("shows exactly the built-in models used by the runtime, including retries", async () => {
    // Dynamic path keeps desktop-only Effect schema dependencies out of workflow compilation.
    const profiles = await import(path.resolve("t3code-fork/packages/shared/src/studyBuddyProfiles.ts"));
    for (const profile of profiles.STUDY_BUDDY_BUILT_IN_PROFILES) {
      const overrides = parseModelPolicyOverrides(JSON.stringify(profiles.studyBuddyProfileOverrides(profile)));
      for (const operation of STUDY_BUDDY_MODEL_TASKS) {
        const visible = profiles.resolveStudyBuddyTask(profile, operation.id).policy;
        for (const attempt of [1, 2]) {
          const input = { profile: profile.id, task: operation.task, operation: operation.id, attempt };
          const actual = resolveTaskModelPolicy({ ...input, overrides });
          const previous = resolveTaskModelPolicy(input);
          expect(actual.model, `${profile.id}/${operation.id}/${attempt}`).toBe(previous.model);
          expect(actual.reasoningEffort).toBe(previous.reasoningEffort);
          expect(actual.model).toBe(attempt === 1 ? visible.model : visible.retryModel);
          expect(actual.reasoningEffort).toBe(attempt === 1 ? visible.reasoningEffort : visible.retryReasoningEffort);
        }
      }
    }
  });

  it("requires concrete task IDs at every production model callsite", async () => {
    const directory = path.resolve("src/custom-skills");
    const files = await readdir(directory, { recursive: true });
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".ts") || file.includes("__tests__") || file.endsWith("codexClient.ts")) continue;
      const source = ts.createSourceFile(file, await readFile(path.join(directory, file), "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && /(?:codex|model)\.run$/.test(node.expression.getText(source))) {
          const options = node.arguments[1];
          if (options && ts.isObjectLiteralExpression(options) && !options.properties.some(ts.isSpreadAssignment)) {
            const operation = options.properties.find((property) => property.name?.getText(source) === "operation");
            if (!operation || !ts.isPropertyAssignment(operation)) missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
            else {
              function collect(value: ts.Node) {
                if (ts.isStringLiteral(value)) seen.add(value.text);
                ts.forEachChild(value, collect);
              }
              collect(operation.initializer);
            }
          } else if (!options) missing.push(file);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
    const ids = STUDY_BUDDY_MODEL_TASKS.map((task) => task.id);
    expect([...seen].filter((id) => !ids.includes(id as typeof ids[number]))).toEqual([]);
    expect(ids.filter((id) => !["source_search", "content_repair", "artifact_repair"].includes(id) && !seen.has(id))).toEqual([]);
  });
});
