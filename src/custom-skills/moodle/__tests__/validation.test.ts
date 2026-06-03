import { describe, expect, it } from "vitest";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";
import { moodleExtractedData } from "./support/moodleTestBlocks.js";

describe("validation", () => {
  it("parses fenced JSON", () => {
    expect(parseJsonObjectOrArray("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });

  it("validates extracted data", () => {
    expect(() => validateExtractedData(moodleExtractedData())).not.toThrow();
  });
});
