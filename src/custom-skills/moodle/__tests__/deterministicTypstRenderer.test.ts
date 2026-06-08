import { describe, expect, it } from "vitest";
import { renderDeterministicStudyDocument } from "../deterministicTypstRenderer.js";
import { initialSourceCoverage } from "../runDiagnostics.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateTypst } from "../validation.js";
import { moodleExtractedData } from "./support/moodleTestBlocks.js";

describe("deterministic Typst renderer", () => {
  it("renders validated analyzer data into a compilable standardized document", async () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        sources: [
          {
            id: "script",
            title: "Tiefsetzsteller Skript",
            kind: "pdf",
            url: "https://moodle.example/resource",
            path: null,
            page: 4,
          },
        ],
        sections: [
          {
            heading: "Allgemeine Theorie",
            summary: "Der Tiefsetzsteller wandelt eine Gleichspannung.",
            key_concepts: ["Tastgrad", "Induktivität"],
            source_ids: ["script"],
          },
        ],
        formulas: [
          {
            name: "Idealer Tiefsetzsteller",
            typst: "U_a = d U_e",
            variables: ["d: Tastgrad"],
            units: ["U_a, U_e: V"],
            context: "Kontinuierlicher Betrieb.",
            source_ids: ["script"],
          },
        ],
        worked_examples: [
          {
            prompt: "Berechne d.",
            steps: ["Werte einsetzen", "Quotient bilden"],
            result: "d = 0,5",
            source_ids: ["script"],
          },
        ],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).toContain("#sb-document(");
    expect(source).toContain("Allgemeine Theorie");
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles()),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
