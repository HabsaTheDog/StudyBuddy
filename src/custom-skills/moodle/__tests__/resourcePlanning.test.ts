import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  planCourseResources,
  planInitialResourceProbe,
  remainingInitialProbeSlots,
  writeResourcePlan,
} from "../resourcePlanning.js";

describe("resource planning", () => {
  it("bounds the DYN2 incident catalog while covering every primary topic", () => {
    const links = [
      candidate("Zentrale Aspekte in Anwendungen der Dynamik", "summary.pdf"),
      candidate("Formelsammlung", "formulas.pdf"),
      candidate("Musterprüfung", "exam.pdf"),
      candidate("1_Folien_Punktkinematik", "point-slides.pdf"),
      candidate("2_Folien_Vektorkinematik", "vector-slides.pdf"),
      candidate("3_Folien_Schwerpunktsatz", "mass-slides.pdf"),
      candidate("4_Folien_Drallsatz", "angular-slides.pdf"),
      candidate("5_Folien_Schwingungen", "vibration-slides.pdf"),
      ...Array.from({ length: 34 }, (_, index) =>
        candidate(`${(index % 5) + 1}_Beispiel_${topicName(index % 5)}_${index}`, `example-${index}.pdf`)),
    ];

    const plan = planCourseResources(links, "balanced", 24);
    const selected = plan.entries.filter((entry) => entry.selected);

    expect(plan.discovered).toBe(42);
    expect(plan.selected).toBeLessThanOrEqual(16);
    expect(selected.filter((entry) => entry.role === "worked_example")).toHaveLength(5);
    expect(new Set(selected
      .filter((entry) => entry.role === "primary_lecture")
      .map((entry) => entry.topic))).toEqual(new Set([
      "Punktkinematik",
      "Vektorkinematik",
      "Schwerpunktsatz",
      "Drallsatz",
      "Schwingungen",
    ]));
  });

  it("does not select external references when Moodle already covers their topic", () => {
    const plan = planCourseResources([
      candidate("1_Folien_Punktkinematik", "moodle.pdf"),
      {
        ...candidate("Folien Punktkinematik Springer", "springer.pdf"),
        href: "https://example.org/content/pdf/springer.pdf",
      },
    ], "fast", 8);

    expect(plan.entries.find((entry) => entry.candidate.href.includes("example.org"))?.selected)
      .toBe(false);
  });

  it("treats standard resource paths on an arbitrary Moodle hostname as course sources", () => {
    const plan = planCourseResources([
      {
        href: "https://learn.example.edu/pluginfile.php/11/mod_resource/content/1/lecture.pdf",
        label: "Lecture 1 - Literary interpretation",
        score: 100,
      },
    ], "fast", 8);

    expect(plan.entries[0]).toMatchObject({
      role: "primary_lecture",
      selected: true,
    });
  });

  it("keeps the complete catalog while bounding the first balanced probe", () => {
    const links = Array.from({ length: 18 }, (_, index) =>
      candidate(index === 0 ? "Zusammenfassung" : `Vorlesung ${index}`, `source-${index}.pdf`));

    const plan = planInitialResourceProbe(links, "balanced", 24);

    expect(plan.discovered).toBe(18);
    expect(plan.selected).toBe(5);
    expect(plan.entries.filter((entry) => !entry.selected)).toHaveLength(13);
    expect(plan.entries.find((entry) => entry.candidate.label === "Zusammenfassung")?.selected).toBe(true);
  });

  it("merges plans from multiple discovered course pages without losing the first page", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-plan-"));
    try {
      await writeResourcePlan(runDir, planCourseResources([
        candidate("1_Folien_Punktkinematik", "point.pdf"),
      ], "balanced", 16));
      await writeResourcePlan(runDir, planCourseResources([
        candidate("2_Folien_Vektorkinematik", "vector.pdf"),
      ], "balanced", 15));

      const saved = JSON.parse(await readFile(path.join(runDir, "resource-plan.json"), "utf8"));
      const catalog = JSON.parse(await readFile(path.join(runDir, "resource-catalog.json"), "utf8"));
      expect(saved.discovered).toBe(2);
      expect(saved.selected).toBe(2);
      expect(saved.entries.map((entry: { label: string }) => entry.label)).toEqual([
        "1_Folien_Punktkinematik",
        "2_Folien_Vektorkinematik",
      ]);
      expect(catalog.entries).toHaveLength(2);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("applies the initial probe limit once across all crawled pages", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "study-buddy-probe-budget-"));
    try {
      const firstLimit = await remainingInitialProbeSlots(runDir, "balanced", 16);
      const first = planInitialResourceProbe(
        Array.from({ length: 8 }, (_, index) =>
          candidate(`Lecture ${index}`, `lecture-${index}.pdf`)),
        "balanced",
        firstLimit,
      );
      await writeResourcePlan(runDir, first);

      const secondLimit = await remainingInitialProbeSlots(runDir, "balanced", 11);
      const second = planInitialResourceProbe(
        Array.from({ length: 8 }, (_, index) =>
          candidate(`Solution ${index}`, `solution-${index}.pdf`)),
        "balanced",
        secondLimit,
      );
      await writeResourcePlan(runDir, second);

      const saved = JSON.parse(await readFile(path.join(runDir, "resource-plan.json"), "utf8"));
      expect(first.selected).toBe(5);
      expect(secondLimit).toBe(0);
      expect(second.selected).toBe(0);
      expect(saved.discovered).toBe(16);
      expect(saved.selected).toBe(5);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});

function candidate(label: string, file: string) {
  return {
    href: `https://moodle.technikum-wien.at/pluginfile.php/1/${file}`,
    label,
    score: 0,
  };
}

function topicName(index: number): string {
  return ["Punktkinematik", "Vektorkinematik", "Schwerpunktsatz", "Drallsatz", "Schwingungen"][index];
}
