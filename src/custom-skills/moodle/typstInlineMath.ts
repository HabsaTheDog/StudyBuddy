export function renderTypstInlineText(
  value: string,
  formatMath: (value: string) => string,
): string {
  const parts = splitInlineMarkup(value);
  if (parts.length === 1 && parts[0].kind === "text") {
    return `#text(${typstString(cleanVisibleMathText(parts[0].value))})`;
  }
  return `[${parts.map((part) => {
    if (part.kind === "math") {
      return `$${formatMath(normalizeInlineMathSource(part.value))}$`;
    }
    return `#text(${typstString(cleanVisibleMathText(part.value))})`;
  }).join("")}]`;
}

export function cleanVisibleMathText(value: string): string {
  return value
    .replace(/`/g, "")
    .replace(/\b(?:->|→)\(([^()]+)\)/g, (_, value: string) => `bold(${value.trim()})`)
    .replace(/\bdot\s*\.\s*dot\s*\(([^()]+)\)/g, "$1\u0308")
    .replace(
      /\bddot\(bold\(([^()]+)\)((?:_"[^"]+"|_[A-Za-z0-9,.-]+)?)\)/g,
      (_, value: string, suffix: string) => `${toUnicodeBold(normalizeVisibleMathToken(value))}\u0308${suffix}`,
    )
    .replace(
      /\bdot\(bold\(([^()]+)\)((?:_"[^"]+"|_[A-Za-z0-9,.-]+)?)\)/g,
      (_, value: string, suffix: string) => `${toUnicodeBold(normalizeVisibleMathToken(value))}\u0307${suffix}`,
    )
    .replace(/\baccent\(([^()]+),\s*dot\.double\)/g, (_, value: string) =>
      `${normalizeVisibleMathToken(value)}\u0308`
    )
    .replace(/\bddot\((bold\([^()]+\)|vec\([^()]+\)|[^()]+)\)/g, (_, value: string) =>
      `${normalizeVisibleMathToken(value)}\u0308`
    )
    .replace(/\bdot\((bold\([^()]+\)|vec\([^()]+\)|[^()]+)\)/g, (_, value: string) =>
      `${normalizeVisibleMathToken(value)}\u0307`
    )
    .replace(/\bvec\(([^()]+)\)/g, (_, value: string) => `bold(${value.trim()})`)
    .replace(/\bbold\(([^()]+)\)/g, (_, value: string) => toUnicodeBold(normalizeVisibleMathToken(value)))
    .replace(/\\(?:cdot|dot)\b/g, "·")
    .replace(/\\times\b/g, "×")
    .replace(/\btimes\b/gi, "×")
    .replace(/\\approx\b/g, "≈")
    .replace(/\\leq?\b/g, "≤")
    .replace(/\\geq?\b/g, "≥")
    .replace(/\\pi\b/g, "π")
    .replace(/\\sigma\b/g, "σ")
    .replace(/\\tau\b/g, "τ")
    .replace(/\\gamma\b/g, "γ")
    .replace(/\\nu\b/g, "ν")
    .replace(/\\Delta\b/g, "Δ")
    .replace(/\bsigma(?=_|\b)/gi, "σ")
    .replace(/\btau(?=_|\b)/gi, "τ")
    .replace(/\bgamma(?=_|\b)/gi, "γ")
    .replace(/\bnu(?=_|\b)/gi, "ν")
    .replace(/\bpi\b/gi, "π")
    .replace(/\bDelta\b/g, "Δ")
    .replace(/\blambda\b/g, "λ")
    .replace(/\bomega(?=_|\b)/g, "ω")
    .replace(/\bvarphi(?=_|\b)/g, "φ")
    .replace(/\bphi(?=_|\b)/g, "φ")
    .replace(/\btheta(?=_|\b)/g, "θ")
    .replace(/\balpha(?=_|\b)/g, "α")
    .replace(/\bbeta(?=_|\b)/g, "β")
    .replace(/\bmu(?=_|\b)/g, "μ")
    .replace(/\bdot\b/gi, "·")
    .replace(/\bapprox\b/gi, "≈")
    .replace(/\bdots\b/gi, "…")
    .replace(/\bsqrt\b/gi, "√")
    .replace(/\bintegral(?=_|\b)/g, "∫")
    .replace(/\bsum(?=_|\b)/g, "∑")
    .replace(/\binfinity\b/g, "∞")
    .replace(/\barrow\b/g, "→")
    .replace(/\bcompose\b/g, "∘")
    .replace(/\bdif\s+([A-Za-z])/g, "d$1")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/\^2\b/g, "²")
    .replace(/\^3\b/g, "³")
    .replace(/\^\((-?\d+)\)/g, (_, exponent: string) => toUnicodeSuperscript(exponent))
    .replace(/_\{([^{}]+)\}/g, "_$1")
    .replace(/_\("?([^)"]+)"?\)/g, "_$1")
    .replace(/_"([^"]+)"/g, "_$1")
    .replace(/_varphi\b/g, "_φ")
    .replace(/_phi\b/g, "_φ")
    .replace(/_theta\b/g, "_θ")
    .replace(/_omega\b/g, "_ω")
    .replace(/_alpha\b/g, "_α")
    .replace(/_beta\b/g, "_β")
    .replace(/_gamma\b/g, "_γ")
    .replace(/_sigma\b/g, "_σ")
    .replace(/_tau\b/g, "_τ")
    .replace(/_nu\b/g, "_ν")
    .replace(/_mu\b/g, "_μ")
    .replace(/_lambda\b/g, "_λ")
    .replace(/_([A-Za-z]{2,})\b/g, (match: string, letters: string) => {
      const rendered = [...letters].map(toUnicodeSubscript).join("");
      return rendered.length === letters.length && rendered !== letters ? rendered : match;
    })
    .replace(/_([A-Za-z])(?![A-Za-z])/g, (match: string, letter: string) => {
      const rendered = toUnicodeSubscript(letter);
      return rendered === letter ? match : rendered;
    })
    .replace(/_([0-9]+)/g, (_, digits: string) =>
      [...digits].map((digit) => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)]).join("")
    );
}

