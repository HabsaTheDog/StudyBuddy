import { describe, expect, it } from "vitest";
import { buildFormatterPrompt } from "../nodes/formatterNode.js";
import { buildQualityReviewPrompt } from "../nodes/qualityReviewerNode.js";
import { moodleExtractedData, moodleTestConfig, moodleTestState, studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("source-grounded assessment scoring prompts", () => {
  const originalUserPrompt = "Prepare source-grounded practice for my next assessment.";
  const config = moodleTestConfig({ prompt: originalUserPrompt, originalUserPrompt, outputLanguage: "en" });
  const extracted = moodleExtractedData({
    sections: [{ heading: "Documented assessment", summary: "The original source task carries 12 official points.",
      key_concepts: ["Apply the source method."], source_ids: ["source-task"] }],
  });

  it.each([false, true])("prevents invented exercise points in initial/repair authoring (repair=%s)", (repair) => {
    const prompt = buildFormatterPrompt(config, moodleTestState({
      extracted_data: extracted,
      ...(repair ? { final_document: studyBuddyTypstDocument(), error_log: "Review: remove unsupported exercise scores." } : {}),
    }));

    expect(prompt).toContain("Never invent point allocations");
    expect(prompt).toContain("no point badges or totals");
    expect(prompt).toContain("exact official allocation for the reproduced source task");
    expect(prompt).toContain("explicitly documented and cited");
    expect(prompt).toContain("Study Buddy-derived/generated tasks");
    expect(prompt).toContain("non-official percentage self-rating");
    expect(prompt).toContain(originalUserPrompt);
    expect(prompt).toContain("#sb-exercise(number: ..., title: ..., difficulty: ...)[...]");
    expect(prompt).not.toContain("#sb-exercise(number: ..., title: ..., difficulty: ..., points: ...)[...]");
    if (!repair) expect(prompt).toContain("12 official points");
  });

  it("reviews grading provenance while preserving official source scoring and respecting the handoff boundary", () => {
    const prompt = buildQualityReviewPrompt(config, moodleTestState({ extracted_data: extracted }));

    expect(prompt).toContain("Never invent point allocations");
    expect(prompt).toContain("exact official allocation for the reproduced source task");
    expect(prompt).toContain("explicitly documented and cited");
    expect(prompt).toContain("Unsupported claims of official grading are factual contradictions");
    expect(prompt).toContain("Do not speculate about scoring absent from this extraction handoff");
    expect(prompt).toContain("Study Buddy-derived/generated tasks");
  });
});
