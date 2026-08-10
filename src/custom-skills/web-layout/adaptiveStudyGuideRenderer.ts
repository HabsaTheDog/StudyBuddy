import { createHash } from "node:crypto";
import {
  adaptiveStudyModelSchema,
  type AdaptiveStudyModel,
  type QuestionBank,
} from "./adaptiveStudyModel.js";
import { composeAssessment } from "./assessmentComposer.js";
import {
  LEARNER_STATE_SCHEMA_VERSION,
  learnerStateStorageKey,
} from "./learnerState.js";
import { studyBuddyCssTokenBlock } from "./designGuidelines.js";
import { studyGuideContentSchema, type StudyGuideContent } from "./studyGuideContent.js";
import { mathml, richMathText } from "./standardStudyGuideRenderer.js";
import {
  deriveModuleContextLabel,
  deriveModuleDisplayTitle,
  moduleNavigationLayout,
} from "./moduleTitles.js";
import { assertQuestionBankPublishable } from "./questionBankReview.js";
import type { JsonObject } from "./state.js";

export function renderAdaptiveStudyGuide(
  contentValue: JsonObject,
  adaptiveValue: JsonObject | AdaptiveStudyModel,
  language: "de" | "en",
): string {
  const content = studyGuideContentSchema.parse(contentValue);
  const adaptive = adaptiveStudyModelSchema.parse(adaptiveValue);
  assertQuestionBankPublishable(adaptive.questionBank);
  const text = (de: string, en: string) => language === "de" ? de : en;
  const artifactRevision = createHash("sha256")
    .update(JSON.stringify(adaptive.questionBank.items.map((item) => [
      item.id,
      item.contentHash,
    ])))
    .digest("hex")
    .slice(0, 20);
  const storageNamespace = learnerStateStorageKey(
    adaptive.courseBlueprint.courseId,
    artifactRevision,
  );
  const composedAssessment = composeAssessment(
    adaptive.assessmentBlueprint,
    adaptive.questionBank,
  );
  const hasAssessmentSurface = composedAssessment.simulationKind !== "none";
  const topicModules = content.topics.map((topic) =>
    adaptive.courseBlueprint.modules.find((candidate) => candidate.id === topic.id)
  );
  const titleLayout = moduleNavigationLayout(content.topics.map((topic, index) => ({
    title: topicModules[index]?.title ?? topic.title,
    displayTitle: topicModules[index]?.displayTitle ?? topic.navigationTitle,
  })));
  const topicTabs = content.topics.map((topic, index) => {
    const module = topicModules[index];
    const fullTitle = module?.title ?? topic.title;
    const displayTitle = module?.displayTitle ?? topic.navigationTitle ?? deriveModuleDisplayTitle(fullTitle);
    const contextLabel = deriveModuleContextLabel(fullTitle);
    return `
    <button class="module-tab${index === 0 ? " is-active" : ""}" type="button"
      role="tab" aria-selected="${index === 0}" aria-controls="topic-${esc(topic.id)}"
      data-topic-tab="${esc(topic.id)}" data-full-title="${esc(fullTitle)}"
      aria-label="${esc(contextLabel ? `${contextLabel}: ${displayTitle}` : fullTitle)}" title="${esc(fullTitle)}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${esc(displayTitle)}</strong>
    </button>`;
  }).join("");
  const topicPanels = content.topics.map((topic, index) =>
    theoryPanel(
      topic,
      adaptive.courseBlueprint.modules.find((module) => module.id === topic.id),
      index,
      language,
    )
  ).join("");
  const topicOptions = content.topics.map((topic, index) =>
    `<option value="${esc(topic.id)}">${esc(topicModules[index]?.displayTitle ?? topic.navigationTitle ?? deriveModuleDisplayTitle(topicModules[index]?.title ?? topic.title))}</option>`
  ).join("");
  const stageOptions = adaptive.courseBlueprint.learningStages.map((stage) =>
    `<option value="${stage.index}">${esc(stage.label)}</option>`
  ).join("");
  const assessment = adaptive.assessmentBlueprint;
  const assessmentSections = composedAssessment.sections.map((section) => `
    <li>
      <span>${String(section.order + 1).padStart(2, "0")}</span>
      <div><strong>${esc(section.title)}</strong><small>${section.documented.points !== null
        ? `${section.documented.points} ${text("Punkte", "points")}`
        : section.documented.weight !== null
          ? `${Math.round(section.documented.weight * 100)} % · ${text("im Kurs belegt", "supported by the course")}`
        : section.evidenceLevel === "explicit"
          ? text("Im Kurs belegt", "Supported by the course")
          : text("Aus der Kursstruktur abgeleitet", "Derived from course structure")}</small>
        <small>${section.items.length} ${section.items.length === 1
          ? text("Aufgabe in dieser Sitzung", "task in this session")
          : text("Aufgaben in dieser Sitzung", "tasks in this session")}</small></div>
    </li>`).join("");
  const excludedAssessmentSections = composedAssessment.excludedSections.map((section) => `
    <li class="assessment-section--external">
      <span>–</span>
      <div><strong>${esc(section.title)}</strong><small>${section.documented.weight !== null
        ? `${Math.round(section.documented.weight * 100)} % · ${text("im Kurs belegt", "supported by the course")}`
        : text("Im Kurs belegt", "Supported by the course")}</small>
        <small>${text("Nicht als Website-Prüfung simuliert; Vorbereitung bleibt im Themenbereich.", "Not simulated as a website exam; preparation remains in the topic workspace.")}</small></div>
    </li>`).join("");
  const assessmentTitle = composedAssessment.simulationKind === "exam_simulation" &&
      composedAssessment.support === "supported"
    ? assessment.title
    : composedAssessment.simulationKind === "exam_simulation"
      ? text(
        "Prüfungstraining nach dokumentierter Struktur",
        "Exam practice based on the documented structure",
      )
      : text("Übungssimulation nach Kursstruktur", "Exercise simulation based on course structure");
  const assessmentItemIds = composedAssessment.sections.flatMap((section) =>
    section.items.map((item) => item.id)
  );
  const examItemIds = [...new Set(assessmentItemIds)];
  const examItems = examItemIds.map((id) =>
    adaptive.questionBank.items.find((item) => item.id === id)
  );
  const incompleteExamItem = examItems.find((item) =>
    !item?.referenceSolution ||
    item.referenceSolution.completeness !== "complete" ||
    item.referenceSolution.review.status !== "approved" ||
    item.referenceSolution.missingEvidence.length > 0
  );
  if (incompleteExamItem || examItems.some((item) => !item)) {
    throw new Error(
      `Assessment item ${
        incompleteExamItem?.id ?? "unknown"
      } has no complete reviewed reference solution and cannot be published.`,
    );
  }
  const templates = adaptive.questionBank.items.map((item, index) =>
    questionTemplate(item, index, language)
  ).join("");
  const assessmentLimitations = [
    ...(assessment.sections.some((section) => section.taskCount === undefined || section.taskCount === null)
      ? [text(
        "Für mindestens einen Prüfungsabschnitt ist keine Aufgabenanzahl dokumentiert; die Auswahl zeigt dort Übungsabdeckung, keine offizielle Aufgabenanzahl.",
        "At least one assessment section has no documented task count; its selection shows practice coverage, not an official task count.",
      )]
      : []),
    ...composedAssessment.sections.flatMap((section) => {
      if (section.items.length === 0) {
        return [`${section.title}: ${text("keine passende geprüfte Frage verfügbar.", "no compatible reviewed question is available.")}`];
      }
      const missing: string[] = [];
      if (section.uncoveredQuestionTypes.length) {
        missing.push(`${text("Aufgabentypen", "response types")}: ${section.uncoveredQuestionTypes.join(", ")}`);
      }
      if (section.uncoveredLearningObjectiveIds.length) {
        missing.push(text(
          `${section.uncoveredLearningObjectiveIds.length} Lernziele sind im aktuellen Fragenpool noch nicht passend abgedeckt`,
          `${section.uncoveredLearningObjectiveIds.length} learning objectives do not yet have compatible coverage in the current question bank`,
        ));
      }
      return missing.length ? [`${section.title}: ${missing.join("; ")}`] : [];
    }),
    ...composedAssessment.excludedSections.map((section) => text(
      `${section.title}: erfordert eine live oder extern bewertete Leistung und wird deshalb nicht künstlich in Textfragen umgewandelt.`,
      `${section.title}: requires a live or externally judged performance, so it is not artificially converted into text questions.`,
    )),
  ];
  const sources = content.sources.map((source) => `
    <article class="source-card">
      <strong>${esc(source.label)}</strong>
      <p>${esc(source.coverage)}</p>
      ${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${text("In Moodle öffnen", "Open in Moodle")}</a>` : ""}
    </article>`).join("");
  const contentJson = safeJson(content);
  const courseJson = safeJson(adaptive.courseBlueprint);
  const assessmentJson = safeJson(adaptive.assessmentBlueprint);
  const bankJson = safeJson(adaptive.questionBank);
  const assessmentCompositionJson = safeJson({
    simulationKind: composedAssessment.simulationKind,
    support: composedAssessment.support,
    sectionItemIds: composedAssessment.sections.map((section) => ({
      id: section.id,
      title: section.title,
      itemIds: section.items.map((item) => item.id),
      selectionLimit: section.selectionLimit,
      selectionLimitBasis: section.selectionLimitBasis,
    })),
    scoringSections: composedAssessment.sections.map((section) => ({
      id: section.id,
      title: section.title,
      points: section.documented.points,
      itemIds: section.items.map((item) => item.id),
    })),
    unassignedQuestionIds: composedAssessment.unassignedQuestionIds,
    excludedSections: composedAssessment.excludedSections,
    examItemIds,
  });
  const controller = adaptiveController(storageNamespace, language);

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="study-buddy-renderer" content="adaptive-study-guide-v2">
  <title>${esc(content.courseTitle)} · Study Buddy</title>
  <style>${adaptiveCss()}</style>
</head>
<body>
  <a class="skip-link" href="#main-content">${text("Zum Lernbereich", "Skip to learning area")}</a>
  <header class="hotbar" data-sb-hotbar>
    <div class="hotbar-inner">
      <div class="brand">
        <img src="assets/logo.png" alt="">
        <div><strong>Study Buddy</strong><span>${esc(content.courseCode || content.courseTitle)}</span></div>
      </div>
      <div class="progress-summary" data-sb-progress aria-live="polite">
        <span data-progress-copy>0 ${text("gelernt", "learned")}</span>
        <div class="progress-track"><i data-progress-bar></i></div>
      </div>
      <button class="button button--quiet" type="button" data-reset-all>${text("Alles zurücksetzen", "Reset all")}</button>
    </div>
  </header>

  <section class="course-hero">
    <div class="hero-main">
      <p class="eyebrow">${esc(content.courseCode || text("Kursübersicht", "Course overview"))}</p>
      <h1>${esc(content.courseTitle)}</h1>
      <p class="hero-copy">${text(
        hasAssessmentSurface
          ? "Lerne entlang der echten Kursthemen, übe gezielt im Fragenkatalog oder starte eine prüfungsnahe Sitzung."
          : "Lerne entlang der echten Kursthemen und übe gezielt im Fragenkatalog.",
        hasAssessmentSurface
          ? "Learn along the actual course topics, practise selectively in the question catalogue, or start an assessment-focused session."
          : "Learn along the actual course topics and practise selectively in the question catalogue.",
      )}</p>
      <details class="coverage-note">
        <summary>${text("Abdeckung und Quellenhinweise", "Coverage and source notes")}</summary>
        <p>${esc(content.scopeNote)}</p>
      </details>
    </div>
    <aside class="learning-dial-panel" aria-label="${text("Kursfortschritt", "Course progress")}">
      <div class="progress-ring" data-progress-ring style="--progress:0deg">
        <div><strong data-progress-percent>0%</strong><span>${text("gelernt", "learned")}</span></div>
      </div>
      <dl class="course-facts">
        <div><dt>${text("Fragen", "Questions")}</dt><dd>${adaptive.questionBank.items.length}</dd></div>
        <div><dt>${text("Themen", "Topics")}</dt><dd>${content.topics.length}</dd></div>
        <div><dt>${text("Lernstufen", "Learning stages")}</dt><dd>${adaptive.courseBlueprint.learningStages.length}</dd></div>
      </dl>
    </aside>
  </section>

  <nav class="main-tabs" style="grid-template-columns:repeat(${hasAssessmentSurface ? 3 : 2},minmax(0,1fr))" role="tablist" aria-label="${text("Lernbereiche", "Learning areas")}" data-main-tabs>
    <button class="main-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="view-topics" data-main-tab="topics"><span>01</span><strong>${text("Themen", "Topics")}</strong><small>${text("Theorie und Kapitelübungen", "Theory and topic practice")}</small></button>
    <button class="main-tab" type="button" role="tab" aria-selected="false" aria-controls="view-catalog" data-main-tab="catalog"><span>02</span><strong>${text("Fragenkatalog", "Question catalogue")}</strong><small>${text("Alle Fragen und Filter", "Every question and filter")}</small></button>
    ${hasAssessmentSurface ? `<button class="main-tab" type="button" role="tab" aria-selected="false" aria-controls="view-exam" data-main-tab="exam"><span>03</span><strong>${text("Prüfung", "Assessment")}</strong><small>${text("Prüfungsmodus starten", "Start exam mode")}</small></button>` : ""}
  </nav>

  <main id="main-content">
    <section class="main-panel" id="view-topics" data-main-panel="topics" role="tabpanel">
      <nav class="module-tabs" role="tablist" aria-label="${text("Kurskapitel", "Course modules")}" data-sb-course-tabs data-sb-course-map data-module-title-layout="${titleLayout}">
        ${topicTabs}
      </nav>
      <section class="theory-shell" data-sb-learning-content aria-label="${text("Kursinhalt", "Course content")}">
        ${topicPanels}
      </section>
      <section class="topic-practice" data-topic-practice aria-labelledby="topic-practice-title">
        <div class="section-heading">
          <div><p class="eyebrow">${text("Direkt anwenden", "Apply it now")}</p><h2 id="topic-practice-title" data-topic-practice-title>${text("Fragen zum Thema", "Questions for this topic")}</h2></div>
          <button class="button button--quiet" type="button" data-topic-open-catalog>${text("Alle im Fragenkatalog öffnen", "Open all in question catalogue")}</button>
        </div>
        <div class="topic-question-strip" data-topic-question-index aria-label="${text("Fragen dieses Themas", "Questions in this topic")}"></div>
        <div class="topic-focus">
          <div class="focus-toolbar">
            <button class="icon-button" type="button" data-topic-prev aria-label="${text("Vorherige Themenfrage", "Previous topic question")}">←</button>
            <div><span class="eyebrow">${text("Kapitelübung", "Topic practice")}</span><strong data-topic-position>0 / 0</strong></div>
            <button class="icon-button" type="button" data-topic-next aria-label="${text("Nächste Themenfrage", "Next topic question")}">→</button>
          </div>
          <div data-topic-question-host data-learning-question-host></div>
          <div class="empty-pool" data-topic-empty hidden><strong>${text("Für dieses Thema ist noch keine geprüfte Frage verfügbar.", "No reviewed question is available for this topic yet.")}</strong></div>
        </div>
      </section>
    </section>

    <section class="main-panel catalog-shell" id="view-catalog" data-main-panel="catalog" role="tabpanel" hidden data-sb-question-workspace data-sb-practice aria-labelledby="catalog-title">
      <div class="section-heading">
        <div><p class="eyebrow">${text("Üben und wiederholen", "Practise and review")}</p><h2 id="catalog-title">${text("Fragenkatalog", "Question catalogue")}</h2></div>
        <p>${text("Kombiniere Kapitel, Lernstufe und persönlichen Status. Es wird immer nur eine Frage geöffnet.", "Combine module, learning stage, and personal status. Only one question is opened at a time.")}</p>
      </div>
      <form class="catalog-filters" data-catalog-filters>
        <label><span>${text("Kapitel", "Module")}</span><select data-filter-topic><option value="all">${text("Alle Kapitel", "All modules")}</option>${topicOptions}</select></label>
        <label><span>${text("Lernstufe", "Learning stage")}</span><select data-filter-stage><option value="all">${text("Alle Lernstufen", "All stages")}</option>${stageOptions}</select></label>
        <label><span>${text("Status", "Status")}</span><select data-filter-status>
          <option value="all">${text("Alle Fragen", "All questions")}</option>
          <option value="continue">${text("Weiterlernen", "Continue learning")}</option>
          <option value="review">${text("Wiederholen", "Review")}</option>
          <option value="starred">${text("Markiert", "Starred")}</option>
          <option value="learned">${text("Gelernt", "Learned")}</option>
        </select></label>
        <button class="button button--quiet" type="button" data-clear-filters>${text("Filter zurücksetzen", "Reset filters")}</button>
      </form>
      <div class="catalog-workspace">
        <aside class="catalog-index" aria-label="${text("Gefilterte Fragen", "Filtered questions")}">
          <div class="catalog-count"><strong data-catalog-count>0</strong><span>${text("Fragen", "questions")}</span></div>
          <div class="question-index" data-question-index></div>
        </aside>
        <div class="focus-stage">
          <div class="focus-toolbar">
            <button class="icon-button" type="button" data-session-prev aria-label="${text("Vorherige Frage", "Previous question")}">←</button>
            <div><span class="eyebrow" data-current-topic>${text("Fragenkatalog", "Question catalogue")}</span><strong data-session-position>0 / 0</strong></div>
            <button class="icon-button" type="button" data-session-next aria-label="${text("Nächste Frage", "Next question")}">→</button>
          </div>
          <div data-question-host data-learning-question-host></div>
          <div class="empty-pool" data-empty-pool hidden>
            <strong>${text("Keine Frage passt zu dieser Kombination.", "No question matches this combination.")}</strong>
            <p>${text("Entferne einen Filter oder setze den Katalog zurück.", "Remove a filter or reset the catalogue.")}</p>
            <button class="button button--secondary" type="button" data-clear-filters>${text("Alle Fragen zeigen", "Show all questions")}</button>
          </div>
        </div>
      </div>
    </section>

    ${hasAssessmentSurface ? `<section class="main-panel" id="view-exam" data-main-panel="exam" role="tabpanel" hidden>
    <section class="assessment-card" id="exam-mode" data-assessment-support="${composedAssessment.support}" aria-labelledby="assessment-title">
      <div class="assessment-copy">
        <p class="eyebrow">${composedAssessment.simulationKind === "exam_simulation"
          ? text("Aus Kursinformationen rekonstruiert", "Reconstructed from course evidence")
          : text("Transparent abgeleitete Übungsform", "Transparent inferred practice format")}</p>
        <h2 id="assessment-title">${esc(assessmentTitle)}</h2>
        <p>${composedAssessment.simulationKind === "exam_simulation"
          ? text("Die Abschnitte folgen den gefundenen Prüfungsinformationen. Nur dokumentierte Dauer, Punkte und Hilfsmittel werden angezeigt.", "Sections follow the assessment information found in the course. Only documented timing, points, and aids are shown.")
          : text("Es wurden keine ausreichend vollständigen offiziellen Prüfungsangaben gefunden. Diese Zusammenstellung orientiert sich deshalb an Kursstruktur und Aufgabentypen.", "No sufficiently complete official assessment description was found. This practice follows the course structure and task types instead.")}</p>
        <div class="assessment-facts">
          ${assessment.durationMinutes ? `<span><strong>${assessment.durationMinutes} min</strong>${text("Dokumentierte Dauer", "Documented duration")}</span>` : ""}
          ${assessment.maxPoints ? `<span><strong>${assessment.maxPoints}</strong>${text("Dokumentierte Punkte", "Documented points")}</span>` : ""}
          <span><strong>${composedAssessment.sections.length}</strong>${text("hier simulierbare Abschnitte", "sections simulated here")}</span>
        </div>
        ${assessment.allowedAids.length ? `<p><strong>${text("Erlaubte Hilfsmittel:", "Allowed aids:")}</strong> ${esc(assessment.allowedAids.join(", "))}</p>` : ""}
        <details class="assessment-limitations"${composedAssessment.support === "supported" ? "" : " open"}>
          <summary>${text("Abdeckung und Grenzen", "Coverage and limitations")}</summary>
          <ul>${assessmentLimitations.map((finding) => `<li>${esc(finding)}</li>`).join("")}</ul>
        </details>
        <button class="button button--primary" type="button" data-start-assessment${examItemIds.length ? "" : " disabled"}>${text("Prüfungsmodus starten", "Start exam mode")}</button>
      </div>
      <ol class="assessment-sections">${assessmentSections}${excludedAssessmentSections}</ol>
    </section>
    <section class="exam-shell" data-exam-shell hidden aria-labelledby="exam-session-title">
      <header class="exam-header">
        <div><p class="eyebrow">${text("Laufende Prüfungssitzung", "Active exam session")}</p><h2 id="exam-session-title">${esc(assessmentTitle)}</h2></div>
        <div class="exam-timing"><strong data-exam-timer>${assessment.durationMinutes ? `${assessment.durationMinutes}:00` : "–"}</strong><span>${text("verbleibend", "remaining")}</span></div>
      </header>
      <div class="exam-progress"><i data-exam-progress></i></div>
      <nav class="exam-navigation" data-exam-navigation aria-label="${text("Prüfungsfragen", "Exam questions")}"></nav>
      <div class="exam-question" data-exam-question></div>
      <footer class="exam-actions">
        <button class="button button--secondary" type="button" data-exam-prev>${text("Zurück", "Back")}</button>
        <button class="button button--primary" type="button" data-exam-next>${text("Weiter", "Next")}</button>
        <button class="button button--primary" type="button" data-exam-finish hidden>${text("Prüfung beenden", "Finish exam")}</button>
      </footer>
      <div class="exam-result" data-exam-result hidden></div>
    </section>
    </section>` : ""}
  </main>

  <section class="sources" data-sb-sources>
    <div class="sources-inner">
      <p class="eyebrow">${text("Nachvollziehbar lernen", "Traceable learning")}</p>
      <h2>${text("Quellen & Abdeckungsgrenzen", "Sources and coverage boundaries")}</h2>
      <div class="source-grid">${sources}</div>
    </div>
  </section>

  <div class="sr-live" aria-live="polite" data-live></div>
  <script type="application/json" id="study-content">${contentJson}</script>
  <script type="application/json" id="course-blueprint">${courseJson}</script>
  <script type="application/json" id="assessment-blueprint">${assessmentJson}</script>
  <script type="application/json" id="assessment-composition">${assessmentCompositionJson}</script>
  <script type="application/json" id="question-bank">${bankJson}</script>
  <div class="question-templates" hidden>${templates}</div>
  <script>${controller}</script>
</body>
</html>`;
}

