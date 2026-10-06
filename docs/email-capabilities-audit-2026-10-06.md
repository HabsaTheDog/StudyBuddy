# Study Buddy: bestehende Mailfunktionen geprüft, 6. Oktober 2026

**Ergebnis: acht Fälle bestanden, ein Fall teilweise bestanden, ein Fall fehlgeschlagen. Die drei vorhandenen Funktionen sind grundsätzlich nachgewiesen, konsistente Zuverlässigkeit ist noch nicht erreicht.** Ein neuer gezielter Reparaturplan liegt als Entwurf vor; dessen erforderliche Planfreigabe ist offen. In diesem Audit wurde kein Runtime-Code geändert.

Geprüft werden alle drei Funktionen der vom Nutzer gezeigten Oberfläche: **Read email**, **Prepare drafts** (Text ausschließlich im Chat) und **Ask to send** (vollständige Nachricht anzeigen, native Freigabe vor Versand). Kein gespeicherter Kontodraft wurde hinzugefügt. Die Freigaben wurden für die Tests nicht erweitert.

Alle Livefälle laufen in der tatsächlichen Electron-App **Study Buddy (Dev)**, `desktop-dev`, mit dem konfigurierten SOGo-Konto, Codex `gpt-6.1-sol`, Balanced/medium. Jeder Fall verwendet einen frischen Quick Chat und genau einen natürlichen Prompt; kein Reparaturfolgeprompt. Runtime blieb unverändert auf Root `7a642b448b70a87b479aacd0d537cb1fcb42fc4d` und UI `a0918bed6e30dd512f5f66d40d5389b59581bce7`. Eine gleichzeitig laufende fremde Lernaufgabe wurde nicht unterbrochen.

**Genau eine echte Testmail** wurde mit ausdrücklichem Auftrag an die eigene konfigurierte Adresse versendet. Vor dem normalen nativen Freigabeklick wurden der vollständige immutable Payload und die sichtbare Karte geprüft: genau ein Selbstempfänger, identischer Absender, exakter Betreff und Nachrichtentext, keine CC/BCC oder Anhänge. Eine exklusiv angelegte Freigabeakte verhindert einen zweiten Testversand. Der Server protokolliert genau ein `email.sent` nach erfolgreicher Prüfung der Gesendet-Kopie. Ein unabhängiger frischer Chat findet genau eine Mail mit dem exakten Testbetreff im Posteingang und liest den identischen Inhalt; sie bleibt ungelesen. Die Suche lieferte fünf breite Header, die exakte Übereinstimmung wurde daraus korrekt gefiltert.

Zwei unterschiedlich formulierte Versandaufträge wurden an der tatsächlichen nativen Karte mit **Do not send** abgelehnt. Beide Requests wurden korrekt aufgelöst, beide Endantworten bestätigen keinen Versand und beide haben keine `email.sent`-Aktivität. Freundlicher und förmlicher Entwurf verwenden keinerlei Tools oder Freigaben; der zusätzliche Antwortentwurf liest gezielt die eigene Testmail und erstellt ausschließlich Chattext.

