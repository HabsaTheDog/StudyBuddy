import type { StudyModel } from "./examNavigatorContracts.js";
import {
  cleanVisibleMathText,
  normalizeInlineMathSource,
  quoteBareMathText,
  renderTypstInlineText,
} from "./typstInlineMath.js";

export function renderStudentFirstTypst(model: StudyModel): string {
  const body: string[] = [];
  const labels = documentLabels(model.language);

  if (model.courseChapters.length === 0 && model.scopeNote) {
    body.push(`#sb-source-note(${typstString(labels.sourceCoverage)}, coverage: ${typstString(model.scopeNote)})`);
  }

  const renderedTopicIds = new Set<string>();
  const renderedFormulaIds = new Set<string>();
  const renderedExampleIds = new Set<string>();
  const renderedFigureIds = new Set<string>();
  let figureNumber = 0;
  for (const chapter of model.courseChapters) {
    body.push(heading(1, chapter.title));
    const topics = model.topics.filter((topic) => topic.chapterId === chapter.id);
    body.push(renderChapterRoadmap(chapter, topics, labels));
    if (topics.length === 0) {
      body.push(`#sb-callout(title: ${typstString(labels.notCoveredTitle)}, tone: "warning")[
  ${text(labels.notCoveredBody)}
]`);
      continue;
    }
    const examples = model.workedExamples.filter((example) => example.chapterId === chapter.id);
    const formulas = model.formulas.filter((formula) => formula.chapterId === chapter.id);
    const figures = model.figures.filter((figure) =>
      figure.chapterId === chapter.id && Boolean(figure.relativePath)
    );
    const exampleFigureIds = new Set(
      examples.flatMap((example) =>
        figuresForExample(figures, example, 1).map((figure) => figure.id)
      ),
    );
    const topicForExample = new Map(examples.map((example, index) => [
      example.id,
      closestTopic(
        `${example.learningGoal} ${example.prompt} ${example.steps.join(" ")} ${example.result}`,
        topics,
        index,
      )?.id,
    ]));
    const topicForFormula = new Map(formulas.map((formula, index) => [
      formula.id,
      closestTopic(
        `${formula.name} ${formula.variables.join(" ")} ${formula.assumptions}`,
        topics,
        index,
      )?.id,
    ]));
    const topicForFigure = new Map(figures.map((figure, index) => [
      figure.id,
      exampleFigureIds.has(figure.id)
        ? undefined
        : closestTopic(`${figure.title} ${figure.caption}`, topics, index)?.id,
    ]));

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
        body.push(renderLearningFocus(topic.learningGoals, labels));
      }

      const topicFigures = figures.filter((figure) =>
        topicForFigure.get(figure.id) === topic.id && !renderedFigureIds.has(figure.id)
      ).slice(0, 1);
      for (const figure of topicFigures) {
        renderedFigureIds.add(figure.id);
        figureNumber += 1;
        body.push(renderFigure(model, figure, figureNumber));
      }

      const topicFormulas = formulas.filter((formula) =>
        topicForFormula.get(formula.id) === topic.id && !renderedFormulaIds.has(formula.id)
      );
      if (topicFormulas.length > 0) {
        const formulaBody = topicFormulas.map((formula) => {
          renderedFormulaIds.add(formula.id);
          return renderFormula(model, formula);
        });
        body.push(
          heading(3, labels.methodToolkit),
          `#sb-formula-group()[\n${indent(formulaBody.join("\n"), 2)}\n]`,
        );
      }

      const topicExamples = examples.filter((example) =>
        topicForExample.get(example.id) === topic.id && !renderedExampleIds.has(example.id)
      );
      for (const example of topicExamples) {
        renderedExampleIds.add(example.id);
        const figureBlocks = figuresForExample(figures, example, 1)
          .filter((figure) => !renderedFigureIds.has(figure.id))
          .map((figure) => {
            renderedFigureIds.add(figure.id);
            figureNumber += 1;
            return renderFigure(model, figure, figureNumber, labels.exampleFigure);
          });
        body.push(
          heading(3, labels.tryTheMethod),
          renderExample(model, example, renderedExampleIds.size, figureBlocks),
        );
      }
    }

    const overviewFigures = figures.filter((figure) => !renderedFigureIds.has(figure.id));
    if (overviewFigures.length > 0) {
      body.push(heading(2, labels.fromCourseMaterial));
      for (const figure of overviewFigures.slice(0, 2)) {
        renderedFigureIds.add(figure.id);
        figureNumber += 1;
        body.push(renderFigure(model, figure, figureNumber));
      }
    }

    const remainingChapterFormulas = formulas.filter((formula) =>
      !renderedFormulaIds.has(formula.id)
    );
    if (remainingChapterFormulas.length > 0) {
      const formulaBody: string[] = [];
      for (const formula of remainingChapterFormulas) {
        renderedFormulaIds.add(formula.id);
        formulaBody.push(renderFormula(model, formula));
      }
      body.push(
        heading(2, labels.formulaToolkit),
        `#sb-formula-group()[\n${indent(formulaBody.join("\n"), 2)}\n]`,
      );
    }

    const remainingChapterExamples = examples.filter((example) =>
      !renderedExampleIds.has(example.id)
    );
    if (remainingChapterExamples.length > 0) {
      body.push(heading(2, labels.applyStepByStep));
      for (const example of remainingChapterExamples) {
        renderedExampleIds.add(example.id);
        const figureBlocks = figuresForExample(figures, example, 1)
          .filter((figure) => !renderedFigureIds.has(figure.id))
          .map((figure) => {
            renderedFigureIds.add(figure.id);
            figureNumber += 1;
            return renderFigure(model, figure, figureNumber, labels.exampleFigure);
          });
        body.push(renderExample(model, example, renderedExampleIds.size, figureBlocks));
      }
    }
    if (chapter.assessmentSignals.length > 0) {
      body.push(
        heading(2, labels.practiceRoute),
        text(labels.practiceRouteIntro),
        `#sb-checklist((${chapter.assessmentSignals.slice(0, 5)
          .map((item) => `\n  [${text(item)}],`).join("")}\n))`,
      );
    }
  }

  const remainingTopics = model.topics.filter((topic) => !renderedTopicIds.has(topic.id));
  if (remainingTopics.length > 0) {
    body.push(heading(1, model.courseChapters.length ? labels.moreSupportedTopics : labels.learningContent));
    for (const topic of remainingTopics) {
      body.push(
        heading(2, topic.title),
        text(topic.summary),
        sourceLine(model, topic.sourceIds),
        heading(3, labels.coreKnowledge),
        bulletList(topic.learningGoals),
      );
    }
  }

  const remainingFigures = model.figures.filter((figure) =>
    Boolean(figure.relativePath) && !renderedFigureIds.has(figure.id)
  );
  if (remainingFigures.length > 0) {
    body.push(heading(1, labels.moreFiguresAndTables));
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
      heading(1, labels.moreSupportedFormulas),
      `#sb-formula-group()[\n${indent(formulaBody.join("\n"), 2)}\n]`,
    );
  }

  const remainingExamples = model.workedExamples.filter((example) => !renderedExampleIds.has(example.id));
  if (remainingExamples.length > 0) {
    body.push(`#sb-divider(label: ${typstString(labels.apply)})`, heading(1, labels.moreWorkedExamples));
    for (const example of remainingExamples) {
      renderedExampleIds.add(example.id);
      const figureBlocks = figuresForExample(model.figures, example, 1)
        .filter((figure) => !renderedFigureIds.has(figure.id))
        .map((figure) => {
          renderedFigureIds.add(figure.id);
          figureNumber += 1;
          return renderFigure(model, figure, figureNumber, labels.exampleFigure);
        });
      body.push(renderExample(model, example, renderedExampleIds.size, figureBlocks));
    }
  }

  if (model.checklist.length > 0) {
    body.push(
      `#sb-divider(label: ${typstString(labels.learningCheck)})`,
      heading(1, labels.examChecklist),
      text(labels.checklistIntro),
      `#sb-checklist((${model.checklist.map((item) => `\n  [${text(item)}],`).join("")}\n))`,
    );
  }

  if (model.practiceItems.length > 0) {
    body.push(`#sb-divider(label: ${typstString(labels.training)})`, heading(1, labels.sourceGroundedTraining));
    for (const [index, item] of model.practiceItems.entries()) {
      body.push(
        heading(2, `${labels.task} ${index + 1}`),
        text(item.prompt),
        sourceLine(model, item.sourceIds),
        `#text(weight: "bold")[${text(labels.solution)}] ${text(item.answer)}`,
      );
    }
  }

  body.push(`#sb-divider(label: ${typstString(labels.references)})`, heading(1, labels.sourcesAndLinks));
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
      heading(1, labels.openSourceNotes),
      bulletList(model.warnings),
    );
  }

  return `#import "study-buddy-components.typ": *

#sb-document(
  title: ${typstString(model.title)},
  short-title: ${typstString(shortTitle(model.title))},
  course: ${typstString(model.courseTitle)},
  kind: ${typstString(kindLabel(model.profile, model.language))},
  language: ${typstString(model.language)},
  semester: ${typstString(currentSemester())},
  status: ${typstString(statusLabel(model.publicationStatus, model.language))},
  date: ${typstString(currentDate(model.language))},
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
  note: [${text(formula.assumptions)}],
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
  const labels = documentLabels(model.language);
  const visuals = figureBlocks.length > 0
    ? `\n  #v(6pt)\n  ${figureBlocks.join("\n  #v(5pt)\n  ")}`
    : "";
  return `#sb-example(
  title: ${typstString(`${example.origin === "derived" ? labels.derivedExample : labels.sourceExample} ${number}`)},
  result: [${text(example.result)}],
)[
  #text(weight: "bold")[${text(labels.learningGoal)}] ${text(example.learningGoal)}
  #v(4pt)
  #text(weight: "bold")[${text(labels.task)}] ${text(example.prompt)}
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
  labelPrefix = model.language === "en" ? "Fig." : "Abb.",
): string {
  const labels = documentLabels(model.language);
  const page = figure.sourcePage ? `, ${labels.page} ${figure.sourcePage}` : "";
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
  return "";
}

function figuresForExample(
  figures: StudyModel["figures"],
  example: StudyModel["workedExamples"][number],
  limit: number,
): StudyModel["figures"] {
  const exampleSources = new Set(example.sourceIds);
  return figures
    .filter((figure) =>
      Boolean(figure.relativePath) &&
      figure.sourceIds.length > 0 &&
      figure.sourceIds.every((sourceId) => exampleSources.has(sourceId))
    )
    .sort((left, right) =>
      visualSpecificity(right, example) - visualSpecificity(left, example) ||
      left.title.localeCompare(right.title, "de")
    )
    .slice(0, limit);
}

function visualSpecificity(
  figure: StudyModel["figures"][number],
  example?: StudyModel["workedExamples"][number],
): number {
  const value = `${figure.title} ${figure.caption}`.toLocaleLowerCase("de");
  const exampleValue = example
    ? `${example.learningGoal} ${example.prompt} ${example.steps.join(" ")}`.toLocaleLowerCase("de")
    : "";
  const mandatoryMatch =
    (/(?:tb\s*2-|h7\s*\/\s*k6|toleranzgrad|grundabmaß)/i.test(exampleValue) &&
      /(?:tb\s*2-|h7\s*\/\s*k6|lernausschnitt)/i.test(value)) ||
    (/(?:roloff|matek|viskositäts?-temperatur|diagrammables)/i.test(exampleValue) &&
      /(?:roloff|matek|viskositäts?-temperatur|diagrammabbildung)/i.test(value));
  return (
    (mandatoryMatch ? 20 : 0) +
    (/\b(?:tabelle|table|diagramm|skizze|beispiel|rechnung|plot|kennlinie|schema|passung|toleranz)\b/.test(value) ? 2 : 0) +
    (figure.kind === "typst_diagram" ? 2 : 0) +
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

function renderChapterRoadmap(
  chapter: StudyModel["courseChapters"][number],
  topics: StudyModel["topics"],
  labels: ReturnType<typeof documentLabels>,
): string {
  const rows = roadmapRows(chapter, topics).slice(0, 12);
  if (rows.length === 0) return "";
  const cells = rows.flatMap((row, index) => [
    `[#sb-chip(${typstString(row.label || String(index + 1))}, tone: "info")]`,
    `[${text(row.detail)}]`,
  ]).join(",\n    ");
  return `// study-buddy:chapter-roadmap
#sb-callout(title: ${typstString(labels.chapterAtAGlance)}, tone: "primary")[
  #grid(
    columns: (auto, 1fr),
    column-gutter: 4mm,
    row-gutter: 3pt,
    align: (left, top),
    ${cells},
  )
]`;
}