function normalizeVisibleMathToken(value: string): string {
  return cleanVisibleMathText(value.trim())
    .replace(/^#text\("([^"]+)"\)$/g, "$1")
    .trim();
}

function toUnicodeBold(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0);
    if (code === undefined) return character;
    if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(0x1d400 + (code - 0x41));
    if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(0x1d41a + (code - 0x61));
    if (code >= 0x30 && code <= 0x39) return String.fromCodePoint(0x1d7ce + (code - 0x30));
    return character;
  }).join("");
}

function toUnicodeSubscript(value: string): string {
  const subscripts: Record<string, string> = {
    a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ",
    n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
  };
  return subscripts[value.toLowerCase()] ?? value;
}

function toUnicodeSuperscript(value: string): string {
  const superscripts: Record<string, string> = {
    "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return [...value].map((character) => superscripts[character] ?? character).join("");
}

export function normalizeInlineMathSource(value: string): string {
  const typstGreekIdentifiers = new Set([
    "alpha", "beta", "chi", "delta", "epsilon", "eta", "gamma", "kappa", "lambda", "mu", "nu",
    "omega", "phi", "pi", "psi", "rho", "sigma", "tau", "theta", "zeta",
    "Delta", "Gamma", "Lambda", "Omega", "Phi", "Psi", "Sigma", "Theta",
  ]);
  const normalized = value
    .trim()
    .replace(/"varphi"/g, "phi")
    .replace(/_varphi\b/g, "_phi")
    .replace(/\bvarphi\b/g, "phi")
    .replace(/\bdot\s*\.\s*dot\s*\(([^()]+)\)/g, "accent($1, dot.double)")
    .replace(/\bddot\((bold\([^()]+\)|[^()]+)\)/g, "accent($1, dot.double)")
    .replace(/·/g, " dot ")
    .replace(/×/g, " times ")
    .replace(/\\text\s*\{([^{}]*)\}/g, (_, text: string) => `"${text.trim().replace(/"/g, "'")}"`)
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "frac($1, $2)")
    // Repair a common half-converted LaTeX/Typst hybrid emitted by structured
    // analyzers: `frac(2r}{pi}`. The opening parenthesis already denotes the
    // Typst call while the numerator/denominator still use LaTeX closers.
    .replace(/\bfrac\(([^(){}]+)\}\s*\{([^{}]+)\}/g, "frac($1, $2)")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\ddot\s*\{([^{}]+)\}/g, "accent($1, dot.double)")
    .replace(/\\dot\s*\{([^{}]+)\}/g, "dot($1)")
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\(?:qquad|quad)\b/g, " quad ")
    .replace(/\\(?:Rightarrow|Longrightarrow)\b/g, " => ")
    .replace(/\\(?:rightarrow|to)\b/g, " -> ")
    .replace(/\\forall\b/g, " forall ")
    .replace(/\\in\b/g, " in ")
    .replace(/\\pm\b/g, " plus.minus ")
    .replace(/\\cdots\b/g, " dots ")
    .replace(/\\(?=\s*\{)/g, " without ")
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/(?<!")\b([A-Z]\d{1,2}\s*\/\s*[a-z]\d{1,2})\b(?!")/g, (_, fit: string) =>
      `"${fit.replace(/\s+/g, "")}"`
    )
    .replace(/\\(?:cdot|dot)\b/g, " dot ")
    .replace(/\\times\b/g, " times ")
    .replace(/\\approx\b/g, " approx ")
    .replace(/\\leq?\b/g, " <= ")
    .replace(/\\geq?\b/g, " >= ")
    .replace(/\\pi\b/g, "pi")
    .replace(/\\sigma\b/g, "sigma")
    .replace(/\\tau\b/g, "tau")
    .replace(/\\gamma\b/g, "gamma")
    .replace(/\\nu\b/g, "nu")
    .replace(/\\Delta\b/g, "Delta")
    .replace(/(?<![A-Za-z])([gmkc])(?=([atvxy])(?:_|\b))/g, "$1 ")
    .replace(/_\{([A-Za-z][A-Za-z0-9 ,.-]*)\}/g, (_, label: string) => `_"${label.trim()}"`)
    .replace(/_\(([A-Za-z][A-Za-z0-9 ,.-]*)\)/g, (_, label: string) => `_"${label.trim()}"`)
    .replace(/_\(([A-Za-z][A-Za-z0-9]*\([^)]+\))\)/g, (_, label: string) => `_"${label}"`)
    .replace(/_([A-Za-z][A-Za-z0-9]{1,})\b/g, (_, label: string) =>
      typstGreekIdentifiers.has(label) ? `_${label}` : `_"${label}"`
    );
  return normalizeUnaryVectorStyling(normalizeCurriedBinaryMathFunction(normalized, "frac"))
    .split(/("[^"]*")/)
    .map((part) =>
      part.startsWith('"') && part.endsWith('"')
        ? part
        : part
          .replace(/(?<![A-Za-z])([A-Za-z])(\d+[A-Za-z]+)\b/g, "$1_($2)")
          .replace(/\b([A-Za-z])(\d+)\b/g, "$1_$2")
    )
    .join("");
}

