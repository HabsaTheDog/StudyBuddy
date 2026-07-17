import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { renderDeterministicStudyDocument } from "../deterministicTypstRenderer.js";
import { initialSourceCoverage } from "../runDiagnostics.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateTypst } from "../validation.js";
import { moodleExtractedData } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

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
            origin: "derived",
            learning_goal: "Den Tastgrad aus Ein- und Ausgangsspannung bestimmen.",
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
    expect(source).toContain('#text(weight: "bold")[Quellen:] [#sb-source-ref("Q1", target: <source-q1>)]');
    expect(source).toContain('#sb-source-note([#sb-source-ref("Q1", target: <source-q1>)');
    expect(source).toContain("<source-q1>");
    expect(source).toContain('#sb-divider(label: "Rechnen")');
    expect(source).not.toContain("#sb-checklist");
    expect(source.match(/#sb-source-note/g)).toHaveLength(2);
    expect(source).toContain("$ U_a = d U_e $");
    expect(source).not.toContain("#raw(");
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles()),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("renders selected visual assets as managed figures", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-visual-render-"));
    await mkdir(path.join(runDir, "assets", "visuals"), { recursive: true });
    await writeFile(
      path.join(runDir, "assets", "visuals", "diagram.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="white"/><circle cx="60" cy="30" r="20" fill="none" stroke="black"/></svg>`,
      "utf8",
    );

    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        visual_assets: [
          {
            id: "fig-001",
            kind: "moodle_pdf_page",
            title: "Blockdiagramm",
            relative_path: "assets/visuals/diagram.svg",
            mime_type: "image/svg+xml",
            width_px: 120,
            height_px: 60,
            source_id: null,
            source_url: "https://moodle.example/resource",
            source_path: "/tmp/source.pdf",
            source_page: 2,
            confidence: 0.9,
            caption_hint: "Blockdiagramm",
            relevance_reason: "Technische Visualisierung.",
            generation_prompt: null,
          },
        ],
        figures: [
          {
            asset_id: "fig-001",
            caption: "Blockdiagramm aus der Quelle",
            placement_hint: "overview",
            source_ids: [],
          },
        ],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).toContain("#image(\"assets/visuals/diagram.svg\", width: 90%)");
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles(), { assetBaseDir: runDir }),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("does not render unresolved Typst diagrams as generic block diagrams", async () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        visual_assets: [
          {
            id: "fig-missing",
            kind: "typst_diagram",
            title: "Toleranzfelder",
            relative_path: null,
            mime_type: null,
            width_px: null,
            height_px: null,
            source_id: null,
            source_url: "https://moodle.example/resource",
            source_path: "/tmp/source.pdf",
            source_page: 2,
            confidence: 0.7,
            caption_hint: "Toleranzfelder als didaktisches Diagramm",
            relevance_reason: "No source image was available.",
            generation_prompt: null,
          },
        ],
        figures: [
          {
            asset_id: "fig-missing",
            caption: "Toleranzfelder von Bohrung und Welle",
            placement_hint: "overview",
            source_ids: [],
          },
        ],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).not.toContain("#sb-block-diagram");
    expect(source).toContain("Visualisierung nicht gerendert");
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles()),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("normalizes analyzer double-dot derivative formulas into valid Typst math", async () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        formulas: [
          {
            name: "Punktkinematik kartesisch",
            typst: "vec(a)=ddot(r)_x vec(e)_x + ddot(vec(r))_y vec(e)_y + \\ddot{phi}",
            variables: ["r: Ortsvektor", "phi: Winkel"],
            units: ["a: m/s^2"],
            context: "Aus dem fehlgeschlagenen Quick-Chat-Dynamik-Run regressionsgetestet.",
            source_ids: [],
          },
        ],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).not.toContain("ddot(");
    expect(source).not.toContain("\\ddot");
    expect(source).toContain("accent(r, dot.double)_x");
    expect(source).toContain("accent(vec(r), dot.double)_y");
    expect(source).toContain("accent(phi, dot.double)");
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles()),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("normalizes multi-letter math subscripts into Typst text subscripts", async () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        formulas: [
          {
            name: "Tastverhältnis",
            typst: "d = T_(ON) / (T_(ON) + T_(OFF))",
            variables: ["d: Tastverhältnis", "T_ON: Einschaltzeit"],
            units: ["T: s"],
            context: "Laborformel.",
            source_ids: [],
          },
        ],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).toContain('T_"ON"');
    expect(source).toContain('T_"OFF"');
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles()),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
