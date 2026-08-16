import { studyGuideContentSchema, type StudyGuideContent } from "./studyGuideContent.js";
import type { JsonObject } from "./state.js";

export function renderStandardStudyGuide(contentValue: JsonObject, language: "de" | "en"): string {
  const content = studyGuideContentSchema.parse(contentValue);
  const text = (german: string, english: string) => language === "de" ? german : english;
  const courseIdentity = content.courseCode.trim() || compactCourseIdentity(content.courseTitle);
  const storageNamespace = `study-buddy-guide-${storageSlug(`${courseIdentity}-${content.courseTitle}`)}-v1`;
  const allExercises = content.topics.flatMap((topic) => topic.exercises);
  const crossCount = allExercises.filter((exercise) => exercise.type === "cross").length;
  const calculationCount = allExercises.filter((exercise) => exercise.type === "calculation").length;
  const contentJson = JSON.stringify(clientContentForDisplay(content)).replace(/</g, "\\u003c");
  const interactionController = standardStudyGuideInteractionController(storageNamespace, language);
  const chapterTabsHtml = content.topics.map((topic, index) => `<button class="topic-link${index === 0 ? " is-active" : ""}" id="tab-${esc(topic.id)}" type="button" role="tab" aria-selected="${index === 0 ? "true" : "false"}" aria-controls="topic-${esc(topic.id)}" tabindex="${index === 0 ? "0" : "-1"}" data-topic-tab="${esc(topic.id)}"><span class="chapter-number">${String(index + 1).padStart(2, "0")}</span><span class="chapter-copy"><strong>${esc(topic.title)}</strong><small data-chapter-status="${esc(topic.id)}">0 / ${topic.exercises.length} ${text("erledigt", "completed")}</small></span><span class="chapter-state" aria-hidden="true"></span></button>`).join("");
  const dashboardTopicsHtml = content.topics.map((topic, index) => `<button class="dashboard-topic" type="button" data-dashboard-topic="${esc(topic.id)}" data-dashboard-state="open"><span class="dashboard-topic-index">${String(index + 1).padStart(2, "0")}</span><span class="dashboard-topic-copy"><strong>${esc(topic.title)}</strong><small data-dashboard-topic-status="${esc(topic.id)}">0 ${text("von", "of")} ${topic.exercises.length}</small></span><span class="dashboard-topic-bar"><i data-dashboard-topic-bar="${esc(topic.id)}"></i></span></button>`).join("");
  const topicsHtml = content.topics.map((topic, topicIndex) => {
    const firstCheck = topic.exercises.slice(0, 2);
    const guidedPractice = topic.exercises.slice(2, 5);
    const examPractice = topic.exercises.slice(5);
    const quantitative = topic.exercises.some((exercise) => exercise.type === "calculation") || topic.theory.formulas.length > 0;
    const renderExercises = (exercises: typeof topic.exercises, offset: number) => exercises
      .map((exercise, exerciseIndex) =>
        exercise.type === "cross"
          ? crossHtml(exercise, exerciseIndex + offset, language)
          : exercise.type === "calculation"
            ? calculationHtml(exercise, exerciseIndex + offset, language)
            : exercise.type === "application"
              ? applicationHtml(exercise, exerciseIndex + offset, language)
              : vocabularyHtml(exercise, exerciseIndex + offset, language)
      )
      .join("");
    return `
    <section class="topic" id="topic-${esc(topic.id)}" data-sb-topic="${esc(topic.id)}" role="tabpanel" aria-labelledby="tab-${esc(topic.id)}"${topicIndex === 0 ? "" : " hidden"}>
      <header class="topic-head">
        <div><span class="topic-index">${String(topicIndex + 1).padStart(2, "0")}</span><p class="eyebrow">${text("Lernmodul", "Learning module")}</p><h2>${esc(topic.title)}</h2></div>
        <div class="topic-status" data-topic-status="${esc(topic.id)}">0 / ${topic.exercises.length}</div>
      </header>
      <div class="learning-path" data-sb-course-map>
        <article class="lesson-step lesson-step--intro" data-sb-theory data-sb-learning-content>
          <div class="step-marker"><span>1</span><small>${text("Verstehen", "Understand")}</small></div>
          <div class="step-content readable-copy"><p class="block-label">${text("Einstieg", "Introduction")}</p><h3>${text("Worum geht es?", "What is this about?")}</h3><p class="lead-copy">${richMathText(topic.theory.summary)}</p><div class="goal-panel"><strong>${text("Nach diesem Kapitel kannst du", "After this chapter, you can")}</strong><ul>${topic.learningGoals.map((goal) => `<li>${richMathText(goal)}</li>`).join("")}</ul></div></div>
        </article>
        <section class="lesson-step lesson-step--check practice practice--compact" data-sb-practice aria-labelledby="check-${esc(topic.id)}">
          <div class="step-marker"><span>2</span><small>${text("Prüfen", "Check")}</small></div>
          <div class="step-content"><div class="practice-head"><div><p class="block-label">${text("Direkt anwenden", "Apply directly")}</p><h3 id="check-${esc(topic.id)}">${text("Hast du die Grundidee?", "Do you have the core idea?")}</h3></div><p>${firstCheck.length} ${text("kurze Aufgaben, bevor es tiefer geht.", "short exercises before going deeper.")}</p></div><div class="task-list">${renderExercises(firstCheck, 0)}</div></div>
        </section>
        <article class="lesson-step lesson-step--deepen">
          <div class="step-marker"><span>3</span><small>${text("Vertiefen", "Deepen")}</small></div>
          <div class="step-content"><p class="block-label">${quantitative ? text("Mathematische Struktur", "Mathematical structure") : text("Begriffe & Zusammenhänge", "Concepts and relationships")}</p><h3>${quantitative ? text("So denkst du im Rechenweg", "How to reason through the calculation") : text("So ordnest du das Thema ein", "How to place the topic in context")}</h3><div class="principle-grid">${topic.theory.keyIdeas.map((idea, index) => `<div class="principle"><span>${index + 1}</span><p>${richMathText(idea)}</p></div>`).join("")}</div>${topic.theory.formulas.length ? `<div class="formula-deck">${topic.theory.formulas.map((formula) => `<figure class="formula"><div class="math-scroll">${mathml(formula.expression)}</div><figcaption>${richMathText(formula.meaning)}</figcaption></figure>`).join("")}</div>` : ""}</div>
        </article>
        <article class="lesson-step lesson-step--example">
          <div class="step-marker"><span>4</span><small>${text("Nachvollziehen", "Follow")}</small></div>
          <div class="step-content"><p class="block-label">${text("Geführtes Beispiel", "Guided example")}</p><h3>${quantitative ? text("Einen vollständigen Lösungsweg lesen", "Read a complete solution path") : text("Eine vollständige Anwendung nachvollziehen", "Follow a complete application")}</h3><div class="examples">${topic.workedExamples.map((example) => `<details class="worked" data-sb-worked-example><summary><span>${esc(example.title)}</span><span class="summary-action">${quantitative ? text("Rechenweg öffnen", "Open solution path") : text("Begründung öffnen", "Open reasoning")}</span></summary><div class="worked-body"><div class="problem">${richMathText(example.prompt)}</div><ol class="steps">${example.steps.map((step) => `<li>${richMathText(step)}</li>`).join("")}</ol><p class="result"><strong>${text("Ergebnis:", "Result:")}</strong> ${richMathText(example.answer)}</p><p class="source-chip">${sourceLabel(example.source, language)}</p></div></details>`).join("")}</div></div>
        </article>
        <section class="lesson-step lesson-step--guided practice" data-sb-practice aria-labelledby="guided-${esc(topic.id)}">
          <div class="step-marker"><span>5</span><small>${text("Anwenden", "Apply")}</small></div>
          <div class="step-content"><div class="practice-head"><div><p class="block-label">${text("Mit Rückmeldung", "With feedback")}</p><h3 id="guided-${esc(topic.id)}">${quantitative ? text("Jetzt selbst rechnen", "Now calculate it yourself") : text("Jetzt selbst anwenden", "Now apply it yourself")}</h3></div><p>${guidedPractice.length} ${text("Aufgaben mit Lösung und Fehlerhinweis.", "exercises with solutions and error guidance.")}</p></div><div class="task-list">${renderExercises(guidedPractice, 2)}</div><details class="retrieval" data-sb-retrieval><summary>${text("Zwischenstopp: ohne Nachsehen erklären", "Checkpoint: explain without looking")}</summary>${topic.retrieval.map((item, index) => `<div class="retrieval-item"><p><strong>${richMathText(item.prompt)}</strong></p><button class="text-button" type="button" data-reveal-retrieval="${esc(topic.id)}-${index}">${text("Antwort prüfen", "Check answer")}</button><p id="retrieval-${esc(topic.id)}-${index}" hidden>${richMathText(item.answer)}</p></div>`).join("")}</details></div>
        </section>
        ${examPractice.length ? `<section class="lesson-step lesson-step--exam practice" data-sb-practice aria-labelledby="practice-${esc(topic.id)}"><div class="step-marker"><span>6</span><small>${text("Festigen", "Consolidate")}</small></div><div class="step-content"><div class="practice-head"><div><p class="block-label">${text("Prüfungstraining", "Exam practice")}</p><h3 id="practice-${esc(topic.id)}">${text("Gemischte Aufgaben", "Mixed exercises")}</h3></div><p>${examPractice.length} ${text("weitere Aufgaben aus dem Moodle-Korpus.", "additional exercises from the Moodle corpus.")}</p></div><div class="task-list">${renderExercises(examPractice, 5)}</div></div></section>` : ""}
      </div>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="study-buddy-renderer" content="standard-study-guide-v1"><title>${esc(content.courseTitle)} · Study Buddy</title>
<style>
:root{--sb-navy:#19254b;--sb-blue:#323a61;--sb-gold:#dfbb63;--sb-gold-dark:#c3994d;--sb-cyan:#397f93;--sb-green:#23805A;--sb-amber:#c3994d;--sb-red:#B33A3A;--sb-ink:#20263f;--sb-muted:#66708f;--sb-line:#d9ddea;--sb-soft:#f6f7fb;--sb-white:#FFFFFF;--ink:var(--sb-ink);--muted:var(--sb-muted);--line:var(--sb-line);--paper:var(--sb-white);--wash:var(--sb-soft);--navy:var(--sb-navy);--blue:var(--sb-blue);--cyan:var(--sb-cyan);--orange:var(--sb-gold-dark);--green:var(--sb-green);--red:var(--sb-red);--radius:18px;--shadow:0 14px 40px rgba(24,34,53,.08)}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:142px}body{margin:0;background:var(--wash);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}button,input{font:inherit}button{cursor:pointer}.skip{position:fixed;left:12px;top:-80px;z-index:100;background:#fff;padding:12px}.skip:focus{top:12px}.hotbar{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}.hotbar-main{height:76px;max-width:1280px;margin:auto;padding:10px 24px;display:flex;align-items:center;gap:18px}.brand{display:flex;align-items:center;gap:12px;min-width:0}.brand img{width:44px;height:44px;object-fit:contain}.brand-text{min-width:0}.brand-text strong,.brand-text span{display:block}.brand-text span{font-size:.78rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hot-actions{margin-left:auto;display:flex;align-items:center;gap:10px}.progress-pill{min-width:150px}.progress-pill strong,.progress-pill span{display:block;font-size:.8rem}.bar{height:6px;border-radius:99px;background:#e9edf3;overflow:hidden}.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--blue),var(--cyan));transition:width .2s}.primary,.secondary,.text-button{border:0;border-radius:10px;padding:10px 14px;font-weight:750}.primary{background:var(--blue);color:#fff}.secondary{background:#eaf0ff;color:var(--navy)}.text-button{padding:4px 0;background:transparent;color:var(--blue);text-decoration:underline}.topic-strip{border-top:1px solid #edf0f5;overflow-x:auto;scrollbar-width:thin}.topic-strip-inner{width:max-content;min-width:100%;max-width:1280px;margin:auto;padding:8px 24px;display:flex;gap:7px}.topic-link{border:1px solid transparent;background:transparent;color:#596579;border-radius:99px;padding:7px 11px;white-space:nowrap;text-decoration:none;font-size:.82rem;font-weight:700}.topic-link:hover,.topic-link:focus-visible{border-color:#b8c5ed;color:var(--blue);outline:0}.hero{max-width:1280px;margin:0 auto;padding:64px 24px 36px}.hero-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:24px}.kicker,.eyebrow,.block-label{color:var(--blue);font-size:.72rem;letter-spacing:.11em;text-transform:uppercase;font-weight:850}.hero h1{font-size:clamp(2.2rem,5vw,5rem);line-height:.97;letter-spacing:-.055em;margin:14px 0 24px;max-width:900px}.hero-lead{font-size:1.13rem;color:#4c586d;max-width:760px}.scope-card{background:var(--navy);color:#fff;border-radius:24px;padding:26px;box-shadow:var(--shadow)}.scope-card p{color:#cbd5e5}.scope-card dl{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0 0}.scope-card dt{font-size:.74rem;color:#aab8cf}.scope-card dd{font-size:1.45rem;font-weight:850;margin:2px 0}.course-map{max-width:1232px;margin:0 auto 54px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:22px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.map-item{padding:14px;border-left:3px solid var(--cyan)}.map-item strong,.map-item span{display:block}.map-item span{font-size:.84rem;color:var(--muted)}main{max-width:1232px;margin:auto;padding:0 24px 80px}.topic{margin:0 0 80px;scroll-margin-top:145px}.topic-head{display:flex;align-items:end;justify-content:space-between;border-bottom:2px solid var(--ink);padding:0 0 16px;margin-bottom:20px}.topic-head>div:first-child{display:grid;grid-template-columns:auto 1fr;column-gap:14px}.topic-index{grid-row:1/3;font-size:2rem;font-weight:900;color:#c5ccda}.topic-head .eyebrow{margin:0}.topic-head h2{margin:0;font-size:clamp(1.65rem,3vw,2.6rem);letter-spacing:-.035em}.topic-status{border:1px solid var(--line);background:#fff;border-radius:99px;padding:7px 12px;font-size:.84rem;font-weight:800}.topic-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,.7fr);gap:18px}.topic-grid>*{min-width:0}.theory,.orientation{min-width:0;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:28px}.theory{box-shadow:var(--shadow)}.theory h3,.orientation h3,.practice h3{font-size:1.35rem;margin:4px 0 14px}.theory ul,.orientation ol{padding-left:1.2rem}.next-step{border-left:3px solid var(--orange);padding-left:14px}.formula{margin:22px 0 0;padding:16px;background:#f7f9fe;border-radius:12px}.math-scroll{max-width:100%;overflow-x:auto;padding:2px}.formula math{font-size:1.18rem}.formula figcaption{font-size:.78rem;color:var(--muted);margin-top:7px}.examples{margin:18px 0}.worked{background:#eef3ff;border:1px solid #cad6fc;border-radius:var(--radius)}.worked summary{list-style:none;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:16px;font-weight:800}.worked summary::-webkit-details-marker{display:none}.summary-action{font-size:.78rem;color:var(--blue)}.worked-body{padding:0 22px 22px}.problem{font-size:1.05rem}.steps{counter-reset:step;list-style:none;padding:0}.steps li{position:relative;padding:10px 10px 10px 42px;border-top:1px solid #d7e0f7}.steps li:before{counter-increment:step;content:counter(step);position:absolute;left:8px;top:9px;width:24px;height:24px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:.75rem;font-weight:900}.result{background:#fff;padding:12px;border-radius:10px}.source-chip{font-size:.75rem;color:#52617a}.practice{background:#e9edf3;border-radius:24px;padding:26px;margin-top:18px}.practice-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:18px}.practice-head p{margin:0;color:var(--muted)}.task-list{display:grid;gap:14px}.task{min-width:0;background:#fff;border:1px solid #d8dee8;border-radius:16px;padding:22px;transition:border-color .15s;overflow-wrap:anywhere}.task.is-complete{border-color:#84cfb2}.task-top{display:flex;align-items:center;gap:9px;margin-bottom:12px}.task-number{font-weight:900;color:var(--blue)}.task-kind{font-size:.7rem;font-weight:850;text-transform:uppercase;letter-spacing:.08em;background:#edf1f7;border-radius:99px;padding:4px 8px}.task-source{margin-left:auto;font-size:.72rem;color:var(--muted)}.task h4{font-size:1.08rem;margin:0 0 14px;white-space:pre-line}.options{border:0;padding:0;margin:0;display:grid;gap:8px}.option{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:11px;padding:11px}.option:has(input:checked){border-color:var(--blue);background:#f3f6ff}.option input{margin-top:5px}.task-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}.feedback{margin-top:14px;padding:14px;border-radius:12px;background:#f5f7fa}.feedback.good{background:#eaf8f2;color:#0d6041}.feedback.bad{background:#fff1f0;color:#8f2018}.feedback ul{margin:.5rem 0 0;padding-left:1.2rem}.calc-input{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;max-width:620px}.calc-input input{width:100%;border:1px solid #b9c2d0;border-radius:10px;padding:11px}.hints{margin-top:12px}.hints summary{font-weight:750;color:var(--blue)}.self-check{display:flex;gap:8px;margin-top:12px}.retrieval{margin-top:14px;background:#fff;border:1px dashed #aeb8c7;border-radius:14px;padding:14px 18px}.retrieval summary{font-weight:800}.retrieval-item{padding:8px 0}.sources{background:#fff;border-top:4px solid var(--navy);padding:42px 24px 70px}.sources-inner{max-width:1184px;margin:auto}.source-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.source{border:1px solid var(--line);border-radius:12px;padding:15px}.source p{font-size:.82rem;color:var(--muted)}.footer-actions{margin-top:28px}.sr-live{position:fixed;left:-9999px}.mobile-progress{display:none}@media(max-width:800px){html{scroll-padding-top:132px}.hotbar-main{height:68px;padding:8px 14px}.brand img{width:38px;height:38px}.brand-text span{max-width:170px}.progress-pill,.hot-actions .secondary{display:none}.topic-strip-inner{padding:7px 12px}.hero{padding:40px 16px 26px}.hero-grid,.topic-grid{grid-template-columns:1fr}.hero h1{font-size:2.65rem}.course-map{margin:0 16px 40px;grid-template-columns:1fr 1fr;padding:15px}main{padding:0 16px 60px}.topic{margin-bottom:55px}.topic-head{align-items:flex-start}.topic-status{font-size:.72rem}.theory,.orientation,.practice{padding:18px}.practice-head{align-items:flex-start;flex-direction:column}.task{padding:16px}.task-top{flex-wrap:wrap}.task-source{width:100%;margin:0}.calc-input{grid-template-columns:1fr}.source-grid{grid-template-columns:1fr}.worked summary{align-items:flex-start}.summary-action{display:none}}@media(max-width:430px){.brand-text strong{font-size:.88rem}.brand-text span{max-width:135px}.hot-actions .primary{padding:9px 10px;font-size:.78rem}.course-map{grid-template-columns:1fr}.hero h1{font-size:2.3rem}.topic-head h2{font-size:1.45rem}.topic-index{font-size:1.4rem}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
.topic[hidden]{display:none}.topic-link.is-active{background:var(--sb-navy);color:#fff;border-color:var(--sb-navy)}.topic-link.is-active:hover,.topic-link.is-active:focus-visible{color:#fff;border-color:var(--sb-gold)}.topic{animation:topic-in .18s ease-out}.question-content{font-size:1.14rem;font-weight:760;line-height:1.65;margin:0 0 18px;color:var(--sb-ink)}.question-content math,.option math,.problem math,.steps math,.result math,.feedback math{font-size:1.08em;vertical-align:middle}.question-content math{margin:.1rem .16rem}.math-expression{display:inline-flex;max-width:100%;flex-wrap:wrap;align-items:baseline;gap:.08em .3em;margin:.08em .12em;padding:.08em .24em;border-radius:.35em;background:rgba(50,58,97,.055);font-family:Georgia,"Times New Roman",serif;font-weight:500;vertical-align:baseline}.math-expression__operand,.math-expression__relation{display:inline-flex;align-items:baseline}.math-expression__relation{font-weight:700;color:var(--sb-blue)}.math-expression math{font-size:1.04em}.option-content{min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:.2rem;overflow-x:auto;scrollbar-width:none}.option-content::-webkit-scrollbar{display:none}.option-letter{flex:0 0 28px;width:28px;height:28px;border-radius:8px;background:var(--sb-soft);display:grid;place-items:center;font-size:.76rem;font-weight:900;color:var(--sb-blue)}.option:has(input:checked) .option-letter{background:var(--sb-blue);color:#fff}.calc-input label{display:grid;gap:7px;min-width:0}.calc-input>.primary{align-self:end;min-height:52px}.calc-answer{height:52px;min-height:52px;resize:none;line-height:1.35}.math-inline{display:inline-block;max-width:none;overflow:visible;vertical-align:middle;padding:.08rem .14rem}.feedback ul{display:grid;gap:8px}.feedback .solution-copy{margin:12px 0 0;padding-top:12px;border-top:1px solid currentColor}.task{box-shadow:0 4px 14px rgba(25,37,75,.045)}.hero{padding-top:42px;padding-bottom:26px}.course-map{margin-bottom:34px}.learning-path{position:relative;display:grid;gap:18px}.lesson-step{position:relative;display:grid;grid-template-columns:84px minmax(0,1fr);gap:18px;margin:0}.step-marker{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;color:var(--sb-muted)}.step-marker:after{content:"";position:absolute;top:48px;bottom:-36px;width:2px;background:#cdd4e1}.lesson-step:last-child .step-marker:after{display:none}.step-marker>span{position:relative;z-index:1;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--sb-navy);color:#fff;border:5px solid var(--sb-soft);font-weight:900}.step-marker small{font-size:.65rem;font-weight:850;text-transform:uppercase;letter-spacing:.07em;writing-mode:vertical-rl}.step-content{min-width:0;background:#fff;border:1px solid var(--sb-line);border-radius:20px;padding:30px;box-shadow:0 8px 26px rgba(25,37,75,.055)}.lesson-step.practice{padding:0;background:transparent;border-radius:0;margin:0}.lesson-step.practice .step-content{background:#eef1f6}.lesson-step--intro .step-content{border-top:5px solid var(--sb-navy)}.lesson-step--deepen .step-content{background:#f2f5fc}.lesson-step--example .step-content{border-left:5px solid var(--sb-gold)}.readable-copy{font-family:Georgia,"Times New Roman",serif}.readable-copy h3,.readable-copy .block-label,.goal-panel{font-family:Inter,ui-sans-serif,system-ui,sans-serif}.lead-copy{font-size:1.12rem;line-height:1.82;margin:0;max-width:78ch}.goal-panel{margin-top:24px;padding:18px 20px;background:var(--sb-soft);border-radius:14px}.goal-panel ul{margin:.6rem 0 0;padding-left:1.25rem}.goal-panel li+li{margin-top:.45rem}.principle-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.principle{display:grid;grid-template-columns:30px 1fr;gap:9px;align-items:start;background:#fff;border:1px solid var(--sb-line);border-radius:13px;padding:14px}.principle>span{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--sb-navy);color:#fff;font-size:.75rem;font-weight:900}.principle p{margin:1px 0 0}.formula-deck{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px}.formula-deck .formula{margin:0;background:#fff;border:1px solid var(--sb-line)}.practice--compact .task-list{grid-template-columns:repeat(2,minmax(0,1fr))}.solve-offline{display:grid;gap:2px;margin:0;padding:11px 14px;background:#fff;border:1px dashed #aeb8c7;border-radius:11px}.solve-offline span{font-size:.84rem;color:var(--sb-muted)}.calculation--paper .calc-input{max-width:760px;grid-template-columns:minmax(0,1fr) auto}.calculation--answer .calc-input{max-width:620px}.examples{margin:12px 0 0}.worked{background:#f4f6fb}.topic-head{margin-bottom:28px}@keyframes topic-in{from{opacity:.3;transform:translateY(5px)}to{opacity:1;transform:none}}@media(max-width:900px){.practice--compact .task-list,.principle-grid{grid-template-columns:1fr}}@media(max-width:800px){.question-content{font-size:1.02rem}.option{padding:10px}.option-letter{flex-basis:25px;width:25px;height:25px}.topic-strip{box-shadow:0 5px 12px rgba(25,37,75,.08)}.hero{padding-top:28px}.hero-grid{gap:14px}.lesson-step{grid-template-columns:1fr}.step-marker{display:none}.step-content{padding:20px;border-radius:16px}.lesson-step.practice .step-content{padding:16px}.lead-copy{font-size:1.02rem;line-height:1.7}.calculation--paper .calc-input{grid-template-columns:1fr}.formula-deck{grid-template-columns:1fr}}
.math-expression{display:inline;max-width:100%;margin:.08em .12em;padding:.08em 0;border-radius:.35em;background:rgba(50,58,97,.055);box-decoration-break:clone;-webkit-box-decoration-break:clone;font-family:Georgia,"Times New Roman",serif;font-weight:500;vertical-align:baseline}.math-expression__operand,.math-expression__relation{display:inline-flex;max-width:100%;align-items:baseline;margin:0 .12em;vertical-align:baseline}.math-expression__relation{font-weight:700;color:var(--sb-blue)}.math-expression math{font-size:clamp(.94em,1.2vw,1.04em)}
.feedback .math-expression,.solution-copy .math-expression{display:block;width:fit-content;max-width:100%;margin:.34em 0;padding:.1em .16em;overflow-wrap:anywhere}
.options,.option{min-width:0;width:100%}.task{overflow:hidden}.formula,.formula-deck,.math-scroll{min-width:0;max-width:100%}.math-scroll{width:100%;overflow-x:auto;scrollbar-width:none}.math-scroll::-webkit-scrollbar{display:none}.feedback{min-width:0;max-width:100%;overflow-wrap:anywhere;overflow:hidden}.feedback ul{min-width:0;width:100%;max-width:100%}.feedback li{min-width:0;max-width:100%;overflow:hidden}.feedback .math-inline{display:block;width:100%;max-width:100%;overflow-x:auto;scrollbar-width:none}.feedback .math-inline::-webkit-scrollbar{display:none}.readable-copy var,.question-content var,.feedback var{font-family:Georgia,"Times New Roman",serif;font-style:italic}.bounded-operator{display:inline-flex;align-items:center;white-space:nowrap;font-family:Georgia,"Times New Roman",serif;font-size:1.14em;margin:0 .08em}.bounded-operator sub,.bounded-operator sup{font-size:.62em;line-height:1}
.chapter-nav{position:relative;border-top:1px solid #edf0f5;background:#fff}.chapter-nav-inner{max-width:1280px;margin:auto;padding:8px 24px;display:grid;grid-template-columns:42px minmax(0,1fr) 42px;gap:8px;align-items:center}.chapter-arrow{height:40px;border:1px solid var(--sb-line);border-radius:11px;background:#fff;color:var(--sb-navy);font-size:1.1rem;font-weight:900}.chapter-arrow:hover,.chapter-arrow:focus-visible{border-color:var(--sb-blue);outline:3px solid #e8edff}.chapter-menu{position:relative;min-width:0}.chapter-menu>summary{height:40px;list-style:none;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:0 14px;border:1px solid var(--sb-line);border-radius:11px;background:#f8f9fc;cursor:pointer}.chapter-menu>summary::-webkit-details-marker{display:none}.chapter-menu>summary:after{content:"⌄";font-weight:900;color:var(--sb-muted)}.chapter-menu[open]>summary:after{content:"⌃"}.chapter-menu-label{font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--sb-muted);font-weight:850}.chapter-menu>summary strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chapter-menu-status{font-size:.75rem;color:var(--sb-muted);font-weight:800}.chapter-menu-panel{position:absolute;z-index:50;left:0;right:0;top:48px;padding:18px;background:#fff;border:1px solid var(--sb-line);border-radius:16px;box-shadow:0 24px 60px rgba(25,37,75,.18)}.chapter-menu-head{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:12px}.chapter-menu-head h2{font-size:1.15rem;margin:2px 0}.chapter-menu-head>span{font-size:.72rem;color:var(--sb-muted);white-space:nowrap}.state-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px 0 10px;background:#c8cfdd}.state-dot--complete{background:var(--sb-green)}.state-dot--started{background:var(--sb-gold-dark)}.chapter-tab-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:min(62vh,520px);overflow-y:auto}.topic-link{width:100%;display:grid;grid-template-columns:34px minmax(0,1fr) 10px;gap:10px;align-items:center;text-align:left;border:1px solid var(--sb-line);background:#fff;color:var(--sb-ink);border-radius:12px;padding:10px 12px;white-space:normal}.topic-link.is-active{background:#eef2ff;color:var(--sb-navy);border-color:var(--sb-blue)}.topic-link.is-complete{border-color:#9bcfb9;background:#f1faf6}.topic-link.is-started:not(.is-complete){border-color:#d9bd79;background:#fffaf0}.chapter-number{font-size:.72rem;font-weight:900;color:var(--sb-muted)}.chapter-copy{min-width:0}.chapter-copy strong,.chapter-copy small{display:block}.chapter-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chapter-copy small{font-size:.7rem;color:var(--sb-muted);margin-top:2px}.chapter-state{width:9px;height:9px;border-radius:50%;background:#c8cfdd}.topic-link.is-complete .chapter-state{background:var(--sb-green)}.topic-link.is-started .chapter-state{background:var(--sb-gold-dark)}.learning-dashboard{max-width:1232px;padding:34px 24px 38px}.dashboard-summary{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:18px}.dashboard-intro,.dashboard-progress,.dashboard-course{background:#fff;border:1px solid var(--sb-line);border-radius:20px;box-shadow:var(--shadow)}.dashboard-intro{padding:30px;border-top:5px solid var(--sb-navy)}.learning-dashboard h1{font-size:clamp(2rem,4vw,3.6rem);line-height:1.03;letter-spacing:-.045em;margin:10px 0 14px;max-width:780px}.learning-dashboard .hero-lead{margin:0}.dashboard-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}.dashboard-continue{min-height:48px}.dashboard-progress{padding:24px;display:grid;grid-template-columns:150px minmax(0,1fr);gap:20px;align-items:center;background:var(--sb-navy);color:#fff}.progress-orbit{--progress:0;width:142px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--sb-gold) calc(var(--progress)*1%),rgba(255,255,255,.14) 0);position:relative}.progress-orbit:before{content:"";position:absolute;inset:12px;border-radius:50%;background:var(--sb-navy)}.progress-orbit>span{position:relative;z-index:1;text-align:center}.progress-orbit strong,.progress-orbit small{display:block}.progress-orbit strong{font-size:2rem;line-height:1}.progress-orbit small{font-size:.72rem;color:#cbd5e5;margin-top:5px}.dashboard-metrics{display:grid;gap:14px}.dashboard-metrics>div{padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.14)}.dashboard-metrics>div:last-child{border-bottom:0;padding-bottom:0}.dashboard-metrics strong,.dashboard-metrics span{display:block}.dashboard-metrics strong{font-size:1.35rem}.dashboard-metrics span{font-size:.74rem;color:#cbd5e5}.dashboard-course{margin-top:18px;padding:24px}.dashboard-course-head{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:16px}.dashboard-course-head h2{font-size:1.25rem;margin:3px 0}.dashboard-filters{display:flex;gap:6px;flex-wrap:wrap}.dashboard-filters button{border:1px solid var(--sb-line);border-radius:999px;padding:7px 11px;background:#fff;color:var(--sb-muted);font-size:.75rem;font-weight:800}.dashboard-filters button.is-active{background:var(--sb-navy);border-color:var(--sb-navy);color:#fff}.dashboard-topic-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.dashboard-topic{min-width:0;display:grid;grid-template-columns:32px minmax(0,1fr);gap:0 10px;align-items:center;text-align:left;padding:12px;border:1px solid var(--sb-line);border-radius:12px;background:#fff;color:var(--sb-ink)}.dashboard-topic:hover,.dashboard-topic:focus-visible{border-color:var(--sb-blue);outline:3px solid #edf1ff}.dashboard-topic[hidden]{display:none}.dashboard-topic-index{grid-row:1/3;font-size:.72rem;font-weight:900;color:var(--sb-muted)}.dashboard-topic-copy{min-width:0}.dashboard-topic-copy strong,.dashboard-topic-copy small{display:block}.dashboard-topic-copy strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dashboard-topic-copy small{font-size:.7rem;color:var(--sb-muted)}.dashboard-topic-bar{grid-column:2;display:block;height:4px;border-radius:99px;background:#e8ebf2;overflow:hidden;margin-top:7px}.dashboard-topic-bar i{display:block;width:0;height:100%;background:var(--sb-gold-dark);transition:width .2s}.dashboard-topic.is-complete{border-color:#9bcfb9;background:#f1faf6}.dashboard-topic.is-complete .dashboard-topic-bar i{background:var(--sb-green)}.step-marker:after{top:76px}.step-marker small{position:relative;z-index:1;writing-mode:horizontal-tb;width:82px;padding:3px 4px;background:var(--sb-soft);text-align:center;line-height:1.15;letter-spacing:.045em;white-space:normal;overflow-wrap:normal}
@media(max-width:900px){.dashboard-topic-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-summary{grid-template-columns:1fr}.dashboard-progress{grid-template-columns:130px 1fr}.progress-orbit{width:124px}}
@media(max-width:800px){html{scroll-padding-top:128px}.chapter-nav-inner{padding:7px 12px;grid-template-columns:38px minmax(0,1fr) 38px}.chapter-arrow{height:38px}.chapter-menu>summary{height:38px;padding:0 10px;grid-template-columns:auto minmax(0,1fr) auto}.chapter-menu-label,.chapter-menu-status{display:none}.chapter-menu-panel{position:fixed;left:12px;right:12px;top:122px;max-height:calc(100vh - 136px);overflow:auto}.chapter-menu-head{align-items:start}.chapter-menu-head>span{display:none}.chapter-tab-grid{grid-template-columns:1fr;max-height:none}.learning-dashboard{padding:22px 16px 28px}.dashboard-intro{padding:22px}.learning-dashboard h1{font-size:2rem}.dashboard-progress{grid-template-columns:112px minmax(0,1fr);padding:18px}.progress-orbit{width:106px}.progress-orbit strong{font-size:1.55rem}.dashboard-course{padding:18px}.dashboard-course-head{align-items:flex-start;flex-direction:column}.dashboard-topic-grid{grid-template-columns:1fr}.dashboard-actions>*{flex:1 1 160px}}
@media(max-width:430px){.brand-text span{max-width:108px}.hot-actions .primary{font-size:.72rem}.dashboard-progress{grid-template-columns:96px minmax(0,1fr);gap:14px}.progress-orbit{width:92px}.dashboard-metrics{gap:9px}.dashboard-metrics strong{font-size:1.1rem}.dashboard-metrics span{font-size:.68rem}}
.chapter-nav-inner{max-width:1232px;margin:auto;padding:8px 24px;display:block}.chapter-menu>summary{height:44px;grid-template-columns:auto minmax(0,1fr) auto auto;gap:12px}.chapter-menu>summary:after{justify-self:end}@media(max-width:800px){.chapter-nav-inner{padding:7px 12px;display:block}.chapter-menu>summary{height:42px;padding:0 13px;grid-template-columns:minmax(0,1fr) auto;gap:10px}.chapter-menu>summary strong{grid-column:1}.chapter-menu>summary:after{grid-column:2}.chapter-menu-label,.chapter-menu-status{display:none}}
.source-link{display:inline-flex;align-items:center;gap:6px;margin-top:4px;color:var(--sb-blue);font-size:.82rem;font-weight:800;text-decoration-thickness:1.5px;text-underline-offset:3px}.source-link:focus-visible{outline:3px solid #dbe3ff;outline-offset:3px;border-radius:3px}
.application-instructions{margin:0 0 16px;padding-left:1.35rem}.application-instructions li+li{margin-top:.45rem}.application-draft{display:grid;gap:8px}.application-draft textarea{width:100%;min-height:132px;resize:vertical;border:1px solid #b9c2d0;border-radius:12px;padding:13px;line-height:1.55;color:var(--sb-ink);background:#fff}.application-draft textarea:focus-visible{outline:3px solid #dbe3ff;border-color:var(--sb-blue)}.application-sample,.application-rubric{padding:12px 0}.application-sample+ .application-rubric{border-top:1px solid currentColor}.application-rubric ul{margin:.55rem 0 0}.application .feedback{color:var(--sb-ink);background:#f2f5fc}.application .self-check{padding-top:10px;border-top:1px solid #d2d9e7}
.formula-deck{grid-template-columns:repeat(2,minmax(0,1fr))}.formula-deck .formula{overflow:hidden;padding:18px}.formula-deck .math-scroll{padding:4px 2px 8px;scrollbar-width:thin}.formula-deck math{display:block;width:max-content;max-width:none;font-size:clamp(.98rem,1.3vw,1.16rem)}.step-marker{min-width:0}.step-marker small{width:84px;max-width:100%;overflow-wrap:anywhere;hyphens:auto}.self-check{flex-wrap:wrap}.self-check button,.task-actions button,.calc-input button{min-height:44px}.application-state{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#eaf8f2;color:#0d6041;font-weight:800}.application[data-learning-state="review"] .application-state{background:#fff8e7;color:#76520e}
@media(max-width:1050px){.lesson-step{grid-template-columns:1fr}.step-marker{display:none}.step-content{width:100%}}
@media(max-width:700px){.formula-deck{grid-template-columns:1fr}.formula-deck .formula{padding:15px}.formula-deck math{font-size:1rem}.task-actions,.self-check{display:grid;grid-template-columns:1fr}.task-actions button,.self-check button{width:100%}}
</style></head><body>
<a class="skip" href="#main">${text("Zum Lerninhalt springen", "Skip to learning content")}</a>
<header class="hotbar" data-sb-hotbar><div class="hotbar-main"><div class="brand"><img src="assets/logo.png" alt="Study Buddy" data-study-buddy-logo><div class="brand-text"><strong>Study Buddy · ${esc(courseIdentity)}</strong><span>${esc(content.courseTitle)}</span></div></div><div class="hot-actions"><div class="progress-pill" data-sb-progress><span>${text("Gesamtfortschritt", "Overall progress")}</span><div class="bar"><i data-progress-bar></i></div><strong data-progress-text>0 / ${allExercises.length}</strong></div><button class="primary" type="button" data-continue>${text("Weiterlernen", "Continue learning")}</button><button class="secondary" type="button" data-reset>${text("Fortschritt löschen", "Reset progress")}</button></div></div><nav class="chapter-nav" aria-label="${text("Kapitel", "Chapters")}" data-sb-course-tabs><div class="chapter-nav-inner"><details class="chapter-menu" data-chapter-menu><summary><span class="chapter-menu-label">${text("Kapitel", "Chapters")}</span><strong data-current-topic-title>1. ${esc(content.topics[0]?.title ?? text("Kapitel", "Chapter"))}</strong><span class="chapter-menu-status" data-current-topic-status>0 / ${content.topics[0]?.exercises.length ?? 0}</span></summary><div class="chapter-menu-panel"><div class="chapter-menu-head"><div><span class="kicker">${text("Kursnavigation", "Course navigation")}</span><h2>${text("Kapitel auswählen", "Select a chapter")}</h2></div><span><i class="state-dot state-dot--complete"></i> ${text("Fertig", "Complete")} <i class="state-dot state-dot--started"></i> ${text("Begonnen", "Started")}</span></div><div class="chapter-tab-grid" role="tablist" aria-label="${text("Kapitel auswählen", "Select a chapter")}">${chapterTabsHtml}</div></div></details></div></nav></header>
<section class="hero learning-dashboard" data-learning-dashboard><div class="dashboard-summary"><div class="dashboard-intro"><p class="kicker">${text("Dein Lernstand", "Your learning progress")}</p><h1 data-dashboard-heading>${text("Der nächste sinnvolle Schritt ist schon vorbereitet.", "Your next useful step is ready.")}</h1><p class="hero-lead" data-dashboard-next-copy>${text("Starte mit der ersten offenen Aufgabe und arbeite Kapitel für Kapitel.", "Start with the first open exercise and work chapter by chapter.")}</p><div class="dashboard-actions"><button class="primary dashboard-continue" type="button" data-continue>${text("Nächste offene Aufgabe", "Next open exercise")}</button><button class="secondary" type="button" data-open-chapters>${text("Kapitelübersicht öffnen", "Open chapter overview")}</button></div></div><aside class="dashboard-progress" aria-label="${text("Lernfortschritt", "Learning progress")}"><div class="progress-orbit" data-progress-orbit style="--progress:0"><span><strong data-progress-percent>0%</strong><small>${text("erledigt", "completed")}</small></span></div><div class="dashboard-metrics"><div><strong data-dashboard-done>0</strong><span>${text("von", "of")} ${allExercises.length} ${text("Aufgaben", "exercises")}</span></div><div><strong data-dashboard-chapters>0</strong><span>${text("von", "of")} ${content.topics.length} ${text("Kapiteln fertig", "chapters complete")}</span></div><div><strong data-dashboard-open>${allExercises.length}</strong><span>${text("Aufgaben offen", "exercises open")}</span></div></div></aside></div><div class="dashboard-course"><div class="dashboard-course-head"><div><p class="kicker">${text("Kurskarte", "Course map")}</p><h2>${text("Was sitzt schon – und was kommt als Nächstes?", "What have you mastered—and what comes next?")}</h2></div><div class="dashboard-filters" role="group" aria-label="${text("Kapitel filtern", "Filter chapters")}"><button class="is-active" type="button" data-dashboard-filter="all">${text("Alle", "All")}</button><button type="button" data-dashboard-filter="open">${text("Offen", "Open")}</button><button type="button" data-dashboard-filter="started">${text("Begonnen", "Started")}</button><button type="button" data-dashboard-filter="complete">${text("Fertig", "Complete")}</button></div></div><div class="dashboard-topic-grid">${dashboardTopicsHtml}</div></div></section>
<main id="main">${topicsHtml}</main>
<footer class="sources" data-sb-sources><div class="sources-inner"><p class="eyebrow">${text("Nachvollziehbar lernen", "Traceable learning")}</p><h2>${text("Quellen & Abdeckungsgrenzen", "Sources and coverage limits")}</h2><p>${esc(content.scopeNote)}</p><div class="source-grid">${content.sources.map((source) => `<article class="source"><strong>${esc(source.label)}</strong><p>${esc(source.coverage)}</p>${source.url ? `<a class="source-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${text("In Moodle öffnen", "Open in Moodle")} <span aria-hidden="true">↗</span></a>` : ""}</article>`).join("")}</div><div class="footer-actions"><button class="secondary" type="button" data-reset>${text("Lokalen Fortschritt löschen", "Reset local progress")}</button></div></div></footer>
<div class="sr-live" aria-live="polite" data-live></div><script id="study-content" type="application/json">${contentJson}</script>
<script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1',C=JSON.parse(document.getElementById('study-content').textContent),byId=new Map(C.topics.flatMap(topic=>topic.exercises).map(exercise=>[exercise.id,exercise])),read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}},write=state=>localStorage.setItem(KEY,JSON.stringify(state)),norm=value=>String(value).trim().toLowerCase().replace(/,/g,'.').split(' ').join(''),numbers=value=>(String(value).match(/[+-]?[0-9]+(?:[.,][0-9]+)?/g)||[]).map(norm),matches=(answers,value)=>answers.some(answer=>norm(answer)===norm(value)||(numbers(answer).length===1&&numbers(value).includes(numbers(answer)[0])));function refresh(state){const exercises=[...byId.values()],done=exercises.filter(exercise=>state.completed?.[exercise.id]).length;document.querySelectorAll('[data-progress-text]').forEach(node=>node.textContent=done+' / '+exercises.length);document.querySelectorAll('[data-progress-bar]').forEach(node=>node.style.width=(exercises.length?done/exercises.length*100:0)+'%');C.topics.forEach(topic=>{const topicDone=topic.exercises.filter(exercise=>state.completed?.[exercise.id]).length;document.querySelectorAll('[data-topic-status="'+CSS.escape(topic.id)+'"]').forEach(node=>node.textContent=topicDone+' / '+topic.exercises.length)});document.querySelectorAll('.task').forEach(task=>task.classList.toggle('is-complete',!!state.completed?.[task.dataset.id]));window.dispatchEvent(new Event('storage'))}document.addEventListener('click',event=>{const button=event.target.closest('[data-check-calc]');if(!button)return;const card=button.closest('.calculation'),exercise=byId.get(card?.dataset.id||'');if(!card||!exercise||exercise.type!=='calculation')return;event.preventDefault();event.stopImmediatePropagation();const input=card.querySelector('.calc-answer'),value=input?.value||'',solution=card.querySelector('[data-solution]')?.innerHTML||'',selfCheck=exercise.acceptedAnswers.includes('__self_check__'),correct=!selfCheck&&matches(exercise.acceptedAnswers,value),feedback=card.querySelector('.feedback');feedback.hidden=false;feedback.className='feedback '+(correct?'good':'bad');feedback.innerHTML=(selfCheck?'<strong>Vergleiche deinen Ansatz mit der Quellenlösung:</strong>':correct?'<strong>Richtig.</strong>':'<strong>Noch nicht.</strong>')+solution+(selfCheck?'<div class="self-check"><button type="button" class="primary" data-self-ok>Stimmt überein</button><button type="button" class="secondary" data-self-review>Noch üben</button></div>':'');const state=read();state.drafts=state.drafts||{};state.revealed=state.revealed||{};state.completed=state.completed||{};state.drafts[exercise.id]=value;state.revealed[exercise.id]=true;if(correct)state.completed[exercise.id]=true;write(state);refresh(state);document.querySelector('[data-live]').textContent=correct?'Aufgabe richtig gelöst.':'Lösung geöffnet; vergleiche deinen Rechenweg.'},true)})();
</script>
<script>
(()=>{'use strict';const LEGACY='study-buddy-maes2-standard-v1',KEY=${JSON.stringify(storageNamespace)},originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem,originalRemove=Storage.prototype.removeItem,nested=['completed','drafts','selections','evaluated','revealed'],target=key=>key===LEGACY?KEY:key;Storage.prototype.getItem=function(key){return originalGet.call(this,target(key))};Storage.prototype.removeItem=function(key){return originalRemove.call(this,target(key))};Storage.prototype.setItem=function(key,value){const resolved=target(key);if(key===LEGACY){try{const current=JSON.parse(originalGet.call(this,resolved)||'{}'),incoming=JSON.parse(String(value));for(const field of nested)incoming[field]={...(current[field]||{}),...(incoming[field]||{})};value=JSON.stringify({...current,...incoming})}catch{}}const result=originalSet.call(this,resolved,value);if(key===LEGACY)window.dispatchEvent(new Event('storage'));return result}})();
</script>
<script>
(()=>{'use strict';const C=JSON.parse(document.getElementById('study-content').textContent),KEY='study-buddy-maes2-standard-v1';let S={completed:{},drafts:{},last:''};try{S={...S,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{}const save=()=>localStorage.setItem(KEY,JSON.stringify(S));const byId=new Map(C.topics.flatMap(t=>t.exercises).map(x=>[x.id,x]));const norm=v=>String(v).trim().toLowerCase().replace(/,/g,'.').replace(/\\s+/g,'');function announce(v){document.querySelector('[data-live]').textContent=v}function update(){const total=byId.size,done=Object.keys(S.completed).filter(id=>S.completed[id]).length;document.querySelectorAll('[data-progress-text]').forEach(n=>n.textContent=done+' / '+total);document.querySelectorAll('[data-progress-bar]').forEach(n=>n.style.width=(total?done/total*100:0)+'%');C.topics.forEach(t=>{const d=t.exercises.filter(x=>S.completed[x.id]).length;const n=document.querySelector('[data-topic-status="'+CSS.escape(t.id)+'"]');if(n)n.textContent=d+' / '+t.exercises.length});document.querySelectorAll('.task').forEach(n=>n.classList.toggle('is-complete',!!S.completed[n.dataset.id]))}function feedback(card,html,good){const n=card.querySelector('.feedback');n.hidden=false;n.className='feedback '+(good?'good':'bad');n.innerHTML=html}document.querySelectorAll('.task').forEach(card=>{const id=card.dataset.id;if(S.drafts[id]!=null){const input=card.querySelector('.calc-answer');if(input)input.value=S.drafts[id]}if(S.completed[id])card.classList.add('is-complete')});document.addEventListener('input',e=>{const card=e.target.closest('.task');if(card&&e.target.matches('.calc-answer')){S.drafts[card.dataset.id]=e.target.value;save()}});document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const card=b.closest('.task');if(b.matches('[data-submit-cross]')&&card){const x=byId.get(card.dataset.id),chosen=[...card.querySelectorAll('input:checked')].map(n=>Number(n.value)),correct=x.options.map((o,i)=>o.correct?i:-1).filter(i=>i>=0),ok=chosen.length===correct.length&&chosen.every(i=>correct.includes(i));const rows=x.options.map((o,i)=>'<li><strong>'+(o.correct?'✓':'×')+'</strong> '+escapeHtml(o.text)+' – '+escapeHtml(o.feedback)+'</li>').join('');feedback(card,'<strong>'+(ok?'Richtig gelöst.':'Noch nicht ganz.')+'</strong><ul>'+rows+'</ul><p>'+escapeHtml(x.explanation)+'</p>',ok);if(ok)S.completed[x.id]=true;save();update();announce(ok?'Aufgabe richtig gelöst.':'Antwort ausgewertet; lies das Feedback.')}if(b.matches('[data-check-calc]')&&card){const x=byId.get(card.dataset.id),value=card.querySelector('.calc-answer').value;S.drafts[x.id]=value;const solution='<ol>'+x.steps.map(step=>'<li>'+escapeHtml(step)+'</li>').join('')+'</ol><p><strong>Typischer Fehler:</strong> '+escapeHtml(x.commonMistake)+'</p>';if(x.acceptedAnswers.includes('__self_check__'))feedback(card,'<strong>Vergleiche deinen Ansatz mit der Quellenlösung:</strong>'+solution+'<div class="self-check"><button type="button" class="primary" data-self-ok>Stimmt überein</button><button type="button" class="secondary" data-self-review>Noch üben</button></div>',false);else{const ok=x.acceptedAnswers.map(norm).includes(norm(value));feedback(card,(ok?'<strong>Richtig.</strong>':'<strong>Noch nicht.</strong>')+solution,ok);if(ok)S.completed[x.id]=true}save();update()}if(b.matches('[data-self-ok]')&&card){S.completed[card.dataset.id]=true;save();update();feedback(card,'<strong>Als verstanden markiert.</strong> Du kannst die Aufgabe später trotzdem wiederholen.',true)}if(b.matches('[data-self-review]')&&card){S.completed[card.dataset.id]=false;save();update();announce('Aufgabe bleibt zur Wiederholung offen.')}if(b.matches('[data-reveal-retrieval]')){const n=document.getElementById('retrieval-'+b.dataset.revealRetrieval);n.hidden=!n.hidden;b.textContent=n.hidden?'Antwort prüfen':'Antwort verbergen'}if(b.matches('[data-continue]')){const next=[...document.querySelectorAll('.task')].find(n=>!S.completed[n.dataset.id])||document.querySelector('.topic');next?.scrollIntoView({behavior:'smooth',block:'center'});next?.querySelector('input,button')?.focus()}if(b.matches('[data-reset]')&&confirm('Lokalen Lernfortschritt und Eingaben wirklich löschen?')){localStorage.removeItem(KEY);location.reload()}});document.querySelectorAll('.topic-link').forEach(a=>a.addEventListener('click',()=>{S.last=a.getAttribute('href');save()}));function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}update()})();
</script><script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1';let extra={selections:{},evaluated:{},revealed:{}};try{const current=JSON.parse(localStorage.getItem(KEY)||'{}');extra={...extra,selections:current.selections||{},evaluated:current.evaluated||{},revealed:current.revealed||{}}}catch{}const currentState=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};const merge=()=>localStorage.setItem(KEY,JSON.stringify({...currentState(),...extra}));document.querySelectorAll('.cross').forEach(card=>{const values=extra.selections[card.dataset.id]||[];card.querySelectorAll('input').forEach(input=>input.checked=values.includes(Number(input.value)))});document.addEventListener('change',event=>{const card=event.target.closest('.cross');if(!card)return;extra.selections[card.dataset.id]=[...card.querySelectorAll('input:checked')].map(input=>Number(input.value));merge()});document.addEventListener('input',()=>queueMicrotask(merge));document.addEventListener('click',event=>{const button=event.target.closest('button'),card=button?.closest('.task');if(!button||!card)return;queueMicrotask(()=>{if(button.matches('[data-submit-cross]')){extra.selections[card.dataset.id]=[...card.querySelectorAll('input:checked')].map(input=>Number(input.value));extra.evaluated[card.dataset.id]=true}if(button.matches('[data-check-calc]'))extra.revealed[card.dataset.id]=true;merge()})});queueMicrotask(()=>{document.querySelectorAll('.cross').forEach(card=>{if(extra.evaluated[card.dataset.id])card.querySelector('[data-submit-cross]')?.click()});document.querySelectorAll('.calculation').forEach(card=>{if(extra.revealed[card.dataset.id])card.querySelector('[data-check-calc]')?.click()})})})();
</script><script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1',tabs=[...document.querySelectorAll('[data-topic-tab]')],panels=[...document.querySelectorAll('[data-sb-topic]')];const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};const activate=(id,{focus=false,scroll=false}={})=>{const target=panels.find(panel=>panel.dataset.sbTopic===id)||panels[0];if(!target)return;panels.forEach(panel=>panel.hidden=panel!==target);tabs.forEach(tab=>{const active=tab.dataset.topicTab===target.dataset.sbTopic;tab.classList.toggle('is-active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1});localStorage.setItem(KEY,JSON.stringify({...read(),activeTopic:target.dataset.sbTopic}));if(scroll)target.scrollIntoView({behavior:'smooth',block:'start'});if(focus)tabs.find(tab=>tab.dataset.topicTab===target.dataset.sbTopic)?.focus()};tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>activate(tab.dataset.topicTab,{scroll:true}));tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activate(tabs[next].dataset.topicTab,{focus:true,scroll:true})})});document.addEventListener('click',event=>{const button=event.target.closest('[data-continue]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();const next=[...document.querySelectorAll('.task')].find(task=>!read().completed?.[task.dataset.id])||document.querySelector('.task');const panel=next?.closest('[data-sb-topic]');if(panel){activate(panel.dataset.sbTopic);requestAnimationFrame(()=>{panel.scrollIntoView({behavior:'smooth',block:'start'});next.querySelector('input,textarea,button')?.focus()})}},true);activate(read().activeTopic||panels[0]?.dataset.sbTopic)})();
</script><script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1',C=JSON.parse(document.getElementById('study-content').textContent),byId=new Map(C.topics.flatMap(topic=>topic.exercises).map(exercise=>[exercise.id,exercise])),read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}},write=value=>localStorage.setItem(KEY,JSON.stringify(value)),escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));function refresh(state){const total=byId.size,done=Object.keys(state.completed||{}).filter(id=>state.completed[id]).length;document.querySelectorAll('[data-progress-text]').forEach(node=>node.textContent=done+' / '+total);document.querySelectorAll('[data-progress-bar]').forEach(node=>node.style.width=(total?done/total*100:0)+'%');C.topics.forEach(topic=>{const topicDone=topic.exercises.filter(exercise=>state.completed?.[exercise.id]).length,node=document.querySelector('[data-topic-status="'+CSS.escape(topic.id)+'"]');if(node)node.textContent=topicDone+' / '+topic.exercises.length});document.querySelectorAll('.task').forEach(task=>task.classList.toggle('is-complete',!!state.completed?.[task.dataset.id]))}document.addEventListener('click',event=>{const button=event.target.closest('[data-submit-cross]');if(!button)return;const card=button.closest('.cross'),exercise=byId.get(card.dataset.id);if(!exercise)return;event.preventDefault();event.stopImmediatePropagation();const chosen=[...card.querySelectorAll('input:checked')].map(input=>Number(input.value)),correct=exercise.options.map((option,index)=>option.correct?index:-1).filter(index=>index>=0),ok=chosen.length===correct.length&&chosen.every(index=>correct.includes(index)),review=[...new Set([...chosen,...correct])],optionBodies=[...card.querySelectorAll('.option-content')],optionFeedback=[...card.querySelectorAll('[data-option-feedback]')],rows=review.map(index=>'<li><strong>'+(correct.includes(index)?'✓':'×')+'</strong> '+(optionBodies[index]?.innerHTML||escapeHtml(exercise.options[index].text))+' – '+(optionFeedback[index]?.innerHTML||escapeHtml(exercise.options[index].feedback))+'</li>').join(''),solution=card.querySelector('[data-solution]')?.innerHTML||'',feedback=card.querySelector('.feedback');feedback.hidden=false;feedback.className='feedback '+(ok?'good':'bad');feedback.innerHTML='<strong>'+(ok?'Richtig gelöst.':'Noch nicht ganz.')+'</strong><ul>'+rows+'</ul><div class="solution-copy"><strong>Erklärung:</strong> '+solution+'</div>';const state=read();state.completed=state.completed||{};state.selections=state.selections||{};state.evaluated=state.evaluated||{};if(ok)state.completed[exercise.id]=true;state.selections[exercise.id]=chosen;state.evaluated[exercise.id]=true;write(state);refresh(state);document.querySelector('[data-live]').textContent=ok?'Aufgabe richtig gelöst.':'Antwort ausgewertet; lies das Feedback.'},true)})();
</script><script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1',C=JSON.parse(document.getElementById('study-content').textContent),read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};function refresh(){const state=read(),exercises=C.topics.flatMap(topic=>topic.exercises),done=exercises.filter(exercise=>state.completed?.[exercise.id]).length;document.querySelectorAll('[data-progress-text]').forEach(node=>node.textContent=done+' / '+exercises.length);document.querySelectorAll('[data-progress-bar]').forEach(node=>node.style.width=(exercises.length?done/exercises.length*100:0)+'%');C.topics.forEach(topic=>{const topicDone=topic.exercises.filter(exercise=>state.completed?.[exercise.id]).length,node=document.querySelector('[data-topic-status="'+CSS.escape(topic.id)+'"]');if(node)node.textContent=topicDone+' / '+topic.exercises.length});document.querySelectorAll('.task').forEach(task=>task.classList.toggle('is-complete',!!state.completed?.[task.dataset.id]))}document.addEventListener('click',event=>{if(event.target.closest('[data-check-calc],[data-self-ok],[data-self-review]'))queueMicrotask(refresh)})})();
</script><script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1',C=JSON.parse(document.getElementById('study-content').textContent),byId=new Map(C.topics.flatMap(topic=>topic.exercises).map(exercise=>[exercise.id,exercise])),read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}},write=state=>localStorage.setItem(KEY,JSON.stringify(state)),norm=value=>String(value).trim().toLowerCase().replace(/,/g,'.').split(' ').join('');function refresh(state){const exercises=[...byId.values()],done=exercises.filter(exercise=>state.completed?.[exercise.id]).length;document.querySelectorAll('[data-progress-text]').forEach(node=>node.textContent=done+' / '+exercises.length);document.querySelectorAll('[data-progress-bar]').forEach(node=>node.style.width=(exercises.length?done/exercises.length*100:0)+'%');C.topics.forEach(topic=>{const topicDone=topic.exercises.filter(exercise=>state.completed?.[exercise.id]).length,node=document.querySelector('[data-topic-status="'+CSS.escape(topic.id)+'"]');if(node)node.textContent=topicDone+' / '+topic.exercises.length})}document.addEventListener('click',event=>{const button=event.target.closest('[data-check-calc]');if(!button)return;const card=button.closest('.calculation'),exercise=byId.get(card?.dataset.id||'');if(!card||!exercise||exercise.type!=='calculation')return;event.preventDefault();event.stopImmediatePropagation();const input=card.querySelector('.calc-answer'),value=input?.value||'',solution=card.querySelector('[data-solution]')?.innerHTML||'',selfCheck=exercise.acceptedAnswers.includes('__self_check__'),correct=!selfCheck&&exercise.acceptedAnswers.map(norm).includes(norm(value)),feedback=card.querySelector('.feedback');feedback.hidden=false;feedback.className='feedback '+(correct?'good':'bad');feedback.innerHTML=(selfCheck?'<strong>Vergleiche deinen Ansatz mit der Quellenlösung:</strong>':correct?'<strong>Richtig.</strong>':'<strong>Noch nicht.</strong>')+solution+(selfCheck?'<div class="self-check"><button type="button" class="primary" data-self-ok>Stimmt überein</button><button type="button" class="secondary" data-self-review>Noch üben</button></div>':'');const state=read();state.drafts=state.drafts||{};state.revealed=state.revealed||{};state.completed=state.completed||{};state.drafts[exercise.id]=value;state.revealed[exercise.id]=true;if(correct)state.completed[exercise.id]=true;write(state);refresh(state)},true)})();
</script><script>
(()=>{'use strict';const KEY='study-buddy-maes2-standard-v1',C=JSON.parse(document.getElementById('study-content').textContent),tabs=[...document.querySelectorAll('[data-topic-tab]')],menu=document.querySelector('[data-chapter-menu]');let filter='all',queued=false;const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}},queue=()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;refresh()},0)},started=(state,id)=>Boolean(state.completed?.[id]||state.drafts?.[id]||state.evaluated?.[id]||state.revealed?.[id]||(state.selections?.[id]||[]).length);function refresh(){const state=read(),exercises=C.topics.flatMap(topic=>topic.exercises),done=exercises.filter(exercise=>state.completed?.[exercise.id]).length,open=exercises.length-done;let completedChapters=0;C.topics.forEach((topic,index)=>{const topicDone=topic.exercises.filter(exercise=>state.completed?.[exercise.id]).length,topicStarted=topic.exercises.some(exercise=>started(state,exercise.id)),status=topicDone===topic.exercises.length?'complete':topicStarted?'started':'open';if(status==='complete')completedChapters+=1;const tab=tabs[index],tile=document.querySelector('[data-dashboard-topic="'+CSS.escape(topic.id)+'"]');tab?.classList.toggle('is-complete',status==='complete');tab?.classList.toggle('is-started',status==='started');if(tile){tile.classList.toggle('is-complete',status==='complete');tile.classList.toggle('is-started',status==='started');tile.dataset.dashboardState=status;tile.hidden=filter!=='all'&&filter!==status}document.querySelectorAll('[data-chapter-status="'+CSS.escape(topic.id)+'"]').forEach(node=>node.textContent=topicDone+' / '+topic.exercises.length+' erledigt');document.querySelectorAll('[data-dashboard-topic-status="'+CSS.escape(topic.id)+'"]').forEach(node=>node.textContent=topicDone+' von '+topic.exercises.length+' · '+(status==='complete'?'fertig':status==='started'?'begonnen':'offen'));document.querySelectorAll('[data-dashboard-topic-bar="'+CSS.escape(topic.id)+'"]').forEach(node=>node.style.width=(topic.exercises.length?topicDone/topic.exercises.length*100:0)+'%')});const percent=exercises.length?Math.round(done/exercises.length*100):0,next=exercises.find(exercise=>!state.completed?.[exercise.id]),nextTopic=C.topics.find(topic=>topic.exercises.some(exercise=>exercise.id===next?.id)),activeIndex=Math.max(0,tabs.findIndex(tab=>tab.getAttribute('aria-selected')==='true')),activeTopic=C.topics[activeIndex];document.querySelectorAll('[data-progress-percent]').forEach(node=>node.textContent=percent+'%');document.querySelectorAll('[data-progress-orbit]').forEach(node=>node.style.setProperty('--progress',String(percent)));document.querySelectorAll('[data-dashboard-done]').forEach(node=>node.textContent=String(done));document.querySelectorAll('[data-dashboard-open]').forEach(node=>node.textContent=String(open));document.querySelectorAll('[data-dashboard-chapters]').forEach(node=>node.textContent=String(completedChapters));document.querySelectorAll('[data-dashboard-heading]').forEach(node=>node.textContent=nextTopic?'Weiter geht es mit „'+nextTopic.title+'“.':'Alles geschafft – der gesamte Lernpfad ist abgeschlossen.');document.querySelectorAll('[data-dashboard-next-copy]').forEach(node=>node.textContent=nextTopic?(open+' Aufgaben sind noch offen. Die nächste liegt in Kapitel '+(C.topics.indexOf(nextTopic)+1)+'.'):'Du kannst jetzt gezielt wiederholen oder deinen Fortschritt zurücksetzen.');document.querySelectorAll('[data-current-topic-title]').forEach(node=>node.textContent=(activeIndex+1)+'. '+(activeTopic?.title||'Kapitel'));document.querySelectorAll('[data-current-topic-status]').forEach(node=>{const activeDone=activeTopic?.exercises.filter(exercise=>state.completed?.[exercise.id]).length||0;node.textContent=activeDone+' / '+(activeTopic?.exercises.length||0)})}document.addEventListener('click',event=>{const target=event.target.closest('button');if(!target)return;if(target.matches('[data-dashboard-topic]')){tabs.find(tab=>tab.dataset.topicTab===target.dataset.dashboardTopic)?.click();document.querySelector('main')?.scrollIntoView({behavior:'smooth',block:'start'})}if(target.matches('[data-dashboard-filter]')){filter=target.dataset.dashboardFilter||'all';document.querySelectorAll('[data-dashboard-filter]').forEach(button=>button.classList.toggle('is-active',button===target));refresh()}if(target.matches('[data-open-chapters]')&&menu){menu.open=true;menu.querySelector('summary')?.focus()}if(target.matches('[data-chapter-prev],[data-chapter-next]')){const active=Math.max(0,tabs.findIndex(tab=>tab.getAttribute('aria-selected')==='true')),delta=target.matches('[data-chapter-next]')?1:-1;tabs[(active+delta+tabs.length)%tabs.length]?.click()}if(target.matches('[data-topic-tab]')&&menu)menu.open=false;queue()},true);document.addEventListener('change',queue);document.addEventListener('input',queue);window.addEventListener('storage',queue);refresh()})();
</script><script>
(()=>{'use strict';const KEY=${JSON.stringify(storageNamespace)},OK=${JSON.stringify(text("Kriterien erfüllt", "Meets the criteria"))},REVIEW=${JSON.stringify(text("Noch überarbeiten", "Needs revision"))},C=JSON.parse(document.getElementById('study-content').textContent),byId=new Map(C.topics.flatMap(topic=>topic.exercises).filter(exercise=>exercise.type==='application').map(exercise=>[exercise.id,exercise])),read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}},write=state=>{localStorage.setItem(KEY,JSON.stringify(state));window.dispatchEvent(new Event('storage'))},restore=()=>{const state=read();document.querySelectorAll('[data-sb-application-exercise]').forEach(card=>{const id=card.dataset.id,draft=card.querySelector('[data-application-draft]'),feedback=card.querySelector('.feedback');if(draft&&state.drafts?.[id]!==undefined)draft.value=state.drafts[id];if(feedback&&state.revealed?.[id]){feedback.hidden=false;feedback.innerHTML=(card.querySelector('[data-application-solution]')?.innerHTML||'')+'<div class="self-check"><button type="button" class="primary" data-application-ok>'+OK+'</button><button type="button" class="secondary" data-application-review>'+REVIEW+'</button></div>'}})};document.addEventListener('input',event=>{const draft=event.target.closest('[data-application-draft]');if(!draft)return;const card=draft.closest('[data-sb-application-exercise]'),state=read();state.drafts=state.drafts||{};state.drafts[card.dataset.id]=draft.value;write(state)});document.addEventListener('click',event=>{const button=event.target.closest('[data-review-application],[data-application-ok],[data-application-review]');if(!button)return;const card=button.closest('[data-sb-application-exercise]'),exercise=byId.get(card?.dataset.id||'');if(!card||!exercise)return;const state=read();state.drafts=state.drafts||{};state.revealed=state.revealed||{};state.completed=state.completed||{};state.drafts[exercise.id]=card.querySelector('[data-application-draft]')?.value||'';if(button.matches('[data-review-application]'))state.revealed[exercise.id]=true;if(button.matches('[data-application-ok]'))state.completed[exercise.id]=true;if(button.matches('[data-application-review]'))state.completed[exercise.id]=false;write(state);restore()});restore()})();
</script><script>${interactionController}</script></body></html>`;
}

function standardStudyGuideInteractionController(
  storageNamespace: string,
  language: "de" | "en",
): string {
  const label = (german: string, english: string) => language === "de" ? german : english;
  return `(()=>{'use strict';
const KEY=${JSON.stringify(storageNamespace)};
const COPY=${JSON.stringify({
    correct: label("Richtig.", "Correct."),
    incorrect: label("Noch nicht.", "Not yet."),
    incomplete: label("Noch nicht – gib alle verlangten Ergebnisse an.", "Not yet — include every requested result."),
    selfCompare: label("Vergleiche deinen Ansatz mit der Quellenlösung:", "Compare your approach with the source solution:"),
    understood: label("Als verstanden markiert.", "Marked as understood."),
    review: label("Zur Überarbeitung markiert.", "Marked for revision."),
    appDone: label("Kriterien als erfüllt markiert. Du kannst die Einschätzung jederzeit ändern.", "Criteria marked as met. You can change this assessment at any time."),
    appReview: label("Bleibt zur Überarbeitung offen.", "Remains open for revision."),
    meets: label("Kriterien erfüllt", "Meets the criteria"),
    revise: label("Noch überarbeiten", "Needs revision"),
  })};
const CONTENT=JSON.parse(document.getElementById('study-content').textContent);
const exercises=CONTENT.topics.flatMap(topic=>topic.exercises);
const byId=new Map(exercises.map(exercise=>[exercise.id,exercise]));
const tasks=[...document.querySelectorAll('.task')];
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}};
const write=state=>{localStorage.setItem(KEY,JSON.stringify(state));window.dispatchEvent(new Event('storage'))};
const announce=message=>{const live=document.querySelector('[data-live]');if(live)live.textContent=message};
const normalize=value=>String(value).trim().toLowerCase().replace(/,/g,'.').replace(/\\s+/g,'');
const numericValues=value=>(String(value).match(/[+-]?\\d+(?:[.,]\\d+)?/g)||[]).map(raw=>String(Number(raw.replace(',','.'))));
const includesNumbers=(expected,actual)=>{const pool=[...actual];return expected.every(value=>{const index=pool.indexOf(value);if(index<0)return false;pool.splice(index,1);return true})};
const matchesAnswer=(answers,value)=>answers.some(answer=>{if(normalize(answer)===normalize(value))return true;const expected=numericValues(answer),actual=numericValues(value);return expected.length>0&&actual.length>=expected.length&&includesNumbers(expected,actual)});
function updateTaskStates(state){
  tasks.forEach(task=>{
    const done=Boolean(state.completed?.[task.dataset.id]);
    task.classList.toggle('is-complete',done);
    task.dataset.learningState=done?'complete':state.revealed?.[task.dataset.id]?'review':'open';
  });
}
function calculationFeedback(card,exercise,state){
  const feedback=card.querySelector('.feedback');
  if(!feedback)return;
  const value=card.querySelector('.calc-answer')?.value||'';
  const selfCheck=exercise.acceptedAnswers.includes('__self_check__');
  const correct=!selfCheck&&matchesAnswer(exercise.acceptedAnswers,value);
  const expectedCounts=exercise.acceptedAnswers.map(answer=>numericValues(answer).length).filter(Boolean);
  const expectedCount=expectedCounts.length?Math.min(...expectedCounts):0;
  const incomplete=!selfCheck&&!correct&&expectedCount>1&&numericValues(value).length<expectedCount;
  const solution=card.querySelector('[data-solution]')?.innerHTML||'';
  feedback.hidden=false;
  feedback.className='feedback '+(correct?'good':'bad');
  feedback.innerHTML=(selfCheck?'<strong>'+COPY.selfCompare+'</strong>':correct?'<strong>'+COPY.correct+'</strong>':'<strong>'+(incomplete?COPY.incomplete:COPY.incorrect)+'</strong>')+solution+(selfCheck?'<div class="self-check"><button type="button" class="primary" data-self-ok>'+COPY.meets+'</button><button type="button" class="secondary" data-self-review>'+COPY.revise+'</button></div>':'');
  state.drafts=state.drafts||{};
  state.revealed=state.revealed||{};
  state.completed=state.completed||{};
  state.drafts[exercise.id]=value;
  state.revealed[exercise.id]=true;
  if(!selfCheck)state.completed[exercise.id]=correct;
  write(state);
  updateTaskStates(state);
  announce(correct?COPY.correct:COPY.incorrect);
}
function renderApplication(card,state){
  const id=card.dataset.id;
  const feedback=card.querySelector('.feedback');
  const draft=card.querySelector('[data-application-draft]');
  if(draft&&state.drafts?.[id]!==undefined&&document.activeElement!==draft)draft.value=state.drafts[id];
  const done=Boolean(state.completed?.[id]);
  card.classList.toggle('is-complete',done);
  card.dataset.learningState=done?'complete':state.revealed?.[id]?'review':'open';
  if(!feedback||!state.revealed?.[id]){if(feedback)feedback.hidden=true;return}
  feedback.hidden=false;
  feedback.className='feedback '+(done?'good':'');
  feedback.innerHTML=(card.querySelector('[data-application-solution]')?.innerHTML||'')+'<div class="self-check"><button type="button" class="primary" aria-pressed="'+String(done)+'" data-application-ok>'+COPY.meets+'</button><button type="button" class="secondary" aria-pressed="'+String(!done)+'" data-application-review>'+COPY.revise+'</button></div><p class="application-state">'+(done?COPY.appDone:COPY.appReview)+'</p>';
}
function activatePanel(panel){
  if(!panel)return;
  const id=panel.dataset.sbTopic;
  document.querySelectorAll('[data-sb-topic]').forEach(candidate=>candidate.hidden=candidate!==panel);
  document.querySelectorAll('[data-topic-tab]').forEach(tab=>{
    const active=tab.dataset.topicTab===id;
    tab.classList.toggle('is-active',active);
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex=active?0:-1;
  });
}
function continueLearning(){
  const state=read();
  const open=tasks.filter(task=>!state.completed?.[task.dataset.id]);
  const candidates=open.length?open:tasks;
  if(!candidates.length)return;
  const activeTask=document.activeElement?.closest?.('.task');
  const anchorId=activeTask?.dataset.id||state.lastContinueId;
  const anchorIndex=candidates.findIndex(task=>task.dataset.id===anchorId);
  const next=candidates[(anchorIndex+1+candidates.length)%candidates.length];
  state.lastContinueId=next.dataset.id;
  write(state);
  activatePanel(next.closest('[data-sb-topic]'));
  requestAnimationFrame(()=>{
    next.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
    next.querySelector('input:not([type="hidden"]),textarea,button')?.focus({preventScroll:true});
  });
}
window.addEventListener('click',event=>{
  const button=event.target.closest?.('button');
  if(!button)return;
  const handled=button.matches('[data-check-calc],[data-self-ok],[data-self-review],[data-review-application],[data-application-ok],[data-application-review],[data-continue]');
  if(!handled)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(button.matches('[data-continue]')){continueLearning();return}
  const card=button.closest('.task');
  const exercise=byId.get(card?.dataset.id||'');
  if(!card||!exercise)return;
  const state=read();
  if(button.matches('[data-check-calc]')&&exercise.type==='calculation'){calculationFeedback(card,exercise,state);return}
  if(button.matches('[data-self-ok],[data-self-review]')){
    state.completed=state.completed||{};
    state.completed[exercise.id]=button.matches('[data-self-ok]');
    write(state);
    updateTaskStates(state);
    announce(state.completed[exercise.id]?COPY.understood:COPY.review);
    return;
  }
  if(exercise.type!=='application')return;
  state.drafts=state.drafts||{};
  state.revealed=state.revealed||{};
  state.completed=state.completed||{};
  state.drafts[exercise.id]=card.querySelector('[data-application-draft]')?.value||'';
  if(button.matches('[data-review-application]'))state.revealed[exercise.id]=true;
  if(button.matches('[data-application-ok]')){state.revealed[exercise.id]=true;state.completed[exercise.id]=true}
  if(button.matches('[data-application-review]')){state.revealed[exercise.id]=true;state.completed[exercise.id]=false}
  write(state);
  renderApplication(card,state);
  updateTaskStates(state);
  announce(state.completed[exercise.id]?COPY.appDone:COPY.appReview);
},true);
window.addEventListener('input',event=>{
  const field=event.target.closest?.('.calc-answer,[data-application-draft]');
  if(!field)return;
  const card=field.closest('.task');
  const state=read();
  state.drafts=state.drafts||{};
  state.drafts[card.dataset.id]=field.value;
  write(state);
},true);
const initial=read();
document.querySelectorAll('.calculation').forEach(card=>{const input=card.querySelector('.calc-answer');if(input&&initial.drafts?.[card.dataset.id]!==undefined)input.value=initial.drafts[card.dataset.id]});
document.querySelectorAll('[data-sb-application-exercise]').forEach(card=>renderApplication(card,initial));
updateTaskStates(initial);
})();`;
}

export function matchesCalculationAnswer(acceptedAnswers: string[], value: string): boolean {
  const normalize = (entry: string) => entry.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, "");
  const numbers = (entry: string) => (entry.match(/[+-]?\d+(?:[.,]\d+)?/g) ?? [])
    .map((raw) => String(Number(raw.replace(",", "."))));
  return acceptedAnswers.some((answer) => {
    if (normalize(answer) === normalize(value)) return true;
    const expected = numbers(answer);
    const actual = numbers(value);
    if (expected.length === 0 || actual.length < expected.length) return false;
    const pool = [...actual];
    return expected.every((expectedValue) => {
      const index = pool.indexOf(expectedValue);
      if (index < 0) return false;
      pool.splice(index, 1);
      return true;
    });
  });
}

function crossHtml(
  exercise: Extract<StudyGuideContent["topics"][number]["exercises"][number], { type: "cross" }>,
  index: number,
  language: "de" | "en",
): string {
  const text = (german: string, english: string) => language === "de" ? german : english;
  const inputType = exercise.selectionMode === "multiple" ? "checkbox" : "radio";
  return `<article class="task cross" data-sb-cross-exercise data-id="${esc(exercise.id)}"><div class="task-top"><span class="task-number">${index + 1}</span><span class="task-kind">${exercise.selectionMode === "multiple" ? text("Mehrfachauswahl", "Multiple choice") : exercise.selectionMode === "true-false" ? text("Wahr / Falsch", "True / False") : text("Einfachauswahl", "Single choice")}</span><span class="task-source">${sourceLabel(exercise.source, language)}</span></div><div class="question-content">${richMathText(exercise.prompt)}</div><fieldset class="options"><legend class="sr-live">${text("Antwortoptionen", "Answer options")}</legend>${exercise.options.map((option, optionIndex) => `<label class="option"><input type="${inputType}" name="${esc(exercise.id)}" value="${optionIndex}"><span class="option-letter" aria-hidden="true">${String.fromCharCode(65 + optionIndex)}</span><span class="option-content">${richMathText(option.text, true)}</span><template data-option-feedback>${richMathText(option.feedback)}</template></label>`).join("")}</fieldset><template data-solution>${richMathText(exercise.explanation)}</template><div class="task-actions"><button class="primary" type="button" data-submit-cross>${text("Antwort auswerten", "Check answer")}</button></div><div class="feedback" hidden></div></article>`;
}

function calculationHtml(
  exercise: Extract<StudyGuideContent["topics"][number]["exercises"][number], { type: "calculation" }>,
  index: number,
  language: "de" | "en",
): string {
  const text = (german: string, english: string) => language === "de" ? german : english;
  const hasClearAnswerPrompt = /\b(?:berechne|bestimme|ermittle|löse|gib\s+(?:den|die|das)|wie\s+(?:groß|lautet)|calculate|compute|determine|find|solve|what\s+is|how\s+(?:large|much|many))\b/i.test(exercise.prompt);
  const multiValueAnswer = exercise.acceptedAnswers.some((answer) =>
    (answer.match(/[+-]?\d+(?:[.,]\d+)?/g) ?? []).length > 1
  );
  const answerLabel = multiValueAnswer
    ? text("Deine Kurzantworten", "Your short answers")
    : text("Deine Kurzantwort", "Your short answer");
  const answerPlaceholder = multiValueAnswer
    ? text("Alle Ergebnisse eingeben, z. B. A=…; B=…", "Enter every result, e.g. A=…; B=…")
    : text("Wert oder Ergebnis eingeben", "Enter a value or result");
  const answerControl = hasClearAnswerPrompt
    ? `<label><span class="block-label">${answerLabel}</span><input class="calc-answer" type="text" autocomplete="off" inputmode="${multiValueAnswer ? "text" : "decimal"}" aria-label="${answerLabel}" placeholder="${answerPlaceholder}"></label>`
    : `<input class="calc-answer" type="hidden" value="__solution_revealed__"><p class="solve-offline"><strong>${text("Arbeite zuerst ohne Lösung.", "Work without the solution first.")}</strong><span>${text("Nutze Papier oder dein Tablet und öffne den Rechenweg erst danach.", "Use paper or your tablet, then open the solution path.")}</span></p>`;
  const solution = `<ol>${exercise.steps.map((step) => `<li>${richMathText(step)}</li>`).join("")}</ol><p><strong>${text("Typischer Fehler:", "Common mistake:")}</strong> ${richMathText(exercise.commonMistake)}</p>`;
  return `<article class="task calculation${hasClearAnswerPrompt ? " calculation--answer" : " calculation--paper"}" data-sb-calculation-exercise data-id="${esc(exercise.id)}"><div class="task-top"><span class="task-number">${index + 1}</span><span class="task-kind">${hasClearAnswerPrompt ? text("Kurzantwort", "Short answer") : text("Rechenauftrag", "Calculation task")}</span><span class="task-source">${sourceLabel(exercise.source, language)}</span></div><div class="question-content">${richMathText(exercise.prompt)}</div>${exercise.givens.some((given) => !given.startsWith("Alle Größen") && !given.startsWith("All quantities")) ? `<ul>${exercise.givens.map((given) => `<li>${richMathText(given)}</li>`).join("")}</ul>` : ""}<div class="calc-input">${answerControl}<button class="primary" type="button" data-check-calc>${hasClearAnswerPrompt ? text("Lösung vergleichen", "Check solution") : text("Lösungsweg anzeigen", "Show solution path")}</button></div><details class="hints"><summary>${text("Methodenhinweis", "Method hint")}</summary><p>${text("Notiere zuerst die Voraussetzungen und wähle dann die passende Definition oder Rechenregel. Kontrolliere das Ergebnis unabhängig.", "Write down the assumptions first, then choose the appropriate definition or calculation rule. Check the result independently.")}</p></details><template data-solution>${solution}</template><div class="feedback" hidden></div></article>`;
}

function applicationHtml(
  exercise: Extract<StudyGuideContent["topics"][number]["exercises"][number], { type: "application" }>,
  index: number,
  language: "de" | "en",
): string {
  const text = (german: string, english: string) => language === "de" ? german : english;
  const solution = `<div class="application-sample"><strong>${text("Musterlösung oder Beispielantwort", "Sample response")}</strong><p>${richMathText(exercise.sampleAnswer)}</p></div><div class="application-rubric"><strong>${text("Selbstcheck", "Self-check")}</strong><ul>${exercise.selfCheck.map((criterion) => `<li>${richMathText(criterion)}</li>`).join("")}</ul></div>`;
  return `<article class="task application" data-sb-application-exercise data-id="${esc(exercise.id)}"><div class="task-top"><span class="task-number">${index + 1}</span><span class="task-kind">${text("Offene Anwendung", "Open application")}</span><span class="task-source">${sourceLabel(exercise.source, language)}</span></div><div class="question-content">${richMathText(exercise.prompt)}</div><ol class="application-instructions">${exercise.instructions.map((instruction) => `<li>${richMathText(instruction)}</li>`).join("")}</ol><label class="application-draft"><span class="block-label">${text("Dein Entwurf", "Your draft")}</span><textarea rows="6" data-application-draft autocomplete="off" placeholder="${text("Notiere hier deinen Ansatz, deine Analyse oder deine Formulierung …", "Write your approach, analysis, or response here …")}"></textarea></label><template data-application-solution>${solution}</template><div class="task-actions"><button class="primary" type="button" data-review-application>${text("Mit Beispiel und Kriterien vergleichen", "Compare with example and criteria")}</button></div><div class="feedback" hidden></div></article>`;
}

function vocabularyHtml(
  exercise: Extract<StudyGuideContent["topics"][number]["exercises"][number], { type: "vocabulary" }>,
  index: number,
  language: "de" | "en",
): string {
  const text = (german: string, english: string) => language === "de" ? german : english;
  return `<article class="task vocabulary" data-sb-vocabulary-exercise data-id="${esc(exercise.id)}"><div class="task-top"><span class="task-number">${index + 1}</span><span class="task-kind">${text("Vokabular", "Vocabulary")}</span><span class="task-source">${sourceLabel(exercise.source, language)}</span></div><div class="question-content">${richMathText(exercise.prompt)}</div><p>${richMathText(exercise.context)}</p><details><summary>${text("Antwort aufdecken", "Reveal answer")}</summary><p><strong>${esc(exercise.acceptedAnswers.join(" / "))}</strong></p><p>${richMathText(exercise.explanation)}</p></details></article>`;
}

export function richMathText(value: string, preferMath = false): string {
  const normalized = value.trim();
  const proseWords = normalized.match(/\b[A-Za-zÄÖÜäöüß]{3,}\b/g)?.filter((word) => !/^(?:lim|sin|cos|tan|exp|log)$/i.test(word)) ?? [];
  const mathDominant = preferMath && normalized.length <= 240 && /[=∫Σ√≤≥≠^]|_[{0-9n]/.test(normalized) && proseWords.length === 0 && delimitersBalanced(normalized);
  if (mathDominant) return `<span class="math-inline">${mathml(normalized)}</span>`;
  const equations = inlineEquationRanges(normalized);
  if (equations.length === 0) return lightweightMathText(normalized);
  const output: string[] = [];
  let cursor = 0;
  for (const equation of equations) {
    output.push(lightweightMathText(normalized.slice(cursor, equation.start)));
    output.push(renderInlineEquation(equation.expression));
    cursor = equation.end;
  }
  output.push(lightweightMathText(normalized.slice(cursor)));
  return output.join("");
}

export function mathml(expression: string): string {
  const normalized = expression.replace(
    /([A-Za-zÄÖÜäöüα-ωΑ-Ω])([A-Za-zÄÖÜäöüα-ωΑ-Ω0-9]*),((?:min|max|ges|zul|eff|nom|krit|vorh))\b/giu,
    (_match, base: string, suffix: string, qualifier: string) =>
      `${base}_{${suffix ? `${suffix},` : ""}${qualifier}}`,
  );
  const tokens = mathTokens(normalized);
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" aria-label="${esc(expression)}"><mrow>${renderMathTokens(tokens)}</mrow></math>`;
}

type InlineEquationRange = {
  start: number;
  end: number;
  expression: string;
};

function inlineEquationRanges(value: string): InlineEquationRange[] {
  const ranges: InlineEquationRange[] = [];
  const comparator = /[=≈≤≥≠<>]/g;
  let match: RegExpExecArray | null;
  while ((match = comparator.exec(value))) {
    const start = scanEquationStart(value, match.index);
    if (start >= match.index) continue;
    if (ranges.some((range) => start < range.end)) continue;
    const end = scanEquationEnd(value, comparator.lastIndex);
    const expression = value.slice(start, end).trim().replace(/[,;:]$/, "");
    if (!expression || !/[=≈≤≥≠<>]/.test(expression)) continue;
    const trimmedEnd = start + value.slice(start, end).lastIndexOf(expression) + expression.length;
    ranges.push({ start, end: trimmedEnd, expression });
    comparator.lastIndex = Math.max(comparator.lastIndex, trimmedEnd);
  }
  return ranges;
}

function scanEquationStart(value: string, comparatorIndex: number): number {
  const prefix = value.slice(0, comparatorIndex);
  const hardBoundary = Math.max(
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("."),
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf(":"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
  );
  const candidate = value.slice(hardBoundary + 1, comparatorIndex);
  const tokens = [...candidate.matchAll(/\S+/g)];
  let start = comparatorIndex;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (!looksLikeEquationLeftToken(token[0], index === tokens.length - 1)) break;
    start = hardBoundary + 1 + (token.index ?? 0);
  }
  while (start < comparatorIndex && /\s/.test(value[start]!)) start += 1;
  return start;
}

function looksLikeEquationLeftToken(token: string, allowNamedQuantity = false): boolean {
  const normalized = token.replace(/^[,،]+|[,،]+$/g, "");
  if (!normalized) return false;
  if (/^(?:ab|am|an|auf|aus|bei|der|die|das|den|dem|des|ein|eine|einer|eines|für|im|in|ist|mit|of|the|to|um|von|wird|zu)$/i.test(normalized)) {
    return false;
  }
  if (/^(?:sin|cos|tan|lim|log|ln|exp|max|min|mod)$/i.test(normalized)) return true;
  if (/^[A-Za-zÄÖÜäöüα-ωΑ-ΩµμΣ∞ℝ]\p{M}+$/u.test(normalized)) return true;
  if (/^[A-Za-zÄÖÜäöüα-ωΑ-ΩµμΣ∞ℝ]{1,2}$/u.test(normalized)) return true;
  if (/^[α-ωΑ-Ω][A-Za-zÄÖÜäöüß]{1,5}$/u.test(normalized)) return true;
  if (/^[A-Za-zÄÖÜäöü](?:(?:[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9]*)|(?:min|max|ges|zul|eff|nom|krit|vorh))(?:,(?:min|max|ges|zul|eff|nom|krit|vorh))?$/u.test(normalized)) {
    return true;
  }
  // Named-quantity equations are common in explanatory prose, for example
  // "Weg = Geschwindigkeit × Zeit". A single title-cased word immediately
  // before a relation is a safe equation boundary and keeps the complete
  // relation available to the accessible MathML renderer.
  if (allowNamedQuantity && /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{2,31}$/u.test(normalized)) return true;
  if (/^[A-Za-zÄÖÜäöü]{1,4},(?:min|max|ges|zul|eff|nom|krit|vorh)$/u.test(normalized)) return true;
  return /[0-9₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹()[\]{}_^′'∫Σ√+\-−*/·×]/u.test(normalized);
}

function scanEquationEnd(value: string, start: number): number {
  let cursor = start;
  let depth = 0;
  let sawRightHandToken = false;
  while (cursor < value.length) {
    const character = value[cursor]!;
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      cursor += 1;
      continue;
    }
    if (depth === 0 && (character === ";" || character === ":" || character === "!" || character === "?")) break;
    if (depth === 0 && character === "." && /\s|$/.test(value[cursor + 1] ?? "")) break;
    if (/[A-Za-zÄÖÜäöüα-ωΑ-Ωµμ]/u.test(character)) {
      const word = value.slice(cursor).match(/^[A-Za-zÄÖÜäöüα-ωΑ-Ωµμ]+/u)?.[0] ?? character;
      if (sawRightHandToken && !looksLikeMathWord(word)) break;
      sawRightHandToken = true;
      cursor += word.length;
      continue;
    }
    if (/\d/.test(character)) sawRightHandToken = true;
    cursor += 1;
  }
  return cursor;
}

function looksLikeMathWord(word: string): boolean {
  if (/^(?:ab|an|am|im|in|ist|sind|gilt|folgt|wird|mit|und|oder|als|für|bei|aus|is|are|was|were|as|of|to|or|and|from|with)$/i.test(word)) return false;
  if (/^(?:sin|cos|tan|lim|log|ln|exp|max|min|mod)$/i.test(word)) return true;
  if (/^(?:mm|cm|dm|m|km|µm|μm|nm|N|kN|MN|Pa|kPa|MPa|GPa|Nm|kNm|J|kJ|W|kW|Hz|rad|kg|g|s|ms|h)$/u.test(word)) return true;
  if (word.length <= 2) return true;
  if (/^[A-Za-zÄÖÜäöü](?:min|max|ges|zul|eff|nom|krit|vorh)$/i.test(word)) return true;
  if (/[α-ωΑ-Ω]/u.test(word)) return true;
  if (/[A-ZÄÖÜ]/.test(word.slice(1)) || /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{0,5}$/.test(word)) return true;
  return /^(?:min|max|ges|zul|eff|nom|krit|vorh)$/i.test(word);
}

function renderInlineEquation(expression: string): string {
  const parts = splitInlineEquationParts(expression);
  return `<wbr><span class="math-expression" role="math" aria-label="${esc(expression)}">${parts.map((part) => {
    const trimmed = part.trim();
    return /^(?:=|≈|≤|≥|≠|<|>|\+|−|·|×|-)$/.test(trimmed)
      ? `<span class="math-expression__relation" aria-hidden="true">${esc(trimmed)}</span>`
      : `<span class="math-expression__operand">${mathml(trimmed)}</span>`;
  }).map((part) => `<wbr>${part}`).join("")}</span>`;
}

function splitInlineEquationParts(expression: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const operators = new Set(["=", "≈", "≤", "≥", "≠", "<", ">", "+", "−", "·", "×", "-"]);
  const unaryPredecessors = new Set(["=", "≈", "≤", "≥", "≠", "<", ">", "+", "−", "·", "×", "-", "(", "[", "{", "^", "_", ","]);
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]!;
    if (!operators.has(character)) continue;
    const previous = expression.slice(0, index).trimEnd().at(-1);
    if (["+", "−", "-"].includes(character) && (!previous || unaryPredecessors.has(previous))) {
      continue;
    }
    const operand = expression.slice(start, index).trim();
    if (operand) parts.push(operand);
    parts.push(character);
    start = index + 1;
  }
  const tail = expression.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function renderMathTokens(tokens: string[]): string {
  const output: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const atom = readDecoratedMathAtom(tokens, index);
    let node = atom.node;
    index = atom.end;
    if (tokens[index + 1] === "/" && tokens[index + 2]) {
      const denominator = readDecoratedMathAtom(tokens, index + 2, false);
      node = `<mfrac>${node}${denominator.node}</mfrac>`;
      index = denominator.end;
    }
    output.push(node);
  }
  return output.join("");
}

