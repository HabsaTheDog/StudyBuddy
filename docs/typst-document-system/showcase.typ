#import "study-buddy-components.typ": *

#sb-document(
  title: "Study Buddy Dokumentstandard",
  short-title: "Komponentenbibliothek",
  subtitle: "Corporate-Identity-System für zuverlässige technische Lernunterlagen",
  course: "Engineering · fachübergreifend",
  kind: "Designsystem & Komponenten",
  semester: "SS 2026",
  author: "Study Buddy 2.0",
  status: "Review",
  date: "07.06.2026",
  body: [
    #outline(title: [Inhaltsverzeichnis], depth: 2)

    #pagebreak()
    = Ziel und verbindliche Grundregeln

    Dieses Dokument zeigt den vorgeschlagenen Standard, den der Typst-Builder
    künftig vor jeder Dokumenterstellung als Komponentenbibliothek und
    Designreferenz verwenden soll. Es ist bewusst kein fachlicher Lernzettel,
    sondern ein sichtbarer Katalog der verfügbaren Bausteine.

    #sb-callout(title: "Kernprinzip", tone: "primary")[
      Inhalte dürfen variieren, die visuelle Grammatik bleibt stabil:
      ein genormtes Titelblatt, reproduzierbare Seitenränder, klare
      Informationshierarchie, definierte Komponenten und nachvollziehbare
      Quellen.
    ]

    == Dokumentstruktur

    #sb-table(
      columns: (17mm, 42mm, 1fr),
      header: ("Stufe", "Baustein", "Regel"),
      rows: (
        ("01", "Titelblatt", "Immer vorhanden; Titel, Lehrveranstaltung, Typ, Semester, Stand und Status."),
        ("02", "Inhaltsverzeichnis", "Ab drei Hauptkapiteln oder bei Dokumenten über vier Seiten."),
        ("03", "Kurzüberblick", "Lernziele, Voraussetzungen und Quellenlage kompakt ausweisen."),
        ("04", "Fachinhalt", "Definition → Herleitung → Beispiel → Kontrolle als bevorzugte Reihenfolge."),
        ("05", "Abschluss", "Checkliste, offene Punkte und Quellenverzeichnis."),
      ),
    )

    == Gestaltungsregeln

    #grid(
      columns: (1fr, 1fr),
      gutter: 5mm,
      [
        #sb-callout(title: "Typografie", tone: "info")[
          *Fließtext:* 10,2 pt\
          *Kapitel:* 18 pt\
          *Unterkapitel:* 12 pt\
          *Hinweise:* 8–9 pt\
          Maximal drei sichtbare Überschriftsebenen.
        ]
      ],
      [
        #sb-callout(title: "Raster", tone: "success")[
          *Format:* A4\
          *Rand:* 18 mm seitlich\
          *Kopf/Fuß:* durchgehend\
          *Abstände:* Token statt Einzelwerte\
          Tabellen und Abbildungen nutzen 100 % Breite.
        ]
      ],
    )

    #v(4mm)
    #sb-key-value-table((
      ("Primärfarbe", [Navy #box(width: 12mm, height: 3mm, fill: sb-colors.navy)]),
      ("Akzent", [Blau #box(width: 12mm, height: 3mm, fill: sb-colors.blue)]),
      ("Technik-Akzent", [Cyan #box(width: 12mm, height: 3mm, fill: sb-colors.cyan)]),
      ("Semantik", [#sb-chip("Info", tone: "info") #h(2pt) #sb-chip("OK", tone: "success") #h(2pt) #sb-chip("Achtung", tone: "warning") #h(2pt) #sb-chip("Fehler", tone: "danger")]),
      ("Sprache", "Deutsch (Österreich), Datum TT.MM.JJJJ, Uhrzeit 24 h, SI-Einheiten."),
    ))

    #sb-callout(title: "Nicht erlaubt", tone: "danger")[
      Freie Farbwahl, manuell gezeichnete Tabellen, uneinheitliche Boxen,
      Formeln als Screenshot, erfundene Quellen, unbeschriftete Diagramme
      oder Schaltpläne sowie mehr als zwei Akzentfarben in einer Komponente.
    ]

    = Standardisierte Inhaltskomponenten

    == Hinweise und semantische Zustände

    #sb-callout(title: "Merksatz", tone: "primary")[
      Der Primärhinweis hebt eine zentrale Aussage hervor, ohne Gefahr oder
      Erfolg zu signalisieren.
    ]
    #sb-callout(title: "Information", tone: "info")[
      Diese Variante ergänzt Kontext, Randbedingungen oder Begriffsdetails.
    ]
    #sb-callout(title: "Validiert", tone: "success")[
      Grün ist ausschließlich für bestätigte Resultate, Formeln oder
      abgeschlossene Prüfschritte reserviert.
    ]
    #sb-callout(title: "Prüfen", tone: "warning")[
      Orange kennzeichnet Annahmen, häufige Fehler oder notwendige Kontrollen.
    ]
    #sb-callout(title: "Kritisch", tone: "danger")[
      Rot wird nur für Sicherheitsrisiken, falsche Aussagen oder harte
      Abbruchbedingungen verwendet.
    ]

    == Definition, Formel und Rechenbeispiel

    #sb-definition("Zeitkonstante")[
      Die Zeitkonstante eines RC-Glieds beschreibt die charakteristische
      Dauer, mit der sich die Kondensatorspannung ihrem Endwert annähert.
    ]

    #sb-formula(
      name: "Zeitkonstante des RC-Glieds",
      variables: (
        "τ … Zeitkonstante",
        "R … Widerstand",
        "C … Kapazität",
      ),
      units: ("τ in s", "R in Ω", "C in F"),
      source: "Beispielquelle [Q1], Abschnitt 2.1",
    )[
      $tau = R dot C$
    ]

    #sb-example(title: "Dimensionierung")[
      Gegeben sind $R = 10 k Omega$ und $C = 100 n F$.

      $ tau = 10 dot 10^3 Omega dot 100 dot 10^(-9) F = 1 m s $

      *Ergebnis:* Nach ungefähr $5 tau = 5 m s$ ist der Einschwingvorgang
      praktisch abgeschlossen.
    ]

    #sb-source-note(
      "Q1 · Demonstrationsquelle für das Komponenten-System, 07.06.2026.",
      coverage: "Nur Layoutbeispiel; keine Moodle- oder CIS-Fachdaten verwendet.",
    )

    #pagebreak()
    = Mathematik-Stressprobe

    Diese Seite prüft Darstellungen, bei denen generative Modelle häufig
    Syntaxfehler, unklare Klammerung, falsche Indizes oder unlesbare
    Zeilenumbrüche erzeugen. Komplexe Mathematik muss als editierbare
    Typst-Mathematik ausgegeben und anschließend kompiliert sowie visuell
    kontrolliert werden.

    == Matrizen und Zustandsraum

    #sb-math-panel(
      "Zustandsraummodell zweiter Ordnung",
      note: "Matrix, Vektoren, Indizes und griechische Parameter",
    )[
      $
        mat(dot(x)_1(t); dot(x)_2(t))
        =
        mat(
          0, 1;
          -omega_0^2, -2 zeta omega_0
        )
        mat(x_1(t); x_2(t))
        +
        mat(0; K omega_0^2) u(t)
      $
    ]

    #sb-math-panel(
      "Allgemeine Lösung eines linearen Systems",
      note: "Matrixexponential und Faltungsintegral",
    )[
      $
        bold(x)(t)
        =
        e^(bold(A) t) bold(x)_0
        +
        integral_0^t
          e^(bold(A)(t - tau)) bold(B) bold(u)(tau)
        dif tau
      $
    ]

    == Komplexe Größen und Übertragungsfunktion

    #sb-math-panel(
      "RC-Tiefpass im Frequenzbereich",
      note: "Komplexe Zahlen, Brüche und Betragsfunktion",
    )[
      $
        H(j omega)
        =
        1 / (1 + j omega R C)
        =
        (1 - j omega R C) / (1 + (omega R C)^2)
      $
      #v(4pt)
      $
        abs(H(j omega))
        =
        1 / sqrt(1 + (omega R C)^2)
        quad
        phi(omega) = -arctan(omega R C)
      $
    ]

    == Integrale, Summen und partielle Ableitungen

    #sb-math-panel(
      "Fourier-Transformation",
      note: "Unendliche Grenzen und komplexe Exponentialfunktion",
    )[
      $
        X(omega)
        =
        integral_(-infinity)^infinity
          x(t) e^(-j omega t)
        dif t
      $
    ]

    #sb-math-panel(
      "Kombinierte Standardunsicherheit",
      note: "Verschachtelte Summen und Kovarianzterme",
    )[
      $
        u_c(y)
        =
        sqrt(
          sum_(i=1)^n
            ( (partial f)/(partial x_i) u(x_i) )^2
          +
          2 sum_(i=1)^(n-1) sum_(j=i+1)^n
            (partial f)/(partial x_i)
            (partial f)/(partial x_j)
            u(x_i, x_j)
        )
      $
    ]

    == Fallunterscheidung und symbolische Umformung

    #sb-math-panel(
      "Stückweise definierte Kennlinie",
      note: "Fallunterscheidung mit Bedingungen",
    )[
      $
        f(x) =
        cases(
          0 & "für " x < 0,
          x^2 & "für " 0 <= x <= 1,
          sqrt(x) & "für " x > 1,
        )
      $
    ]

    #sb-math-panel(
      "Mehrzeilige Herleitung der Normalgleichung",
      note: "Ausrichtung, Gradient, Transponierte und Inverse",
    )[
      $
        J(beta)
        &= norm(bold(A) beta - bold(y))_2^2 \
        nabla_beta J(beta)
        &= 2 bold(A)^T (bold(A) beta - bold(y)) = 0 \
        hat(beta)
        &= (bold(A)^T bold(A))^(-1) bold(A)^T bold(y)
      $
    ]

    #sb-callout(title: "Mathematik-Validierung", tone: "warning")[
      Jede komplexe Formel benötigt einen Syntax-Compile-Check, eine visuelle
      Prüfung auf Überbreite und Klammerfehler sowie einen fachlichen Check
      von Indizes, Grenzen, Operatoren und Dimensionen. Automatisches
      Verkleinern unter 9 pt ist nicht zulässig; stattdessen muss die Formel
      sinnvoll zerlegt werden.
    ]

    == Aufgaben und Lernkontrolle

    #sb-exercise(
      number: "3",
      title: "Grenzfrequenz bestimmen",
      difficulty: "mittel",
      points: 4,
    )[
      Berechne die Grenzfrequenz eines RC-Tiefpasses mit
      $R = 4.7 k Omega$ und $C = 47 n F$. Gib Formel, Einsetzung,
      Ergebnis und Einheit an.
      #v(8mm)
      #line(length: 100%, stroke: 0.4pt + sb-colors.line)
      #v(7mm)
      #line(length: 100%, stroke: 0.4pt + sb-colors.line)
    ]

    #sb-checklist((
      [Alle Größen wurden in SI-Einheiten umgerechnet.],
      [Das Ergebnis enthält eine sinnvolle Einheit.],
      [Annahmen und Näherungen sind explizit genannt.],
      [Die Größenordnung wurde plausibilisiert.],
    ))

    = Tabellenbibliothek

    Tabellen erhalten immer eine Kopfzeile, definierte Spaltenbreiten,
    dezente Zeilenführung und eine fachlich passende Tabellenform.

    == Schlüssel-Wert-Tabelle

    #sb-key-value-table((
      ("Versorgung", "24 V DC"),
      ("Schaltfrequenz", "100 kHz"),
      ("Nennleistung", "48 W"),
      ("Messmethode", "Oszilloskop, differenzieller Tastkopf"),
    ))

    #sb-table-section("Messwerttabelle")[
      #sb-table(
        columns: (16mm, 24mm, 24mm, 24mm, 1fr),
        header: ("Nr.", [$U_"in"$], [$U_"out"$], [$I_"out"$], "Bewertung"),
        rows: (
          ("1", "12,0 V", "5,02 V", "0,20 A", [#sb-chip("plausibel", tone: "success")]),
          ("2", "18,0 V", "5,01 V", "0,50 A", [#sb-chip("plausibel", tone: "success")]),
          ("3", "24,0 V", "4,83 V", "1,00 A", [#sb-chip("prüfen", tone: "warning")]),
        ),
      )
    ]

    == Vergleichstabelle

    #sb-comparison-table((
      ("Prinzip", "Linearregelung", "Abwärtswandler"),
      ("Wirkungsgrad", "niedrig bis mittel", "hoch"),
      ("Störverhalten", "gering", "Schaltanteile vorhanden"),
      ("Komplexität", "niedrig", "mittel"),
    ))

    == Ablauf- und Terminplan

    #sb-schedule-table((
      ("08:00", "Vorbereitung", "Schaltung und Grenzwerte prüfen", "Freigabe"),
      ("08:20", "Messung", "Arbeitspunkte systematisch aufnehmen", "Messreihe"),
      ("09:10", "Auswertung", "Kennlinie und Abweichungen berechnen", "Diagramm"),
      ("09:40", "Review", "Plausibilität und Quellen kontrollieren", "Abgabe"),
    ))

    = Diagramme und technische Darstellungen

    == Linearer Ablauf

    #sb-figure(
      label-text: "Abb. 1",
      caption: "Standardkomponente für sequenzielle Prozesse.",
    )[
      #sb-flowchart-linear((
        (title: "Quelle erfassen", subtitle: "Moodle / CIS / Datei", tone: "info"),
        (title: "Inhalt analysieren", subtitle: "Strukturierte Daten", tone: "primary"),
        (title: "Dokument formatieren", subtitle: "Komponenten auswählen", tone: "warning"),
        (title: "Typst validieren", subtitle: "Kompilieren und prüfen", tone: "success"),
      ))
    ]

    == Entscheidungsdiagramm

    #sb-figure(
      label-text: "Abb. 2",
      caption: "Verzweigter Prüfprozess mit eindeutigem JA/NEIN-Pfad.",
    )[
      #sb-flowchart-branch(
        "Messwert erfassen",
        "im Bereich?",
        "Wert übernehmen",
        "Aufbau prüfen",
        "Ergebnis dokumentieren",
      )
    ]

    == Technisches Blockdiagramm

    #sb-figure(
      label-text: "Abb. 3",
      caption: "Signalfluss wird grundsätzlich von links nach rechts dargestellt.",
    )[
      #sb-block-diagram((
        "Sensor",
        "Filter",
        "A/D-Wandler",
        "Regler",
      ))
    ]

    #sb-callout(title: "Flowchart-Freigabe", tone: "success")[
      Flowcharts verwenden ausschließlich geometrisch verankerte Kanten,
      keine Pfeilzeichen als Text. Vor der Ausgabe erfolgen zwei Prüfungen:
      erstens feste Geometrie- und Beschriftungsgrenzen, zweitens ein
      gerenderter Debug-Check der Bounding-Boxen auf Überlappungen,
      abgeschnittenen Text und fehlerhafte Kanten.
    ]

    == Schaltplan

    #sb-figure(
      label-text: "Abb. 4",
      caption: "Geometrisch aufgebauter RC-Tiefpass mit IEC-Symbolen und beschrifteten Signalen.",
    )[
      #sb-rc-schematic()
    ]

    #sb-callout(title: "Schaltplanregeln", tone: "warning")[
      Jeder Schaltplan benötigt Bauteilkennzeichen, Ein-/Ausgangsgrößen,
      eindeutige Knoten, Leserichtung, Bauteilwerte und Bildunterschrift.
      Leiter müssen geometrisch verbunden sein; ASCII-Skizzen und
      typografische Ersatzsymbole sind nicht zulässig.
    ]

    = Empfohlene Seitenmuster

    == Lernzettel

    #sb-table(
      columns: (14mm, 38mm, 1fr),
      header: ("Pos.", "Abschnitt", "Bevorzugte Komponenten"),
      rows: (
        ("1", "Kurzüberblick", "Lernziele, Voraussetzungen, Quellenlage"),
        ("2", "Grundlagen", "Definitionen, Merksätze, Formeln"),
        ("3", "Anwendung", "Rechenbeispiele, Diagramme, Tabellen"),
        ("4", "Selbstkontrolle", "Aufgaben, Checkliste, typische Fehler"),
        ("5", "Quellen", "Referenzen mit Fundstelle und Abrufdatum"),
      ),
    )

    == Laborvorbereitung

    #sb-table(
      columns: (14mm, 38mm, 1fr),
      header: ("Pos.", "Abschnitt", "Bevorzugte Komponenten"),
      rows: (
        ("1", "Ziel und Sicherheit", "Gefahrenhinweis, Grenzwerte"),
        ("2", "Aufbau", "Schaltplan, Stückliste, Messgeräte"),
        ("3", "Ablauf", "Flowchart, Zeitplan, Checkliste"),
        ("4", "Messwerte", "Leere Messwerttabelle mit Einheiten"),
        ("5", "Auswertung", "Formeln, Diagramme, Unsicherheiten"),
      ),
    )

    == Formelsammlung

    #sb-table(
      columns: (14mm, 38mm, 1fr),
      header: ("Pos.", "Abschnitt", "Bevorzugte Komponenten"),
      rows: (
        ("1", "Symbolverzeichnis", "Schlüssel-Wert-Tabelle"),
        ("2", "Formeln", "Formelkarte mit Variablen und SI-Einheiten"),
        ("3", "Spezialfälle", "Info- und Warnhinweise"),
        ("4", "Mini-Beispiele", "Kompakte Rechenbeispiele"),
        ("5", "Quellen", "Quelle direkt an jeder Formel"),
      ),
    )

    #pagebreak()
    = Qualitätsprüfung vor Ausgabe

    Der Builder soll ein Dokument erst als fertig markieren, wenn alle
    zutreffenden Prüfpunkte erfüllt sind.

    #sb-checklist((
      [Genormtes Titelblatt und korrekte Dokumentmetadaten vorhanden.],
      [Seiten folgen dem A4-Raster mit Kopf- und Fußzeile.],
      [Maximal drei Überschriftsebenen und keine verwaisten Überschriften.],
      [Jede Tabelle besitzt Kopfzeile, Einheiten und sinnvolle Spaltenbreiten.],
      [Jedes Diagramm besitzt Leserichtung und Bildunterschrift.],
      [Jeder Schaltplan besitzt Bauteilkennzeichen und benannte Signale.],
      [Komplexe Formeln sind Typst-Mathematik, kompiliert und visuell auf Überbreite geprüft.],
      [Moodle- und CIS-Quellenlage ist sichtbar ausgewiesen, sofern relevant.],
      [Keine erfundenen Quellen oder nicht belegten fachlichen Behauptungen.],
      [Typst kompiliert ohne Fehler; PDF wurde visuell auf Umbrüche geprüft.],
    ))

    #sb-callout(title: "Vorgeschlagene Builder-Entscheidung", tone: "success")[
      Der Formatter wählt Komponenten nach Dokumenttyp und Inhalt aus einer
      versionierten Bibliothek. Der Validator prüft nicht nur Syntax, sondern
      auch Strukturregeln, Pflichtmetadaten und verbotene Rohformatierung.
    ]

    == Quellenmuster

    #sb-source-note(
      "Q1 · Autor/Institution, Titel, Version oder Datum, konkrete Seite/Abschnitt, URL oder lokale Fundstelle.",
      coverage: "Moodle: vollständig / teilweise / nicht relevant; CIS: vollständig / teilweise / nicht relevant.",
    )

    #v(8mm)
    #align(center)[
      #sb-chip("Ende des Komponenten-Showcase", tone: "success")
    ]
  ],
)
