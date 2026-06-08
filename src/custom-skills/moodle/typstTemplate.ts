export const STUDY_BUDDY_COMPONENTS_FILE = "study-buddy-components.typ";
export const STUDY_BUDDY_TEMPLATE_FILE = "study-buddy-template.typ";
export const STUDY_BUDDY_PACKAGE_DIR = ".typst-packages";

export const STUDY_BUDDY_TEMPLATE_COMPATIBILITY = `// Compatibility import for older Study Buddy documents.
#import "${STUDY_BUDDY_COMPONENTS_FILE}": *
`;

export function studyBuddyTemplatePromptReference(): string {
  return [
    "Use the versioned Study Buddy component library as the only document shell and visual component source.",
    `Import it exactly once with: #import "${STUDY_BUDDY_COMPONENTS_FILE}": *`,
    "Wrap all output in exactly one #sb-document(...) call.",
    "Required shell fields: title, short-title, course, kind, semester, status, date, and body.",
    "The shell creates the standardized A4 title page, metadata panel, header, footer, page numbering, typography, colors, margins, and heading hierarchy.",
    "The shell also creates a standardized table of contents. Do not add a second outline.",
    "",
    "Approved content components:",
    "- #sb-callout(title: ..., tone: \"primary|info|success|warning|danger\")[...]",
    "- #sb-definition(\"Begriff\")[...]",
    "- #sb-formula(name: ..., variables: (...), units: (...), source: ...)[...]",
    "- #sb-math-panel(\"Titel\", note: ...)[...] for complex editable Typst mathematics",
    "- #sb-example(title: ...)[...]",
    "- #sb-source-note(\"Quelle\", coverage: \"Quellenlage\")",
    "- #sb-exercise(number: ..., title: ..., difficulty: ..., points: ...)[...]",
    "- #sb-checklist(( [...], [...], ))",
    "",
    "Approved tables:",
    "- #sb-table(columns: (...), header: (...), rows: (...))",
    "- #sb-table-section(\"Überschrift\")[#sb-table(...)] keeps a table with its heading",
    "- #sb-key-value-table(((...), (...)))",
    "- #sb-comparison-table(((...), (...)))",
    "- #sb-schedule-table(((...), (...)))",
    "Standard tables are intentionally unbreakable and use uniform row heights.",
    "Wrap every titled table in #sb-table-section so the heading and table cannot split across pages.",
    "If a table would be too long for one page, split it into meaningful titled subtables instead of drawing a raw Typst table.",
    "",
    "Approved diagrams and technical figures:",
    "- #sb-figure(label-text: \"Abb. N\", caption: \"...\")[...]",
    "- #sb-flowchart-linear(((title: ..., subtitle: ..., tone: ...), ...))",
    "- #sb-flowchart-branch(\"Start\", \"Entscheidung?\", \"Ja-Schritt\", \"Nein-Schritt\", \"Ende\")",
    "- #sb-block-diagram((\"Block 1\", \"Block 2\", ...))",
    "- #sb-rc-schematic() only when the shown topology really is an RC low-pass",
    "Flowchart labels must stay within the component limits. Split complex processes across multiple figures.",
    "Never draw diagrams with text arrow glyphs, inline CeTZ, raw rect/line geometry, ASCII art, or improvised tables.",
    "",
    "Mathematics rules:",
    "- Use editable Typst math, never screenshots or raw Unicode approximations.",
    "- Use #sb-math-panel for matrices, cases, integrals, nested sums, complex quantities, or multi-line derivations.",
    "- Break long derivations into aligned lines; never shrink important mathematics below 9 pt.",
    "- State variables, SI units, assumptions, and a real source near important formulas.",
    "- Use Omega or text \"Ohm\"; never use Omega.alt.",
    "",
    "Content and locale rules:",
    "- Produce a polished study document, not a plain headings-only transcript. Use the approved formula, example, table, callout, checklist, diagram, and source-note components where the extracted data supports them.",
    "- Mirror every explicitly requested deliverable as a clear level-1 section and keep practical steps actionable.",
    "- Use German/Austrian conventions: TT.MM.JJJJ, 24-hour time, decimal comma in prose, and SI units.",
    "- UTF-8 German text and umlauts are supported directly.",
    "- Distinguish Moodle facts from CIS facts in a compact Quellenlage note when both were requested.",
    "- Keep citations next to claims and formulas. Never invent a source id.",
    "- Return only Typst source, without Markdown fences or explanation.",
  ].join("\n");
}

export function typstPdfPath(typstPath: string): string {
  return typstPath.replace(/\.typ$/i, ".pdf");
}