function roadmapRows(
  chapter: StudyModel["courseChapters"][number],
  topics: StudyModel["topics"],
): Array<{ label: string; detail: string }> {
  const grouped = new Map<string, string[]>();
  for (const objective of chapter.learningObjectives) {
    const match = /^(Thema|Topic)\s+(\d{1,2})\s*[–-]\s*([^:·]+)(?::|\s+·\s+)?\s*(.*)$/i
      .exec(objective);
    if (!match) {
      grouped.set(String(grouped.size + 1), [objective]);
      continue;
    }
    const label = `${match[1]} ${match[2]}`;
    const detail = [match[3].trim(), match[4].trim()].filter(Boolean).join(": ");
    grouped.set(label, [...(grouped.get(label) ?? []), detail]);
  }
  if (grouped.size > 0) {
    return [...grouped].map(([label, details]) => ({
      label,
      detail: uniqueText(details).join(" — "),
    }));
  }
  return topics.map((topic, index) => ({
    label: String(index + 1),
    detail: topic.title,
  }));
}

function renderLearningFocus(
  goals: string[],
  labels: ReturnType<typeof documentLabels>,
): string {
  const prose = uniqueText(goals)
    .slice(0, 4)
    .map((goal) => /[.!?]$/.test(goal.trim()) ? goal.trim() : `${goal.trim()}.`)
    .join(" ");
  return `#sb-callout(title: ${typstString(labels.learningFocus)}, tone: "info")[
  ${text(prose)}
]`;
}

