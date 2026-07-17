import { describe, expect, it } from "vitest";
import { resourceTitleMatchesAnalyzerError } from "../nodes/analyzerNode.js";

describe("chapter analyzer repair routing", () => {
  it("maps compound chapter names to related formula findings", () => {
    const finding = "Die Formel Erforderliche Nietzahl aus Abscheren ist intern widersprüchlich.";

    expect(resourceTitleMatchesAnalyzerError("Foliensatz: Nietverbindung", finding)).toBe(true);
    expect(resourceTitleMatchesAnalyzerError("Foliensatz: Kleben", finding)).toBe(false);
    expect(resourceTitleMatchesAnalyzerError("Foliensatz: Tribologie", finding)).toBe(false);
  });
});
