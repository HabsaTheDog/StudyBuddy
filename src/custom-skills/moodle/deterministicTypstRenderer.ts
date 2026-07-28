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
  const course = requestedCourse || data.course.title || (english ? "Moodle course" : "Moodle-Kurs");
  const body: string[] = [
    heading(1, english ? "How to use this guide" : "So arbeitest du mit dieser Unterlage"),
    paragraph(
      english
        ? "The learning blocks follow the course sequence. Each chapter map shows which official Moodle topics belong to that block. Rebuild the idea from the explanation, then use the mode-appropriate method, case, interpretation, procedure, or calculation and finish with the original course activities when available."
        : "Die Lernblöcke folgen der Kursreihenfolge. Die Kapitelübersicht zeigt jeweils, welche offiziellen Moodle-Themen zu diesem Block gehören. Erarbeite zuerst die Erklärung und nutze danach die zum Fach passende Methode, Fallanalyse, Interpretation, Vorgehensweise oder Rechnung sowie vorhandene Originalaktivitäten des Kurses.",
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
  const citedSourceIds = referencedSourceIds(data);
  for (const source of data.sources.filter((item) => citedSourceIds.has(item.id))) {
    body.push(sourceEntry(data, source.id));
  }
  const visibleWarnings = studentFacingWarnings(data.warnings);
  if (visibleWarnings.length > 0) {
    body.push(heading(1, english ? "Source notes and limitations" : "Quellenhinweise und Grenzen"));
    body.push(callout(english ? "Consolidated source notes" : "Gebündelte Quellenhinweise", "warning", bulletList(visibleWarnings, data.language)));
  }

  return `#import "study-buddy-components.typ": *

#sb-document(
  title: ${typstString(title)},
  short-title: ${typstString(shortTitle(title))},
  course: ${typstString(course)},
  kind: ${typstString(documentKind(context.profile, data.language))},
  language: ${typstString(data.language)},
  semester: ${typstString(currentSemester())},
  status: ${typstString(english ? "Validated" : "Validiert")},
  date: ${typstString(currentDate(data.language))},
  body: [
${body.map((part) => indent(part.trim(), 4)).join("\n\n")}
  ],
)
`;
}

function studentFacingWarnings(warnings: readonly string[]): string[] {
  return warnings.map((warning) => warning.replace(
    /\s+sowie offizielle (?:Themen|Topics)\s+\d{1,2}\s*[–-]\s*\d{1,2}[^.]*\b(?:nicht|not)\b[^.]*\.$/i,
    ".",
  )).filter((warning) => {
    // Chapter analyzers see only their local evidence. Their correct local
    // statement that "this part only covers topics X–Y" becomes false and
    // confusing after all chapters are merged into one document.
    const crossChapterScopeNote =
      /(?:auftrag|request)/i.test(warning) &&
      /(?:only|nur|ausschließlich)/i.test(warning) &&
      /(?:thema|themen|topic|topics)\s+\d/i.test(warning) &&
      /(?:unbelegt|not covered|unsupported|keine?[^.]{0,40}(?:quelle|evidenz|aufgabeninhalt)|liegt[^.]{0,50}(?:keine|nicht))/i
        .test(warning);
    return !crossChapterScopeNote;
  });
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

function renderLearningModules(data: ExtractedData): string[] {
  const body: string[] = [];
  const moduleResourceIds = new Set(data.learning_modules.flatMap((module) => module.resource_ids));

  for (const [moduleIndex, module] of data.learning_modules.entries()) {
    const sections = data.sections.filter((section) => belongsToModule(section.source_ids, module));
    const formulas = data.formulas.filter((formula) => belongsToModule(formula.source_ids, module));
    const figures = data.figures.filter((figure) => belongsToModule(figure.source_ids, module));
    const examples = data.worked_examples.filter((example) => belongsToModule(example.source_ids, module));
    if (sections.length + formulas.length + figures.length + examples.length === 0) continue;

    body.push(
      divider(`${data.language === "en" ? "Learning block" : "Lernblock"} ${moduleIndex + 1}`),
      heading(1, module.title),
      renderChapterRoadmap(module, data.language),
    );
    const figuresBySection = assignToSections(figures, sections, (figure) =>
      `${figure.caption} ${figure.placement_hint}`
    );
    const formulasBySection = assignToSections(formulas, sections, (formula) =>
      `${formula.name} ${formula.context} ${formula.variables.join(" ")}`
    );
    const examplesBySection = assignToSections(examples, sections, (example) =>
      `${example.learning_goal} ${example.prompt} ${example.steps.join(" ")}`
    );

    for (const [sectionIndex, section] of sections.entries()) {
      body.push(...renderModuleSection(data, section));
      const inlineFigures = figuresBySection.get(sectionIndex) ?? [];
      for (const figure of inlineFigures) {
        const rendered = renderFigure(data, figure, data.figures.indexOf(figure));
        if (rendered) body.push(rendered);
      }
      const inlineFormulas = formulasBySection.get(sectionIndex) ?? [];
      if (inlineFormulas.length > 0) {
        body.push(heading(3, data.language === "en" ? "Method and formulas" : "Methode und Formeln"));
        body.push(...inlineFormulas.map((formula) => renderFormula(data, formula)));
      }
      const inlineExamples = examplesBySection.get(sectionIndex) ?? [];
      if (inlineExamples.length > 0) {
        body.push(heading(3, data.language === "en" ? "See the method in action" : "Die Methode im Beispiel"));
        body.push(...inlineExamples.map((example) => renderExample(data, example)));
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
      body.push(...examples.map((example) => renderExample(data, example)));
    }
    const practice = modulePracticeItems(module);
    if (practice.length > 0) {
      body.push(
        heading(2, data.language === "en" ? "Practice route" : "Übungsweg"),
        paragraph(data.language === "en"
          ? "Use these course activities to check the topics in this chapter:"
          : "Mit diesen Kursaktivitäten prüfst du die Themen dieses Kapitels:"),
        bulletList(practice, data.language),
      );
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
    if (section.key_concepts.length > 0) {
      body.push(callout(
        data.language === "en" ? "Learning focus" : "Lernfokus",
        "info",
        isOrderedList(section.key_concepts)
          ? numberedList(section.key_concepts.map(stripLeadingNumber), data.language)
          : paragraph(joinLocalizedList(section.key_concepts, data.language)),
      ));
    }
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

function renderChapterRoadmap(
  module: LearningModule,
  language: ExtractedData["language"],
): string {
  const english = language === "en";
  const rows = courseTopicRows(module.learning_objectives);
  if (rows.length === 0) {
    return `${text(english ? "This chapter covers" : "Dieses Kapitel behandelt")}: ${text(
      joinLocalizedList(module.learning_objectives.slice(0, 4), language),
    )}.`;
  }
  const tableRows = rows.slice(0, 12).map((row) =>
    `([#text(weight: "bold")[${text(row.label)}]], [${renderRoadmapFocus(row)}])`
  ).join(",\n    ");
  return `// study-buddy:chapter-roadmap
#sb-table-section(${typstString(english ? "Course map for this chapter" : "Kursübersicht für dieses Kapitel")})[
  #sb-table(
    columns: (25mm, 1fr),
    header: (${typstString(english ? "Moodle topic" : "Moodle-Thema")}, ${typstString(english ? "Learning focus" : "Lernschwerpunkt")}),
    rows: (
    ${tableRows},
    ),
    compact: true,
  )
]`;
}

type CourseTopicRow = { label: string; title: string; details: string[] };

function renderRoadmapFocus(row: CourseTopicRow): string {
  const details = row.details.map((detail) =>
    `#linebreak() #text(fill: rgb("#5b667a"))[• ${text(detail)}]`
  ).join("");
  return `#text(weight: "semibold")[${text(row.title)}]${details}`;
}

function renderModuleSection(
  data: ExtractedData,
  section: LearningSection,
): string[] {
  const body = [
    heading(2, conciseSectionHeading(section.heading)),
    paragraph(section.summary),
  ];
  const sources = sourceLine(data, section.source_ids);
  if (sources) body.push(sources);
  if (section.key_concepts.length === 0) return body;

  body.push(
    `#text(weight: "bold")[${text(data.language === "en" ? "Learning focus:" : "Lernfokus:")}]`,
    isOrderedList(section.key_concepts)
      ? numberedList(section.key_concepts.map(stripLeadingNumber), data.language)
      : paragraph(joinLocalizedList(section.key_concepts, data.language)),
  );
  return body;
}

function courseTopicRows(objectives: string[]): CourseTopicRow[] {
  const grouped = new Map<string, { title: string; details: string[] }>();
  for (const objective of objectives) {
    const match = /^(Thema|Topic)\s+(\d{1,2})\s*[–-]\s*(.+)$/i.exec(objective.trim());
    if (!match) continue;
    const label = `${match[1]} ${match[2]}`;
    const remainder = match[3].trim();
    const dotSeparator = remainder.indexOf(" · ");
    const narrativeSeparator = remainder.search(/:\s+(?:In dieser|In this|This)\b/i);
    const genericSeparator = remainder.indexOf(":");
    const separator = dotSeparator >= 0
      ? { index: dotSeparator, length: 3 }
      : narrativeSeparator >= 0
        ? { index: narrativeSeparator, length: 1 }
        : genericSeparator >= 0
          ? { index: genericSeparator, length: 1 }
          : null;
    const title = (separator ? remainder.slice(0, separator.index) : remainder).trim();
    const detail = (separator ? remainder.slice(separator.index + separator.length) : "").trim();
    const existing = grouped.get(label) ?? { title, details: [] };
    if (detail && !existing.details.includes(detail)) existing.details.push(detail);
    grouped.set(label, existing);
  }
  return [...grouped].map(([label, topic]) => {
    const explicitDetails = topic.details.filter((detail) =>
      !/\.{4,}/.test(detail) &&
      /^\d+(?:\.\d+)*\s/.test(detail)
    );
    const candidates = explicitDetails.length > 0
      ? explicitDetails
      : topic.details.filter((detail) => !/\.{4,}/.test(detail)).slice(0, 1);
    const bySection = new Map<string, string>();
    for (const detail of candidates) {
      const section = /^(\d+(?:\.\d+)*)\s/.exec(detail)?.[1] ?? detail;
      const previous = bySection.get(section);
      if (!previous || detail.length > previous.length) bySection.set(section, detail);
    }
    return {
      label,
      title: conciseText(topic.title, 72),
      details: [...bySection.values()].slice(0, 3).map((detail) => conciseText(detail, 92)),
    };
  });
}

function conciseSectionHeading(value: string): string {
  const cleaned = value.replace(/^\s*\d+[.)]\s*/, "").trim();
  const officialTopic = /^((?:Thema|Topic)\s+\d{1,2}\s*[–-]\s*[^:·]+)(?::.*)$/i.exec(cleaned);
  return officialTopic?.[1].trim() ?? cleaned;
}

function conciseText(value: string, limit: number): string {
  const cleaned = cleanOuterProseArtifact(value);
  if (cleaned.length <= limit) return cleaned;
  const sentence = cleaned.slice(0, limit + 1).match(/^(.{40,}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence;
  return `${cleaned.slice(0, limit - 1).trimEnd()}…`;
}

function modulePracticeItems(module: LearningModule): string[] {
  const byTopic = new Map<string, string>();
  const ungrouped: string[] = [];
  for (const signal of module.assessment_signals) {
    const topic = /\b(?:Thema|Topic)\s+(\d{1,2})\b/i.exec(signal)?.[1];
    if (topic) {
      if (!byTopic.has(topic)) byTopic.set(topic, signal);
    } else if (!ungrouped.includes(signal)) {
      ungrouped.push(signal);
    }
  }
  return [...byTopic.values(), ...ungrouped].slice(0, 12);
}

function renderFormula(data: ExtractedData, formula: LearningFormula): string {
  const lines = readableFormulaLines(formula.typst);
  const compact = lines.some((line) => line.length > 68);
  return `#sb-formula(
  name: ${typstString(formula.name)},
  variables: ${stringTuple(formula.variables)},
  units: ${stringTuple(formula.units)},
  source: ${sourceReferenceList(data, formula.source_ids) ?? typstString(data.language === "en" ? "General subject theory" : "Allgemeine Fachtheorie")},
  note: [${proseText(formula.context)}],
  compact: ${compact},
)[
  ${lines.map(math).join("\n  #linebreak()\n  ")}
]
`;
}

function readableFormulaLines(value: string): string[] {
  const body = stripMathDelimiters(value);
  const parts = body
    .split(/\s*(?:;\s*quad|,\s*quad|,\s*space)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [body];
}

function renderExample(data: ExtractedData, example: WorkedExample): string {
  return `#sb-example(
  title: ${typstString(example.learning_goal)},
  result: [${proseText(example.result)}],
)[
  #text(weight: "bold")[${data.language === "en" ? "Starting point" : "Ausgangslage"}:] ${proseText(example.prompt)}
  ${sourceLine(data, example.source_ids) ?? ""}
  #v(4pt)
  ${renderExampleSteps(example.steps, data.language)}
]
`;
}

function renderExampleSteps(
  steps: string[],
  language: ExtractedData["language"],
): string {
  if (steps.length === 0) return numberedList([], language);
  const rows = steps.map((step) =>
    `[${renderReadableExampleStep(cleanOuterProseArtifact(step))}]`
  ).join(",\n    ");
  return `#sb-steps(
  rows: (
    ${rows},
  ),
)`;
}

function renderReadableExampleStep(value: string): string {
  const colon = value.indexOf(":");
  if (colon < 0) return text(value);
  const label = value.slice(0, colon + 1).trim();
  const calculation = value.slice(colon + 1).trim().replace(/[.]$/, "");
  const equalityParts = calculation.split(/\s*=\s*/).map((part) => part.trim()).filter(Boolean);
  if (
    value.length < 75 ||
    equalityParts.length < 4 ||
    calculation.includes(";") ||
    /(?:gegeben|gesucht|starting point|given)/i.test(label)
  ) return text(value);

  const firstLine = `${equalityParts[0]} = ${equalityParts[1]}`;
  const continuation = equalityParts.slice(2).map((part) => `= ${part}`);
  return `${text(label)}
#v(2pt)
#block(inset: (left: 7pt))[
  ${[firstLine, ...continuation].map(math).join("\n  #linebreak()\n  ")}
]`;
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
      const headingTerms = teachingTerms(section.heading);
      const sectionTerms = teachingTerms(
        `${section.heading} ${section.summary} ${section.key_concepts.join(" ")}`,
      );
      const score = [...itemTerms].reduce(
        (sum, term) => sum + (headingTerms.has(term) ? 3 : sectionTerms.has(term) ? 1 : 0),
        0,
      );
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
  if (!isReadableTeachingFigure(asset, figure)) return null;
  const visibleIndex = data.figures
    .filter((candidate) => {
      const candidateAsset = assetsById.get(candidate.asset_id);
      return Boolean(candidateAsset?.relative_path) &&
        isReadableTeachingFigure(candidateAsset!, candidate);
    })
    .indexOf(figure);
  const caption = sourceReferenceList(data, figure.source_ids)
    ? `[${text(figure.caption)} #h(3pt) ${sourceReferenceList(data, figure.source_ids)}]`
    : typstString(figure.caption);
  return `#sb-figure(label-text: ${typstString(`${data.language === "en" ? "Fig." : "Abb."} ${visibleIndex >= 0 ? visibleIndex + 1 : index + 1}`)}, caption: ${caption})[
  #image(${typstString(asset.relative_path)}, width: 90%)
]
`;
}

function isReadableTeachingFigure(
  asset: ExtractedData["visual_assets"][number],
  _figure: LearningFigure,
): boolean {
  // A rasterized full PDF page is source evidence, not a teaching figure.
  // It duplicates text/formulas at a smaller scale and cannot be cropped
  // reliably without semantic bounding boxes. Embedded source figures and
  // generated diagrams remain available.
  const rasterPage = asset.kind === "moodle_pdf_page" &&
    (/(?:png|jpe?g)$/i.test(asset.relative_path ?? "") ||
      /^image\/(?:png|jpe?g)$/i.test(asset.mime_type ?? ""));
  return !rasterPage;
}

function heading(level: number, value: string): string {
  return `#heading(level: ${level})[${text(value)}]`;
}

function divider(label?: string): string {
  return label ? `#sb-divider(label: ${typstString(label)})` : "#sb-divider()";
}

function paragraph(value: string): string {
  return `${proseText(value)}\n`;
}

function text(value: string): string {
  const rendered = renderTypstInlineText(
    value,
    (mathValue) => normalizeTypstMath(stripMathDelimiters(mathValue)),
  );
  return rendered.startsWith("[") && rendered.endsWith("]")
    ? rendered.slice(1, -1)
    : rendered;
}

function proseText(value: string): string {
  return text(cleanOuterProseArtifact(value));
}

function cleanOuterProseArtifact(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length > 12 &&
    trimmed.startsWith("[") &&
    trimmed.endsWith("]") &&
    /[A-Za-zÄÖÜäöüß]{3}/.test(trimmed)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
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
  // Analyzer formula fields represent one complete math expression. Models
  // occasionally splice Markdown-style inline math segments into that field
  // (`$f(x)$ for $x != 0$`), which would prematurely close the renderer's
  // single Typst math block. Removing the redundant inner delimiters preserves
  // the expression and lets quoteBareMathText handle connecting prose.
  return body.replace(/\$/g, " ").replace(/\s+/g, " ").trim();
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
  const normalizedVectors = replaceTypstMathFunctionCalls(
    normalizeCurriedBinaryFunction(normalized, "frac"),
    "vec",
    (argument) => `vec(${argument.replace(/;/g, ",")})`,
  );
  return quoteBareMathText(replaceTypstMathFunctionCalls(
    normalizedVectors,
    "ddot",
    (argument) => `accent(${argument}, dot.double)`,
  ));
}

function normalizeCurriedBinaryFunction(value: string, functionName: string): string {
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
    const firstClose = findMatchingParen(result, firstOpen);
    if (firstClose < 0) break;
    let secondOpen = firstClose + 1;
    while (/\s/.test(result[secondOpen] ?? "")) secondOpen += 1;
    if (result[secondOpen] !== "(") {
      cursor = firstClose + 1;
      continue;
    }
    const secondClose = findMatchingParen(result, secondOpen);
    if (secondClose < 0) break;
    const numerator = result.slice(firstOpen + 1, firstClose).trim();
    const denominator = result.slice(secondOpen + 1, secondClose).trim();
    result =
      `${result.slice(0, index)}${functionName}(${numerator}, ${denominator})` +
      result.slice(secondClose + 1);
    cursor = index + functionName.length + numerator.length + denominator.length + 4;
  }
  return result;
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

function referencedSourceIds(data: ExtractedData): Set<string> {
  return new Set([
    ...data.sections.flatMap((section) => section.source_ids),
    ...data.formulas.flatMap((formula) => formula.source_ids),
    ...data.figures.flatMap((figure) => figure.source_ids),
    ...data.worked_examples.flatMap((example) => example.source_ids),
    ...data.quiz_style_questions.flatMap((item) => item.source_ids),
  ]);
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
  items = items.map((item) => cleanOuterProseArtifact(item).replace(/[.;:,]+\s*$/, ""));
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