function theoryPanel(
  topic: StudyGuideContent["topics"][number],
  module: AdaptiveStudyModel["courseBlueprint"]["modules"][number] | undefined,
  index: number,
  language: "de" | "en",
): string {
  const text = (de: string, en: string) => language === "de" ? de : en;
  const fullTitle = module?.title ?? topic.title;
  const visibleTitle = module?.displayTitle ?? topic.navigationTitle ?? deriveModuleDisplayTitle(fullTitle);
  const contextLabel = deriveModuleContextLabel(fullTitle);
  const subtopics = module?.subtopics ?? [];
  const formulaHeavy = topic.theory.formulas.some((formula) =>
    formula.expression.length > 18
  ) || topic.theory.formulas.length > 4;
  const vocabulary = topic.exercises.filter((exercise) => exercise.type === "vocabulary");
  const vocabularyCards = vocabulary.map((exercise) => `<details class="vocabulary-card"><summary><span>${esc(exercise.term)}</span><small>${text("Bedeutung aufdecken", "Reveal meaning")}</small></summary><div><strong>${esc(exercise.acceptedAnswers.join(" / "))}</strong><p>${richMathText(exercise.context)}</p><small>${originLabel(exercise.source.provenance, language)} · ${esc(exercise.source.label)}</small></div></details>`).join("");
  const denseVocabulary = vocabulary.length > 6;
  return `<section class="topic-panel" id="topic-${esc(topic.id)}" data-sb-topic="${esc(topic.id)}" role="tabpanel"${index === 0 ? "" : " hidden"}>
    <header class="topic-heading"><span>${String(index + 1).padStart(2, "0")}</span><div><p class="eyebrow">${esc(contextLabel || text("Kurskapitel", "Course module"))}</p><h2>${esc(visibleTitle)}</h2>${visibleTitle !== fullTitle ? `<details class="module-source-title"><summary>${text("Vollständige Kursbezeichnung", "Full course title")}</summary><p>${esc(fullTitle)}</p></details>` : ""}</div></header>
    ${subtopics.length > 1
      ? `<div class="module-outline" data-course-subtopics><strong>${text("Enthaltene Kursthemen", "Included course topics")}</strong><ol>${subtopics.map((subtopic) => `<li>${esc(subtopic)}</li>`).join("")}</ol></div>`
      : ""}
    <div class="topic-layout${formulaHeavy ? " topic-layout--formula-heavy" : ""}">
      <article class="reading-card">
        <p class="eyebrow">${text("Orientierung", "Orientation")}</p>
        <h3>${text("Worum geht es?", "What is this about?")}</h3>
        <p class="lead">${richMathText(topic.theory.summary)}</p>
        <div class="goal-box"><strong>${text("Nach diesem Kapitel kannst du", "After this module, you can")}</strong><ul>${topic.learningGoals.map((goal) => `<li>${richMathText(goal)}</li>`).join("")}</ul></div>
      </article>
      <aside class="concept-card">
        <p class="eyebrow">${text("Kernideen", "Core ideas")}</p>
        <ol>${topic.theory.keyIdeas.map((idea) => `<li>${richMathText(idea)}</li>`).join("")}</ol>
        ${topic.theory.formulas.length ? `<div class="formula-grid">${topic.theory.formulas.map((formula) => `<figure class="${formula.expression.length > 18 ? "formula--wide" : ""}"><div class="math-scroll">${mathml(formula.expression)}</div><figcaption>${richMathText(formula.meaning)}</figcaption></figure>`).join("")}</div>` : ""}
      </aside>
    </div>
    ${module?.theoryVisual
      ? learningVisualHtml(module.theoryVisual, "module", language)
      : ""}
    ${vocabulary.length ? `<section class="vocabulary-deck${denseVocabulary ? " vocabulary-deck--carousel" : ""}" data-vocabulary-deck data-vocabulary-mode="${denseVocabulary ? "carousel" : "grid"}">
      <div class="vocabulary-deck__heading"><p class="eyebrow">${text("Aktiver Wortschatz", "Active vocabulary")}</p><h3>${text("Begriffe aus diesem Kursthema", "Terms from this course topic")}</h3><span>${vocabulary.length}</span></div>
      ${denseVocabulary
        ? `<div class="vocabulary-deck__controls"><small>${text("Wischen oder mit den Pfeilen durchgehen", "Swipe or use the arrows")}</small><div><button type="button" data-vocabulary-prev aria-label="${text("Vorherige Wortschatzkarten", "Previous vocabulary cards")}">←</button><button type="button" data-vocabulary-next aria-label="${text("Nächste Wortschatzkarten", "Next vocabulary cards")}">→</button></div></div><div class="vocabulary-deck__track" data-vocabulary-track tabindex="0" aria-label="${text("Wortschatzkarten", "Vocabulary cards")}">${vocabularyCards}</div>`
        : `<div class="vocabulary-deck__grid">${vocabularyCards}</div>`}
    </section>` : ""}
    <div class="worked-grid">${topic.workedExamples.map((example) => `<details class="worked-example"><summary><span><small>${text("Geführtes Beispiel", "Worked example")}</small>${esc(example.title)}</span><b>${text("Lösungsweg öffnen", "Open solution")}</b></summary><div><p>${richMathText(example.prompt)}</p><ol>${example.steps.map((step) => `<li>${richMathText(step)}</li>`).join("")}</ol><p class="worked-result"><strong>${text("Ergebnis:", "Result:")}</strong> ${richMathText(example.answer)}</p><small>${originLabel(example.source.provenance, language)} · ${esc(example.source.label)}</small></div></details>`).join("")}</div>
  </section>`;
}

