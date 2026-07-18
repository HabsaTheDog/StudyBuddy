import type { ExtractedData } from "./schemas.js";
import type { SourceCoverage } from "./runDiagnostics.js";
import type { ArtifactProfile } from "./examNavigatorContracts.js";
import {
  cleanVisibleMathText,
  normalizeInlineMathSource,
  quoteBareMathText,
  renderTypstInlineText,
} from "./typstInlineMath.js";

export function renderDeterministicStudyDocument(
  data: ExtractedData,
  coverage: SourceCoverage,
  context: { prompt?: string; profile?: ArtifactProfile } = {},
): string {
  const english = data.language === "en";
  const requestedCourse = explicitCourseAlias(context.prompt ?? "");
  const title = requestedCourse
    ? `${requestedCourse} – Study Guide`
    : data.document_title || (english ? "Study Buddy Study Guide" : "Study Buddy Lernunterlage");
  const course = requestedCourse || data.course.title || "FH Technikum Wien";
  const body: string[] = [
    heading(1, english ? "Document note" : "Dokumenthinweis"),
    paragraph(
      english
        ? "Specific laboratory requirements come from the Moodle and CIS material listed in the references. General derivations are identified as subject theory; measurements must be collected and documented in the laboratory."
        : "Konkrete Laborvorgaben stammen aus den im Quellenverzeichnis genannten Moodle- und CIS-Inhalten. Allgemeine Herleitungen sind als Fachtheorie gekennzeichnet; Messwerte müssen im Labor erhoben und dokumentiert werden.",
    ),
    sourceNote(
      english ? "Source coverage" : "Quellenabdeckung",
      english
        ? `Moodle: ${coverage.moodle.status}, ${coverage.moodle.pages} page(s). CIS: ${coverage.cis.status}, ${coverage.cis.pages} page(s).`
        : `Moodle: ${coverage.moodle.status}, ${coverage.moodle.pages} Seite(n). CIS: ${coverage.cis.status}, ${coverage.cis.pages} Seite(n).`,
    ),
  ];

  body.push(...(
    data.learning_modules.length > 0
      ? renderLearningModules(data)
      : renderFlatLearningContent(data)
  ));

  if (data.quiz_style_questions.length > 0) {
    body.push(divider(english ? "Review" : "Prüfen"), heading(1, english ? "Review questions" : "Kontrollfragen"));
    for (const [index, item] of data.quiz_style_questions.entries()) {
      body.push(
        heading(2, `${english ? "Question" : "Frage"} ${index + 1}`),
        paragraph(item.question),
        sourceLine(data, item.source_ids) ?? "",
        paragraph(`${english ? "Answer" : "Antwort"}: ${item.answer}`),
      );
    }
  }

  body.push(divider(english ? "Evidence" : "Nachweise"), heading(1, english ? "References" : "Quellenverzeichnis"));
  for (const source of data.sources) {
    body.push(sourceEntry(data, source.id));
  }
  if (data.warnings.length > 0) {
    body.push(heading(1, english ? "Source notes and limitations" : "Quellenhinweise und Grenzen"));
    body.push(callout(english ? "Consolidated source notes" : "Gebündelte Quellenhinweise", "warning", bulletList(data.warnings, data.language)));
  }

  return `#import "study-buddy-components.typ": *

#sb-document(
  title: ${typstString(title)},
  short-title: ${typstString(shortTitle(title))},
  course: ${typstString(course)},
  kind: ${typstString(documentKind(context.profile, data.language))},
  semester: ${typstString(currentSemester())},
  status: ${typstString(english ? "Validated" : "Validiert")},
  date: ${typstString(currentDate(data.language))},
  body: [
${body.map((part) => indent(part.trim(), 4)).join("\n\n")}
  ],
)
`;
}

function explicitCourseAlias(prompt: string): string | null {
  const ignored = new Set(["PDF", "HTML", "TYPST", "CI", "OCR", "CIS", "Moodle"]);
  for (const match of prompt.matchAll(/\b[A-ZÄÖÜ]{2,8}\d{0,2}\b/g)) {
    const alias = match[0];
    if (!ignored.has(alias)) return alias;
  }
  return null;
}

function documentKind(profile: ArtifactProfile | undefined, language: ExtractedData["language"]): string {
  const english = language === "en";
  switch (profile) {
    case "practice_pack": return english ? "Exam Practice" : "Prüfungstraining";
    case "exam_navigator": return english ? "Exam Preparation" : "Prüfungsvorbereitung";
    case "source_audit": return english ? "Source Report" : "Quellenbericht";
    case "interactive_learning": return english ? "Interactive Learning Guide" : "Interaktive Lernunterlage";
    default: return "Study Guide";
  }
}

