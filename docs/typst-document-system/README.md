# Study Buddy Typst-Dokumentstandard

Freigegebene Referenz für den produktiven Study-Buddy-Typst-Agenten.

## Dateien

- `study-buddy-components.typ`: eigenständige Komponentenbibliothek
- `showcase.typ`: Showcase aller Regeln und Komponenten
- `showcase.pdf`: freigegebenes Referenzdokument
- `geometry-audit.typ`: Bounding-Box-Debugansicht
- `geometry-audit.pdf`: visuelle Geometrieprüfung
- `GEOMETRY-AUDIT.md`: dokumentierte Prüfkriterien

## Layout-Balance

Lernunterlagen sollen zuerst als gut lesbarer Fließtext funktionieren.
Info-Boxen, Callouts und Quellenboxen sind Akzente, keine Standardform für
Absatzinhalt.

- Jede fachliche Hauptsektion beginnt mit normalem Prosa-Text.
- Callouts werden nur für wichtige Felder eingesetzt: Sicherheitswarnungen,
  harte Randbedingungen, Prüfungstermine, zentrale Merksätze,
  Quellenkonflikte oder ungewöhnliche Abdeckungsprobleme.
- Quellenhinweise werden gruppiert. Wiederholte Routinequellen werden im
  Fließtext genannt oder in einer kompakten Quellenlage zusammengefasst,
  nicht nach jedem Abschnitt als eigene Box wiederholt.
- Checklisten sind für kurze Aktions- oder Reviewpunkte reserviert. Lange
  Vokabellisten, Abläufe, Vergleiche oder Datensammlungen gehören in Prosa
  plus freigegebene Tabellen.
- Visuelle Komponenten sollen nicht direkt hintereinander stehen, außer eine
  fachliche Struktur erfordert es eindeutig.

## Build

```bash
typst compile --package-path \
  ../../src/custom-skills/moodle/typst/vendor \
  showcase.typ showcase.pdf
```

Flowcharts und Blockdiagramme verwenden das fest gepinnte Paket
`@preview/cetz:0.5.0`. Die Diagramme besitzen feste Geometrie, echte
Knotenanker und Beschriftungslimits. CeTZ 0.5.0 und seine transitive
Abhängigkeit Oxifmt 1.0.0 werden unter
`src/custom-skills/moodle/typst/vendor/` mitgeliefert, damit produktive
Builds ohne Netzwerk und ohne globalen Typst-Paketcache funktionieren.

Der Showcase enthält außerdem einen geometrisch aufgebauten RC-Schaltplan
ohne ASCII-Ersatzdarstellung sowie eine Mathematik-Stressprobe mit Matrizen,
Matrixexponential, komplexen Größen, Integralen, verschachtelten Summen,
Fallunterscheidungen und einer mehrzeilig ausgerichteten Herleitung.
