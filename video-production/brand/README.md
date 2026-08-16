# Study Buddy Video Brand

Status: Markenquelle bestätigt; erste Motion-Test-Typografie und Dark-Background-Logo-Adaption `proposed`  
Erstellt: 2026-08-13  
Geltungsbereich: wiederverwendbare Design Language für Study-Buddy-Werbespots und Produktvideos

## Markenquelle

Die kanonische Corporate Identity bleibt in [`../../CI/`](../../CI/). Originaldateien werden für Videoproduktionen nicht überschrieben. Jede Video-Variante wird unter `assets/derived/` abgelegt und mit Quelle, Zweck, Änderung und Review-Status dokumentiert.

## Bestätigte Farbwerte

| Token | Wert | Videoverwendung |
| --- | --- | --- |
| `brand-blue` | `#323a61` | Primärfarbe, Flächen, UI-Rahmen, Headlines |
| `brand-blue-dark` | `#19254b` | Dunkler Hintergrund und tiefste Markenfläche |
| `brand-gold` | `#dfbb63` | Fokus, aktive Quelle, Schlüsselaktion |
| `brand-gold-dark` | `#c3994d` | Goldschatten und zurückgenommene Akzente |

Gold bleibt Akzent und wird nicht zur dominanten Grundfläche. Neutrale Töne werden in Richtung Markenblau getönt; reines Schwarz oder Weiß wird nur verwendet, wenn Kontrastmessungen es erfordern.

## Logo-Inventar und Provenienz

| Quelle | Abmessung | SHA-256 | Vorgesehene Rolle |
| --- | ---: | --- | --- |
| `CI/logo.png` | 1400×1400 | `328b0d127b3cb41e91c2dd65691166c52ed2ab36f04061d9d2b1ab81b2157dce` | Primärmarke auf hellen oder neutralen Flächen |
| `CI/logo_highlight.png` | 1400×1400 | `4855a65ea807f0fdf6063889534226e1f33733fbd62bc04fb5c6e6bf445e15b3` | Goldbetonte Variante für dunkle Hintergründe |
| `CI/logo_title_below.png` | 2142×2016 | `acdc405c17eeaa96642310e3a5443712aa44c60082b8657e794bc67c4fdb1027` | Endcard/Brand-Lockup mit Wortmarke |

## Abgeleitete Video-Assets

Erste review-pflichtige Variante:

- `assets/logos/logo-highlight-source.png`: byte-identische Arbeitskopie von `CI/logo_highlight.png` für dunkle Videohintergründe; keine grafische Veränderung; SHA-256 `4855a65ea807f0fdf6063889534226e1f33733fbd62bc04fb5c6e6bf445e15b3`; Status `proposed` bis zum Motion-Review.

Weitere vorgesehene Varianten:

- optimierte Marke für dunklen Hintergrund;
- optimierte Marke für hellen Hintergrund;
- kontrastgesicherte Outline-Variante für bewegte oder unruhige Flächen;
- kompakte Endcard-Lockup-Variante für 9:16;
- breite Endcard-Lockup-Variante für 16:9.

Generative Neuzeichnungen des Logos sind nicht vorgesehen. Varianten werden aus den kanonischen Dateien abgeleitet und bleiben visuell überprüfbar.

## Typografie

Erstes Testsystem, noch nicht freigegeben:

| Rolle | Schrift | Datei | SHA-256 | Status |
| --- | --- | --- | --- | --- |
| Display | Montserrat ExtraBold | `assets/fonts/Montserrat-ExtraBold.otf` | `1d701c2f3edf277eed83e4cc2e78908b0ef1a53c5420f02d1db7f2da2bc33d32` | proposed |
| UI/Body | Montserrat Medium | `assets/fonts/Montserrat-Medium.otf` | `9e2bff7923aaf42c5db116a1811f35ff41aa978abf091aed97ab5e1d0f052669` | proposed |
| Status/Metadata | Noto Sans Mono Variable | `assets/fonts/NotoSansMono-wght.ttf` | `3c874b97ce11dc54de004c81df02c8f0974033ed1b113377130cbdd71d478f11` | proposed |

Die Kombination wird im Motion-Test als klare Trennung zwischen emotionaler Frage, Produkt-UI und technischen Quellenstatus gezeigt. Sie wird erst nach Alvaros visueller Prüfung als wiederverwendbare Spot-Typografie bestätigt.

Allgemeine Voraussetzungen:

- deterministisch und offline renderbar oder als lokale `@font-face`-Datei eingefroren;
- große, in Social-Feeds lesbare Schriftgrade;
- maximal eine expressive Schrift pro Szene;
- klare Trennung zwischen Markenbotschaft und technischen Quellen-/Statuslabels;
- keine unprotokollierte Systemfont-Fallback-Kette.

## Review-Regel

Palette und Quelllogos sind bestätigt. Jede neue Logo-, Font- oder Layoutvariante bleibt `proposed`, bis Alvaro sie ausdrücklich freigibt. Verworfene Varianten werden nicht gelöscht, sondern mit Grund als `rejected` dokumentiert.
