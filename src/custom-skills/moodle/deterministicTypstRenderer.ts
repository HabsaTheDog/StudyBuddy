import type { ExtractedData } from "./schemas.js";
import type { SourceCoverage } from "./runDiagnostics.js";
import {
  cleanVisibleMathText,
  normalizeInlineMathSource,
  renderTypstInlineText,
} from "./typstInlineMath.js";

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

  for (const [index, section] of data.sections.entries()) {
    if (index > 0) {
      body.push(divider());
    }
    body.push(
      heading(1, section.heading),
      paragraph(section.summary),
    );
    const sectionSources = sourceLine(data, section.source_ids);
    if (sectionSources) {
      body.push(sectionSources);
    }
    if (section.key_concepts.length > 0) {
      body.push(renderKeyConcepts(section.key_concepts));
    }
  }

  const figures = renderFigures(data);
  if (figures.length > 0) {
    body.push(heading(1, "Abbildungen und Visualisierungen"), ...figures);
  }

  if (data.formulas.length > 0) {
    body.push(divider("Rechnen"), heading(1, "Formeln und Berechnungen"));
    for (const formula of data.formulas) {
      body.push(
        `#sb-formula(
  name: ${typstString(formula.name)},
  variables: ${stringTuple(formula.variables)},
  units: ${stringTuple(formula.units)},
  source: ${sourceReferenceList(data, formula.source_ids) ?? typstString("Allgemeine Fachtheorie")},
  note: [${text(formula.context)}],
)[
  ${math(formula.typst)}
]
`,
      );
    }
  }

  if (data.worked_examples.length > 0) {
    body.push(divider("Anwenden"), heading(1, "Durchgerechnete Beispiele"));
    for (const [index, example] of data.worked_examples.entries()) {
      body.push(
        `#sb-example(
  title: ${typstString(`Beispiel ${index + 1}`)},
  result: [${text(example.result)}],
)[
  #text(weight: "bold")[Aufgabe:] ${text(example.prompt)}
  ${sourceLine(data, example.source_ids) ?? ""}
  #v(4pt)
  ${numberedList(example.steps)}
]
`,
      );
    }
  }

  if (data.quiz_style_questions.length > 0) {
    body.push(divider("Prüfen"), heading(1, "Kontrollfragen"));
    for (const [index, item] of data.quiz_style_questions.entries()) {
      body.push(
        heading(2, `Frage ${index + 1}`),
        paragraph(item.question),
        sourceLine(data, item.source_ids) ?? "",
        paragraph(`Antwort: ${item.answer}`),
      );
    }
  }

  body.push(divider("Nachweise"), heading(1, "Quellenverzeichnis"));
  for (const source of data.sources) {
    body.push(sourceEntry(data, source.id));
  }
  if (data.warnings.length > 0) {
    body.push(heading(1, "Quellenhinweise und Grenzen"));
    body.push(callout("Gebündelte Quellenhinweise", "warning", bulletList(data.warnings)));
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
    const caption = sourceReferenceList(data, figure.source_ids)
      ? `[${text(figure.caption)} #h(3pt) ${sourceReferenceList(data, figure.source_ids)}]`
      : typstString(figure.caption);
    if (asset.relative_path) {
      return [
        `#sb-figure(label-text: ${typstString(`Abb. ${index + 1}`)}, caption: ${caption})[
  #image(${typstString(asset.relative_path)}, width: 90%)
]
`,
      ];
    }
    // Planned diagrams and generation prompts are workflow metadata, not
    // student-facing figures. Omit them until a validated visual file exists.
    return [];
  });
}

function heading(level: number, value: string): string {
  return `#heading(level: ${level})[${text(value)}]`;
}

function divider(label?: string): string {
  return label ? `#sb-divider(label: ${typstString(label)})` : "#sb-divider()";
}

function paragraph(value: string): string {
  return `${text(value)}\n`;
}

