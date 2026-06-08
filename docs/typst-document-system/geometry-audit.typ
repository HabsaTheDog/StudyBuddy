#import "study-buddy-components.typ": *

#set page(
  paper: "a4",
  margin: 14mm,
)
#set text(
  font: "New Computer Modern",
  size: 10pt,
  lang: "de",
)

= Flowchart-Geometrieprüfung

Die roten CeTZ-Debugrahmen zeigen die berechneten Bounding-Boxen. Eine
Freigabe ist nur zulässig, wenn keine Inhaltsrahmen kollidieren, alle Pfeile
an Knotenrändern beginnen und enden und alle Beschriftungen innerhalb ihrer
Knoten bleiben.

== Linearer Ablauf

#sb-flowchart-linear(
  (
    (title: "Quelle erfassen", subtitle: "Moodle / CIS / Datei", tone: "info"),
    (title: "Inhalt analysieren", subtitle: "Strukturierte Daten", tone: "primary"),
    (title: "Dokument formatieren", subtitle: "Komponenten auswählen", tone: "warning"),
    (title: "Typst validieren", subtitle: "Kompilieren und prüfen", tone: "success"),
  ),
  debug: true,
)

== Entscheidung

#sb-flowchart-branch(
  "Messwert erfassen",
  "im Bereich?",
  "Wert übernehmen",
  "Aufbau prüfen",
  "Ergebnis dokumentieren",
  debug: true,
)

#pagebreak()
= Blockdiagramm-Geometrieprüfung

#sb-block-diagram(
  (
    "Sensor",
    "Filter",
    "A/D-Wandler",
    "Regler",
  ),
  debug: true,
)

== Prüfkriterien

- Knotenrahmen überlappen einander nicht.
- Pfeile treffen geometrisch die Mitte der jeweiligen Knotenkante.
- Pfeilspitzen liegen nicht in Knoten oder Beschriftungen.
- JA/NEIN-Pfade sind durchgehend und eindeutig.
- Zusammenführungen besitzen genau einen sichtbaren Merge-Punkt.
- Text bleibt vollständig innerhalb des zugehörigen Knotens.

#pagebreak()
= Schaltplan-Geometrieprüfung

#sb-rc-schematic(debug: true)

== Prüfkriterien

- Leiter treffen Bauteilanschlüsse ohne sichtbare Lücken.
- Widerstand, Knoten und Ausgang liegen auf einer horizontalen Achse.
- Der Kondensatorzweig liegt exakt unter dem Ausgangsknoten.
- Beschriftungen überdecken weder Leiter noch Bauteilsymbole.
- Anschlussknoten, offene Klemmen und Masse sind eindeutig unterscheidbar.
