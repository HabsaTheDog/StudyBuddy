import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizedImageAssets,
  isDeterministicTitlePage,
  learningVisualContractContext,
  learningVisualReviewBatchMetadata,
  learningVisualSemanticCacheKey,
  rankPage,
  reviewedCropForRendering,
  sourceTitleMatchScore,
} from "../learningVisuals.js";
import {
  hashRequestContract,
  minimalRequestContract,
  RequestContractSchema,
} from "../../shared/requestContract.js";

describe("learning visual candidate ranking", () => {
  it("does not count distinct parallel visual-review batches as retries", () => {
    const firstBatch = learningVisualReviewBatchMetadata(0);
    const secondBatch = learningVisualReviewBatchMetadata(1);
    const actualSecondBatchRetry = learningVisualReviewBatchMetadata(1, 1);

    expect(firstBatch).toEqual({ batchOrdinal: 1, attempt: 1 });
    expect(secondBatch).toEqual({ batchOrdinal: 2, attempt: 1 });
    expect(actualSecondBatchRetry).toEqual({ batchOrdinal: 2, attempt: 2 });
  });

  it("isolates semantic visual plans for different contracts over identical evidence", () => {
    const prompt = "Create an adaptive guide from this course evidence.";
    const base = minimalRequestContract(prompt, ["interactive-study-guide"]);
    const deliverableId = base.deliverables[0]!.id;
    const withVisuals = RequestContractSchema.parse({
      ...base,
      requirements: [{
        id: "visual-evidence",
        statement: "Retain task-essential course diagrams.",
        origin: "explicit",
        priority: "must",
        appliesTo: [deliverableId],
        acceptanceCheck: "Every retained diagram supports its assigned target.",
        evidenceRefs: [],
      }],
      reviewAssignments: [
        { owner: "visual", requirementIds: ["visual-evidence"], checks: ["Visual is necessary and relevant."] },
        { owner: "technical", requirementIds: [], checks: ["Artifact is readable."] },
      ],
    });
    const withoutVisuals = RequestContractSchema.parse({
      ...withVisuals,
      requirements: [],
      notRequired: ["Images and diagrams"],
      forbidden: ["Visual crops"],
      reviewAssignments: [
        { owner: "visual", requirementIds: [], checks: ["No visual is published."] },
        { owner: "technical", requirementIds: [], checks: ["Artifact is readable."] },
      ],
    });
    const withContext = learningVisualContractContext(
      prompt,
      withVisuals,
      hashRequestContract(withVisuals),
    );
    const withoutContext = learningVisualContractContext(
      prompt,
      withoutVisuals,
      hashRequestContract(withoutVisuals),
    );
    const identicalEvidence = { targetId: "topic-1", imageHash: "same-image" };

    expect(withContext.requirements.map((requirement) => requirement.id)).toEqual(["visual-evidence"]);
    expect(withoutContext.requirements).toEqual([]);
    expect(withoutContext.notRequired).toEqual(["Images and diagrams"]);
    expect(withoutContext.forbidden).toEqual(["Visual crops"]);
    expect(learningVisualSemanticCacheKey(withContext, identicalEvidence))
      .not.toBe(learningVisualSemanticCacheKey(withoutContext, identicalEvidence));
  });

  it("renders the exact crop coordinates returned by the final visual review", () => {
    const reviewed = { x: 123, y: 87, width: 641, height: 509 };

    expect(reviewedCropForRendering(reviewed)).toEqual(reviewed);
    expect(reviewedCropForRendering(reviewed)).not.toBe(reviewed);
  });

  it("prefers the relevant diagram page over page chrome and unrelated prose", () => {
    const query = "tolerance field upper deviation lower deviation zero line";
    const cover = rankPage(
      "Mechanical elements. Tolerances and fits. Faculty logo. Page 1.",
      query,
      0,
    );
    const diagram = rankPage(
      "Tolerance field diagram: upper deviation ES, lower deviation EI, zero line and dimensions are shown.",
      query,
      3,
    );
    const unrelated = rankPage(
      "Long prose about adhesive curing and environmental conditions.",
      query,
      4,
    );

    expect(diagram).toBeGreaterThan(cover);
    expect(diagram).toBeGreaterThan(unrelated);
  });

  it("does not treat generic document-type words as a cross-topic source match", () => {
    expect(sourceTitleMatchScore(
      ["4_Folien_Drallsatz"],
      "1_Folien_Punktkinematik",
    )).toBe(0);
    expect(sourceTitleMatchScore(
      ["3_Folien_Schwerpunktsatz"],
      "1_Folien_Punktkinematik",
    )).toBe(0);
    expect(sourceTitleMatchScore(
      ["4_Folien_Drallsatz"],
      "4_Folien_Drallsatz",
    )).toBe(100);
  });

  it("skips a sparse title page so ranking can continue with later pages", () => {
    expect(isDeterministicTitlePage(
      "2. Vektorkinematik Anwendungen der Dynamik",
      0,
    )).toBe(true);
    expect(isDeterministicTitlePage(
      "Geschwindigkeitsdiagramm mit Vektoren und beschrifteter Bahnkurve",
      1,
    )).toBe(false);
  });

  it("accepts only image paths declared by the extraction handoff", () => {
    const logoPath = path.resolve("CI/logo.png");
    const sourceText = [
      `# Moodle extraction handoff: ${path.dirname(logoPath)}`,
      "",
      "## Extracted data",
      JSON.stringify({
        visual_assets: [{
          id: "figure-1",
          title: "Validated course diagram",
          relative_path: path.basename(logoPath),
          source_id: "source-1",
          source_page: 2,
          caption_hint: "A useful diagram",
          relevance_reason: "Supports the documented objective.",
        }, {
          id: "undeclared-file",
          title: "Missing image",
          relative_path: "missing.png",
          source_id: "source-1",
        }],
      }),
    ].join("\n");

    expect(authorizedImageAssets(sourceText)).toEqual([expect.objectContaining({
      id: "figure-1",
      imagePath: logoPath,
      sourceId: "source-1",
      sourcePage: 2,
    })]);
  });
});
