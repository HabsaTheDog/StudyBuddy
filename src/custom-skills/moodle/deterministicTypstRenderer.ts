import type { ExtractedData } from "./schemas.js";
import type { SourceCoverage } from "./runDiagnostics.js";

export function renderDeterministicStudyDocument(
  data: ExtractedData,
  coverage: SourceCoverage,
): string {
  const title = data.document_title || "Study Buddy Lernunterlage";
  const course = data.course.title || "FH Technikum Wien";
  const body: string[] = [
    heading(1, "Dokumenthinweis"),
    paragraph(
      "Konkrete Laborvorgaben stammen aus den im Quellenverzeichnis genannten Moodle- und CIS-Inhalten. Allgemeine Herleitungen sind als Fachtheorie gekennzeichnet; Messwerte müssen im Labor erhoben und dokumentiert werden.",
    ),
    sourceNote(
      "Quellenabdeckung",
      `Moodle: ${coverage.moodle.status}, ${coverage.moodle.pages} Seite(n). CIS: ${coverage.cis.status}, ${coverage.cis.pages} Seite(n).`,
    ),
  ];

  for (const section of data.sections) {
    body.push(
      heading(1, section.heading),
      paragraph(withInlineSources(data, section.summary, section.source_ids)),
    );
    if (section.key_concepts.length > 0) {
      body.push(heading(2, "Kernpunkte"), checklist(section.key_concepts));
    }
  }

  const figures = renderFigures(data);
  if (figures.length > 0) {
    body.push(heading(1, "Abbildungen und Visualisierungen"), ...figures);
  }

  if (data.formulas.length > 0) {
    body.push(heading(1, "Formeln und Berechnungen"));
    for (const formula of data.formulas) {
      body.push(
        `#sb-formula(
  name: ${typstString(formula.name)},
  variables: ${stringTuple(formula.variables)},
  units: ${stringTuple(formula.units)},
  source: ${typstString(sourceTitles(data, formula.source_ids) || "Allgemeine Fachtheorie")},
)[
  ${math(formula.typst)}
]
`,
      );
      if (formula.context) {
        body.push(paragraph(formula.context));
      }
    }
  }

  if (data.worked_examples.length > 0) {
    body.push(heading(1, "Durchgerechnete Beispiele"));
    for (const [index, example] of data.worked_examples.entries()) {
      body.push(
        `#sb-example(title: ${typstString(`Beispiel ${index + 1}`)})[
  ${text(example.prompt)}
  #v(4pt)
  ${checklist(example.steps)}
  #v(4pt)
  #text(weight: "bold")[Ergebnis:] ${text(example.result)}
]
`,
      );
    }
  }

  if (data.quiz_style_questions.length > 0) {
    body.push(heading(1, "Kontrollfragen"));
    for (const [index, item] of data.quiz_style_questions.entries()) {
      body.push(
        heading(2, `Frage ${index + 1}`),
        paragraph(item.question),
        paragraph(`Antwort: ${item.answer}`),
      );
    }
  }

  body.push(heading(1, "Quellen"));
  for (const source of data.sources) {
    const location = [source.url, source.path, source.page ? `Seite ${source.page}` : ""]
      .filter(Boolean)
      .join(" · ");
    body.push(sourceNote(source.title, location || source.kind));
  }
  for (const warning of data.warnings) {
    body.push(callout("Quellen- oder Inhaltswarnung", "warning", warning));
  }

  return `#import "study-buddy-components.typ": *

#sb-document(
  title: ${typstString(title)},
  short-title: ${typstString(shortTitle(title))},
  course: ${typstString(course)},
  kind: "Laborvorbereitung",
  semester: ${typstString(currentSemester())},
  status: "Validiert",
  date: ${typstString(currentDate())},
  body: [
${body.map((part) => indent(part.trim(), 4)).join("\n\n")}
  ],
)
`;
}

function renderFigures(data: ExtractedData): string[] {
  const assetsById = new Map(data.visual_assets.map((asset) => [asset.id, asset]));
  return data.figures.flatMap((figure, index) => {
    const asset = assetsById.get(figure.asset_id);
    if (!asset) {
      return [];
    }
    const caption = sourceTitles(data, figure.source_ids)
      ? `${figure.caption} Quelle: ${sourceTitles(data, figure.source_ids)}.`
      : figure.caption;
    if (asset.relative_path) {
      return [
        `#sb-figure(label-text: ${typstString(`Abb. ${index + 1}`)}, caption: ${typstString(caption)})[
  #image(${typstString(asset.relative_path)}, width: 90%)
]
`,
      ];
    }
    if (asset.kind === "typst_diagram") {
      return [
        `#sb-figure(label-text: ${typstString(`Abb. ${index + 1}`)}, caption: ${typstString(caption)})[
  #sb-block-diagram(("Eingang", "Verarbeitung", "Ausgang"))
]
`,
      ];
    }
    if (asset.kind === "placeholder_prompt") {
      return [
        `#sb-figure(label-text: ${typstString(`Abb. ${index + 1}`)}, caption: ${typstString(caption)})[
  #sb-callout(title: "Visualisierungsprompt", tone: "info")[
    #text(${typstString(asset.generation_prompt || asset.caption_hint || "Didaktische Visualisierung generieren.")})
  ]
]
`,
      ];
    }
    return [];
  });
}