function readDecoratedMathAtom(
  tokens: string[],
  start: number,
  preserveDelimiters = true,
): { node: string; end: number } {
  let node: string;
  let end: number;
  if (tokens[start] === "√") {
    const radicand = readDecoratedMathAtom(tokens, start + 1, false);
    node = `<msqrt>${radicand.node}</msqrt>`;
    end = radicand.end;
  } else if (tokens[start]?.toLocaleLowerCase() === "sqrt" && ["(", "{"].includes(tokens[start + 1] ?? "")) {
    const radicand = readMathAtom(tokens, start + 1, false);
    node = `<msqrt>${radicand.node}</msqrt>`;
    end = radicand.end;
  } else {
    const atom = readMathAtom(tokens, start, preserveDelimiters);
    node = atom.node;
    end = atom.end;
  }
  while (tokens[end + 1]) {
    const script = tokens[end + 1]!;
    if ((script === "_" || script === "^") && tokens[end + 2]) {
      const argument = readMathAtom(tokens, end + 2, false);
      const element = script === "_" ? "msub" : "msup";
      node = `<${element}>${node}<mrow>${argument.node}</mrow></${element}>`;
      end = argument.end;
      continue;
    }
    if (isUnicodeSubscript(script) || isUnicodeSuperscript(script)) {
      const element = isUnicodeSubscript(script) ? "msub" : "msup";
      node = `<${element}>${node}${mathScriptNode(script)}</${element}>`;
      end += 1;
      continue;
    }
    break;
  }
  return { node, end };
}

