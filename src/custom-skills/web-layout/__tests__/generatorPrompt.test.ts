import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { buildGeneratorPrompt, createGeneratorNode } from "../nodes/generatorNode.js";
import { initialWebLayoutState } from "../state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generator prompt", () => {
  it("renders English study guides deterministically without a model call", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-english-study-guide-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build an English mechanics study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    let modelCalls = 0;
    const source = { label: "Mechanics notes", sourceTask: "Chapter 1", provenance: "source" as const };
    const exercise = {
      id: "mechanics-check-1",
      type: "cross" as const,
      prompt: "Which statement correctly describes force equilibrium?",
      selectionMode: "single" as const,
      options: [
        { text: "The force sum is zero.", correct: true, feedback: "Correct." },
        { text: "Every force is individually zero.", correct: false, feedback: "Forces may cancel." },
      ],
      explanation: "Equilibrium requires the vector sum of all forces to be zero.",
      source,
    };
    const result = await createGeneratorNode(config, {
      run: async () => {
        modelCalls += 1;
        throw new Error("The English study-guide renderer must not call the model.");
      },
    })({
      ...initialWebLayoutState,
      study_guide_content: {
        courseTitle: "Engineering Mechanics",
        courseCode: "MECH",
        scopeNote: "Covers the supplied equilibrium material.",
        topics: [{
          id: "equilibrium",
          title: "Force Equilibrium",
          learningGoals: ["Recognize equilibrium conditions."],
          theory: {
            summary: "Force equilibrium means that the vector sum of every external force acting on a body is zero, so its linear acceleration is zero.",
            keyIdeas: ["Forces are vectors.", "Balanced forces may be nonzero."],
            formulas: [{ expression: "ΣF = 0", meaning: "Force equilibrium" }],
          },
          workedExamples: [{
            title: "Balanced load",
            prompt: "Determine whether two opposite forces are balanced.",
            steps: ["Choose a positive direction.", "Add the signed force components."],
            answer: "The resultant force is zero.",
            source,
          }],
          exercises: [
            exercise,
            { ...exercise, id: "mechanics-check-2" },
            { ...exercise, id: "mechanics-check-3" },
          ],
          retrieval: [{ prompt: "What is the equilibrium condition?", answer: "The vector force sum is zero." }],
        }],
        sources: [{ id: "mechanics", label: "Mechanics notes", url: "", coverage: "Force equilibrium" }],
      },
    });

    expect(modelCalls).toBe(0);
    expect(result.error_log).toBeNull();
    expect(result.html_document).toContain('<html lang="en">');
    expect(result.html_document).toContain('name="study-buddy-renderer" content="adaptive-study-guide-v2"');
    expect(result.html_document).toContain("Engineering Mechanics");
    expect(result.html_document).toContain("Question catalogue");
    expect(result.html_document).toContain("Theory and topic practice");
    expect(result.html_document).toContain("Start exam mode");
    expect(result.html_document).toContain("Continue learning");
    expect(result.html_document).not.toContain("Start with unseen questions");
    expect(result.html_document).toContain("Check answer");
    expect(result.html_document).toContain("Course original");
    expect(result.html_document).not.toContain("Dein Kurs als Lernsystem");
    expect(result.html_document).not.toContain("Antwort auswerten");
  });

  it("renders open applications as persistent draft-and-self-check workspaces", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-application-guide-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a World Literature study guide",
      kind: "study-guide",
      language: "en",
      runDir,
    });
    const source = {
      label: "Modernism Reader",
      sourceTask: "Chapter 2: Narrative voice",
      provenance: "source" as const,
    };
    const application = {
      id: "close-reading-1",
      type: "application" as const,
      prompt: "Compare how two passages restrict the reader's access to the narrator's motives.",
      instructions: [
        "Mark one textual observation in each passage.",
        "Explain how each observation supports a different interpretation.",
      ],
      sampleAnswer: "Passage A withholds motive through free indirect discourse, while passage B names the motive explicitly; the first therefore supports a more ambiguous interpretation.",
      selfCheck: [
        "The response distinguishes observation from interpretation.",
        "Both claims cite a concrete feature of the passages.",
      ],
      source,
    };
    const result = await createGeneratorNode(config, {
      run: async () => {
        throw new Error("The standardized renderer must not call the model.");
      },
    })({
      ...initialWebLayoutState,
      study_guide_content: {
        courseTitle: "HUM-204 World Literature",
        courseCode: "HUM-204",
        scopeNote: "Covers the supplied Modernism reader.",
        topics: [{
          id: "modernism",
          title: "Modernism and narrative voice",
          learningGoals: ["Support an interpretation with textual evidence."],
          theory: {
            summary: "Close reading separates what a passage explicitly presents from the interpretation a reader builds from narrative voice, form, and historical context.",
            keyIdeas: ["Observation comes before interpretation.", "Competing readings require comparative evidence."],
            formulas: [],
          },
          workedExamples: [{
            title: "Comparing two narrators",
            prompt: "Which details make one narrator appear less reliable?",
            steps: ["Identify contradictions.", "Compare them with external events in the passage."],
            answer: "The contradictions weaken the narrator's reliability.",
            source,
          }],
          exercises: [
            application,
            { ...application, id: "close-reading-2" },
            { ...application, id: "close-reading-3" },
          ],
          retrieval: [{
            prompt: "What comes before interpretation?",
            answer: "A precise textual observation.",
          }],
        }],
        sources: [{
          id: "reader",
          label: "Modernism Reader",
          url: "https://portal.example.edu/moodle/mod/resource/view.php?id=8",
          coverage: "Narrative voice and close reading",
        }],
      },
    });

    expect(result.error_log).toBeNull();
    expect(result.html_document).toContain("data-sb-application-exercise");
    expect(result.html_document).toContain("data-application-draft");
    expect(result.html_document).toContain("Compare with example and criteria");
    expect(result.html_document).toContain("The response distinguishes observation from interpretation.");
    expect(result.html_document).toContain("localStorage");
  });

  it("contains Study Buddy design tokens and single-file rules", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-prompt-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build flashcards",
      kind: "flashcards",
      runDir,
    });
    const prompt = buildGeneratorPrompt(config, {
      source_text: "source",
      layout_spec: { title: "Demo" },
      html_document: "",
      validation_report: {},
      error_log: null,
    });

    expect(prompt).toContain("--sb-navy: #19254b");
    expect(prompt).toContain("--sb-gold: #dfbb63");
    expect(prompt).toContain("No <script src>");
    expect(prompt).toContain("assets/logo.png");
    expect(prompt).toContain("Do not display legacy prototype marks");
    expect(prompt).toContain("one coherent primary learning interaction");
    expect(prompt).toContain("do not build citations or source-management controls");
    expect(prompt).toContain("not from a broad subject label");
    expect(prompt).toContain("Rules, policy, business, and economics");
    expect(prompt).toContain("Biomedical or medical material");
    expect(prompt).toContain("flashcards may be primary only when higher-order application is not supported");
    expect(prompt).toContain("Never award exam credit for unrestricted free text");
    expect(prompt).toContain("native semantic MathML");
    expect(prompt).toContain("never expose raw TeX, Typst, or ASCII approximations");
  });

  it("defines a coherent integrated study-guide mode", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-study-guide-prompt-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Build a complete mathematics study guide",
      kind: "study-guide",
      runDir,
    });
    const prompt = buildGeneratorPrompt(config, {
      source_text: "source",
      layout_spec: { title: "Mathematics" },
      html_document: "",
      validation_report: {},
      error_log: null,
    });

    expect(prompt).toContain("course-dependent study guide, not a quiz dashboard");
    expect(prompt).toContain("data-sb-learning-content");
    expect(prompt).toContain("data-sb-practice");
    expect(prompt).toContain("data-sb-progress");
    expect(prompt).toContain("sticky top hotbar marked data-sb-hotbar");
    expect(prompt).toContain("data-sb-cross-exercise");
    expect(prompt).toContain("data-sb-calculation-exercise");
    expect(prompt).toContain("Do not use a persistent left sidebar");
    expect(prompt).not.toContain("Implement one coherent primary learning interaction");
  });

  it("uses a staged file for repairs instead of placing the complete HTML in the prompt", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-repair-prompt-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({
      prompt: "Repair the guide",
      kind: "worksheet",
      runDir,
    });
    const prompt = buildGeneratorPrompt(config, {
      source_text: "source",
      layout_spec: { title: "Guide" },
      html_document: '<!doctype html><img src="data:image/png;base64,QUJDREVGRw=="><script>function keepMe(){}</script>',
      validation_report: { ok: false },
      error_log: "Answer persistence is broken.",
    });

    expect(prompt).toContain(".repair/document.html");
    expect(prompt).toContain("edit only .repair/document.html");
    expect(prompt).not.toContain("function keepMe(){}");
    expect(prompt).not.toContain("QUJDREVGRw==");
  });

  it("rejects a status message when the staged repair artifact was not modified", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-incomplete-response-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Repair the guide", kind: "worksheet", runDir });
    const result = await createGeneratorNode(config, {
      run: async () => "I updated the requested files and the guide is ready.",
    })({
      ...initialWebLayoutState,
      html_document: "<!doctype html><html><head><style></style></head><body><script></script></body></html>",
      error_log: "Repair one interaction.",
    });

    expect(result.html_document).toBeUndefined();
    expect(result.error_log).toContain("did not modify the staged repair artifact");
    expect(result.generator_retry_count).toBe(1);
  });

  it("loads a complete in-place repair without requiring the model to emit the full document", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-layout-staged-repair-"));
    tempDirs.push(runDir);
    const config = createWebLayoutRuntimeConfig({ prompt: "Repair the guide", kind: "worksheet", runDir });
    const original = "<!doctype html><html><head><style></style></head><body><main>Old</main><script></script></body></html>";
    const repaired = original.replace("Old", "Repaired");
    const result = await createGeneratorNode(config, {
      run: async () => {
        await writeFile(path.join(runDir, ".repair", "document.html"), repaired, "utf8");
        return "UPDATED_DOCUMENT_HTML";
      },
    })({
      ...initialWebLayoutState,
      html_document: original,
      error_log: "Repair the visible heading.",
    });

    expect(result.error_log).toBeNull();
    expect(result.html_document).toContain("Repaired");
    await expect(readFile(path.join(runDir, ".repair", "document.html"), "utf8")).resolves.toBe(repaired);
  });
});
