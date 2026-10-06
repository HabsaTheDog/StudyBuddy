import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NonRetryableCodexError,
  resolveModelPromptBodyCharacterBudget,
  type CodexClient,
} from "../codexClient.js";
import {
  createCourseResolverNode,
  type CourseCandidate,
  type CourseCatalogReader,
  type CourseProbe,
} from "../nodes/courseResolverNode.js";
import type { SourcePlan } from "../sourcePlanner.js";
import { moodleTestConfig, sequenceCodex } from "./support/moodleTestBlocks.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
  runDir = null;
});

describe("courseResolverNode", () => {
  it.each([
    ["DYN2", "Höhere Kinetik", "Anwendungen der Dynamik"],
    ["ETLB2", "Cell Biology", "Elektrotechnik Labor 2"],
  ])("defers conflicting explicit alias-code and full-title identities to semantic evidence: %s", async (code, namedTitle, codedTitle) => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-code-conflict-"));
    const candidates = [candidate("named", 11, namedTitle), candidate("coded", 12, codedTitle)];
    const config = resolverConfig(`Prepare me for ${code} or ${namedTitle}; I am unsure which course.`);
    const result = await createCourseResolverNode(config, sequenceCodex([
      JSON.stringify({ candidate_ids: ["named", "coded"], reasoning: "Two explicit identities." }),
      JSON.stringify({ selected_id: "named", confidence: "medium", reasoning: "Both remain plausible.", alternatives: [{ id: "coded", reason: "Explicit code." }] }),
      JSON.stringify({ action: "inspect", ids: ["named", "coded"], query: "", reason: "Read both identities.", evidence: [] }),
      JSON.stringify({ action: "clarify", ids: ["named", "coded"], query: "", reason: "Which of the two courses?", evidence: [] }),
    ]), { reader: fakeReader(candidates, {}) })();

    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it.each([
    ["Bitte für DYN2, nicht Höhere Kinetik.", "Anwendungen der Dynamik", "Höhere Kinetik"],
    ["Prepare for molecular genetics, not World Literature.", "Cell Biology", "World Literature"],
    ["Bitte für Buchhaltung, nicht Globale Geschichte.", "Financial Accounting", "Globale Geschichte"],
  ])("does not turn an excluded literal title into the requested course: %s", async (prompt, requestedTitle, excludedTitle) => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-exclusion-"));
    const candidates = [candidate("wanted", 11, requestedTitle), candidate("excluded", 12, excludedTitle)];
    const config = resolverConfig(prompt);
    let modelCalls = 0;
    const codex = sequenceCodex([
      JSON.stringify({ candidate_ids: ["wanted", "excluded"], reasoning: "Inspect requested subject." }),
      JSON.stringify({ selected_id: "wanted", confidence: "high", reasoning: "Requested subject evidence; the other course is excluded.", alternatives: [] }),
    ]);
    const result = await createCourseResolverNode(config, { async run(...args) { modelCalls += 1; return codex.run(...args); } }, { reader: fakeReader(candidates, {}) })();

    expect(result.error_log).toBeNull();
    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(modelCalls).toBe(2);
  });

  it("rejects an excluded title chosen at high confidence by the semantic selector", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-excluded-selector-"));
    const candidates = [candidate("wanted", 11, "Cell Biology"), candidate("excluded", 12, "World Literature")];
    const config = resolverConfig("Prepare for genetics, not World Literature.");
    const result = await createCourseResolverNode(config, sequenceCodex([
      JSON.stringify({ candidate_ids: ["wanted", "excluded"], reasoning: "Candidates." }),
      JSON.stringify({ selected_id: "excluded", confidence: "high", reasoning: "Misinterpreted the literal mention.", alternatives: [] }),
      JSON.stringify({ action: "inspect", ids: ["wanted"], query: "", reason: "Read requested course.", evidence: [] }),
      JSON.stringify({ action: "clarify", ids: ["wanted"], query: "", reason: "Insufficient matching evidence.", evidence: [] }),
    ]), { reader: fakeReader(candidates, {}) })();

    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it("does not let an alias title override an explicitly excluded code for that same course", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-excluded-code-"));
    const candidates = [candidate("wanted", 11, "Cell Biology"), candidate("excluded", 12, "Anwendungen der Dynamik")];
    const config = resolverConfig("Prepare for genetics, not DYN2; Anwendungen der Dynamik is that other course.");
    const result = await createCourseResolverNode(config, sequenceCodex([
      JSON.stringify({ candidate_ids: ["wanted", "excluded"], reasoning: "Candidates." }),
      JSON.stringify({ selected_id: "excluded", confidence: "high", reasoning: "Wrong positive title interpretation.", alternatives: [] }),
      JSON.stringify({ action: "inspect", ids: ["wanted"], query: "", reason: "Read requested course.", evidence: [] }),
      JSON.stringify({ action: "clarify", ids: ["wanted"], query: "", reason: "Insufficient matching evidence.", evidence: [] }),
    ]), { reader: fakeReader(candidates, {}) })();

    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it("rejects an explicitly excluded identity even after inspected semantic recovery", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-excluded-recovery-"));
    const candidates = [candidate("wanted", 11, "Cell Biology"), candidate("excluded", 12, "World Literature")];
    const config = resolverConfig("Prepare for genetics, not World Literature.");
    let calls = 0;
    const codex = sequenceCodex([
      JSON.stringify({ candidate_ids: ["wanted", "excluded"], reasoning: "Candidates." }),
      JSON.stringify({ selected_id: "wanted", confidence: "low", reasoning: "Need more evidence.", alternatives: [] }),
      JSON.stringify({ action: "inspect", ids: ["excluded"], query: "", reason: "Read alternative.", evidence: [] }),
      JSON.stringify({ action: "resolve", ids: ["excluded"], query: "", reason: "Wrong interpretation despite a real quote.", evidence: [{ id: "excluded", quote: "World Literature" }] }),
    ]);
    const result = await createCourseResolverNode(config, { async run(...args) { calls += 1; return codex.run(...args); } }, { reader: fakeReader(candidates, {}) })();

    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(config.targetCourseUrls).toBeUndefined();
    expect(calls).toBe(4);
  });

  it("defers a direct URL conflicting with another named title to evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-url-conflict-"));
    const candidates = [candidate("biology", 11, "Cell Biology"), candidate("history", 12, "World History")];
    const config = resolverConfig(`Prepare for Cell Biology or ${candidates[1].url}; I am unsure.`);
    const result = await createCourseResolverNode(config, sequenceCodex([
      JSON.stringify({ candidate_ids: ["biology", "history"], reasoning: "Two identities." }),
      JSON.stringify({ selected_id: "biology", confidence: "medium", reasoning: "Uncertain.", alternatives: [] }),
      JSON.stringify({ action: "inspect", ids: ["biology", "history"], query: "", reason: "Inspect both.", evidence: [] }),
      JSON.stringify({ action: "clarify", ids: ["biology", "history"], query: "", reason: "Both plausible.", evidence: [] }),
    ]), { reader: fakeReader(candidates, {}) })();

    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it("preserves the zero-model title path when a different direct URL is excluded", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-excluded-url-"));
    const candidates = [candidate("biology", 11, "Cell Biology"), candidate("history", 12, "World History")];
    const config = resolverConfig(`Prepare for Cell Biology, not ${candidates[1].url}.`);
    const reader = fakeReader(candidates, {});
    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result.error_log).toBeNull();
    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(reader.probedIds).toEqual(["biology"]);
  });

  it.each([
    ["Kinetik oder höhere Kinetik", "Höhere Kinetik", "Anwendungen der Dynamik"],
    ["molecular topics, or rather Cell Biology", "Cell Biology", "Introductory Chemistry"],
    ["literature, perhaps World Literature", "World Literature", "Introduction to Humanities"],
    ["accounting, genauer Advanced Financial Reporting", "Advanced Financial Reporting", "Business Administration"],
  ])("prioritizes the unique literal course identity despite uncertainty: %s", async (description, namedTitle, relatedTitle) => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-literal-"));
    const candidates = [candidate("current", 11, namedTitle), candidate("historical", 12, relatedTitle)];
    const reader = fakeReader(candidates, {
      current: "Observed current course: upcoming first assessment.",
      historical: `Historical course: ${description}. First assessment already took place.`,
    });
    let modelCalls = 0;
    const codex: CodexClient = { async run() { modelCalls += 1; throw new Error("A unique literal course must not require semantic guessing."); } };
    const config = resolverConfig(`Prepare me for the first assessment in ${description}.`);

    const result = await createCourseResolverNode(config, codex, { reader })();

    expect(result.error_log).toBeNull();
    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(reader.probedIds).toEqual(["current"]);
    expect(modelCalls).toBe(0);
  });

  it("keeps multiple directly named unrelated courses ambiguous when semantic evidence only gives medium confidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-named-pair-"));
    const candidates = [candidate("literature", 11, "World Literature"), candidate("history", 12, "Global History")];
    const reader = fakeReader(candidates, {
      literature: "First assessment: essay on cultural interpretation.",
      history: "First assessment: essay on cultural interpretation.",
    });
    const config = resolverConfig("Prepare me for World Literature or Global History; I am unsure which assessment it is.");
    const result = await createCourseResolverNode(config, sequenceCodex([
      JSON.stringify({ candidate_ids: ["literature", "history"], reasoning: "Both are directly named." }),
      JSON.stringify({ selected_id: "literature", confidence: "medium", reasoning: "The request leaves two named courses plausible.", alternatives: [{ id: "history", reason: "Also named." }] }),
      JSON.stringify({ action: "clarify", ids: ["literature", "history"], query: "", reason: "Both assessments remain plausible.", evidence: [] }),
    ]), { reader })();

    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it("passes explicit identity precedence and immutable assessment-time context to semantic selection", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-period-"));
    const candidates = [candidate("past", 11, "General Chemistry"), candidate("current", 12, "Biological Methods")];
    const reader = fakeReader(candidates, {
      past: "Observed course end: 2026-07-01. Prior assessment: 2026-06-15. Molecular analysis.",
      current: "Observed course start: 2026-09-01. Upcoming assessment: 2026-10-05. Molecular analysis.",
    });
    const prompts: string[] = [];
    const config = moodleTestConfig({
      ...resolverConfig("Prepare me for my upcoming molecular analysis assessment."),
      temporalRequest: { resolvedAt: "2026-10-02T00:00:00.000Z", timeZone: "UTC", status: "none", relation: "on" },
    });
    const codex: CodexClient = { async run(prompt) {
      prompts.push(prompt);
      return JSON.stringify(prompts.length === 1
        ? { candidate_ids: ["past", "current"], reasoning: "Both teach the described topic." }
        : { selected_id: "current", confidence: "high", reasoning: "Actual upcoming assessment evidence matches the current request context.", alternatives: [] });
    } };

    await createCourseResolverNode(config, codex, { reader })();

    expect(prompts[0]).toContain("Directly named course titles, codes and URLs take precedence");
    expect(prompts[1]).toContain("including tentative naming and self-corrections");
    expect(prompts[1]).toContain("observed course period/start/end metadata");
    expect(prompts[1]).toContain("2026-10-02T00:00:00.000Z");
    expect(prompts[1]).toContain("Do not invent semester boundaries");
    expect(prompts[1]).toContain("override an explicitly requested historical course");
    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
  });

  it("probes semantically shortlisted courses and selects from page evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 20, "MEL1 Maschinenelemente 1"),
      candidate("C3", 30, "ET2 Elektrotechnik 2"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Punktkinematik, Schwingungen und Drallsatz",
      C2: "Wellen, Lager, Passungen, Niet-, Klebe- und Lötverbindungen",
      C3: "Wechselstrom, Netzwerke und elektrische Leistung",
    });
    const codex = sequenceCodex([
      JSON.stringify({
        candidate_ids: ["C2", "C1"],
        reasoning: "Mechanical elements is the strongest title-level candidate.",
      }),
      JSON.stringify({
        selected_id: "C2",
        confidence: "high",
        reasoning: "The probed sections explicitly cover shafts, bearings, fits, and joints.",
        alternatives: [{ id: "C1", reason: "Mechanics-related, but focused on dynamics." }],
      }),
    ]);
    const config = resolverConfig(
      "Find the course about designing shafts, bearings, fits, and mechanical joints",
    );

    const result = await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
    expect(reader.probedIds).toEqual(["C2", "C1"]);
    expect(result.moodle_raw_text).toContain("Selected: MEL1 Maschinenelemente 1");
    expect(result.moodle_raw_text).toContain("Confidence: high");
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));
    expect(artifact.selected).toMatchObject({
      label: "MEL1 Maschinenelemente 1",
      method: "model_evidence",
    });
    expect(reader.closed).toBe(true);
  });

  it("uses an exact dashboard code match with one token-free canonical-title probe and no model guessing", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 20, "MEL1 Maschinenelemente 1"),
    ];
    const reader = fakeReader(candidates, {});
    let modelCalls = 0;
    const codex: CodexClient = {
      async run() {
        modelCalls += 1;
        throw new Error("model should not run");
      },
    };
    const config = resolverConfig("Create a study guide for MEL");

    await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
    expect(reader.probedIds).toEqual(["C2"]);
    expect(modelCalls).toBe(0);
  });

  it("keeps the real title and subject code while removing flattened Moodle card metadata", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [candidate(
      "C1",
      32844,
      "BMR-VZ-2-SS2026-DYN2-DE Anwendungen der Dynamik LektorInnen: Fröhlich, Hainzl Ihre Rolle: TeilnehmerIn",
    )];
    const reader = fakeReader(candidates, {});
    reader.probeCourse = async (entry) => {
      reader.probedIds.push(entry.id);
      return { ...entry, title: "Kurs: Anwendungen der Dynamik | FHTW Moodle", text: "Punktkinematik" };
    };
    const config = resolverConfig("Erstelle einen Study Guide für DYN2.");

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));

    expect(result.moodle_raw_text).toContain("Course title: DYN2 – Anwendungen der Dynamik");
    expect(artifact.selected.title).toBe("DYN2 – Anwendungen der Dynamik");
    expect(artifact.selected.title).not.toMatch(/Lektor|Ihre Rolle/);
  });

  it("rejects invented model IDs and falls back to the strongest probed evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "General Engineering"),
      candidate("C2", 20, "Energy Systems"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Project management and technical communication",
      C2: "Thermal systems, heat transfer, thermodynamics and energy balances",
    });
    const codex = sequenceCodex([
      JSON.stringify({ candidate_ids: ["C1", "C2"], reasoning: "Both are plausible." }),
      JSON.stringify({
        selected_id: "C99",
        confidence: "high",
        reasoning: "Invented candidate",
        alternatives: [],
      }),
    ]);
    const config = resolverConfig("Find my thermal systems and heat transfer course");

    const result = await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[1].url]);
    expect(result.moodle_raw_text).toContain("Method: deterministic_evidence");
  });

  it("can resolve a generic description from live titles and probe evidence without an alias", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "MAES2 Mathematik für Engineering Science 2"),
      candidate("C2", 20, "DYN2 Anwendungen der Dynamik"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Differentialrechnung, Integralrechnung, lineare Algebra und Formelsammlung",
      C2: "Punktkinematik, Schwingungen und Drallsatz",
    });
    const config = resolverConfig("Create an interactive guide for my math exam");

    await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(reader.probedIds).toEqual(["C1", "C2"]);
  });

  it("persists an unseen non-technical course title from Moodle evidence", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "HUM-204 World Literature"),
      candidate("C2", 20, "BIO-110 Cell Biology"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Modernism, postcolonial fiction, close reading, seminar discussion and essays",
      C2: "Cell membranes, genetics and microscopy",
    });
    const codex = sequenceCodex([
      JSON.stringify({
        candidate_ids: ["C1", "C2"],
        reasoning: "World Literature is the direct subject match.",
      }),
      JSON.stringify({
        selected_id: "C1",
        confidence: "high",
        reasoning: "The page evidence covers literary analysis and the requested readings.",
        alternatives: [],
      }),
    ]);
    const config = resolverConfig(
      "Create an English study guide for my modern literature and close-reading course",
    );

    const result = await createCourseResolverNode(config, codex, { reader })();
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));

    expect(config.targetCourseUrls).toEqual([candidates[0].url]);
    expect(result.error_log).toBeNull();
    expect(result.moodle_raw_text).toContain("Course title: HUM-204 World Literature");
    expect(artifact.selected.title).toBe("HUM-204 World Literature");
  });

  it("blocks a low-confidence unknown-course guess instead of crawling the wrong class", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 10, "Introduction to Biology"),
      candidate("C2", 20, "Introduction to History"),
    ];
    const reader = fakeReader(candidates, {
      C1: "Weekly lectures and readings",
      C2: "Weekly lectures and readings",
    });
    const codex = sequenceCodex([
      JSON.stringify({ candidate_ids: ["C1", "C2"], reasoning: "Both are plausible." }),
      JSON.stringify({
        selected_id: "C1",
        confidence: "low",
        reasoning: "The request does not identify a subject.",
        alternatives: [{ id: "C2", reason: "Equally plausible." }],
      }),
    ]);
    const config = resolverConfig("Create a study guide for my class");

    const result = await createCourseResolverNode(config, codex, { reader })();
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    expect(artifact).toMatchObject({ selected: null, status: "ambiguous" });
  });

  it("rejects a numbered-course guess when the requested checkmark lists are absent", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("DYN", 11, "Physikalische Grundlagen der Dynamik"),
      candidate("MAES", 12, "Mathematik für Engineering Science 3"),
    ];
    const reader = fakeReader(candidates, {
      DYN: "Block 1: Translation. Block 3: Rotation. Block 8: Übungen. Block 9: Prüfung.",
      MAES: "Kreuzerlliste zu Themen 1–3. Kreuzerlliste zu Themen 8–9.",
    });
    let calls = 0;
    const codex: CodexClient = {
      async run() {
        calls += 1;
        if (calls === 1) return JSON.stringify({ candidate_ids: ["DYN"], reasoning: "Numbered blocks." });
        if (calls === 2) return JSON.stringify({
          selected_id: "DYN", confidence: "medium", reasoning: "Matching block numbers.", alternatives: [],
        });
        throw new Error("Further semantic search unavailable");
      },
    };
    const config = resolverConfig("Erstelle ein PDF aus den Kreuzerllisten der Themen 1–3 und 8–9.");

    const result = await createCourseResolverNode(config, codex, { reader })();

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));
    expect(artifact).toMatchObject({ selected: null, status: "ambiguous" });
    expect(artifact.detail).toContain("does not show the requested checkmark lists");
  });

  it("fits four long Moodle probes inside the analyzer budget before the model call", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 12, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 19, "PHDYN Physikalische Grundlagen der Dynamik"),
      candidate("C3", 17, "MAES2 Mathematik für Engineering Science 2"),
      candidate("C4", 31, "STA2 Anwendungen der Statik und Festigkeitslehre"),
    ];
    const longEvidence = Object.fromEntries(candidates.map((entry) => [
      entry.id,
      `STARTSEITE\n${entry.label}\n${"course evidence ".repeat(2_000)}`,
    ]));
    const prompts: string[] = [];
    const codex: CodexClient = {
      async run(prompt) {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return JSON.stringify({
            candidate_ids: candidates.map((entry) => entry.id),
            reasoning: "Four plausible courses.",
          });
        }
        return JSON.stringify({
          selected_id: "C1",
          confidence: "high",
          reasoning: "The course title and evidence match applications of dynamics.",
          alternatives: [{ id: "C2", reason: "Related foundations course." }],
        });
      },
    };
    const config = resolverConfig(
      "Ich muss mich für meine kommende Dynamikprüfung vorbereiten.",
    );

    await createCourseResolverNode(config, codex, {
      reader: fakeReader(candidates, longEvidence),
    })();

    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.length).toBeLessThanOrEqual(
      resolveModelPromptBodyCharacterBudget("content_analyzer", {
        type: "object",
        additionalProperties: false,
        required: ["selected_id", "confidence", "reasoning", "alternatives"],
        properties: {
          selected_id: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reasoning: { type: "string" },
          alternatives: {
            type: "array",
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "reason"],
              properties: { id: { type: "string" }, reason: { type: "string" } },
            },
          },
        },
      }) - 1_024,
    );
    expect(prompts[1]).not.toContain("STARTSEITE");
    expect(config.targetCourseUrls).toEqual([candidates[0]!.url]);
  });

  it("retries one rejected evidence request with a smaller course signature", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 12, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 19, "PHDYN Physikalische Grundlagen der Dynamik"),
    ];
    const prompts: string[] = [];
    const codex: CodexClient = {
      async run(prompt) {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return JSON.stringify({ candidate_ids: ["C1", "C2"], reasoning: "Both are plausible." });
        }
        if (prompts.length === 2) {
          throw new NonRetryableCodexError(
            "content_analyzer request exceeds its character budget",
            "invalid_request",
          );
        }
        return JSON.stringify({
          selected_id: "C1",
          confidence: "high",
          reasoning: "DYN2 is the requested applications course.",
          alternatives: [{ id: "C2", reason: "Foundations rather than applications." }],
        });
      },
    };
    const evidence = {
      C1: `Punktkinematik\n${"Dynamik resource ".repeat(2_000)}`,
      C2: `Newtonsche Grundlagen\n${"physics resource ".repeat(2_000)}`,
    };

    await createCourseResolverNode(
      resolverConfig("Study Guide für meine Dynamikprüfung"),
      codex,
      { reader: fakeReader(candidates, evidence) },
    )();

    expect(prompts).toHaveLength(3);
    expect(prompts[2]!.length).toBeLessThan(prompts[1]!.length);
    expect(prompts[2]!.length).toBeLessThanOrEqual(24_000);
  });

  it("fails closed when deterministic evidence cannot distinguish two dynamics courses", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 12, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 19, "PHDYN Physikalische Grundlagen der Dynamik"),
      candidate("C3", 17, "MAES2 Mathematik für Engineering Science 2"),
    ];
    let calls = 0;
    const codex: CodexClient = {
      async run() {
        calls += 1;
        if (calls === 1) {
          return JSON.stringify({ candidate_ids: ["C1", "C2", "C3"], reasoning: "Candidates." });
        }
        throw new Error("semantic selector unavailable");
      },
    };
    const config = resolverConfig("Ich lerne für meine Dynamikprüfung.");

    const result = await createCourseResolverNode(config, codex, {
      reader: fakeReader(candidates, {
        C1: "Punktkinematik und Drallsatz",
        C2: "Newtonsche Axiome und Kinematik",
        C3: "Integralrechnung",
      }),
    })();

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));
    expect(artifact).toMatchObject({ selected: null, status: "ambiguous" });
    expect(artifact.alternatives.map((entry: { label: string }) => entry.label)).toEqual(
      expect.arrayContaining([
        "DYN2 Anwendungen der Dynamik",
        "PHDYN Physikalische Grundlagen der Dynamik",
      ]),
    );
  });

  it("does not let a medium-confidence model guess choose between two requested dynamics courses", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const candidates = [
      candidate("C1", 12, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 19, "PHDYN Physikalische Grundlagen der Dynamik"),
    ];
    const prompt = [
      "Ich muss mich für meine kommende Dynamikprüfung im nächsten Monat vorbereiten.",
      "Ich hätte gerne einen interaktiven Study Guide und ein PDF mit den Key Punkten,",
      "Berechnungsarten, Formelherleitungen und dem nötigen Grundverständnis.",
    ].join(" ");
    const codex = sequenceCodex([
      JSON.stringify({
        candidate_ids: ["C1", "C2"],
        reasoning: "Both dynamics courses are plausible.",
      }),
      JSON.stringify({
        selected_id: "C2",
        confidence: "medium",
        reasoning: "The word Grundverständnis weakly favors the foundations course.",
        alternatives: [{ id: "C1", reason: "The applications course is also relevant." }],
      }),
    ]);
    const config = resolverConfig(prompt);

    const result = await createCourseResolverNode(config, codex, {
      reader: fakeReader(candidates, {
        C1: "Punktkinematik, Schwerpunktsatz, Drallsatz und Schwingungen",
        C2: "Translation, Rotation, Arbeit, Energie und Kinematik",
      }),
    })();

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toMatch(/^Course resolution ambiguous:/);
    const artifact = JSON.parse(await readFile(path.join(runDir, "course-resolution.json"), "utf8"));
    expect(artifact).toMatchObject({ selected: null, status: "ambiguous" });
    expect(artifact.alternatives.map((entry: { label: string }) => entry.label)).toEqual(
      expect.arrayContaining([
        "DYN2 Anwendungen der Dynamik",
        "PHDYN Physikalische Grundlagen der Dynamik",
      ]),
    );
  });

  it("fails closed when dashboard discovery itself fails", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([], {});
    reader.readDashboard = async () => {
      throw new Error("Custom Moodle theme did not expose a readable course list");
    };
    const config = resolverConfig("Create a study guide for World Literature");

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(config.targetCourseUrls).toBeUndefined();
    expect(result.error_log).toBe(
      "Course resolution failed: Custom Moodle theme did not expose a readable course list",
    );
    expect(result.moodle_raw_text).toContain("Course discovery failed");
    expect(reader.closed).toBe(true);
  });

  it("skips discovery when a direct course URL is already known", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([], {});
    const config = resolverConfig("Build a guide from this course");
    config.moodleUrl = "https://moodle.example/course/view.php?id=42";

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result).toEqual({ error_log: null });
    expect(reader.dashboardReads).toBe(0);
  });

  it("skips discovery when a direct Moodle activity URL is already known", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([], {});
    const config = resolverConfig("Build a guide from this exact resource");
    config.moodleUrl = "https://moodle.example/mod/resource/view.php?id=2186227";

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result).toEqual({ error_log: null });
    expect(reader.dashboardReads).toBe(0);
    expect(config.targetCourseUrls).toBeUndefined();
  });

  it("keeps the dashboard scope for cross-course quiz discovery", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "course-resolver-"));
    const reader = fakeReader([
      candidate("C1", 10, "DYN2 Anwendungen der Dynamik"),
      candidate("C2", 20, "MAES2 Mathematik"),
    ], {});
    const config = resolverConfig("Find open quizzes and self-checks across all Moodle courses");
    config.intentDecision = {
      ...config.intentDecision!,
      intent: "quiz_assist",
      wantsQuizAssistance: true,
      wantsQuizDiscovery: true,
      wantsQuickAnswer: true,
    };

    const result = await createCourseResolverNode(config, sequenceCodex([]), { reader })();

    expect(result).toEqual({ error_log: null });
    expect(reader.dashboardReads).toBe(0);
    expect(config.targetCourseUrls).toBeUndefined();
  });
});

