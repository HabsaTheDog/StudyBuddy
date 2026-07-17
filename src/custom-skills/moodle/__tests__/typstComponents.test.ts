import { describe, expect, it } from "vitest";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateTypst } from "../validation.js";
import { studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("Study Buddy Typst components", () => {
  it("bundles the real Study Buddy logo with the cool brand palette", async () => {
    const supportFiles = await getStudyBuddyTypstSupportFiles();
    const components = supportFiles.find((file) => file.relativePath === "study-buddy-components.typ");
    const logo = supportFiles.find((file) => file.relativePath === "assets/study-buddy-logo.png");

    expect(components?.content.toString()).toContain('navy: rgb("#19254b")');
    expect(components?.content.toString()).toContain('image(\n  "assets/study-buddy-logo.png"');
    expect(components?.content.toString()).toMatch(
      /#let sb-header[\s\S]*?align: \(left, horizon\)/,
    );
    expect(components?.content.toString()).not.toContain("#ff5f6d");
    expect(logo?.content).toBeInstanceOf(Buffer);
    expect(logo?.content.length).toBeGreaterThan(1_000);
  });

  it("compiles and raster-renders standardized tables, math, and diagrams", async () => {
    const source = studyBuddyTypstDocument(`
      #sb-math-panel("Mehrzeilige Herleitung")[
        $
          J(beta) &= norm(bold(A) beta - bold(y))_2^2 \\
          nabla_beta J(beta) &= 2 bold(A)^T (bold(A) beta - bold(y)) = 0
        $
      ]

      #sb-formula(
        name: "Einzelelemente",
        variables: "U: Spannung",
        units: "V",
        note: "Gültig für den ohmschen Widerstand.",
      )[$ U = R I $]

      #sb-example(
        title: "Beispiel 1",
        result: [$ I = 2 A $],
      )[
        *Aufgabe:* Bestimme den Strom.

        + Spannung und Widerstand einsetzen.
        + Gleichung nach dem Strom auflösen.
      ]

      #sb-table-section("Messwerte")[
        #sb-table(
          columns: (16mm, 1fr, 1fr),
          header: ("Nr.", [$U_"in"$], "Bewertung"),
          rows: (
            ("1", "12,0 V", [#sb-chip("plausibel", tone: "success")]),
            ("2", "24,0 V", [#sb-chip("prüfen", tone: "warning")]),
          ),
        )
      ]

      #sb-figure(label-text: "Abb. 1", caption: "Geprüfter Ablauf")[
        #sb-flowchart-branch(
          "Messwert erfassen",
          "im Bereich?",
          "Wert übernehmen",
          "Aufbau prüfen",
          "Ergebnis dokumentieren",
        )
      ]

      #sb-figure(label-text: "Abb. 2", caption: "RC-Tiefpass")[
        #sb-rc-schematic()
      ]
    `);

    const result = await validateTypst(
      source,
      await getStudyBuddyTypstSupportFiles(),
    );

    expect(result).toEqual({ ok: true });
  }, 30_000);
});
