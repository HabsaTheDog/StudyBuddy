import { describe, expect, it } from "vitest";
import { sanitizeUnicode } from "../codexClient.js";

describe("Codex prompt Unicode sanitization", () => {
  it("preserves valid surrogate pairs and replaces lone surrogates", () => {
    expect(sanitizeUnicode(`A😀B${String.fromCharCode(0xD835)}C${String.fromCharCode(0xDC00)}D`))
      .toBe("A😀B�C�D");
  });
});
