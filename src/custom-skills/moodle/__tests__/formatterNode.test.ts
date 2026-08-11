import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexClient } from "../codexClient.js";
import { resolveModelPromptBodyCharacterBudget } from "../codexClient.js";
import { validateTypst } from "../validation.js";
import {
  buildFormatterPrompt,
  createFormatterNode,
  FormatterPromptCapacityError,
  normalizeGeneratedTypstComponents,
  normalizeGeneratedTypstMath,
} from "../nodes/formatterNode.js";
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

    expect(receivedPrompt).toContain('"document_title":"DYN2"');
    expect(receivedPrompt).toContain("appropriate to the course discipline");
    expect(receivedPrompt).not.toContain("engineering study note");
    expect(receivedPrompt).toContain("sb-flowchart-branch");
    expect(receivedPrompt).toContain("Never draw diagrams with text arrow glyphs");
    expect(receivedPrompt).toContain("Do not enforce a paragraph count or prose ratio");
    expect(receivedPrompt).toContain("Do not use callouts as normal paragraph wrappers");
    expect(receivedPrompt).toContain("never write a bare decimal-comma token");
    expect(receivedPrompt).toContain("separate multiplied single-letter variables");
    expect(receivedPrompt).toContain("Use accent(x, dot.double) for a second time derivative");
    expect(receivedPrompt).toContain("Set sb-document compact: true only when the exact request explicitly asks");
    expect(receivedPrompt).toContain("Never place #sb-divider immediately before a level-1 heading");
    expect(receivedPrompt).toContain("Never emit a standalone #label(\"source-q1\") call");
    expect(receivedPrompt).toContain("Component arguments that contain Typst math must be content blocks");
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

  it("canonicalizes analyzer math shorthand before validating the complete document", async () => {
    const authored = studyBuddyTypstDocument(
      '= Schwingung\n$ m ddot(x) + c dot(x) + k x = F_0 sin(Omega t) $\n#text("Preis $5")',
    );
    const expected = normalizeGeneratedTypstMath(authored);
    validateTypstMock.mockResolvedValueOnce({ ok: true });
    const codex: CodexClient = { async run() { return authored; } };

    const result = await createFormatterNode(moodleTestConfig(), codex)(moodleTestState());

    expect(validateTypstMock).toHaveBeenCalledWith(expected, expect.any(Array), { assetBaseDir: "/tmp" });
    expect(result.final_document).toBe(expected);
    expect(result.final_document).toContain("accent(x, dot.double)");
    expect(result.final_document).toContain('#text("Preis $5")');
    expect(result.error_log).toBeNull();
  });

  it("leaves an unmatched math delimiter untouched instead of rewriting prose", () => {
    const source = '#text("Preis $5")\nText mit $ offen';
    expect(normalizeGeneratedTypstMath(source)).toBe(source);
  });

  it("preserves prose after a source note without passing an unsupported body argument", () => {
    const source = `${studyBuddyTypstDocument().trim()}\n#sb-source-note("Quellenlage", coverage: "Moodle belegt")[\n  Vollständige Erläuterung mit [verschachteltem Inhalt].\n]\n`;
    const normalized = normalizeGeneratedTypstComponents(source);

    expect(normalized).toContain('#sb-source-note("Quellenlage", coverage: "Moodle belegt")\nVollständige Erläuterung mit [verschachteltem Inhalt].');
    expect(normalized).not.toContain('coverage: "Moodle belegt")[');
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

  it("repairs the exact prior Typst draft without resending extracted course data", async () => {
    validateTypstMock.mockResolvedValueOnce({ ok: true });
    const prior = studyBuddyTypstDocument("= Keep this exact chapter\n$ x = ddot(y) $");
    let receivedPrompt = "";
    const corrected = prior.replace("ddot(y)", "dot(dot(y))");
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return corrected;
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(moodleTestState({
      final_document: prior,
      error_log: "Typst validation failed: unknown variable ddot at line 12",
      extracted_data: moodleExtractedData({
        sections: [{ heading: "Do not resend", summary: "large extraction", key_concepts: [], source_ids: [] }],
      }),
      retry_count: 1,
    }));

    expect(receivedPrompt).toContain("Existing complete Typst source");
    expect(receivedPrompt).toContain(prior.trim());
    expect(receivedPrompt).toContain("smallest local edits");
    expect(receivedPrompt).toContain("other occurrences of the same concrete syntax class");
    expect(receivedPrompt).toContain("every bare decimal-comma numeric literal");
    expect(receivedPrompt).toContain("blank_page or sparse-page diagnostic");
    expect(receivedPrompt).toContain("raw-typesetting-markup");
    expect(receivedPrompt).not.toContain("large extraction");
    expect(result.final_document).toBe(normalizeGeneratedTypstMath(corrected));
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

  it("keeps learning content while compacting redundant formatter metadata below the boundary", () => {
    const sections = Array.from({ length: 60 }, (_, index) => ({
      heading: `Section ${index}`,
      summary: `Grounded summary ${index} ${"detail ".repeat(80)}`,
      key_concepts: [`Concept ${index}`],
      source_ids: [`source-${index}`],
    }));
    const sources = Array.from({ length: 60 }, (_, index) => ({
      id: `source-${index}`,
      title: `Source ${index}`,
      kind: "pdf" as const,
      url: `https://example.test/source-${index}`,
      path: `/redundant/${"nested-path/".repeat(120)}source-${index}.pdf`,
      page: index + 1,
    }));
    const prompt = buildFormatterPrompt(moodleTestConfig(), moodleTestState({
      extracted_data: moodleExtractedData({ sections, sources }),
    }));
    expect(prompt.length).toBeLessThan(resolveModelPromptBodyCharacterBudget("artifact_builder"));
    expect(prompt).toContain("Section 59");
    expect(prompt).toContain("source-59");
    expect(prompt).not.toContain("nested-path");
  });

  it("fails an indivisible oversized formatter payload before invoking the model", async () => {
    const codex: CodexClient = { run: vi.fn() };
    const config = moodleTestConfig({ prompt: "x".repeat(125_000), originalUserPrompt: "x".repeat(125_000) });
    await expect(createFormatterNode(config, codex)(moodleTestState()))
      .rejects.toBeInstanceOf(FormatterPromptCapacityError);
    expect(codex.run).not.toHaveBeenCalled();
  });

  it("does not spend semantic retries on a hard Codex request boundary", async () => {
    const boundary = new Error("artifact_builder request exceeds its hard 120000-character budget");
    const codex: CodexClient = { run: vi.fn().mockRejectedValue(boundary) };
    await expect(createFormatterNode(moodleTestConfig(), codex)(moodleTestState())).rejects.toBe(boundary);
    expect(codex.run).toHaveBeenCalledTimes(1);
  });

  it("does not retry an exhausted account usage limit", async () => {
    const exhausted = new Error("You've hit your usage limit. Purchase more credits.");
    const codex: CodexClient = { run: vi.fn().mockRejectedValue(exhausted) };
    await expect(createFormatterNode(moodleTestConfig(), codex)(moodleTestState())).rejects.toBe(exhausted);
    expect(codex.run).toHaveBeenCalledTimes(1);
  });

  it("propagates an outer abort without converting it into a formatter retry", async () => {
    const controller = new AbortController();
    const reason = new Error("render capacity exhausted");
    const codex: CodexClient = { async run() { controller.abort(reason); throw new Error("inner cancellation"); } };
    await expect(createFormatterNode(moodleTestConfig({ abortSignal: controller.signal }), codex)(moodleTestState()))
      .rejects.toBe(reason);
  });
});