type LearningModule = ExtractedData["learning_modules"][number];
type LearningSection = ExtractedData["sections"][number];
type LearningFormula = ExtractedData["formulas"][number];
type LearningFigure = ExtractedData["figures"][number];
type WorkedExample = ExtractedData["worked_examples"][number];
type TeachingPattern = "lookup" | "case" | "failure" | "path" | "visual";

function renderLearningModules(data: ExtractedData): string[] {
  const body: string[] = [];
  const moduleResourceIds = new Set(data.learning_modules.flatMap((module) => module.resource_ids));

  for (const [moduleIndex, module] of data.learning_modules.entries()) {
    const sections = data.sections.filter((section) => belongsToModule(section.source_ids, module));
    const formulas = data.formulas.filter((formula) => belongsToModule(formula.source_ids, module));
    const figures = data.figures.filter((figure) => belongsToModule(figure.source_ids, module));
    const examples = data.worked_examples.filter((example) => belongsToModule(example.source_ids, module));
    if (sections.length + formulas.length + figures.length + examples.length === 0) continue;

    const pattern = teachingPattern(module, moduleIndex);
    body.push(
      divider(patternLabel(pattern, data.language)),
      heading(1, module.title),
      renderModuleOpening(module, pattern, data.language),
    );
    const figuresBySection = assignToSections(figures, sections, (figure) =>
      `${figure.caption} ${figure.placement_hint}`
    );
    const formulasBySection = assignToSections(formulas, sections, (formula) =>
      `${formula.name} ${formula.context} ${formula.variables.join(" ")}`
    );

    for (const [sectionIndex, section] of sections.entries()) {
      body.push(...renderModuleSection(data, section, sectionIndex, pattern));
      const inlineFigures = figuresBySection.get(sectionIndex) ?? [];
      for (const figure of inlineFigures) {
        const rendered = renderFigure(data, figure, data.figures.indexOf(figure));
        if (rendered) body.push(rendered);
      }
      const inlineFormulas = formulasBySection.get(sectionIndex) ?? [];
      if (inlineFormulas.length > 0) {
        body.push(heading(3, formulaGroupLabel(pattern, section, data.language)));
        body.push(...inlineFormulas.map((formula) => renderFormula(data, formula)));
      }
    }

    // Modules without explanatory sections are rare but must not lose their
    // validated visuals or formulas.
    if (sections.length === 0) {
      for (const figure of figures) {
        const rendered = renderFigure(data, figure, data.figures.indexOf(figure));
        if (rendered) body.push(rendered);
      }
      body.push(...formulas.map((formula) => renderFormula(data, formula)));
    }

    if (examples.length > 0) {
      body.push(heading(2, exampleGroupLabel(pattern, data.language)));
      body.push(...examples.map((example) => renderExample(data, example)));
    }
  }

  const remainingSections = data.sections.filter((section) =>
    !section.source_ids.some((id) => moduleResourceIds.has(id))
  );
  const remainingFormulas = data.formulas.filter((formula) =>
    !formula.source_ids.some((id) => moduleResourceIds.has(id))
  );
  const remainingFigures = data.figures.filter((figure) =>
    !figure.source_ids.some((id) => moduleResourceIds.has(id))
  );
  const remainingExamples = data.worked_examples.filter((example) =>
    !example.source_ids.some((id) => moduleResourceIds.has(id))
  );
  if (
    remainingSections.length + remainingFormulas.length +
    remainingFigures.length + remainingExamples.length > 0
  ) {
    body.push(
      divider(data.language === "en" ? "Additional material" : "Ergänzen"),
      heading(1, data.language === "en" ? "Additional course content" : "Ergänzende Kursinhalte"),
    );
    body.push(...renderFlatLearningContent({
      ...data,
      sections: remainingSections,
      formulas: remainingFormulas,
      figures: remainingFigures,
      worked_examples: remainingExamples,
      learning_modules: [],
    }));
  }
  return body;
}