function readMathAtom(tokens: string[], start: number, preserveDelimiters = true): { node: string; end: number } {
  const token = tokens[start] ?? "";
  if (token !== "(" && token !== "{") return { node: mathToken(token), end: start };
  const close = token === "(" ? ")" : "}";
  let depth = 1;
  let end = start + 1;
  for (; end < tokens.length; end += 1) {
    if (tokens[end] === token) depth += 1;
    if (tokens[end] === close) depth -= 1;
    if (depth === 0) break;
  }
  const inner = renderMathTokens(tokens.slice(start + 1, end));
  const node = preserveDelimiters && token === "(" ? `<mrow><mo>(</mo>${inner}<mo>)</mo></mrow>` : `<mrow>${inner}</mrow>`;
  return { node, end: Math.min(end, tokens.length - 1) };
}

function mathTokens(value: string): string[] {
  return value.match(
    /[A-Za-zÄÖÜäöüα-ωΑ-ΩΣ∞ℝµμ]\p{M}+|[α-ωΑ-Ω][A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+|[A-Za-zÄÖÜäöüα-ωΑ-ΩΣ∞ℝµμ]+|\d+(?:[.,]\d+)?|[₀-₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ]+|[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ]+|\S/gu,
  ) ?? [];
}

function isUnicodeSubscript(value: string): boolean {
  return /^[₀-₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ]+$/u.test(value);
}

function isUnicodeSuperscript(value: string): boolean {
  return /^[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ]+$/u.test(value);
}

function mathScriptNode(value: string): string {
  const normalized = toNormalScript(value);
  if (/^\d+$/.test(normalized)) return `<mn>${esc(normalized)}</mn>`;
  if (/^[A-Za-zÄÖÜäöüα-ωΑ-Ω]$/u.test(normalized)) return `<mi>${esc(normalized)}</mi>`;
  return `<mrow>${renderMathTokens(mathTokens(normalized))}</mrow>`;
}

function delimitersBalanced(value: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "}": "{" };
  const stack: string[] = [];
  for (const character of value) {
    if (character === "(" || character === "{") stack.push(character);
    else if (character === ")" || character === "}") {
      if (stack.pop() !== pairs[character]) return false;
    }
  }
  return stack.length === 0;
}

