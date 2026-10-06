# Direkter Mailzugriff: Entwicklungstest vom 6. Oktober 2026

Study Buddy kann mit der vorhandenen Kontoanmeldung selbst Mailkontext abrufen.
Die gemeldete Originalfrage scheiterte zuvor an der Worterkennung „E Mails“;
indirekte Anfragen wurden abgefangen und das letzte Satzwort als Suchfilter
verwendet. Dieser Vorfilter und das automatische Vorladen sind entfernt.
Der native Agent erhält Kontoregeln und verwendet die bestehenden freigegebenen
Werkzeuge für Inventar, paginierte Listen, sinnvolle Suche und Nachrichtenlesen.
Der Server prüft Anmeldung, Konto, Ordner, Besitzerthread und Arbeitsverzeichnis.
Dieser Pfad braucht keinen zusätzlichen Modellaufruf oder LangGraph-Mailworker.
Fehler unterscheiden fehlendes Konto, gesperrtes Lesen, fehlende/abgelehnte
Anmeldung und Verbindungsprobleme. Bereinigtes HTML wird begrenzt mitgeliefert,
wenn eine Nachricht keinen nutzbaren Textteil hat.

Die Abnahme erfolgte in der tatsächlichen Electron-App **Study Buddy (Dev)**,
`desktop-dev`, Codex `gpt-6.1-sol`, Balanced mit medium reasoning, mit dem
konfigurierten SOGo-Konto. Jeder Fall hatte einen frischen Chat und genau einen
natürlichen Benutzerprompt. Alle sechs finalen Fälle verwendeten dieselben
14 eingefrorenen Runtime-Dateien; sämtliche Hashes blieben unverändert.
Die ursprüngliche gespeicherte Fehlantwort ist die Baseline mit 0/4.
Die drei vergleichbaren Übersichten erreichen unabhängig jeweils 4/4;
die Suche ebenfalls 4/4. Negation und Entwurf bestehen separat.
Die genehmigte Kampagne empfiehlt und erhält die Entscheidung `accept`.

| Fall | Thread | Dauer | Unterschiedliche Header / Bodies | Mailoperationen I/L/S/R | Ergebnis |
| --- | --- | ---: | ---: | --- | --- |
| Originalfrage | `da60784d-143e-43dc-8a69-8a1aa3b314cf` | 279.19 s | 100 / 40 | 1/2/0/40 | Bestanden; 4/4 |
| Deutsche Variante | `aeea86c6-70b9-4e25-a47b-b2637784e31d` | 314.69 s | 60 / 43 | 1/3/0/43 | Bestanden; 4/4 |
| Englische Variante | `807e64d3-0ac9-4910-b7d0-a743c6c1f1bc` | 374.89 s | 80 / 31 | 1/4/0/35 | Bestanden; 4/4 |
| Gezielte Suche | `8449c42f-a551-4455-a816-f7b49c8790c1` | 77.03 s | 2 / 1 | 1/0/1/1 | Bestanden; 4/4 |
| Keine Mails lesen | `5ea456e8-b8bd-4b6d-bf13-45c5f2319985` | 8.95 s | 0 / 0 | 0/0/0/0 | Bestanden; kein Abruf |
| Nur Entwurf | `5042c3ad-a906-4c53-84e1-c64da8a0f104` | 5.51 s | 0 / 0 | 0/0/0/0 | Bestanden; kein Abruf |
| Frühe Diagnose (vor HTML-Ergänzung) | `9cdd858d-dc89-46e0-be64-276298b641c7` | 280.80 s | 100 / 39 | 1/4/0/40 | Diagnose, separat erhalten |

I/L/S/R bedeuten Inventar/Liste/Suche/Lesen. Wiederholte Leseaufrufe sind in der
Operationenzahl enthalten, nicht mehrfach in der Bodyzahl. Im Suchfall wurde
zusätzlich eine relevante Moodle-Seite tatsächlich gelesen; Formularbezug und
Abgabestatus wurden daraus belegt. Die beiden Fälle ohne Mailzugriff enthalten
überhaupt keine Tool- oder Freigabeereignisse, nur die jeweilige Chatantwort.

| Fall | Input gesamt | Davon gecacht | Frischer Input | Output | Reasoning-Output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Originalfrage | 1167178 | 1085952 | 81226 | 5278 | 1178 |
| Deutsche Variante | 917946 | 848512 | 69434 | 4611 | 504 |
| Englische Variante | 1173999 | 1106048 | 67951 | 7975 | 1660 |
| Gezielte Suche | 248601 | 215680 | 32921 | 965 | 44 |
| Keine Mails lesen | 24191 | 0 | 24191 | 166 | 0 |
| Nur Entwurf | 24193 | 0 | 24193 | 66 | 0 |
| Frühe Diagnose (vor HTML-Ergänzung) | 993608 | 923264 | 70344 | 5542 | 896 |

