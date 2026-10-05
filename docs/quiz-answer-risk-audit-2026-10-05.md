# Minitest: Prüfung des Punktverlusts und Antwortvertrags

Stand 5. Oktober 2026. Der Nutzer meldet 9/10 nach der Abgabe des ersten Versuchs. Alle zehn archivierten Fragen wurden unabhängig erneut geprüft, einschließlich Originalgrafiken, Checkbox-/Cloze-Antworten und sämtlicher Drag-and-drop-Kärtchen. Die gespeicherten Antworten stimmen mit den vorher erfassten Controls überein. Es wurde kein Übertragungsfehler gefunden.

Die genaue Ursache des offiziellen Punktabzugs bleibt offen: Die authentifizierte [Quizübersicht](https://moodle.technikum-wien.at/mod/quiz/view.php?id=2318134) bestätigt Versuch 1 als beendet (5. Oktober, 17:58 Uhr) und zeigt die Rückmeldung als **6.10.2026 23:59 verfügbar**. Sie liefert aktuell weder den Review-Link noch eine Bewertung je Frage. 9/10 ist hier die Nutzerbeobachtung, keine aus der Übersicht unabhängig gelesene Note. Verdeckte Fragenlösungen wurden nicht erschlossen; es wurde kein weiterer Versuch begonnen.

## Prüfung aller zehn Fragen

Die Aussagen dieser Tabelle sind eine mathematische Neubewertung, kein offizieller Moodle-Lösungsschlüssel.

| Frage | Gespeicherte Antwort | Ergebnis der Neubewertung |
| --- | --- | --- |
| 1 | Markierter Flächeninhalt 2 | Originalgrafik zeigt [1,∞); Integral von x^(-3/2) ergibt 2. Korrekt. |
| 2 | Nur „uneigentlich integrierbar“ | Integral von 1/(1+x²) über (-∞,0] ergibt π/2; nur ein singulärer Randpunkt. Korrekt. |
| 3 | Wahr | Nichtnegative integrierbare Majorante g≥|f| ergibt absolute Konvergenz im Kurskontext. Korrekt. |
| 4 | Divergent | exp(ωt) wächst auf der positiven Halbachse für ω>0. Korrekt. |
| 5 | Falsch / Wahr / Wahr | Die dritte Aussage ist der kritische Kandidat: unbedingte Zerlegung trotz innerer Singularität, ohne die nötigen Existenzbedingungen. Wörtlich ist Falsch / Wahr / Falsch begründet; eine formale Zerlegungslesart kann eine andere Bewertung erklären. |
| 6 | Nur 0 | Der Text verlangt ausdrücklich a∈ℝ; 0 ist ein singulärer Randpunkt. −∞ gehört nicht zur genannten Domäne. Korrekt unter dem gedruckten Wortlaut; ein anders gesetzter Moodle-Key wäre damit in Konflikt. |
| 7 | Nur [1,∞) | Integral von exp(-x)/2 ist dort 1/(2e); angebotene Intervalle mit unterem Rand −∞ divergieren. Korrekt. |
| 8 | 0,5 / 0,25 / div | Drei Grenzwerte erneut berechnet. Korrekt. |
| 9 | 2 / 1 / 0 / 2 | Singuläre Randpunkte unabhängig von Konvergenz gezählt. Korrekt. |
| 10 | Plätze 1–6: 7 / 6 / 4 / 5 / 6 / 8 | Originalgrafik und Kärtchen ergeben: konvergent mit exp(-x); divergent mit 1/x; konvergent mit 1/x². Wiederverwendbares „konvergent“ korrekt zweimal verwendet. |

## Was an Frage 5 schiefgegangen sein könnte

Die erste Aussage schließt endliche Intervalle mit unbeschränktem Integranden aus und ist falsch. Die zweite erlaubt die getrennte Grenzwertberechnung ausdrücklich „falls sie existieren“ und ist wahr. Die dritte behauptet die Summenidentität allein aus der inneren Unbeschränktheit. Sie enthält die Existenzvoraussetzung nicht.

Gegenbeispiel zur unbedingten Wertgleichung: f(x)=1/x auf [-1,1] mit c=0. Links geht das abgeschnittene Integral gegen −∞, rechts gegen +∞. Die Summe −∞+∞ ist nicht definiert, das gewöhnliche uneigentliche Gesamtintegral existiert nicht. Der symmetrische Cauchy-Hauptwert 0 ist ein anderer Begriff.

Die ursprüngliche Antwort begründete „Wahr“ mit einer ergänzten Konvergenz-/Zerlegungsinterpretation und meldete dabei 0,98 Confidence ohne Risk-Flag. Als Beleg diente später ein positives Spezialbeispiel mit 1/x²; das beweist keine allgemeine Aussage für vorzeichenwechselnde Funktionen. Der zitierte Fragepacketpfad belegt den Wortlaut, aber kein Lesen der genau genannten Definition 2.35.

Der [zugewiesene Studienbrief 22](https://moodle.technikum-wien.at/mod/resource/view.php?id=2318214), Abschnitt 22.3, Definition 22.23 (PDF-Seite 18, gedruckte Seite 17), enthält Existenzbedingungen ausdrücklich. Satz 22.25 (PDF-Seite 20, gedruckt 19) stützt die Majoranten-/Minorantenprüfungen. Die in Frage 5 genau referenzierte Goebbels/Ritter-Definition 2.35 konnte nicht über den normalen Quellenbroker gelesen werden: Der Kurslink führt außerhalb seiner erlaubten Portalursprünge. Die öffentliche [Verlagsseite des Buches](https://link.springer.com/book/10.1007/978-3-662-57394-5) liefert keinen hier geprüften Wortlaut dieser Definition. Deshalb ist Frage 5 ein begründeter Verdacht, kein bewiesener offizieller Punktverlust. Ohne Teilpunkte/Key darf auch aus exakt 9/10 keine bestimmte Teilantwort hergeleitet werden.

## Umfang der Altfragenprüfung

Geprüft wurden sämtliche zehn gespeicherten Fragen dieses Versuchs. Zusätzlich wurde der aktuelle [Kurskatalog](https://moodle.technikum-wien.at/course/view.php?id=33590) auf weitere Altfragen-/Altprüfungsbestände durchsucht; ein separat so benannter Bestand ist dort nicht gefunden worden. Andere Minitests wurden nicht gestartet. Eine vollständige geheime Moodle-Fragenbank oder künftig erst freigegebene Rückmeldungen werden hier nicht als geprüft ausgegeben.

## Implementierte Verbesserung

- Der bestehende Fragepacket- und native Solverauftrag verlangt Prüfung von Quantoren, Domäne, Existenzbedingungen, Gegenbeispielen und tatsächlich entscheidenden Quellen. Antwortändernde Voraussetzungen dürfen nicht still ergänzt werden.
- Jeder neue Solver soll risk_flags ausdrücklich liefern. Fachlich aufgelöste Annahmen werden begründet; ungelöste Auslegungen mit unterschiedlichen Antworten müssen sichtbar bleiben. Vollständige Fragenabdeckung rechtfertigt keine geratenen Antworten.
- Der direkte Toolvertrag akzeptiert jetzt nichtleere Risikofelder und gibt vor jeglichem Fill/Save eine strukturierte needs_clarification-Antwort. Ein Risiko in der zweiten Frage stoppt auch die erste Frage dieser Seite; Confidence 0,98/0,99 setzt dies nicht außer Kraft. Freie Risikotexte werden nicht in Toolantworten reflektiert.
- Erfolgreiche Speicherprüfungen sind ausdrücklich verification_scope=response_persistence und answer_correctness=not_assessed. Auch eine mathematisch falsche, korrekt gespeicherte Antwort bleibt keine fachliche oder offizielle Richtigkeitsbestätigung.

Keine zusätzliche Modellstufe, kein kursabhängiger Matcher, keine neue Abgabe-/Versuchsberechtigung. Vorhandene ältere Aufrufer dürfen aus Kompatibilitätsgründen risk_flags weiterhin weglassen; der Schutz setzt eine vom Solver tatsächlich gemeldete Unsicherheit voraus. Die Prompts fördern diese Erkennung, können sie nicht beweisen oder mathematische Fehler generell ausschließen.

## Validierung und Stand

- Vier gezielte Toolregressionen gingen von RED zu GREEN: hohe Confidence mit Risiko; gemischte Seite; fachlich aufgelöste Qualifikation; mathematisch falsche, dennoch gespeicherte Antwort ohne Richtigkeitsbehauptung. 47 DirectQuiz-Tests bestanden.
- Vollständige Root-Suite: **1.733 bestanden, vier bestehende Skips, 179 Dateien, 106,35 s**. Nach der abschließenden reinen Promptpräzisierung bestanden die 79 relevanten Root-Tests und 13 UI-Brief-/Profiltests erneut. Root-TypeScript sowie vollständiges UI-Format/Lint und alle 13 UI-Typechecks bestanden.
- Echter Offline-Modelltest mit der durch den App-Preflight belegten **Codex-CLI 0.160.0**, unverändertem **Balanced / quiz_answer / gpt-6.1-sol / high**: vier Fälle. Der kritische Q5-Vorschlag erzeugte Confidence 0 und konkrete Risiken; der explizite Real-Domänenfall wählte nur 0 ohne erfundenes Risiko; eine fachfremde Sensor-Normierung a/a erkannte das fehlende a≠0. Ein ausdrücklich konditionierter Integral-Kontrollfall wurde zunächst übervorsichtig blockiert. Dieser Fehlalarm ist als Fehlversuch erhalten.
- Die bestehende Anweisung wurde daraufhin präzisiert: Ausdrückliche hinreichende Prämissen und eine gültige Herleitung können die Frage entscheiden; eine engere oder fehlende Referenz allein ist kein antwortänderndes Risiko. Zwei echte Wiederholungen mit denselben Fragen, derselben CLI und Modellpolitik: **Q5 bleibt ungeklärt und blockiert; der konditionierte Kontrollsatz ergibt Wahr, Confidence 0,99 und keine Risiken.** Keine Modell-/Authentifizierungsänderung, kein Fallback, keine zusätzlichen Produktionsmodellstufen.
- Ein vorheriger isolierter SDK-Diagnoseaufruf verwendete den ungeeigneten lokalen 0.147-Standardpfad und lieferte keine Antwort. Er zählt nicht als Produktionstest oder Prompt-PASS; seine genaue ursprüngliche Transportursache wurde vom Diagnosehelper nicht erhalten. Die sechs tatsächlichen App-CLI-Replays sind getrennt dokumentiert.

Dies ist Evidenz für diese konkreten Fälle und den deterministischen Schreibschutz, keine Garantie auf zehn Punkte bei beliebigen Fragen. Es wurde keine neue native Desktop- oder benotete Moodle-Runde gestartet. Die Änderung wird lokal in der bestehenden Entwicklungsversion eingeordnet; kein Push, Deployment, Paket, Release oder veröffentlichter Tag.

Alle 65 geschützten Originaldateien und die drei ursprünglichen Erstversuchs-Ledgerdateien sind unverändert. In dieser Untersuchung: null Moodle-Antwortänderungen, null neue Versuche, null finale Abgaben. Die Quellen-/Modellprüfung ist eine Diagnose, keine neue Desktop- oder benotete Quizabnahme. Rohdaten bleiben unter study-buddy-data; keine privaten Kursfragen, Kontodaten oder Original-PDFs werden in Git kopiert.


Lokaler UI-Commit: `f19b91646de39944ee6461d354da97cc0b5245f5`. Die zugehörige Root-Änderung pinnt genau diesen Commit und umfasst den Antwortvertrag, fokussierte Tests, Fragepacket-Anweisungen und diesen Entwicklungsbericht. Keine dieser lokalen Änderungen wurde gepusht oder in einer installierten Releasefassung ausgeliefert.
