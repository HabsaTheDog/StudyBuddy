import { describe, expect, it } from "vitest";
import { buildFormatterPrompt } from "../nodes/formatterNode.js";
import { buildQualityReviewPrompt } from "../nodes/qualityReviewerNode.js";
import { moodleExtractedData, moodleTestConfig, moodleTestState, studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("request-level source evidence survives chapter and renderer boundaries", () => {
  const announcement = "Assessment 1 on 5 October 2026: Relative motion, Block 2.";
  const extracted = {
    ...moodleExtractedData({ warnings: ["Chapter «Methods»: This chapter packet contains no assessment announcement."] }),
    document_context: [{
      source_id: "assessment-source", title: "Selected assessment", url: "https://example.edu/assessment/1",
      records: [{ record_id: "announcement-record", locator: { section: "Current announcements" }, excerpt: announcement }],
      omitted_records: 2,
    }],
  };
  const config = moodleTestConfig({ prompt: "Prepare for my first assessment.", originalUserPrompt: "Prepare for my first assessment." });

  it.each([false, true])("preserves positive source excerpts and provenance in PDF authoring (repair=%s)", (repair) => {
    const prompt = buildFormatterPrompt(config, moodleTestState({ extracted_data: extracted,
      ...(repair ? { final_document: studyBuddyTypstDocument(), error_log: "Resolve the source-evidence contradiction." } : {}) }));
    expect(prompt).toContain(announcement);
    expect(prompt).toContain("announcement-record");
    expect(prompt).toContain("Current announcements");
    expect(prompt).toContain("https://example.edu/assessment/1");
    expect(prompt).toContain("absence of a calendar entry");
    expect(prompt).toContain("exclusive or complete assessment coverage");
    expect(prompt).toContain("chapter-local");
  });

  it("reviews global negative claims against positive source records rather than a local packet gap", () => {
    const prompt = buildQualityReviewPrompt(config, moodleTestState({ extracted_data: extracted }));
    expect(prompt).toContain(announcement);
    expect(prompt).toContain("announcement-record");
    expect(prompt).toContain("omitted_records");
    expect(prompt).toContain("absence of a calendar entry");
    expect(prompt).toContain("factual_error");
    expect(prompt).toContain("exclusive or complete assessment coverage");
  });
});