function renderFlatLearningContent(data: ExtractedData): string[] {
  const body: string[] = [];
  for (const [index, section] of data.sections.entries()) {
    if (index > 0) body.push(divider());
    body.push(heading(1, section.heading), paragraph(section.summary));
    const sectionSources = sourceLine(data, section.source_ids);
    if (sectionSources) body.push(sectionSources);
    if (section.key_concepts.length > 0) body.push(renderKeyConcepts(section.key_concepts, data.language));
  }
  const figures = renderFigures(data);
  if (figures.length > 0) body.push(heading(1, data.language === "en" ? "Figures and visualizations" : "Abbildungen und Visualisierungen"), ...figures);
  if (data.formulas.length > 0) {
    body.push(
      divider(data.language === "en" ? "Calculate" : "Rechnen"),
      heading(1, data.language === "en" ? "Formulas and calculations" : "Formeln und Berechnungen"),
    );
    body.push(...data.formulas.map((formula) => renderFormula(data, formula)));
  }
  if (data.worked_examples.length > 0) {
    body.push(
      divider(data.language === "en" ? "Apply" : "Anwenden"),
      heading(1, data.language === "en" ? "Worked examples" : "Durchgerechnete Beispiele"),
    );
    body.push(...data.worked_examples.map((example) => renderExample(data, example)));
  }
  return body;
}

function belongsToModule(sourceIds: string[], module: LearningModule): boolean {
  const resourceIds = new Set(module.resource_ids);
  return sourceIds.some((id) => resourceIds.has(id));
}

function teachingPattern(module: LearningModule, index: number): TeachingPattern {
  const title = normalizeTeachingText(module.title);
  if (/(?:toleranz|passung|tabelle|nachschlag)/.test(title)) return "lookup";
  if (/(?:kleb|klebstoff|fuge)/.test(title)) return "case";
  if (/(?:niet|schraub|versag|bruch)/.test(title)) return "failure";
  if (/(?:loet|lotverbindung|dimensionier)/.test(title)) return "path";
  if (/(?:tribolog|hertz|kontakt|diagramm)/.test(title)) return "visual";
  const quantitative: TeachingPattern[] = ["case", "path", "failure"];
  const mixed: TeachingPattern[] = ["visual", "lookup", "path"];
  const conceptual: TeachingPattern[] = ["visual", "case", "failure"];
  const patterns = module.content_mode === "quantitative"
    ? quantitative
    : module.content_mode === "mixed"
      ? mixed
      : conceptual;
  return patterns[index % patterns.length];
}

function patternLabel(pattern: TeachingPattern, language: ExtractedData["language"]): string {
  const english = language === "en";
  switch (pattern) {
    case "lookup": return english ? "Look up" : "Nachschlagen";
    case "case": return english ? "Design" : "Entwerfen";
    case "failure": return english ? "Check failure" : "Versagen prüfen";
    case "path": return english ? "Calculation path" : "Rechenweg";
    case "visual": return english ? "Understand the model" : "Modell verstehen";
  }
}

function renderModuleOpening(
  module: LearningModule,
  pattern: TeachingPattern,
  language: ExtractedData["language"],
): string {
  const english = language === "en";
  const goals = module.learning_objectives.slice(0, 4);
  const signals = module.assessment_signals.slice(0, 3);
  const titles: Record<TeachingPattern, string> = {
    lookup: english ? "Orientation in the lookup path" : "Orientierung im Tabellenweg",
    case: english ? "Guiding design question" : "Konstruktive Leitfrage",
    failure: english ? "What must the verification prevent?" : "Was muss der Nachweis verhindern?",
    path: english ? "Goal of the calculation path" : "Ziel des Rechenwegs",
    visual: english ? "From the figure to the model" : "Vom Bild zum Modell",
  };
  const content = [
    goals.length > 0
      ? bulletList(goals, language)
      : text(english ? "Apply the core idea from the following course sections confidently." : "Die Kernidee aus den folgenden Kursabschnitten sicher anwenden."),
    signals.length > 0
      ? `#v(3pt)\n#text(8pt, weight: "bold")[${english ? "Assessment signals" : "Prüfungssignale"}:] ${text(joinLocalizedList(signals, language))}`
      : "",
  ].filter(Boolean).join("\n");
  return callout(titles[pattern], pattern === "failure" ? "warning" : "info", content);
}

