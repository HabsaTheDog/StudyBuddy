import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const genericSemanticFiles = [
  "nodes/analyzerNode.ts",
  "studyModel.ts",
  "resourcePlanning.ts",
  "studentFirstTypstRenderer.ts",
  "sourceArchitect.ts",
];

const adaptiveHtmlFiles = [
  "../web-layout/adaptiveStudyModel.ts",
  "../web-layout/assessmentComposer.ts",
  "../web-layout/assessmentSolutions.ts",
  "../web-layout/assessmentArchitecturePlan.ts",
  "../web-layout/learningProgressionPlan.ts",
  "../web-layout/learningInteractionGuidance.ts",
];

describe("open adaptive architecture guard", () => {
  it("keeps generic PDF planning, normalization, and rendering free of course-specific content recipes", async () => {
    const sources = await Promise.all(genericSemanticFiles.map(async (relativePath) => ({
      relativePath,
      source: await readFile(path.join(import.meta.dirname, "..", relativePath), "utf8"),
    })));

    const forbiddenRecipes = [
      /\bH7\b/,
      /\bk6\b/,
      /Kleben|Klebverbindung/i,
      /Nieten|Nietgruppe/i,
      /Hertz(?:sche)?\s+Pressung/i,
      /Löten|Lötverbindung/i,
      /Roloff|Matek/i,
      /Massengeometrie|Punktkinematik|Vektorkinematik|Drallsatz|Schwingungen/i,
    ];

    for (const { relativePath, source } of sources) {
      for (const recipe of forbiddenRecipes) {
        expect(source, `${relativePath} contains subject-specific recipe ${recipe}`).not.toMatch(recipe);
      }
    }
  });

  it("does not restore fixed example or question quotas in generic pipeline code", async () => {
    const sources = await Promise.all(genericSemanticFiles.map((relativePath) =>
      readFile(path.join(import.meta.dirname, "..", relativePath), "utf8")
    ));
    const combined = sources.join("\n");

    expect(combined).not.toMatch(/EXAMPLES_PER_TOPIC|wantsWorkedExamples|wantsCalculations/);
    expect(combined).not.toMatch(/buildDeterministic(?:Tolerance|Adhesive|Rivet|Soldering|Hertz)/);
    expect(combined).not.toMatch(/renderCompactStudentFirstTypst/);
  });

  it("keeps adaptive HTML planning free of subject-name and named-assessment recipes", async () => {
    const sources = await Promise.all(adaptiveHtmlFiles.map(async (relativePath) => ({
      relativePath,
      source: await readFile(path.join(import.meta.dirname, "..", relativePath), "utf8"),
    })));
    const forbiddenRecipes = [
      /\bDYN2\b|Anwendungen der Dynamik|Maschinenelemente/i,
      /Business English|Pecha[ -]?Kucha/i,
      /Hertz(?:sche)?\s+Pressung|Roloff|Matek/i,
      /oneCalculation|wantsWorkedExamples|wantsCalculations|practiceRequests/i,
    ];

    for (const { relativePath, source } of sources) {
      for (const recipe of forbiddenRecipes) {
        expect(source, `${relativePath} contains semantic recipe ${recipe}`).not.toMatch(recipe);
      }
    }
  });

  it("keeps publication and rerender admission bound to typed reviewed artifacts", async () => {
    const [partialFinalizer, rerenderCli, generator] = await Promise.all([
      readFile(path.join(import.meta.dirname, "..", "nodes/partialExtractionFinalizerNode.ts"), "utf8"),
      readFile(path.join(import.meta.dirname, "..", "../web-layout/rerenderStudyGuideCli.ts"), "utf8"),
      readFile(path.join(import.meta.dirname, "..", "../web-layout/nodes/generatorNode.ts"), "utf8"),
    ]);

    expect(partialFinalizer).not.toMatch(/DEGRADABLE_CONTENT_FAILURE|HARD_CONTENT_FAILURE/);
    expect(rerenderCli).toContain("adaptiveStudyModelSchema.parse");
    expect(rerenderCli).toContain("verifyRequestContractIntegrity");
    expect(rerenderCli).not.toContain("buildAdaptiveStudyModel");
    expect(generator).toContain("Exact original user request:");
    expect(generator).toContain("Evaluated request contract:");
    expect(generator).toContain("render only the optional blocks actually present");
  });
});