function lightweightMathText(value: string): string {
  return esc(value)
    .replace(
      /(\d+(?:[.,]\d+)?)\^\(([+−-]?\d+(?:[.,]\d+)?)\)_([+−-]?\d+(?:[.,]\d+)?)/g,
      "$1<sup>$2</sup><sub>$3</sub>",
    )
    .replace(/([∫Σ])_\{?([A-Za-z0-9=+−-]{1,20})\}?\^\{?([A-Za-z0-9∞+−-]{1,20})\}?/g, '<span class="bounded-operator" aria-label="$1 von $2 bis $3">$1<sub>$2</sub><sup>$3</sup></span>')
    .replace(/\blim_\{?([A-Za-z0-9→∞+−-]{1,20})\}?/g, '<span class="bounded-operator" aria-label="Grenzwert für $1">lim<sub>$1</sub></span>')
    .replace(/([A-Za-z])_\{([^{}]{1,20})\}/g, "<var>$1</var><sub>$2</sub>")
    .replace(/\b([A-Za-z])_([A-Za-z][A-Za-z0-9]*(?:,[A-Za-z][A-Za-z0-9]+)?)/g, "<var>$1</var><sub>$2</sub>")
    .replace(/([A-Za-z])_([0-9n])/g, "<var>$1</var><sub>$2</sub>")
    .replace(/\^\{([^{}]{1,20})\}/g, "<sup>$1</sup>")
    .replace(/\^\(([+−-]?[A-Za-z0-9]{1,20})\)/g, "<sup>$1</sup>")
    .replace(/\^([−-]?[0-9]+|[A-Za-z])/g, "<sup>$1</sup>");
}

