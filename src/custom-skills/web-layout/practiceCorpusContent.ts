import type { JsonObject } from "./state.js";
import type { StudyGuideContent } from "./studyGuideContent.js";

const TOPICS = [
  ["folgen", "Folgen und Reihen", "Rekursive und explizite Folgen, Beschränktheit und Grenzwerte", "a_n = f(a_{n-1})"],
  ["grenzwerte", "Grenzwerte und Stetigkeit", "Einseitige Grenzwerte, Asymptotik und Stetigkeitskriterien", "lim_{x→x_0} f(x)"],
  ["ableitungen", "Ableitungsregeln", "Produkt-, Quotienten- und Kettenregel sicher auswählen", "(f·g)' = f'·g + f·g'"],
  ["taylor", "Taylorpolynome", "Lokale Approximation an einer Entwicklungsstelle", "T_n(x) = Σ f^(k)(x_0)/k! · (x-x_0)^k"],
  ["kurvendiskussion", "Funktionsuntersuchung", "Monotonie, Krümmung und Extremstellen aus Ableitungen", "f'(x)=0; f''(x)≷0"],
  ["stammfunktionen", "Stammfunktionen", "Unbestimmte Integrale, Linearität und Integrationskonstante", "∫ f(x) dx = F(x)+C"],
  ["bestimmte-integrale", "Bestimmte Integrale und Flächen", "Hauptsatz, Orientierung und geometrischer Flächeninhalt", "∫_a^b f(x) dx = F(b)-F(a)"],
  ["uneigentliche-integrale", "Uneigentliche Integrale", "Singuläre Grenzen als Grenzwerte untersuchen", "∫_a^∞ f(x) dx = lim_{b→∞} ∫_a^b f(x) dx"],
  ["dgl-grundlagen", "Grundlagen der Differentialgleichungen", "Ordnung, Lösungsfamilie und Anfangsbedingungen unterscheiden", "y' = f(t,y)"],
  ["dgl-erster-ordnung", "Differentialgleichungen erster Ordnung", "Lineare und separierbare Gleichungen sowie Anfangswertprobleme", "y' = a(t)y+b(t)"],
  ["dgl-zweiter-ordnung", "Differentialgleichungen zweiter Ordnung", "Charakteristische Gleichung und Anfangsbedingungen", "ay''+by'+cy=g(t)"],
] as const;

