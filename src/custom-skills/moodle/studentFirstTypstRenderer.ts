import type { StudyModel } from "./examNavigatorContracts.js";

export function renderStudentFirstTypst(model: StudyModel): string {
  const body: string[] = [];

  if (model.courseChapters.length === 0 && model.scopeNote) {
    body.push(`#sb-source-note("Quellenlage", coverage: ${typstString(model.scopeNote)})`);
  }

  const renderedTopicIds = new Set<string>();
  const renderedFormulaIds = new Set<string>();
  const renderedExampleIds = new Set<string>();
  const renderedFigureIds = new Set<string>();
  let figureNumber = 0;
  for (const chapter of model.courseChapters) {
    body.push(heading(1, chapter.title));
    const topics = model.topics.filter((topic) => topic.chapterId === chapter.id);
    if (topics.length === 0) {
      body.push(`#sb-callout(title: "Noch nicht abgedeckt", tone: "warning")[
  Dieses Moodle-Kapitel wurde erkannt, aber aus den lokal ausgewerteten Kursdateien konnte noch kein belastbarer Lerninhalt übernommen werden.
]`);
      continue;
    }
    for (const topic of topics) {
      renderedTopicIds.add(topic.id);
      if (topics.length > 1 || !sameSubject(topic.title, chapter.subject)) {
        body.push(heading(2, topic.title));
      }
      body.push(
        text(topic.summary),
        sourceLine(model, topic.sourceIds),
      );
      if (topic.learningGoals.length > 0) {
        body.push(heading(2, "Kernwissen"), bulletList(topic.learningGoals));
      }
    }

    const examples = model.workedExamples.filter((example) => example.chapterId === chapter.id);
    const figures = model.figures.filter((figure) => figure.chapterId === chapter.id);
    const exampleFigureIds = new Set(
      examples.flatMap((example) =>
        figuresForExample(figures, example, 1).map((figure) => figure.id)
      ),
    );
    const overviewFigures = figures.filter((figure) => !exampleFigureIds.has(figure.id));
    if (overviewFigures.length > 0) {
      body.push(heading(2, "Aus der Kursunterlage"));
      for (const figure of overviewFigures.slice(0, 2)) {
        renderedFigureIds.add(figure.id);
        figureNumber += 1;
        body.push(renderFigure(model, figure, figureNumber));
      }
    }

    const formulas = model.formulas.filter((formula) => formula.chapterId === chapter.id);
    if (formulas.length > 0) {
      const formulaBody: string[] = [];
      for (const formula of formulas) {
        renderedFormulaIds.add(formula.id);
        formulaBody.push(renderFormula(model, formula));
      }
      body.push(
        heading(2, "Formelwerkzeug"),
        `#sb-formula-group()[\n${indent(formulaBody.join("\n"), 2)}\n]`,
      );
    }

    if (examples.length > 0) {
      body.push(heading(2, "Schritt für Schritt anwenden"));
      for (const example of examples) {
        renderedExampleIds.add(example.id);
        const figureBlocks = figuresForExample(figures, example, 1)
          .filter((figure) => !renderedFigureIds.has(figure.id))
          .map((figure) => {
            renderedFigureIds.add(figure.id);
            figureNumber += 1;
            return renderFigure(model, figure, figureNumber, "Beispielbild");
          });
        body.push(renderExample(model, example, renderedExampleIds.size, figureBlocks));
      }
    }
  }

  const remainingTopics = model.topics.filter((topic) => !renderedTopicIds.has(topic.id));
  if (remainingTopics.length > 0) {
    body.push(heading(1, model.courseChapters.length ? "Weitere belegte Themen" : "Lernstoff"));
    for (const topic of remainingTopics) {
      body.push(
        heading(2, topic.title),
        text(topic.summary),
        sourceLine(model, topic.sourceIds),
        heading(3, "Kernwissen"),
        bulletList(topic.learningGoals),
      );
    }
  }

  const remainingFigures = model.figures.filter((figure) => !renderedFigureIds.has(figure.id));
  if (remainingFigures.length > 0) {
    body.push(heading(1, "Weitere Abbildungen und Tabellen"));
    for (const figure of remainingFigures) {
      renderedFigureIds.add(figure.id);
      figureNumber += 1;
      body.push(renderFigure(model, figure, figureNumber));
    }
  }

  const remainingFormulas = model.formulas.filter((formula) => !renderedFormulaIds.has(formula.id));
  if (remainingFormulas.length > 0) {
    const formulaBody: string[] = [];
    for (const formula of remainingFormulas) {
      formulaBody.push(renderFormula(model, formula));
    }
    body.push(
      heading(1, "Weitere belegte Formeln"),
      `#sb-formula-group()[\n${indent(formulaBody.join("\n"), 2)}\n]`,
    );
  }

  const remainingExamples = model.workedExamples.filter((example) => !renderedExampleIds.has(example.id));
  if (remainingExamples.length > 0) {
    body.push("#sb-divider(label: \"Anwenden\")", heading(1, "Weitere Rechenbeispiele"));
    for (const example of remainingExamples) {
      renderedExampleIds.add(example.id);
      const figureBlocks = figuresForExample(model.figures, example, 1)
        .filter((figure) => !renderedFigureIds.has(figure.id))
        .map((figure) => {
          renderedFigureIds.add(figure.id);
          figureNumber += 1;
          return renderFigure(model, figure, figureNumber, "Beispielbild");
        });
      body.push(renderExample(model, example, renderedExampleIds.size, figureBlocks));
    }
  }

  if (model.checklist.length > 0) {
    body.push(
      "#sb-divider(label: \"Lerncheck\")",
      heading(1, "Prüfungs-Checkliste"),
      text("Nutze diese Checkliste als Abschlusskontrolle."),
      `#sb-checklist((${model.checklist.map((item) => `\n  [${text(item)}],`).join("")}\n))`,
    );
  }

  if (model.practiceItems.length > 0) {
    body.push("#sb-divider(label: \"Training\")", heading(1, "Quellengebundenes Training"));
    for (const [index, item] of model.practiceItems.entries()) {
      body.push(
        heading(2, `Aufgabe ${index + 1}`),
        text(item.prompt),
        sourceLine(model, item.sourceIds),
        `#text(weight: "bold")[Lösung:] ${text(item.answer)}`,
      );
    }
  }

  body.push("#sb-divider(label: \"Nachweise\")", heading(1, "Quellen und Direktlinks"));
  body.push("#columns(2, gutter: 10pt)[");
  const citedSourceIds = new Set([
    ...model.topics.flatMap((topic) => topic.sourceIds),
    ...model.formulas.flatMap((formula) => formula.sourceIds),
    ...model.workedExamples.flatMap((example) => example.sourceIds),
    ...model.figures.flatMap((figure) => figure.sourceIds),
    ...model.practiceItems.flatMap((item) => item.sourceIds),
  ]);
  for (const [index, source] of model.sources.entries()) {
    if (!citedSourceIds.has(source.id)) continue;
    const label = `Q${index + 1}`;
    const target = `<source-q${index + 1}>`;
    const link = source.originUrl
      ? `#link(${typstString(source.originUrl)})[${text(source.title)}]`
      : text(source.title);
    body.push(
      `#block(width: 100%, breakable: false, inset: (y: 3pt))[
  #sb-source-ref(${typstString(label)}, target: ${target}) #h(4pt) ${link}
  #linebreak()
  #text(7pt, fill: rgb("#5b667a"))[${text(source.kind)}]
] ${target}`,
    );
  }
  body.push("]");
  if (model.warnings.length > 0) {
    body.push(
      heading(1, "Offene Quellenhinweise"),
      bulletList(model.warnings),
    );
  }

  return `#import "study-buddy-components.typ": *

#sb-document(
  title: ${typstString(model.title)},
  short-title: ${typstString(shortTitle(model.title))},
  course: ${typstString(model.courseTitle)},
  kind: ${typstString(kindLabel(model.profile))},
  semester: ${typstString(currentSemester())},
  status: ${typstString(statusLabel(model.publicationStatus))},
  date: ${typstString(currentDate())},
  compact: true,
  body: [
${body.map((entry) => indent(entry, 4)).join("\n\n")}
  ],
)
`;
}