function clientContentForDisplay(content: StudyGuideContent): StudyGuideContent {
  return {
    ...content,
    topics: content.topics.map((topic) => ({
      ...topic,
      learningGoals: topic.learningGoals.map(typographicScripts),
      theory: {
        ...topic.theory,
        summary: typographicScripts(topic.theory.summary),
        keyIdeas: topic.theory.keyIdeas.map(typographicScripts),
      },
      workedExamples: topic.workedExamples.map((example) => ({
        ...example,
        prompt: typographicScripts(example.prompt),
        steps: example.steps.map(typographicScripts),
        answer: typographicScripts(example.answer),
      })),
      exercises: topic.exercises.map((exercise) => exercise.type === "cross" ? {
        ...exercise,
        prompt: typographicScripts(exercise.prompt),
        options: exercise.options.map((option) => ({
          ...option,
          text: typographicScripts(option.text),
          feedback: typographicScripts(option.feedback),
        })),
        explanation: typographicScripts(exercise.explanation),
      } : exercise.type === "calculation" ? {
        ...exercise,
        prompt: typographicScripts(exercise.prompt),
        givens: exercise.givens.map(typographicScripts),
        steps: exercise.steps.map(typographicScripts),
        commonMistake: typographicScripts(exercise.commonMistake),
      } : exercise.type === "application" ? {
        ...exercise,
        prompt: typographicScripts(exercise.prompt),
        instructions: exercise.instructions.map(typographicScripts),
        sampleAnswer: typographicScripts(exercise.sampleAnswer),
        selfCheck: exercise.selfCheck.map(typographicScripts),
      } : {
        ...exercise,
        prompt: typographicScripts(exercise.prompt),
        term: typographicScripts(exercise.term),
        acceptedAnswers: exercise.acceptedAnswers.map(typographicScripts),
        context: typographicScripts(exercise.context),
        explanation: typographicScripts(exercise.explanation),
      }),
      retrieval: topic.retrieval.map((item) => ({
        prompt: typographicScripts(item.prompt),
        answer: typographicScripts(item.answer),
      })),
    })),
  };
}

