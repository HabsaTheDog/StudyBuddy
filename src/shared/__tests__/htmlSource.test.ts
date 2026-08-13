import { describe, expect, it } from "vitest";
import { inspectHtmlSource, replaceHtmlSourceRanges } from "../htmlSource.js";

describe("HTML source inspection", () => {
  it("uses browser-compatible parsing for malformed raw-text end tags", () => {
    const html = '<!doctype html><html><head><style>.ok{color:green}</style ignored></head><body><<script>alert(1)</script data-bypass></body></html>';
    const document = inspectHtmlSource(html);
    const rawTextElements = document.elements.filter((element) =>
      element.tagName === "style" || element.tagName === "script"
    );

    expect(document.hasDoctype).toBe(true);
    expect(rawTextElements.map((element) => element.tagName)).toEqual(["style", "script"]);
    expect(rawTextElements.every((element) => element.hasEndTag)).toBe(true);
    expect(html.slice(rawTextElements[1].contentStartOffset, rawTextElements[1].contentEndOffset))
      .toBe("alert(1)");
  });

  it("applies non-overlapping replacements without reparsing or exposing nested tags", () => {
    const html = "before<<script>alert(1)</script ignored>after";
    const script = inspectHtmlSource(html).elements.find((element) => element.tagName === "script");
    expect(script).toBeDefined();

    const sanitized = replaceHtmlSourceRanges(html, [{
      startOffset: script!.startOffset,
      endOffset: script!.endOffset,
      value: "<!-- removed -->",
    }]);

    expect(sanitized).toContain("<!-- removed -->after");
    expect(inspectHtmlSource(sanitized).elements.some((element) => element.tagName === "script"))
      .toBe(false);
  });
});
