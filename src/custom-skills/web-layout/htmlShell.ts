import type { WebLayoutKind } from "./types.js";
import { studyBuddyCssTokenBlock } from "./designGuidelines.js";

export const OFFLINE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export function stripHtmlFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function applyOfflineSecurityPolicy(value: string): string {
  const withoutExistingPolicy = value.replace(
    /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy["']?)[^>]*>\s*/gi,
    "",
  );
  const policyTag = `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`;
  if (/<meta\b[^>]*charset\s*=/i.test(withoutExistingPolicy)) {
    return withoutExistingPolicy.replace(/(<meta\b[^>]*charset\s*=[^>]*>)/i, `$1\n  ${policyTag}`);
  }
  return withoutExistingPolicy.replace(/<head\b[^>]*>/i, (head) => `${head}\n  ${policyTag}`);
}

export function minimalValidStudyBuddyHtml(input: { title: string; kind: WebLayoutKind; language: "de" | "en" }): string {
  const interaction = input.kind === "reference" ? "" : `
    <script>
      const state = { index: 0, known: 0 };
      function flipCard() {
        document.querySelector('[data-card]').classList.toggle('is-flipped');
      }
      function markKnown() {
        state.known += 1;
        document.querySelector('[data-summary]').textContent = state.known + ' bekannt';
      }
      function resetTool() {
        state.known = 0;
        document.querySelector('[data-summary]').textContent = '0 bekannt';
      }
      document.addEventListener('keydown', (event) => {
        if (event.key === ' ') {
          event.preventDefault();
          flipCard();
        }
      });
    </script>`;

  return `<!doctype html>
<html lang="${input.language}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
${studyBuddyCssTokenBlock()}
      color-scheme: light;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--sb-ink);
      background: var(--sb-soft);
    }
    main { max-width: 980px; margin: 0 auto; padding: 18px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .mark { color: var(--sb-blue); font-weight: 800; letter-spacing: .01em; }
    .tool { background: var(--sb-white); border: 1px solid var(--sb-line); border-top: 4px solid var(--sb-gold); border-radius: 8px; padding: 16px; }
    [data-card] { min-height: 180px; display: grid; place-items: center; border: 1px solid var(--sb-line); border-radius: 8px; padding: 20px; }
    [data-card].is-flipped .front { display: none; }
    [data-card]:not(.is-flipped) .back { display: none; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    button { border: 1px solid var(--sb-blue); background: var(--sb-blue); color: var(--sb-white); border-radius: 6px; padding: 10px 12px; font-weight: 700; }
    button.secondary { background: var(--sb-white); color: var(--sb-blue); }
    button:focus-visible { outline: 3px solid var(--sb-gold); outline-offset: 2px; }
    .status { color: var(--sb-muted); margin-top: 10px; }
    @media (max-width: 520px) {
      main { padding: 12px; }
      header { align-items: flex-start; }
      .actions button { flex: 1 1 140px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="mark">Study Buddy</div>
    </header>
    <section class="tool" aria-labelledby="title">
      <h1 id="title">${escapeHtml(input.title)}</h1>
      <p>Interaktive Lernansicht mit Offline-Einzeldatei.</p>
      <p data-progress>Fortschritt: 1 / 1</p>
      <div data-card tabindex="0">
        <div class="front">Kernfrage</div>
        <div class="back">Antwort und kurze Begründung</div>
      </div>
      <div class="actions">
        <button type="button" onclick="flipCard()">Umdrehen</button>
        <button type="button" onclick="markKnown()">Bekannt</button>
        <button type="button" class="secondary" onclick="resetTool()">Needs-review</button>
        <button type="button" class="secondary" onclick="resetTool()">Zurücksetzen</button>
      </div>
      <p class="status" data-summary>0 bekannt</p>
    </section>
  </main>${interaction}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