function normalizeUnaryVectorStyling(value: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < value.length) {
    const index = value.indexOf("vec", cursor);
    if (index < 0) {
      result += value.slice(cursor);
      break;
    }
    const before = value[index - 1] ?? "";
    let openIndex = index + 3;
    while (/\s/.test(value[openIndex] ?? "")) openIndex += 1;
    if (/[A-Za-z0-9_\\]/.test(before) || value[openIndex] !== "(") {
      result += value.slice(cursor, index + 3);
      cursor = index + 3;
      continue;
    }
    const closeIndex = matchingMathParen(value, openIndex);
    if (closeIndex < 0) {
      result += value.slice(cursor);
      break;
    }
    const argument = value.slice(openIndex + 1, closeIndex).trim();
    const isSingleSymbol = /^[\p{L}][\p{L}\p{N}_]*$/u.test(argument);
    result += value.slice(cursor, index);
    result += isSingleSymbol ? `bold(${argument})` : value.slice(index, closeIndex + 1);
    cursor = closeIndex + 1;
  }
  return result;
}

function normalizeCurriedBinaryMathFunction(value: string, functionName: string): string {
  let result = value;
  let cursor = 0;
  while (cursor < result.length) {
    const index = result.indexOf(functionName, cursor);
    if (index < 0) break;
    const before = result[index - 1] ?? "";
    let firstOpen = index + functionName.length;
    while (/\s/.test(result[firstOpen] ?? "")) firstOpen += 1;
    if (/[A-Za-z0-9_\\]/.test(before) || result[firstOpen] !== "(") {
      cursor = index + functionName.length;
      continue;
    }
    const firstClose = matchingMathParen(result, firstOpen);
    if (firstClose < 0) break;
    let secondOpen = firstClose + 1;
    while (/\s/.test(result[secondOpen] ?? "")) secondOpen += 1;
    if (result[secondOpen] !== "(") {
      cursor = firstClose + 1;
      continue;
    }
    const secondClose = matchingMathParen(result, secondOpen);
    if (secondClose < 0) break;
    const numerator = result.slice(firstOpen + 1, firstClose).trim();
    const denominator = result.slice(secondOpen + 1, secondClose).trim();
    const replacement = `${functionName}(${numerator}, ${denominator})`;
    result = `${result.slice(0, index)}${replacement}${result.slice(secondClose + 1)}`;
    cursor = index + replacement.length;
  }
  return result;
}