const THEORY_OVERRIDES: Record<string, {
  learningGoals: string[];
  summary: string;
  keyIdeas: string[];
  formulas: Array<{ expression: string; meaning: string }>;
  retrieval: { prompt: string; answer: string };
}> = {
  folgen: {
    learningGoals: [
      "Folgen als nummerierte Wertelisten lesen und zwischen expliziter und rekursiver Beschreibung wechseln",
      "Aus den ersten Gliedern ein plausibles Bildungsgesetz erkennen und mit mehreren Folgengliedern prüfen",
      "Beschränktheit, Monotonie und Grenzverhalten als getrennte Eigenschaften untersuchen",
    ],
    summary: "Eine Folge ist keine gewöhnliche Funktion mit beliebigen reellen Eingaben, sondern eine geordnete Liste von Zahlen. Der Index n sagt, an welcher Stelle wir stehen. Bei einer expliziten Vorschrift lässt sich a_n direkt aus n berechnen. Eine rekursive Vorschrift erklärt dagegen, wie aus einem bekannten Glied das nächste entsteht; dafür braucht sie immer einen Startwert. Beim Erkennen eines Musters reicht es nicht, nur den ersten Übergang zu prüfen: Das vermutete Gesetz muss mehrere aufeinanderfolgende Glieder korrekt erzeugen.",
    keyIdeas: [
      "Explizit bedeutet Direktzugriff: Setze n ein und erhalte a_n, ohne frühere Glieder auszurechnen.",
      "Rekursiv bedeutet Fortschreiben: Startwert und Übergangsregel gehören untrennbar zusammen.",
      "Monotonie beschreibt die Richtung der Folge; Beschränktheit verhindert ein unbegrenztes Ausbrechen. Erst gemeinsam können beide Eigenschaften Konvergenz sichern.",
      "Eine Reihe entsteht, wenn Folgenglieder addiert werden. Folge und Reihe sind daher unterschiedliche Objekte und brauchen unterschiedliche Grenzwerttests.",
    ],
    formulas: [
      { expression: "a_n = f(n)", meaning: "Explizite Darstellung: Das n-te Glied wird direkt berechnet." },
      { expression: "a_n = q · a_{n−1}, a_1 = c", meaning: "Rekursive geometrische Folge mit Startwert c und Quotient q." },
      { expression: "s_n = Σ_{k=1}^n a_k", meaning: "Die n-te Partialsumme addiert die ersten n Folgenglieder." },
    ],
    retrieval: {
      prompt: "Woran erkennst du, ob eine Folgenvorschrift vollständig angegeben ist?",
      answer: "Eine explizite Vorschrift braucht einen gültigen Definitionsbereich für n. Eine rekursive Vorschrift braucht zusätzlich mindestens einen Startwert und eine Regel, die alle benötigten Vorgänger abdeckt.",
    },
  },
  grenzwerte: {
    learningGoals: [
      "Grenzwerte als Annäherungsverhalten statt als bloßes Einsetzen verstehen",
      "Links- und Rechtsgrenzwert getrennt prüfen und daraus Stetigkeit beurteilen",
      "Unbestimmte Formen erkennen und erst danach eine passende Umformung wählen",
    ],
    summary: "Ein Grenzwert beschreibt, welchem Wert sich eine Funktion nähert, wenn x an eine Stelle oder ins Unendliche läuft. Dieser Zielwert muss nicht mit dem tatsächlichen Funktionswert übereinstimmen und die Funktion muss an der Stelle nicht einmal definiert sein. Für innere Stellen existiert der Grenzwert nur dann, wenn die Annäherung von links und von rechts zum selben Wert führt. Direktes Einsetzen ist deshalb eine schnelle Probe, aber keine universelle Methode: Entsteht etwa 0/0, muss der Ausdruck zuerst faktorisiert, gekürzt, rationalisiert oder mit einer geeigneten Grenzwertregel behandelt werden.",
    keyIdeas: [
      "Der Grenzwert fragt nach der Umgebung einer Stelle; der Funktionswert fragt nach der Stelle selbst.",
      "Unterschiedliche einseitige Grenzwerte bedeuten eine Sprungstelle und schließen einen zweiseitigen Grenzwert aus.",
      "Stetigkeit in x_0 verlangt drei Dinge: f(x_0) ist definiert, der Grenzwert existiert und beide Werte stimmen überein.",
      "Bei x → ∞ entscheidet der dominante Term. Teile Zähler und Nenner durch die höchste relevante Potenz, bevor du vergleichst.",
    ],
    formulas: [
      { expression: "lim_{x→x_0−} f(x) = lim_{x→x_0+} f(x)", meaning: "Nur bei gleichem Links- und Rechtsgrenzwert existiert der zweiseitige Grenzwert." },
      { expression: "lim_{x→x_0} f(x) = f(x_0)", meaning: "Zusammen mit der Existenz beider Seiten ist dies das Stetigkeitskriterium." },
      { expression: "lim_{x→∞} (a_n x^n)/(b_m x^m)", meaning: "Für rationale Funktionen entscheidet der Vergleich der höchsten Potenzen." },
    ],
    retrieval: {
      prompt: "Welche drei Prüfungen brauchst du für Stetigkeit in x_0?",
      answer: "Prüfe zuerst, ob f(x_0) definiert ist. Bestimme dann Links- und Rechtsgrenzwert. Sind beide gleich und stimmen zusätzlich mit f(x_0) überein, ist die Funktion dort stetig.",
    },
  },
  ableitungen: {
    learningGoals: [
      "Die Ableitung gleichzeitig als lokale Steigung und momentane Änderungsrate deuten",
      "Produkt-, Quotienten- und Kettenregel anhand der äußeren Struktur auswählen",
      "Ein Ergebnis durch Strukturprüfung oder punktweises Einsetzen plausibilisieren",
    ],
    summary: "Die Ableitung f′(x) misst, wie empfindlich sich der Funktionswert bei einer kleinen Änderung von x verändert. Geometrisch ist sie die Steigung der Tangente, in Anwendungen eine momentane Rate wie Geschwindigkeit, Wachstum oder Kostenänderung. Beim Ableiten entscheidet nicht das Aussehen einzelner Terme, sondern die äußerste Verknüpfung: Ein Produkt verlangt die Produktregel, ein Quotient die Quotientenregel und eine verschachtelte Funktion die Kettenregel. Oft werden mehrere Regeln nacheinander benötigt; deshalb hilft es, die Funktion vor dem Rechnen in äußere und innere Bausteine zu zerlegen.",
    keyIdeas: [
      "Markiere zuerst die äußerste Rechenoperation. Sie bestimmt die erste Ableitungsregel.",
      "Bei der Kettenregel wird die äußere Funktion abgeleitet und mit der Ableitung der inneren Funktion multipliziert.",
      "Die Produktregel besteht aus zwei Summanden. Nur beide Faktoren einzeln abzuleiten und anschließend zu multiplizieren ist falsch.",
      "Eine schnelle Kontrolle liefert die Einheit: Die Einheit von f′ ist immer Einheit von f pro Einheit von x.",
    ],
    formulas: [
      { expression: "f′(x) = lim_{h→0} (f(x+h)−f(x))/h", meaning: "Definition der Ableitung als Grenzwert des Differenzenquotienten." },
      { expression: "(f · g)′ = f′ · g + f · g′", meaning: "Produktregel: Jeder Faktor wird einmal abgeleitet." },
      { expression: "(f ∘ g)′(x) = f′(g(x)) · g′(x)", meaning: "Kettenregel für eine äußere Funktion f und eine innere Funktion g." },
    ],
    retrieval: {
      prompt: "Wie entscheidest du bei einer komplizierten Funktion, welche Ableitungsregel zuerst kommt?",
      answer: "Suche die äußerste Verknüpfung der gesamten Funktion. Beginnt die Struktur als Produkt, Quotient oder Verkettung, wendest du die entsprechende Regel zuerst an und bearbeitest danach die inneren Teile.",
    },
  },
};

const TASK_START = /^\s*(\d{1,2})\.\s+(Single Choice|Multiple Choice|Wahr\/Falsch|Wahr oder Falsch\??|Numerische Eingabe|Drag and Drop(?: auf (?:Bild|Text|Tabelle))?|Drop ?down Auswahl|Dropdown[^:\n]*|Multiple Choice oder Numerische Eingabe)\s*:?/gmi;

