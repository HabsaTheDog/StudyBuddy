import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashRequestContract,
  minimalRequestContract,
  RequestContractSchema,
  type RequestContract,
} from "../../shared/requestContract.js";
import {
  assessmentArchitectureCacheKey,
  assessmentArchitectureContractContext,
  assessmentArchitecturePlanSchema,
  resolveAssessmentArchitecturePlan,
  type AssessmentCourseSummary,
} from "../assessmentArchitecturePlan.js";
import type { CodexClient } from "../codexClient.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

const course: AssessmentCourseSummary = {
  courseId: "same-course",
  courseTitle: "Same structural course",
  language: "en",
  modules: [{
    id: "module-1",
    title: "Evidence-backed objective",
    objectives: [{ id: "objective-1", title: "Apply the documented course method in its assessed form." }],
  }],
};

const documentedCases = [
  {
    label: "calculation",
    evidence: "Assessment section: derive the governing relation and calculate the final value from the supplied quantities.",
    deliveryMode: "interactive",
    questionTypes: ["multi-step calculation"],
  },
  {
    label: "oral presentation",
    evidence: "Assessment section: deliver a ten-minute oral presentation and answer follow-up questions from the examiner.",
    deliveryMode: "external-performance",
    questionTypes: ["prepared presentation", "oral follow-up"],
  },
  {
    label: "essay/open response",
    evidence: "Assessment section: write an evidence-based essay that compares the two documented positions.",
    deliveryMode: "self-assessed",
    questionTypes: ["comparative essay"],
  },
  {
    label: "vocabulary",
    evidence: "Assessment section: use the supplied professional vocabulary accurately in contextual sentences.",
    deliveryMode: "interactive",
    questionTypes: ["contextual vocabulary production"],
  },
  {
    label: "case/lab",
    evidence: "Assessment section: perform the documented laboratory procedure, record observations, and justify a decision for the case.",
    deliveryMode: "external-performance",
    questionTypes: ["laboratory procedure", "case decision"],
  },
] as const;

