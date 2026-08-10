import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelCallTimeoutError,
  NonRetryableCodexError,
  classifyCodexError,
  type CodexClient,
} from "../codexClient.js";
import {
  ChapterFragmentSchema,
  chapterFragmentJsonSchema,
  extractedDataJsonSchema,
} from "../schemas.js";
import {
  buildChapterFragmentPrompt,
  createAnalyzerNode,
  appliedFragmentQualityError,
  ensureDirectEvidenceSelection,
  ensureOfficialTopicEvidenceSelection,
  focusMatchesError,
  fragmentFormulaQualityError,
  normalizeAnalyzerFormulaSyntax,
  visualRequestMatchesChapter,
} from "../nodes/analyzerNode.js";
import {
  persistPendingExtractionRepairs,
  readPendingExtractionRepairs,
} from "../pendingExtractionRepairs.js";
import { StudyBuddyCheckpointError, StudyBuddyTimeoutError } from "../runtimeAbort.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

describe("analyzerNode", () => {
  it("accepts an applied fragment when the chapter's prior theory fragment supplies the central formula", () => {
    const theory = ChapterFragmentSchema.parse({
      formulas: [{
        name: "Ungedämpfte Schwingungen – Bewegungsgleichung und Eigenkreisfrequenz",
        typst: "ddot(theta) + omega^2 theta = 0",
        variables: ["theta Auslenkung", "omega Eigenkreisfrequenz"],
        units: ["theta dimensionslos", "omega: 1/s"],
        context: "Linearisierte Bewegungsgleichung eines ungedämpften Schwingers.",
        source_ids: ["res-formula"],
      }],
    });
    const application = ChapterFragmentSchema.parse({
      worked_examples: [{
        origin: "source",
        learning_goal: "Eigenkreisfrequenz und Periodendauer eines physikalischen Pendels bestimmen.",
        prompt: "Gegeben sind Trägheitsradius k_s und Abstand d. Bestimme omega und T.",
        steps: [
          "1. Momentengleichung um den Aufhängepunkt aufstellen.",
          "2. Für kleine Winkel sin(theta) approx theta verwenden.",
          "3. Mit ddot(theta) + omega^2 theta = 0 vergleichen.",
          "4. Einheitencheck: omega besitzt 1/s und T besitzt s.",
        ],
        result: "omega = sqrt(g d/(k_s^2+d^2)) und T = 2 pi/omega.",
        source_ids: ["res-pendulum"],
      }],
    });
    const focus = {
      key: "oscillations",
      title: "Ungedämpfte Schwingungen",
      resourceIds: ["res-formula", "res-pendulum"],
      matchTerms: ["schwingungen", "eigenkreisfrequenz", "periodendauer"],
      contentMode: "quantitative" as const,
      learningObjectives: [
        "Die Bewegungsgleichung eines Einfreiheitsgrad-Schwingers herleiten.",
        "Eigenkreisfrequenz und Periodendauer bestimmen.",
      ],
    };

    expect(appliedFragmentQualityError(application, focus, 0, [theory])).toBeNull();
    expect(appliedFragmentQualityError(application, focus))
      .toContain("has no central formula aligned");
  });

  it("accepts chapter-scoped formulas for deterministic German fallback objectives", () => {
    const fragment = ChapterFragmentSchema.parse({
      formulas: [{
        name: "Geschwindigkeit und Beschleunigung",
        typst: "vec(v) = dot(vec(r)); vec(a) = dot(vec(v))",
        variables: ["r Ort", "v Geschwindigkeit", "a Beschleunigung"],
        units: ["r: m", "v: m/s", "a: m/s^2"],
        context: "Ableitungskette der Punktkinematik.",
        source_ids: ["res-kinematics"],
      }],
      worked_examples: [{
        origin: "source",
        learning_goal: "Eine Bewegung aus einer Ortsfunktion auswerten.",
        prompt: "Gegeben ist r(t) = (t^2, 2 t). Bestimme v und a.",
        steps: [
          "1. Ortsvektor komponentenweise notieren.",
          "2. Einmal nach t ableiten: v(t) = (2 t, 2).",
          "3. Nochmals nach t ableiten: a(t) = (2, 0).",
          "4. Einheitencheck: v hat m/s und a hat m/s^2.",
        ],
        result: "Damit gelten v(t) = (2 t, 2) m/s und a(t) = (2, 0) m/s^2.",
        source_ids: ["res-kinematics"],
      }],
    });

    expect(appliedFragmentQualityError(fragment, {
      key: "vector-kinematics",
      title: "Vektorkinematik",
      resourceIds: ["res-kinematics"],
      matchTerms: ["vektorkinematik"],
      contentMode: "quantitative",
      learningObjectives: [
        "Die zentralen Zusammenhänge von Vektorkinematik erklären.",
        "Sie auf Rechnungen und typische Aufgaben zu Vektorkinematik anwenden.",
      ],
    })).toBeNull();
  });

  it("accepts a compact mathematical result when it is still independently checkable", () => {
    const fragment = ChapterFragmentSchema.parse({
      formulas: [{
        name: "Geschwindigkeit",
        typst: "v = s/t",
        variables: ["v Geschwindigkeit", "s Weg", "t Zeit"],
        units: ["v: m/s", "s: m", "t: s"],
        context: "Gleichförmige Bewegung.",
        source_ids: ["res-motion"],
      }],
      worked_examples: [{
        origin: "source",
        learning_goal: "Eine Geschwindigkeit bestimmen.",
        prompt: "Gegeben sind s = 20 m und t = 5 s. Bestimme v.",
        steps: [
          "1. Gegebene Werte notieren.",
          "2. v = s/t ansetzen.",
          "3. v = 20/5 m/s berechnen.",
          "4. Einheitencheck: m/s ist korrekt.",
        ],
        result: "v = 4 m/s",
        source_ids: ["res-motion"],
      }],
    });

    expect(appliedFragmentQualityError(fragment, {
      key: "motion",
      title: "Bewegung",
      resourceIds: ["res-motion"],
      matchTerms: ["bewegung"],
      contentMode: "quantitative",
      learningObjectives: [
        "Die zentralen Zusammenhänge von Bewegung erklären.",
        "Sie auf Rechnungen und typische Aufgaben zu Bewegung anwenden.",
      ],
    })).toBeNull();
  });

  it("rejects a derived time polynomial whose numerical coefficients have no time units", () => {
    const fragment = ChapterFragmentSchema.parse({
      formulas: [{
        name: "Punktkinematik – Ableitungskette",
        typst: "vec(v) = dot(vec(r)); vec(a) = ddot(vec(r))",
        variables: ["r Ort", "v Geschwindigkeit", "a Beschleunigung"],
        units: ["r: m", "v: m/s", "a: m/s^2"],
        context: "Ort, Geschwindigkeit und Beschleunigung.",
        source_ids: ["res-kinematics"],
      }],
      worked_examples: [{
        origin: "derived",
        learning_goal: "Eine Ortsfunktion ableiten.",
        prompt: "Gegeben sind x(t)=2t^2 m und y(t)=3t m.",
        steps: [
          "1. Ortsvektor notieren.",
          "2. Einmal nach t ableiten.",
          "3. Zweimal nach t ableiten.",
          "4. Einheitencheck durchführen.",
        ],
        result: "v=(4t,3) m/s und a=(4,0) m/s^2.",
        source_ids: ["res-kinematics"],
      }],
    });

    expect(appliedFragmentQualityError(fragment, {
      key: "kinematics",
      title: "Punktkinematik",
      resourceIds: ["res-kinematics"],
      matchTerms: ["punktkinematik", "geschwindigkeit", "beschleunigung"],
      contentMode: "quantitative",
      learningObjectives: ["Ort, Geschwindigkeit und Beschleunigung verknüpfen."],
    })).toContain("complementary time unit");
  });

  it("rejects an oscillator equation of motion that drops the second derivative", () => {
    const focus = {
      key: "oscillations",
      title: "Ungedämpfte Schwingungen",
      resourceIds: ["res-formula"],
      matchTerms: ["schwingungen"],
      contentMode: "quantitative" as const,
      learningObjectives: ["Die Bewegungsgleichung eines Schwingers herleiten."],
    };
    const invalid = ChapterFragmentSchema.parse({
      formulas: [{
        name: "Lineare Bewegungsgleichung",
        typst: "m dot(x) + m omega^2 x = 0",
        variables: ["x Auslenkung"],
        units: ["x: m"],
        context: "Bewegungsgleichung des ungedämpften Schwingers.",
        source_ids: ["res-formula"],
      }],
    });
    const valid = ChapterFragmentSchema.parse({
      formulas: [{
        name: "Lineare Bewegungsgleichung",
        typst: "m ddot(x) + m omega^2 x = 0",
        variables: ["x Auslenkung"],
        units: ["x: m"],
        context: "Bewegungsgleichung des ungedämpften Schwingers.",
        source_ids: ["res-formula"],
      }],
    });

    expect(fragmentFormulaQualityError(invalid, focus)).toContain("second time derivative");
    expect(fragmentFormulaQualityError(valid, focus)).toBeNull();
  });

  it("removes Markdown math fences from analyzer Typst formula fields", () => {
    expect(normalizeAnalyzerFormulaSyntax(
      "$ vec(v) = dot(r) vec(e)_r $, $ vec(a) = ddot(r) vec(e)_r $",
    )).toBe(
      "vec(v) = dot(r) vec(e)_r , vec(a) = ddot(r) vec(e)_r",
    );
  });

  it("normalizes model-emitted dot.double calls to the supported ddot form", () => {
    expect(normalizeAnalyzerFormulaSyntax(
      "vec(a) = dot.double(x) vec(e)_x + dot . double (bold(r)) vec(e)_r",
    )).toBe(
      "vec(a) = ddot(x) vec(e)_x + ddot(bold(r)) vec(e)_r",
    );
  });

  it("replaces support-only selection with every bounded direct source", () => {
    const candidate = (id: string, resourceId: string, sourceRole: string) => ({
      id,
      resourceId,
      moduleId: "chapter",
      sourceRole,
      content: id,
      ordinal: 0,
      slice: {
        key: id,
        label: id,
        resourceIds: [resourceId],
        records: [{
          id: `ev-${id}`,
          resourceId,
          kind: sourceRole === "worked_example" ? "solution" as const : "claim" as const,
          locator: {},
          content: id,
          confidence: 1,
          pairId: null,
          sourceUrl: `https://moodle.example/${resourceId}`,
          localPath: null,
        }],
      },
    });
    const support = candidate("support", "res-support", "formula");
    const directA = candidate("direct-a", "res-a", "worked_example");
    const directB = candidate("direct-b", "res-b", "worked_example");

    const selected = ensureDirectEvidenceSelection(
      [support, directA],
      [support, directA, directB],
      ["res-a", "res-b"],
      2,
    );

    expect(selected.flatMap((entry) => entry.slice.resourceIds).sort()).toEqual([
      "res-a",
      "res-b",
    ]);
  });

  it("reserves one semantically matched evidence slice for every grouped official topic", () => {
    const candidate = (id: string, content: string) => ({
      id,
      resourceId: "res-calculus",
      moduleId: "calculus",
      sourceRole: "primary_lecture",
      title: id,
      content,
      tags: [],
      ordinal: 0,
      slice: {
        key: id,
        label: id,
        resourceIds: ["res-calculus"],
        records: [],
      },
    });
    const limits = candidate("limits", "Grenzwert Stetigkeit Ableitung");
    const taylor = candidate("taylor", "Taylorpolynom Taylorreihe Restglied");
    const generic = candidate("generic", "Kursübersicht Organisation");
    const selected = ensureOfficialTopicEvidenceSelection(
      [generic, limits],
      [generic, limits, taylor],
      {
        key: "differentialrechnung",
        title: "Differentialrechnung (Themen 2–4)",
        resourceIds: ["res-calculus"],
        matchTerms: [],
        learningObjectives: [
          "Thema 2 – Grundlagen der Differentialrechnung: 20.1 Grenzwert und Stetigkeit",
          "Thema 4 – Anwendungen der Differentialrechnung: 21.1 Taylorreihen",
        ],
      },
      2,
    );

    expect(selected.map((entry) => entry.id)).toEqual(["limits", "taylor"]);
  });

  it("prefers the final explicit subsection when one topic must fit in one evidence slot", () => {
    const candidate = (id: string, content: string) => ({
      id,
      resourceId: "res-calculus",
      moduleId: "calculus",
      sourceRole: "primary_lecture",
      title: id,
      content,
      tags: [],
      ordinal: 0,
      slice: {
        key: id,
        label: id,
        resourceIds: ["res-calculus"],
        records: [],
      },
    });
    const derivative = candidate("derivative", "Grenzwert Stetigkeit Ableitung Differenzierbarkeit");
    const curve = candidate("curve", "Monotonie Krümmung Extremwerte Funktionsuntersuchung");
    const newton = candidate(
      "newton",
      "Iterationsverfahren zur Bestimmung von Nullstellen mit Sekantenverfahren und Newton-Verfahren",
    );

    const selected = ensureOfficialTopicEvidenceSelection(
      [derivative, curve],
      [derivative, curve, newton],
      {
        key: "differentialrechnung",
        title: "Differentialrechnung (Themen 2 und 5)",
        resourceIds: ["res-calculus"],
        matchTerms: [],
        learningObjectives: [
          "Thema 2 – Grundlagen der Differentialrechnung: 20.1 Grenzwert und Stetigkeit",
          "Thema 5 – Anwendungen der Differentialrechnung 2: Funktionsuntersuchungen",
          "Thema 5 – Anwendungen der Differentialrechnung 2 · 21.2 Monotonie, Krümmung und Extremwerte",
          "Thema 5 – Anwendungen der Differentialrechnung 2 · 21.3 Iterationsverfahren zur Bestimmung von Nullstellen",
        ],
      },
      2,
    );

    expect(selected.map((entry) => entry.id)).toEqual(["derivative", "newton"]);
  });

  it("follows a late subsection heading into the next evidence chunk", () => {
    const candidate = (id: string, content: string) => ({
      id,
      resourceId: "res-calculus",
      moduleId: "calculus",
      sourceRole: "primary_lecture",
      title: id,
      content,
      tags: [],
      ordinal: 0,
      slice: {
        key: id,
        label: id,
        resourceIds: ["res-calculus"],
        records: [],
      },
    });
    const previous = candidate(
      "heading",
      `${"Monotonie und Krümmung. ".repeat(45)} 21.3 Iterationsverfahren zur Bestimmung von Nullstellen. Kurze Einführung.`,
    );
    const continuation = candidate(
      "method",
      "Eine Nullstelle wird mit einer Iteration berechnet. Beispiel und Lösung mit Rekursionsformel.",
    );

    const selected = ensureOfficialTopicEvidenceSelection(
      [previous],
      [previous, continuation],
      {
        key: "applications",
        title: "Anwendungen",
        resourceIds: ["res-calculus"],
        matchTerms: [],
        learningObjectives: [
          "Thema 5 – Anwendungen · 21.3 Iterationsverfahren zur Bestimmung von Nullstellen",
        ],
      },
      1,
    );

    expect(selected.map((entry) => entry.id)).toEqual(["method"]);
  });

  it("uses spare evidence slots for explicit subsections inside one official topic", () => {
    const candidate = (id: string, content: string) => ({
      id,
      resourceId: "res-series",
      moduleId: "series",
      sourceRole: "primary_lecture",
      title: id,
      content,
      tags: [],
      ordinal: 0,
      slice: {
        key: id,
        label: id,
        resourceIds: ["res-series"],
        records: [],
      },
    });
    const overview = candidate("overview", "Analysis Konvergenz Überblick");
    const sequences = candidate("sequences", "Folgen Grenzwert Monotonie");
    const series = candidate("series", "Reihen Konvergenzkriterien geometrische Reihe");

    const selected = ensureOfficialTopicEvidenceSelection(
      [overview, sequences],
      [overview, sequences, series],
      {
        key: "series",
        title: "Thema 1: Folgen und Reihen",
        resourceIds: ["res-series"],
        matchTerms: [],
        learningObjectives: [
          "Thema 1 – Folgen und Reihen: Voraussetzungen der reellen Analysis",
          "Thema 1 – Folgen und Reihen · 6.1 Folgen",
          "Thema 1 – Folgen und Reihen · 6.2 Reihen",
        ],
      },
      3,
    );

    expect(selected.map((entry) => entry.id).sort()).toEqual([
      "overview",
      "sequences",
      "series",
    ]);
  });

  it("prefers substantive repeated subsection evidence over an early table-of-contents mention", () => {
    const candidate = (id: string, content: string) => ({
      id,
      resourceId: "res-series",
      moduleId: "series",
      sourceRole: "primary_lecture",
      title: id,
      content,
      tags: [],
      ordinal: 0,
      slice: {
        key: id,
        label: id,
        resourceIds: ["res-series"],
        records: [],
      },
    });
    const contents = candidate("contents", "Inhalt: 6.1 Folgen, 6.2 Reihen");
    const sequences = candidate("sequences", "Folge Grenzwert Folge Konvergenz Folge");
    const series = candidate(
      "series",
      "Reihe Teilsumme Reihe Konvergenzkriterium Reihe geometrische Reihe Grenzwert",
    );

    const selected = ensureOfficialTopicEvidenceSelection(
      [contents, sequences],
      [contents, sequences, series],
      {
        key: "series",
        title: "Thema 1: Folgen und Reihen",
        resourceIds: ["res-series"],
        matchTerms: [],
        learningObjectives: [
          "Thema 1 – Folgen und Reihen · 6.1 Folgen",
          "Thema 1 – Folgen und Reihen · 6.2 Reihen",
        ],
      },
      2,
    );

    expect(selected.map((entry) => entry.id)).toContain("series");
  });

  it("localizes tagged analyzer failures to the exact chapter", () => {
    const differential = {
      key: "differential",
      title: "Differential Calculus",
      resourceIds: ["res_diff"],
      matchTerms: ["differential", "calculus"],
    };
    const applications = {
      key: "applications",
      title: "Applications of Differential Calculus",
      resourceIds: ["res_app"],
      matchTerms: ["applications", "differential", "calculus"],
    };
    const error = "[chapter: Differential Calculus] Chapter analyzer failed: invalid formula.";

    expect(focusMatchesError(differential, error)).toBe(true);
    expect(focusMatchesError(applications, error)).toBe(false);
  });

  it("does not duplicate a topic-specific lookup figure into unrelated chapters", () => {
    const request = {
      purpose: "diagram",
      placementHint: "Grundlagen: Mengen und Zahlbereiche",
      reason: "Mengendiagramm für Zahlbereiche und Mengenoperationen",
    };
    expect(visualRequestMatchesChapter({
      title: "Mengen und Zahlbereiche",
      matchTerms: ["mengen", "zahlbereiche"],
      learningObjectives: [],
      assessmentSignals: [],
    }, request)).toBe(true);
    expect(visualRequestMatchesChapter({
      title: "Differentialgleichungen zweiter Ordnung",
      matchTerms: ["differentialgleichungen", "ordnung"],
      learningObjectives: ["Lösungen berechnen"],
      assessmentSignals: [],
    }, request)).toBe(false);
  });
  it("hands selected visual IDs to the model without exposing local source paths", () => {
    const prompt = buildChapterFragmentPrompt(
      moodleTestConfig({
        prompt: "Create an English dynamics guide",
        outputLanguage: "en",
        outputLanguageReason: "explicit_prompt",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      }),
      moodleTestState(),
      {
        key: "kinematics",
        title: "Vector kinematics",
        resourceIds: ["res_example"],
        matchTerms: ["vector", "kinematics"],
        contentMode: "quantitative",
      },
      { key: "example", label: "Example", resourceIds: ["res_example"], records: [] },
      0,
      1,
      {
        tooling: { pdfinfo: true, pdftotext: true, pdftoppm: true, pdfimages: true, magick: true },
        warnings: [],
        candidates: [{
          id: "page-image",
          kind: "moodle_pdf_page",
          title: "Worked example page",
          relative_path: "assets/visuals/example-page-1.png",
          mime_type: "image/png",
          width_px: 1200,
          height_px: 1600,
          source_id: "res_example",
          source_url: null,
          source_path: "/tmp/example.pdf",
          source_page: 1,
          confidence: 1,
          caption_hint: "Example page",
          relevance_reason: "Selected worked example",
          generation_prompt: null,
        }],
      },
      [{ resourceId: "res_example", pages: [1], purpose: "worked_example", priority: "high", placementHint: "chapter", reason: "read values" }],
    );

    expect(prompt).toContain("\"id\": \"page-image\"");
    expect(prompt).toContain("Attached images correspond to the listed candidate IDs");
    expect(prompt).toContain("numerical coefficients of time functions carry their own units");
    expect(prompt).toContain("Optional arrays such as worked_examples and figures may be empty");
    expect(prompt).not.toContain("assets/visuals/example-page-1.png");
    expect(prompt).not.toContain("/tmp/example.pdf");
    expect(prompt).toContain("in English");
    expect(prompt.length).toBeLessThan(8_000);
  });

  it("repairs a nonquantitative structure error without injecting a calculation recipe", () => {
    const originalPrompt = "Create a clearly structured literature overview PDF.";
    const prompt = buildChapterFragmentPrompt(
      moodleTestConfig({ prompt: "normalized literature workflow", originalUserPrompt: originalPrompt }),
      moodleTestState({
        request_contract: {
          schemaVersion: 1,
          evaluationStatus: "evaluated",
          originalPrompt,
          userGoal: "Understand the structure of the literature course.",
          deliverables: [{ id: "pdf", kind: "pdf", purpose: "Compact literature overview" }],
          requirements: [{
            id: "req-structure",
            statement: "Organize movements and authors into a readable hierarchy.",
            origin: "explicit",
            priority: "must",
            appliesTo: ["pdf"],
            acceptanceCheck: "The hierarchy is clear.",
            evidenceRefs: [],
          }, {
            id: "req-visual-shell",
            statement: "Use the standard page shell.",
            origin: "evidence_derived",
            priority: "should",
            appliesTo: ["pdf"],
            acceptanceCheck: "The page shell is valid.",
            evidenceRefs: [],
          }],
          notRequired: ["calculation examples"],
          forbidden: ["invented numerical values"],
          contentStrategy: {
            summary: "Use a conceptual hierarchy.",
            quantityBasis: "Follow the source structure.",
            completionRule: "Cover the requested movements.",
          },
          reviewAssignments: [{
            owner: "content",
            requirementIds: ["req-structure"],
            checks: ["Check the hierarchy."],
          }, {
            owner: "technical",
            requirementIds: ["req-visual-shell"],
            checks: ["Check the shell."],
          }],
        },
      }),
      {
        key: "literature-structure",
        title: "Literature Structure",
        resourceIds: ["res-literature"],
        matchTerms: ["literature", "structure"],
        contentMode: "conceptual",
      },
      { key: "structure", label: "Course structure", resourceIds: ["res-literature"], records: [] },
      0,
      1,
      null,
      [],
      [
        "Semantic quality review failed:",
        "- [chapter: Literature Structure] The heading hierarchy is ambiguous.",
        "- [chapter: Dynamics] A formula derivation is incomplete.",
      ].join("\n"),
    );

    expect(prompt).toContain(originalPrompt);
    expect(prompt).toContain("req-structure");
    expect(prompt).not.toContain("req-visual-shell");
    expect(prompt).toContain("The heading hierarchy is ambiguous");
    expect(prompt).not.toContain("A formula derivation is incomplete");
    expect(prompt).not.toContain("vollständig nachvollziehbares Beispiel");
    expect(prompt).not.toContain("konkreter mathematischer Beziehung");
    expect(prompt).not.toContain("kleines origin='derived'-Beispiel");
  });

  it("keeps an explicit DYN derivation requirement without inventing a worked-example duty", () => {
    const originalPrompt =
      "Erstelle ein kompaktes DYN2-PDF mit notwendigen Formelherleitungen und Grundverständnis.";
    const prompt = buildChapterFragmentPrompt(
      moodleTestConfig({ prompt: "normalized DYN workflow", originalUserPrompt: originalPrompt }),
      moodleTestState({
        request_contract: {
          schemaVersion: 1,
          evaluationStatus: "evaluated",
          originalPrompt,
          userGoal: "Die DYN2-Theorie und Herleitungen überblicken.",
          deliverables: [{ id: "pdf", kind: "pdf", purpose: "Compact DYN2 overview" }],
          requirements: [{
            id: "req-derivations",
            statement: "Explain the necessary formula derivations requested for the PDF.",
            origin: "explicit",
            priority: "must",
            appliesTo: ["pdf"],
            acceptanceCheck: "Requested derivations are traceable and complete.",
            evidenceRefs: [],
          }],
          notRequired: ["worked examples"],
          forbidden: ["invented example values"],
          contentStrategy: {
            summary: "Prioritize theory, derivations, and conceptual understanding.",
            quantityBasis: "Use the explicit request and evidence.",
            completionRule: "All requested derivations are covered or marked unsupported.",
          },
          reviewAssignments: [{
            owner: "content",
            requirementIds: ["req-derivations"],
            checks: ["Check each requested derivation."],
          }],
        },
      }),
      {
        key: "angular-momentum",
        title: "Drallsatz",
        resourceIds: ["res-angular-momentum"],
        matchTerms: ["drallsatz", "moment"],
        contentMode: "quantitative",
        learningObjectives: ["Den Drallsatz herleiten und einordnen."],
      },
      { key: "derivation", label: "Drallsatz derivation", resourceIds: ["res-angular-momentum"], records: [] },
      0,
      1,
      null,
      [],
      "- [chapter: Drallsatz] The requested derivation skips an evidence-backed intermediate relation.",
    );

    expect(prompt).toContain(originalPrompt);
    expect(prompt).toContain("req-derivations");
    expect(prompt).toContain("necessary formula derivations");
    expect(prompt).toContain("requested derivation skips");
    expect(prompt).toContain("Optional arrays such as worked_examples and figures may be empty");
    expect(prompt).not.toContain("must be implemented as a fully traceable example");
    expect(prompt).not.toContain("vollständig nachvollziehbares Beispiel");
    expect(prompt).not.toContain("kleines origin='derived'-Beispiel");
  });

  it("parses Codex JSON, validates defaults, and passes the schema hint", async () => {
    let receivedPrompt = "";
    let receivedSchema: unknown;
    const codex: CodexClient = {
      async run(prompt, options) {
        receivedPrompt = prompt;
        receivedSchema = options?.outputSchema;
        return '```json\n{"document_title":"DYN2","course":{"title":"Dynamik"}}\n```';
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({
      moodle_raw_text: "Feder-Daempfer-System",
      error_log: "Previous schema error",
      retry_count: 2,
      }),
    );

    expect(receivedPrompt).toContain("Previous validation error to repair:\nPrevious schema error");
    expect(receivedPrompt).toContain("Feder-Daempfer-System");
    expect(receivedPrompt).toContain("Use the evaluated request contract to decide");
    expect(receivedPrompt).toContain("origin='derived'");
    expect(receivedSchema).toBe(extractedDataJsonSchema);
    expect(result.error_log).toBeNull();
    expect(result.retry_count).toBeUndefined();
    expect(result.extracted_data).toMatchObject({
      document_title: "DYN2",
      language: "de",
      course: { title: "Dynamik", url: "" },
      sections: [],
      formulas: [],
    });
  });

  it("starts the dedicated repair task at attempt one after the first analyzer failure", async () => {
    let receivedTask: string | undefined;
    let receivedAttempt: number | undefined;
    const codex: CodexClient = {
      async run(_prompt, options) {
        receivedTask = options?.task;
        receivedAttempt = options?.attempt;
        return JSON.stringify({
          document_title: "DYN2",
          language: "de",
          course: { title: "Dynamik", url: "" },
        });
      },
    };

    await createAnalyzerNode(moodleTestConfig(), codex)(moodleTestState({
      moodle_raw_text: "Feder-Dämpfer-System",
      error_log: "First analyzer validation failure",
      retry_count: 1,
    }));

    expect(receivedTask).toBe("content_repair");
    expect(receivedAttempt).toBe(1);
  });

  it("enforces the resolved artifact language even when source-biased model metadata disagrees", async () => {
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return JSON.stringify({
          document_title: "Dynamics",
          language: "de",
          course: { title: "Dynamik" },
        });
      },
    };
    const config = moodleTestConfig({
      prompt: "Make me a PDF about dynamics",
      outputLanguage: "en",
      outputLanguageReason: "prompt_language",
    });

    const result = await createAnalyzerNode(config, codex)(moodleTestState());

    expect(receivedPrompt).toContain("Output language is English");
    expect(result.extracted_data).toMatchObject({ language: "en" });
  });

  it("reconciles a generic Moodle shell title with the explicitly requested course", async () => {
    const codex: CodexClient = {
      async run() {
        return JSON.stringify({
          document_title: "Baukasten – Study Guide",
          language: "en",
          course: { title: "Baukasten", url: "https://moodle.example/course" },
        });
      },
    };
    const prompt = "Create an English PDF study guide for MAES2";
    const result = await createAnalyzerNode(moodleTestConfig({
      prompt,
      originalUserPrompt: prompt,
      outputLanguage: "en",
      artifactIntent: {
        ...moodleTestConfig().artifactIntent,
        profile: "study_guide",
      },
    }), codex)(moodleTestState());

    expect(result.extracted_data).toMatchObject({
      document_title: "MAES2 – Study Guide",
      course: { title: "MAES2" },
    });
  });

  it("uses the normalized workflow prompt when the original request has no course code", async () => {
    const codex: CodexClient = {
      async run() {
        return JSON.stringify({
          document_title: "Baukasten – Study Guide",
          language: "en",
          course: { title: "Baukasten", url: "https://moodle.example/course" },
        });
      },
    };
    const result = await createAnalyzerNode(moodleTestConfig({
      prompt: "Create an English PDF study guide for MAES2",
      originalUserPrompt: "Make the output clearer and easier to learn from",
      outputLanguage: "en",
      artifactIntent: {
        ...moodleTestConfig().artifactIntent,
        profile: "study_guide",
      },
    }), codex)(moodleTestState());

    expect(result.extracted_data).toMatchObject({
      document_title: "MAES2 – Study Guide",
      course: { title: "MAES2" },
    });
  });

  it("reconciles a generic shell title with the single course proven by the acquired corpus", async () => {
    const codex: CodexClient = {
      async run() {
        return JSON.stringify({
          document_title: "Bachelor Template – Study Guide",
          language: "de",
          course: { title: "Bachelor Template", url: "https://moodle.example/course" },
        });
      },
    };
    const result = await createAnalyzerNode(moodleTestConfig({
      prompt: "Erstelle einen PDF-Study-Guide für Dynamik.",
      originalUserPrompt: "Starte Runs bei MEL und Dynamik.",
      artifactIntent: {
        ...moodleTestConfig().artifactIntent,
        profile: "study_guide",
      },
    }), codex)(moodleTestState({
      moodle_raw_text: "Kurs: Anwendungen der Dynamik\nZusammenfassung-DYN2.pdf",
    }));

    expect(result.extracted_data).toMatchObject({
      document_title: "DYN2 – Anwendungen der Dynamik – Study Guide",
      course: { title: "DYN2 – Anwendungen der Dynamik" },
    });
  });

  it("uses a persisted unseen Moodle course identity without requiring a hard-coded alias", async () => {
    const codex: CodexClient = {
      async run() {
        return JSON.stringify({
          document_title: "Course Shell – Study Guide",
          language: "en",
          course: { title: "Course Shell", url: "https://learn.example.edu/course/view.php?id=204" },
        });
      },
    };
    const result = await createAnalyzerNode(moodleTestConfig({
      prompt: "Create an English study guide for my modern literature course.",
      originalUserPrompt: "Create an English study guide for my modern literature course.",
      outputLanguage: "en",
      artifactIntent: {
        ...moodleTestConfig().artifactIntent,
        profile: "study_guide",
      },
    }), codex)(moodleTestState({
      moodle_raw_text: [
        "[Moodle course resolution]",
        "Selected: HUM-204 World Literature",
        "Course title: World Literature: Modernism and Memory",
        "URL: https://learn.example.edu/course/view.php?id=204",
        "Confidence: high",
        "Method: model_evidence",
      ].join("\n"),
    }));

    expect(result.extracted_data).toMatchObject({
      document_title: "World Literature: Modernism and Memory – Study Guide",
      language: "en",
      course: {
        title: "World Literature: Modernism and Memory",
        url: "https://learn.example.edu/course/view.php?id=204",
      },
    });
  });

  it("combines a requested course code with its resolved descriptive title", async () => {
    const codex: CodexClient = {
      async run() {
        return JSON.stringify({
          document_title: "Course Shell – Study Guide",
          language: "de",
          course: { title: "Course Shell" },
        });
      },
    };
    const prompt = "Erstelle einen Study Guide für meine DYN2-Prüfung.";
    const result = await createAnalyzerNode(moodleTestConfig({
      prompt,
      originalUserPrompt: prompt,
      artifactIntent: {
        ...moodleTestConfig().artifactIntent,
        profile: "study_guide",
      },
    }), codex)(moodleTestState({
      moodle_raw_text: [
        "[Moodle course resolution]",
        "Selected: BMR-VZ-2-SS2026-DYN2-DE Anwendungen der Dynamik",
        "Course title: Anwendungen der Dynamik",
        "URL: https://moodle.example/course/view.php?id=32844",
        "Confidence: high",
        "Method: exact_dashboard_match",
      ].join("\n"),
    }));

    expect(result.extracted_data).toMatchObject({
      document_title: "DYN2 – Anwendungen der Dynamik – Study Guide",
      course: {
        title: "DYN2 – Anwendungen der Dynamik",
        url: "https://moodle.example/course/view.php?id=32844",
      },
    });
  });

  it("keeps invalid analyzer output in retry state", async () => {
    const codex: CodexClient = {
      async run() {
        return '"not an object"';
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({
      retry_count: 1,
      }),
    );

    expect(result.extracted_data).toBeUndefined();
    expect(result.error_log).toMatch(/^Analyzer failed:/);
    expect(result.retry_count).toBe(2);
  });

  it("does not reject a source-grounded chapter merely because it has no worked example", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-partial-chapters-"));
    try {
      const introUrl = "https://moodle.example/intro.pdf";
      const vectorUrl = "https://moodle.example/vector.pdf";
      const codex: CodexClient = {
        async run(_prompt, options) {
          if (options?.outputSchema === chapterFragmentJsonSchema) {
            return JSON.stringify({
              sections: [{
                heading: "Vektorkinematik",
                summary: "Die belegten Grundbeziehungen werden erklärt.",
                key_concepts: ["Geschwindigkeit", "Beschleunigung"],
                source_ids: ["res_vector"],
              }],
              formulas: [],
              worked_examples: [],
              figures: [],
              warnings: [],
            });
          }
          return JSON.stringify({
            document_title: "DYN2",
            language: "de",
            course: { title: "DYN2", url: "https://moodle.example/course" },
            sources: [{
              id: "res_intro",
              title: "Einführung",
              kind: "pdf",
              url: introUrl,
              path: "/tmp/intro.pdf",
              page: null,
            }],
            sections: [{
              heading: "Einführung",
              summary: "Die validierte Einführung bleibt publizierbar.",
              key_concepts: ["Modellbildung"],
              source_ids: ["res_intro"],
            }],
            formulas: [],
            worked_examples: [],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            learning_modules: [],
            warnings: [],
          });
        },
      };
      const resources = [
        { ...chapterResource("intro", "Einführung", "Einführung", "primary_lecture"), originUrl: introUrl },
        { ...chapterResource("vector", "Vektorkinematik", "Vektorkinematik", "primary_lecture"), originUrl: vectorUrl },
      ];
      const state = moodleTestState({
        source_architect_decision: {
          round: 1,
          status: "sufficient",
          coverageSummary: "Two chapters are evidenced.",
          requestedUrls: [],
          remainingAvailable: 0,
          reasons: [],
          learningArchitecture: {
            schemaVersion: 1,
            modules: [{
              id: "intro",
              title: "Einführung",
              priority: "essential",
              contentMode: "conceptual",
              learningObjectives: ["Grundideen erklären"],
              assessmentSignals: [],
              resourceUrls: [introUrl],
            }, {
              id: "vector",
              title: "Vektorkinematik",
              priority: "essential",
              contentMode: "quantitative",
              learningObjectives: ["Geschwindigkeit und Beschleunigung berechnen"],
              assessmentSignals: ["Rechenaufgabe"],
              resourceUrls: [vectorUrl],
            }],
            supportResources: [],
            excludedResourceUrls: [],
          },
        },
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: resources.map((resource, index) => ({
            id: `ev_${index}`,
            resourceId: resource.id,
            kind: "claim" as const,
            locator: { page: 1 },
            content: `${resource.title} mit belegten Lehrinhalten.`,
            confidence: 1,
            pairId: null,
            sourceUrl: resource.originUrl,
            localPath: resource.localPath,
          })),
          warnings: [],
        },
      });

      const result = await createAnalyzerNode(moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      }), codex)(state);

      expect(result.error_log).toBeNull();
      expect(result.extracted_data).toMatchObject({
        sections: [{ heading: "Einführung" }, { heading: "Vektorkinematik" }],
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("rethrows a run-level abort before analysis without creating retry state", async () => {
    const controller = new AbortController();
    const timeout = new StudyBuddyTimeoutError("Global test timeout reached.");
    controller.abort(timeout);
    let calls = 0;
    const codex: CodexClient = {
      async run() {
        calls += 1;
        return '{"document_title":"must not run","course":{"title":"Course"}}';
      },
    };

    await expect(createAnalyzerNode(
      moodleTestConfig({ abortSignal: controller.signal }),
      codex,
    )(moodleTestState({ retry_count: 2 }))).rejects.toBe(timeout);
    expect(calls).toBe(0);
  });

  it("stops chapter workers immediately when the global signal aborts", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-abort-chapters-"));
    try {
      const controller = new AbortController();
      const timeout = new StudyBuddyTimeoutError("Global chapter timeout reached.");
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          controller.abort(timeout);
          throw new Error("SDK request canceled");
        },
      };
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        abortSignal: controller.signal,
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const state = moodleTestState({
        retry_count: 1,
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [
            chapterResource("first", "First chapter", "Topic 1", "primary_lecture"),
            chapterResource("second", "Second chapter", "Topic 2", "primary_lecture"),
          ],
        },
      });

      await expect(createAnalyzerNode(config, codex)(state)).rejects.toBe(timeout);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("First chapter");
      expect(prompts[0]).not.toContain("Second chapter");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("checkpoints on the first tokenless chapter timeout instead of consuming later chapters", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-capacity-checkpoint-"));
    try {
      let calls = 0;
      const codex: CodexClient = {
        async run() {
          calls += 1;
          throw new ModelCallTimeoutError({
            task: "content_analyzer",
            model: "gpt-5.6-luna",
            timeoutMs: 90_000,
            queueWaitMs: 2_000,
          });
        },
      };
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        stage: "extract",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const state = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [
            chapterResource("first", "First chapter", "Topic 1", "primary_lecture"),
            chapterResource("second", "Second chapter", "Topic 2", "primary_lecture"),
          ],
        },
      });

      await expect(createAnalyzerNode(config, codex)(state)).rejects.toThrow(
        "Extraction capacity checkpoint required",
      );
      expect(calls).toBe(1);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("checkpoints before starting a chapter that cannot fit in the remaining run budget", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-checkpoint-chapters-"));
    try {
      let calls = 0;
      const codex: CodexClient = {
        async run() {
          calls += 1;
          throw new Error("Model must not start after checkpoint boundary.");
        },
      };
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        maxRuntimeMs: 10 * 60_000,
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
        executionTelemetry: {
          getSnapshot: () => ({
            startedAt: new Date(Date.now() - 9 * 60_000).toISOString(),
          }),
        } as never,
      });
      const state = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources: [
            chapterResource("first", "First chapter", "Topic 1", "primary_lecture"),
            chapterResource("second", "Second chapter", "Topic 2", "primary_lecture"),
          ],
        },
      });

      await expect(createAnalyzerNode(config, codex)(state)).rejects.toBeInstanceOf(
        StudyBuddyCheckpointError,
      );
      expect(calls).toBe(0);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("caps quick-answer source context before invoking Codex", async () => {
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return '{"document_title":"Answer","course":{"title":"Course"}}';
      },
    };
    const config = moodleTestConfig({
      intentDecision: {
        intent: "quick_answer",
        wantsPdf: false,
        wantsTypstDocument: false,
        wantsQuickAnswer: true,
        wantsQuizAssistance: false,
        needsMoodle: true,
        needsCis: false,
        needsCalendar: false,
        needsCourseMaterial: false,
        needsDownloadedFiles: false,
        reason: "test",
      },
    });

    await createAnalyzerNode(config, codex)(
      moodleTestState({ moodle_raw_text: "x".repeat(200_000) }),
    );

    expect(receivedPrompt.length).toBeLessThan(40_000);
  });

  it("caches valid chapter handoffs and repairs only the chapter named by review feedback", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-chapters-"));
    try {
      const calls: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          calls.push(prompt);
          const glue = prompt.includes("Kleben");
          const id = glue ? "glue" : "rivet";
          const title = glue ? "Kleben" : "Nieten";
          return JSON.stringify({
            document_title: "MEL",
            language: "de",
            course: { title: "MEL", url: "https://moodle.example/course" },
            sources: [{ id, title, kind: "pdf", url: `https://moodle.example/${id}.pdf`, path: `/tmp/${id}.pdf`, page: 1 }],
            sections: [{ heading: title, summary: `${title} ausführlich erklärt.`, key_concepts: [`${title} anwenden`], source_ids: [id] }],
            formulas: [],
            worked_examples: [{
              origin: "source",
              learning_goal: `${title} berechnen`,
              prompt: `${title} Beispiel`,
              steps: ["Gegebenes erfassen", "Ergebnis bestimmen"],
              result: "Ergebnis",
              source_ids: [id],
            }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("glue", "Foliensatz: Kleben", "Eigenstudium 2", "primary_lecture"),
        chapterResource("glue-solution", "Lösung 5", "Eigenstudium 2", "worked_example"),
        chapterResource("rivet", "Foliensatz: Nietverbindung", "Eigenstudium 3", "primary_lecture"),
        chapterResource("rivet-solution", "Lösung 7", "Eigenstudium 3", "worked_example"),
      ];
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const baseState = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
      });

      const first = await createAnalyzerNode(config, codex)(baseState);
      const repaired = await createAnalyzerNode(config, codex)({
        ...baseState,
        error_log: "Chapter is too shallow: Klebeverbindungen",
      });

      expect(calls).toHaveLength(3);
      expect(first.extracted_data).toMatchObject({ sections: [{ heading: "Kleben" }, { heading: "Nieten" }] });
      expect(repaired.error_log).toBeNull();
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("regenerates the cached dense fragment localized by generic semantic feedback", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-formula-repair-"));
    try {
      const prompts: string[] = [];
      let repairPass = false;
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          const impulse = prompt.includes("Impulssatz");
          const formulaName = impulse ? "Impulssatz" : "Erlösfunktion";
          return JSON.stringify({
            sections: [{
              heading: formulaName,
              summary: `${formulaName} wird mit Voraussetzungen und Kontrolle erklärt.`,
              key_concepts: [formulaName],
              source_ids: [impulse ? "res_impulse" : "res_revenue"],
            }],
            formulas: [{
              name: formulaName,
              typst: impulse ? "dot(P) = sum F" : "E = p q",
              variables: impulse ? ["P: Impuls", "F: äußere Kraft"] : ["E: Erlös", "p: Preis", "q: Menge"],
              units: impulse && !repairPass ? [] : [impulse ? "P: kg m/s; F: N" : "E: EUR; p: EUR/Stück; q: Stück"],
              context: impulse ? "Abgeschlossenes System mit äußeren Kräften." : "Konstanter Stückpreis.",
              source_ids: [impulse ? "res_impulse" : "res_revenue"],
            }],
            worked_examples: [{
              origin: "derived",
              learning_goal: `${formulaName} anwenden`,
              prompt: `${formulaName} anhand gegebener Werte anwenden.`,
              steps: ["Größen mit Einheiten erfassen", "Formel einsetzen", "Ergebnis kontrollieren"],
              result: "Das Ergebnis ist mit Einheit und Kontrolle dokumentiert.",
              source_ids: [impulse ? "res_impulse" : "res_revenue"],
            }],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("impulse", "Impulssatz", "Dynamik", "primary_lecture"),
        chapterResource("revenue", "Erlösfunktion", "Wirtschaft", "primary_lecture"),
      ];
      const evidenceRecords = resources.flatMap((resource) =>
        Array.from({ length: 19 }, (_, index) => ({
          id: `${resource.id}_${index}`,
          resourceId: resource.id,
          kind: "claim" as const,
          locator: { page: index + 1 },
          content: `${resource.title} Formel Definition Beispiel ${index}`,
          confidence: 1,
          pairId: null,
          sourceUrl: resource.originUrl,
          localPath: resource.localPath,
        }))
      );
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const baseState = moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: evidenceRecords,
          warnings: [],
        },
      });

      await createAnalyzerNode(config, codex)(baseState);
      const firstPassCalls = prompts.length;
      repairPass = true;
      const repairError = "Semantic quality review failed:\n- [chapter: Dynamik — Impulssatz] Die fachliche Einordnung im Kapitel ist widersprüchlich.";
      await persistPendingExtractionRepairs(runDir, repairError, 1);
      const repaired = await createAnalyzerNode(config, codex)({
        ...baseState,
        error_log: repairError,
        retry_count: 1,
      });

      expect(prompts).toHaveLength(firstPassCalls + 1);
      expect(prompts.at(-1)).toContain("Die fachliche Einordnung im Kapitel ist widersprüchlich.");
      expect(repaired.error_log).toBeNull();
      await expect(readPendingExtractionRepairs(runDir)).resolves.toMatchObject({
        pendingChapterTitles: [],
        completedChapterTitles: ["Dynamik — Impulssatz"],
      });
      const formulas = (repaired.extracted_data as {
        formulas: Array<{ name: string; units: string[] }>;
      } | undefined)?.formulas;
      expect(formulas).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Impulssatz", units: ["P: kg m/s; F: N"] }),
      ]));
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("packs bounded theory and paired practice evidence into one dense-chapter call", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-dense-chapter-"));
    try {
      const schemas: unknown[] = [];
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt, options) {
          schemas.push(options?.outputSchema);
          prompts.push(prompt);
          if (prompt.includes("Teil ")) {
            const practice = prompt.includes("Anwendungsblock");
            return JSON.stringify({
              sections: [{
                heading: practice ? "H7/k6 nachschlagen" : "Toleranzgrundlagen",
                summary: practice ? "Nachschlagen und Grenzmaße berechnen." : "EI, ES, ei und es erklären.",
                key_concepts: practice ? ["TB 2-1 bis TB 2-3"] : ["Toleranzfeld"],
                source_ids: [practice ? "res_task" : "res_theory"],
              }],
              formulas: [],
              worked_examples: practice ? [{
                origin: "source",
                learning_goal: "Tabellenmethode anwenden",
                prompt: "H7/k6 bestimmen",
                steps: ["Nennmaßbereich", "Toleranzgrad", "Grundabmaß", "Grenzmaße"],
                result: "Passungskennwerte bestimmt",
                source_ids: ["res_task"],
              }] : [],
              figures: [],
              warnings: [],
            });
          }
          return JSON.stringify({
            document_title: "MEL",
            language: "de",
            course: { title: "MEL", url: "https://moodle.example/course" },
            sources: [{ id: "glue", title: "Kleben", kind: "pdf", url: null, path: "/tmp/glue.pdf", page: null }],
            sections: [{ heading: "Kleben", summary: "Kleben ausführlich.", key_concepts: ["Überlappung"], source_ids: ["glue"] }],
            formulas: [],
            worked_examples: [{ origin: "derived", learning_goal: "Klebung", prompt: "Klebung", steps: ["Rechnen"], result: "OK", source_ids: ["glue"] }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("theory", "Foliensatz: Toleranzen", "Eigenstudium 1", "primary_lecture"),
        chapterResource("task", "Angabe A", "Eigenstudium 1", "worked_example"),
        chapterResource("glue", "Foliensatz: Kleben", "Eigenstudium 2", "primary_lecture"),
      ];
      const evidenceRecords = Array.from({ length: 19 }, (_, index) => ({
        id: `ev_${index}`,
        resourceId: "res_theory",
        kind: "claim" as const,
        locator: { page: index + 1 },
        content: `Toleranzinhalt ${index}`,
        confidence: 1,
        pairId: null,
        sourceUrl: "https://moodle.example/theory.pdf",
        localPath: "/tmp/theory.pdf",
      }));
      evidenceRecords.push({
        id: "ev_task",
        resourceId: "res_task",
        kind: "claim",
        locator: { page: 1 },
        content: "Angabe und Lösung H7/k6",
        confidence: 1,
        pairId: null,
        sourceUrl: "https://moodle.example/task.pdf",
        localPath: "/tmp/task.pdf",
      });
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        prompt: "Erstelle einen Study Guide für MEL",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
      });
      const result = await createAnalyzerNode(config, codex)(moodleTestState({
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: evidenceRecords,
          warnings: [],
        },
      }));

      expect(schemas[0]).toBe(chapterFragmentJsonSchema);
      expect(schemas[1]).toBe(extractedDataJsonSchema);
      expect(prompts.some((prompt) => prompt.includes("Foliensatz: Toleranzen – Theorieblock"))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes("Angabe A – Anwendungsblock"))).toBe(true);
      expect(result.error_log).toBeNull();
      expect(result.extracted_data).toMatchObject({
        sections: [
          { heading: "H7/k6 nachschlagen" },
          { heading: "Kleben" },
        ],
        worked_examples: [
          { learning_goal: "Tabellenmethode anwenden" },
          { learning_goal: "Klebung" },
        ],
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("does not trigger a local repair solely to manufacture an application fragment", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-local-fragment-repair-"));
    try {
      const prompts: string[] = [];
      let vectorCalls = 0;
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          const vector = prompt.includes("\"title\":\"Vektorkinematik\"");
          if (vector) vectorCalls += 1;
          const repaired = vectorCalls === 2;
          const sourceId = vector ? "res_theory" : "res_other";
          return JSON.stringify({
            sections: [{
              heading: vector ? "Vektorkinematik" : "Bezugssysteme",
              summary: vector
                ? `Geschwindigkeits- und Beschleunigungsbeziehungen werden systematisch aufgestellt. ${"Koordinatenwahl, Kopplungsbedingung, Gültigkeitsbereich und Ergebniskontrolle werden nachvollziehbar erklärt. ".repeat(7)}`
                : "Inertial- und Relativsysteme werden unterschieden.",
              key_concepts: vector ? ["Koordinatenwahl", "Kopplungsbedingung"] : ["Bezugssystem"],
              source_ids: [sourceId],
            }],
            formulas: vector && repaired ? [{
              name: "Geschwindigkeitsbeziehung der Vektorkinematik",
              typst: "v_P = v_A + omega cross r_(P/A)",
              variables: ["v_P: Punktgeschwindigkeit", "omega: Winkelgeschwindigkeit"],
              units: ["v: m/s", "omega: 1/s"],
              context: "Kinematische Kopplung eines starren Körpers.",
              source_ids: ["res_theory"],
            }] : [],
            worked_examples: vector && repaired ? [{
              origin: "source",
              learning_goal: "Eine kinematische Kopplung berechnen",
              prompt: "Bestimme die gesuchte Winkelgeschwindigkeit.",
              steps: ["Koordinaten wählen", "v_P = v_A + omega cross r_(P/A) aufstellen", "Nach omega lösen", "Vorzeichen und Einheit prüfen"],
              result: "Die Kontrolle bestätigt die Kopplungsbedingung und die berechnete Winkelgeschwindigkeit.",
              source_ids: ["res_example"],
            }] : [],
            figures: [],
            warnings: [],
          });
        },
      };
      const resources = [
        chapterResource("theory", "Folien Vektorkinematik", "Vektorkinematik", "primary_lecture"),
        chapterResource("example", "Beispiel Kopplung Scheibe–Stab", "Vektorkinematik", "worked_example"),
        chapterResource("other", "Folien Bezugssysteme", "Bezugssysteme", "primary_lecture"),
      ];
      const evidenceRecords = resources.flatMap((resource) =>
        Array.from({ length: 12 }, (_, index) => ({
          id: `${resource.id}_${index}`,
          resourceId: resource.id,
          kind: index === 0 && resource.id === "res_example" ? "exercise" as const : "claim" as const,
          locator: { page: index + 1 },
          content: `${resource.title}: Koordinaten, Geschwindigkeit, Beschleunigung und vollständiger Rechenweg ${index}. ${"x".repeat(1_000)}`,
          confidence: 1,
          pairId: null,
          sourceUrl: resource.originUrl,
          localPath: resource.localPath,
        }))
      );
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: {
          ...moodleTestConfig().artifactIntent,
          profile: "study_guide",
        },
      });
      const result = await createAnalyzerNode(config, codex)(moodleTestState({
        source_architect_decision: {
          round: 1,
          status: "sufficient",
          coverageSummary: "Vektorkinematik mit Übungsquelle ist abgedeckt.",
          requestedUrls: [],
          remainingAvailable: 0,
          reasons: [],
          learningArchitecture: {
            schemaVersion: 1,
            modules: [{
              id: "vector-kinematics",
              title: "Vektorkinematik",
              priority: "essential",
              contentMode: "quantitative",
              learningObjectives: ["Kinematische Kopplungen berechnen"],
              assessmentSignals: ["Rechenbeispiel"],
              resourceUrls: resources.slice(0, 2).map((resource) => resource.originUrl),
            }, {
              id: "reference-frames",
              title: "Bezugssysteme",
              priority: "important",
              contentMode: "conceptual",
              learningObjectives: ["Bezugssysteme unterscheiden"],
              assessmentSignals: [],
              resourceUrls: [resources[2].originUrl],
            }],
            supportResources: [],
            excludedResourceUrls: [],
          },
        },
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: evidenceRecords,
          warnings: [],
        },
      }));

      const vectorPrompts = prompts.filter((prompt) =>
        prompt.includes("\"title\":\"Vektorkinematik\"")
      );
      expect(vectorPrompts).toHaveLength(1);
      expect(result.error_log).toBeNull();
      expect(result.extracted_data).toMatchObject({ worked_examples: [] });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("keeps directly assigned MAES evidence ahead of generic calculus support", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-direct-evidence-"));
    try {
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          const sourceId = prompt.includes("Differential Equations")
            ? "res_ode10"
            : "res_other";
          return JSON.stringify({
            sections: [{
              heading: "Method",
              summary: `A source-grounded method. ${"The classification, assumptions, solution path, boundary conditions, and verification are explained for independent study. ".repeat(8)}`,
              key_concepts: ["verification"],
              source_ids: [sourceId],
            }],
            formulas: sourceId === "res_ode10" ? [{
              name: "Differential equation",
              typst: "y'' + y = 0",
              variables: ["y: unknown function"],
              units: ["dimensionless"],
              context: "Linear homogeneous differential equation.",
              source_ids: [sourceId],
            }] : [],
            worked_examples: [{
              origin: "source",
              learning_goal: "Apply the method",
              prompt: "Solve the assigned task",
              steps: ["Classify the equation", "Set y = exp(lambda x)", "Solve lambda^2 + 1 = 0", "Check the solution by substitution"],
              result: "The substitution check confirms the resulting solution family.",
              source_ids: [sourceId],
            }],
            figures: [],
            warnings: [],
          });
        },
      };
      const ode10 = chapterResource("ode10", "Minitest 10 solutions", "ODE", "worked_example");
      const ode11 = chapterResource("ode11", "Minitest 11 solutions", "ODE", "worked_example");
      const differential = chapterResource(
        "diff_overview",
        "General Differential Calculus",
        "Library",
        "primary_lecture",
      );
      const integral = chapterResource(
        "integral_overview",
        "General Integral Calculus",
        "Library",
        "primary_lecture",
      );
      const semanticHandbook = chapterResource(
        "semantic_handbook",
        "Course handbook",
        "Library",
        "primary_lecture",
      );
      const other = chapterResource("other", "Other module", "Other", "primary_lecture");
      const resources = [ode10, ode11, differential, integral, semanticHandbook, other];
      const records = resources.flatMap((resource) =>
        Array.from({ length: 20 }, (_, index) => ({
          id: `${resource.id}_ev_${index}`,
          resourceId: resource.id,
          kind: "claim" as const,
          locator: { page: index + 1 },
          content: resource.id === semanticHandbook.id
            ? `SEMANTIC_SUPPORT_SENTINEL Differential Equations: solve equations with a characteristic equation and substitution check ${index}.`
            : `${resource.title} evidence ${index}.`,
          confidence: 1,
          pairId: null,
          sourceUrl: resource.originUrl,
          localPath: resource.localPath,
        }))
      );
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "study_guide" },
        outputLanguage: "en",
      });
      const result = await createAnalyzerNode(config, codex)(moodleTestState({
        source_architect_decision: {
          round: 2,
          status: "sufficient",
          coverageSummary: "Direct resources acquired.",
          requestedUrls: [],
          remainingAvailable: 0,
          reasons: [],
          learningArchitecture: {
            schemaVersion: 1,
            modules: [{
              id: "differential-equations",
              title: "Differential Equations",
              priority: "essential",
              contentMode: "quantitative",
              learningObjectives: ["Solve differential equations."],
              assessmentSignals: ["Minitests 10 and 11"],
              resourceUrls: [ode10.originUrl, ode11.originUrl],
            }, {
              id: "other",
              title: "Other module",
              priority: "important",
              contentMode: "mixed",
              learningObjectives: ["Apply another method."],
              assessmentSignals: ["Course task"],
              resourceUrls: [other.originUrl],
            }],
            supportResources: [{
              id: "calculus",
              title: "Differential calculus overview",
              purpose: "general_reference",
              resourceUrls: [differential.originUrl, integral.originUrl],
            }, {
              id: "semantic-handbook",
              title: "Course handbook",
              purpose: "general_reference",
              resourceUrls: [semanticHandbook.originUrl],
            }],
            excludedResourceUrls: [],
          },
        },
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records,
          warnings: [],
        },
      }));

      const odePrompts = prompts.filter((prompt) => prompt.includes("Differential Equations"));
      expect(odePrompts.length).toBeLessThanOrEqual(2);
      expect(odePrompts[0]).toContain("Minitest 10 solutions");
      expect(odePrompts[0]).toContain("Minitest 11 solutions");
      expect(odePrompts.join("\n")).not.toContain("General Integral Calculus");
      expect(odePrompts.join("\n")).toContain("SEMANTIC_SUPPORT_SENTINEL");
      expect(result.error_log).toBeNull();
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("uses model-planned domain modules and bounds a large course independently of Moodle session names", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-domain-modules-"));
    try {
      const prompts: string[] = [];
      const codex: CodexClient = {
        async run(prompt) {
          prompts.push(prompt);
          if (prompt.includes("Teil ")) {
            return JSON.stringify({
              sections: [{
                heading: "Differentialgleichungen lösen",
                summary: `Ein ausführlicher mathematischer Lernabschnitt mit Lösungsstrategie. ${"Klassifikation, Ansatzwahl, Randbedingungen, Rechenschritte und Einsetzprobe werden lernorientiert erklärt. ".repeat(8)}`,
                key_concepts: ["Ansatz auswählen", "Lösung kontrollieren"],
                source_ids: ["res_math"],
              }],
              formulas: [{
                name: "Differentialgleichung",
                typst: "y'' + y = 0",
                variables: ["y: gesuchte Funktion"],
                units: ["dimensionslos"],
                context: "Lineare Differentialgleichung mit konstanten Koeffizienten.",
                source_ids: ["res_math"],
              }],
              worked_examples: [{
                origin: "source",
                learning_goal: "Eine Differentialgleichung lösen",
                prompt: "Löse eine repräsentative Gleichung.",
                steps: ["Typ erkennen", "Ansatz y = exp(lambda x) wählen", "In lambda^2 + 1 = 0 einsetzen", "Lösung durch Einsetzen kontrollieren"],
                result: "Die Einsetzprobe bestätigt, dass die Lösung die Gleichung erfüllt.",
                source_ids: ["res_math"],
              }],
              figures: [],
              warnings: [],
            });
          }
          return JSON.stringify({
            document_title: "Interdisziplinärer Kurs",
            language: "de",
            course: { title: "Kurs", url: "https://moodle.example/course" },
            sources: [{
              id: "res_case",
              title: "Clinical cases",
              kind: "pdf",
              url: "https://moodle.example/case.pdf",
              path: "/tmp/case.pdf",
              page: null,
            }],
            sections: [{
              heading: "Akuten Fall beurteilen",
              summary: "Ein klinischer Fall wird anhand der belegten Befunde strukturiert beurteilt.",
              key_concepts: ["Befunde gewichten", "Entscheidung begründen"],
              source_ids: ["res_case"],
            }],
            formulas: [],
            worked_examples: [{
              origin: "source",
              learning_goal: "Eine Fallvignette beurteilen",
              prompt: "Ordne die Befunde einer Fallvignette ein.",
              steps: ["Leitsymptom", "Differenzialdiagnosen", "Entscheidung"],
              result: "Die Entscheidung ist anhand der Befunde begründet.",
              source_ids: ["res_case"],
            }],
            quiz_style_questions: [],
            visual_assets: [],
            figures: [],
            learning_modules: [{
              id: "model-invented-session",
              title: "Präsenz 15",
              priority: "supplementary",
              content_mode: "conceptual",
              learning_objectives: [],
              assessment_signals: [],
              resource_ids: ["res_case"],
            }],
            warnings: [],
          });
        },
      };
      const mathUrl = "https://moodle.example/math.pdf";
      const caseUrl = "https://moodle.example/case.pdf";
      const referenceUrl = "https://moodle.example/course-reference.pdf";
      const resources = [
        chapterResource("math", "Differentialgleichungen", "Präsenz 15", "primary_lecture"),
        chapterResource("case", "Clinical cases", "Präsenz 15", "primary_lecture"),
        chapterResource("reference", "Course-wide reference", "Präsenz 15", "primary_lecture"),
      ].map((resource, index) => ({
        ...resource,
        originUrl: index === 0 ? mathUrl : index === 1 ? caseUrl : referenceUrl,
        selection: index === 2 ? { ...resource.selection!, role: "external_reference" as const } : resource.selection,
      }));
      const denseMathEvidence = Array.from({ length: 80 }, (_, index) => ({
        id: `ev_math_${index}`,
        resourceId: "res_math",
        kind: "claim" as const,
        locator: { page: index + 1 },
        content: `Differentialgleichung Lösungsweg Prüfung ${index} ${"x".repeat(1_000)}`,
        confidence: 1,
        pairId: null,
        sourceUrl: mathUrl,
        localPath: "/tmp/math.pdf",
      }));
      const config = moodleTestConfig({
        runDir,
        runtimeCacheDir: path.join(runDir, "runtime-cache"),
        executionProfile: "balanced",
        artifactIntent: { ...moodleTestConfig().artifactIntent, profile: "interactive_learning" },
      });
      const state = moodleTestState({
        source_architect_decision: {
          round: 1,
          status: "sufficient",
          coverageSummary: "Two domain modules are covered.",
          requestedUrls: [],
          remainingAvailable: 0,
          reasons: [],
          learningArchitecture: {
            schemaVersion: 1,
            modules: [{
              id: "differential-equations",
              title: "Differentialgleichungen",
              priority: "essential",
              contentMode: "quantitative",
              learningObjectives: ["Gleichungen lösen und kontrollieren"],
              assessmentSignals: ["Prüfungsaufgaben"],
              resourceUrls: [mathUrl],
            }, {
              id: "acute-cases",
              title: "Akute Fallbeurteilung",
              priority: "essential",
              contentMode: "case_based",
              learningObjectives: ["Fallvignetten begründet beurteilen"],
              assessmentSignals: ["Fallprüfung"],
              resourceUrls: [caseUrl],
            }],
            supportResources: [{
              id: "course-reference",
              title: "Course-wide reference",
              purpose: "general_reference",
              resourceUrls: [referenceUrl],
            }],
            excludedResourceUrls: [],
          },
        },
        resource_manifest: {
          schemaVersion: "1.0",
          courseUrl: "https://moodle.example/course",
          generatedAt: new Date().toISOString(),
          resources,
        },
        evidence_package: {
          schemaVersion: "1.0",
          generatedAt: new Date().toISOString(),
          records: [...denseMathEvidence, {
            id: "ev_case",
            resourceId: "res_case",
            kind: "exercise" as const,
            locator: { page: 1 },
            content: "Fallvignette mit Leitsymptom, Befunden und begründeter Entscheidung.",
            confidence: 1,
            pairId: null,
            sourceUrl: caseUrl,
            localPath: "/tmp/case.pdf",
          }, {
            id: "ev_reference",
            resourceId: "res_reference",
            kind: "claim" as const,
            locator: { page: 1 },
            content: "GLOBAL_REFERENCE_SENTINEL with course-wide explanatory material.",
            confidence: 1,
            pairId: null,
            sourceUrl: referenceUrl,
            localPath: "/tmp/reference.pdf",
          }],
          warnings: [],
        },
      });

      const result = await createAnalyzerNode(config, codex)(state);
      const fragmentPrompts = prompts.filter((prompt) => prompt.includes("Teil "));

      expect(fragmentPrompts.length).toBeLessThanOrEqual(2);
      expect(prompts.some((prompt) => prompt.includes("Lernmodus: quantitative"))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes("Learning mode: case_based"))).toBe(true);
      expect(prompts.filter((prompt) => prompt.includes("GLOBAL_REFERENCE_SENTINEL"))).toHaveLength(0);
      expect(result.error_log).toBeNull();
      expect(result.extracted_data).toMatchObject({
        learning_modules: [
          { title: "Differentialgleichungen", content_mode: "quantitative" },
          { title: "Akute Fallbeurteilung", content_mode: "case_based" },
        ],
      });
      expect(JSON.stringify(result.extracted_data)).not.toContain("Präsenz 15");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("exhausts the retry budget immediately for deterministic model errors", async () => {
    const codex: CodexClient = {
      async run() {
        throw new NonRetryableCodexError(
          "Model requires a newer version of Codex.",
          "model_incompatible",
        );
      },
    };

    const result = await createAnalyzerNode(moodleTestConfig(), codex)(
      moodleTestState({ retry_count: 0 }),
    );

    expect(result.error_log).toContain("Analyzer failed (non-retryable)");
    expect(result.retry_count).toBe(3);
  });

  it.each([
    [new Error("This model requires a newer version of Codex"), "model_incompatible"],
    [new Error("Update your Codex version to use this model"), "model_incompatible"],
    [new Error("Unsupported model: gpt-future"), "model_unavailable"],
    [{ status: 404, error: { code: "model_not_found" } }, "model_unavailable"],
    [{ statusCode: 401, message: "Unauthorized" }, "authentication"],
    [new Error("Auth failed: not logged in"), "authentication"],
    [{ response: { status: 400 }, message: "Invalid request" }, "invalid_request"],
  ])("classifies deterministic SDK rejection %# as non-retryable", (error, category) => {
    expect(classifyCodexError(error)).toEqual({ category, retryable: false });
  });

  it.each([
    [new Error("Selected model is at capacity. Please try a different model."), "model_capacity"],
    [new Error("rate limit exceeded"), "rate_limit"],
    [new Error("network connection reset"), "network"],
    [new Error("temporary service issue"), "unknown"],
  ])("leaves transient/unknown error %# retryable", (error, category) => {
    expect(classifyCodexError(error)).toEqual({ category, retryable: true });
  });
});

function chapterResource(
  id: string,
  title: string,
  section: string,
  role: "primary_lecture" | "worked_example",
) {
  return {
    id: `res_${id}`,
    parentId: null,
    sectionPath: [section],
    activityType: "resource",
    title,
    originUrl: `https://moodle.example/${id}.pdf`,
    resolvedUrl: null,
    localPath: `/tmp/${id}.pdf`,
    previewPath: null,
    status: "acquired" as const,
    checksum: id,
    verifiedAt: null,
    examRelevance: "unknown" as const,
    failureReason: null,
    selection: { selected: true, role, topic: null, priority: 1, reason: "test" },
  };
}
