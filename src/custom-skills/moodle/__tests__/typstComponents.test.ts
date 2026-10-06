import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { compileTypstPdf, validateTypst, writeTypstSupportFiles } from "../validation.js";
import { runBoundedProcess } from "../../shared/boundedProcess.js";
import { studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("Study Buddy Typst components", () => {
  it("retains scalar content, strings and ordered tuple formula metadata with a visible double-dot accent", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "formula-scalar-ddot-"));
    try {
      const source = studyBuddyTypstDocument(`
        #sb-formula(name: "ScalarMetadataUnique", variables: [ScalarVariableUnique $x$],
          units: [ScalarUnitUnique $"m" / "s"^2$])[$ ddot(x) $]
        #sb-formula(name: "StringMetadataUnique", variables: "StringVariableUnique",
          units: "StringUnitUnique")[$ accent(x, dot.double) $]
        #sb-formula(name: "TupleMetadataUnique",
          variables: ([TupleVariableFirstUnique $x$], [TupleVariableSecondUnique $y$]),
          units: ("TupleUnitFirstUnique", [TupleUnitSecondUnique $"s"$]))[$ x + y $]
        #sb-formula(name: "ScalarProductUnique")[$ 2 cdot 3 $]
      `);
      await writeTypstSupportFiles(runDir, await getStudyBuddyTypstSupportFiles());
      const sourcePath = path.join(runDir, "document.typ");
      const pdfPath = path.join(runDir, "document.pdf");
      await writeFile(sourcePath, source);
      expect(await compileTypstPdf(sourcePath, pdfPath, { packagePath: path.join(runDir, ".typst-packages") })).toEqual({ ok: true, skipped: false });
      const text = await runBoundedProcess("pdftotext", ["-layout", pdfPath, "-"]);
      expect(text.code).toBe(0);
      for (const marker of ["ScalarVariableUnique", "ScalarUnitUnique", "StringVariableUnique", "StringUnitUnique",
        "TupleVariableFirstUnique", "TupleVariableSecondUnique", "TupleUnitFirstUnique", "TupleUnitSecondUnique"]) {
        expect(text.stdout).toContain(marker);
      }
      expect(text.stdout.indexOf("TupleVariableFirstUnique")).toBeLessThan(text.stdout.indexOf("TupleVariableSecondUnique"));
      expect(text.stdout.indexOf("TupleUnitFirstUnique")).toBeLessThan(text.stdout.indexOf("TupleUnitSecondUnique"));
      expect(text.stdout.normalize("NFKC").match(/x\u0308|ẍ/g), text.stdout).toHaveLength(2);
      expect(text.stdout).toMatch(/2\s*⋅\s*3/);
      expect(await readFile(sourcePath, "utf8")).toBe(source);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  }, 30_000);

  it("retains compact source notes and complete nested trailing content across pages", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "source-note-body-"));
    try {
      const paragraphs = Array.from({ length: 80 }, (_, index) =>
        `RetainedParagraph${index}: Every supporting passage remains readable in its original order.`).join("\n\n");
      const source = studyBuddyTypstDocument(`
        #sb-source-note("CompactSourceUnique", coverage: "CompactCoverageUnique")
        #sb-source-note("MainSourceUnique", coverage: "MainCoverageUnique")[
          #text(weight: "bold")[NestedLeadUnique]
          #block(breakable: true)[NestedBlockRetainedUnique.]
          ${paragraphs}
          #sb-source-note("NestedSourceUnique", coverage: "NestedCoverageUnique")[NestedBodyUnique.]
          FinalTrailingBodyUnique.
        ]
      `);
      await writeTypstSupportFiles(runDir, await getStudyBuddyTypstSupportFiles());
      const sourcePath = path.join(runDir, "document.typ");
      const pdfPath = path.join(runDir, "document.pdf");
      await writeFile(sourcePath, source);
      expect(await compileTypstPdf(sourcePath, pdfPath, { packagePath: path.join(runDir, ".typst-packages") })).toEqual({ ok: true, skipped: false });
      const textResult = await runBoundedProcess("pdftotext", ["-layout", pdfPath, "-"]);
      expect(textResult.code).toBe(0);
      for (const marker of ["CompactSourceUnique", "CompactCoverageUnique", "MainSourceUnique", "MainCoverageUnique",
        "NestedLeadUnique", "NestedBlockRetainedUnique", "NestedSourceUnique", "NestedCoverageUnique", "NestedBodyUnique", "FinalTrailingBodyUnique",
        ...Array.from({ length: 80 }, (_, index) => `RetainedParagraph${index}:`)]) {
        expect(textResult.stdout).toContain(marker);
      }
      const info = await runBoundedProcess("pdfinfo", [pdfPath]);
      expect(Number(/^Pages:\s*(\d+)/m.exec(info.stdout)?.[1])).toBeGreaterThan(2);
      expect(await readFile(sourcePath, "utf8")).toBe(source);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  }, 30_000);

  it.each([
    ['#sb-schedule-table((("00–10 min", "Recall the method"),))', 4],
    ['#sb-schedule-table((("00–10 min", "Recall", "Explain"),))', 4],
    ['#sb-schedule-table((("00–10 min", "Recall", "Explain", "Notes", "Extra"),))', 4],
    ['#sb-key-value-table((("Property",),))', 2],
    ['#sb-comparison-table((("Criterion", "Option A"),))', 3],
    ['#sb-table(columns: (1fr, 1fr, 1fr), rows: (("First", "Second"),))', 3],
  ])("rejects malformed approved-table rows before flattening: %s", async (body, expectedColumns) => {
    const result = await validateTypst(studyBuddyTypstDocument(body), await getStudyBuddyTypstSupportFiles(), { preview: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`row 1 must have exactly ${expectedColumns} cells`);
  }, 30_000);

  it("rejects a generic table header inconsistent with its columns", async () => {
    const source = studyBuddyTypstDocument('#sb-table(columns: (1fr, 1fr, 1fr), header: ("A", "B"), rows: (("1", "2", "3"),))');
    const result = await validateTypst(source, await getStudyBuddyTypstSupportFiles(), { preview: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("header must have exactly 3 cells or be empty");
  }, 30_000);

  it("compiles complete approved rows with math, content and empty cells without shifting their columns", async () => {
    const source = studyBuddyTypstDocument(`
      #sb-key-value-table((("Property", [$ x = 2 $]),))
      #sb-comparison-table((("Criterion", [Method A, with detail], ""),))
      #sb-schedule-table((("00–10 min", "Recall", [Explain the method], "Checked notes"),
        ("10–20 min", "Practice", [$ bold(a) times bold(b) $], "")))
      #sb-table(columns: 2, rows: (("First", "Second"),))
    `);
    expect(await validateTypst(source, await getStudyBuddyTypstSupportFiles(), { preview: false })).toEqual({ ok: true });
  }, 30_000);

  it("bundles the real Study Buddy logo with the cool brand palette", async () => {
    const supportFiles = await getStudyBuddyTypstSupportFiles();
    const components = supportFiles.find((file) => file.relativePath === "study-buddy-components.typ");
    const logo = supportFiles.find((file) => file.relativePath === "assets/study-buddy-logo.png");
    const componentSource = components?.content.toString().replaceAll("\r\n", "\n");

    expect(componentSource).toContain('navy: rgb("#19254b")');
    expect(componentSource).toContain('image(\n  "assets/study-buddy-logo.png"');
    expect(componentSource).toMatch(
      /#let sb-header[\s\S]*?align: \(left, horizon\)/,
    );
    expect(componentSource).not.toContain("#ff5f6d");
    expect(componentSource).toContain("sb-page-rules(body, compact: false)");
    expect(componentSource).toContain("if compact == false [#pagebreak(weak: true)]");
    expect(componentSource).toContain("sb-page-rules(body, compact: compact)");
    expect(componentSource).toMatch(/#let sb-formula\([\s\S]*?breakable: false/);
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
        variables: ([$U$: Spannung],),
        units: ([$U$: V],),
        note: "Gültig für den ohmschen Widerstand.",
        compact: true,
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

  it("lets table rows grow instead of clipping long cell content", async () => {
    const supportFiles = await getStudyBuddyTypstSupportFiles();
    const components = supportFiles.find((file) => file.relativePath === "study-buddy-components.typ");
    const componentSource = components?.content.toString().replaceAll("\r\n", "\n") ?? "";
    const tableComponent = componentSource.match(/#let sb-table\([\s\S]*?#let sb-table-section/)?.[0] ?? "";

    expect(tableComponent).not.toContain("#box(height: 5.5mm)");
    expect(tableComponent).not.toContain("#box(height: 4.5mm)");
  });
});
