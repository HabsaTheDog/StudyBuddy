import { describe, expect, it } from "vitest";
import {
  assertSafeClick,
  browserRefSelector,
  extractLinksFromSnapshot,
  snapshotToText,
} from "../browserSafety.js";

describe("browserSafety", () => {
  it("extracts refs and urls from agent-browser snapshots", () => {
    const links = extractLinksFromSnapshot(
      '- link "Course" [ref=e1, url=https://moodle.example/course/view.php?id=1]',
      {
        e1: { role: "link", name: "Course" },
      },
    );

    expect(links).toEqual([
      {
        ref: "e1",
        href: "https://moodle.example/course/view.php?id=1",
        label: "Course",
        role: "link",
      },
    ]);
  });

  it("prefers authoritative structured hrefs over display labels", () => {
    const links = extractLinksFromSnapshot('- link "ET2-DE/165657" [ref=sb1]', {
      sb1: {
        role: "link",
        name: "ET2-DE/165657",
        href: "https://moodle.example/course/view.php?id=32897",
      },
    });

    expect(links[0]?.href).toBe("https://moodle.example/course/view.php?id=32897");
  });

  it("normalizes stored browser refs for click APIs", () => {
    expect(browserRefSelector("sb1")).toBe("@sb1");
    expect(browserRefSelector("@sb1")).toBe("@sb1");
  });

  it("blocks final submit controls", () => {
    expect(() => assertSafeClick("Submit all and finish")).toThrow(
      /Blocked final Moodle submission/,
    );
    expect(() => assertSafeClick("Alles abgeben und beenden")).toThrow(
      /Blocked final Moodle submission/,
    );
  });

  it("allows ordinary submit-like controls in open workflow mode", () => {
    expect(() => assertSafeClick("Submit")).not.toThrow();
  });

  it("converts snapshots to readable fallback text", () => {
    expect(
      snapshotToText(
        '- heading "Moodle Login" [level=1, ref=e11]\n  - textbox "Username" [ref=e12]\n  - link "Course" [ref=e1, url=https://moodle.example/course]',
      ),
    ).toContain('textbox "Username"');
  });

  it("allows safe Moodle navigation controls", () => {
    expect(() => assertSafeClick("Weiter")).not.toThrow();
    expect(() => assertSafeClick("Versuch beenden …")).not.toThrow();
    expect(() => assertSafeClick("Versuch abschließen ...")).not.toThrow();
    expect(() => assertSafeClick("Finish attempt ...")).not.toThrow();
  });
});
