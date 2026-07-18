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
  it("keeps deterministic fallback labels in the resolved English artifact language", () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        language: "en",
        document_title: "Dynamics Study Guide",
        sections: [{
          heading: "Kinematics",
          summary: "Motion is described relative to a reference frame.",
          key_concepts: ["Position", "Velocity"],
          source_ids: [],
        }],
      }),
      structuredClone(initialSourceCoverage),
      { profile: "study_guide" },
    );

    expect(source).toContain("Document note");
    expect(source).toContain("Source coverage");
    expect(source).toContain("Key concepts: Position and Velocity");
    expect(source).toContain('status: "Validated"');
    expect(source).not.toContain("Dokumenthinweis");
    expect(source).not.toContain("Quellenabdeckung");
  });

  it("reconciles an explicit course alias and study-guide document type from the render request", () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        document_title: "Blöcke – Study Guide",
        course: { title: "Blöcke", url: "https://moodle.example/course" },
      }),
      structuredClone(initialSourceCoverage),
      { prompt: "Rendere den DYN2 Study Guide als PDF", profile: "study_guide" },
    );

    expect(source).toContain('title: "DYN2 – Study Guide"');
    expect(source).toContain('course: "DYN2"');
    expect(source).toContain('kind: "Study Guide"');
  });

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
          {
            name: "Steinerscher Satz in Indexschreibweise",
            typst: 'I_d = I_"SP" + M (d^2 δ_(μν) - d_μ d_ν)',
            variables: ["μ, ν: Tensorindizes"],
            units: ["I: kg m²"],
            context: "Verschiebung des Bezugspunkts.",
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
    expect(source).toContain('$ I_d = I_"SP" + M (d^2 δ_(μ ν) - d_μ d_ν) $');
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

  it("renders chapter-specific teaching patterns and interleaves figures with their explanation", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-module-render-"));
    await mkdir(path.join(runDir, "assets", "visuals"), { recursive: true });
    await writeFile(
      path.join(runDir, "assets", "visuals", "rivet.svg"),
      `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"><rect width="180" height="90" fill="white"/><circle cx="90" cy="45" r="25" fill="none" stroke="black"/></svg>`,
      "utf8",
    );
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        sources: [{ id: "rivet", title: "Nietverbindungen", kind: "pdf", url: null, path: null, page: 4 }],
        learning_modules: [{
          id: "rivets",
          title: "Nietverbindungen bemessen",
          priority: "essential",
          content_mode: "quantitative",
          learning_objectives: ["Versagensarten unterscheiden", "Nachweise führen"],
          assessment_signals: ["Lochleibung"],
          resource_ids: ["rivet"],
        }],
        sections: [
          { heading: "Lastpfad", summary: "Die Kraft wird auf die Niete verteilt.", key_concepts: ["Kraftfluss prüfen"], source_ids: ["rivet"] },
          { heading: "Lochleibung", summary: "Die projizierte Fläche begrenzt die Pressung.", key_concepts: ["Blechdicke beachten"], source_ids: ["rivet"] },
          { heading: "Abscheren", summary: "Die Zahl der Scherfugen bestimmt die Fläche.", key_concepts: ["Scherfugen zählen"], source_ids: ["rivet"] },
        ],
        formulas: [{ name: "Lochleibung", typst: "p = F/(n d t)", variables: ["F: Kraft"], units: ["p: N/mm²"], context: "Projizierte Fläche.", source_ids: ["rivet"] }],
        visual_assets: [{
          id: "rivet-figure", kind: "moodle_pdf_page", title: "Lochleibungsskizze",
          relative_path: "assets/visuals/rivet.svg", mime_type: "image/svg+xml",
          width_px: 180, height_px: 90, source_id: "rivet", source_url: null,
          source_path: "/tmp/rivet.pdf", source_page: 4, confidence: 1,
          caption_hint: "Lochleibung", relevance_reason: "Nachweisbild", generation_prompt: null,
        }],
        figures: [{
          asset_id: "rivet-figure",
          caption: "Lochleibung und projizierte Fläche",
          placement_hint: "Direkt nach dem Abschnitt Lochleibung",
          source_ids: ["rivet"],
        }],
        worked_examples: [{
          origin: "derived", learning_goal: "Nietgruppe vollständig prüfen", prompt: "Prüfe vier Niete.",
          steps: ["Last je Niet", "Abscheren", "Lochleibung"], result: "Beide Nachweise erfüllt.",
          source_ids: ["rivet"],
        }],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).toContain('#sb-divider(label: "Versagen prüfen")');
    expect(source).not.toContain("#sb-flowchart-linear");
    expect(source).toContain("Versagenscheck");
    expect(source.indexOf("Lochleibung und projizierte Fläche"))
      .toBeGreaterThan(source.indexOf("Die projizierte Fläche begrenzt die Pressung"));
    expect(source.indexOf("Lochleibung und projizierte Fläche"))
      .toBeLessThan(source.indexOf("Die Nachweise in einem Lastfall bündeln"));
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
    expect(source).not.toContain("Visualisierung nicht gerendert");
    expect(source).not.toContain("Visualisierungsprompt");
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

  it("normalizes digit-prefixed multi-letter subscripts from course formulas", async () => {
    const source = renderDeterministicStudyDocument(
      moodleExtractedData({
        formulas: [
          {
            name: "Zulässige Normalspannung",
            typst: "sigma_(1zul) = sigma_(1B) / S approx 200 N/mm^2",
            variables: ["sigma_(1zul): zulässige Spannung"],
            units: ["sigma: N/mm²"],
            context: "Maschinenelemente-Regressionsfall.",
            source_ids: [],
          },
        ],
      }),
      structuredClone(initialSourceCoverage),
    );

    expect(source).toContain('sigma_"1zul"');
    expect(source).toContain('sigma_"1B"');
    await expect(
      validateTypst(source, await getStudyBuddyTypstSupportFiles()),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
