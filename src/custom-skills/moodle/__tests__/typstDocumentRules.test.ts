import { describe, expect, it } from "vitest";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import { studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("Study Buddy Typst document rules", () => {
  it("rejects adjacent callout chains", () => {
    const source = studyBuddyTypstDocument(`
#sb-callout(title: "Hinweis", tone: "warning")[
  #text("Erster Hinweis.")
]

#sb-callout(title: "Noch ein Hinweis", tone: "warning")[
  #text("Zweiter Hinweis.")
]
`);

    expect(validateStudyBuddyDocumentStructure(source).errors).toContain(
      "Do not place #sb-callout blocks directly after each other; merge related warnings or separate them with prose.",
    );
  });

  it("rejects checklist-heavy key-point sections", () => {
    const source = studyBuddyTypstDocument(`
#heading(level: 1)[#text("Theorie")]
#text("Einleitung.")
#heading(level: 2)[#text("Kernpunkte")]
#sb-checklist((
  [#text("A")],
))
`);

    expect(validateStudyBuddyDocumentStructure(source).errors).toContain(
      "Do not render chapter 'Kernpunkte' as #sb-checklist; use prose, ordinary bullets, or a table.",
    );
  });
});
