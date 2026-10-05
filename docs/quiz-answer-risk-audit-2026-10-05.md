# Minitest: Prüfung des Punktverlusts und Antwortvertrags

**Korrigierter Stand nach dem bestätigten Vergleich 9 → 8,67:** Der Nutzer hat ausschließlich die dritte Teilantwort von Frage 5 von Wahr auf Falsch geändert. Der zusätzliche Abzug passt zu einem Drittelpunkt. Damit ist Wahr für diese Teilantwort durch den kontrollierten Nutzervergleich als Moodle-akzeptiert belegt. Die frühere Vermutung, diese Teilantwort habe den ursprünglichen Punkt gekostet, und die dafür gegebene Falsch-Empfehlung werden zurückgenommen. Die theoretische Existenz-/Zerlegungsdiskussion war kein Beweis für den Bewertungsschlüssel.

Alle zehn archivierten Fragen wurden nochmals unabhängig geprüft, einschließlich nativer Fragetypen, ursprünglicher Antwortpläne, Reload-Controls, Originalgrafiken und Drag-and-drop-Zonen. Kein reproduzierter Übertragungs- oder Label-/Value-Fehler. Der konkrete ursprüngliche Punktabzug ist weiterhin nicht direkt nachgewiesen.

Die authentifizierte [Quizübersicht](https://moodle.technikum-wien.at/mod/quiz/view.php?id=2318134) zeigt inzwischen beide Versuche beendet, keine weiteren Versuche zugelassen und die Bewertungsmethode **Bester Versuch**. Unter dieser Methode bleibt der bessere erste Versuch maßgeblich. Rückmeldungen sind weiterhin erst **6.10.2026 23:59 verfügbar**; es gibt keinen entdeckten Review-Link oder Einzelnoten. Die Noten 9 und 8,67 sowie die einzige Änderung stammen aus der bestätigten Nutzerangabe, nicht aus einer unabhängig gelesenen Einzelbewertung. Die Tools haben in dieser Untersuchung keinen Versuch gestartet oder eine Antwort verändert.

## Prüfung aller zehn Fragen

Die Aussagen dieser Tabelle sind eine mathematische Neubewertung, kein offizieller Moodle-Lösungsschlüssel.

| Frage | Gespeicherte Antwort | Ergebnis der Neubewertung |
| --- | --- | --- |
| 1 | Markierter Flächeninhalt 2 | Originalgrafik zeigt [1,∞); Integral von x^(-3/2) ergibt 2. Korrekt. |
| 2 | Nur „uneigentlich integrierbar“ | Integral von 1/(1+x²) über (-∞,0] ergibt π/2; nur ein singulärer Randpunkt. Korrekt. |
| 3 | Wahr | Nichtnegative integrierbare Majorante g≥|f| ergibt absolute Konvergenz im Kurskontext. Korrekt. |
| 4 | Divergent | exp(ωt) wächst auf der positiven Halbachse für ω>0. Korrekt. |
| 5 | Falsch / Wahr / Wahr | Die dritte Teilantwort Wahr wird durch den bestätigten Einzelfeld-Scorevergleich gestützt. Ihre Änderung zu Falsch verursachte den zusätzlichen Drittelpunktverlust; die frühere gegenteilige Empfehlung ist zurückgenommen. |
| 6 | Nur 0 | Ein konkreter, unbestätigter Bewertungs-Konflikt: nur 0 erfüllt den gedruckten Real-Domänenwortlaut. Der Fragetyp ist aber Alles-oder-nichts; ein Schlüssel mit 0 und −∞ würde die fehlende ganze Frage erklären. Kein solcher Schlüssel ist aktuell gelesen worden. |
| 7 | Nur [1,∞) | Integral von exp(-x)/2 ist dort 1/(2e); angebotene Intervalle mit unterem Rand −∞ divergieren. Korrekt. |
| 8 | 0,5 / 0,25 / div | Drei Grenzwerte erneut berechnet. Korrekt. |
| 9 | 2 / 1 / 0 / 2 | Singuläre Randpunkte unabhängig von Konvergenz gezählt. Korrekt. |
| 10 | Plätze 1–6: 7 / 6 / 4 / 5 / 6 / 8 | Originalgrafik und Kärtchen ergeben: konvergent mit exp(-x); divergent mit 1/x; konvergent mit 1/x². Wiederverwendbares „konvergent“ korrekt zweimal verwendet. |

## Was der Scorevergleich tatsächlich belegt

Frage 5 ist eine Cloze-Frage mit drei Teilantworten. Genau ein Feld wurde geändert; bei sonst gleich gebliebenen Fragen/Antworten kann der zusätzliche Drittelpunktverlust diesem Feld zugeordnet werden. Das ist konkrete Bewertungsinformation und muss eine entgegenstehende theoretische Schlüsselvermutung überstimmen. Die ursprüngliche Antwort Wahr wird daher nicht weiter als Punktverlustquelle oder als zu ändernde Antwort ausgegeben.

Aus 9/10 allein folgt mathematisch noch nicht zwingend eine einzige komplett falsche Frage: Mehrere Teilabzüge könnten zusammen einen Punkt ergeben. Die bestätigte Einzelfeldänderung erklärt aber nur den zusätzlichen Abzug, nicht den ursprünglichen ganzen Punkt.

## Der ursprüngliche volle Punkt: konkrete Kandidaten

Die archivierten Fragen **2, 4, 6 und 7** sind nativ `multichoiceset`. Dieser Typ bewertet die komplette Auswahl nach **Alles oder nichts**: eine fehlende korrekte oder zusätzliche falsche Auswahl gibt null statt voller Bewertung. Das ist die [offiziell dokumentierte Bewertungsart](https://docs.moodle.org/503/en/All_or_nothing_multiple_choice_question_type), keine aus dem Gesamtwert geratene Gewichtung. Fragen 1 und 3 können mit ihrer jeweiligen Einzelantwort ebenfalls einen ganzen Punkt verlieren. Teilfragengewichte der übrigen Aufgaben sind ohne konkrete Bewertungsdaten nicht allgemein aus der Feldzahl abzuleiten.

Q2, Q4 und Q7 wurden samt ausgewählten und ausgeschlossenen Checkboxen nochmals geprüft: π/2/uneigentlich integrierbar; Divergenz für exp(ωt); nur [1,∞) für exp(-x)/2. Keine falsche Option oder vertauschte Auswahl gefunden. Q1, Q3, Q8, Q9 und alle sechs Q10-Zonen stimmen mit der mathematischen Neubewertung und den gespeicherten Kontrollwerten überein. Das ist keine serverseitige Einzelnotenbestätigung.

**Q6 ist der verbleibende konkrete, unbestätigte Kandidat.** Die Roh-TeX-Frage verlangt ausdrücklich a∈ℝ; nur 0 wurde angekreuzt, −∞ nicht. Mathematisch hat das Integral mit a=0 einen singulären unteren Rand. Bei a=−∞ ist der unendliche Rand ebenfalls singulär, aber −∞ gehört nicht zur ausgeschriebenen Domäne. Sollte der Autor trotzdem die Auswahlmenge **{0,−∞}** hinterlegt haben, kostet der fehlende Haken wegen Alles-oder-nichts den gesamten einen Punkt. Diese Kombination erklärt das beobachtete Defizit, belegt aber noch keinen tatsächlichen Moodle-Key. Sie ist keine Änderungsanweisung.

Wichtig beim späteren Review: **angezeigte Frage 6 = Slot 9**, question-2350411-9 / q2350411:9_choice*. Die angezeigte Frage 9 ist dagegen Slot 5. Der Agent darf diese Nummern nicht verwechseln. Erst die sichtbare Einzelbewertung kann Q6 bestätigen oder ausschließen; falls kein Item null hat, müssen die tatsächlichen Teilnoten anderer Fragen zusammengezählt werden.

Der [zugewiesene Studienbrief 22](https://moodle.technikum-wien.at/mod/resource/view.php?id=2318214), Abschnitt 22.3, definiert sowohl unendliche Grenzen als auch unbeschränkte Integranden als singuläre Fälle. Er liefert jedoch keinen gelesenen offiziellen Antwortschlüssel für die widersprüchliche Q6-Auswahl.

## Umfang der Altfragenprüfung

Geprüft wurden sämtliche zehn gespeicherten Fragen dieses Versuchs. Zusätzlich wurde der aktuelle [Kurskatalog](https://moodle.technikum-wien.at/course/view.php?id=33590) auf weitere Altfragen-/Altprüfungsbestände durchsucht; ein separat so benannter Bestand ist dort nicht gefunden worden. Andere Minitests wurden nicht gestartet. Eine vollständige geheime Moodle-Fragenbank oder künftig erst freigegebene Rückmeldungen werden hier nicht als geprüft ausgegeben.

## Implementierte Verbesserung und ihre Grenzen

- Der bestehende Fragepacket- und native Solverauftrag verlangt Prüfung von Quantoren, Domäne, Existenzbedingungen, Gegenbeispielen und tatsächlich entscheidenden Quellen. Antwortändernde Voraussetzungen dürfen nicht still ergänzt werden.
- Jeder neue Solver soll risk_flags ausdrücklich liefern. Fachlich aufgelöste Annahmen werden begründet; ungelöste Auslegungen mit unterschiedlichen Antworten müssen sichtbar bleiben. Vollständige Fragenabdeckung rechtfertigt keine geratenen Antworten.
- Der direkte Toolvertrag akzeptiert jetzt nichtleere Risikofelder und gibt vor jeglichem Fill/Save eine strukturierte needs_clarification-Antwort. Ein Risiko in der zweiten Frage stoppt auch die erste Frage dieser Seite; Confidence 0,98/0,99 setzt dies nicht außer Kraft. Freie Risikotexte werden nicht in Toolantworten reflektiert.
- Erfolgreiche Speicherprüfungen sind ausdrücklich verification_scope=response_persistence und answer_correctness=not_assessed. Auch eine mathematisch falsche, korrekt gespeicherte Antwort bleibt keine fachliche oder offizielle Richtigkeitsbestätigung.

Die Antwortpakete enthalten jetzt zusätzlich die aus dem genauen nativen Fragetyp bekannte Bewertungsart: `multichoiceset` → Alles-oder-nichts; übrige Typen bleiben hinsichtlich Methode/Gewichten unbekannt. Der Solver muss bei Alles-oder-nichts ausgewählte und ausgeschlossene Optionen prüfen. Ein offizieller Schlüssel und die konkreten Punkte werden dabei ausdrücklich nicht erfunden.

Keine zusätzliche Modellstufe, kein kursabhängiger Matcher, keine neue Abgabe-/Versuchsberechtigung. Vorhandene ältere Aufrufer dürfen aus Kompatibilitätsgründen risk_flags weiterhin weglassen; der Schutz setzt eine vom Solver tatsächlich gemeldete Unsicherheit voraus. Die Prompts fördern diese Erkennung, können sie nicht beweisen oder mathematische Fehler generell ausschließen.

## Validierung und Stand

Aktuelle Nachbesserung nach dem Scorevergleich: **93 relevante Regressionstests in drei Testdateien bestanden** (82,56 s), darunter die neuen Fälle für native Alles-oder-nichts-Bewertung und acht Kombinationen unbekannter/anderer Typen und Kontrollzahlen. Root-TypeScript und Git-Diffprüfung bestanden. Die folgenden umfangreicheren Suite-/Modellwerte stammen aus der vorherigen Risikovertragsänderung; sie werden nicht als neue Tests dieser Nachbesserung ausgegeben. Keine neuen Modellaufrufe oder Moodle-Antwortänderungen.

- Vier gezielte Toolregressionen gingen von RED zu GREEN: hohe Confidence mit Risiko; gemischte Seite; fachlich aufgelöste Qualifikation; mathematisch falsche, dennoch gespeicherte Antwort ohne Richtigkeitsbehauptung. 47 DirectQuiz-Tests bestanden.
- Vollständige Root-Suite: **1.733 bestanden, vier bestehende Skips, 179 Dateien, 106,35 s**. Nach der abschließenden reinen Promptpräzisierung bestanden die 79 relevanten Root-Tests und 13 UI-Brief-/Profiltests erneut. Root-TypeScript sowie vollständiges UI-Format/Lint und alle 13 UI-Typechecks bestanden.
- Echter Offline-Modelltest mit der durch den App-Preflight belegten **Codex-CLI 0.160.0**, unverändertem **Balanced / quiz_answer / gpt-6.1-sol / high**: vier Fälle. Der kritische Q5-Vorschlag erzeugte Confidence 0 und konkrete Risiken; der explizite Real-Domänenfall wählte nur 0 ohne erfundenes Risiko; eine fachfremde Sensor-Normierung a/a erkannte das fehlende a≠0. Ein ausdrücklich konditionierter Integral-Kontrollfall wurde zunächst übervorsichtig blockiert. Dieser Fehlalarm ist als Fehlversuch erhalten.
- Die bestehende Anweisung wurde daraufhin präzisiert: Ausdrückliche hinreichende Prämissen und eine gültige Herleitung können die Frage entscheiden; eine engere oder fehlende Referenz allein ist kein antwortänderndes Risiko. Zwei echte Wiederholungen mit denselben Fragen, derselben CLI und Modellpolitik: **Q5 bleibt ungeklärt und blockiert; der konditionierte Kontrollsatz ergibt Wahr, Confidence 0,99 und keine Risiken.** Keine Modell-/Authentifizierungsänderung, kein Fallback, keine zusätzlichen Produktionsmodellstufen.
- Ein vorheriger isolierter SDK-Diagnoseaufruf verwendete den ungeeigneten lokalen 0.147-Standardpfad und lieferte keine Antwort. Er zählt nicht als Produktionstest oder Prompt-PASS; seine genaue ursprüngliche Transportursache wurde vom Diagnosehelper nicht erhalten. Die sechs tatsächlichen App-CLI-Replays sind getrennt dokumentiert.

Diese älteren Modellreplays bewiesen den Umgang mit gemeldeter Unsicherheit, nicht einen falschen Q5-Schlüssel oder die Ursache des ursprünglichen ganzen Punktes. Der bestätigte spätere Scorevergleich widerlegt die frühere Q5-Empfehlung. Die generischen Schutzmaßnahmen bleiben nützlich; der eigentliche ursprüngliche Bewertungsfehler ist damit nicht behoben oder bewiesen.

Dies ist Evidenz für diese konkreten Fälle und den deterministischen Schreibschutz, keine Garantie auf zehn Punkte bei beliebigen Fragen. Es wurde keine neue native Desktop- oder benotete Moodle-Runde gestartet. Die Änderung wird lokal in der bestehenden Entwicklungsversion eingeordnet; kein Push, Deployment, Paket, Release oder veröffentlichter Tag.

Alle 65 geschützten Originaldateien und die drei ursprünglichen Erstversuchs-Ledgerdateien sind unverändert. In dieser Untersuchung: null Moodle-Antwortänderungen, null neue Versuche, null finale Abgaben. Die Quellen-/Modellprüfung ist eine Diagnose, keine neue Desktop- oder benotete Quizabnahme. Rohdaten bleiben unter study-buddy-data; keine privaten Kursfragen, Kontodaten oder Original-PDFs werden in Git kopiert.


Lokaler UI-Commit: `f19b91646de39944ee6461d354da97cc0b5245f5`. Die vorherige Root-Änderung `8857e8807340b95b37e6c0829e2fd742afe11bd6` pinnt genau diesen Commit und umfasst den Antwortvertrag, fokussierte Tests und Fragepacket-Anweisungen. Die aktuelle lokale Nachbesserung korrigiert diesen Bericht und ergänzt die native Bewertungsmetadaten; am UI-Pin ändert sie nichts. Keine dieser lokalen Änderungen wurde gepusht oder in einer installierten Releasefassung ausgeliefert.


Die Korrektur und der genaue native Bewertungsvertrag sind als eigene lokale Nachbesserung dokumentiert. Die alte Berichtsfassung und alle ursprünglichen Score-/Testbelege bleiben im Git-Verlauf bzw. den privaten Auditbelegen erhalten.
