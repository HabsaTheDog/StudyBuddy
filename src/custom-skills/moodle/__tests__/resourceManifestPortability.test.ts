import { describe, expect, it } from "vitest";
import { resourcesFromSnapshot } from "../resourceManifest.js";

describe("portable Moodle resource manifests", () => {
  it("preserves arbitrary English course section names and their resource order", () => {
    const resources = resourcesFromSnapshot({
      origin: "https://portal.example.edu/learning/moodle/course/view.php?id=204",
      refs: {
        r1: { role: "link", name: "Modernism Reader" },
        r2: { role: "link", name: "Essay Planning Workshop" },
      },
      snapshot: [
        '- heading "Course: HUM-204 World Literature | Example University Moodle" [level=1]',
        '- heading "Primary navigation" [level=2]',
        '- button "Unit 1 — Modernism and Narrative Voice" [expanded=true]',
        '- link "Modernism Reader" [ref=r1, url=https://portal.example.edu/learning/moodle/mod/resource/view.php?id=8]',
        '- heading "Unit 2 — Colonial Narratives and Historical Context" [level=2]',
        '- link "Essay Planning Workshop" [ref=r2, url=https://portal.example.edu/learning/moodle/mod/page/view.php?id=9]',
      ].join("\n"),
    });

    expect(resources.find((resource) => resource.title === "Modernism Reader")?.sectionPath)
      .toEqual(["Unit 1 — Modernism and Narrative Voice"]);
    expect(resources.find((resource) => resource.title === "Essay Planning Workshop")?.sectionPath)
      .toEqual(["Unit 2 — Colonial Narratives and Historical Context"]);
    expect(resources.flatMap((resource) => resource.sectionPath)).not.toContain("Primary navigation");
  });
});
