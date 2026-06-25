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

export const STUDY_BUDDY_HTML_MARKS = ["STUDY BUDDY 2.0", "SB 2.0"] as const;

export function studyBuddyCssTokenBlock(): string {
  return Object.entries(STUDY_BUDDY_HTML_TOKENS)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
}

export function studyBuddyDesignGuidelines(): string {
  return [
    "Study Buddy HTML design guidelines:",
    "- Produce one complete offline HTML file with inline CSS and inline JavaScript only.",
    "- Include the visible text mark STUDY BUDDY 2.0 in the first viewport and a compact inline SB 2.0 badge.",
    "- Define these exact CSS variables in :root:",
    studyBuddyCssTokenBlock(),
    "- Use the Study Buddy corporate identity: blue is the primary color; gold is reserved for highlights and objects of interest.",
    "- Use a restrained technical study aesthetic: clear hierarchy, dense but readable learning UI, precise spacing, strong contrast.",
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
    "- No dependency on sibling files.",
    "- Embed all app state and source data in inline JavaScript.",
    "- The file must work when opened via file:// on desktop and mobile browsers.",
  ].join("\n");
}