| Fall | Thread | Dauer | Mailoperationen I/L/S/R | Ergebnis |
| --- | --- | ---: | --- | --- |
| Ungelesene: erste Prüfung | `f05a135f-51ea-484b-bfca-235c3100d14b` | 204.22 s | 1/2/0/38 | Teilweise; 7 Lesefehler |
| Ungelesene: neue Formulierung | `c8b48f7d-5be6-4e45-bb20-e0e6f88c2737` | 61.64 s | 1/3/0/3 | Bestanden |
| Freundlicher Chatentwurf | `1462470c-d17f-4a3b-959d-5985f5cafe49` | 5.78 s | 0/0/0/0 | Bestanden |
| Förmlicher Chatentwurf | `d0706056-276d-4666-9bfc-07655d6c98e0` | 7.43 s | 0/0/0/0 | Bestanden |
| Versandvariante A: abgelehnt | `504b83d7-17f8-469d-85a4-12aa227f1103` | 44.96 s | 0/0/0/0 | Bestanden |
| Versandvariante B: abgelehnt | `d4cc1fb3-4383-450c-85d2-42e1f8c05e63` | 25.4 s | 0/0/0/0 | Bestanden |
| Einmaliger Versand an mich selbst | `5d91000c-d11a-468e-b16c-1a660d2ee682` | 31.66 s | 0/0/0/0 | Bestanden |
| Eingangskontrolle | `c8a023b6-e8ec-457b-9550-0a78df578fda` | 35.12 s | 1/0/1/1 | Bestanden |
| Antwortentwurf mit Mailkontext | `b12800fb-8691-4832-9ec0-55cdd480f841` | 32.52 s | 1/0/1/1 | Bestanden |
| Ungelesene: identischer Bestätigungsprompt | `7be7e0db-44cf-4248-838f-e20eb38b4458` | 335.25 s | 1/3/0/47 | Fehlgeschlagen; keine vollständige Antwort |

I/L/S/R = Inventar/Liste/Suche/Lesen. Versandzeiten enthalten die Wartezeit auf die geprüfte native Auswahl. Der erste Lesefall zählt alle 38 Versuche, davon 31 erfolgreiche Aufrufe für 30 verschiedene Nachrichten. Seine drei ausgewerteten Nachrichten sind belegt, aber sieben `reading-disabled`-Fehler verhinderten die sichere Gesamtauswahl der neuesten drei. Dieser Lauf bleibt **teilweise bestanden**. Die neue Formulierung prüft auf unverändertem Source-Stand korrekt die zuletzt eingetroffenen drei aus 37 ungelesenen Nachrichten, mit explizit erhaltenem Status und ohne Fehler. Die zusätzliche Wiederholung mit identischem Prompt schlägt fehl: 47 Leseversuche (38 parallele Erstabrufe, ein Doppelabruf und acht Fallbacks), 29 erfolgreiche Calls für 24 verschiedene Nachrichten. Der Agent selbst beendet 18 wartende Wrapperprozesse für 17 verschiedene IDs per SIGTERM. Das ist nachweislich kein 180-Sekunden-Timeout; ein solcher Timeout und ein Account-Mutex existieren im direkten Mailpfad nicht. Alle 29 erfolgreichen Reads enthalten erhaltenen Seen-Status. Die letzte Assistentennachricht ist ein Fortschrittshinweis, keine angeforderte abgeschlossene Tabelle/Auswertung. Die eigene Lane wurde gezielt über die native Stop-Schaltfläche beendet; administrative Turn-Endzustände ersetzen keinen fachlichen Erfolg. Ein Tool lieferte erst nach dem Turnende sein Ergebnis. Fehlende Headerdaten und nicht auf die bereits nach Ankunft absteigend selektierten UIDs ausgerichtete Headerausgabe erklären das unnötige Volllesen; präzise Upstream-Wartezeiten und verbliebene Backendpromises sind aus der Evidenz nicht beweisbar.

Die Ursache der früheren sieben Fehler ist bisher nicht belegt; die Wiederholung schreibt den ersten Befund nicht um. Ein gezielter Readonly-Review bestätigt die Policy-/Capability-Verweigerung; Auth-, Transport- und Read-State-Fehler verwenden andere Codes. Die eigene Servertrace und SQLite enthalten keine rekonstruierbare Policyhistorie. Ein möglicher konkurrierender Registry-Snapshot-Write wurde als unbewiesener Codepfad dokumentiert, nicht als erklärte Ursache oder behobener Fehler.