function renderModuleSection(
  data: ExtractedData,
  section: LearningSection,
  index: number,
  pattern: TeachingPattern,
): string[] {
  const body = [
    heading(2, section.heading.replace(/^\s*\d+[.)]\s*/, "")),
    paragraph(section.summary),
  ];
  const sources = sourceLine(data, section.source_ids);
  if (sources) body.push(sources);
  if (section.key_concepts.length === 0) return body;

  if (pattern === "lookup") {
    body.push(heading(3, data.language === "en"
      ? index === 0 ? "Separate the terms first" : "Lookup and decision step"
      : index === 0 ? "Begriffe zuerst sauber trennen" : "Nachschlage- und Entscheidungsschritt"));
    body.push(isOrderedList(section.key_concepts)
      ? numberedList(section.key_concepts.map(stripLeadingNumber), data.language)
      : bulletList(section.key_concepts, data.language));
  } else if (pattern === "case") {
    const [consequence, ...details] = section.key_concepts;
    body.push(heading(3, data.language === "en" ? "Design consequence" : "Konstruktive Konsequenz"), paragraph(consequence));
    if (details.length > 0) body.push(renderKeyConcepts(details, data.language));
  } else if (pattern === "failure") {
    body.push(heading(3, data.language === "en" ? "Failure check" : "Versagenscheck"), bulletList(section.key_concepts, data.language));
  } else if (pattern === "visual") {
    body.push(heading(3, data.language === "en" ? "What to look for in the model" : "Worauf du im Modell achten solltest"), bulletList(section.key_concepts, data.language));
  } else {
    body.push(isOrderedList(section.key_concepts)
      ? numberedList(section.key_concepts.map(stripLeadingNumber), data.language)
      : renderKeyConcepts(section.key_concepts, data.language));
  }
  return body;
}

function formulaGroupLabel(
  pattern: TeachingPattern,
  section: LearningSection,
  language: ExtractedData["language"],
): string {
  if (language === "en") {
    if (pattern === "lookup") return `Calculation tools for “${section.heading}”`;
    if (pattern === "failure") return "Verification equations for this failure mode";
    if (pattern === "visual") return "From the model to the equation";
    if (pattern === "case") return "Quantities used in the design";
    return "Formulas for this calculation step";
  }
  if (pattern === "lookup") return `Rechenwerkzeuge zu „${section.heading}“`;
  if (pattern === "failure") return "Nachweisgleichungen für diesen Versagensfall";
  if (pattern === "visual") return "Vom Modell zur Gleichung";
  if (pattern === "case") return "Größen für die Auslegung";
  return "Formeln für diesen Rechenschritt";
}

function exampleGroupLabel(pattern: TeachingPattern, language: ExtractedData["language"]): string {
  const english = language === "en";
  switch (pattern) {
    case "lookup": return english ? "Apply the complete lookup path" : "Den Tabellenweg vollständig anwenden";
    case "case": return english ? "Work through the guiding design question" : "Die Leitfrage als Entwurf durchrechnen";
    case "failure": return english ? "Combine the verifications in one load case" : "Die Nachweise in einem Lastfall bündeln";
    case "path": return english ? "From the initial approach to the plausibility check" : "Vom Ansatz bis zur Plausibilitätskontrolle";
    case "visual": return english ? "From the contact model to a numerical value" : "Vom Kontaktmodell zum Zahlenwert";
  }
}

function renderFormula(data: ExtractedData, formula: LearningFormula): string {
  return `#sb-formula(
  name: ${typstString(formula.name)},
  variables: ${stringTuple(formula.variables)},
  units: ${stringTuple(formula.units)},
  source: ${sourceReferenceList(data, formula.source_ids) ?? typstString(data.language === "en" ? "General subject theory" : "Allgemeine Fachtheorie")},
  note: [${text(formula.context)}],
)[
  ${math(formula.typst)}
]
`;
}

function renderExample(data: ExtractedData, example: WorkedExample): string {
  return `#sb-example(
  title: ${typstString(example.learning_goal)},
  result: [${text(example.result)}],
)[
  #text(weight: "bold")[${data.language === "en" ? "Starting point" : "Ausgangslage"}:] ${text(example.prompt)}
  ${sourceLine(data, example.source_ids) ?? ""}
  #v(4pt)
  ${numberedList(example.steps, data.language)}
]
`;
}

function assignToSections<T>(
  items: T[],
  sections: LearningSection[],
  describe: (item: T) => string,
): Map<number, T[]> {
  const assigned = new Map<number, T[]>();
  if (sections.length === 0) return assigned;
  for (const [itemIndex, item] of items.entries()) {
    const itemTerms = teachingTerms(describe(item));
    let bestIndex = itemIndex % sections.length;
    let bestScore = -1;
    for (const [sectionIndex, section] of sections.entries()) {
      const sectionTerms = teachingTerms(
        `${section.heading} ${section.summary} ${section.key_concepts.join(" ")}`,
      );
      const score = [...itemTerms].filter((term) => sectionTerms.has(term)).length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = sectionIndex;
      }
    }
    assigned.set(bestIndex, [...(assigned.get(bestIndex) ?? []), item]);
  }
  return assigned;
}