function typographicScripts(value: string): string {
  const superscript: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "−": "⁻", "+": "⁺", "a": "ᵃ", "b": "ᵇ", "i": "ⁱ", "k": "ᵏ", "m": "ᵐ", "n": "ⁿ", "t": "ᵗ", "x": "ˣ" };
  const subscript: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "-": "₋", "−": "₋", "+": "₊", "n": "ₙ", "k": "ₖ" };
  const convert = (raw: string, map: Record<string, string>) => [...raw].map((character) => map[character] ?? character).join("");
  return value
    .replace(/([∫Σ])_\{?([^{}\s^]+)\}?\^\{?([^{}\s,.;]+)\}?/g, "$1($2→$3)")
    .replace(/\^\(([+−-]?[A-Za-z0-9]{1,20})\)/g, (_match, script: string) => convert(script, superscript))
    .replace(/\^\{([+−-]?[0-9abikmntx]+)\}/g, (_match, script: string) => convert(script, superscript))
    .replace(/\^([+−-]?[0-9abikmntx]+)/g, (_match, script: string) => convert(script, superscript))
    .replace(/_\{([+−-]?[0-9nk]+)\}/g, (_match, script: string) => convert(script, subscript))
    .replace(/_([0-9nk])/g, (_match, script: string) => convert(script, subscript));
}

