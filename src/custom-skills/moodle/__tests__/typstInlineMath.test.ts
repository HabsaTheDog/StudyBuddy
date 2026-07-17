import { describe, expect, it } from "vitest";
import { formatFormulaMath } from "../studentFirstTypstRenderer.js";
import {
  cleanVisibleMathText,
  renderTypstInlineText,
} from "../typstInlineMath.js";
import { getStudyBuddyTypstSupportFiles } from "../typstAssets.js";
import { validateTypst } from "../validation.js";
import { studyBuddyTypstDocument } from "./support/moodleTestBlocks.js";

describe("Typst inline mathematics", () => {
  it("renders dollar and backtick math as real inline math", async () => {
    const content = renderTypstInlineText(
      "Gegeben sind $A_{net} = A - ΔA = 23 µm$ und `gamma_(M2) = 1.25`; danach folgt Text.",
      formatFormulaMath,
    );

    expect(content).not.toContain('#text("Gegeben sind $');
    expect(content).not.toContain("`");
    expect(content).toContain('$A_"net" = A - Δ A = 23 "µm"$');
    expect(content).toContain('$gamma_"M2" = 1.25$');
    await expect(
      validateTypst(
        studyBuddyTypstDocument(content),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("cleans visible raw notation in ordinary prose and metadata", () => {
    expect(cleanVisibleMathText("tau_1 <= tau_1B / S; N/mm^2; pi dot d^2"))
      .toBe("τ_1 ≤ τ_1B / S; N/mm²; π · d²");
    expect(cleanVisibleMathText("`origin: source`")).toBe("origin: source");
  });
});