function teachingTerms(value: string): Set<string> {
  const ignored = new Set([
    "direkt", "abschnitt", "beispiel", "formel", "kursfolie", "platzieren",
    "sowie", "unter", "dieser", "diese", "einem", "einer", "beim", "fuer",
  ]);
  return new Set((normalizeTeachingText(value).match(/[a-z0-9]{5,}/g) ?? [])
    .map((term) => term.replace(/(?:ungen|ung|en|e|n|er|es)$/i, ""))
    .filter((term) => term.length >= 4 && !ignored.has(term)));
}

function normalizeTeachingText(value: string): string {
  return value.toLocaleLowerCase("de")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function renderFigures(data: ExtractedData): string[] {
  const assetsById = new Map(data.visual_assets.map((asset) => [asset.id, asset]));
  return data.figures.flatMap((figure, index) => {
    const rendered = renderFigure(data, figure, index, assetsById);
    return rendered ? [rendered] : [];
  });
}

function renderFigure(
  data: ExtractedData,
  figure: LearningFigure,
  index: number,
  assetsById = new Map(data.visual_assets.map((asset) => [asset.id, asset])),
): string | null {
  const asset = assetsById.get(figure.asset_id);
  if (!asset?.relative_path) return null;
  const caption = sourceReferenceList(data, figure.source_ids)
    ? `[${text(figure.caption)} #h(3pt) ${sourceReferenceList(data, figure.source_ids)}]`
    : typstString(figure.caption);
  return `#sb-figure(label-text: ${typstString(`${data.language === "en" ? "Fig." : "Abb."} ${index + 1}`)}, caption: ${caption})[
  #image(${typstString(asset.relative_path)}, width: 90%)
]
`;
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
  const normalized = normalizeInlineMathSource(value)
      .replace(/µm/g, '"µm"')
      .replace(/°C/g, '"°C"')
      .replace(
        /_\((?=[A-Za-z0-9 ,.-]*[A-Za-z])([A-Za-z0-9][A-Za-z0-9 ,.-]*)\)/g,
        (_, label: string) => `_"${label.trim()}"`,
      )
      .replace(/([\p{Script=Greek}])(?=[\p{Script=Greek}])/gu, "$1 ")
      .replace(/([\p{Script=Greek}])(?=[A-Za-z])/gu, "$1 ")
      .replace(/([A-Za-z])(?=[\p{Script=Greek}])/gu, "$1 ")
      .replace(/\\ddot\s*\{([^{}]+)\}/g, "accent($1, dot.double)")
      .replace(/\\dot\s*\{([^{}]+)\}/g, "dot($1)");
  return quoteBareMathText(replaceTypstMathFunctionCalls(
    normalized,
    "ddot",
    (argument) => `accent(${argument}, dot.double)`,
  ));
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

function renderKeyConcepts(items: string[], language: ExtractedData["language"]): string {
  const english = language === "en";
  const ordered = isOrderedList(items);
  const normalizedItems = ordered ? items.map(stripLeadingNumber) : items;
  if (items.length <= 4) {
    return paragraph(`${ordered ? english ? "Process" : "Ablauf" : english ? "Key concepts" : "Leitbegriffe"}: ${joinLocalizedList(normalizedItems, language)}.`);
  }
  return `${text(ordered ? english ? "Process:" : "Ablauf:" : english ? "Key concepts:" : "Leitbegriffe:")}

${ordered ? numberedList(normalizedItems, language) : bulletList(normalizedItems, language)}`;
}

function bulletList(items: string[], language: ExtractedData["language"] = "de"): string {
  if (items.length === 0) {
    return text(language === "en" ? "No entries." : "Keine Einträge.");
  }
  return items.map((item) => `- ${text(item)}`).join("\n");
}

function numberedList(items: string[], language: ExtractedData["language"] = "de"): string {
  if (items.length === 0) {
    return text(language === "en" ? "No intermediate steps were provided." : "Keine Zwischenschritte angegeben.");
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
  #text(weight: "bold")[${data.language === "en" ? "Sources" : "Quellen"}:] ${refs}
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
    source.page ? text(`${data.language === "en" ? "Page" : "Seite"} ${source.page}`) : "",
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

function joinLocalizedList(items: string[], language: ExtractedData["language"]): string {
  const conjunction = language === "en" ? "and" : "und";
  if (items.length === 0) {
    return language === "en" ? "no separately extracted terms" : "keine gesondert extrahierten Begriffe";
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return `${items[0]} ${conjunction} ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
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

function currentDate(language: ExtractedData["language"]): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function currentSemester(): string {
  const now = new Date();
  return `${now.getMonth() >= 2 && now.getMonth() <= 8 ? "SS" : "WS"} ${now.getFullYear()}`;
}
