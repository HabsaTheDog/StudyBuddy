import { describe, expect, it } from "vitest";
import {
  deriveModuleContextLabel,
  deriveModuleDisplayTitle,
  MODULE_DISPLAY_TITLE_MAX,
  moduleNavigationLayout,
} from "../moduleTitles.js";

describe("adaptive module titles", () => {
  const englishTitles = [
    "Self-Study A: Business Forms and the Investor Mindset Part (i) + Class 1: Business Forms and the Investor Mindset Part (ii)",
    "Self-Study B: ELF (English as a Lingua Franca) Meetings and Team Communication (i) + Class 2: ELF Meetings and Team Communication (ii)",
    "Self-Study C: Marketing, Note Taking, Questioning + Class 3: Marketing Products",
    "Self-Study D: Financial Reports and Expressions; The Presentation of Data and Trends + Class 4: The Presentation of Data; The Business Plan",
    "Self-study E: Corporate Social Responsibility and Business Ethics (i) + Class 5: Corporate Social Responsibility and Business Ethics (ii)",
    "Self-Study F: Providing Feedback and Finalising Your Presentations + Class 6: Presentations and Vocabulary Test",
  ];

  it("creates concise concept labels while preserving course sequence context", () => {
    expect(englishTitles.map(deriveModuleDisplayTitle)).toEqual([
      "Business Forms & the Investor Mindset",
      "ELF Meetings & Team Communication",
      "Marketing · Note Taking · Questioning · Products",
      "Financial Reports & Expressions · Data & Trends · Business Plan",
      "Corporate Social Responsibility & Business Ethics",
      "Feedback & Finalising Presentations · Vocabulary Test",
    ]);
    expect(englishTitles.map(deriveModuleContextLabel)).toEqual([
      "Self-Study A · Class 1",
      "Self-Study B · Class 2",
      "Self-Study C · Class 3",
      "Self-Study D · Class 4",
      "Self-study E · Class 5",
      "Self-Study F · Class 6",
    ]);
    expect(englishTitles.map(deriveModuleDisplayTitle).every((title) =>
      title.length <= MODULE_DISPLAY_TITLE_MAX
    )).toBe(true);
  });

  it("selects a scrollable rail for long source titles and compact tabs otherwise", () => {
    expect(moduleNavigationLayout(englishTitles.map((title) => ({ title })))).toBe("rail");
    expect(moduleNavigationLayout([
      { title: "Folgen" },
      { title: "Reihen" },
      { title: "Integralrechnung" },
    ])).toBe("compact");
  });
});