function heading(level: number, value: string): string {
  return `#heading(level: ${level})[${text(value)}]`;
}

function paragraph(value: string): string {
  return `${text(value)}\n`;
}

function text(value: string): string {
  return `#text(${typstString(value)})`;
}

function math(value: string): string {
  const body = normalizeTypstMath(stripMathDelimiters(value));
  return `$ ${body} $`;
}

function stripMathDelimiters(value: string): string {
  let body = value.trim();
  const fenced = /^```(?:typst|typ|math)?\s*([\s\S]*?)\s*```$/i.exec(body);
  body = (fenced?.[1] ?? body).trim();
  if (body.startsWith("$") && body.endsWith("$")) {
    body = body.slice(1, -1).trim();
  }
  return body;
}

function normalizeTypstMath(value: string): string {
  return replaceTypstMathFunctionCalls(
    value
      .replace(/\\ddot\s*\{([^{}]+)\}/g, "accent($1, dot.double)")
      .replace(/\\dot\s*\{([^{}]+)\}/g, "dot($1)"),
    "ddot",
    (argument) => `accent(${argument}, dot.double)`,
  );
}

function replaceTypstMathFunctionCalls(
  value: string,
  functionName: string,
  replacement: (argument: string) => string,
): string {
  let result = "";
  let cursor = 0;

  while (cursor < value.length) {
    const index = value.indexOf(functionName, cursor);
    if (index === -1) {
      result += value.slice(cursor);
      break;
    }

    const before = value[index - 1] ?? "";
    let openIndex = index + functionName.length;
    while (/\s/.test(value[openIndex] ?? "")) {
      openIndex += 1;
    }

    if (/[A-Za-z0-9_\\]/.test(before) || value[openIndex] !== "(") {
      result += value.slice(cursor, index + functionName.length);
      cursor = index + functionName.length;
      continue;
    }

    const closeIndex = findMatchingParen(value, openIndex);
    if (closeIndex === -1) {
      result += value.slice(cursor, index + functionName.length);
      cursor = index + functionName.length;
      continue;
    }

    result += value.slice(cursor, index);
    result += replacement(value.slice(openIndex + 1, closeIndex).trim());
    cursor = closeIndex + 1;
  }

  return result;
}

function findMatchingParen(value: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "(") {
      depth += 1;
    } else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function checklist(items: string[]): string {
  if (items.length === 0) {
    return text("Keine Einträge.");
  }
  return `#sb-checklist((
${items.map((item) => `  [${text(item)}],`).join("\n")}
))`;
}

function callout(title: string, tone: string, body: string): string {
  return `#sb-callout(title: ${typstString(title)}, tone: ${typstString(tone)})[
  ${text(body)}
]`;
}

function sourceNote(source: string, coverage: string): string {
  return `#sb-source-note(${typstString(source)}, coverage: ${typstString(coverage)})`;
}

function sourceTitles(data: ExtractedData, ids: string[]): string {
  const requested = new Set(ids);
  return data.sources
    .filter((source) => requested.has(source.id))
    .map((source) => source.title)
    .join("; ");
}

function withInlineSources(data: ExtractedData, value: string, ids: string[]): string {
  const titles = sourceTitles(data, ids);
  return titles ? `${value} Quelle: ${titles}.` : value;
}

function stringTuple(values: string[]): string {
  if (values.length === 0) {
    return "()";
  }
  return `(${values.map((value) => typstString(value)).join(", ")},)`;
}

function typstString(value: string): string {
  return JSON.stringify(value.replace(/\u2028|\u2029/g, " "));
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function shortTitle(title: string): string {
  return title.length <= 48 ? title : `${title.slice(0, 45)}...`;
}

function currentDate(): string {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function currentSemester(): string {
  const now = new Date();
  return `${now.getMonth() >= 2 && now.getMonth() <= 8 ? "SS" : "WS"} ${now.getFullYear()}`;
}
