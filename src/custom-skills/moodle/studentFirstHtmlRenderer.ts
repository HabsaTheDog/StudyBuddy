import path from "node:path";
import { OFFLINE_CSP } from "../web-layout/htmlShell.js";
import type { StudyModel } from "./examNavigatorContracts.js";

type SourceCategory = "slides" | "exercise" | "solution" | "test" | "external" | "course" | "other";

const SOURCE_CATEGORIES: Array<{ id: SourceCategory | "all"; label: string }> = [
  { id: "all", label: "Alle" },
  { id: "slides", label: "Folien" },
  { id: "exercise", label: "Aufgaben" },
  { id: "solution", label: "Lösungen" },
  { id: "test", label: "Tests" },
  { id: "external", label: "Extern" },
  { id: "course", label: "Kursinfos" },
  { id: "other", label: "Weitere" },
];

export function renderStudentFirstHtml(model: StudyModel, runDir: string): string {
  const sourceRecords = model.sources.map((source, index) => ({
    source,
    number: index + 1,
    category: classifySource(source.title, source.kind),
  }));
  const existingCategories = new Set(sourceRecords.map(({ category }) => category));
  const sourceFilters = SOURCE_CATEGORIES
    .filter(({ id }) => id === "all" || existingCategories.has(id))
    .map(({ id, label }) => {
      const count = id === "all"
        ? sourceRecords.length
        : sourceRecords.filter(({ category }) => category === id).length;
      return `<button type="button" class="filter-chip${id === "all" ? " is-active" : ""}" data-filter="${id}" aria-pressed="${id === "all"}">${label}<span>${count}</span></button>`;
    }).join("");

  const sourceMap = sourceRecords.map(({ source, number, category }) => {
    const preview = source.previewPath ? relativeAsset(runDir, source.previewPath) : "";
    const searchable = `${source.title} ${source.kind} Q${number}`.toLocaleLowerCase(model.language);
    return `<article class="source-row" id="source-q${number}" data-source-row data-category="${category}" data-search="${escapeAttr(searchable)}">
      <div class="source-number">Q${number}</div>
      <div class="source-copy">
        <strong>${escapeHtml(source.title)}</strong>
        <span>${sourceCategoryLabel(category)} · ${escapeHtml(source.kind)}</span>
      </div>
      <div class="source-actions">
        ${preview ? `<button type="button" class="button button-secondary preview" data-preview="${escapeAttr(preview)}" data-title="${escapeAttr(source.title)}">Vorschau</button>` : ""}
        ${source.originUrl ? `<a class="button button-quiet" href="${escapeAttr(source.originUrl)}" target="_blank" rel="noopener noreferrer">Original<span class="sr-only"> ${escapeHtml(source.title)}</span> ↗</a>` : ""}
      </div>
    </article>`;
  }).join("");

  const topics = model.topics.map((topic, index) => `<article class="topic" id="${escapeAttr(topic.id)}" data-observe-section>
    <div class="topic-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</div>
    <div class="topic-content">
      <div class="topic-meta">
        <span class="priority priority-${topic.priority}">${priorityLabel(topic.priority)}</span>
        <span>${scopeLabel(topic.scopeStatus)}</span>
      </div>
      <h3>${escapeHtml(topic.title)}</h3>
      <p class="topic-summary">${escapeHtml(topic.summary)}</p>
      <div class="learning-goals">
        <p>Danach kannst du</p>
        <ul>${topic.learningGoals.map((goal) => `<li>${escapeHtml(goal)}</li>`).join("")}</ul>
      </div>
      <p class="citations">Belegt durch ${sourceLinks(model, topic.sourceIds)}</p>
    </div>
  </article>`).join("");

  const checklist = model.checklist.length
    ? `<section class="panel learning-check" id="checklist" aria-labelledby="check-title" data-observe-section>
      <div class="section-heading">
        <div><p class="eyebrow">Abschlusskontrolle</p><h2 id="check-title">Das musst du gelernt haben</h2></div>
        <div class="check-progress" aria-live="polite"><strong id="check-count">0</strong><span>/ ${model.checklist.length}</span></div>
      </div>
      <div class="progress-track" aria-hidden="true"><span id="check-progress-bar"></span></div>
      <div class="checklist">${model.checklist.map((item, index) =>
        `<label><input type="checkbox" data-check="${index}"><span>${escapeHtml(item)}</span></label>`,
      ).join("")}</div>
    </section>`
    : "";

  const practice = model.practiceItems.length
    ? `<section class="panel" id="practice" aria-labelledby="practice-title" data-observe-section>
      <div class="section-heading"><div><p class="eyebrow">Quellengebundenes Training</p><h2 id="practice-title">Anwenden statt wiedererkennen</h2></div><span class="section-count">${model.practiceItems.length} Aufgaben</span></div>
      <div class="practice-list">${model.practiceItems.map((item, index) => `<details>
        <summary><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(item.prompt)}</summary>
        <div class="detail-answer"><p>${escapeHtml(item.answer)}</p>
        <small>${escapeHtml(item.learningGoal)} · ${sourceLinks(model, item.sourceIds)}</small></div>
      </details>`).join("")}</div>
    </section>`
    : "";

  const formulas = model.formulas.length
    ? `<section class="panel" id="formulas" aria-labelledby="formula-title" data-observe-section>
      <div class="section-heading"><div><p class="eyebrow">Belegte Mathematik</p><h2 id="formula-title">Formeln auf einen Blick</h2></div><span class="section-count">${model.formulas.length} Formeln</span></div>
      <div class="formula-list">${model.formulas.map((formula) => `<article class="formula">
        <h3>${escapeHtml(formula.name)}</h3><code>${escapeHtml(formula.expression)}</code>
        <p>${escapeHtml(formula.assumptions)}</p>
        <small>${escapeHtml(formula.variables.join(" · "))}<br>${escapeHtml(formula.units.join(" · "))}<br>${sourceLinks(model, formula.sourceIds)}</small>
      </article>`).join("")}</div>
    </section>`
    : "";

  const workedExamples = model.workedExamples.length
    ? `<section class="panel" id="worked-examples" aria-labelledby="worked-example-title" data-observe-section>
      <div class="section-heading"><div><p class="eyebrow">Anwendung im Kapitel</p><h2 id="worked-example-title">Schritt für Schritt lösen</h2></div><span class="section-count">${model.workedExamples.length} Beispiele</span></div>
      <div class="practice-list">${model.workedExamples.map((example, index) => `<details${index === 0 ? " open" : ""}>
        <summary><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(example.prompt)}</summary>
        <div class="detail-answer">
          <p><strong>${example.origin === "derived" ? "Didaktisches Übungsbeispiel" : "Kursbeispiel"}</strong> · ${escapeHtml(example.learningGoal)}</p>
          <ol>${example.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
          <p><strong>Ergebnis:</strong> ${escapeHtml(example.result)}</p>
          <small>${sourceLinks(model, example.sourceIds)}</small>
        </div>
      </details>`).join("")}</div>
    </section>`
    : "";

  const navItems = [
    { id: "overview", label: "Überblick", visible: true },
    { id: "topics", label: "Lernstoff", visible: model.topics.length > 0 },
    { id: "formulas", label: "Formeln", visible: model.formulas.length > 0 },
    { id: "worked-examples", label: "Beispiele", visible: model.workedExamples.length > 0 },
    { id: "checklist", label: "Lerncheck", visible: model.checklist.length > 0 },
    { id: "practice", label: "Training", visible: model.practiceItems.length > 0 },
    { id: "sources", label: "Quellen", visible: model.sources.length > 0 },
    { id: "notes", label: "Hinweise", visible: model.warnings.length > 0 },
  ].filter(({ visible }) => visible)
    .map(({ id, label }, index) => navItem(id, label, String(index + 1).padStart(2, "0")))
    .join("");

  const topicQuickLinks = model.topics.map((topic, index) =>
    `<a href="#${escapeAttr(topic.id)}"><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(topic.title)}</a>`
  ).join("");
  const firstTopicId = model.topics[0]?.id ?? "sources";
  const learningRoute = [
    model.topics.length
      ? routeStep("1", "Stoff erfassen", `${model.topics.length} priorisierte Themen`, `#${firstTopicId}`)
      : "",
    model.formulas.length
      ? routeStep("2", "Rechnen absichern", `${model.formulas.length} belegte Formeln`, "#formulas")
      : "",
    model.workedExamples.length
      ? routeStep("3", "Anwendung üben", `${model.workedExamples.length} vollständige Beispiele`, "#worked-examples")
      : "",
    model.checklist.length
      ? routeStep(model.workedExamples.length ? "4" : model.formulas.length ? "3" : "2", "Verständnis prüfen", `${model.checklist.length} klare Lernziele`, "#checklist")
      : "",
    model.sources.length
      ? routeStep("↗", "Bei Bedarf nachschlagen", `${model.sources.length} direkt nutzbare Quellen`, "#sources")
      : "",
  ].join("");

  return `<!doctype html>
<html lang="${model.language}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<style>
:root{
  --sb-navy:#172343;--sb-blue:#2f3b64;--sb-gold:#e0b85c;--sb-gold-dark:#9b7124;
  --sb-cyan:#28798d;--sb-green:#1e7453;--sb-amber:#a87517;--sb-red:#a73838;
  --sb-ink:#202941;--sb-muted:#66708a;--sb-line:#d8deea;--sb-soft:#f3f6fa;--sb-white:#fff;
  --paper:#f3f1eb;--rail:248px;--header:76px;--shadow:0 12px 32px rgba(23,35,67,.08);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:calc(var(--header) + 20px)}
body{margin:0;background:var(--paper);color:var(--sb-ink);font:16px/1.58 "Aptos","Segoe UI",system-ui,sans-serif;overflow-x:hidden}
a{color:var(--sb-navy);font-weight:700;text-underline-offset:3px}
button,a{touch-action:manipulation}
button,input{font:inherit}
button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--sb-gold);outline-offset:3px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:fixed;z-index:100;top:.5rem;left:.5rem;transform:translateY(-160%);background:white;padding:.7rem 1rem}
.skip-link:focus{transform:none}
.topbar{position:sticky;z-index:30;top:0;height:var(--header);display:grid;grid-template-columns:var(--rail) minmax(0,1fr) auto;align-items:center;background:var(--sb-navy);color:white;border-bottom:4px solid var(--sb-gold);padding:0 clamp(1rem,3vw,2.2rem)}
.wordmark{font-size:.69rem;letter-spacing:.17em;font-weight:850}.wordmark span{display:block;color:var(--sb-gold);font-size:.59rem;margin-top:.13rem}.brand-badge{display:inline-block;margin-left:.35rem;padding:.1rem .24rem;background:var(--sb-gold);color:var(--sb-navy);letter-spacing:.03em}
.title-block{min-width:0;border-left:1px solid rgba(255,255,255,.18);padding-left:1.4rem}
.title-block strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:700 clamp(1rem,2vw,1.35rem)/1.2 Georgia,"Times New Roman",serif}
.title-block span{display:block;color:#bfc8df;font-size:.76rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.16rem}
.status{display:inline-flex;align-items:center;gap:.45rem;padding:.42rem .65rem;border:1px solid rgba(255,255,255,.26);font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;font-weight:800}
.status::before{content:"";width:.48rem;height:.48rem;border-radius:50%;background:var(--sb-gold)}
.app-shell{width:min(1440px,100%);margin:auto;display:grid;grid-template-columns:var(--rail) minmax(0,1fr);gap:clamp(1rem,3vw,3rem);padding:0 clamp(1rem,3vw,2.2rem) 5rem}
.rail{position:sticky;top:var(--header);align-self:start;height:calc(100vh - var(--header));padding:2rem 1.2rem 1.2rem 0;border-right:1px solid #d2d3d0;overflow:auto}
.rail-heading,.rail-section-label{margin:0 0 .7rem;color:var(--sb-muted);font-size:.66rem;text-transform:uppercase;letter-spacing:.14em;font-weight:850}
.main-nav{display:grid;gap:.25rem}
.main-nav a{display:grid;grid-template-columns:1.8rem 1fr;align-items:center;gap:.5rem;padding:.62rem .7rem;text-decoration:none;color:var(--sb-muted);border-left:3px solid transparent;font-size:.9rem}
.main-nav a span{font-size:.64rem;letter-spacing:.08em}
.main-nav a:hover,.main-nav a.is-active{color:var(--sb-navy);background:white;border-left-color:var(--sb-gold-dark)}
.topic-subnav{margin:1.6rem 0;padding-top:1.2rem;border-top:1px solid #d2d3d0}
.topic-subnav a{display:grid;grid-template-columns:1.7rem 1fr;gap:.4rem;padding:.42rem .6rem;color:var(--sb-muted);text-decoration:none;font-size:.74rem;line-height:1.35}
.topic-subnav a span{color:var(--sb-gold-dark);font-weight:850}
.rail-progress{margin-top:1.4rem;padding:1rem;background:var(--sb-navy);color:white}
.rail-progress strong{display:block;font:700 1.65rem Georgia,serif}.rail-progress span{color:#c8d0e3;font-size:.72rem}.rail-progress strong>span{display:inline;color:inherit;font:inherit}
.rail-progress .mini-track{display:block;height:4px;margin-top:.7rem;background:rgba(255,255,255,.18)}.rail-progress .mini-track i{display:block;width:0;height:100%;background:var(--sb-gold)}
main{min-width:0;padding-top:clamp(1rem,3vw,2.4rem);display:grid;gap:1.1rem}
.panel{background:var(--sb-white);border:1px solid var(--sb-line);box-shadow:var(--shadow);padding:clamp(1.1rem,2.6vw,2.1rem);min-width:0}
.overview{padding:0;overflow:hidden}
.overview-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding:clamp(1.3rem,3vw,2.5rem);background:var(--sb-navy);color:white}
.overview h1{max-width:900px;margin:.3rem 0 .7rem;font:700 clamp(2rem,4.6vw,4.2rem)/1.02 Georgia,"Times New Roman",serif;letter-spacing:-.035em}
.overview-course{margin:0;color:#c7d0e6}
.overview-state{align-self:start;display:grid;gap:.2rem;min-width:110px;text-align:right}.overview-state strong{font:700 2.25rem Georgia,serif;color:var(--sb-gold)}.overview-state span{font-size:.7rem;color:#c7d0e6;text-transform:uppercase;letter-spacing:.09em}
.scope{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1rem;padding:1rem clamp(1.3rem,3vw,2.5rem);border-bottom:1px solid var(--sb-line);background:#fffaf0}
.scope strong{color:var(--sb-gold-dark);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
.route{padding:clamp(1.3rem,3vw,2.5rem)}.route h2{margin:0 0 .9rem;font:700 1.35rem Georgia,serif}
.route-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.65rem}
.route-step{position:relative;display:grid;grid-template-columns:2.1rem 1fr;gap:.65rem;align-items:start;padding:1rem;border:1px solid var(--sb-line);color:var(--sb-ink);text-decoration:none;background:var(--sb-soft)}
.route-step:hover{border-color:var(--sb-cyan);background:white}.route-step>span{display:grid;place-items:center;width:2rem;height:2rem;background:var(--sb-navy);color:white;font-weight:850}
.route-step strong{display:block}.route-step small{display:block;color:var(--sb-muted);font-weight:500;margin-top:.12rem}
.eyebrow,.topic-meta{font-size:.67rem;text-transform:uppercase;letter-spacing:.13em;color:var(--sb-cyan);font-weight:850}
.section-heading{display:flex;align-items:end;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--sb-line);padding-bottom:1rem;margin-bottom:1rem}
.section-heading h2{font:700 clamp(1.55rem,3vw,2.25rem)/1.15 Georgia,"Times New Roman",serif;margin:.2rem 0 0}
.section-heading .eyebrow{margin:0}.section-count{color:var(--sb-muted);font-size:.78rem;white-space:nowrap}
.topic-list{display:grid;gap:.7rem}
.topic{display:grid;grid-template-columns:64px minmax(0,1fr);border:1px solid var(--sb-line);background:white;scroll-margin-top:calc(var(--header) + 20px)}
.topic-index{padding:1.35rem .7rem;text-align:center;font:700 1.45rem Georgia,serif;color:var(--sb-gold-dark);border-right:1px solid var(--sb-line);background:#faf8f2}
.topic-content{padding:1.25rem 1.4rem 1.35rem}.topic-meta{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}
.priority{padding:.18rem .4rem;background:var(--sb-soft)}.priority-essential{color:var(--sb-red)}.priority-important{color:var(--sb-amber)}.priority-supplementary{color:var(--sb-green)}
.topic h3{font:700 clamp(1.35rem,2.4vw,1.85rem)/1.2 Georgia,serif;margin:.4rem 0}.topic-summary{max-width:880px;margin:.4rem 0 1rem}
.learning-goals{display:grid;grid-template-columns:130px minmax(0,1fr);gap:1rem;padding-top:.8rem;border-top:1px solid var(--sb-line)}
.learning-goals>p{margin:0;color:var(--sb-muted);font-size:.78rem;font-weight:800}.learning-goals ul{columns:2;column-gap:2rem;margin:0;padding-left:1.15rem}.learning-goals li{break-inside:avoid;margin-bottom:.25rem}
.citations,.formula small,details small{color:var(--sb-muted);font-size:.78rem}.citations{margin:.8rem 0 0}.citation{display:inline-block;margin-right:.28rem;color:var(--sb-cyan)}
.learning-check{background:var(--sb-navy);color:white}.learning-check .eyebrow{color:var(--sb-gold)}.learning-check .section-heading{border-color:rgba(255,255,255,.2)}
.check-progress{display:flex;align-items:baseline;gap:.2rem;white-space:nowrap}.check-progress strong{font:700 2rem Georgia,serif;color:var(--sb-gold)}.check-progress span{color:#bfc8df}
.progress-track{height:5px;background:rgba(255,255,255,.18);margin:-.25rem 0 1rem}.progress-track span{display:block;width:0;height:100%;background:var(--sb-gold);transition:width .2s ease}
.checklist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}.checklist label{display:flex;align-items:flex-start;gap:.7rem;padding:.8rem;border:1px solid rgba(255,255,255,.18);cursor:pointer}.checklist label:has(input:checked){background:rgba(255,255,255,.08);color:#cbd3e5}.checklist input{margin-top:.35rem;accent-color:var(--sb-gold)}
.formula-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:.7rem}.formula{border-left:4px solid var(--sb-cyan);background:var(--sb-soft);padding:1rem}.formula h3{margin:0 0 .5rem}.formula code{display:block;font-size:1.03rem;overflow-wrap:anywhere}.formula p{font-size:.88rem}
.practice-list{display:grid}.practice-list details{border-bottom:1px solid var(--sb-line)}summary{display:flex;gap:.8rem;cursor:pointer;font-weight:750;padding:1rem 0}summary>span{color:var(--sb-cyan);font-size:.72rem}.detail-answer{padding:0 0 1rem 2rem}
.source-panel{padding-bottom:1.2rem}.source-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:.8rem;margin-bottom:.8rem}
.search-box{position:relative}.search-box input{width:100%;height:44px;border:1px solid var(--sb-line);background:var(--sb-soft);padding:.7rem 2.5rem .7rem .85rem;color:var(--sb-ink)}.search-box span{position:absolute;right:.85rem;top:.65rem;color:var(--sb-muted)}
.filter-row{display:flex;gap:.35rem;min-width:0;max-width:100%;overflow-x:auto;padding-bottom:.2rem}.filter-chip{height:44px;max-width:100%;flex:0 1 auto;white-space:nowrap;border:1px solid var(--sb-line);background:white;color:var(--sb-muted);padding:.45rem .65rem;cursor:pointer;font-size:.78rem;font-weight:800}.filter-chip span{margin-left:.35rem;color:var(--sb-cyan)}.filter-chip:hover,.filter-chip.is-active{background:var(--sb-navy);border-color:var(--sb-navy);color:white}
.source-layout{display:grid;grid-template-columns:minmax(300px,.9fr) minmax(0,1.1fr);height:min(68vh,700px);min-height:480px;border:1px solid var(--sb-line);min-width:0}
.source-results{overflow:auto;min-width:0;border-right:1px solid var(--sb-line);scrollbar-color:var(--sb-cyan) var(--sb-soft)}
.source-row{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:.65rem;align-items:center;padding:.78rem;border-bottom:1px solid var(--sb-line);scroll-margin-top:.5rem}.source-row:hover,.source-row.is-target{background:#f8fbfc}.source-row[hidden]{display:none}
.source-number{color:var(--sb-cyan);font-size:.72rem;font-weight:850}.source-copy{min-width:0}.source-copy strong{display:block;font-size:.84rem;line-height:1.3}.source-copy span{display:block;color:var(--sb-muted);font-size:.66rem;margin-top:.15rem}
.source-actions{display:flex;gap:.3rem;align-items:center}.button{display:inline-flex;align-items:center;justify-content:center;min-height:32px;border:1px solid var(--sb-navy);padding:.35rem .48rem;text-decoration:none;font-size:.7rem;font-weight:800;cursor:pointer}.button-secondary{background:white;color:var(--sb-navy)}.button-quiet{border-color:transparent;color:var(--sb-muted);background:transparent}.button:hover{background:var(--sb-navy);color:white}
.source-empty{padding:2rem;text-align:center;color:var(--sb-muted)}
.preview-pane{position:relative;display:grid;grid-template-rows:auto 1fr;background:var(--sb-soft);min-width:0;min-height:0}.preview-head{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.75rem 1rem;border-bottom:1px solid var(--sb-line);background:white}.preview-head h3{margin:0;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.preview-close{display:none;border:0;background:transparent;color:var(--sb-muted);cursor:pointer}.preview-body{display:grid;place-items:center;min-height:0;padding:.7rem}.preview-pane object{width:100%;height:100%;border:0;background:white}.empty-preview{max-width:280px;text-align:center;color:var(--sb-muted);font-size:.84rem}
.warnings{border-left:5px solid var(--sb-amber)}.warnings ul{margin-bottom:0}
footer{padding:1.5rem;text-align:center;color:var(--sb-muted);font-size:.72rem}
@media(max-width:980px){
  :root{--rail:190px}.topbar{grid-template-columns:var(--rail) minmax(0,1fr) auto}.source-layout{grid-template-columns:minmax(280px,.95fr) minmax(0,1.05fr)}.source-row{grid-template-columns:38px minmax(0,1fr)}.source-actions{grid-column:2}.button-quiet{padding-left:0}
}
@media(max-width:1100px){
  .source-toolbar{grid-template-columns:1fr;min-width:0}.filter-row{flex-wrap:wrap;overflow-x:visible}.filter-chip{white-space:normal;text-align:left}.source-layout{display:flex;flex-direction:column;height:auto;min-height:0}.source-results{height:60vh;min-height:380px;border-right:0}.preview-pane{display:none;position:fixed;z-index:50;inset:.5rem;max-width:calc(100vw - 1rem);background:var(--sb-soft);box-shadow:0 0 0 100vmax rgba(23,35,67,.55);height:auto}.preview-pane.is-open{display:grid}.preview-close{display:block}.source-row{grid-template-columns:38px minmax(0,1fr)}.source-actions{grid-column:2}.preview-body{min-height:0}
}
@media(max-width:800px){
  :root{--header:68px}.topbar{grid-template-columns:auto minmax(0,1fr);gap:.8rem;padding:.55rem .75rem}.wordmark span,.title-block span,.topbar>.status{display:none}.title-block{padding-left:.8rem}.app-shell{display:block;padding:0 .5rem 3rem}
  .rail{z-index:20;top:var(--header);height:auto;margin:0 -.5rem;padding:0;background:var(--paper);border:0;border-bottom:1px solid #d2d3d0;overflow-x:auto}.rail-heading,.topic-subnav,.rail-progress{display:none}.main-nav{display:flex;width:max-content;padding:.4rem .5rem}.main-nav a{display:flex;padding:.5rem .65rem;border-left:0;border-bottom:3px solid transparent}.main-nav a.is-active{border-left:0;border-bottom-color:var(--sb-gold-dark)}
  main{padding-top:.5rem;gap:.55rem}.panel{padding:1rem;box-shadow:none}.overview-head{grid-template-columns:1fr;padding:1.2rem}.overview h1{font-size:clamp(1.8rem,9vw,2.8rem)}.overview-state{display:none}.scope{grid-template-columns:1fr;gap:.3rem;padding:1rem 1.2rem}.route{padding:1rem 1.2rem}.route-grid{grid-template-columns:1fr 1fr}
  .section-heading{align-items:start}.topic{grid-template-columns:44px minmax(0,1fr)}.topic-index{padding:1rem .4rem;font-size:1.05rem}.topic-content{padding:1rem}.learning-goals{grid-template-columns:1fr;gap:.4rem}.learning-goals ul{columns:1}.checklist{grid-template-columns:1fr}
}
@media(max-width:430px){.route-grid{grid-template-columns:1fr}.section-count{display:none}.source-row{padding:.7rem .55rem}.button{min-height:36px}.source-actions{flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.progress-track span{transition:none}}
@media print{body{background:white}.topbar,.rail,.route,.source-toolbar,.preview-pane,button{display:none!important}.app-shell{display:block;padding:0}.panel,.topic{box-shadow:none;break-inside:avoid}main{padding:0}.source-layout{display:block;height:auto}.source-results{overflow:visible}.source-row{break-inside:avoid}a[href]::after{content:" (" attr(href) ")";font-size:.65em;font-weight:400}}
</style>
</head>
<body>
<a class="skip-link" href="#content">Zum Inhalt springen</a>
<header class="topbar">
  <div class="wordmark">STUDY BUDDY 2.0 <b class="brand-badge">SB 2.0</b><span>EXAM NAVIGATOR</span></div>
  <div class="title-block"><strong>${escapeHtml(model.title)}</strong><span>${escapeHtml(model.courseTitle)}</span></div>
  <span class="status">${statusLabel(model.publicationStatus)}</span>
</header>
<div class="app-shell">
  <aside class="rail" aria-label="Seitennavigation">
    <p class="rail-heading">In diesem Guide</p>
    <nav class="main-nav">${navItems}</nav>
    ${topicQuickLinks ? `<div class="topic-subnav"><p class="rail-section-label">Direkt zum Thema</p>${topicQuickLinks}</div>` : ""}
    ${model.checklist.length ? `<div class="rail-progress"><strong><span id="rail-check-count">0</span>/${model.checklist.length}</strong><span>Lernziele abgeschlossen</span><span class="mini-track"><i id="rail-progress-bar"></i></span></div>` : ""}
  </aside>
  <main id="content">
    <section class="panel overview" id="overview" data-observe-section>
      <div class="overview-head">
        <div><p class="eyebrow">Dein Lern-Cockpit</p><h1>${escapeHtml(model.title)}</h1><p class="overview-course">${escapeHtml(model.courseTitle)}</p></div>
        <div class="overview-state"><strong>${model.topics.length}</strong><span>priorisierte<br>Themenblöcke</span></div>
      </div>
      <div class="scope"><strong>Was ist belegt?</strong><span>${escapeHtml(model.scopeNote)}</span></div>
      <div class="route"><h2>So arbeitest du dich durch</h2><div class="route-grid">${learningRoute}</div></div>
    </section>
    ${model.topics.length ? `<section class="panel" id="topics" aria-labelledby="topics-title" data-observe-section>
      <div class="section-heading"><div><p class="eyebrow">Priorisierte Stoffstruktur</p><h2 id="topics-title">Lernstoff</h2></div><span class="section-count">${model.topics.length} Themen · von oben nach unten</span></div>
      <div class="topic-list">${topics}</div>
    </section>` : ""}
    ${formulas}
    ${workedExamples}
    ${checklist}
    ${practice}
    ${model.sources.length ? `<section class="panel source-panel" id="sources" aria-labelledby="sources-title" data-observe-section>
      <div class="section-heading"><div><p class="eyebrow">Stofflandkarte & Nachschlagewerk</p><h2 id="sources-title">Quellen finden und öffnen</h2></div><span class="section-count" id="source-result-count">${model.sources.length} von ${model.sources.length}</span></div>
      <div class="source-toolbar">
        <label class="search-box"><span class="sr-only">Quellen durchsuchen</span><input id="source-search" type="search" placeholder="Titel, Typ oder Q-Nummer suchen …" autocomplete="off"><span aria-hidden="true">⌕</span></label>
        <div class="filter-row" aria-label="Quellen filtern">${sourceFilters}</div>
      </div>
      <div class="source-layout">
        <div class="source-results" id="source-results">${sourceMap}<p class="source-empty" id="source-empty" hidden>Keine passende Quelle gefunden.</p></div>
        <aside class="preview-pane" id="preview-pane" aria-live="polite">
          <div class="preview-head"><h3 id="preview-title">Lokale Vorschau</h3><button type="button" class="preview-close" id="preview-close" aria-label="Vorschau schließen">✕</button></div>
          <div class="preview-body"><p class="empty-preview" id="preview-empty">Wähle links „Vorschau“. Die Quelle bleibt dabei direkt neben der Liste geöffnet.</p><object id="preview-object" hidden aria-label="Lokale Quellenvorschau"></object></div>
        </aside>
      </div>
    </section>` : ""}
    ${model.warnings.length ? `<section class="panel warnings" id="notes" data-observe-section><p class="eyebrow">Transparenz</p><h2>Offene Quellenhinweise</h2><ul>${model.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></section>` : ""}
  </main>
</div>
<footer>Study Buddy · Evidenzbasiertes Lernartefakt</footer>
<script>
const storageKey="sb:${escapeJs(model.courseTitle)}:${escapeJs(model.profile)}:checks";
let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||"{}")}catch{}
const checks=[...document.querySelectorAll("[data-check]")];
const updateProgress=()=>{
  const complete=checks.filter(input=>input.checked).length;
  const percent=checks.length?complete/checks.length*100:0;
  ["check-count","rail-check-count"].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=String(complete)});
  ["check-progress-bar","rail-progress-bar"].forEach(id=>{const el=document.getElementById(id);if(el)el.style.width=percent+"%"});
};
checks.forEach(input=>{
  input.checked=Boolean(saved[input.dataset.check]);
  input.addEventListener("change",()=>{saved[input.dataset.check]=input.checked;localStorage.setItem(storageKey,JSON.stringify(saved));updateProgress()});
});
updateProgress();

const previewObject=document.getElementById("preview-object");
const previewEmpty=document.getElementById("preview-empty");
const previewPane=document.getElementById("preview-pane");
document.querySelectorAll("[data-preview]").forEach(button=>button.addEventListener("click",()=>{
  previewObject.data=button.dataset.preview;previewObject.hidden=false;previewEmpty.hidden=true;
  document.getElementById("preview-title").textContent=button.dataset.title;
  previewPane.classList.add("is-open");
}));
document.getElementById("preview-close")?.addEventListener("click",()=>previewPane.classList.remove("is-open"));

const sourceRows=[...document.querySelectorAll("[data-source-row]")];
const search=document.getElementById("source-search");
const filterButtons=[...document.querySelectorAll("[data-filter]")];
let activeFilter="all";
const applySourceFilters=()=>{
  const query=(search?.value||"").trim().toLocaleLowerCase("${model.language}");
  let visible=0;
  sourceRows.forEach(row=>{
    const show=(activeFilter==="all"||row.dataset.category===activeFilter)&&(!query||row.dataset.search.includes(query));
    row.hidden=!show;if(show)visible++;
  });
  const counter=document.getElementById("source-result-count");if(counter)counter.textContent=visible+" von "+sourceRows.length;
  const empty=document.getElementById("source-empty");if(empty)empty.hidden=visible!==0;
};
search?.addEventListener("input",applySourceFilters);
filterButtons.forEach(button=>button.addEventListener("click",()=>{
  activeFilter=button.dataset.filter;
  filterButtons.forEach(item=>{const active=item===button;item.classList.toggle("is-active",active);item.setAttribute("aria-pressed",String(active))});
  applySourceFilters();
}));
document.querySelectorAll("[data-source-jump]").forEach(link=>link.addEventListener("click",()=>{
  activeFilter="all";if(search)search.value="";
  filterButtons.forEach(item=>{const active=item.dataset.filter==="all";item.classList.toggle("is-active",active);item.setAttribute("aria-pressed",String(active))});
  applySourceFilters();
  const target=document.querySelector(link.getAttribute("href"));
  setTimeout(()=>{target?.scrollIntoView({block:"center"});target?.classList.add("is-target");setTimeout(()=>target?.classList.remove("is-target"),1400)},80);
}));

const navLinks=[...document.querySelectorAll(".main-nav a")];
const observed=[...document.querySelectorAll("[data-observe-section]")];
if("IntersectionObserver" in window){
  const observer=new IntersectionObserver(entries=>{
    const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(!visible)return;
    navLinks.forEach(link=>link.classList.toggle("is-active",link.getAttribute("href")==="#"+visible.target.id));
  },{rootMargin:"-20% 0px -65% 0px",threshold:[0,.2,.6]});
  observed.forEach(section=>observer.observe(section));
}
</script>
</body>
</html>`;
}

function navItem(id: string, label: string, number: string): string {
  return `<a href="#${id}"${id === "overview" ? ' class="is-active"' : ""}><span>${number}</span>${label}</a>`;
}

function routeStep(number: string, title: string, description: string, href: string): string {
  return `<a class="route-step" href="${escapeAttr(href)}"><span>${number}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></div></a>`;
}

function sourceLinks(model: StudyModel, ids: string[]): string {
  return ids.map((id) => model.sources.findIndex((source) => source.id === id))
    .filter((index) => index >= 0)
    .map((index) => `<a class="citation" href="#source-q${index + 1}" data-source-jump>Q${index + 1}</a>`)
    .join(" ");
}

function classifySource(title: string, kind: string): SourceCategory {
  const value = `${title} ${kind}`.toLocaleLowerCase("de");
  if (/\b(lösung|loesung|solution)\b/.test(value)) return "solution";
  if (/\b(angabe|aufgabe|exercise|worksheet)\b/.test(value)) return "exercise";
  if (/\b(foliensatz|folien|slides?|presentation|pptx?)\b/.test(value)) return "slides";
  if (/\b(quiz|moodle test|theorietest|test: theorie)\b/.test(value)) return "test";
  if (/\b(external|video|youtube|literatur)\b/.test(value)) return "external";
  if (/\b(moodle_page|calendar|cis|course|kurs|prüfung|exam)\b/.test(value)) return "course";
  return "other";
}

function sourceCategoryLabel(category: SourceCategory): string {
  return {
    slides: "Folien",
    exercise: "Aufgabe",
    solution: "Lösung",
    test: "Test",
    external: "Externe Quelle",
    course: "Kursinformation",
    other: "Weitere Quelle",
  }[category];
}

function relativeAsset(runDir: string, assetPath: string): string {
  const relative = path.relative(runDir, assetPath).split(path.sep).join("/");
  return relative.startsWith("..") ? "" : relative;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function statusLabel(status: StudyModel["publicationStatus"]): string {
  return { complete: "vollständig belegt", partial: "teilweise belegt", blocked: "blockiert" }[status];
}

function priorityLabel(priority: StudyModel["topics"][number]["priority"]): string {
  return { essential: "Essentiell", important: "Wichtig", supplementary: "Ergänzend" }[priority];
}

function scopeLabel(scope: StudyModel["topics"][number]["scopeStatus"]): string {
  return { confirmed: "Prüfungsstoff bestätigt", inferred: "Aus Kursstruktur abgeleitet", unknown: "Prüfungsbezug ungeklärt" }[scope];
}