**149 automatische Bestandsprüfungen bestehen:** 145 in neun Suites für Toolzugriff, Lesebroker, Auth-/Policygrenzen, Sourceplattform, SOGo/Roundcube-Versandprofile, Vertragsvalidierung, Freigabelogik und Oberfläche; zusätzlich vier Reactor-Fälle (`sent`, `declined`, `delivery-error`, `invalid`) für die tatsächliche native Weiterleitung. Dies sind deterministische Fixtures/Mocks und kein weiterer realer Versand. Die 174 Reparaturtests und vollständigen Format-/Lint-/Typecheck-/Build-Prüfungen des vorherigen unveränderten Source-Stands sind in [direct-email-access-2026-10-06.md](direct-email-access-2026-10-06.md) dokumentiert; die Zahlen werden nicht als disjunkte Tests addiert.

| Fall | Input gesamt | Davon gecacht | Output | Reasoning-Output |
| --- | ---: | ---: | ---: | ---: |
| Ungelesene: erste Prüfung | 627914 | 585472 | 2331 | 267 |
| Ungelesene: neue Formulierung | 166819 | 132736 | 1124 | 79 |
| Freundlicher Chatentwurf | 24209 | 0 | 48 | 0 |
| Förmlicher Chatentwurf | 24207 | 9856 | 129 | 54 |
| Versandvariante A: abgelehnt | 73074 | 48256 | 303 | 0 |
| Versandvariante B: abgelehnt | 73122 | 48256 | 313 | 0 |
| Einmaliger Versand an mich selbst | 73156 | 48256 | 363 | 0 |
| Eingangskontrolle | 99923 | 73600 | 482 | 0 |
| Antwortentwurf mit Mailkontext | 113759 | 82816 | 458 | 9 |
| Ungelesene: identischer Bestätigungsprompt | 1507249 | 1449344 | 4618 | 1276 |

Dies sind kumulierte Providerwerte, keine zusätzlichen Workerzahlen. Modellaufrufe und Provider-Retries sind nicht verfügbar und werden nicht geschätzt. Es gibt keine staged Mailworkflowworker oder Workflow-Validierungswiederholungen. Rohnachrichten, Kontoinhalte und Freigabe-Requests bleiben privat in `study-buddy-data/email-capability-audit-2026-10-06/evidence/`; dieser Bericht enthält keine fremden Mailinhalte oder Zugangsdaten. Unabhängige `review-*.json` und `capability-report.json` halten Scope und Ergebnisse fest.

Die angezeigte Berechtigung **Prepare drafts** bedeutet ausdrücklich Chattext ohne Speicherung oder Versand. Kontodrafts, Anhänge herunterladen/versenden, Archivieren, Löschen, Verschieben und Änderungen am Lesestatus sind nicht Teil dieser drei vorhandenen Funktionen und wurden weder hinzugefügt noch als erfolgreich behauptet. Auth-/Policyfehler, widerrufene/abgelaufene/manipulierte Freigaben, Replay und parallele Freigabeversuche werden durch die vorhandenen automatischen Tests geprüft.

Diese Prüfung gilt für den Entwicklungsdesktop, das konfigurierte Konto und den genannten Provider. Die anderen unterstützten Adapter/Provider sind nur im Umfang der aufgeführten deterministischen Tests geprüft. Keine installierte Release- oder Windows-/Fedora-Paketabnahme, kein Push, Merge, Deployment oder Release. Der offene Entwicklungsbatch bleibt `0.2.3-alpha`.

Der gezielte Folgeplan liegt unter `study-buddy-data/optimization-campaigns/email-latest-read-reliability/goal.md`: geordnete tatsächliche Mailmetadaten, nötigenfalls begrenzte Providerparallelität, nur belegte Registry-Race-Fixes und drei frische Leserunden. Er ist nicht genehmigt oder umgesetzt. Keine weitere echte Mail wird versendet.

Abschlusskontrolle: alle zehn eigenen Sessions bereit/terminal; letzter fehlgeschlagener Lauf 58 gestartete und 58 abgeschlossene Tools. Keine eigenen Mail-Read-Wrapperprozesse mehr. Serverseitige Backendpromises sind nicht separat beobachtbar.