function questionTemplate(
  item: QuestionBank["items"][number],
  index: number,
  language: "de" | "en",
): string {
  const text = (de: string, en: string) => language === "de" ? de : en;
  const exercise = item.exercise;
  if (
    item.assessmentSectionId &&
    (!item.referenceSolution ||
      item.referenceSolution.completeness !== "complete" ||
      item.referenceSolution.review.status !== "approved" ||
      item.referenceSolution.missingEvidence.length > 0)
  ) {
    throw new Error(
      `Assessment item ${item.id} has no complete reviewed reference solution and cannot be rendered.`,
    );
  }
  const selfCheckCalculation = exercise.type === "calculation" &&
    exercise.acceptedAnswers.includes("__self_check__");
  const body = exercise.type === "cross"
    ? `<fieldset class="answer-options"><legend class="sr-only">${text("Antwortmöglichkeiten", "Answer options")}</legend>${exercise.options.map((option, optionIndex) => `<label><input type="${exercise.selectionMode === "multiple" ? "checkbox" : "radio"}" name="answer-${esc(item.id)}" value="${optionIndex}"><span>${String.fromCharCode(65 + optionIndex)}</span><b>${richMathText(option.text, true)}</b></label>`).join("")}</fieldset><button class="button button--primary" type="button" data-evaluate>${text("Antwort prüfen", "Check answer")}</button>`
    : exercise.type === "vocabulary"
      ? `<label class="answer-field vocabulary-answer"><span>${exercise.direction === "meaning-to-term" ? text("Gesuchter Begriff", "Term") : text("Deine Bedeutung oder Übersetzung", "Your meaning or translation")}</span><input type="text" data-answer-input autocomplete="off" autocapitalize="none" placeholder="${text("Antwort eingeben", "Enter your answer")}"></label><button class="button button--primary" type="button" data-evaluate>${text("Vokabel prüfen", "Check vocabulary")}</button>`
    : exercise.type === "calculation"
      ? `<label class="answer-field"><span>${selfCheckCalculation
        ? text("Dein vollständiger Lösungsweg", "Your complete solution")
        : exercise.acceptedAnswers.some((answer) => (answer.match(/[+-]?\d+(?:[.,]\d+)?/g) ?? []).length > 1)
          ? text("Alle verlangten Ergebnisse", "Every requested result")
          : text("Deine Antwort", "Your answer")}</span>${selfCheckCalculation
        ? `<textarea rows="10" data-answer-input placeholder="${text("Formeln, Rechenschritte, Einheiten und Ergebnisse notieren …", "Write formulas, calculations, units, and results …")}"></textarea>`
        : `<input type="text" data-answer-input autocomplete="off" placeholder="${text("Ergebnis eingeben", "Enter your result")}">`}</label><button class="button button--primary" type="button" data-evaluate>${selfCheckCalculation ? text("Mit Musterlösung vergleichen", "Compare with reference solution") : text("Lösung vergleichen", "Check solution")}</button><details class="method-hint"><summary>${text("Methodenhinweis", "Method hint")}</summary><p>${text("Notiere Voraussetzungen, Rechenregel und Einheiten, bevor du vergleichst.", "Write down assumptions, method, and units before comparing.")}</p></details>`
      : `<label class="answer-field"><span>${text("Dein Entwurf", "Your draft")}</span><textarea rows="7" data-answer-input data-application-draft placeholder="${text("Notiere deinen Ansatz …", "Write your approach …")}"></textarea></label><button class="button button--primary" type="button" data-evaluate>${text("Mit Beispiel und Kriterien vergleichen", "Compare with example and criteria")}</button>`;
  const solution = item.referenceSolution
    ? referenceSolutionHtml(item, language)
    : exercise.type === "cross"
      ? `<div><strong>${text("Lösung", "Solution")}</strong><p>${richMathText(exercise.explanation)}</p></div>`
      : exercise.type === "vocabulary"
        ? `<div><strong>${text("Lösung und Kontext", "Answer and context")}</strong><p><strong>${esc(exercise.acceptedAnswers.join(" / "))}</strong></p><p>${richMathText(exercise.context)}</p><p>${richMathText(exercise.explanation)}</p></div>`
      : exercise.type === "calculation"
        ? `<div><strong>${selfCheckCalculation
            ? text("Bewertungskriterien", "Assessment criteria")
            : text("Lösung und Rechenweg", "Solution and method")}</strong>${selfCheckCalculation
            ? `<ol>${exercise.steps.map((step) => `<li>${richMathText(step)}</li>`).join("")}</ol>`
            : `<p><strong>${text("Erwartete Antwort:", "Expected answer:")}</strong> ${exercise.acceptedAnswers.map((answer) => richMathText(answer)).join(" · ")}</p><ol>${exercise.steps.map((step) => `<li>${richMathText(step)}</li>`).join("")}</ol>`}<p><strong>${text("Typischer Fehler:", "Common mistake:")}</strong> ${richMathText(exercise.commonMistake)}</p></div>`
        : `<div><strong>${text("Musterlösung oder Beispielantwort", "Sample response")}</strong><p>${richMathText(exercise.sampleAnswer)}</p></div><div><strong>${text("Selbstcheck", "Self-check")}</strong><ul>${exercise.selfCheck.map((criterion) => `<li>${richMathText(criterion)}</li>`).join("")}</ul></div>`;
  return `<template id="question-template-${esc(item.id)}">
    <article class="question-card" data-sb-question-card ${questionTypeMarker(item.type)} data-question-id="${esc(item.id)}">
      <header class="question-meta">
        <div><span class="question-number">${String(index + 1).padStart(2, "0")}</span><span class="stage-chip">${esc(item.stageLabel)}</span><span class="origin-chip">${originLabel(item.origin, language)}</span></div>
        <span>${item.estimatedMinutes} min</span>
      </header>
      <h3>${richMathText(exercise.prompt)}</h3>
      ${questionVisualHtml(item, language)}
      ${exercise.type === "vocabulary" ? `<p class="vocabulary-context"><strong>${text("Kurskontext:", "Course context:")}</strong> ${richMathText(exercise.context)}</p>` : ""}
      ${exercise.type === "calculation" && exercise.givens.length ? `<ul class="givens">${exercise.givens.map((given) => `<li>${richMathText(given)}</li>`).join("")}</ul>` : ""}
      ${exercise.type === "application" ? `<ol class="instructions">${exercise.instructions.map((instruction) => `<li>${richMathText(instruction)}</li>`).join("")}</ol>` : ""}
      <div class="answer-area">${body}</div>
      <template data-solution>${solution}</template>
      <div class="question-feedback" data-feedback hidden></div>
      <footer class="question-controls">
        <button type="button" data-toggle-learned aria-pressed="false">✓ ${text("Gelernt", "Learned")}</button>
        <button type="button" data-toggle-review aria-pressed="false">↻ ${text("Wiederholen", "Review")}</button>
        <button type="button" data-toggle-starred aria-pressed="false">★ ${text("Markieren", "Star")}</button>
        <button type="button" data-reset-question>${text("Frage zurücksetzen", "Reset question")}</button>
      </footer>
      <p class="scope-note"><strong>${text("Scope:", "Scope:")}</strong> ${esc(item.scopeBasis.topicTitle)} · ${esc(item.scopeBasis.learningObjectives.join(", "))}<br><span>${esc(item.scopeBasis.sourceTask)}</span></p>
    </article>
  </template>`;
}

function questionVisualHtml(
  item: QuestionBank["items"][number],
  language: "de" | "en",
): string {
  if (item.visual) return learningVisualHtml(item.visual, "question", language);
  const taskImage = item.referenceSolution?.taskImage;
  if (!taskImage || taskImage.kind !== "diagram_crop") return "";
  const instruction = language === "de"
    ? "Die Aufgabenstellung steht darunter als durchsuchbarer Text."
    : "The task statement is provided below as searchable text.";
  const dimensions = taskImage.width && taskImage.height
    ? ` width="${taskImage.width}" height="${taskImage.height}"`
    : "";
  return `<figure class="assessment-task-visual" data-assessment-task-visual>
    <div class="assessment-task-visual__canvas">
      <img src="${esc(taskImage.dataUri)}" alt="${esc(taskImage.alt)}"${dimensions}>
    </div>
    <figcaption><strong>${esc(taskImage.sourceLabel)}</strong><span>${instruction}</span></figcaption>
  </figure>`;
}

function learningVisualHtml(
  visual: NonNullable<
    AdaptiveStudyModel["courseBlueprint"]["modules"][number]["theoryVisual"]
  >,
  placement: "module" | "question",
  language: "de" | "en",
): string {
  const instruction = language === "de"
    ? placement === "question"
      ? "Die Aufgabenstellung bleibt darunter als durchsuchbarer Text."
      : "Der Ausschnitt ergänzt die Erklärung; der Lerntext bleibt durchsuchbar."
    : placement === "question"
      ? "The task statement remains available below as searchable text."
      : "The crop supports the explanation; the learning text remains searchable.";
  const provenance = language === "de"
    ? visual.origin === "course_original" ? "Originale Kursgrafik" : "Aus Kursmaterial adaptiert"
    : visual.origin === "course_original" ? "Original course visual" : "Adapted from course material";
  return `<figure class="assessment-task-visual learning-visual learning-visual--${placement}" data-learning-visual="${placement}">
    <div class="assessment-task-visual__canvas">
      <img src="${esc(visual.dataUri)}" alt="${esc(visual.alt)}" width="${visual.width}" height="${visual.height}">
    </div>
    <figcaption><strong>${provenance} · ${esc(visual.sourceLabel)}</strong><span>${instruction}</span></figcaption>
  </figure>`;
}

function referenceSolutionHtml(
  item: QuestionBank["items"][number],
  language: "de" | "en",
): string {
  const solution = item.referenceSolution;
  if (!solution) return "";
  const text = (de: string, en: string) => language === "de" ? de : en;
  const origin = solution.solutionOrigin === "course_verified"
    ? text("Verifizierte Kurslösung", "Verified course solution")
    : text("Durch Study Buddy erstellte und geprüfte Musterlösung", "Study Buddy generated and reviewed reference solution");
  return `<div class="reference-solution" data-reference-solution>
    <div class="reference-solution__heading">
      <strong>${text("Musterlösung", "Reference solution")}</strong>
      <span>${origin}</span>
    </div>
    <p class="reference-solution__summary">${richMathText(solution.summary)}</p>
    <ol class="reference-solution__steps">${solution.steps.map((step) => `<li>${richMathText(step)}</li>`).join("")}</ol>
    <div class="reference-solution__result"><strong>${text("Endergebnis", "Final answer")}</strong><p>${richMathText(solution.finalAnswer)}</p></div>
    ${solution.assumptions.length
      ? `<details class="reference-solution__assumptions"><summary>${text("Verwendete Annahmen", "Assumptions used")}</summary><ul>${solution.assumptions.map((assumption) => `<li>${richMathText(assumption)}</li>`).join("")}</ul></details>`
      : ""}
    <p class="reference-solution__basis"><strong>${text("Geprüft anhand:", "Checked against:")}</strong> ${solution.evidenceBasis.map((basis) => esc(basis)).join(" · ")}</p>
  </div>`;
}

function originLabel(
  origin: string,
  language: "de" | "en",
): string {
  const labels: Record<string, [string, string]> = {
    source: ["Original aus Kurs", "Course original"],
    course_original: ["Original aus Kurs", "Course original"],
    adapted: ["Variante aus Kurs", "Course variant"],
    course_variant: ["Variante aus Kurs", "Course variant"],
    derived: ["Generiert durch Study Buddy", "Generated by Study Buddy"],
    study_buddy_generated: ["Generiert durch Study Buddy", "Generated by Study Buddy"],
  };
  return labels[origin]?.[language === "de" ? 0 : 1] ?? origin;
}

function questionTypeMarker(type: QuestionBank["items"][number]["type"]): string {
  switch (type) {
    case "cross":
      return "data-sb-cross-exercise";
    case "calculation":
      return "data-sb-calculation-exercise";
    case "application":
      return "data-sb-application-exercise";
    case "vocabulary":
      return "data-sb-vocabulary-exercise";
  }
}

