export const STUDY_BUDDY_HTML_TOKENS = {
  "--sb-navy": "#19254b",
  "--sb-blue": "#323a61",
  "--sb-gold": "#dfbb63",
  "--sb-gold-dark": "#c3994d",
  "--sb-cyan": "#397f93",
  "--sb-green": "#23805A",
  "--sb-amber": "#c3994d",
  "--sb-red": "#B33A3A",
  "--sb-ink": "#20263f",
  "--sb-muted": "#66708f",
  "--sb-line": "#d9ddea",
  "--sb-soft": "#f6f7fb",
  "--sb-white": "#FFFFFF",
} as const;

export const STUDY_BUDDY_HTML_MARKS = ["Study Buddy"] as const;

export function studyBuddyCssTokenBlock(): string {
  return Object.entries(STUDY_BUDDY_HTML_TOKENS)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
}

export function studyBuddyDesignGuidelines(): string {
  return [
    "Study Buddy HTML design guidelines:",
    "- Produce readable source HTML; the official Study Buddy bundler creates one complete offline HTML file with inline CSS, JavaScript, and selected media.",
    "- Use the canonical Study Buddy logo from assets/logo.png in the first viewport when it is listed as an approved local asset. Give it alt=\"Study Buddy\" and data-study-buddy-logo.",
    "- Do not display legacy prototype marks such as STUDY BUDDY 2.0 or SB 2.0. The real logo replaces those text badges.",
    "- Define these exact CSS variables in :root:",
    studyBuddyCssTokenBlock(),
    "- Use the Study Buddy corporate identity: blue is the primary color; gold is reserved for highlights and objects of interest.",
    "- Follow CI/corporate-identity.md: clear hierarchy, precise spacing, strong contrast, primary blue structure, and restrained gold emphasis.",
    "- Treat the page as a learning cockpit, not a long document: the user must always know which section they are in and where the next useful action is.",
    "- Start with a compact orientation area that answers three questions: What is covered? What should I do first? Where can I find the evidence?",
    "- Give recurring information types stable, predictable locations: learning content, formulas, progress check, practice, sources, and coverage notes.",
    "- Provide persistent section navigation on desktop and a horizontally scrollable compact section bar on mobile.",
    "- Use direct topic jump links when the artifact has more than two topic blocks.",
    "- Visually distinguish overview, learning content, actions, and source material instead of styling every section as an equal card.",
    "- Keep source collections searchable and filterable. More than twelve sources must use a bounded scroll region or progressive disclosure, never an unbounded page-length table.",
    "- Source citations must deep-link to the corresponding source entry and clear filters that would otherwise hide it.",
    "- A local source preview belongs beside the source list on desktop and in a dismissible focused layer on mobile.",
    "- Show learning progress only for real learning objectives; persist it locally and never confuse it with course completion.",
    "- Section labels must use task-oriented student language such as Lernstoff, Formeln, Lerncheck, Training, Quellen, and Hinweise.",
    "- Do not hide essential learning content in tabs or accordions. Progressive disclosure is reserved for answers, supporting detail, and large source collections.",
    "- Do not use a hero taller than one compact viewport region; the first screen must contain orientation and a direct path into the material.",
    "- Use green, amber, red, and cyan for semantic feedback; do not make the page a one-note blue interface.",
    "- Use cards only for repeated learning units; do not place cards inside cards.",
    "- Controls must look like controls: buttons, segmented controls, sliders, toggles, tabs, progress indicators.",
    "- Text must not overlap or overflow on mobile; use responsive CSS and stable dimensions for tools and counters.",
    "- Keep border-radius at 8px or less except circular icon-like controls.",
    "- The first screen is the learning tool, not a marketing landing page.",
    "- Use inline SVG or canvas for diagrams and visualizations when useful.",
    "- Respect prefers-reduced-motion.",
    "- Use system fonts for portability unless a fully offline fallback stack is used.",
    "- Never include visible text explaining how the page was generated.",
  ].join("\n");
}

export function offlineHtmlRules(): string {
  return [
    "Offline single-file rules:",
    "- No <script src>.",
    "- No <link rel=\"stylesheet\">.",
    "- No CSS @import.",
    "- No fetch, XMLHttpRequest, WebSocket, EventSource, or dynamic remote import().",
    "- No remote images, fonts, videos, iframes, or stylesheets.",
    "- The final document.html must have no dependency on sibling files.",
    "- Do not emit Base64 or data-URI image payloads in generated source. Reference only approved local visual paths; the official bundler optimizes and embeds them.",
    "- Embed all app state and non-binary source data in inline JavaScript.",
    "- The file must work when opened via file:// on desktop and mobile browsers.",
  ].join("\n");
}