function closestTopic(
  value: string,
  topics: StudyModel["topics"],
  fallbackIndex: number,
): StudyModel["topics"][number] | undefined {
  if (topics.length === 0) return undefined;
  const valueTerms = associationTokens(value);
  const ranked = topics.map((topic, index) => {
    const topicTerms = associationTokens(
      `${topic.title} ${topic.summary} ${topic.learningGoals.join(" ")}`,
    );
    const shared = [...valueTerms].filter((term) => topicTerms.has(term)).length;
    return { topic, index, shared };
  }).sort((left, right) => right.shared - left.shared || left.index - right.index);
  if ((ranked[0]?.shared ?? 0) > 0) return ranked[0].topic;
  return topics[fallbackIndex % topics.length];
}

function associationTokens(value: string): Set<string> {
  const ignored = new Set([
    "chapter", "thema", "topic", "example", "beispiel", "formula", "formel",
    "apply", "anwenden", "learning", "lernen", "course", "moodle",
  ]);
  return new Set(
    value.toLocaleLowerCase("de")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/[a-z0-9]{5,}/g)
      ?.map((token) => token.replace(/(?:ungen|ung|en|e|n|er|es)$/i, ""))
      .filter((token) => token.length >= 4 && !ignored.has(token)) ?? [],
  );
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

