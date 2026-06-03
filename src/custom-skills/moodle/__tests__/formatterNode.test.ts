import { describe, expect, it, vi } from "vitest";
import type { CodexClient } from "../codexClient.js";
import { validateTypst } from "../validation.js";
import { createFormatterNode } from "../nodes/formatterNode.js";
import { moodleTestConfig, moodleTestState } from "./support/moodleTestBlocks.js";

vi.mock("../validation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../validation.js")>();
  return {
    ...actual,
    validateTypst: vi.fn(),
  };
});

const validateTypstMock = vi.mocked(validateTypst);

describe("formatterNode", () => {
  it("strips Typst fences, validates, and clears repair errors", async () => {
    let receivedPrompt = "";
    validateTypstMock.mockResolvedValueOnce({ ok: true });
    const codex: CodexClient = {
      async run(prompt) {
        receivedPrompt = prompt;
        return "```typst\n#set page()\n= DYN2\n```";
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(
      moodleTestState({
      extracted_data: { document_title: "DYN2" },
      error_log: "Typst compile error",
      retry_count: 2,
      }),
    );

    expect(receivedPrompt).toContain("Previous Typst validation error to repair:\nTypst compile error");
    expect(receivedPrompt).toContain('"document_title": "DYN2"');
    expect(validateTypstMock).toHaveBeenCalledWith("#set page()\n= DYN2\n");
    expect(result).toEqual({
      final_document: "#set page()\n= DYN2\n",
      error_log: null,
    });
  });

  it("returns validation diagnostics and increments retry count", async () => {
    validateTypstMock.mockResolvedValueOnce({ ok: false, error: "expected expression" });
    const codex: CodexClient = {
      async run() {
        return "#set page(\n";
      },
    };

    const result = await createFormatterNode(moodleTestConfig(), codex)(
      moodleTestState({
      retry_count: 1,
      }),
    );

    expect(result.final_document).toBe("#set page(\n");
    expect(result.error_log).toBe("Typst validation failed:\nexpected expression");
    expect(result.retry_count).toBe(2);
  });
});