export function buildContentFromPracticeCorpus(sourceText: string, layoutSpec: JsonObject): StudyGuideContent | null {
  const corpusIndex = sourceText.indexOf("## Full extracted practice corpus");
  if (corpusIndex < 0) return null;
  const corpus = sourceText.slice(corpusIndex);
  const fileHeader = /^### Practice source: (.+)$/gm;
  const files = [...corpus.matchAll(fileHeader)];
  if (files.length < 5) return null;

  const byMinitest = new Map<number, ReturnType<typeof parsePracticeFile>>();
  const sourceUrls = extractedSourceUrls(sourceText);
  for (let index = 0; index < files.length; index += 1) {
    const filename = files[index][1].trim();
    const minitest = Number(/Minitest-(\d+)/i.exec(filename)?.[1]);
    if (!Number.isFinite(minitest)) continue;
    const start = (files[index].index ?? 0) + files[index][0].length;
    const end = files[index + 1]?.index ?? corpus.length;
    byMinitest.set(minitest, parsePracticeFile(corpus.slice(start, end), minitest).map(repairPracticeTask).filter(isReadablePracticeTask));
  }

  const topics = TOPICS.map(([id, title, focus, formula], index) => {
    const minitest = index < 8 ? index + 1 : index === 9 ? 10 : null;
    const parsed = minitest ? byMinitest.get(minitest) ?? [] : derivedOdeTasks(index === 8 ? 1 : 2);
    const curated = curatedCalculations(id, title);
    const exercises = [...parsed, ...curated, ...curatedConceptChecks(id, title)];
    const exampleTask = exercises.find((exercise) => exercise.type === "calculation") ?? exercises[0];
    const exampleSteps = exampleTask.type === "calculation"
      ? exampleTask.steps
      : exampleTask.type === "cross"
        ? ["Aufgabentyp und Bedingungen identifizieren.", exampleTask.explanation]
        : exampleTask.type === "application"
          ? exampleTask.instructions
          : ["Begriff im Kurskontext identifizieren.", exampleTask.explanation];
    const theoryOverride = THEORY_OVERRIDES[id];
    return {
      id,
      title,
      learningGoals: theoryOverride?.learningGoals ?? [focus, "Typische Fehlentscheidungen anhand konkreter Moodle-Aufgaben diagnostizieren"],
      theory: {
        summary: theoryOverride?.summary ?? `${focus}. In diesem Kapitel wird zuerst die mathematische Struktur erkannt, dann die passende Regel ausgewählt und das Ergebnis durch Definition, Ableitung oder Einsetzen kontrolliert. Die Aufgaben stammen aus den verfügbaren MAES2-Minitest-Lösungen; abgeleitete Ergänzungen sind ausdrücklich markiert.`,
        keyIdeas: theoryOverride?.keyIdeas ?? ["Voraussetzungen vor dem Rechnen prüfen", "Jeden Umformungsschritt begründen", "Ergebnis mit einer unabhängigen Kontrolle absichern"],
        formulas: theoryOverride?.formulas ?? [{ expression: formula, meaning: `Leitformel für ${title}` }],
      },
      workedExamples: [{
        title: `Quellenbeispiel: ${exampleTask.source.sourceTask}`,
        prompt: exampleTask.prompt,
        steps: exampleSteps.length >= 2 ? exampleSteps : [exampleSteps[0] ?? "Aufgabe analysieren.", "Ergebnis kontrollieren."],
        answer: exampleTask.type === "calculation"
          ? exampleTask.steps.at(-1) ?? "Siehe Quellenlösung."
          : exampleTask.type === "cross"
            ? exampleTask.explanation
            : exampleTask.type === "application"
              ? exampleTask.sampleAnswer
              : exampleTask.acceptedAnswers.join(" / "),
        source: exampleTask.source,
      }],
      exercises,
      retrieval: [theoryOverride?.retrieval ?? { prompt: `Welche Kontrolle ist bei „${title}“ besonders wichtig?`, answer: `Prüfe Voraussetzungen, Rechenweg und Ergebnis passend zu ${focus.toLowerCase()}.` }],
    };
  });

  const courseTitle = typeof layoutSpec.title === "string" ? layoutSpec.title.replace(/^MAES2\s*[–-]\s*/i, "") : "MAES2 – Mathematik für Engineering Science 2";
  return {
    courseTitle,
    courseCode: "MAES2",
    scopeNote: "Qualitätsgeprüfte Trainingsbank aus den zugänglichen Minitest-Lösungen 1–8 und 10. Mathematisch beschädigte PDF-OCR-Aufgaben werden ausgeschlossen, solange keine visuell verifizierte Rekonstruktion vorliegt; strukturierte Rechenübungen sind als abgeleitet gekennzeichnet. Minitest 9 war nicht abrufbar, Minitest 11 wurde nicht erworben. Übungspunkte sind keine offizielle Prüfungsbewertung.",
    topics,
    sources: [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 10].map((number) => ({ id: `mt${number}`, label: `Minitest ${number} – Lösungen`, url: sourceUrls.get(`t${number}`) ?? "", coverage: `Konkrete Aufgaben und Lösungen für Thema ${number}` })),
      { id: "ode", label: "Ernst Graf: Skriptum Differentialgleichungen", url: sourceUrls.get("ode") ?? "", coverage: "Abgeleitete Ergänzungen für DGL-Grundlagen" },
      { id: "ode2", label: "Ernst Graf: DGL 2. Ordnung mit konstanten Koeffizienten", url: sourceUrls.get("ode2") ?? "", coverage: "Abgeleitete Ergänzungen für DGL zweiter Ordnung" },
    ],
  };
}