describe("open assessment architecture planning", () => {
  it("binds documented assessment evidence to the exact extraction section instead of the assessment title", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Build only the documented assessment architecture.";
    const contract = documentedContract(prompt);
    const evidence = documentedCases[0].evidence;
    const sourceText = [
      "## Extracted data",
      JSON.stringify({
        sources: [{ id: "assessment-source", title: "Assessment brief" }],
        sections: [{
          heading: "Official assessment task",
          summary: `Context before. ${evidence} Context after.`,
          source_ids: ["assessment-source"],
        }],
      }),
    ].join("\n");

    const plan = await resolveAssessmentArchitecturePlan({
      codex: documentedPlanner(evidence),
      config: { runDir, language: "en", originalUserPrompt: prompt },
      requestContract: contract,
      requestContractHash: hashRequestContract(contract),
      sourceText,
      course,
    });

    expect(plan.sections[0]?.evidenceRefs).toEqual([{
      sourceIds: ["assessment-source"],
      sectionIndex: 0,
      sectionHeading: "Official assessment task",
      learningGoalIndexes: [0],
      exactSpan: {
        start: "Context before. ".length,
        end: "Context before. ".length + evidence.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    }]);
    expect(plan.sections[0]?.evidenceRefs?.[0]?.sectionHeading)
      .not.toBe(plan.sections[0]?.title);
  });

  it.each(documentedCases)("preserves documented $label evidence without a subject recipe", async ({ evidence, deliveryMode, questionTypes }) => {
    const runDir = await temporaryRunDir();
    const prompt = `Build an assessment architecture for evidence case ${runDir}.`;
    const contract = documentedContract(prompt);
    let calls = 0;
    const codex: CodexClient = {
      run: async (modelPrompt, options) => {
        calls += 1;
        expect(options.task).toBe("artifact_planner");
        expect(modelPrompt).toContain(prompt);
        expect(modelPrompt).toContain(evidence);
        expect(modelPrompt).toContain("documented-assessment");
        return JSON.stringify({
          title: "Documented assessment",
          mode: "documented",
          confidence: "high",
          durationMinutes: null,
          maxPoints: null,
          passingPoints: null,
          allowedAids: [],
          prohibitedAids: [],
          basisRequirementIds: [],
          rationale: "The supplied evidence explicitly documents this assessment form.",
          sections: [{
            title: "Documented section",
            evidenceLevel: "explicit",
            deliveryMode,
            taskCount: null,
            points: null,
            weight: null,
            durationMinutes: null,
            questionTypes,
            learningObjectiveIds: ["objective-1"],
            evidenceExcerpt: evidence,
          }],
        });
      },
    };
    const input = {
      codex,
      config: { runDir, language: "en" as const, originalUserPrompt: prompt },
      requestContract: contract,
      requestContractHash: hashRequestContract(contract),
      sourceText: evidence,
      course,
    };

    const first = await resolveAssessmentArchitecturePlan(input);
    const second = await resolveAssessmentArchitecturePlan({
      ...input,
      codex: { run: async () => { throw new Error("A matching bound plan must be reused."); } },
    });

    expect(first.sections[0]).toMatchObject({ deliveryMode, questionTypes, evidenceExcerpt: evidence });
    expect(first.sections[0]!.id).toMatch(/^assessment-section-[a-f0-9]{20}$/);
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(JSON.parse(await readFile(path.join(runDir, "assessment-architecture-plan.json"), "utf8")))
      .toEqual(first);
  });

  it("supports zero documented sections and contract-authorized inferred practice without invented quantities", async () => {
    expect(assessmentArchitecturePlanSchema.safeParse({
      schemaVersion: 1,
      binding: bindingFixture(),
      contentHash: "0".repeat(64),
      title: "No documented assessment",
      mode: "none",
      confidence: "low",
      durationMinutes: null,
      maxPoints: null,
      passingPoints: null,
      allowedAids: [],
      prohibitedAids: [],
      basisRequirementIds: [],
      rationale: "No assessment evidence is available.",
      sections: [],
    }).success).toBe(true);

    const runDir = await temporaryRunDir();
    const prompt = "Create interactive assessment preparation from the documented learning objective.";
    const contract = inferredPracticeContract(prompt);
    const objectiveText = course.modules[0]!.objectives[0]!.title;
    const plan = await resolveAssessmentArchitecturePlan({
      codex: {
        run: async () => JSON.stringify({
          title: "Study Buddy practice architecture",
          mode: "inferred_practice",
          confidence: "medium",
          durationMinutes: null,
          maxPoints: null,
          passingPoints: null,
          allowedAids: [],
          prohibitedAids: [],
          basisRequirementIds: ["interactive-preparation"],
          rationale: "This is derived Study Buddy practice, not an official assessment structure.",
          sections: [{
            title: "Objective-aligned practice",
            evidenceLevel: "derived",
            deliveryMode: "self-assessed",
            taskCount: null,
            points: null,
            weight: null,
            durationMinutes: null,
            questionTypes: ["model-selected objective application"],
            learningObjectiveIds: ["objective-1"],
            evidenceExcerpt: objectiveText,
          }],
        }),
      },
      config: { runDir, language: "en", originalUserPrompt: prompt },
      requestContract: contract,
      requestContractHash: hashRequestContract(contract),
      sourceText: "Course evidence contains objectives but no documented assessment structure.",
      course,
    });

    expect(plan.mode).toBe("inferred_practice");
    expect(plan.sections[0]).toMatchObject({
      evidenceLevel: "derived",
      taskCount: null,
      points: null,
      weight: null,
      durationMinutes: null,
    });
  });

  it("repairs only the invalid assessment plan with independent bounded attempts", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Prepare the documented assessment without inventing task forms.";
    const contract = documentedContract(prompt);
    const evidence = documentedCases[0].evidence;
    const prompts: string[] = [];
    const attempts: number[] = [];
    const valid = JSON.parse(await documentedPlanner(evidence).run("", {
      task: "artifact_planner",
      attempt: 1,
    })) as Record<string, unknown>;

    const plan = await resolveAssessmentArchitecturePlan({
      codex: {
        run: async (modelPrompt, options) => {
          prompts.push(modelPrompt);
          attempts.push(options.attempt ?? 0);
          const schema = options.outputSchema as {
            properties: { sections: { items: { properties: { questionTypes: { minItems?: number } } } } };
          };
          expect(schema.properties.sections.items.properties.questionTypes.minItems).toBe(1);
          if (options.attempt === 1) {
            return JSON.stringify({ ...valid, sections: [] });
          }
          if (options.attempt === 2) {
            const sections = structuredClone(valid.sections as Array<Record<string, unknown>>);
            sections[0]!.questionTypes = [];
            return JSON.stringify({ ...valid, sections });
          }
          return JSON.stringify(valid);
        },
      },
      config: { runDir, language: "en", originalUserPrompt: prompt },
      requestContract: contract,
      requestContractHash: hashRequestContract(contract),
      sourceText: evidence,
      course,
      priorError: "chapter vocabulary needs a definition",
    });

    expect(plan.mode).toBe("documented");
    expect(attempts).toEqual([1, 2, 3]);
    expect(prompts[0]).not.toContain("chapter vocabulary needs a definition");
    expect(prompts[1]).toContain("documented requires at least one section");
    expect(prompts[2]).toContain("questionTypes");
  });

  it("recomputes a valid local plan when a selective chapter repair changes course semantics", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Prepare the documented assessment architecture.";
    const contract = documentedContract(prompt);
    const evidence = documentedCases[0].evidence;
    let calls = 0;
    const planner = documentedPlanner(evidence);
    const codex: CodexClient = {
      run: async (...args) => {
        calls += 1;
        return planner.run(...args);
      },
    };
    const input = {
      codex,
      config: { runDir, language: "en" as const, originalUserPrompt: prompt },
      requestContract: contract,
      requestContractHash: hashRequestContract(contract),
      sourceText: evidence,
      course,
    };
    const beforeRepair = await resolveAssessmentArchitecturePlan(input);
    const repairedCourse: AssessmentCourseSummary = structuredClone(course);
    repairedCourse.modules[0]!.objectives[0]!.title =
      "Apply the repaired documented course method in its assessed form.";
    const afterRepair = await resolveAssessmentArchitecturePlan({
      ...input,
      course: repairedCourse,
      priorError: "Question-bank item review failed for one repaired chapter item.",
    });

    expect(calls).toBe(2);
    expect(afterRepair.binding.contractHash).toBe(beforeRepair.binding.contractHash);
    expect(afterRepair.binding.originalPromptHash).toBe(beforeRepair.binding.originalPromptHash);
    expect(afterRepair.binding.evidenceHash).toBe(beforeRepair.binding.evidenceHash);
    expect(afterRepair.binding.courseHash).not.toBe(beforeRepair.binding.courseHash);
    expect(JSON.parse(await readFile(path.join(runDir, "assessment-architecture-plan.json"), "utf8")))
      .toEqual(afterRepair);
  });

  it("does not treat a tampered binding seal as a recomputable chapter repair", async () => {
    const runDir = await temporaryRunDir();
    const prompt = "Prepare the documented assessment architecture.";
    const contract = documentedContract(prompt);
    const evidence = documentedCases[0].evidence;
    const input = {
      codex: documentedPlanner(evidence),
      config: { runDir, language: "en" as const, originalUserPrompt: prompt },
      requestContract: contract,
      requestContractHash: hashRequestContract(contract),
      sourceText: evidence,
      course,
    };
    await resolveAssessmentArchitecturePlan(input);
    const localPath = path.join(runDir, "assessment-architecture-plan.json");
    const tampered = JSON.parse(await readFile(localPath, "utf8")) as {
      binding: { semanticCacheKey: string };
    };
    tampered.binding.semanticCacheKey = "0".repeat(64);
    await writeFile(localPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    await expect(resolveAssessmentArchitecturePlan({
      ...input,
      codex: { run: async () => { throw new Error("A tampered binding must fail before planning."); } },
    })).rejects.toThrow(/invalid semantic cache key/i);
  });

  it("separates identical course/evidence caches by contract and rejects a stale local binding", async () => {
    const promptA = "Prepare the documented assessment architecture.";
    const promptB = "Do not create an assessment architecture; report evidence only.";
    const contractA = documentedContract(promptA);
    const contractB = documentedContract(promptB, ["Assessment practice sections"]);
    const contextA = assessmentArchitectureContractContext(promptA, contractA, hashRequestContract(contractA));
    const contextB = assessmentArchitectureContractContext(promptB, contractB, hashRequestContract(contractB));
    const courseHash = "a".repeat(64);
    const evidenceHash = "b".repeat(64);

    expect(assessmentArchitectureCacheKey({
      contractHash: contextA.contractHash,
      originalPromptHash: contextA.originalPromptHash,
      courseHash,
      evidenceHash,
    })).not.toBe(assessmentArchitectureCacheKey({
      contractHash: contextB.contractHash,
      originalPromptHash: contextB.originalPromptHash,
      courseHash,
      evidenceHash,
    }));

    const runDir = await temporaryRunDir();
    const evidence = documentedCases[0].evidence;
    await resolveAssessmentArchitecturePlan({
      codex: documentedPlanner(evidence),
      config: { runDir, language: "en", originalUserPrompt: promptA },
      requestContract: contractA,
      requestContractHash: hashRequestContract(contractA),
      sourceText: evidence,
      course,
    });
    await expect(resolveAssessmentArchitecturePlan({
      codex: { run: async () => { throw new Error("Must fail before a model call."); } },
      config: { runDir, language: "en", originalUserPrompt: promptB },
      requestContract: contractB,
      requestContractHash: hashRequestContract(contractB),
      sourceText: evidence,
      course,
    })).rejects.toThrow(/stale|another request/i);
  });
});