function sourceLine(model: StudyModel, ids: string[]): string {
  const prefix = model.language === "en" ? "Supported by" : "Belegt durch";
  return `#text(7.2pt, fill: rgb("#66708f"))[${prefix} ${sourceReferences(model, ids, 4)}]`;
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
  return items.map((item) => `+ ${text(item.replace(/^\s*\d+\.\s*/, ""))}`).join("\n");
}

function text(value: string): string {
  return renderTypstInlineText(value, formatFormulaMath);
}

function typstString(value: string): string {
  return JSON.stringify(value.replace(/\u2028|\u2029/g, " "));
}

function stringTuple(values: string[]): string {
  return `(${values.map((value) => typstString(cleanVisibleMathText(value))).join(", ")}${values.length ? "," : ""})`;
}

function stripMathDelimiters(value: string): string {
  const trimmed = value.trim();
  const body = trimmed.startsWith("$") && trimmed.endsWith("$")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  return quoteBareMathText(separateGreekLatinSymbols(normalizeInlineMathSource(body).replace(
    /_\(([A-Za-z][A-Za-z0-9 -]+)\)/g,
    (_, label: string) => `_"${label.trim()}"`,
  )));
}

function separateGreekLatinSymbols(value: string): string {
  return value
    .replace(/([\p{Script=Greek}])(?=[A-Za-z])/gu, "$1 ")
    .replace(/([A-Za-z])(?=[\p{Script=Greek}])/gu, "$1 ");
}

