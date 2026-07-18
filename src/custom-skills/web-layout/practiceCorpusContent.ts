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

const TASK_START = /^\s*(\d{1,2})\.\s+(Single Choice|Multiple Choice|Wahr\/Falsch|Wahr oder Falsch\??|Numerische Eingabe|Drag and Drop(?: auf (?:Bild|Text|Tabelle))?|Drop ?down Auswahl|Dropdown[^:\n]*|Multiple Choice oder Numerische Eingabe)\s*:?/gmi;

export function buildContentFromPracticeCorpus(sourceText: string, layoutSpec: JsonObject): StudyGuideContent | null {
  const corpusIndex = sourceText.indexOf("## Full extracted practice corpus");
  if (corpusIndex < 0) return null;
  const corpus = sourceText.slice(corpusIndex);
  const fileHeader = /^### Practice source: (.+)$/gm;
  const files = [...corpus.matchAll(fileHeader)];
  if (files.length < 5) return null;

  const byMinitest = new Map<number, ReturnType<typeof parsePracticeFile>>();
  for (let index = 0; index < files.length; index += 1) {
    const filename = files[index][1].trim();
    const minitest = Number(/Minitest-(\d+)/i.exec(filename)?.[1]);
    if (!Number.isFinite(minitest)) continue;
    const start = (files[index].index ?? 0) + files[index][0].length;
    const end = files[index + 1]?.index ?? corpus.length;
    byMinitest.set(minitest, parsePracticeFile(corpus.slice(start, end), minitest));
  }

  const topics = TOPICS.map(([id, title, focus, formula], index) => {
    const minitest = index < 8 ? index + 1 : index === 9 ? 10 : null;
    const parsed = minitest ? byMinitest.get(minitest) ?? [] : derivedOdeTasks(index === 8 ? 1 : 2);
    const exercises = parsed.length >= 3 ? parsed : derivedOdeTasks(index === 8 ? 1 : 2);
    const exampleTask = exercises.find((exercise) => exercise.type === "calculation") ?? exercises[0];
    const exampleSteps = exampleTask.type === "calculation"
      ? exampleTask.steps
      : ["Aufgabentyp und Bedingungen identifizieren.", exampleTask.explanation];
    return {
      id,
      title,
      learningGoals: [focus, "Typische Fehlentscheidungen anhand konkreter Moodle-Aufgaben diagnostizieren"],
      theory: {
        summary: `${focus}. In diesem Kapitel wird zuerst die mathematische Struktur erkannt, dann die passende Regel ausgewählt und das Ergebnis durch Definition, Ableitung oder Einsetzen kontrolliert. Die Aufgaben stammen aus den verfügbaren MAES2-Minitest-Lösungen; abgeleitete Ergänzungen sind ausdrücklich markiert.`,
        keyIdeas: ["Voraussetzungen vor dem Rechnen prüfen", "Jeden Umformungsschritt begründen", "Ergebnis mit einer unabhängigen Kontrolle absichern"],
        formulas: [{ expression: formula, meaning: `Leitformel für ${title}` }],
      },
      workedExamples: [{
        title: `Quellenbeispiel: ${exampleTask.source.sourceTask}`,
        prompt: exampleTask.prompt,
        steps: exampleSteps.length >= 2 ? exampleSteps : [exampleSteps[0] ?? "Aufgabe analysieren.", "Ergebnis kontrollieren."],
        answer: exampleTask.type === "calculation" ? exampleTask.steps.at(-1) ?? "Siehe Quellenlösung." : exampleTask.explanation,
        source: exampleTask.source,
      }],
      exercises,
      retrieval: [{ prompt: `Welche Kontrolle ist bei „${title}“ besonders wichtig?`, answer: `Prüfe Voraussetzungen, Rechenweg und Ergebnis passend zu ${focus.toLowerCase()}.` }],
    };
  });

  const courseTitle = typeof layoutSpec.title === "string" ? layoutSpec.title.replace(/^MAES2\s*[–-]\s*/i, "") : "MAES2 – Mathematik für Engineering Science 2";
  return {
    courseTitle,
    scopeNote: "Quellennahe Trainingsbank aus den zugänglichen Minitest-Lösungen 1–8 und 10. Minitest 9 war nicht abrufbar; Minitest 11 wurde nicht erworben. Die DGL-Ergänzungen für diese Lücken sind sichtbar als abgeleitete Übungen aus den vorhandenen DGL-Skripten gekennzeichnet. Übungspunkte sind keine offizielle Prüfungsbewertung.",
    topics,
    sources: [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 10].map((number) => ({ id: `mt${number}`, label: `Minitest ${number} – Lösungen`, url: "", coverage: `Konkrete Aufgaben und Lösungen für Thema ${number}` })),
      { id: "ode", label: "Ernst Graf: Skriptum Differentialgleichungen", url: "", coverage: "Abgeleitete Ergänzungen für DGL-Grundlagen" },
      { id: "ode2", label: "Ernst Graf: DGL 2. Ordnung mit konstanten Koeffizienten", url: "", coverage: "Abgeleitete Ergänzungen für DGL zweiter Ordnung" },
    ],
  };
}

function parsePracticeFile(text: string, minitest: number) {
  const normalized = text.replace(/\f/g, "\n");
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
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s*([=≤≥])\s*/g, " $1 ");
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