function mathToken(token: string): string {
  const overlinedVariable = token.match(/^([A-Za-zÄÖÜäöüα-ωΑ-ΩµμΣ∞ℝ])\u0304$/u);
  if (overlinedVariable) {
    return `<mover accent="true"><mi>${esc(overlinedVariable[1]!)}</mi><mo>¯</mo></mover>`;
  }
  if (/^(?:mm|cm|dm|km|µm|μm|nm|N|kN|MN|Pa|kPa|MPa|GPa|Nm|kNm|J|kJ|W|kW|Hz|rad|kg|ms|DIN|ISO|EN)$/u.test(token)) {
    return `<mtext>${esc(token)}</mtext>`;
  }
  const implicitNamedSubscript = token.match(/^([α-ωΑ-Ω])([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+)$/u);
  if (implicitNamedSubscript) {
    return `<msub><mi>${esc(implicitNamedSubscript[1])}</mi><mi>${esc(implicitNamedSubscript[2])}</mi></msub>`;
  }
  const implicitGreekSubscript = token.match(/^([α-ωΑ-Ω])([A-Za-zÄÖÜäöüß]+)$/u);
  if (implicitGreekSubscript) {
    return `<msub><mi>${esc(implicitGreekSubscript[1])}</mi><mi>${esc(implicitGreekSubscript[2])}</mi></msub>`;
  }
  const implicitLatinSubscript = token.match(/^([A-Za-zÄÖÜäöü])([A-Za-zÄÖÜäöüß]+)$/u);
  if (
    implicitLatinSubscript &&
    (
      /[A-ZÄÖÜ]/.test(implicitLatinSubscript[2]) ||
      /^(?:min|max|sp|kl|ges|zul|eff|nom|krit|vorh|z|s|t|k|b|v|a|d|w|h|n)$/i.test(implicitLatinSubscript[2])
    )
  ) {
    return `<msub><mi>${esc(implicitLatinSubscript[1])}</mi><mi>${esc(implicitLatinSubscript[2])}</mi></msub>`;
  }
  if (/^\d/.test(token)) return `<mn>${esc(token)}</mn>`;
  if (/^[A-Za-zÄÖÜäöüα-ωΑ-ΩΣ∞ℝ]+$/u.test(token)) return `<mi>${esc(token)}</mi>`;
  return `<mo>${esc(token)}</mo>`;
}

function toNormalScript(value: string): string {
  const map: Record<string, string> = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
    "₊": "+", "₋": "−", "₌": "=", "₍": "(", "₎": ")",
    "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₔ": "ə",
    "ₕ": "h", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n",
    "ₚ": "p", "ₛ": "s", "ₜ": "t",
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁺": "+", "⁻": "−", "⁼": "=", "⁽": "(", "⁾": ")",
    "ᵃ": "a", "ᵇ": "b", "ᶜ": "c", "ᵈ": "d", "ᵉ": "e",
    "ᶠ": "f", "ᵍ": "g", "ʰ": "h", "ⁱ": "i", "ʲ": "j",
    "ᵏ": "k", "ˡ": "l", "ᵐ": "m", "ⁿ": "n", "ᵒ": "o",
    "ᵖ": "p", "ʳ": "r", "ˢ": "s", "ᵗ": "t", "ᵘ": "u",
    "ᵛ": "v", "ʷ": "w", "ˣ": "x", "ʸ": "y", "ᶻ": "z",
  };
  return [...value].map((character) => map[character] ?? character).join("");
}

function sourceLabel(
  source: { label: string; sourceTask: string; provenance: "source" | "adapted" | "derived" },
  language: "de" | "en",
): string {
  const prefix = language === "de"
    ? source.provenance === "source" ? "Quelle · " : source.provenance === "adapted" ? "Angepasst · " : "Aus Kursinhalt abgeleitet · "
    : source.provenance === "source" ? "Source · " : source.provenance === "adapted" ? "Adapted · " : "Derived from course content · ";
  return `${prefix}${lightweightMathText(source.sourceTask)}`;
}

function compactCourseIdentity(courseTitle: string): string {
  return courseTitle.split(/[–—:\-]/, 1)[0].trim().slice(0, 24) || "Kurs";
}

function storageSlug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "kurs";
}

function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
