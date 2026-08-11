import { z } from "zod";

export const StudyWorkflowModuleSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  dependsOn: z.array(z.string().min(1)),
  exclusiveResourceKeys: z.array(z.string().min(1)),
  required: z.boolean(),
});

export const StudyWorkflowPlanSchema = z.object({
  schemaVersion: z.literal(1),
  modules: z.array(StudyWorkflowModuleSchema).min(1),
}).superRefine((plan, context) => {
  const ids = new Set<string>();
  for (const [index, module] of plan.modules.entries()) {
    if (ids.has(module.id)) {
      context.addIssue({ code: "custom", path: ["modules", index, "id"], message: "Module IDs must be unique." });
    }
    ids.add(module.id);
  }
  for (const [index, module] of plan.modules.entries()) {
    for (const dependency of module.dependsOn) {
      if (!ids.has(dependency)) {
        context.addIssue({
          code: "custom",
          path: ["modules", index, "dependsOn"],
          message: `Unknown workflow dependency: ${dependency}`,
        });
      }
      if (dependency === module.id) {
        context.addIssue({ code: "custom", path: ["modules", index, "dependsOn"], message: "A module cannot depend on itself." });
      }
    }
  }
});

export type StudyWorkflowModule = z.infer<typeof StudyWorkflowModuleSchema>;
export type StudyWorkflowPlan = z.infer<typeof StudyWorkflowPlanSchema>;

export interface StudyWorkflowModuleResult<T = unknown> {
  moduleId: string;
  status: "success" | "failed" | "skipped";
  value?: T;
  error?: string;
}

export interface StudyWorkflowExecution<T = unknown> {
  ok: boolean;
  results: StudyWorkflowModuleResult<T>[];
}

/**
 * Executes an evidence/task/artifact DAG in bounded parallel waves.
 *
 * Modules without dependency or exclusive-resource conflicts run together.
 * A failed dependency skips only its downstream modules; independent branches
 * still finish and preserve their artifacts for a later targeted resume.
 */
export async function executeStudyWorkflowPlan<T>(
  input: StudyWorkflowPlan,
  execute: (module: StudyWorkflowModule) => Promise<T>,
): Promise<StudyWorkflowExecution<T>> {
  const plan = StudyWorkflowPlanSchema.parse(input);
  assertAcyclic(plan);
  const pending = new Map(plan.modules.map((module) => [module.id, module]));
  const results = new Map<string, StudyWorkflowModuleResult<T>>();

  while (pending.size > 0) {
    let skippedDependency = false;
    for (const module of [...pending.values()]) {
      const failedDependency = module.dependsOn.find((dependency) => {
        const result = results.get(dependency);
        return result && result.status !== "success";
      });
      if (!failedDependency) continue;
      results.set(module.id, {
        moduleId: module.id,
        status: "skipped",
        error: `Dependency ${failedDependency} did not complete successfully.`,
      });
      pending.delete(module.id);
      skippedDependency = true;
    }

    const ready = [...pending.values()].filter((module) =>
      module.dependsOn.every((dependency) => results.get(dependency)?.status === "success")
    );
    if (ready.length === 0) {
      if (skippedDependency) continue;
      throw new Error("Workflow plan cannot make progress; dependencies are cyclic or unresolved.");
    }

    const wave: StudyWorkflowModule[] = [];
    const claimedResources = new Set<string>();
    for (const module of ready) {
      if (module.exclusiveResourceKeys.some((resource) => claimedResources.has(resource))) continue;
      wave.push(module);
      for (const resource of module.exclusiveResourceKeys) claimedResources.add(resource);
    }

    const settled = await Promise.allSettled(wave.map(async (module) => ({
      module,
      value: await execute(module),
    })));
    for (let index = 0; index < settled.length; index += 1) {
      const module = wave[index]!;
      const result = settled[index]!;
      pending.delete(module.id);
      if (result.status === "fulfilled") {
        results.set(module.id, { moduleId: module.id, status: "success", value: result.value.value });
      } else {
        results.set(module.id, {
          moduleId: module.id,
          status: "failed",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  const ordered = plan.modules.map((module) => results.get(module.id)!);
  return {
    ok: plan.modules.every((module) => !module.required || results.get(module.id)?.status === "success"),
    results: ordered,
  };
}

function assertAcyclic(plan: StudyWorkflowPlan): void {
  const modules = new Map(plan.modules.map((module) => [module.id, module]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Workflow plan contains a dependency cycle at ${id}.`);
    visiting.add(id);
    for (const dependency of modules.get(id)!.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of modules.keys()) visit(id);
}