function extractedSourceUrls(sourceText: string): Map<string, string> {
  const urls = new Map<string, string>();
  const marker = sourceText.indexOf("## Extracted data");
  if (marker < 0) return urls;
  const jsonStart = sourceText.indexOf("{", marker);
  const nextSection = sourceText.indexOf("\n## ", jsonStart + 1);
  if (jsonStart < 0) return urls;
  try {
    const handoff = JSON.parse(sourceText.slice(jsonStart, nextSection < 0 ? undefined : nextSection).trim()) as {
      sources?: Array<{ id?: unknown; url?: unknown }>;
    };
    for (const source of handoff.sources ?? []) {
      if (typeof source.id !== "string" || typeof source.url !== "string") continue;
      if (!/^https:\/\/moodle\.technikum-wien\.at\/(?:course|mod)\//i.test(source.url)) continue;
      urls.set(source.id, source.url);
    }
  } catch {
    return urls;
  }
  return urls;
}

function parsePracticeFile(text: string, minitest: number) {
  const withPages = text.replace(/\f/g, "\n");
  const metadataIndex = withPages.search(/^\s*---\s*#\s*(?:Local Moodle artifact root|Approved local image assets)/im);
  const normalized = metadataIndex >= 0 ? withPages.slice(0, metadataIndex) : withPages;
  const matches = [...normalized.matchAll(TASK_START)];
  return matches.map((match, index) => {
    const number = Number(match[1]);
    const sourceTask = `Minitest ${minitest}, Aufgabe ${number}`;
    const body = normalized.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? normalized.length);
    const solutionIndex = body.search(/(?:^|\n)\s*(?:(?:Die )?Lösung(?:en)?\s+(?:ist|sind)|Lösung:)/i);
    const taskWithoutSolution = solutionIndex >= 0 ? body.slice(0, solutionIndex) : body;
    const solutionText = cleanText(solutionIndex >= 0 ? body.slice(solutionIndex) : "Quellenlösung im Minitest nachschlagen.", 1800);
    const kind = match[2];
    const labels = correctLabels(solutionText);
    const optionMatches = parseOptions(taskWithoutSolution);
    const optionStart = firstOptionHeadingIndex(taskWithoutSolution);
    const promptText = cleanText(optionStart >= 0 ? taskWithoutSolution.slice(0, optionStart) : taskWithoutSolution, 1400);
    if ((/Single Choice|Multiple Choice/i.test(kind) && labels.length > 0 && optionMatches.length >= 2 && optionMatches.every((option) => option.text)) || /Wahr(?:\/| oder )Falsch/i.test(kind)) {
      const explicitTruth = /aussage ist\s+(wahr|falsch)/i.exec(solutionText)?.[1]?.toLowerCase();
      const truth = explicitTruth ?? (/\b(?:unstetig|falsch|nicht korrekt|gilt nicht)\b/i.test(solutionText) ? "falsch" : "wahr");
      const selectionMode = /Multiple Choice/i.test(kind) ? "multiple" as const : /Wahr(?:\/| oder )Falsch/i.test(kind) ? "true-false" as const : "single" as const;
      const options = /Wahr(?:\/| oder )Falsch/i.test(kind)
        ? ["Wahr", "Falsch"].map((option) => ({
            text: option,
            correct: option.toLowerCase() === truth,
            feedback: option.toLowerCase() === truth ? "Entspricht der Quellenlösung." : "Entspricht nicht der Quellenlösung.",
          }))
        : optionMatches.map((option) => ({
            text: option.text,
            correct: labels.includes(option.label),
            feedback: labels.includes(option.label) ? "Entspricht der Quellenlösung." : "Entspricht nicht der Quellenlösung.",
          }));
      return {
        id: `mt${minitest}-a${number}`,
        type: "cross" as const,
        prompt: promptText || `${sourceTask}: Entscheide anhand der angegebenen mathematischen Bedingungen.`,
        selectionMode,
        options,
        explanation: solutionText,
        source: { label: `Minitest ${minitest} – Lösungen`, sourceTask, provenance: "source" as const },
      };
    }
    return {
      id: `mt${minitest}-a${number}`,
      type: "calculation" as const,
      prompt: promptText || `${sourceTask}: Bearbeite die vollständig angegebene Quellenaufgabe.`,
      givens: ["Alle Größen und Bedingungen stehen in der Aufgabenstellung."],
      acceptedAnswers: ["__self_check__"],
      unit: "",
      steps: solutionSteps(solutionText),
      commonMistake: `Die Aufgabenstruktur oder eine Bedingung aus ${sourceTask} wird übersehen.`,
      source: { label: `Minitest ${minitest} – Lösungen`, sourceTask, provenance: "source" as const },
    };
  });
}

function repairPracticeTask(task: ReturnType<typeof parsePracticeFile>[number]): ReturnType<typeof parsePracticeFile>[number] {
  if (task.id === "mt1-a1" && task.type === "cross") {
    return {
      ...task,
      options: task.options.map((option, index) => ({
        ...option,
        text: index === 3
          ? "d_n = 3 · d_{n−1} − 2, d_1 = 3"
          : index === 4
            ? "e_n = 7n/3, n ≥ 1"
            : option.text,
      })),
      explanation: "Die Lösung ist A. Aus 3 wird 7, aus 7 wird 15 und aus 15 wird 31, indem das vorherige Glied jeweils verdoppelt und anschließend 1 addiert wird. Daher gilt a_n = 2 · a_{n−1} + 1 mit a_1 = 3. Die übrigen Vorschriften erzeugen andere Folgenglieder oder sind nicht rekursiv angegeben.",
    };
  }
  if (task.id === "mt4-a2" && task.type === "cross") {
    return {
      ...task,
      prompt: "Das Taylorpolynom T(x) = 1 + 3 · (x + 2) + 7 · (x + 2)^2 + 14 · (x + 2)^3 ist gegeben. Bestimmen Sie Ordnung und Entwicklungsstelle.",
      explanation: "Die höchste Potenz ist 3, daher hat das Taylorpolynom Ordnung 3. Weil x + 2 = x − (−2) gilt, ist die Entwicklungsstelle x_0 = −2.",
    };
  }
  if (task.id === "mt6-a10") {
    return {
      id: task.id,
      type: "cross" as const,
      prompt: "Bestimmen Sie ∫(√(3/u) + 2u) du.",
      selectionMode: "single" as const,
      options: [
        { text: "−√(3/u^2) + 2u^2 + C", correct: false, feedback: "Entspricht nicht der Quellenlösung." },
        { text: "2 · √(3u) + u^2 + C", correct: true, feedback: "Entspricht der Quellenlösung." },
        { text: "−√(6/u) + 2 + C", correct: false, feedback: "Entspricht nicht der Quellenlösung." },
        { text: "√(3 ln(u)) + u^2 + C", correct: false, feedback: "Entspricht nicht der Quellenlösung." },
      ],
      explanation: "Schreibe √(3/u) als √3 · u^(−1/2). Mit der Potenzregel erhält man 2 · √3 · u^(1/2). Außerdem ist ∫2u du = u^2. Zusammen ergibt sich 2 · √(3u) + u^2 + C.",
      source: task.source,
    };
  }
  return task;
}

function isReadablePracticeTask(task: ReturnType<typeof parsePracticeFile>[number]): boolean {
  if (task.type === "calculation") return false;
  const text = [task.prompt, task.explanation, ...task.options.map((option) => option.text)].join(" ");
  if (/Local Moodle artifact root|Approved local image assets|assets\/logo|\/home\//i.test(text)) return false;
  if (/\bdu\b/i.test(task.prompt) && !/[∫]|integrier/i.test(task.prompt)) return false;
  if (/\b[xuntwy]\d{2,}\b|\)\s*[2-9]\b|π\d|\b(?:nn|xx|uu)\b|√\s*=|\bR(?:\s+R){1,}\b/i.test(text)) return false;
  if (/Formula-Umgebung|Lösung zu Aufgabe|ziehen Sie diese in das entsprechende Feld|Vervollständigen Sie die Tabelle/i.test(task.prompt)) return false;
  const visuallyVerified = new Set(["mt1-a1", "mt4-a2", "mt6-a10"]);
  const containsDenseMath = [task.prompt, ...task.options.map((option) => option.text)]
    .some((field) => /[=∫√Σ′^_]|\b(?:lim|sin|cos|tan|ln)\b/i.test(field));
  if (containsDenseMath && !visuallyVerified.has(task.id)) return false;
  return true;
}

function parseOptions(value: string): Array<{ label: string; text: string }> {
  const headings = [...value.matchAll(/^\s*(?:\(([a-z])\)|([A-E])\.)\s*/gmi)];
  return headings.map((heading, index) => ({
    label: (heading[1] ?? heading[2]).toLowerCase(),
    text: cleanText(value.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? value.length), 520),
  }));
}