function renderFormula(model: StudyModel, formula: StudyModel["formulas"][number]): string {
  return `#sb-formula(
  name: ${typstString(formula.name)},
  variables: ${stringTuple(formula.variables)},
  units: ${stringTuple(formula.units)},
  source: ${sourceReferences(model, formula.sourceIds)},
  note: ${typstString(formula.assumptions)},
)[
  $ ${formatFormulaMath(formula.expression)} $
]`;
}

function renderExample(
  model: StudyModel,
  example: StudyModel["workedExamples"][number],
  number: number,
  figureBlocks: string[] = [],
): string {
  const visuals = figureBlocks.length > 0
    ? `\n  #v(6pt)\n  ${figureBlocks.join("\n  #v(5pt)\n  ")}`
    : "";
  return `#sb-example(
  title: ${typstString(`Beispiel ${number}`)},
  result: [${text(example.result)}],
)[
  #text(weight: "bold")[Aufgabe:] ${text(example.prompt)}
  ${sourceLine(model, example.sourceIds)}
  ${visuals}
  #v(5pt)
  ${numberedList(example.steps)}
]`;
}

function renderFigure(
  model: StudyModel,
  figure: StudyModel["figures"][number],
  number: number,
  labelPrefix = "Abb.",
): string {
  const page = figure.sourcePage ? `, Seite ${figure.sourcePage}` : "";
  const caption = `[${text(`${figure.caption}${page}`)} #h(3pt) ${sourceReferences(model, figure.sourceIds)}]`;
  if (figure.relativePath) {
    const portrait = Boolean(
      figure.widthPx &&
      figure.heightPx &&
      figure.heightPx / figure.widthPx > 1.18
    );
    const width = portrait ? "72%" : "88%";
    const height = portrait ? "108mm" : "82mm";
    return `#sb-figure(label-text: ${typstString(`${labelPrefix} ${number}`)}, caption: ${caption})[
  #image(${typstString(figure.relativePath)}, width: ${width}, height: ${height}, fit: "contain")
]`;
  }
  if (figure.kind === "typst_diagram") {
    return `#sb-figure(label-text: ${typstString(`${labelPrefix} ${number}`)}, caption: ${caption})[
  #sb-block-diagram(("Eingang", "Zusammenhang", "Ergebnis"))
]`;
  }
  return `#sb-callout(title: "Vorgesehene Visualisierung", tone: "info")[
  ${text(figure.generationPrompt || figure.caption)}
]`;
}