function documentedContract(prompt: string, forbidden: string[] = []): RequestContract {
  const base = minimalRequestContract(prompt, ["interactive-study-guide"]);
  const deliverableId = base.deliverables[0]!.id;
  return RequestContractSchema.parse({
    ...base,
    forbidden,
    requirements: [{
      id: "documented-assessment",
      statement: "Represent only assessment structures explicitly documented by the evidence.",
      origin: "explicit",
      priority: "must",
      appliesTo: [deliverableId],
      acceptanceCheck: "Every real assessment section quotes its evidence.",
      evidenceRefs: [],
    }],
    reviewAssignments: [
      { owner: "content", requirementIds: ["documented-assessment"], checks: ["No assessment structure is invented."] },
      { owner: "technical", requirementIds: [], checks: ["The plan is schema-valid."] },
    ],
  });
}

function inferredPracticeContract(prompt: string): RequestContract {
  const base = minimalRequestContract(prompt, ["interactive-study-guide"]);
  const deliverableId = base.deliverables[0]!.id;
  return RequestContractSchema.parse({
    ...base,
    requirements: [{
      id: "interactive-preparation",
      statement: "Create interactive assessment preparation from course objectives even when an official exam structure is unavailable.",
      origin: "explicit",
      priority: "must",
      appliesTo: [deliverableId],
      acceptanceCheck: "Practice is labelled derived and aligned to known objectives.",
      evidenceRefs: [],
    }],
    reviewAssignments: [
      { owner: "interaction", requirementIds: ["interactive-preparation"], checks: ["Derived practice is transparent."] },
      { owner: "technical", requirementIds: [], checks: ["The plan is schema-valid."] },
    ],
  });
}

function documentedPlanner(evidence: string): CodexClient {
  return {
    run: async () => JSON.stringify({
      title: "Documented assessment",
      mode: "documented",
      confidence: "high",
      durationMinutes: null,
      maxPoints: null,
      passingPoints: null,
      allowedAids: [],
      prohibitedAids: [],
      basisRequirementIds: [],
      rationale: "Explicit assessment evidence is available.",
      sections: [{
        title: "Documented section",
        evidenceLevel: "explicit",
        deliveryMode: "self-assessed",
        taskCount: null,
        points: null,
        weight: null,
        durationMinutes: null,
        questionTypes: ["evidence-defined"],
        learningObjectiveIds: ["objective-1"],
        evidenceExcerpt: evidence,
      }],
    }),
  };
}

async function temporaryRunDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "assessment-architecture-"));
  tempDirs.push(directory);
  return directory;
}

function bindingFixture() {
  return {
    cacheVersion: "assessment-architecture-v1-open-contract" as const,
    contractHash: "1".repeat(64),
    originalPromptHash: "2".repeat(64),
    courseHash: "3".repeat(64),
    evidenceHash: "4".repeat(64),
    semanticCacheKey: "5".repeat(64),
  };
}