function firstOptionHeadingIndex(value: string): number {
  return /^\s*(?:\([a-z]\)|[A-E]\.)\s*/gmi.exec(value)?.index ?? -1;
}

function correctLabels(solution: string): string[] {
  const intro = /(?:Die )?Lösung(?:en)?\s+(?:ist|sind)\s+([^:.]+)/i.exec(solution)?.[1] ?? "";
  return [...intro.matchAll(/(?:\(([a-z])\)|\b([A-E])\b)/gi)]
    .map((match) => (match[1] ?? match[2]).toLowerCase());
}

function solutionSteps(solution: string): string[] {
  const parts = solution.replace(/^\s*(?:Die )?Lösung[^:]*:\s*/i, "")
    .split(/(?:\n\s*\n|(?<=[.!?])\s+(?=[A-ZÄÖÜ]))/)
    .map((part) => cleanText(part, 520))
    .filter((part) => part.length >= 8)
    .slice(0, 7);
  if (parts.length >= 2) return parts;
  return [parts[0] ?? "Quellenlösung schrittweise nachvollziehen.", "Das Ergebnis durch Einsetzen, Ableiten oder eine Plausibilitätskontrolle prüfen."];
}

function cleanText(value: string, max: number): string {
  const text = normalizeMathNotation(value.replace(/^\s*\d+\s*$/gm, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+/g, " ").trim());
  return text.length > max ? `${text.slice(0, max).trim()} …` : text;
}

function normalizeMathNotation(value: string): string {
  return value
    .replace(/\bRR\b/g, "ℝ")
    .replace(/([A-Za-z])\s+7→\s*/g, "$1 ↦ ")
    .replace(/\b([a-e])n[−-]1(?=\s*(?:[+−*/·=,)]))/g, "$1_{n−1}")
    .replace(/\b([a-e])n(?=\s*=)/g, "$1_n")
    .replace(/\b([a-e])1(?=\s*=)/g, "$1_1")
    .replace(/\b([xfgyh])\s+0\s*\(([^)]+)\)/g, "$1′($2)")
    .replace(/\b([xfgyh])0\s*\(([^)]+)\)/g, "$1′($2)")
    .replace(/\bT([1-9])\b/g, "T_$1")
    .replace(/\b([xuntwy])([2-9])\b/g, "$1^$2")
    .replace(/\)([2-9])\b/g, ")^$1")
    .replace(/\b([xt])0\b/g, "$1_0")
    .replace(/\bR(?=[π∞0-9])/g, "∫")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s*([=≤≥])\s*/g, " $1 ");
}