function figuresForExample(
  figures: StudyModel["figures"],
  example: StudyModel["workedExamples"][number],
  limit: number,
): StudyModel["figures"] {
  const exampleSources = new Set(example.sourceIds);
  return figures
    .filter((figure) => figure.sourceIds.some((sourceId) => exampleSources.has(sourceId)))
    .sort((left, right) =>
      visualSpecificity(right) - visualSpecificity(left) ||
      left.title.localeCompare(right.title, "de")
    )
    .slice(0, limit);
}

function visualSpecificity(figure: StudyModel["figures"][number]): number {
  const value = `${figure.title} ${figure.caption}`.toLocaleLowerCase("de");
  return (
    (/\b(?:tabelle|table|diagramm|skizze|beispiel|rechnung|plot|kennlinie|schema|passung|toleranz)\b/.test(value) ? 2 : 0) +
    (figure.kind === "moodle_pdf_image" ? 1 : 0)
  );
}

function sameSubject(left: string, right: string): boolean {
  const normalize = (value: string) => value
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return leftValue.includes(rightValue) || rightValue.includes(leftValue);
}

function sourceLine(model: StudyModel, ids: string[]): string {
  return `#text(7.2pt, fill: rgb("#66708f"))[Belegt durch ${sourceReferences(model, ids, 4)}]`;
}

function sourceReferences(model: StudyModel, ids: string[], limit = Number.POSITIVE_INFINITY): string {
  const indices = ids
    .map((id) => model.sources.findIndex((source) => source.id === id))
    .filter((index) => index >= 0);
  const visible = indices.slice(0, limit)
    .map((index) => `#sb-source-ref("Q${index + 1}", target: <source-q${index + 1}>)`)
    .join(" #h(3pt) ");
  const remainder = indices.length - Math.min(indices.length, limit);
  return `[${visible}${remainder > 0 ? ` #h(3pt) #text(6.8pt)[+${remainder}]` : ""}]`;
}

function heading(level: number, value: string): string {
  return `#heading(level: ${level})[${text(value)}]`;
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${text(item)}`).join("\n");
}

function numberedList(items: string[]): string {
  return items.map((item) => `+ ${text(item)}`).join("\n");
}

function text(value: string): string {
  return `#text(${typstString(value)})`;
}

function typstString(value: string): string {
  return JSON.stringify(value.replace(/\u2028|\u2029/g, " "));
}

function stringTuple(values: string[]): string {
  return `(${values.map(typstString).join(", ")}${values.length ? "," : ""})`;
}

function stripMathDelimiters(value: string): string {
  const trimmed = value.trim();
  const body = trimmed.startsWith("$") && trimmed.endsWith("$")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  return body.replace(
    /_\(([A-Za-z][A-Za-z0-9 -]+)\)/g,
    (_, label: string) => `_"${label.trim()}"`,
  );
}

function formatFormulaMath(value: string): string {
  const body = stripMathDelimiters(value);
  if (body.length < 88 || !/;\s*quad\s*/.test(body)) {
    return body;
  }
  return body
    .split(/;\s*quad\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" \\\n");
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function shortTitle(value: string): string {
  return value.length <= 48 ? value : `${value.slice(0, 45)}...`;
}

function kindLabel(profile: StudyModel["profile"]): string {
  return {
    study_guide: "Study Guide",
    exam_navigator: "Exam Navigator",
    interactive_learning: "Interaktives Lernsystem",
    practice_pack: "Practice Pack",
    source_audit: "Quellenaudit",
  }[profile];
}

function statusLabel(status: StudyModel["publicationStatus"]): string {
  return { complete: "Vollständig belegt", partial: "Teilweise belegt", blocked: "Blockiert" }[status];
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