function matchingMathParen(value: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function quoteBareMathText(value: string): string {
  const mathKeywords = new Set([
    "accent", "alpha", "and", "approx", "arrow", "beta", "bold", "chi", "compose", "cos", "delta", "dif", "div", "dot",
    "dots", "double", "epsilon", "eta", "exp", "frac", "gamma", "kappa", "lambda", "lim",
    "infinity", "integral", "ln", "log", "max", "min", "mu", "NN", "nu", "omega", "or", "phi", "pi", "psi", "quad", "RR",
    "forall", "in", "minus", "plus", "rho", "sigma", "sin", "sqrt", "sum", "tan", "tau", "theta", "times", "vec", "without", "zeta",
    "Delta", "Gamma", "Lambda", "Omega", "Phi", "Psi", "Sigma", "Theta",
  ]);
  return value
    .replace(
      /(\d(?:[.,]\d+)?)\s+(N\/mm(?:\^?[23]|[²³])?|N\/m(?:\^?[23]|[²³])?|kN|MPa|GPa|Pa|mm[²³]?|cm[²³]?|kg|Nm|J|W|V)(?=$|[\s,;)\]<>=+\-])/g,
      '$1 "$2"',
    )
    .split(/("[^"]*")/)
    .map((part) => {
      if (part.startsWith('"') && part.endsWith('"')) return part;
      return part
        .replace(/µm/g, '"µm"')
        .replace(/°C/g, '"°C"')
        .replace(/(?<![\p{L}\p{N}_"])[\p{L}]{2,}\d*(?![\p{L}\p{N}_"])/gu, (token) =>
          mathKeywords.has(token) ? token : `"${token}"`
        );
    })
    .join("");
}

type InlinePart = { kind: "text" | "math"; value: string };

function splitInlineMarkup(value: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /(\$[^$\n]+\$|`[^`\n]+`)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", value: value.slice(cursor, index) });
    const marked = match[0];
    const inner = marked.slice(1, -1);
    parts.push({
      kind: marked.startsWith("$") || looksLikeMath(inner) ? "math" : "text",
      value: inner,
    });
    cursor = index + marked.length;
  }
  if (cursor < value.length) parts.push({ kind: "text", value: value.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: "text", value }];
}

function looksLikeMath(value: string): boolean {
  return (
    /[=<>^_/±≈≤≥·×]/.test(value) ||
    /\b(?:frac|sqrt|dot|times|sigma|tau|gamma|nu|pi|Delta)\b/.test(value) ||
    /^\s*[-+]?\d+(?:[.,]\d+)?\s*$/.test(value)
  );
}

function typstString(value: string): string {
  return JSON.stringify(value.replace(/\u2028|\u2029/g, " "));
}