function curatedCalculations(topicId: string, topicTitle: string): StudyGuideContent["topics"][number]["exercises"] {
  const source = (task: string) => ({ label: `MAES2 · ${topicTitle}`, sourceTask: task, provenance: "adapted" as const });
  const calc = (suffix: string, prompt: string, givens: string[], steps: string[], commonMistake: string) => ({
    id: `curated-${topicId}-${suffix}`,
    type: "calculation" as const,
    prompt,
    givens,
    acceptedAnswers: ["__self_check__"],
    unit: "",
    steps,
    commonMistake,
    source: source(`Strukturierte Übung ${suffix}`),
  });
  const tasks: Record<string, StudyGuideContent["topics"][number]["exercises"]> = {
    folgen: [
      calc("folge-1", "Berechnen Sie die ersten fünf Glieder der rekursiven Folge a_n = 2 · a_{n−1} − 1 mit a_1 = 3.", ["a_1 = 3", "a_n = 2 · a_{n−1} − 1"], ["Starte mit a_1 = 3.", "Einsetzen liefert a_2 = 5, a_3 = 9, a_4 = 17 und a_5 = 33.", "Kontrolle: Jedes neue Glied ist um 1 kleiner als das Doppelte des Vorgängers."], "Der Startwert wird nochmals in die Rekursionsformel eingesetzt und dadurch als a_0 behandelt."),
      calc("folge-2", "Untersuchen Sie die geometrische Folge a_n = 6 · (1/2)^(n−1) auf Monotonie, Beschränktheit und Grenzwert.", ["a_1 = 6", "Quotient q = 1/2"], ["Wegen 0 < q < 1 sind alle Glieder positiv und streng fallend.", "Die Folge ist nach unten durch 0 und nach oben durch 6 beschränkt.", "Da |q| < 1 gilt, ist lim_{n→∞} a_n = 0."], "Aus positiven Folgengliedern wird fälschlich auf einen positiven Grenzwert geschlossen."),
    ],
    grenzwerte: [
      calc("grenze-1", "Bestimmen Sie lim_{x→2} (x^2 − 4)/(x − 2).", ["Direktes Einsetzen ergibt 0/0."], ["Faktorisiere x^2 − 4 = (x − 2)(x + 2).", "Für x ≠ 2 kürzt sich x − 2; übrig bleibt x + 2.", "Damit ist der Grenzwert 4."], "0/0 wird als Ergebnis statt als Hinweis auf eine notwendige Umformung behandelt."),
      calc("grenze-2", "Bestimmen Sie a so, dass f(x) = (x^2 − 1)/(x − 1) für x ≠ 1 und f(1) = a bei x_0 = 1 stetig ist.", ["Stetigkeit verlangt lim_{x→1} f(x) = f(1)."], ["Faktorisiere x^2 − 1 = (x − 1)(x + 1).", "Der Grenzwert ist lim_{x→1}(x + 1) = 2.", "Daher muss a = 2 gelten."], "Der nicht definierte ursprüngliche Bruch wird bei x = 1 direkt eingesetzt."),
    ],
    ableitungen: [
      calc("ableitung-1", "Bestimmen Sie die Ableitung von f(x) = (3x^2 + 1)^4.", ["Äußere Funktion z^4", "Innere Funktion 3x^2 + 1"], ["Äußere Ableitung: 4(3x^2 + 1)^3.", "Innere Ableitung: 6x.", "Mit der Kettenregel folgt f′(x) = 24x(3x^2 + 1)^3."], "Die innere Ableitung 6x wird vergessen."),
      calc("ableitung-2", "Bestimmen Sie die Tangente an f(x) = x^2 − 2x im Punkt mit x_0 = 3.", ["Tangentenform t(x) = f(x_0) + f′(x_0)(x − x_0)"], ["f(3) = 3 und f′(x) = 2x − 2, also f′(3) = 4.", "Einsetzen ergibt t(x) = 3 + 4(x − 3).", "Vereinfacht lautet die Tangente t(x) = 4x − 9."], "Der Funktionswert f(3) wird mit der Steigung f′(3) verwechselt."),
    ],
    taylor: [
      calc("taylor-1", "Bestimmen Sie das Taylorpolynom zweiter Ordnung von f(x) = e^x an der Stelle x_0 = 0.", ["f(0) = f′(0) = f″(0) = 1"], ["Verwende T_2(x) = f(0) + f′(0)x + f″(0)x^2/2.", "Einsetzen liefert T_2(x) = 1 + x + x^2/2."], "Der Faktor 1/2! im quadratischen Term wird vergessen."),
      calc("taylor-2", "Näheren Sie e^0.1 mit dem Taylorpolynom T_2(x) = 1 + x + x^2/2 an.", ["x = 0.1"], ["Setze x = 0.1 ein: 1 + 0.1 + 0.1^2/2.", "Damit ergibt sich e^0.1 ≈ 1.105."], "0.1^2 wird fälschlich als 0.1 behandelt."),
    ],
    kurvendiskussion: [
      calc("kurve-1", "Bestimmen Sie die Extremstellen von f(x) = x^3 − 3x.", ["f′(x) = 3x^2 − 3"], ["Löse f′(x) = 0: x = −1 oder x = 1.", "Mit f″(x) = 6x gilt f″(−1) < 0 und f″(1) > 0.", "Daher liegt bei x = −1 ein Hochpunkt und bei x = 1 ein Tiefpunkt."], "Aus f′(x) = 0 wird ohne zweite Prüfung direkt auf einen Tiefpunkt geschlossen."),
      calc("kurve-2", "Bestimmen Sie die Wendestelle von f(x) = x^3 − 6x^2.", ["f″(x) = 6x − 12"], ["Löse f″(x) = 0 und erhalte x = 2.", "Da f‴(x) = 6 ≠ 0 ist, wechselt die Krümmung.", "Der Wendepunkt ist W(2, −16)."], "Es wird nur f″(x) = 0 geprüft, ohne den Krümmungswechsel abzusichern."),
    ],
    stammfunktionen: [
      calc("stamm-1", "Bestimmen Sie eine Stammfunktion von f(x) = 3x^2 − 4x + 2.", ["Integriere jeden Summanden einzeln."], ["∫3x^2 dx = x^3, ∫−4x dx = −2x^2 und ∫2 dx = 2x.", "Damit ist F(x) = x^3 − 2x^2 + 2x + C."], "Die Integrationskonstante C wird weggelassen."),
      calc("stamm-2", "Bestimmen Sie ∫2x · cos(x^2) dx.", ["Substitution u = x^2", "du = 2x dx"], ["Mit u = x^2 wird das Integral zu ∫cos(u) du.", "Daraus folgt sin(u) + C.", "Rücksubstitution ergibt sin(x^2) + C."], "Bei der Rücksubstitution bleibt die Hilfsvariable u im Ergebnis stehen."),
    ],
    "bestimmte-integrale": [
      calc("integral-1", "Berechnen Sie ∫_0^2 (3x^2 + 1) dx.", ["Eine Stammfunktion ist F(x) = x^3 + x."], ["Nach dem Hauptsatz gilt F(2) − F(0).", "Damit ergibt sich (8 + 2) − 0 = 10."], "Oberer und unterer Grenzwert werden in falscher Reihenfolge eingesetzt."),
      calc("integral-2", "Bestimmen Sie den Flächeninhalt zwischen f(x) = x − 1 und der x-Achse im Intervall [0, 2].", ["Die Nullstelle liegt bei x = 1."], ["Teile das Intervall an der Nullstelle.", "A = −∫_0^1(x − 1)dx + ∫_1^2(x − 1)dx.", "Beide Teilflächen sind 1/2 groß; insgesamt ist A = 1."], "Das orientierte Integral über [0,2] wird mit dem geometrischen Flächeninhalt verwechselt."),
    ],
    "uneigentliche-integrale": [
      calc("uneigentlich-1", "Untersuchen Sie ∫_1^∞ 1/x^2 dx auf Konvergenz und bestimmen Sie den Wert.", ["Ersetze ∞ durch eine Grenze b."], ["Berechne lim_{b→∞} ∫_1^b x^(−2) dx.", "Eine Stammfunktion ist −1/x.", "Der Grenzwert [−1/b + 1] ist 1; das Integral konvergiert."], "Mit ∞ wird wie mit einer gewöhnlichen Zahl gerechnet."),
      calc("uneigentlich-2", "Untersuchen Sie ∫_0^1 1/√x dx auf Konvergenz.", ["Bei x = 0 liegt ein singulärer Randpunkt."], ["Schreibe das Integral als lim_{a→0+} ∫_a^1 x^(−1/2) dx.", "Eine Stammfunktion ist 2√x.", "Der Grenzwert 2 − 2√a ist 2; das Integral konvergiert."], "Die Singularität am Rand wird ignoriert und direkt eingesetzt."),
    ],
    "dgl-erster-ordnung": [
      calc("dgl1-1", "Lösen Sie y′ = 3y mit Anfangsbedingung y(0) = 2.", ["Trennung der Variablen oder Exponentialansatz"], ["Die allgemeine Lösung ist y(t) = C e^(3t).", "Aus y(0) = 2 folgt C = 2.", "Damit ist y(t) = 2e^(3t)."], "Die Anfangsbedingung wird nicht zur Bestimmung von C verwendet."),
      calc("dgl1-2", "Lösen Sie y′ = 2t mit y(0) = 1.", ["Integriere beide Seiten nach t."], ["Aus y′ = 2t folgt y(t) = t^2 + C.", "Die Anfangsbedingung liefert C = 1.", "Somit gilt y(t) = t^2 + 1."], "Die Integrationskonstante wird vor Anwendung der Anfangsbedingung vergessen."),
    ],
  };
  return tasks[topicId] ?? [];
}