export function formatFormulaMath(value: string): string {
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

function kindLabel(profile: StudyModel["profile"], language: StudyModel["language"]): string {
  const german = {
    study_guide: "Study Guide",
    exam_navigator: "Exam Navigator",
    interactive_learning: "Interaktives Lernsystem",
    practice_pack: "Practice Pack",
    source_audit: "Quellenaudit",
  };
  const english = {
    study_guide: "Study Guide",
    exam_navigator: "Exam Navigator",
    interactive_learning: "Interactive Learning System",
    practice_pack: "Practice Pack",
    source_audit: "Source Audit",
  };
  return (language === "en" ? english : german)[profile];
}

function statusLabel(status: StudyModel["publicationStatus"], language: StudyModel["language"]): string {
  return language === "en"
    ? { complete: "Fully supported", partial: "Partially supported", blocked: "Blocked" }[status]
    : { complete: "Vollständig belegt", partial: "Teilweise belegt", blocked: "Blockiert" }[status];
}

function currentDate(language: StudyModel["language"]): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function documentLabels(language: StudyModel["language"]) {
  if (language === "en") {
    return {
      sourceCoverage: "Source coverage",
      notCoveredTitle: "Not yet covered",
      notCoveredBody: "This Moodle chapter was identified, but the locally evaluated course files did not provide sufficiently reliable learning content.",
      coreKnowledge: "Core knowledge",
      keyTakeaways: "Key takeaways and learning goals",
      chapterAtAGlance: "Course map for this chapter",
      learningFocus: "Learning focus",
      methodToolkit: "Method and formula",
      tryTheMethod: "See the method in action",
      practiceRoute: "Practice route",
      practiceRouteIntro: "Work through the corresponding Moodle exercises and mini-test after you can explain the chapter map without notes.",
      fromCourseMaterial: "From the course material",
      formulaToolkit: "Formula toolkit",
      applyStepByStep: "Apply step by step",
      exampleFigure: "Example figure",
      moreSupportedTopics: "More supported topics",
      learningContent: "Learning content",
      moreFiguresAndTables: "More figures and tables",
      moreSupportedFormulas: "More supported formulas",
      apply: "Apply",
      moreWorkedExamples: "More worked examples",
      learningCheck: "Learning check",
      examChecklist: "Exam checklist",
      checklistIntro: "Use this checklist as a final self-check.",
      training: "Training",
      sourceGroundedTraining: "Source-grounded training",
      task: "Task:",
      solution: "Solution:",
      references: "References",
      sourcesAndLinks: "Sources and direct links",
      openSourceNotes: "Open source notes",
      example: "Example",
      sourceExample: "Course example",
      derivedExample: "Didactic practice example",
      learningGoal: "Learning goal:",
      page: "page",
      visualNotRendered: "Visualization not rendered",
      plannedVisual: "Planned visualization",
      missingVisual: (title: string) => `No validated source image or concrete diagram definition was provided for "${title}".`,
    };
  }
  return {
    sourceCoverage: "Quellenlage",
    notCoveredTitle: "Noch nicht abgedeckt",
    notCoveredBody: "Dieses Moodle-Kapitel wurde erkannt, aber aus den lokal ausgewerteten Kursdateien konnte noch kein belastbarer Lerninhalt übernommen werden.",
    coreKnowledge: "Kernwissen",
    keyTakeaways: "Merksätze und Lernziele",
    chapterAtAGlance: "Kurslandkarte für dieses Kapitel",
    learningFocus: "Lernfokus",
    methodToolkit: "Methode und Formel",
    tryTheMethod: "Methode im Beispiel",
    practiceRoute: "Übungsweg",
    practiceRouteIntro: "Bearbeite die zugehörigen Moodle-Übungen und den Minitest, sobald du die Kurslandkarte ohne Unterlagen erklären kannst.",
    fromCourseMaterial: "Aus der Kursunterlage",
    formulaToolkit: "Formelwerkzeug",
    applyStepByStep: "Schritt für Schritt anwenden",
    exampleFigure: "Beispielbild",
    moreSupportedTopics: "Weitere belegte Themen",
    learningContent: "Lernstoff",
    moreFiguresAndTables: "Weitere Abbildungen und Tabellen",
    moreSupportedFormulas: "Weitere belegte Formeln",
    apply: "Anwenden",
    moreWorkedExamples: "Weitere Rechenbeispiele",
    learningCheck: "Lerncheck",
    examChecklist: "Prüfungs-Checkliste",
    checklistIntro: "Nutze diese Checkliste als Abschlusskontrolle.",
    training: "Training",
    sourceGroundedTraining: "Quellengebundenes Training",
    task: "Aufgabe:",
    solution: "Lösung:",
    references: "Nachweise",
    sourcesAndLinks: "Quellen und Direktlinks",
    openSourceNotes: "Offene Quellenhinweise",
    example: "Beispiel",
    sourceExample: "Kursbeispiel",
    derivedExample: "Didaktisches Übungsbeispiel",
    learningGoal: "Lernziel:",
    page: "Seite",
    visualNotRendered: "Visualisierung nicht gerendert",
    plannedVisual: "Vorgesehene Visualisierung",
    missingVisual: (title: string) => `Für "${title}" wurde kein validiertes Quellenbild und keine konkrete Diagrammdefinition bereitgestellt.`,
  };
}

function currentSemester(): string {
  const now = new Date();
  return `${now.getMonth() >= 2 && now.getMonth() <= 8 ? "SS" : "WS"} ${now.getFullYear()}`;
}