Dies sind die kumulierten, vom Provider gemeldeten Tokenwerte. Frischer Input ist
Gesamtinput minus gecachter Input. Modellaufruf- und Provider-Retryzahlen sind
nicht verfügbar und werden nicht geschätzt. Der direkte Mailpfad erzeugt keine
staged Workflowworker oder Workflow-Validierungswiederholungen. Zeiten und Tokens
sind Diagnosewerte; diese Reparatur behauptet keine allgemeine Beschleunigung.

**Verifikation:** 156 gezielte UI/Server-Tests in acht Dateien und 18
Wrapper/Package-Tests in drei Root-Dateien bestehen, zusammen **174**.
`vp check`, alle 13 Typecheck-Aufgaben und der Backend-Bundle-Build bestehen.
Sechs echte HTTP-Prüfungen bestätigen korrektes Inventar sowie Abweisung von
falschem Token, fehlendem/fremdem Besitzer, fremdem Arbeitsverzeichnis und
Mailmutation. Der unabhängige Integrationsreview hat keine offenen Codebefunde.
Konto-/Ordnergrenzen, ausgeschaltetes Lesen, Pagination, Authfehler,
Secret-Canaries, Provider-Kontext und HTMLfallback haben gezielte Regressionen.
Die neuen Root-Tests beweisen exakte Weiterleitung und sichere Verweigerung des
Repository-/Package-Fallbacks ohne Broker, ohne lokalen Workflow oder Tokenleck.
Sie sind eine reine Testerweiterung nach den Live-Runden; Runtime unverändert.

Alle erfolgreichen Mailreads wurden vom unveränderten Adapter erst nach
verifiziert erhaltenem Gelesen/Ungelesen-Status freigegeben. Original und Englisch
enthalten 40 bzw. 35 explizite Nachweise. Die deutsche Variante enthält 14
explizite Nachweise und 29 erfolgreiche Brokerresultate, deren Rohprüfwerte der
Agent für seine Ausgabe gekürzt hat. Diese Beweisarten sind getrennt erfasst.
Alle 29 rekonstruierten Nachrichten-IDs entsprechen bytegenau vorher gelisteten
IDs; keine fremden oder erfundenen Ziele. Alle eigenen Chats und Werkzeuge sind
terminal; keine eigenen Mail- oder Lernworkflow-Lanes verbleiben aktiv.
Mailversand und finale Quizabgabe wurden weder ausgeführt noch freigeschaltet.

**Grenzen:** Die Antworten benennen ihre tatsächlich geprüften Ordner, Seiten
und Nachrichten; ältere Mails, Gesendet und Anhänge wurden nicht vollständig
untersucht. Kleine Modellpräzisionsgrenzen bleiben dokumentiert: eine bedingte
Nachreichungsempfehlung ist nur allgemein belegt; die englische Antwort nimmt
Inhalt eines ungelesenen Rechnungsanhangs an, ohne einen Betrag oder eine
Fälligkeit zu erfinden. Ein zusätzlicher englischer Evidenzdateilink wurde nicht
auf Darstellung geprüft. Die angeforderten Chatantworten enthalten belegte
Nachrichtenreferenzen und Quellenlinks; kein PDF oder anderer Anhang war
angefordert. Diese Abnahme gilt für den Entwicklungsdesktop und das geprüfte
Konto/Profil, nicht als Windows-/Fedora-Package- oder installierte Releaseabnahme.
Die gemeinsamen Instruktionen und Metadaten sind für Codex, Claude und Cursor
regressionstestet; reale Desktop-Mailrunden wurden mit Codex durchgeführt.

Der frühe Diagnoselauf bleibt getrennt erhalten. Er lieferte bereits einen
belegten Überblick, zeigte aber den fehlenden HTMLfallback. Darauf folgte die
getestete Ergänzung und eine vollständige Wiederholung aller finalen Fälle.
Ein Testdriverproblem vor dem Absenden eines Drafts ist ebenfalls dokumentiert;
kein Chat erhielt einen Reparaturfolgeprompt.

Die private Rohmail-Evidenz bleibt lokal unter
`study-buddy-data/optimization-campaigns/direct-agent-email-access/evidence/`.
Die kompakte `reliability-report.json`, `final-checks.json` und die unabhängigen
`review-*.json` enthalten die nachvollziehbaren Prüfungen; dieser Bericht
enthält keine privaten Nachrichteninhalte oder Zugangsdaten.

UI-Abhängigkeit: `a0918bed6e30dd512f5f66d40d5389b59581bce7` auf `feat/study-buddy-provider-support`, lokal committed.
Root-Fallback, Regressionen, Pin und dieser Handoff sind im zugehörigen lokalen
Integrationscommit auf `feat/provider-support`. Nicht gepusht, gemergt, als
Installation deployed, paketiert, veröffentlicht oder release-accepted.
Die Änderungen bleiben im offenen Batch `0.2.3-alpha`; kein Versionssprung/Tag.