function curatedConceptChecks(topicId: string, topicTitle: string): StudyGuideContent["topics"][number]["exercises"] {
  const source = { label: `MAES2 · ${topicTitle}`, sourceTask: "Strukturierter Konzeptcheck", provenance: "adapted" as const };
  const checks: Record<string, StudyGuideContent["topics"][number]["exercises"]> = {
    folgen: [{
      id: "curated-folgen-check",
      type: "cross",
      prompt: "Welche Angabe beschreibt eine rekursive Folge vollständig?",
      selectionMode: "single",
      options: [
        { text: "Eine Übergangsregel zusammen mit einem passenden Startwert", correct: true, feedback: "Beide Angaben werden zum Fortschreiben benötigt." },
        { text: "Nur die ersten drei Folgenglieder", correct: false, feedback: "Endlich viele Glieder legen eine Folge nicht eindeutig fest." },
        { text: "Nur eine Formel für das nächste Glied ohne Startwert", correct: false, feedback: "Ohne Startwert kann die Rekursion nicht beginnen." },
      ],
      explanation: "Eine rekursive Beschreibung benötigt mindestens einen Startwert und eine Regel, die aus bekannten Gliedern die folgenden Glieder erzeugt.",
      source,
    }],
    grenzwerte: [{
      id: "curated-grenzwerte-check",
      type: "cross",
      prompt: "Welche Bedingungen müssen für Stetigkeit einer Funktion an der Stelle x_0 gemeinsam erfüllt sein?",
      selectionMode: "multiple",
      options: [
        { text: "Der Funktionswert f(x_0) ist definiert.", correct: true, feedback: "Diese Bedingung ist notwendig." },
        { text: "Links- und Rechtsgrenzwert existieren und stimmen überein.", correct: true, feedback: "Damit existiert der zweiseitige Grenzwert." },
        { text: "Der Grenzwert stimmt mit f(x_0) überein.", correct: true, feedback: "Erst diese Gleichheit liefert Stetigkeit." },
        { text: "Die Ableitung f′(x_0) muss positiv sein.", correct: false, feedback: "Stetigkeit verlangt keine positive Ableitung." },
      ],
      explanation: "Stetigkeit an x_0 verlangt einen definierten Funktionswert, einen existierenden zweiseitigen Grenzwert und die Übereinstimmung beider Werte.",
      source,
    }],
    ableitungen: [{
      id: "curated-ableitungen-check",
      type: "cross",
      prompt: "Welche Regel muss bei f(x) = sin(x^2) als äußere Regel zuerst angewendet werden?",
      selectionMode: "single",
      options: [
        { text: "Kettenregel", correct: true, feedback: "Sinus und x^2 sind miteinander verkettet." },
        { text: "Produktregel", correct: false, feedback: "Die Funktion ist kein Produkt zweier Faktoren." },
        { text: "Quotientenregel", correct: false, feedback: "Die Funktion enthält keinen Quotienten." },
      ],
      explanation: "Die äußere Funktion ist der Sinus, die innere Funktion ist x^2. Daher beginnt der Rechenweg mit der Kettenregel.",
      source,
    }],
    stammfunktionen: [{
      id: "curated-stammfunktionen-check",
      type: "cross",
      prompt: "Warum gehört bei einem unbestimmten Integral die Konstante C zum Ergebnis?",
      selectionMode: "single",
      options: [
        { text: "Weil sich Stammfunktionen derselben Funktion um eine Konstante unterscheiden können", correct: true, feedback: "Die Ableitung jeder Konstanten ist null." },
        { text: "Weil C immer den Funktionswert bei x = 0 bezeichnet", correct: false, feedback: "Ohne Anfangsbedingung besitzt C keinen festgelegten Wert." },
        { text: "Weil C beim Ableiten mit x multipliziert wird", correct: false, feedback: "Eine additive Konstante verschwindet beim Ableiten." },
      ],
      explanation: "Ist F eine Stammfunktion von f, dann ist auch F + C für jede reelle Konstante C eine Stammfunktion, da die Ableitung von C gleich null ist.",
      source,
    }],
    "dgl-erster-ordnung": [{
      id: "curated-dgl1-check",
      type: "cross",
      prompt: "Welche Differentialgleichung ist unmittelbar durch Trennung der Variablen lösbar?",
      selectionMode: "single",
      options: [
        { text: "y′ = t · y", correct: true, feedback: "Die Gleichung lässt sich als dy/y = t dt schreiben." },
        { text: "y′ + t · y = 1", correct: false, feedback: "Diese Gleichung ist linear, aber nicht unmittelbar separiert." },
        { text: "y″ + y = 0", correct: false, feedback: "Das ist eine Gleichung zweiter Ordnung." },
      ],
      explanation: "Bei y′ = t · y können alle y-Terme auf eine Seite und alle t-Terme auf die andere Seite gebracht werden.",
      source,
    }],
  };
  return checks[topicId] ?? [];
}