function adaptiveController(storageNamespace: string, language: "de" | "en"): string {
  const text = (de: string, en: string) => language === "de" ? de : en;
  const copy = {
    all: text("Alle Fragen", "All questions"),
    continue: text("Weiterlernen", "Continue learning"),
    review: text("Wiederholen", "Review"),
    starred: text("Markiert", "Starred"),
    learned: text("Gelernt", "Learned"),
    correct: text("Richtig.", "Correct."),
    wrong: text("Noch nicht. Die Frage wurde zum Wiederholen markiert.", "Not yet. The question was added to review."),
    compare: text("Vergleiche deinen Ansatz und markiere anschließend Gelernt oder Wiederholen.", "Compare your response, then mark Learned or Review."),
    learnedMarked: text("Als gelernt markiert.", "Marked as learned."),
    reviewMarked: text("Zum Wiederholen markiert.", "Marked for review."),
    resetConfirm: text("Wirklich alle Antworten und Markierungen in diesem Study Buddy zurücksetzen?", "Reset every answer and marker in this Study Buddy?"),
    noAssessment: text("Für diese Simulation sind noch nicht genügend passende Fragen vorhanden.", "There are not enough suitable questions for this simulation."),
    examFinished: text("Prüfungssitzung beendet", "Exam session finished"),
    examReviewIntro: text("Vergleiche deine Antwort direkt mit der vollständigen Musterlösung und bewerte sie anschließend.", "Compare your answer directly with the complete reference solution, then assess it."),
    yourAnswer: text("Deine Antwort", "Your answer"),
    referenceAnswer: text("Musterlösung", "Reference solution"),
    noAnswer: text("Keine Antwort notiert.", "No answer recorded."),
    showSelfAssessment: text("Selbstbewertung", "Self-assessment"),
    showCriteria: text("Teilbewertung und Kriterien", "Detailed scoring and criteria"),
    markCorrect: text("Voll erfüllt", "Fully met"),
    markWrong: text("Nicht erfüllt", "Not met"),
    pointsLabel: text("Erreichte Punkte", "Points earned"),
    percentLabel: text("Erfüllung in Prozent", "Completion percentage"),
    selfAssessment: text("Selbstbewertung", "Self-assessment"),
    automaticallyGraded: text("Automatisch bewertet", "Automatically graded"),
    ratedTasks: text("bewertete Aufgaben", "rated tasks"),
    openRatings: text("Selbstbewertungen noch offen", "self-assessments still open"),
    resultComplete: text("Selbstbewertung vollständig", "Self-assessment complete"),
    passed: text("Bestanden nach deiner Selbstbewertung", "Passed based on your self-assessment"),
    notPassed: text("Noch nicht bestanden nach deiner Selbstbewertung", "Not yet passed based on your self-assessment"),
    answered: text("beantwortet", "answered"),
    unanswered: text("offen", "unanswered"),
    restartExam: text("Prüfungsmodus neu starten", "Restart exam mode"),
  };
  return `(()=>{'use strict';
const KEY=${JSON.stringify(storageNamespace)},COPY=${JSON.stringify(copy)},SCHEMA_VERSION=${LEARNER_STATE_SCHEMA_VERSION};
const COURSE=JSON.parse(document.getElementById('course-blueprint').textContent);
const ASSESSMENT=JSON.parse(document.getElementById('assessment-blueprint').textContent);
const COMPOSITION=JSON.parse(document.getElementById('assessment-composition').textContent);
const BANK=JSON.parse(document.getElementById('question-bank').textContent);
const byId=new Map(BANK.items.map(item=>[item.id,item]));
const validIds=new Set(byId.keys());
const unsafeIds=new Set(['__proto__','constructor','prototype']);
const empty=()=>({schemaVersion:SCHEMA_VERSION,questions:{}});
let state=load();
let filters={topic:'all',stage:'all',status:'all'};
let activeView='topics';
let catalogSession={itemIds:BANK.items.map(item=>item.id),index:0};
const firstTopicId=document.querySelector('[data-topic-tab]')?.dataset.topicTab||BANK.items[0]?.topicId||'';
let topicSession={topicId:firstTopicId,itemIds:[],index:0};
let examSession={active:false,finished:false,itemIds:[],index:0,drafts:{},ratings:{},remainingSeconds:0,timer:null};
function load(){try{const parsed=JSON.parse(localStorage.getItem(KEY)||'null');if(!isRecord(parsed)||parsed.schemaVersion!==SCHEMA_VERSION||!isRecord(parsed.questions))return empty();const questions={};for(const [id,raw] of Object.entries(parsed.questions).slice(0,10000)){if(!validIds.has(id)||unsafeIds.has(id)||!isRecord(raw))continue;const qs={};if(raw.seen===true)qs.seen=true;if(raw.learned===true)qs.learned=true;if(raw.review===true)qs.review=true;if(raw.starred===true)qs.starred=true;if(typeof raw.draft==='string'&&raw.draft.length>0&&raw.draft.length<=20000)qs.draft=raw.draft;if(qs.learned&&qs.review)delete qs.learned;if(qs.learned||qs.review||qs.starred||qs.draft!==undefined)qs.seen=true;if(Object.keys(qs).length)questions[id]=qs}return{schemaVersion:SCHEMA_VERSION,questions}}catch{return empty()}}
function isRecord(value){return typeof value==='object'&&value!==null&&!Array.isArray(value)}
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const qstate=id=>(state.questions[id]=state.questions[id]||{});
const announce=message=>{const live=document.querySelector('[data-live]');if(live)live.textContent=message};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalize=value=>String(value).trim().toLowerCase().replace(/,/g,'.').replace(/\\s+/g,'');
const numbers=value=>(String(value).match(/[+-]?\\d+(?:[.,]\\d+)?/g)||[]).map(raw=>String(Number(raw.replace(',','.'))));
const named=value=>{const map=new Map();for(const match of String(value).matchAll(/([A-Za-z][A-Za-z0-9_]*)\\s*=\\s*([+-]?\\d+(?:[.,]\\d+)?)/g))map.set(match[1].toLowerCase(),String(Number(match[2].replace(',','.'))));return map};
function matches(answers,value){return answers.some(answer=>{if(normalize(answer)===normalize(value))return true;const expectedNamed=named(answer),actualNamed=named(value);if(expectedNamed.size){return [...expectedNamed].every(([key,val])=>actualNamed.get(key)===val)}const expected=numbers(answer),actual=numbers(value),pool=[...actual];return expected.length>0&&actual.length>=expected.length&&expected.every(val=>{const i=pool.indexOf(val);if(i<0)return false;pool.splice(i,1);return true})})}
function filteredIds(){
 return BANK.items.filter(item=>{
  if(filters.topic!=='all'&&item.topicId!==filters.topic)return false;
  if(filters.stage!=='all'&&String(item.stageIndex)!==filters.stage)return false;
  const qs=state.questions[item.id];
  if(filters.status==='continue'&&qs?.learned===true)return false;
  if(filters.status==='review'&&qs?.review!==true)return false;
  if(filters.status==='starred'&&qs?.starred!==true)return false;
  if(filters.status==='learned'&&qs?.learned!==true)return false;
  return true;
 }).map(item=>item.id);
}
function scrollToMainTabs(){const tabs=document.querySelector('[data-main-tabs]'),hotbar=document.querySelector('[data-sb-hotbar]');if(tabs)window.scrollTo({top:Math.max(0,window.scrollY+tabs.getBoundingClientRect().top-(hotbar?.offsetHeight||0)-12),behavior:'instant'})}
function applyFilters(resetIndex=true,scroll=false){
 const currentId=catalogSession.itemIds[catalogSession.index],ids=filteredIds();
 let index=resetIndex?0:Math.max(0,ids.indexOf(currentId));
 if(index<0)index=0;
 catalogSession={itemIds:ids,index};renderCatalog(activeView==='catalog');
 if(scroll)scrollToMainTabs();
}
function renderLearningQuestion(host,item,markSeen=true){
 if(!item){host.replaceChildren();return null}
 const template=document.getElementById('question-template-'+item.id);host.replaceChildren(template.content.cloneNode(true));
 const qs=markSeen?qstate(item.id):(state.questions[item.id]||{});if(markSeen){qs.seen=true;save()}
 const card=host.querySelector('[data-sb-question-card]');
 restoreDraft(card,item,qs.draft);
 renderStateButtons(card,item.id);
 return card;
}
function renderCatalog(markSeen=true){
 const item=byId.get(catalogSession.itemIds[catalogSession.index]),host=document.querySelector('[data-question-host]'),emptyNode=document.querySelector('[data-empty-pool]');
 if(!item){host.replaceChildren();emptyNode.hidden=false;refreshChrome();renderCatalogIndex();return}
 emptyNode.hidden=true;renderLearningQuestion(host,item,markSeen);
 document.querySelector('[data-current-topic]').textContent=item.scopeBasis.topicTitle;
 refreshChrome();renderCatalogIndex();
}
function setTopicSession(topicId,resetIndex=true,markSeen=true){
 const currentId=topicSession.itemIds[topicSession.index];
 const ids=BANK.items.filter(item=>item.topicId===topicId).map(item=>item.id);
 let index=resetIndex?0:Math.max(0,ids.indexOf(currentId));if(index<0)index=0;
 topicSession={topicId,itemIds:ids,index};renderTopicPractice(markSeen);
}
function renderTopicPractice(markSeen=true){
 const item=byId.get(topicSession.itemIds[topicSession.index]),host=document.querySelector('[data-topic-question-host]'),emptyNode=document.querySelector('[data-topic-empty]');
 const selectedTab=document.querySelector('[data-topic-tab="'+CSS.escape(topicSession.topicId)+'"] strong');
 document.querySelector('[data-topic-practice-title]').textContent=selectedTab?.textContent||item?.scopeBasis.topicTitle||(document.documentElement.lang==='de'?'Fragen zum Thema':'Questions for this topic');
 if(!item){host.replaceChildren();emptyNode.hidden=false;refreshChrome();renderTopicIndex();return}
 emptyNode.hidden=true;renderLearningQuestion(host,item,markSeen);refreshChrome();renderTopicIndex();
}
function selectMainView(view,scroll=false){
 if(!['topics','catalog','exam'].includes(view))return;
 activeView=view;
 document.querySelectorAll('[data-main-panel]').forEach(panel=>{panel.hidden=panel.dataset.mainPanel!==view});
 document.querySelectorAll('[data-main-tab]').forEach(tab=>{const active=tab.dataset.mainTab===view;tab.classList.toggle('is-active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1});
 if(view==='catalog')renderCatalog(true);
 if(view==='topics')renderTopicPractice(false);
 if(scroll)scrollToMainTabs();
}
function restoreDraft(card,item,draft){if(draft===undefined)return;if(item.type==='cross'){const chosen=parseCrossDraft(draft);card.querySelectorAll('input').forEach(input=>input.checked=chosen.includes(Number(input.value)))}else{const field=card.querySelector('[data-answer-input]');if(field)field.value=String(draft)}}
function parseCrossDraft(draft){try{const parsed=JSON.parse(draft);return Array.isArray(parsed)?parsed.filter(value=>Number.isInteger(value)):[]}catch{return[]}}
function readDraft(card,item){if(item.type!=='cross')return card.querySelector('[data-answer-input]')?.value||'';const selected=[...card.querySelectorAll('input:checked')].map(input=>Number(input.value));return selected.length?JSON.stringify(selected):''}
function setDraft(qs,draft){if(draft.length>0&&draft.length<=20000)qs.draft=draft;else delete qs.draft}
function feedback(card,html,good){const node=card.querySelector('[data-feedback]');node.hidden=false;node.className='question-feedback '+(good?'is-good':'is-bad');node.innerHTML=html}
function evaluate(card,item){
 const draft=readDraft(card,item),qs=qstate(item.id);qs.seen=true;setDraft(qs,draft);
 if(item.type==='cross'){const chosen=parseCrossDraft(draft),correct=item.exercise.options.map((option,index)=>option.correct?index:-1).filter(index=>index>=0),ok=chosen.length===correct.length&&chosen.every(index=>correct.includes(index));if(ok)delete qs.review;else{qs.review=true;delete qs.learned}const rows=item.exercise.options.map((option,index)=>'<li><strong>'+(option.correct?'✓':'×')+'</strong> '+esc(option.text)+' – '+esc(option.feedback)+'</li>').join('');feedback(card,'<strong>'+(ok?COPY.correct:COPY.wrong)+'</strong><ul>'+rows+'</ul><p>'+esc(item.exercise.explanation)+'</p>',ok);announce(ok?COPY.correct:COPY.wrong)}
 else if(item.type==='vocabulary'){const ok=matches(item.exercise.acceptedAnswers,draft);if(ok)delete qs.review;else{qs.review=true;delete qs.learned}const solution=card.querySelector('[data-solution]').innerHTML;feedback(card,'<strong>'+(ok?COPY.correct:COPY.wrong)+'</strong>'+solution,ok);announce(ok?COPY.correct:COPY.wrong)}
 else if(item.type==='calculation'){const self=item.exercise.acceptedAnswers.includes('__self_check__'),ok=!self&&matches(item.exercise.acceptedAnswers,draft);if(!self){if(ok)delete qs.review;else{qs.review=true;delete qs.learned}}const solution=card.querySelector('[data-solution]').innerHTML;feedback(card,'<strong>'+(self?COPY.compare:ok?COPY.correct:COPY.wrong)+'</strong>'+solution,ok);announce(self?COPY.compare:ok?COPY.correct:COPY.wrong)}
 else{const solution=card.querySelector('[data-solution]').innerHTML;feedback(card,'<strong>'+COPY.compare+'</strong>'+solution,false);announce(COPY.compare)}
 save();syncStateButtons(item.id);refreshChrome();renderCatalogIndex();renderTopicIndex();
}
function renderStateButtons(card,id){const qs=state.questions[id]||{};card.querySelector('[data-toggle-learned]').setAttribute('aria-pressed',String(Boolean(qs.learned)));card.querySelector('[data-toggle-review]').setAttribute('aria-pressed',String(Boolean(qs.review)));card.querySelector('[data-toggle-starred]').setAttribute('aria-pressed',String(Boolean(qs.starred)));card.classList.toggle('is-learned',Boolean(qs.learned));card.classList.toggle('is-review',Boolean(qs.review))}
function syncStateButtons(id){document.querySelectorAll('[data-learning-question-host] [data-sb-question-card]').forEach(card=>{if(card.dataset.questionId===id)renderStateButtons(card,id)})}
function toggle(id,key){const qs=qstate(id),next=!qs[key];if(next)qs[key]=true;else delete qs[key];if(key==='learned'&&qs.learned)delete qs.review;if(key==='review'&&qs.review)delete qs.learned;save();syncStateButtons(id);refreshChrome();renderCatalogIndex();renderTopicIndex();announce(key==='learned'&&qs.learned?COPY.learnedMarked:key==='review'&&qs.review?COPY.reviewMarked:'')}
function refreshChrome(){const total=BANK.items.length,learned=BANK.items.filter(item=>state.questions[item.id]?.learned).length,percent=total?Math.round(learned/total*100):0;document.querySelector('[data-progress-copy]').textContent=learned+' / '+total+' '+(document.documentElement.lang==='de'?'gelernt':'learned');document.querySelector('[data-progress-bar]').style.width=percent+'%';document.querySelector('[data-progress-ring]').style.setProperty('--progress',(percent*3.6)+'deg');document.querySelector('[data-progress-percent]').textContent=percent+'%';document.querySelector('[data-session-position]').textContent=catalogSession.itemIds.length?(catalogSession.index+1)+' / '+catalogSession.itemIds.length:'0 / 0';document.querySelector('[data-catalog-count]').textContent=String(catalogSession.itemIds.length);document.querySelector('[data-topic-position]').textContent=topicSession.itemIds.length?(topicSession.index+1)+' / '+topicSession.itemIds.length:'0 / 0';document.querySelector('[data-topic-prev]').disabled=topicSession.itemIds.length<2;document.querySelector('[data-topic-next]').disabled=topicSession.itemIds.length<2}
function renderCatalogIndex(){
 const host=document.querySelector('[data-question-index]');host.replaceChildren();
 catalogSession.itemIds.forEach((id,index)=>{const item=byId.get(id),qs=state.questions[id]||{},button=document.createElement('button');button.type='button';button.dataset.questionSelect=id;button.className='question-index-item'+(index===catalogSession.index?' is-active':'');button.setAttribute('aria-current',String(index===catalogSession.index));const number=document.createElement('span');number.textContent=String(index+1).padStart(2,'0');const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=item.exercise.prompt;const meta=document.createElement('small');const marks=[];if(qs.review)marks.push('↻ '+COPY.review);if(qs.starred)marks.push('★ '+COPY.starred);if(qs.learned)marks.push('✓ '+COPY.learned);meta.textContent=item.stageLabel+(marks.length?' · '+marks.join(' · '):'');copy.append(title,meta);button.append(number,copy);host.append(button)})}
function renderTopicIndex(){
 const host=document.querySelector('[data-topic-question-index]');host.replaceChildren();
 topicSession.itemIds.forEach((id,index)=>{const item=byId.get(id),qs=state.questions[id]||{},button=document.createElement('button');button.type='button';button.dataset.topicQuestionSelect=id;button.className='topic-question-chip'+(index===topicSession.index?' is-active':'');button.setAttribute('aria-current',String(index===topicSession.index));const number=document.createElement('span');number.textContent=String(index+1).padStart(2,'0');const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=item.exercise.prompt;const meta=document.createElement('small');const marks=[];if(qs.review)marks.push('↻');if(qs.starred)marks.push('★');if(qs.learned)marks.push('✓');meta.textContent=item.stageLabel+(marks.length?' · '+marks.join(' '):'');copy.append(title,meta);button.append(number,copy);host.append(button)})}
function setFilters(next,scroll=true){filters={...filters,...next};document.querySelector('[data-filter-topic]').value=filters.topic;document.querySelector('[data-filter-stage]').value=filters.stage;document.querySelector('[data-filter-status]').value=filters.status;applyFilters(true,scroll)}
function formatTime(seconds){if(!ASSESSMENT.durationMinutes)return '–';const safe=Math.max(0,seconds),minutes=Math.floor(safe/60),rest=safe%60;return String(minutes).padStart(2,'0')+':'+String(rest).padStart(2,'0')}
function renderExam(){
 const shell=document.querySelector('[data-exam-shell]'),host=document.querySelector('[data-exam-question]'),result=document.querySelector('[data-exam-result]');
 shell.hidden=false;result.hidden=true;shell.classList.remove('is-finished');
 const id=examSession.itemIds[examSession.index],item=byId.get(id);if(!item){host.replaceChildren();return}
 const template=document.getElementById('question-template-'+id);host.replaceChildren(template.content.cloneNode(true));
 const card=host.querySelector('[data-sb-question-card]');restoreDraft(card,item,examSession.drafts[id]);card.querySelectorAll('[data-evaluate],[data-feedback],.question-controls,.scope-note,.method-hint').forEach(node=>node.hidden=true);
 document.querySelector('[data-exam-progress]').style.width=((examSession.index+1)/examSession.itemIds.length*100)+'%';
 document.querySelector('[data-exam-timer]').textContent=formatTime(examSession.remainingSeconds);
	 const nav=document.querySelector('[data-exam-navigation]');nav.replaceChildren();examSession.itemIds.forEach((questionId,index)=>{const button=document.createElement('button');button.type='button';button.dataset.examSelect=String(index);button.textContent=String(index+1);button.className=index===examSession.index?'is-active':'';button.setAttribute('aria-label',(examSession.drafts[questionId]?COPY.answered:COPY.unanswered)+' '+String(index+1));nav.append(button)});
	 document.querySelector('[data-exam-prev]').disabled=examSession.index===0;
	 const last=examSession.index===examSession.itemIds.length-1;
	 document.querySelector('[data-exam-next]').hidden=last;
	 document.querySelector('[data-exam-finish]').hidden=!last;
	 }
function saveExamDraft(){const id=examSession.itemIds[examSession.index],item=byId.get(id),card=document.querySelector('[data-exam-question] [data-sb-question-card]');if(!item||!card)return;const draft=readDraft(card,item);if(draft)examSession.drafts[id]=draft;else delete examSession.drafts[id]}
function startAssessment(){const ids=[...new Set(COMPOSITION.examItemIds||[])].filter(id=>validIds.has(id));if(!ids.length){announce(COPY.noAssessment);return}if(examSession.timer)clearInterval(examSession.timer);examSession={active:true,finished:false,itemIds:ids,index:0,drafts:{},ratings:{},remainingSeconds:(ASSESSMENT.durationMinutes||0)*60,timer:null};if(ASSESSMENT.durationMinutes){examSession.timer=setInterval(()=>{examSession.remainingSeconds=Math.max(0,examSession.remainingSeconds-1);document.querySelector('[data-exam-timer]').textContent=formatTime(examSession.remainingSeconds);if(examSession.remainingSeconds===0)finishExam()},1000)}renderExam();document.querySelector('[data-exam-shell]').scrollIntoView({behavior:'smooth',block:'start'})}
function examCorrect(item,draft){if(item.type==='cross'){const chosen=parseCrossDraft(draft),correct=item.exercise.options.map((option,index)=>option.correct?index:-1).filter(index=>index>=0);return chosen.length===correct.length&&chosen.every(index=>correct.includes(index))}if(item.type==='vocabulary')return matches(item.exercise.acceptedAnswers,draft);if(item.type==='calculation'&&!item.exercise.acceptedAnswers.includes('__self_check__'))return matches(item.exercise.acceptedAnswers,draft);return null}
function examScoringSection(id){return (COMPOSITION.scoringSections||[]).find(section=>Array.isArray(section.itemIds)&&section.itemIds.includes(id))||null}
function examCriteria(item){if(item.type==='calculation')return item.exercise.steps||[];if(item.type==='application')return item.exercise.selfCheck||[];return[]}
function scoreInputHtml(id,section){
 const exactMax=section&&typeof section.points==='number'&&section.itemIds.length===1?section.points:null;
 return exactMax!==null
  ? '<label class="exam-score-input"><span>'+esc(COPY.pointsLabel)+' (0–'+exactMax+')</span><input type="number" min="0" max="'+exactMax+'" step="0.5" data-exam-points data-exam-rating-id="'+esc(id)+'"></label>'
  : '<label class="exam-score-input"><span>'+esc(COPY.percentLabel)+' (0–100)</span><input type="number" min="0" max="100" step="5" data-exam-percent data-exam-rating-id="'+esc(id)+'"></label>';
}
function examReviewCard(item,index){
 const id=item.id,draft=examSession.drafts[id]||'',outcome=examCorrect(item,draft),section=examScoringSection(id),criteria=examCriteria(item);
 if(outcome!==null)examSession.ratings[id]={fraction:outcome?1:0,mode:'auto'};
 const template=document.getElementById('question-template-'+id),solution=template?.content.querySelector('[data-solution]')?.innerHTML||'';
 const exactMax=section&&typeof section.points==='number'&&section.itemIds.length===1?section.points:null;
 const pointsCopy=exactMax!==null?' · '+exactMax+' '+(document.documentElement.lang==='de'?'Punkte':'points'):'';
 const criterionRows=criteria.length?'<fieldset class="exam-criteria"><legend class="sr-only">'+esc(COPY.selfAssessment)+'</legend>'+criteria.map((criterion,criterionIndex)=>'<label><input type="checkbox" data-exam-criterion data-exam-rating-id="'+esc(id)+'" value="'+criterionIndex+'"><span>'+esc(criterion)+'</span></label>').join('')+'</fieldset>':'';
	 const detailedScoring='<details class="exam-criteria-details"><summary><span>'+esc(COPY.showCriteria)+' <small>('+criteria.length+')</small></span><i class="disclosure-icon" aria-hidden="true">⌄</i></summary><div class="exam-detailed-scoring">'+scoreInputHtml(id,section)+'<p class="exam-item-score" data-exam-item-score>'+esc(COPY.openRatings)+'</p>'+criterionRows+'</div></details>';
	 const grading=outcome===null
	  ? '<details class="exam-self-assessment"><summary><span>'+esc(COPY.showSelfAssessment)+'</span><i class="disclosure-icon" aria-hidden="true">⌄</i></summary><div class="exam-rating-controls"><div class="exam-rating-row"><div class="exam-rating-buttons"><button class="button button--primary" type="button" data-exam-rate="correct" data-exam-rating-id="'+esc(id)+'">'+esc(COPY.markCorrect)+'</button><button class="button button--secondary" type="button" data-exam-rate="wrong" data-exam-rating-id="'+esc(id)+'">'+esc(COPY.markWrong)+'</button></div></div>'+detailedScoring+'</div></details>'
  : '<p class="exam-auto-score" data-exam-auto-score><strong>'+esc(COPY.automaticallyGraded)+':</strong> '+(outcome?esc(COPY.markCorrect):esc(COPY.markWrong))+'</p>';
 return '<article class="exam-review-card" data-exam-review-item="'+esc(id)+'"><header><span>'+(index+1).toString().padStart(2,'0')+'</span><div><small>'+esc(section?.title||item.scopeBasis.topicTitle)+pointsCopy+'</small><h4>'+esc(item.exercise.prompt)+'</h4></div></header><div class="exam-comparison"><section class="exam-draft-review"><strong>'+esc(COPY.yourAnswer)+'</strong><pre class="exam-user-answer">'+(draft?esc(draft):'<em>'+esc(COPY.noAnswer)+'</em>')+'</pre></section><section class="exam-solution" aria-label="'+esc(COPY.referenceAnswer)+'"><div>'+solution+'</div></section></div>'+grading+'</article>';
}
function examTotals(){
 const sections=COMPOSITION.scoringSections||[];
 const pointSections=sections.filter(section=>typeof section.points==='number'&&section.points>=0&&Array.isArray(section.itemIds)&&section.itemIds.length);
 const maxPoints=pointSections.reduce((sum,section)=>sum+section.points,0);
 const earned=pointSections.reduce((sum,section)=>{const fractions=section.itemIds.map(id=>examSession.ratings[id]?.fraction??0);return sum+(fractions.reduce((part,value)=>part+value,0)/fractions.length)*section.points},0);
 const rated=examSession.itemIds.filter(id=>examSession.ratings[id]).length;
 const percent=maxPoints>0?earned/maxPoints*100:(examSession.itemIds.length?examSession.itemIds.reduce((sum,id)=>sum+(examSession.ratings[id]?.fraction??0),0)/examSession.itemIds.length*100:0);
 return{maxPoints,earned,rated,percent};
}
function updateExamSummary(){
 const totals=examTotals(),score=document.querySelector('[data-exam-score]'),percent=document.querySelector('[data-exam-score-percent]'),status=document.querySelector('[data-exam-score-status]');
 if(!score||!percent||!status)return;
 score.textContent=totals.maxPoints>0?String(Math.round(totals.earned*10)/10)+' / '+totals.maxPoints+' '+(document.documentElement.lang==='de'?'Punkte':'points'):totals.rated+' / '+examSession.itemIds.length+' '+COPY.ratedTasks;
 percent.textContent=Math.round(totals.percent)+'%';
 const open=examSession.itemIds.length-totals.rated;
 let message=open?open+' '+COPY.openRatings:COPY.resultComplete;
 if(!open&&typeof ASSESSMENT.passingPoints==='number'&&totals.maxPoints>0)message+=' · '+(totals.earned>=ASSESSMENT.passingPoints?COPY.passed:COPY.notPassed);
 status.textContent=message;
 document.querySelector('[data-exam-score-bar]')?.style.setProperty('width',Math.max(0,Math.min(100,totals.percent))+'%');
}
function applyExamRating(id,fraction,source){
 const safe=Math.max(0,Math.min(1,Number(fraction)||0));examSession.ratings[id]={fraction:safe,mode:'self'};
 const card=document.querySelector('[data-exam-review-item="'+CSS.escape(id)+'"]'),section=examScoringSection(id),exactMax=section&&typeof section.points==='number'&&section.itemIds.length===1?section.points:null;
 if(card){
  if(source!=='points'){const input=card.querySelector('[data-exam-points]');if(input)input.value=String(Math.round(safe*exactMax*10)/10)}
  if(source!=='percent'){const input=card.querySelector('[data-exam-percent]');if(input)input.value=String(Math.round(safe*100))}
  card.querySelectorAll('[data-exam-rate]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.examRate==='correct'&&safe===1)||(button.dataset.examRate==='wrong'&&safe===0))));
  const score=card.querySelector('[data-exam-item-score]');if(score)score.textContent=exactMax!==null?String(Math.round(safe*exactMax*10)/10)+' / '+exactMax+' '+(document.documentElement.lang==='de'?'Punkte':'points'):Math.round(safe*100)+'%';
  card.classList.toggle('is-rated',true);
 }
 const qs=qstate(id);qs.seen=true;if(safe===1)delete qs.review;else{qs.review=true;delete qs.learned}save();refreshChrome();renderCatalogIndex();renderTopicIndex();updateExamSummary();
}
function renderExamReview(){
 const result=document.querySelector('[data-exam-result]');result.hidden=false;
 result.innerHTML='<div class="exam-result-summary"><p class="eyebrow">'+esc(COPY.examFinished)+'</p><h3>'+esc(COPY.examReviewIntro)+'</h3><div class="exam-scoreboard"><strong data-exam-score></strong><span data-exam-score-percent></span><div><i data-exam-score-bar></i></div><p data-exam-score-status></p></div></div><div class="exam-review-list">'+examSession.itemIds.map((id,index)=>examReviewCard(byId.get(id),index)).join('')+'</div><button class="button button--primary" type="button" data-exam-restart>'+esc(COPY.restartExam)+'</button>';
 document.querySelectorAll('[data-exam-auto-score]').forEach(node=>node.closest('.exam-review-card')?.classList.add('is-rated'));
 updateExamSummary();
}
function finishExam(){if(!examSession.active||examSession.finished)return;saveExamDraft();if(examSession.timer)clearInterval(examSession.timer);examSession.finished=true;for(const id of examSession.itemIds){const item=byId.get(id),draft=examSession.drafts[id]||'',outcome=examCorrect(item,draft),qs=qstate(id);qs.seen=true;setDraft(qs,draft);if(outcome!==null){examSession.ratings[id]={fraction:outcome?1:0,mode:'auto'};if(outcome)delete qs.review;else{qs.review=true;delete qs.learned}}}save();const shell=document.querySelector('[data-exam-shell]');shell.classList.add('is-finished');document.querySelector('[data-exam-question]').replaceChildren();renderExamReview();refreshChrome();renderCatalogIndex();renderTopicIndex();announce(COPY.examFinished)}
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
 if(b.matches('[data-vocabulary-prev],[data-vocabulary-next]')){const deck=b.closest('[data-vocabulary-deck]'),track=deck?.querySelector('[data-vocabulary-track]'),card=track?.querySelector('.vocabulary-card');if(!track||!card)return;const gap=parseFloat(getComputedStyle(track).gap)||10,step=card.getBoundingClientRect().width+gap,direction=b.matches('[data-vocabulary-next]')?1:-1;track.scrollLeft=Math.max(0,Math.min(track.scrollWidth-track.clientWidth,track.scrollLeft+direction*step));return}
 if(b.matches('[data-clear-filters]')){setFilters({topic:'all',stage:'all',status:'all'});return}
 if(b.matches('[data-main-tab]')){selectMainView(b.dataset.mainTab);return}
 if(b.matches('[data-topic-open-catalog]')){selectMainView('catalog',true);setFilters({topic:topicSession.topicId},false);return}
 if(b.matches('[data-question-select]')){const index=catalogSession.itemIds.indexOf(b.dataset.questionSelect);if(index>=0){catalogSession.index=index;renderCatalog()}return}
 if(b.matches('[data-topic-question-select]')){const index=topicSession.itemIds.indexOf(b.dataset.topicQuestionSelect);if(index>=0){topicSession.index=index;renderTopicPractice()}return}
 if(b.matches('[data-session-prev],[data-session-next]')){const length=catalogSession.itemIds.length;if(!length)return;catalogSession.index=(catalogSession.index+(b.matches('[data-session-next]')?1:-1)+length)%length;renderCatalog();return}
 if(b.matches('[data-topic-prev],[data-topic-next]')){const length=topicSession.itemIds.length;if(!length)return;topicSession.index=(topicSession.index+(b.matches('[data-topic-next]')?1:-1)+length)%length;renderTopicPractice();return}
 if(b.matches('[data-start-assessment]')){startAssessment();return}
 if(b.matches('[data-exam-restart]')){startAssessment();return}
 if(b.matches('[data-exam-prev]')){saveExamDraft();examSession.index=Math.max(0,examSession.index-1);renderExam();return}
	 if(b.matches('[data-exam-next]')){saveExamDraft();if(examSession.index<examSession.itemIds.length-1)examSession.index+=1;renderExam();return}
 if(b.matches('[data-exam-finish]')){finishExam();return}
 if(b.matches('[data-exam-select]')){saveExamDraft();examSession.index=Number(b.dataset.examSelect);renderExam();return}
 if(b.matches('[data-exam-rate]')){const id=b.dataset.examRatingId;if(!id)return;const correct=b.dataset.examRate==='correct',card=b.closest('[data-exam-review-item]');card?.querySelectorAll('[data-exam-criterion]').forEach(input=>input.checked=correct);applyExamRating(id,correct?1:0,'quick');return}
 if(b.matches('[data-reset-all]')){if(confirm(COPY.resetConfirm)){localStorage.removeItem(KEY);state=empty();applyFilters(false);renderTopicPractice(false)}return}
 if(b.matches('[data-topic-tab]')){const id=b.dataset.topicTab;document.querySelectorAll('[data-sb-topic]').forEach(panel=>panel.hidden=panel.dataset.sbTopic!==id);document.querySelectorAll('[data-topic-tab]').forEach(tab=>{const active=tab.dataset.topicTab===id;tab.classList.toggle('is-active',active);tab.setAttribute('aria-selected',String(active))});setTopicSession(id,true,true);return}
 const card=b.closest('[data-learning-question-host] [data-sb-question-card]'),item=card&&byId.get(card.dataset.questionId);if(!card||!item)return;
 if(b.matches('[data-evaluate]')){evaluate(card,item);return}
 if(b.matches('[data-toggle-learned]')){toggle(item.id,'learned');return}
 if(b.matches('[data-toggle-review]')){toggle(item.id,'review');return}
 if(b.matches('[data-toggle-starred]')){toggle(item.id,'starred');return}
 if(b.matches('[data-reset-question]')){delete state.questions[item.id];save();applyFilters(false);renderTopicPractice(false);return}
});
document.querySelector('[data-catalog-filters]').addEventListener('change',event=>{const target=event.target;if(target.matches('[data-filter-topic]'))filters.topic=target.value;if(target.matches('[data-filter-stage]'))filters.stage=target.value;if(target.matches('[data-filter-status]'))filters.status=target.value;applyFilters(true)});
document.addEventListener('input',event=>{const target=event.target;if(target.matches?.('[data-exam-points],[data-exam-percent]')){const id=target.dataset.examRatingId;if(!id)return;const max=Number(target.max)||100,raw=Number(target.value);if(Number.isFinite(raw))applyExamRating(id,raw/max,target.matches('[data-exam-points]')?'points':'percent');return}const card=target.closest?.('[data-learning-question-host] [data-sb-question-card]'),item=card&&byId.get(card.dataset.questionId);if(!card||!item)return;const qs=qstate(item.id);qs.seen=true;setDraft(qs,readDraft(card,item));save()});
document.addEventListener('change',event=>{const target=event.target;if(target.matches?.('[data-exam-criterion]')){const id=target.dataset.examRatingId,card=target.closest('[data-exam-review-item]'),criteria=[...card.querySelectorAll('[data-exam-criterion]')];if(id&&criteria.length)applyExamRating(id,criteria.filter(input=>input.checked).length/criteria.length,'criteria');return}const card=target.closest?.('[data-learning-question-host] [data-sb-question-card]'),item=card&&byId.get(card.dataset.questionId);if(!card||!item)return;const qs=qstate(item.id);qs.seen=true;setDraft(qs,readDraft(card,item));save()});
renderCatalog(false);setTopicSession(firstTopicId,true,true);selectMainView('topics');
})();`;
}