function text(value: string): string {
  return renderTypstInlineText(value, (mathValue) => normalizeTypstMath(stripMathDelimiters(mathValue)));
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
    normalizeInlineMathSource(value)
      .replace(/µm/g, '"µm"')
      .replace(/°C/g, '"°C"')
      .replace(/_\(([A-Za-z][A-Za-z0-9 -]+)\)/g, (_, label: string) => `_"${label.trim()}"`)
      .replace(/([\p{Script=Greek}])(?=[A-Za-z])/gu, "$1 ")
      .replace(/([A-Za-z])(?=[\p{Script=Greek}])/gu, "$1 ")
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

function renderKeyConcepts(items: string[]): string {
  const ordered = isOrderedList(items);
  const normalizedItems = ordered ? items.map(stripLeadingNumber) : items;
  if (items.length <= 4) {
    return paragraph(`${ordered ? "Ablauf" : "Leitbegriffe"}: ${joinGermanList(normalizedItems)}.`);
  }
  return `${text(ordered ? "Ablauf:" : "Leitbegriffe:")}

${ordered ? numberedList(normalizedItems) : bulletList(normalizedItems)}`;
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return text("Keine Einträge.");
  }
  return items.map((item) => `- ${text(item)}`).join("\n");
}

function numberedList(items: string[]): string {
  if (items.length === 0) {
    return text("Keine Zwischenschritte angegeben.");
  }
  return items.map((item) => `+ ${text(item)}`).join("\n");
}

function callout(title: string, tone: string, body: string): string {
  return `#sb-callout(title: ${typstString(title)}, tone: ${typstString(tone)})[
  ${body}
]`;
}

function sourceNote(source: string, coverage: string): string {
  return `#sb-source-note(${typstString(source)}, coverage: ${typstString(coverage)})`;
}

function sourceNoteContent(source: string, coverage: string): string {
  return `#sb-source-note(${source}, coverage: ${coverage})`;
}

function sourceTitles(data: ExtractedData, ids: string[]): string {
  const requested = new Set(ids);
  return data.sources
    .filter((source) => requested.has(source.id))
    .map((source) => source.title)
    .join("; ");
}

function sourceLine(data: ExtractedData, ids: string[]): string | null {
  const refs = sourceReferenceList(data, ids);
  if (!refs) {
    return null;
  }
  return `#text(8pt, fill: rgb("#5b667a"))[
  #text(weight: "bold")[Quellen:] ${refs}
]`;
}

function sourceEntry(data: ExtractedData, id: string): string {
  const source = data.sources.find((item) => item.id === id);
  if (!source) {
    return "";
  }
  const label = sourceLabel(data, id);
  const sourceContent = `[${sourceRef(data, id)} #h(4pt) ${text(source.title)}]`;
  const parts = [
    source.url ? `#link(${typstString(source.url)})[${text(source.url)}]` : "",
    source.path ? text(source.path) : "",
    source.page ? text(`Seite ${source.page}`) : "",
  ].filter(Boolean);
  const coverage = parts.length > 0 ? `[${parts.join(" #text(\" · \") ")}]` : typstString(source.kind);
  return `${sourceNoteContent(sourceContent, coverage)} ${sourceAnchor(label)}`;
}

function sourceReferenceList(data: ExtractedData, ids: string[]): string | null {
  const refs = ids
    .map((id) => sourceRef(data, id))
    .filter((value) => value.length > 0);
  if (refs.length === 0) {
    return null;
  }
  return `[${refs.join(" #h(3pt) ")}]`;
}

function sourceRef(data: ExtractedData, id: string): string {
  const source = data.sources.find((item) => item.id === id);
  if (!source) {
    return "";
  }
  const label = sourceLabel(data, id);
  return `#sb-source-ref(${typstString(label)}, target: ${sourceAnchor(label)})`;
}

function sourceLabel(data: ExtractedData, id: string): string {
  const index = data.sources.findIndex((source) => source.id === id);
  return index >= 0 ? `Q${index + 1}` : "Q?";
}

function sourceAnchor(label: string): string {
  return `<source-${label.toLowerCase()}>`;
}

function isOrderedList(items: string[]): boolean {
  return items.length > 1 && items.every((item) => /^\s*\d+[.)]\s+/.test(item));
}

function stripLeadingNumber(item: string): string {
  return item.replace(/^\s*\d+[.)]\s+/, "");
}

function joinGermanList(items: string[]): string {
  if (items.length === 0) {
    return "keine gesondert extrahierten Begriffe";
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return `${items[0]} und ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`;
}

function stringTuple(values: string[]): string {
  if (values.length === 0) {
    return "()";
  }
  return `(${values.map((value) => typstString(cleanVisibleMathText(value))).join(", ")},)`;
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
