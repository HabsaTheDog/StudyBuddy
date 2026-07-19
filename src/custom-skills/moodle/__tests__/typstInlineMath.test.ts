import { describe, expect, it } from "vitest";
import { formatFormulaMath } from "../studentFirstTypstRenderer.js";
import {
  cleanVisibleMathText,
  normalizeInlineMathSource,
  quoteBareMathText,
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

  it("renders the MEL netto-area notation instead of printing dollar delimiters", async () => {
    const content = renderTypstInlineText(
      "Bei der Nettofläche verwenden: $A_(net) = A - Delta A$.",
      formatFormulaMath,
    );

    expect(content).toBe(
      '[#text("Bei der Nettofläche verwenden: ")$A_"net" = A - Delta A$#text(".")]',
    );
    expect(content).not.toContain('#text("$A_(net)');
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

  it("quotes comma-separated engineering subscripts as one Typst label", () => {
    expect(normalizeInlineMathSource("R_(m,Niet) = 400 N/mm^2")).toContain('R_"m,Niet"');
    expect(normalizeInlineMathSource("F_(v,Rd) >= F_(v,Ed)")).toBe(
      'F_"v,Rd" >= F_"v,Ed"',
    );
  });

  it("keeps ISO fit designations as text inside Typst math", () => {
    expect(normalizeInlineMathSource("H7/r6")).toBe('"H7/r6"');
    expect(normalizeInlineMathSource("H7 / k6")).toBe('"H7/k6"');
    expect(normalizeInlineMathSource(normalizeInlineMathSource("H7/r6"))).toBe('"H7/r6"');
  });

  it("quotes multi-letter engineering symbols without quoting Typst math functions", () => {
    expect(quoteBareMathText("EI = 0 µm; ES = EI + IT7"))
      .toBe('"EI" = 0 "µm"; "ES" = "EI" + "IT7"');
    expect(quoteBareMathText("frac(F, pi dot d^2)")).toBe("frac(F, pi dot d^2)");
  });

  it("quotes non-ASCII prose inside a math expression", () => {
    expect(quoteBareMathText('f(x) = x quad für "alle" x')).toBe(
      'f(x) = x quad "für" "alle" x',
    );
  });

  it("normalizes common analyzer LaTeX before Typst rendering", async () => {
    const normalized = formatFormulaMath(
      String.raw`y = C_1 e^{lambda_1 x} + C_2 e^{lambda_2 x}, \quad \forall x \in RR`,
    );
    expect(normalized).not.toContain("\\quad");
    expect(normalized).not.toContain("^{");
    const source = studyBuddyTypstDocument(`$ ${normalized} $`);
    await expect(validateTypst(source, await getStudyBuddyTypstSupportFiles()))
      .resolves.toEqual({ ok: true });
  }, 30_000);
});
