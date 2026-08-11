import { describe, expect, it } from "vitest";
import {
  deriveStudyGuideRequirements,
  handoffSectionGroups,
  knownHandoffSourceUrls,
} from "../studyGuideProfile.js";

function handoff(value: Record<string, unknown>): string {
  return `# User prompt\nCreate a guide\n\n## Extracted data\n${JSON.stringify(value)}\n\n## Source coverage\n{}`;
}

describe("open study-guide structure", () => {
  it("preserves course modules without assigning a subject archetype or content quotas", () => {
    const source = handoff({
      document_title: "DYN2 – Interaktiver Study Guide",
      course: { title: "Anwendungen der Dynamik" },
      sections: [
        { heading: "Punktkinematik", source_ids: ["dyn_ch1_res_a"] },
        { heading: "Drallsatz", source_ids: ["dyn_ch2_res_b"] },
      ],
      learning_modules: [
        { id: "m1", title: "Punktkinematik", content_mode: "mixed" },
        { id: "m2", title: "Drallsatz", content_mode: "mixed" },
      ],
    });

    const requirements = deriveStudyGuideRequirements(source);

    expect(requirements.sectionTitles).toEqual(["Punktkinematik", "Drallsatz"]);
    expect(Object.keys(requirements).sort()).toEqual([
      "courseCode",
      "courseTitle",
      "sectionTitles",
    ]);
  });

  it("does not infer different pedagogy from course names", () => {
    const dynamics = deriveStudyGuideRequirements(handoff({
      course: { title: "Dynamics" },
      learning_modules: [{ id: "m1", title: "Motion" }],
    }));
    const english = deriveStudyGuideRequirements(handoff({
      course: { title: "Business English" },
      learning_modules: [{ id: "m1", title: "Presentations" }],
    }));

    expect(Object.keys(dynamics).sort()).toEqual(Object.keys(english).sort());
    expect(dynamics.sectionTitles).toEqual(["Motion"]);
    expect(english.sectionTitles).toEqual(["Presentations"]);
  });

  it("keeps the complete evidenced hierarchy instead of a first-twelve cap", () => {
    const learning_modules = Array.from({ length: 15 }, (_, index) => ({
      id: `m${index + 1}`,
      title: `Course unit ${index + 1}`,
    }));
    const requirements = deriveStudyGuideRequirements(handoff({
      course: { title: "New interdisciplinary course" },
      learning_modules,
    }));

    expect(requirements.sectionTitles).toHaveLength(15);
    expect(requirements.sectionTitles.at(-1)).toBe("Course unit 15");
  });

  it("groups source sections by course hierarchy without inventing objectives", () => {
    const groups = handoffSectionGroups(handoff({
      course: { title: "Course" },
      sections: [
        { heading: "First", source_ids: ["x_ch1_res_a"] },
        { heading: "Second", source_ids: ["x_ch2_res_b"] },
      ],
    }));
    expect(groups.map((group) => group.title)).toEqual(["First", "Second"]);
  });

  it("accepts only validated Moodle HTTPS URLs in the handoff registry", () => {
    const urls = knownHandoffSourceUrls(handoff({
      course: { title: "Course" },
      sources: [
        { id: "a", title: "A", url: "https://moodle.example/mod/resource/view.php?id=1" },
        { id: "b", title: "B", url: "file:///tmp/private.pdf" },
      ],
    }));
    expect([...urls]).toEqual(["https://moodle.example/mod/resource/view.php?id=1"]);
  });
});