function derivedOdeTasks(order: 1 | 2) {
  const label = order === 1 ? "Ernst Graf: Skriptum Differentialgleichungen" : "Ernst Graf: DGL 2. Ordnung";
  const source = (task: string) => ({ label, sourceTask: task, provenance: "adapted" as const });
  if (order === 1) return [
    { id: "ode-basic-1", type: "cross" as const, prompt: "Welche Aussage beschreibt die Rolle einer Anfangsbedingung y(t₀)=y₀ bei einer Differentialgleichung korrekt?", selectionMode: "single" as const, options: [{ text: "Sie wählt aus der allgemeinen Lösungsfamilie eine partikuläre Lösung aus.", correct: true, feedback: "Richtig: Die Differentialgleichung liefert typischerweise eine Familie; die Anfangsbedingung fixiert die Konstante." }, { text: "Sie erhöht immer die Ordnung der Differentialgleichung.", correct: false, feedback: "Die Ordnung hängt von der höchsten vorkommenden Ableitung ab." }, { text: "Sie ersetzt die Differentialgleichung vollständig.", correct: false, feedback: "Sie ergänzt die Gleichung, ersetzt sie aber nicht." }], explanation: "Eine Anfangsbedingung bestimmt die freie Integrationskonstante und damit eine partikuläre Lösung.", source: source("Abgeleitete Übung: Anfangsbedingung") },
    { id: "ode-basic-2", type: "cross" as const, prompt: "Welche Gleichung ist eine gewöhnliche Differentialgleichung erster Ordnung?", selectionMode: "single" as const, options: [{ text: "y′(t)=t+y(t)", correct: true, feedback: "Richtig: Es tritt nur eine unabhängige Variable und als höchste Ableitung y′ auf." }, { text: "y″(t)+y(t)=0", correct: false, feedback: "Hier ist y″ die höchste Ableitung; die Gleichung ist zweiter Ordnung." }, { text: "∂u/∂x + ∂u/∂t = 0", correct: false, feedback: "Partielle Ableitungen kennzeichnen eine partielle Differentialgleichung." }], explanation: "Die Ordnung wird von der höchsten Ableitung bestimmt; gewöhnlich bedeutet eine unabhängige Variable.", source: source("Abgeleitete Übung: DGL-Klassifikation") },
    { id: "ode-basic-3", type: "calculation" as const, prompt: "Prüfe durch Einsetzen, ob y(t)=Ce²ᵗ eine Lösung von y′=2y ist.", givens: ["y(t)=Ce²ᵗ", "Differentialgleichung y′=2y"], acceptedAnswers: ["__self_check__"], unit: "", steps: ["Leite y ab: y′(t)=2Ce²ᵗ.", "Setze y in die rechte Seite ein: 2y(t)=2Ce²ᵗ.", "Beide Seiten stimmen für jedes C überein; die Funktion ist eine Lösungsfamilie."], commonMistake: "Der Faktor 2 aus der Kettenregel wird beim Ableiten vergessen.", source: source("Abgeleitete Übung: Lösungskontrolle") },
  ];
  return [
    { id: "ode2-1", type: "cross" as const, prompt: "Welche charakteristische Gleichung gehört zu y″−3y′+2y=0?", selectionMode: "single" as const, options: [{ text: "λ²−3λ+2=0", correct: true, feedback: "Richtig: y, y′ und y″ werden durch 1, λ und λ² ersetzt." }, { text: "λ−3+2=0", correct: false, feedback: "Die zweite Ableitung erzeugt λ², nicht λ." }, { text: "2λ²−3λ+1=0", correct: false, feedback: "Die Koeffizienten wurden vertauscht." }], explanation: "Der Exponentialansatz y=e^{λt} führt nach Division durch e^{λt} auf λ²−3λ+2=0.", source: source("Abgeleitete Übung: charakteristische Gleichung") },
    { id: "ode2-2", type: "cross" as const, prompt: "Die charakteristische Gleichung besitzt zwei verschiedene reelle Nullstellen λ₁ und λ₂. Welche homogene Lösung ist korrekt?", selectionMode: "single" as const, options: [{ text: "y_h=C₁e^{λ₁t}+C₂e^{λ₂t}", correct: true, feedback: "Richtig: Zu jeder verschiedenen reellen Nullstelle gehört ein unabhängiger Exponentialterm." }, { text: "y_h=(C₁+C₂t)e^{λ₁t}", correct: false, feedback: "Diese Form gehört zu einer doppelten Nullstelle." }, { text: "y_h=C₁cos(λ₁t)+C₂sin(λ₂t)", correct: false, feedback: "Trigonometrische Terme entstehen bei komplex konjugierten Nullstellen." }], explanation: "Bei zwei verschiedenen reellen Nullstellen ist die Linearkombination der beiden Exponentiallösungen allgemein.", source: source("Abgeleitete Übung: Lösungsform") },
    { id: "ode2-3", type: "calculation" as const, prompt: "Löse die homogene Differentialgleichung y″−3y′+2y=0 allgemein.", givens: ["Konstante Koeffizienten", "homogene Gleichung"], acceptedAnswers: ["__self_check__"], unit: "", steps: ["Charakteristische Gleichung: λ²−3λ+2=0.", "Faktorisieren: (λ−1)(λ−2)=0, also λ₁=1 und λ₂=2.", "Zwei verschiedene reelle Nullstellen liefern y(t)=C₁eᵗ+C₂e²ᵗ.", "Durch Einsetzen kann die Lösung kontrolliert werden."], commonMistake: "Bei verschiedenen Nullstellen wird fälschlich die Form für eine doppelte Nullstelle verwendet.", source: source("Abgeleitete Übung: homogene DGL 2. Ordnung") },
  ];
}
