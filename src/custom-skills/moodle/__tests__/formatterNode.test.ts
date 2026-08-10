import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexClient } from "../codexClient.js";
import { validateTypst } from "../validation.js";
import { createFormatterNode } from "../nodes/formatterNode.js";
import {
  moodleExtractedData,
  moodleTestConfig,
  moodleTestState,
  studyBuddyTypstDocument,
} from "./support/moodleTestBlocks.js";

vi.mock("../validation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../validation.js")>();
  return {
    ...actual,
    validateTypst: vi.fn(),
  };
});

const validateTypstMock = vi.mocked(validateTypst);

describe("formatterNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips Typst fences, validates, and clears repair errors", async () => {
    let receivedPrompt = "";
    validateTypstMock.mockResolvedValueOnce({ ok: true });
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return `\`\`\`typst\n${studyBuddyTypstDocument()}\`\`\``;
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(
      moodleTestState({
      extracted_data: { document_title: "DYN2" },
      error_log: null,
      retry_count: 0,
      }),
    );

    expect(receivedPrompt).toContain('"document_title": "DYN2"');
    expect(receivedPrompt).toContain("appropriate to the course discipline");
    expect(receivedPrompt).not.toContain("engineering study note");
    expect(receivedPrompt).toContain("sb-flowchart-branch");
    expect(receivedPrompt).toContain("Never draw diagrams with text arrow glyphs");
    expect(receivedPrompt).toContain("Do not enforce a paragraph count or prose ratio");
    expect(receivedPrompt).toContain("Do not use callouts as normal paragraph wrappers");
    expect(validateTypstMock).toHaveBeenCalledWith(
      studyBuddyTypstDocument(),
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "study-buddy-components.typ" }),
        expect.objectContaining({ relativePath: "study-buddy-template.typ" }),
        expect.objectContaining({
          relativePath: expect.stringContaining(".typst-packages"),
        }),
      ]),
      { assetBaseDir: "/tmp" },
    );
    expect(result).toEqual({
      final_document: studyBuddyTypstDocument(),
      error_log: null,
    });
  });

  it("uses the contract-aware repair formatter instead of a semantic deterministic fallback", async () => {
    validateTypstMock.mockResolvedValueOnce({ ok: true });
    let codexCalls = 0;
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        codexCalls += 1;
        receivedPrompt = prompt;
        return studyBuddyTypstDocument("= Repaired Ablaufplan");
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(
      moodleTestState({
        extracted_data: moodleExtractedData({
          sections: [{
            heading: "Ablaufplan",
            summary: "Messung durchführen.",
            key_concepts: ["Ue einstellen"],
            source_ids: [],
          }],
        }),
        error_log: "Typst validation failed",
        retry_count: 1,
      }),
    );

    expect(codexCalls).toBe(1);
    expect(receivedPrompt).toContain("Typst validation failed");
    expect(receivedPrompt).toContain("Evaluated request contract");
    expect(result.error_log).toBeNull();
    expect(result.final_document).toContain("Repaired Ablaufplan");
  });

  it("routes semantic quality findings to the repairing LLM formatter", async () => {
    validateTypstMock.mockResolvedValueOnce({ ok: true });
    let receivedPrompt = "";
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return studyBuddyTypstDocument("= Repaired content");
      },
    };
    const state = moodleTestState({
      extracted_data: moodleExtractedData(),
      error_log: "Semantic quality review failed:\n- Correct the dimensionally invalid formula.",
      retry_count: 1,
    });
    state.review_report = { ...state.review_report, ok: true };
    state.study_model = { ...state.study_model, publicationStatus: "partial" };

    const result = await createFormatterNode(moodleTestConfig(), codex)(state);

    expect(receivedPrompt).toContain("Correct the dimensionally invalid formula");
    expect(result).toEqual({
      final_document: studyBuddyTypstDocument("= Repaired content"),
      error_log: null,
    });
  });

  it("returns validation diagnostics and increments retry count", async () => {
    validateTypstMock.mockResolvedValueOnce({ ok: false, error: "expected expression" });
    const codex: CodexClient = {
      async run() {
        return studyBuddyTypstDocument("= DYN2\n#let broken = (");
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(
      moodleTestState({
      retry_count: 1,
      }),
    );

    expect(result.final_document).toBe(studyBuddyTypstDocument("= DYN2\n#let broken = ("));
    expect(result.error_log).toBe("Typst validation failed:\nexpected expression");
    expect(result.retry_count).toBe(2);
  });

  it("rejects manual diagram geometry before Typst compilation", async () => {
    const codex: CodexClient = {
      async run() {
        return studyBuddyTypstDocument("#rect((0, 0), (1, 1))");
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(
      moodleTestState(),
    );

    expect(validateTypstMock).not.toHaveBeenCalled();
    expect(result.error_log).toContain("Do not draw raw geometry");
    expect(result.retry_count).toBe(1);
  });
});
