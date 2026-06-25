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
    "- #sb-callout(title: ..., tone: \"primary|info|success|warning|danger\")[...] only for genuinely important fields: safety warnings, source conflicts, hard constraints, exam/deadline facts, or one central takeaway. Do not use callouts as normal paragraph wrappers.",
    "- #sb-definition(\"Begriff\")[...] only for key terms that must visually stand out. Use normal prose for routine vocabulary or repeated minor terms.",
    "- #sb-formula(name: ..., variables: (...), units: (...), source: ...)[...]",
    "- #sb-math-panel(\"Titel\", note: ...)[...] for complex editable Typst mathematics",
    "- #sb-example(title: ...)[...]",
    "- #sb-source-note(\"Quelle\", coverage: \"Quellenlage\") for compact source coverage, grouped citations, or source caveats. Do not place one after every section.",
    "- #sb-exercise(number: ..., title: ..., difficulty: ..., points: ...)[...]",
    "- #sb-checklist(( [...], [...], ))",
    "",
    "Layout balance rules:",
    "- Default to normal Typst prose paragraphs for explanations. A study document should read like a clear script, not like a sequence of boxes.",
    "- Each level-1 content section should start with one to three ordinary paragraphs before any checklist, table, formula, or callout.",
    "- Keep at least half of the substantive body content as prose outside callouts, source notes, tables, checklists, formula panels, and exercises.",
    "- Avoid back-to-back boxed components. If two visual components are necessary, separate them with explanatory prose or merge them.",
    "- Use at most one callout in a normal level-1 section, and omit it entirely when the section has no warning, deadline, core takeaway, or unusual source issue.",
    "- Do not turn routine summaries, vocabulary lists, section intros, source reminders, or every set of key points into info boxes.",
    "- Use checklists only for compact action items or final review points. For long vocabulary, procedures, comparisons, or data-heavy content, prefer prose plus approved tables.",
    "- Group repeated source references into a short Quellenlage note near the beginning or end of a chapter, and cite routine facts inline in prose by naming the source. Keep #sb-source-note for coverage summaries or source caveats.",
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
    "- #image(\"assets/visuals/file.png\", width: 90%) only inside #sb-figure, only for validated visual_assets with a relative_path.",
    "- #sb-flowchart-linear(((title: ..., subtitle: ..., tone: ...), ...))",
    "- #sb-flowchart-branch(\"Start\", \"Entscheidung?\", \"Ja-Schritt\", \"Nein-Schritt\", \"Ende\")",
    "- #sb-block-diagram((\"Block 1\", \"Block 2\", ...))",
    "- #sb-rc-schematic() only when the shown topology really is an RC low-pass",
    "Flowchart labels must stay within the component limits. Split complex processes across multiple figures.",
    "Never draw diagrams with text arrow glyphs, inline CeTZ, raw rect/line geometry, ASCII art, or improvised tables.",
    "",
    "Mathematics rules:",
    "- Use editable Typst math, never screenshots or raw Unicode approximations.",
    "- Formula bodies must be real Typst math, e.g. #sb-formula(... )[$ m bold(a)_M = bold(R) $]. Never put #raw(...) inside #sb-formula.",
    "- Use #sb-math-panel for matrices, cases, integrals, nested sums, complex quantities, or multi-line derivations.",
    "- Break long derivations into aligned lines; never shrink important mathematics below 9 pt.",
    "- State variables, SI units, assumptions, and a real source near important formulas.",
    "- Use Omega or text \"Ohm\"; never use Omega.alt.",
    "",
    "Content and locale rules:",
    "- Produce a polished study document, not a plain headings-only transcript. Use approved formula, example, table, checklist, diagram, and source-note components where the extracted data supports them, while keeping prose as the primary reading path.",
    "- Mirror every explicitly requested deliverable as a clear level-1 section and keep practical steps actionable.",
    "- Use German/Austrian conventions: TT.MM.JJJJ, 24-hour time, decimal comma in prose, and SI units.",
    "- UTF-8 German text and umlauts are supported directly.",
    "- Distinguish Moodle facts from CIS facts in a compact Quellenlage note when both were requested, preferably once in the overview or sources section unless a later section has conflicting coverage.",
    "- Keep citations next to claims and formulas. Never invent a source id.",
    "- For visual_assets of kind typst_diagram, use only approved Study Buddy diagram components inside #sb-figure.",
    "- For visual_assets of kind placeholder_prompt, render a compact placeholder figure or callout that includes the generation_prompt and labels it as a didactic visualization prompt, not an original source.",
    "- Return only Typst source, without Markdown fences or explanation.",
  ].join("\n");
}

export function typstPdfPath(typstPath: string): string {
  return typstPath.replace(/\.typ$/i, ".pdf");
}
