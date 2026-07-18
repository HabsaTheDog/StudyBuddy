import { describe, expect, it } from "vitest";
import { parseJsonObjectOrArray, validateExtractedData } from "../validation.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateStudyBuddyDocumentStructure } from "../typstDocumentRules.js";
import {
  moodleExtractedData,
  studyBuddyTypstDocument,
} from "./support/moodleTestBlocks.js";

describe("validation", () => {
  it("parses fenced JSON", () => {
    expect(parseJsonObjectOrArray("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });

  it("validates extracted data", () => {
    expect(() => validateExtractedData(moodleExtractedData())).not.toThrow();
  });

  it("accepts the standardized Study Buddy document shell", () => {
    expect(validateStudyBuddyDocumentStructure(studyBuddyTypstDocument())).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("rejects raw tables and missing title metadata while allowing arrows in prose", () => {
    const validation = validateStudyBuddyDocumentStructure(`#import "study-buddy-components.typ": *
#sb-document(title: "Bad", body: [
  #table(columns: 2, [A], [B])
  A → B
])`);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("missing the 'short-title:'"),
      expect.stringContaining("raw table/grid"),
    ]));
    expect(validation.errors.join("\n")).not.toContain("text arrow glyphs");
  });

  it("rejects verbatim raw code inside formula components", () => {
    const validation = validateStudyBuddyDocumentStructure(studyBuddyTypstDocument(`
      #sb-formula(name: "Schwerpunktsatz")[
        #raw("m bold(a)_M = bold(R)", block: false)
      ]
    `));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("Do not use #raw"),
    ]));
  });

  it("rejects math delimiters printed literally inside text strings", () => {
    const validation = validateStudyBuddyDocumentStructure(studyBuddyTypstDocument(`
      #text("Bei der Nettofläche verwenden: $A_(net) = A - Delta A$.")
    `));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual([
      expect.stringContaining("Do not place '$...$' math markup inside #text"),
    ]);
  });

  it("rejects images outside managed visual assets", () => {
    const validation = validateStudyBuddyDocumentStructure(studyBuddyTypstDocument(`
      #sb-figure(label-text: "Abb. 1", caption: "Unsicher")[
        #image("../secret.png", width: 90%)
      ]
    `));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("assets/visuals"),
    ]));
  });

  it("loads the component library and vendored CeTZ package", async () => {
    const files = await getStudyBuddyTypstSupportFiles();
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "study-buddy-components.typ" }),
      expect.objectContaining({ relativePath: "study-buddy-template.typ" }),
      expect.objectContaining({
        relativePath: ".typst-packages/preview/cetz/0.5.0/typst.toml",
      }),
      expect.objectContaining({
        relativePath: ".typst-packages/preview/cetz/0.5.0/cetz-core/cetz_core.wasm",
      }),
      expect.objectContaining({
        relativePath: ".typst-packages/preview/oxifmt/1.0.0/typst.toml",
      }),
    ]));
  });
});
