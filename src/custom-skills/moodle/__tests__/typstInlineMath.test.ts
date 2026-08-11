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
      .toBe("τ₁ ≤ τ₁B / S; N/mm²; π · d²");
    expect(cleanVisibleMathText("integral_0^2 f(x) dif x arrow infinity"))
      .toBe("∫₀² f(x) dx → ∞");
    expect(cleanVisibleMathText("m ddot(x) = -c x - k dot(x); ddot(phi) + omega_0^2 phi = 0"))
      .toBe("m ẍ = -c x - k ẋ; φ̈ + ω₀² φ = 0");
    expect(cleanVisibleMathText("ddot(bold(r)) = dot(vec(v))"))
      .toBe("𝐫̈ = 𝐯̇");
    expect(cleanVisibleMathText("dot(bold(L)_O) = sum bold(M)_O"))
      .toBe("𝐋̇ₒ = ∑ 𝐌ₒ");
    expect(cleanVisibleMathText("r dot(varphi) bold(e)_varphi"))
      .toBe("r φ̇ 𝐞_φ");
    expect(cleanVisibleMathText("bold(r)_{PA} times bold(v); s^(-2)"))
      .toBe("𝐫ₚₐ × 𝐯; s⁻²");
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

  it("preserves common calculus and mapping symbols as Typst math", () => {
    expect(quoteBareMathText(
      "integral_a^b f(x) dif x, infinity, f compose g, x arrow y, NN, RR",
    )).toBe(
      "integral_a^b f(x) dif x, infinity, f compose g, x arrow y, NN, RR",
    );
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

  it("normalizes analyzer double-dot notation as a valid acceleration accent", async () => {
    const normalized = formatFormulaMath(
      "F - S = (F/g) dot.dot(x)_1 quad arrow quad dot.dot(x)_1 = 4 dot.dot(x)_2",
    );

    expect(normalized).toContain("accent(x, dot.double)_1");
    expect(normalized).not.toContain("dot.dot");
    expect(cleanVisibleMathText("dot.dot(x)_1 = 4 dot.dot(x)_2")).toBe(
      "ẍ₁ = 4 ẍ₂",
    );
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("normalizes curried fractions with nested sums in the compact renderer", async () => {
    const normalized = formatFormulaMath(
      "bold(r)_k = frac(sum_(i=1)^n bold(r)_i F_i)(sum_(i=1)^n F_i)",
    );

    expect(normalized).toContain(
      "frac(sum_(i=1)^n bold(r)_i F_i, sum_(i=1)^n F_i)",
    );
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("repairs half-converted LaTeX fraction delimiters from structured formulas", async () => {
    const normalized = formatFormulaMath(
      "x_S = frac(2r}{pi}, quad S = (frac(2r}{pi}, frac(2r}{pi})",
    );

    expect(normalized).toContain("x_S = frac(2r, pi)");
    expect(normalized).toContain("S = (frac(2r, pi), frac(2r, pi))");
    expect(normalized).not.toContain("}");
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("keeps vector styling and Greek subscripts as executable Typst math", async () => {
    const normalized = formatFormulaMath(
      "bold(a) := ddot(bold(r)), quad bold(v) = dot(r) bold(e)_r + r dot(phi) bold(e)_phi",
    );

    expect(normalized).toContain("accent(bold(r), dot.double)");
    expect(normalized).not.toContain("ddot");
    expect(normalized).not.toContain('"bold"');
    expect(normalized).toContain("bold(e)_phi");
    expect(normalized).not.toContain('_"phi"');
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("normalizes unary vec notation and quoted varphi into visible vector math", async () => {
    const normalized = formatFormulaMath(
      'vec(r)(t) = vec(v)(t), quad vec(v) = dot(r) vec(e)_r + r dot("varphi") vec(e)_varphi',
    );

    expect(normalized).toContain("bold(r)(t) = bold(v)(t)");
    expect(normalized).toContain("dot(phi) bold(e)_phi");
    expect(normalized).not.toContain("vec(r)");
    expect(normalized).not.toContain("varphi");
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("separates implicit products of common physics variables", async () => {
    const normalized = formatFormulaMath(
      "sqrt(v_0^2 - 2gv_0 sin(alpha)t + g^2t^2), quad ma + cx + kx = 0",
    );

    expect(normalized).toContain("2g v_0");
    expect(normalized).toContain("m a + c x + k x");
    expect(normalized).not.toContain('"gv"');
    expect(normalized).not.toContain('"gt"');
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  it("normalizes compact multiplication operators before quoting engineering labels", async () => {
    const normalized = formatFormulaMath(
      "tau = F/(n·AS) = 88,4 N/mm² < 120 N/mm², quad D = d1·d2/(d1+d2), quad P = U×I, quad v0x = 20 cos(30°) m/s, quad tF = 2v0y/g",
    );

    expect(normalized).toContain('n dot "AS"');
    expect(normalized).toContain('88,4 "N/mm²" < 120 "N/mm²"');
    expect(normalized).toContain("D = d_1 dot d_2/(d_1+d_2)");
    expect(normalized).toContain("U times I");
    expect(normalized).toContain("v_(0x) = 20 cos(30°) m/s");
    expect(normalized).toContain('"tF" = 2v_(0y)/g');
    await expect(
      validateTypst(
        studyBuddyTypstDocument(`$ ${normalized} $`),
        await getStudyBuddyTypstSupportFiles(),
      ),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
