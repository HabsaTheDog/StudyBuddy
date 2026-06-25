import { describe, expect, it } from "vitest";
import { minimalValidStudyBuddyHtml, stripHtmlFence } from "../htmlShell.js";

describe("HTML shell helpers", () => {
  it("strips markdown HTML fences", () => {
    expect(stripHtmlFence("```html\n<!doctype html>\n```")).toBe("<!doctype html>");
  });

  it("includes Study Buddy branding and tokens", () => {
    const html = minimalValidStudyBuddyHtml({ title: "Demo", kind: "flashcards", language: "de" });

    expect(html).toContain("STUDY BUDDY 2.0");
    expect(html).toContain("SB 2.0");
    expect(html).toContain("--sb-navy");
    expect(html).toContain("--sb-gold");
  });
});