function resolverConfig(prompt: string) {
  return moodleTestConfig({
    prompt,
    runDir: runDir!,
    moodleUrl: "https://moodle.example/my/",
    dashboardUrl: "https://moodle.example/my/",
    sourcePlan: sourcePlan(),
  });
}

function sourcePlan(): SourcePlan {
  return {
    targets: ["moodle"],
    confidence: "high",
    reason: "Course materials requested.",
    needsCurrentScheduleData: false,
    needsCourseMaterial: true,
    needsFiles: true,
    needsQuizOrAssignment: false,
    allowFollowUpCrawl: true,
  };
}

function candidate(id: string, moodleId: number, label: string): CourseCandidate {
  return {
    id,
    url: `https://moodle.example/course/view.php?id=${moodleId}`,
    label,
  };
}

function fakeReader(
  candidates: CourseCandidate[],
  evidence: Record<string, string>,
): CourseCatalogReader & {
  dashboardReads: number;
  probedIds: string[];
  closed: boolean;
} {
  return {
    dashboardReads: 0,
    probedIds: [],
    closed: false,
    async readDashboard() {
      this.dashboardReads += 1;
      return candidates;
    },
    async probeCourse(entry): Promise<CourseProbe> {
      this.probedIds.push(entry.id);
      return {
        ...entry,
        title: entry.label,
        text: evidence[entry.id] ?? entry.label,
      };
    },
    async close() {
      this.closed = true;
    },
  };
}
