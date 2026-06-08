# Flowchart Audit

Stand: 07.06.2026

## Stufe 1: deterministische Geometrie

- Knoten besitzen feste Breiten, Höhen und Mindestabstände.
- Kanten verwenden CeTZ-Anker statt typografischer Pfeilzeichen.
- Entscheidungswege sind orthogonal und getrennt geführt.
- Verzweigungen werden an genau einem markierten Punkt zusammengeführt.
- Beschriftungen haben feste Zeichenlimits und definierte Textflächen.
- Ungültige Knotenanzahl oder zu lange Beschriftungen brechen den Build ab.

## Stufe 2: visueller Double-Check

`flowchart-audit.pdf` rendert dieselben Komponenten mit aktivierten
CeTZ-Bounding-Boxen. Geprüft wurden:

- keine überlappenden Knoten oder Beschriftungen;
- Pfeile treffen die Mitte der jeweiligen Knotenkante;
- keine Pfeilspitze liegt innerhalb eines Knotens;
- JA/NEIN-Pfade sind vollständig und eindeutig;
- der Merge-Punkt ist sichtbar und nur einmal vorhanden;
- das Blockdiagramm besitzt eine gemeinsame horizontale Achse.

Ergebnis: bestanden.

## Schaltplanprüfung

- Der RC-Tiefpass wird geometrisch mit CeTZ aufgebaut.
- Leiter, Widerstand, Knoten und Kondensator teilen definierte Achsen.
- Offene Anschlussklemmen und der elektrische Knoten sind unterscheidbar.
- ASCII-Art und typografische Ersatzschaltbilder sind verboten.
- Eine CeTZ-Debugseite zeigt die Bounding-Boxen aller Schaltplanteile.
