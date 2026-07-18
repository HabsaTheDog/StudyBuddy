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
  if (input.kind === "exam-practice") {
    return minimalValidExamPracticeHtml(input);
  }
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
  <main${input.kind === "study-guide" ? " data-sb-study-nav" : ""}>
    <header${input.kind === "study-guide" ? " data-sb-hotbar data-sb-course-tabs" : ""}>
      <div class="mark">Study Buddy</div>
    </header>
    <section class="tool" aria-labelledby="title"${input.kind === "study-guide" ? " data-sb-course-map data-sb-topic data-sb-learning-content" : ""}>
      <h1 id="title">${escapeHtml(input.title)}</h1>
      <p>Interaktive Lernansicht mit Offline-Einzeldatei.</p>
      <p data-progress${input.kind === "study-guide" ? " data-sb-progress" : ""}>Fortschritt: 1 / 1</p>
      <div data-card${input.kind === "study-guide" ? " data-sb-practice data-sb-retrieval" : ""} tabindex="0">
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
    ${input.kind === "study-guide" ? '<footer data-sb-sources>Quellen</footer>' : ""}
  </main>${interaction}
</body>
</html>`;
}

function minimalValidExamPracticeHtml(input: { title: string; language: "de" | "en" }): string {
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
    [hidden] { display: none !important; }
    body { margin: 0; font-family: system-ui, sans-serif; color: var(--sb-ink); background: var(--sb-soft); }
    main { max-width: 860px; margin: 0 auto; padding: 18px; }
    section { background: var(--sb-white); border: 1px solid var(--sb-line); border-top: 4px solid var(--sb-gold); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    button, textarea { font: inherit; }
    button { border: 1px solid var(--sb-blue); background: var(--sb-blue); color: var(--sb-white); border-radius: 6px; padding: 10px 12px; font-weight: 700; }
    textarea { width: 100%; min-height: 90px; margin: 10px 0; }
    button:focus-visible, textarea:focus-visible { outline: 3px solid var(--sb-gold); outline-offset: 2px; }
    .bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    @media (max-width: 520px) { main { padding: 12px; } }
  </style>
</head>
<body data-sb-exam-active="false">
  <main>
    <header><strong>Study Buddy</strong><h1>${escapeHtml(input.title)}</h1></header>
    <section data-sb-exam-lock><h2>Lernmodus und Formeln</h2><p>Diese Hilfe wird während der Prüfung gesperrt.</p></section>
    <button type="button" data-sb-exam-start>Prüfungsdurchlauf starten</button>
    <section data-sb-exam-surface hidden aria-label="Aktive Prüfung">
      <div class="bar">
        <strong data-sb-exam-timer data-remaining-ms="0">Restzeit</strong>
        <span data-sb-exam-score>0 Punkte</span>
      </div>
      <label>Methodenentwurf<textarea data-sb-exam-draft></textarea></label>
      <button type="button" data-sb-exam-end>Prüfung beenden</button>
    </section>
    <section data-sb-exam-result hidden><h2>Auswertung</h2><p>Score und Review wurden lokal gespeichert.</p></section>
  </main>
  <script>
    const examKey = "study-buddy-minimal-exam";
    const examSurface = document.querySelector("[data-sb-exam-surface]");
    const examDraft = document.querySelector("[data-sb-exam-draft]");
    const examTimer = document.querySelector("[data-sb-exam-timer]");
    const examScore = document.querySelector("[data-sb-exam-score]");
    const examResult = document.querySelector("[data-sb-exam-result]");
    let examState = JSON.parse(localStorage.getItem(examKey) || "null") || { active: false, result: null };
    let examInterval;
    function saveExam() { localStorage.setItem(examKey, JSON.stringify(examState)); }
    function tickExam() {
      if (!examState.active) return;
      const remaining = Math.max(0, examState.endsAt - Date.now());
      examTimer.dataset.remainingMs = String(remaining);
      examTimer.textContent = "Restzeit " + Math.ceil(remaining / 1000) + " s";
      if (!remaining) finishExam();
    }
    function renderExam() {
      document.body.dataset.sbExamActive = String(Boolean(examState.active));
      document.querySelectorAll("[data-sb-exam-lock]").forEach((element) => { element.hidden = Boolean(examState.active); });
      examSurface.hidden = !examState.active;
      examResult.hidden = !examState.result || examState.active;
      if (examState.active) {
        examDraft.value = examState.draft || "";
        examScore.textContent = String(examState.score || 0) + " Punkte";
        clearInterval(examInterval);
        tickExam();
        examInterval = setInterval(tickExam, 1000);
      }
    }
    function startExam() {
      const startedAt = Date.now();
      const order = [1, 2, 3].sort(() => Math.random() - 0.5);
      examState = { active: true, order, index: 0, currentId: order[0], startedAt, durationMs: 60000, endsAt: startedAt + 60000, score: 0, answers: {}, draft: "", result: null };
      saveExam();
      renderExam();
    }
    function finishExam() {
      clearInterval(examInterval);
      examState.active = false;
      examState.result = { score: examState.score || 0, draft: examState.draft || "", finishedAt: Date.now() };
      saveExam();
      renderExam();
    }
    function persistDraft() { if (examState.active) { examState.draft = examDraft.value; saveExam(); } }
    examDraft.addEventListener("input", persistDraft);
    examDraft.addEventListener("change", persistDraft);
    document.querySelector("[data-sb-exam-start]").addEventListener("click", startExam);
    document.querySelector("[data-sb-exam-end]").addEventListener("click", finishExam);
    renderExam();
  </script>
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