function adaptiveCss(): string {
  return `
:root{
${studyBuddyCssTokenBlock()}
--ink:var(--sb-ink);--navy:var(--sb-navy);--blue:var(--sb-blue);--gold:var(--sb-gold);--cyan:var(--sb-cyan);--green:var(--sb-green);--red:var(--sb-red);--muted:var(--sb-muted);--line:var(--sb-line);--wash:var(--sb-soft);--paper:var(--sb-white);--soft:#eef2f8;--shadow:0 16px 44px rgba(25,37,75,.075);--radius:18px}
*{box-sizing:border-box}[hidden]{display:none!important}html{scroll-behavior:smooth;scroll-padding-top:88px}body{margin:0;background:var(--wash);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.56}button,input,textarea,select{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid rgba(57,127,147,.38);outline-offset:3px}.skip-link{position:fixed;top:-80px;left:12px;z-index:100;background:#fff;padding:12px 16px;border-radius:8px}.skip-link:focus{top:12px}.hotbar{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.96);border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}.hotbar-inner{height:72px;max-width:1240px;margin:auto;padding:9px 24px;display:flex;align-items:center;gap:18px}.brand{display:flex;align-items:center;gap:11px;min-width:0}.brand img{width:40px;height:40px;object-fit:contain}.brand strong,.brand span{display:block}.brand span{font-size:.78rem;color:var(--muted);max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.progress-summary{margin-left:auto;min-width:180px}.progress-summary span{font-size:.76rem;font-weight:750}.progress-track{height:5px;background:#e4e8f0;border-radius:99px;overflow:hidden}.progress-track i{display:block;height:100%;width:0;background:var(--green);transition:width .2s}.button{border:0;border-radius:10px;min-height:44px;padding:10px 15px;font-weight:800}.button--primary{background:var(--blue);color:#fff}.button--secondary{background:#e8edfc;color:var(--navy)}.button--quiet{background:transparent;color:var(--blue)}.eyebrow{margin:0 0 7px;color:var(--cyan);font-size:.68rem;letter-spacing:.115em;text-transform:uppercase;font-weight:900}
.course-hero{max-width:1192px;margin:34px auto 18px;display:grid;grid-template-columns:minmax(0,1.45fr) minmax(340px,.55fr);gap:18px;align-items:stretch}.hero-main{padding:36px 38px 32px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:var(--shadow)}.course-hero h1{font:700 clamp(2.7rem,5.2vw,4.9rem)/.98 Georgia,"Times New Roman",serif;letter-spacing:-.05em;margin:7px 0 15px;max-width:900px}.hero-copy{max-width:720px;color:#4f5870;font-size:1.04rem;margin:0}.coverage-note{max-width:850px;margin-top:20px;color:var(--muted);font-size:.83rem}.coverage-note summary{width:max-content;max-width:100%;color:var(--blue);font-weight:750;cursor:pointer}.coverage-note p{margin:8px 0 0;padding-left:15px;border-left:2px solid var(--line)}.learning-dial-panel{background:var(--navy);color:#fff;border-radius:22px;padding:24px;display:grid;grid-template-columns:158px minmax(0,1fr);align-items:center;gap:18px;box-shadow:0 18px 38px rgba(25,37,75,.16)}.progress-ring{--progress:0deg;position:relative;width:158px;aspect-ratio:1;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--gold) var(--progress),rgba(255,255,255,.14) 0);transition:background .2s}.progress-ring::before{content:"";position:absolute;inset:12px;border-radius:50%;background:var(--navy);border:1px solid rgba(255,255,255,.16)}.progress-ring>div{position:relative;text-align:center}.progress-ring strong,.progress-ring span{display:block}.progress-ring strong{font:700 2.15rem Georgia,"Times New Roman",serif}.progress-ring span{font-size:.69rem;color:#cfd8eb}.course-facts{margin:0;display:grid;gap:0}.course-facts div{padding:12px 2px;border-bottom:1px solid rgba(255,255,255,.16);display:flex;align-items:baseline;justify-content:space-between;gap:12px}.course-facts div:last-child{border-bottom:0}.course-facts dt{font-size:.72rem;color:#cfd8eb}.course-facts dd{margin:0;font:700 1.35rem Georgia,"Times New Roman",serif}
.main-tabs{max-width:1192px;margin:0 auto 28px;padding:7px;background:#fff;border:1px solid var(--line);border-radius:16px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;box-shadow:0 8px 26px rgba(25,37,75,.05)}.main-tab{min-height:78px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--muted);padding:10px 14px;text-align:left;display:grid;grid-template-columns:34px minmax(0,1fr);align-content:center;column-gap:10px}.main-tab>span{grid-row:1/3;font:700 1rem Georgia,"Times New Roman",serif;color:#98a3b7;padding-top:2px}.main-tab strong,.main-tab small{display:block}.main-tab strong{font-size:.93rem;color:var(--ink)}.main-tab small{font-size:.69rem}.main-tab.is-active{background:var(--navy);color:#d7deed;box-shadow:inset 0 3px var(--gold)}.main-tab.is-active>span{color:var(--gold)}.main-tab.is-active strong{color:#fff}
main{max-width:1192px;margin:auto;padding:0 0 80px}.main-panel[hidden],.topic-panel[hidden],.exam-shell[hidden]{display:none!important}.module-tabs{margin:0 0 38px;padding:7px;background:#fff;border:1px solid var(--line);border-radius:14px;display:flex;gap:5px;overflow-x:auto;overscroll-behavior-inline:contain;box-shadow:0 7px 22px rgba(25,37,75,.04)}.module-tabs[data-module-title-layout="rail"]{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,270px);justify-content:start;scroll-snap-type:x proximity}.module-tab{flex:1 0 145px;min-width:0;min-height:58px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--muted);padding:9px 11px;text-align:left;overflow-wrap:anywhere}.module-tabs[data-module-title-layout="rail"] .module-tab{min-height:76px;scroll-snap-align:start}.module-tab span,.module-tab strong{display:block}.module-tab span{font-size:.62rem}.module-tab strong{font-size:.86rem;line-height:1.32}.module-tab.is-active{background:var(--navy);color:#fff}.module-tab.is-active span{color:#cfd8eb}.topic-heading{display:flex;align-items:end;gap:14px;border-bottom:2px solid var(--navy);padding:0 2px 13px;margin-bottom:16px}.topic-heading>span{font:700 1.8rem Georgia,serif;color:#aab4c8}.topic-heading>div{min-width:0}.topic-heading h2,.section-heading h2,.assessment-card h2,.exam-header h2,.sources h2{font:700 clamp(1.75rem,3vw,2.65rem)/1.05 Georgia,"Times New Roman",serif;letter-spacing:-.025em;margin:0;overflow-wrap:anywhere}.module-source-title{margin-top:9px;max-width:760px;color:var(--muted);font-size:.74rem}.module-source-title summary{width:max-content;max-width:100%;cursor:pointer;color:var(--blue);font-weight:750}.module-source-title p{margin:7px 0 0;padding-left:11px;border-left:2px solid var(--line);overflow-wrap:anywhere}.topic-layout{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(340px,.65fr);gap:14px}.topic-layout--formula-heavy{grid-template-columns:1fr}.topic-layout--formula-heavy .concept-card{display:grid;grid-template-columns:minmax(250px,.8fr) minmax(0,1.2fr);column-gap:28px}.topic-layout--formula-heavy .concept-card>.eyebrow{grid-column:1/-1}.reading-card,.concept-card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:25px;min-width:0}.reading-card{box-shadow:var(--shadow)}.reading-card h3{font-size:1.35rem;margin:0 0 10px}.lead{font-family:Georgia,"Times New Roman",serif;font-size:1.05rem;line-height:1.73}.goal-box{margin-top:20px;padding:16px;background:var(--soft);border-radius:12px}.goal-box ul{margin:7px 0 0;padding-left:1.2rem}.concept-card ol{padding-left:1.25rem;margin-top:7px}.concept-card li{margin-bottom:9px}.formula-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:9px;min-width:0}.formula-grid figure{margin:0;padding:13px;background:#f7f9fd;border:1px solid #e2e7f0;border-radius:11px;min-width:0;overflow:hidden}.formula-grid .formula--wide{grid-column:1/-1}.math-scroll{display:block;width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;padding:4px 2px 8px;overscroll-behavior-inline:contain}.formula-grid math{display:block;width:max-content;max-width:none;font-size:clamp(.91rem,1.3vw,1.08rem)}.formula-grid figcaption{font-size:.72rem;color:var(--muted);overflow-wrap:anywhere}.vocabulary-deck{margin-top:14px;padding:20px;background:#edf7fa;border:1px solid #c8e0e7;border-radius:15px}.vocabulary-deck__heading{display:grid;grid-template-columns:1fr auto;align-items:end;gap:2px 16px}.vocabulary-deck__heading .eyebrow{grid-column:1}.vocabulary-deck__heading h3{margin:0}.vocabulary-deck__heading>span{grid-column:2;grid-row:1/3;align-self:center;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--navy);color:#fff;font-weight:900}.vocabulary-deck__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:8px;margin-top:15px}.vocabulary-deck__controls{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px}.vocabulary-deck__controls>small{color:var(--muted)}.vocabulary-deck__controls>div{display:flex;gap:7px}.vocabulary-deck__controls button{display:grid;place-items:center;width:44px;height:44px;border:1px solid #afc8d2;border-radius:50%;background:#fff;color:var(--navy);font-size:1.15rem}.vocabulary-deck__track{display:flex;gap:10px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x mandatory;scrollbar-width:thin;scrollbar-color:#9eb9c4 transparent;padding:4px 1px 10px;margin-top:8px}.vocabulary-deck--carousel .vocabulary-card{flex:0 0 calc((100% - 20px)/3);scroll-snap-align:start}.vocabulary-card{background:#fff;border:1px solid #c8d7df;border-radius:11px;min-width:0}.vocabulary-card summary{list-style:none;cursor:pointer;display:grid;gap:4px;padding:14px}.vocabulary-card summary::-webkit-details-marker{display:none}.vocabulary-card summary span{font:700 1.08rem Georgia,serif;overflow-wrap:anywhere}.vocabulary-card summary small,.vocabulary-card>div small{color:var(--muted)}.vocabulary-card>div{padding:0 14px 14px}.vocabulary-card>div p{font-size:.86rem}.worked-grid{margin-top:13px}.worked-example{background:#fff;border:1px solid var(--line);border-radius:13px}.worked-example summary{list-style:none;padding:16px 19px;display:flex;justify-content:space-between;align-items:center;gap:16px;cursor:pointer}.worked-example summary::-webkit-details-marker{display:none}.worked-example summary span small,.worked-example summary span{display:block}.worked-example summary small{color:var(--cyan);font-size:.63rem;text-transform:uppercase;letter-spacing:.1em}.worked-example summary b{font-size:.74rem;color:var(--blue)}.worked-example>div{padding:0 19px 19px}.worked-result{background:var(--soft);padding:12px;border-radius:9px}
.section-heading{display:flex;justify-content:space-between;align-items:end;gap:26px;margin-bottom:17px}.section-heading>p{max-width:460px;color:var(--muted);margin:0}.topic-practice{margin-top:52px;padding-top:34px;border-top:2px solid var(--navy)}.topic-question-strip{display:flex;gap:8px;overflow-x:auto;padding:1px 1px 11px;margin-bottom:3px}.topic-question-chip{flex:0 0 min(270px,76vw);min-height:72px;border:1px solid var(--line);border-radius:11px;background:#fff;padding:10px;display:grid;grid-template-columns:31px minmax(0,1fr);gap:8px;text-align:left;color:var(--ink)}.topic-question-chip>span:first-child{font:700 .78rem Georgia,serif;color:#8b96ab}.topic-question-chip strong,.topic-question-chip small{display:block}.topic-question-chip strong{font-size:.77rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.topic-question-chip small{font-size:.64rem;color:var(--muted);margin-top:4px}.topic-question-chip.is-active{border-color:var(--blue);background:#eef2fc;box-shadow:inset 4px 0 var(--blue)}.topic-focus,.focus-stage{background:#e8edf5;border-radius:14px;padding:14px;min-width:0}.catalog-shell{margin-top:0}.catalog-filters{display:grid;grid-template-columns:1.15fr 1fr 1fr auto;gap:9px;align-items:end;padding:15px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.catalog-filters label{display:grid;gap:5px}.catalog-filters label>span{font-size:.69rem;font-weight:850;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.catalog-filters select{width:100%;height:44px;border:1px solid #b8c2d1;border-radius:9px;background:#fff;padding:0 34px 0 11px;color:var(--ink)}.catalog-workspace{display:grid;grid-template-columns:minmax(250px,310px) minmax(0,1fr);gap:14px;margin-top:15px}.catalog-index{background:#fff;border:1px solid var(--line);border-radius:14px;min-width:0;overflow:hidden}.catalog-count{height:55px;padding:12px 14px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:6px}.catalog-count strong{font:700 1.35rem Georgia,serif}.catalog-count span{font-size:.75rem;color:var(--muted)}.question-index{display:grid;max-height:665px;overflow-y:auto}.question-index-item{width:100%;min-height:62px;border:0;border-bottom:1px solid var(--line);background:#fff;padding:9px 11px;display:grid;grid-template-columns:29px minmax(0,1fr);gap:8px;text-align:left;color:var(--ink)}.question-index-item>span:first-child{font:700 .78rem Georgia,serif;color:#8b96ab;padding-top:2px}.question-index-item strong,.question-index-item small{display:block}.question-index-item strong{font-size:.78rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.question-index-item small{margin-top:4px;color:var(--muted);font-size:.64rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.question-index-item.is-active{background:#eef2fc;box-shadow:inset 4px 0 var(--blue)}.focus-toolbar{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;gap:10px;margin-bottom:10px}.focus-toolbar>div{text-align:center}.focus-toolbar strong,.focus-toolbar span{display:block}.icon-button{width:44px;height:44px;border:1px solid var(--line);background:#fff;border-radius:10px;color:var(--blue);font-size:1.2rem}
.module-outline{margin:0 0 18px;padding:13px 17px;border-left:3px solid var(--gold);background:#fff}.module-outline>strong{font-size:.75rem;color:var(--blue);text-transform:uppercase;letter-spacing:.07em}.module-outline ol{columns:2;column-gap:28px;margin:9px 0 0;padding-left:1.3rem}.module-outline li{break-inside:avoid;margin:0 0 6px;line-height:1.42;color:var(--muted)}
.question-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:23px;min-width:0}.question-card.is-learned{border-color:#76bb9c}.question-card.is-review{border-color:#d39d75}.question-meta{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:.71rem}.question-meta>div{display:flex;gap:6px;flex-wrap:wrap}.question-number{font-weight:900;color:var(--blue)}.stage-chip,.origin-chip{border-radius:99px;padding:3px 8px;background:var(--soft)}.origin-chip{background:#fff5d8;color:#725411}.question-card h3{font-size:1.2rem;line-height:1.54;margin:17px 0;overflow-wrap:anywhere}.question-card math{max-width:100%}.math-expression{display:inline-flex;max-width:100%;flex-wrap:wrap;align-items:baseline;gap:.08em .3em;margin:.08em .12em;padding:.08em .25em;border-radius:.35em;background:rgba(50,58,97,.055);font-family:Georgia,"Times New Roman",serif;font-weight:500;vertical-align:baseline}.math-expression__operand,.math-expression__relation{display:inline-flex;align-items:baseline}.math-expression__relation{font-weight:700;color:var(--blue)}.math-expression math{font-size:1.04em}.assessment-task-visual{margin:0 0 18px;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:#f7f9fd}.learning-visual--module{margin-top:13px}.assessment-task-visual__canvas{display:grid;place-items:center;padding:14px;background:#fff}.assessment-task-visual img{display:block;width:auto;max-width:100%;height:auto;max-height:520px;object-fit:contain}.assessment-task-visual figcaption{display:flex;justify-content:space-between;gap:12px;padding:9px 12px;font-size:.68rem;color:var(--muted)}.assessment-task-visual figcaption strong{color:var(--blue)}.givens,.instructions{padding-left:1.2rem}.answer-options{border:0;padding:0;margin:0 0 14px;display:grid;gap:8px}.answer-options label{display:grid;grid-template-columns:auto 28px minmax(0,1fr);align-items:start;gap:9px;border:1px solid var(--line);border-radius:10px;padding:11px}.answer-options label:has(input:checked){border-color:var(--blue);background:#f4f6ff}.answer-options input{margin-top:7px}.answer-options label>span{display:grid;place-items:center;width:28px;height:28px;background:var(--soft);border-radius:7px;font-size:.75rem}.answer-options label b{font-weight:600;min-width:0;overflow-wrap:anywhere}.answer-field{display:grid;gap:7px;margin-bottom:10px}.answer-field>span{font-size:.7rem;font-weight:900;color:var(--blue);text-transform:uppercase;letter-spacing:.08em}.answer-field input,.answer-field textarea{width:100%;border:1px solid #b9c3d2;border-radius:10px;padding:12px;background:#fff}.method-hint{margin-top:12px}.question-feedback{margin-top:16px;padding:15px;border-radius:11px;background:var(--soft);overflow-wrap:anywhere}.question-feedback.is-good{background:#eaf7f1;color:#145b42}.question-feedback.is-bad{background:#fff0ed;color:#8c2a22}.question-controls{display:flex;gap:7px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:18px;padding-top:14px}.question-controls button{min-height:44px;border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 11px;color:var(--blue)}.question-controls button[aria-pressed="true"]{background:var(--blue);color:#fff;border-color:var(--blue)}.scope-note{font-size:.71rem;color:var(--muted);margin:14px 0 0;overflow-wrap:anywhere}.empty-pool{text-align:center;padding:70px 20px}
.assessment-card{margin-top:0;background:#fff;border:1px solid var(--line);border-radius:18px;padding:27px;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);gap:32px}.assessment-copy>p{max-width:690px}.assessment-facts{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.assessment-facts span{border-left:3px solid var(--gold);padding:6px 11px;background:var(--soft)}.assessment-facts strong{display:block}.assessment-limitations{margin:16px 0}.assessment-sections{list-style:none;margin:0;padding:0;display:grid;gap:7px}.assessment-sections li{display:grid;grid-template-columns:34px 1fr;gap:9px;padding:12px;border-bottom:1px solid var(--line)}.assessment-sections li>span{font:700 1.1rem Georgia,serif;color:var(--gold)}.assessment-sections strong,.assessment-sections small{display:block}.assessment-sections small{color:var(--muted)}.assessment-sections .assessment-section--external{background:#f6f7fa;border:1px dashed #c5ccda;border-radius:10px}.assessment-sections .assessment-section--external>span{color:var(--muted)}
.reference-solution{line-height:1.58}.reference-solution__heading{display:flex;justify-content:space-between;gap:12px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:9px}.reference-solution__heading>strong{font:700 1.2rem Georgia,serif}.reference-solution__heading>span{font-size:.68rem;color:var(--muted);text-align:right}.reference-solution__summary{font-weight:650}.reference-solution__steps{display:grid;gap:9px;padding-left:1.35rem;min-width:0;max-width:100%}.reference-solution__steps>li{min-width:0;max-width:100%;overflow-wrap:anywhere}.reference-solution__result{border-left:3px solid var(--gold);padding:10px 13px;background:#fff8df}.reference-solution__result>strong{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--blue)}.reference-solution__result p{margin:5px 0 0}.reference-solution__assumptions{margin-top:12px}.reference-solution__assumptions summary{cursor:pointer;font-weight:700}.reference-solution__basis{font-size:.72rem;color:var(--muted)}
.exam-shell{margin-top:18px;background:#fff;border:2px solid var(--navy);border-radius:18px;padding:24px}.exam-header{display:flex;justify-content:space-between;gap:20px;align-items:start}.exam-timing{min-width:105px;text-align:right}.exam-timing strong,.exam-timing span{display:block}.exam-timing strong{font:700 1.6rem Georgia,serif}.exam-timing span{font-size:.68rem;color:var(--muted)}.exam-progress{height:5px;background:#e4e8f0;margin:18px 0;border-radius:99px;overflow:hidden}.exam-progress i{display:block;width:0;height:100%;background:var(--gold);transition:width .2s}.exam-navigation{display:flex;gap:6px;overflow-x:auto;margin-bottom:13px}.exam-navigation button{flex:0 0 44px;height:44px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--navy)}.exam-navigation button.is-active{background:var(--navy);color:#fff}.exam-question .question-card{border-radius:11px}.exam-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:13px}.exam-actions [hidden]{display:none!important}.exam-result{padding:0;background:transparent}.exam-result-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.42fr);gap:22px;align-items:end;padding:24px;background:var(--navy);color:#fff;border-radius:13px}.exam-result-summary>.eyebrow{grid-column:1/-1;color:#a9d8e8;margin-bottom:-14px}.exam-result-summary h3{font:700 clamp(1.35rem,2.5vw,2rem)/1.16 Georgia,serif;margin:0;max-width:680px}.exam-scoreboard{display:grid;grid-template-columns:1fr auto;gap:4px 14px;align-items:end}.exam-scoreboard>strong{font:700 1.35rem Georgia,serif}.exam-scoreboard>span{font:700 1.1rem Georgia,serif;color:#ffd25c}.exam-scoreboard>div{grid-column:1/-1;height:6px;background:rgba(255,255,255,.18);border-radius:99px;overflow:hidden}.exam-scoreboard i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}.exam-scoreboard p{grid-column:1/-1;margin:3px 0 0;font-size:.76rem;color:#d7ddec}.exam-review-list{display:grid;gap:14px;margin:16px 0}.exam-review-card{border:1px solid var(--line);border-left:4px solid #c7cfdd;border-radius:12px;padding:20px;background:#fff;min-width:0}.exam-review-card.is-rated{border-left-color:var(--gold)}.exam-review-card>header{display:grid;grid-template-columns:38px 1fr;gap:10px;align-items:start}.exam-review-card>header>span{font:700 1.2rem Georgia,serif;color:var(--gold)}.exam-review-card h4{font-size:1.04rem;line-height:1.42;margin:2px 0 0}.exam-review-card header small{color:var(--muted)}.exam-comparison{display:grid;grid-template-columns:minmax(240px,.7fr) minmax(0,1.3fr);gap:14px;margin:16px 0}.exam-draft-review,.exam-solution{min-width:0;border-radius:10px;padding:15px}.exam-draft-review{background:#f7f9fd;border:1px solid #e2e7f0}.exam-draft-review>strong{display:block;font-size:.76rem;margin-bottom:7px}.exam-draft-review pre{font:inherit;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.exam-solution{background:#fffdf5;border:1px solid #eadca8}.exam-solution>div{line-height:1.55}.exam-solution ol,.exam-solution ul{padding-left:1.25rem}.exam-self-assessment{margin-top:14px;border-top:1px solid var(--line);padding-top:4px}.exam-self-assessment>summary,.exam-criteria-details>summary{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;color:var(--blue);list-style:none}.exam-self-assessment>summary::-webkit-details-marker,.exam-criteria-details>summary::-webkit-details-marker{display:none}.exam-self-assessment>summary{font-weight:800}.disclosure-icon{font-style:normal;font-size:1.25rem;line-height:1;transition:transform .16s ease}.exam-self-assessment[open]>summary .disclosure-icon,.exam-criteria-details[open]>summary .disclosure-icon{transform:rotate(180deg)}.exam-rating-controls{padding-top:8px}.exam-criteria-details{margin-top:13px;border-top:1px solid #edf0f5;padding-top:10px}.exam-criteria-details>summary{font-weight:700}.exam-criteria-details>summary small{color:var(--muted);font-weight:500}.exam-detailed-scoring{display:grid;gap:9px;padding-top:11px;max-width:760px}.exam-criteria{border:0;padding:3px 0 0;margin:0}.exam-criteria label{display:grid;grid-template-columns:22px 1fr;gap:9px;padding:8px 0;border-bottom:1px solid #edf0f5}.exam-criteria input{width:18px;height:18px;margin-top:2px}.exam-rating-row{display:flex;justify-content:space-between;align-items:end;gap:14px;flex-wrap:wrap}.exam-rating-buttons{display:flex;gap:8px;flex-wrap:wrap}.exam-rating-buttons [aria-pressed=true]{outline:3px solid rgba(234,183,30,.28);border-color:var(--gold)}.exam-score-input{display:grid;gap:5px;min-width:190px;max-width:280px}.exam-score-input span{font-size:.72rem;font-weight:700}.exam-score-input input{min-height:44px;width:100%;border:1px solid var(--line);border-radius:9px;padding:8px 10px;font:inherit}.exam-item-score,.exam-auto-score{margin:4px 0 0;font-weight:700}.exam-item-score{color:var(--blue)}.exam-auto-score{padding:10px 12px;background:var(--soft);border-radius:8px}.exam-result>.button{margin-top:4px}.exam-shell.is-finished .exam-actions,.exam-shell.is-finished .exam-navigation,.exam-shell.is-finished .exam-progress{display:none}
.math-expression{display:inline;max-width:100%;margin:.08em .12em;padding:.08em 0;border-radius:.35em;background:rgba(50,58,97,.055);box-decoration-break:clone;-webkit-box-decoration-break:clone;font-family:Georgia,"Times New Roman",serif;font-weight:500;vertical-align:baseline}.math-expression__operand,.math-expression__relation{display:inline-flex;max-width:100%;align-items:baseline;margin:0 .12em;vertical-align:baseline}.math-expression__relation{font-weight:700;color:var(--blue)}.math-expression math{font-size:clamp(.94em,1.2vw,1.04em)}
.reference-solution .math-expression,.exam-solution .math-expression,.question-feedback .math-expression{display:block;width:fit-content;max-width:100%;margin:.34em 0;padding:.1em .16em;overflow-wrap:anywhere}
.exam-solution>div,.exam-solution ol,.exam-solution ul,.exam-solution li{min-width:0;max-width:100%}.exam-solution li{overflow-wrap:anywhere}
.sources{background:#fff;border-top:3px solid var(--navy);padding:48px 24px 68px}.sources-inner{max-width:1192px;margin:auto}.source-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:18px}.source-card{border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0}.source-card strong,.source-card p,.source-card a{overflow-wrap:anywhere;word-break:break-word}.source-card p{color:var(--muted);font-size:.8rem}.source-card a{color:var(--blue);font-weight:800;font-size:.77rem}.sr-only,.sr-live{position:fixed;left:-9999px}.question-templates{display:none}
main,.module-tabs{min-width:0}.module-tabs{width:100%;max-width:100%}.module-tab,.module-tab strong{min-width:0;max-width:100%;overflow-wrap:anywhere}
@media(min-width:761px) and (max-width:1230px){.course-hero,.main-tabs,main{max-width:calc(100% - 36px)}}
@media(max-width:1230px){.course-hero,.main-tabs,main{margin-left:18px;margin-right:18px}.topic-layout{grid-template-columns:minmax(0,1.2fr) minmax(330px,.8fr)}}
@media(max-width:1080px){.course-hero{grid-template-columns:minmax(0,1.25fr) minmax(310px,.75fr)}.learning-dial-panel{grid-template-columns:126px minmax(0,1fr)}.progress-ring{width:126px}}
@media(max-width:1100px){.topic-layout,.topic-layout--formula-heavy{grid-template-columns:1fr}.topic-layout--formula-heavy .concept-card{display:block}.exam-comparison{grid-template-columns:1fr}}
@media(max-width:980px){.course-hero{grid-template-columns:1fr}.learning-dial-panel{grid-template-columns:145px minmax(0,1fr)}.progress-ring{width:145px}.topic-layout,.topic-layout--formula-heavy,.assessment-card{grid-template-columns:1fr}.topic-layout--formula-heavy .concept-card{display:block}.vocabulary-deck--carousel .vocabulary-card{flex-basis:calc((100% - 10px)/2)}.catalog-workspace{grid-template-columns:minmax(220px,270px) minmax(0,1fr)}.catalog-filters{grid-template-columns:1fr 1fr 1fr}.catalog-filters .button{grid-column:1/-1;justify-self:start}}
@media(max-width:760px){html{scroll-padding-top:72px}.hotbar-inner{height:66px;padding:8px 12px}.brand img{width:35px;height:35px}.brand span,.progress-summary{display:none}.hotbar .button--quiet{margin-left:auto;padding:8px;font-size:.72rem}.course-hero{margin:18px 13px 10px}.hero-main{padding:26px 20px 23px}.course-hero h1{font-size:2.55rem}.learning-dial-panel{grid-template-columns:112px minmax(0,1fr);padding:18px}.progress-ring{width:112px}.progress-ring::before{inset:9px}.progress-ring strong{font-size:1.65rem}.main-tabs{margin:0 13px 22px;padding:5px;gap:4px}.main-tab{min-height:64px;padding:8px 6px;grid-template-columns:1fr;text-align:center}.main-tab>span{grid-row:auto;font-size:.7rem;padding:0}.main-tab strong{font-size:.76rem}.main-tab small{display:none}.module-tabs{margin:0 0 28px}.module-tabs[data-module-title-layout="rail"]{grid-auto-columns:min(78vw,270px)}.module-tab{flex-basis:142px}main{margin:0;padding:0 13px 62px}.topic-heading{align-items:flex-start}.module-outline ol{columns:1}.reading-card,.concept-card{padding:17px}.formula-grid{grid-template-columns:1fr}.vocabulary-deck{padding:16px}.vocabulary-deck__controls>small{max-width:180px}.vocabulary-deck--carousel .vocabulary-card{flex-basis:min(82vw,340px)}.worked-example summary{align-items:flex-start}.worked-example summary b{white-space:nowrap}.section-heading{display:block}.section-heading>p{margin-top:10px}.section-heading .button{margin-top:12px}.topic-practice{margin-top:38px;padding-top:26px}.topic-focus,.focus-stage{padding:9px}.catalog-filters{grid-template-columns:1fr}.catalog-filters .button{grid-column:auto}.catalog-workspace{grid-template-columns:1fr}.question-index{max-height:255px}.question-card{padding:16px}.assessment-task-visual__canvas{padding:9px}.assessment-task-visual img{width:auto;max-width:100%;max-height:430px}.assessment-task-visual figcaption{display:grid}.question-controls{display:grid;grid-template-columns:1fr 1fr}.question-controls button{width:100%}.assessment-card,.exam-shell{padding:17px}.exam-header{display:block}.exam-timing{text-align:left;margin-top:10px}.exam-actions{display:grid;grid-template-columns:1fr}.exam-actions .button{width:100%}.exam-result-summary{grid-template-columns:1fr;padding:18px}.exam-result-summary>.eyebrow{margin-bottom:-8px}.exam-review-card{padding:15px}.exam-review-card>header{grid-template-columns:30px 1fr}.exam-comparison{grid-template-columns:1fr}.reference-solution__heading{display:grid}.reference-solution__heading>span{text-align:left}.exam-rating-row,.exam-rating-buttons{display:grid;grid-template-columns:1fr;width:100%}.exam-rating-buttons .button,.exam-score-input{width:100%}.source-grid{grid-template-columns:1fr}.sources{padding-left:13px;padding-right:13px}}
@media(max-width:420px){.course-hero h1{font-size:2.25rem}.topic-heading h2{font-size:1.6rem}.question-controls{grid-template-columns:1fr}.answer-options label{grid-template-columns:auto 26px minmax(0,1fr)}.question-meta{display:block}.question-meta>span{display:block;margin-top:6px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
