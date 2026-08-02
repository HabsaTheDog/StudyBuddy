import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizedImageAssets,
  isDeterministicTitlePage,
  rankPage,
  sourceTitleMatchScore,
} from "../learningVisuals.js";

describe("learning visual candidate ranking", () => {
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
