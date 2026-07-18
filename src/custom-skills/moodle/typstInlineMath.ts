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
    .replace(/\\(?:cdot|dot)\b/g, "·")
    .replace(/\\times\b/g, "×")
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
    .replace(/\bdot\b/gi, "·")
    .replace(/\bapprox\b/gi, "≈")
    .replace(/\bdots\b/gi, "…")
    .replace(/\bsqrt\b/gi, "√")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/\^2\b/g, "²")
    .replace(/\^3\b/g, "³")
    .replace(/_\("?([^)"]+)"?\)/g, "_$1")
    .replace(/_"([^"]+)"/g, "_$1");
}

export function normalizeInlineMathSource(value: string): string {
  return value
    .trim()
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
    .replace(/_\{([A-Za-z][A-Za-z0-9 ,.-]*)\}/g, (_, label: string) => `_"${label.trim()}"`)
    .replace(/_\(([A-Za-z][A-Za-z0-9 ,.-]*)\)/g, (_, label: string) => `_"${label.trim()}"`)
    .replace(/_\(([A-Za-z][A-Za-z0-9]*\([^)]+\))\)/g, (_, label: string) => `_"${label}"`)
    .replace(/_([A-Za-z][A-Za-z0-9]{1,})\b/g, (_, label: string) => `_"${label}"`);
}

export function quoteBareMathText(value: string): string {
  const mathKeywords = new Set([
    "accent", "alpha", "and", "approx", "beta", "chi", "cos", "delta", "dif", "div", "dot",
    "dots", "double", "epsilon", "eta", "exp", "frac", "gamma", "kappa", "lambda", "lim",
    "ln", "log", "max", "min", "mu", "nu", "omega", "or", "phi", "pi", "psi", "quad",
    "rho", "sigma", "sin", "sqrt", "sum", "tan", "tau", "theta", "times", "vec", "zeta",
    "Delta", "Gamma", "Lambda", "Omega", "Phi", "Psi", "Sigma", "Theta",
  ]);
  return value
    .split(/("[^"]*")/)
    .map((part) => {
      if (part.startsWith('"') && part.endsWith('"')) return part;
      return part
        .replace(/µm/g, '"µm"')
        .replace(/°C/g, '"°C"')
        .replace(/\b[A-Za-z]{2,}\d*\b/g, (token) =>
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
