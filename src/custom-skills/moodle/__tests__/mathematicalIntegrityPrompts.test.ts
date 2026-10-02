import { describe, expect, it } from "vitest";
import { buildAnalyzerPrompt, buildChapterFragmentPrompt } from "../nodes/analyzerNode.js";
import { buildFormatterPrompt } from "../nodes/formatterNode.js";
import { buildQualityReviewPrompt } from "../nodes/qualityReviewerNode.js";
import { STUDENT_FIRST_POLICY } from "../studentFirstPolicy.js";
import { studyBuddyTemplatePromptReference } from "../typstTemplate.js";
import { moodleExtractedData, moodleTestConfig, moodleTestState, studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

function expectMathematicalIntegrity(prompt: string) {
  expect(prompt).toContain("necessary conditions from sufficient conditions");
  expect(prompt).toContain("counterexamples");
  expect(prompt).toContain("zero, boundary, parallel, orthogonal and singular cases");
  expect(prompt).toContain("scalar, vector and matrix types");
  expect(prompt).toContain("state the assumptions");
  expect(prompt).toContain("Typst math `times` renders ×");
  expect(prompt).toContain("nonzero parallel vectors can have a zero cross product");
  expect(prompt).toContain("Do not reject an operator solely because of its Typst token");
  expect(prompt).toContain("Every generated task must be feasible under its stated assumptions");
  expect(prompt).toContain("Solve with unchanged givens");
  expect(prompt).toContain("label hypothetical changes explicitly");
  expect(prompt).toContain("never as solutions within those givens");
  expect(prompt).toContain("An instantaneous function value does not determine its derivative");
  expect(prompt).toContain("a value at one instant from an identity over an interval");
  expect(prompt).toContain("computed signs, vector directions, term names and meaning");
  expect(prompt).toContain("stated reference frame and sign convention");
  expect(prompt).toContain("Distinguish descriptions of motion from real forces and frame-dependent apparent forces");
  expect(prompt).toContain("State and reconcile differing source conventions");
  expect(prompt).toContain("do not silently reuse a label with an incompatible formula or direction");
  expect(prompt).toContain("A derivative does not determine a function value or integration constants without initial or boundary conditions");
  expect(prompt).toContain("Before claiming a unique result, verify that the givens determine every requested quantity");
  expect(prompt).toContain("otherwise show the parameterized family or name the missing condition");
  expect(prompt).toContain("Each zero/shortcut condition on a varying quantity must state at its occurrence");
  expect(prompt).toContain("one point/instant or throughout an interval");
  expect(prompt).toContain("Retain derivative terms unless that derivative is separately zero or proven zero by the stated interval identity");
  expect(prompt).toContain("A global warning cannot repair a false local table/checklist/formula claim");
}

describe("shared mathematical integrity prompt contract", () => {
  const config = moodleTestConfig({ prompt: "Explain source-backed mathematical methods.", outputLanguage: "en" });
  it("anchors condition, operator and boundary checks in the central student policy", () => {
    expectMathematicalIntegrity(STUDENT_FIRST_POLICY);
  });
  it.each([false, true])("carries the same integrity rules through initial/repair PDF authoring: %s", (repair) => {
    const prompt = buildFormatterPrompt(config, moodleTestState({ extracted_data: moodleExtractedData(),
      ...(repair ? { final_document: studyBuddyTypstDocument(), error_log: "A claimed sufficient condition has a counterexample." } : {}) }));
    expectMathematicalIntegrity(prompt);
  });
  it("carries the integrity contract through whole-request analysis", async () => {
    expectMathematicalIntegrity(await buildAnalyzerPrompt(config, moodleTestState()));
  });
  it("carries the integrity contract through focused fragment analysis and repair", () => {
    const prompt = buildChapterFragmentPrompt(config, moodleTestState(),
      { key: "methods", title: "Mathematical Methods", resourceIds: [], matchTerms: [] },
      { key: "methods", label: "Source method", resourceIds: [], records: [] }, 0, 1, null, [],
      "Semantic quality review failed:\n- [chapter: Mathematical Methods] A sufficient-condition claim is false.");
    expectMathematicalIntegrity(prompt);
  });
  it.each([false, true])("uses the same feasibility, givens and derivative contract in the existing reviewer (repair=%s)", repair => {
    expectMathematicalIntegrity(buildQualityReviewPrompt(config, moodleTestState({ extracted_data: moodleExtractedData() }),
      repair ? "A derived solution changed the task's given assumptions." : null));
  });
  it("documents approved table arities using concrete complete rows", () => {
    const prompt = studyBuddyTemplatePromptReference("en");
    expect(prompt).toContain('#sb-key-value-table((("Property", "Value"),))');
    expect(prompt).toContain('#sb-comparison-table((("Criterion", "Option A", "Option B"),))');
    expect(prompt).toContain('#sb-schedule-table((("00–10 min", "Recall", "Explain the method", "Checked notes"),))');
    expect(prompt).toContain("exactly four cells in the order Time, Phase, Activity, Result");
    expect(prompt).toContain("Every generic sb-table row must match the declared column count");
  });
});
