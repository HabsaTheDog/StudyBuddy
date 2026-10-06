# PostHog-Tracking-Audit – 14. September 2026

## Ergebnis und Geltungsbereich

Die Fehler waren nicht vollständig sichtbar: PostHog enthielt zwei `provider.install_failed`-Ereignisse von `0.2.2-alpha` im geprüften 24-Stunden-Fenster, zuletzt um `08:34:09Z`. Betriebssystem und Ursache fehlten. Start- und App-Updater-Fehler wurden nicht über diesen Pfad erfasst; die vorhandene Fehlerübersicht konzentrierte sich auf Gesprächs-/Run-Logs. Es waren **keine Alarme konfiguriert**. Damit bestand kein automatischer Warnweg zum Betreiber. Die Screenshots belegen Windows, die alten Analytics-Ereignisse allein nicht.

Geprüft wurden Desktop-/Renderer-Instrumentierung, Provider-Setup und Provider-Maintenance, Consent-Lifecycle, IndexedDB-Outbox, HTTP-Upload, SDK-Konfiguration, Sanitizer, Gesprächsexport, Website-Analytics und die Live-PostHog-Dashboard-/Projektkonfiguration. Dies ist kein Nachweis vollständiger Fehlerfreiheit, keine Penetrationsprüfung des PostHog-Servers und keine Abnahme eines veröffentlichten Windows-Pakets.

Die Änderungen am Client gehören in den offenen Entwicklungsbatch `0.2.3-alpha`. Es wurde kein App-Release und kein Website-Deployment veröffentlicht. Die neue PostHog-Übersicht ist bereits live: [Study Buddy Release Health](https://studybuddyanalytics.habsa.at/project/1/dashboard/7).

## Befunde und Änderungen

| Schwachstelle | Umsetzung | Verifikation/Grenze |
| --- | --- | --- |
| Frühe native Start- und Updater-Fehler fehlten | Privates natives Diagnosejournal, ausschließlich nach bereits erteilter aktueller Analytics-Einwilligung; maximal 64 Einträge/30 Tage; nur Kategorien, Version, Plattform und Zeit | Native Dateisystemtests für Consent, Widerruf, Wiederholung, Bestätigung und beschädigte Dateien; Übertragung erst bei funktionierendem Renderer |
| Renderer-Fehler umgingen den normalen Telemetrie-Bootstrap | Bootstrap auch in der Fehleransicht; begrenzte Listener für nicht behandelte Fehler/Promise-Rejections | Keine automatischen Stacktraces, URL-, DOM- oder Logtexte; kein Consent-Bypass |
| Codex-Onboarding hatte keine aussagekräftige Fehlerklassifikation | Kategorie, Phase, Dauer und Exitcode; wiederholte Terminalereignisse werden abgefangen | Abbruch heißt `cancelled`, nicht `failed`; fehlende alte Logs bleiben unbekannt |
| Provider-Update in Einstellungen war separat und unbeobachtet | Eigene `provider.update_*`-Ereignisse; verifizierter Erfolg, Fehler, unveränderte Version und fehlende Verifikation werden unterschieden | Exitcode 0 allein ist kein Erfolg; private Prozessausgabe wird nur lokal klassifiziert |
| Fremder Backend-Prozess erschien zuletzt nur als Timeout | Beobachteter Versionskonflikt bleibt im abschließenden Readiness-Fehler erhalten | Keine Behauptung, einen ursprünglichen Windows-Portkonflikt lokal reproduziert zu haben |
| Fehlende OS-/Schema-/Release-Metadaten | Schema 8 mit Plattformkategorie und Release-Kanal; bei nachgelieferten nativen Fehlern ursprüngliche Fehler-Version separat | Legacy-Daten werden nicht durch erfundene Windows-Zuordnung ergänzt |
| Gleiche Settings-Hydration deaktivierte SDK-Callbacks | Lebensdauer an Analytics-Generation und Consent statt jede Routen-Hydration gebunden | Regressionstest: identische Hydration bleibt aktiv, Widerruf deaktiviert |
| Consent konnte während asynchroner Arbeit widerrufen werden | Erneute Consent-Prüfung unmittelbar vor Enqueue, auch für Gesprächsexporte/Watermarks; laufende Worker abbrechen | Bereits serverseitig angenommene Ereignisse werden durch einen lokalen Widerruf nicht rückwirkend gelöscht |
| Spätes Retry konnte gelöschte Ereignisse neu anlegen | `markFailed` aktualisiert nur noch existierende Einträge | Regressionstest mit gelöschter Kategorie und verspätetem Fehler |
| Gemischte Uploads bestätigten/verwarfen alle Daten gemeinsam | Resultate pro HTTP-Teilrequest; nur fehlgeschlagene Teile erneut senden | Integrationstest: erfolgreiches Analytics-Batch wird bei AI-Fehler nicht wiederholt |
| Ungültiges/zu großes Batch konnte gesunde Nachbarn verlieren | 400/413-Batches aufteilen und fehlerhafte Einzelereignisse isolieren | HTTP-Regression; persistente Einzelablehnung wird diagnostiziert |
| Unbegrenzte Requests und problematische Retries | 15-Sekunden-Request-Timeout, Abbruchsignal, maximal vier parallele Requests; 408/429/5xx retrybar; Retry-After und Backoff begrenzt | Tests für Timeout, 408, 429, Teilfehler, Shutdown und Wiederaufnahme |
| Unsichere Dublettenvermeidung | Stabile UUID und ursprünglicher Zeitstempel für normale Events sowie nativen Journal-Transfer | PostHog-Deduplizierung ist eventual, kein Exactly-once-Versprechen für nachgelagerte Systeme |
| Queue-Status lud sämtliche Gesprächsinhalte gleichzeitig | Metadaten-Cursor für Kapazität/Status/Ablauf; begrenztes Laden fälliger Uploads | Bestehende Queue bleibt kompatibel, keine Datenbankmigration; kein gemessener Laufzeitgewinn behauptet |
| Unbegrenzte Metadaten-Rekursion und zusätzliche Secret-Formate | Begrenzte Tiefe/Feldzahl, Zyklenschutz, endliche Zahlen; auch PostHog-Admin-Token-Format redigiert | Canary-/Zyklus-/Grenzwerttests; Health-Ereignisse haben zusätzlich ein geschlossenes Feldschema |
| Unnötige SDK-Feature-Flag-Abfragen | Deaktiviert; Replay, Surveys, Autocapture und automatische Exceptions bleiben deaktiviert | Fehlererfassung erfolgt kontrolliert über inhaltsfreie Ereignisse |
| Virtuelle Heatmap-/Seitenadressen verwendeten T3-Code-Domain | Eigene reservierte virtuelle Adresse `https://app.study-buddy.invalid` | Nur Gruppierungsschlüssel, kein Netzwerkziel und keine Änderung an T3 Code; alte historische Gruppierung bleibt bestehen |
| Website-Widerruf setzte nur Identität zurück | Echte SDK-Abmeldung, Consent-Revision über Import/Capture, sichere Wiederaktivierung, Fallback bei gesperrtem Storage | Fünf neue Website-Tests, einschließlich Widerruf während SDK-Import und anderem Browser-Tab |
| Website-SDK konnte automatische Metadaten/Fehlertexte ergänzen | Geschlossenes Ereignis-/Feldschema in `before_send`, sichere Pfade, feste Fehlergründe, keine Personenprofile/Referrer/Kampagnendaten | Explizite separate macOS-Interesse-/E-Mail-Einwilligung bleibt unverändert; keine Vermischung mit allgemeinem Analytics-Consent |
| Vorhandener Dashboard-Check prüfte hauptsächlich Namen | Neues versioniertes Health-Werkzeug prüft Abfragen, Zuordnung, Besitzmarkierung und gespeicherte Inhalte | Sieben CLI-Tests; sieben HogQL-Abfragen live validiert und nach Anwendung zurückgelesen |
| Fehlerübersicht übersah Warnungen/Setup/native Fehler | Eigene inhaltsfreie Release-Health-Übersicht mit getrennten Kategorien und Warnungszählung | Die alte Detailübersicht bleibt beim bisherigen Betreiber-Script; ihr Fehlerfilter enthält weiterhin keine Warnungen |
| Fehlender Betriebswarnweg | Maschinenlesbarer `--health`-Check, Exitcode bei beobachteten Fehlern oder fehlender API-Prüfbarkeit | Kein heimlich installierter Scheduler/Empfänger; Benachrichtigungskanal ist noch festzulegen |

## Live-Konfiguration und Datenschutz

Die Live-API bestätigt `anonymize_ips=true` und `session_recording_opt_in=false`. Die Prüfung fragte aggregierte Fehlerzahlen und Konfiguration ab; keine Gesprächsinhalte, E-Mail-Adressen oder Nutzerkennungen wurden in den Auditbericht übernommen. Administrative Zugangsdaten stammen ausschließlich aus der dokumentierten lokalen Credential-Übergabe und wurden nicht ausgegeben oder eingecheckt.

Das neue Verwaltungswerkzeug verwendet eine feste HTTPS-Origin, verhindert Redirects/Cross-Origin-Pagination, begrenzt Antworten und Seitenzahlen, setzt Request-Timeouts und unterdrückt Fehlerantworten mit potenziell privaten Inhalten. Ein HTTP-403 mit dem Standard-Python-User-Agent wurde mit einem klar bezeichneten `study-buddy-health/1.0`-User-Agent aufgelöst; die dokumentierten PostHog-Zugriffsrechte selbst waren vorhanden.

Health-Ereignisse benötigen nur Analytics-Einwilligung. Gesprächsinhalte, Gesprächslogs und Freitextfeedback bleiben an ihre gesonderte Einwilligung gebunden. Es wurden keine bestehenden Einwilligungen erweitert, kein Session Replay aktiviert und keine Retention-/Backup-Regeln verändert. Zeitfilter in Dashboards beweisen keine physische Löschung.

## Verbleibende Grenzen und Freigabegates

- Ohne Einwilligung, bei dauerhaft fehlendem Netzwerk, verweigertem lokalen Speicher oder einem nie wieder funktionierenden Renderer bleiben Fehler remote unsichtbar. Ein Diagnosejournal darf diese Grenze nicht durch heimliche Übertragung umgehen.
- Journal-Deduplizierung fasst gleiche Fehler innerhalb einer Minute zusammen; Renderer-Listener sind begrenzt. Die Fehlerzahlen sind daher beobachtete Signale, keine vollständige Crashzählung.
- `dropped_count` ist kumulativ seit Queue-Erstellung/-Reset. Dashboards zeigen Maxima, summieren nicht wiederholt denselben Zähler.
- Fehlende Terminalereignisse sind keine bewiesenen Fehler; Datumsgrenzen, App-Ende und Consent-Wechsel beeinflussen Start-/Erfolgszahlen. Noch keine belastbare prozentuale Erfolgsquote aus den Legacy-Ereignissen ableiten.
- Website-Wartelisten-Anti-Spam, garantierte E-Mail-Zustellung, Infrastrukturkapazität, Backup-Wiederherstellung und physische Retention sind separate Betriebsaufgaben; sie wurden hier nicht neu abgenommen.
- Benachrichtigung erst nach Auswahl des Kanals/Empfängers und anschließendem Zustelltest. E-Mail, Slack und – abhängig von der installierten PostHog-Version – Discord/Teams/Webhooks sind Optionen. Vorschlag: neue Start-/Updatefehler, gehäufte Providerfehler, Cooldown und Wiederherstellungsmeldung.
- Vor Veröffentlichung: eingefrorenen exakten Kandidaten unter sauberem Windows und Fedora installieren; Consent an/aus, Offline/Online, Upgrade, T3-Code-Koexistenz, fehlerhafte Codex-Installation und native Wiederanlaufdiagnosen vollständig prüfen. Quelltests sind keine native Paketabnahme.

## Reproduktion der Prüfungen

Erfolgreiche Prüfungen: **1.185 Web-Unit-Tests** auf dem abschließenden Stand, darunter 102 fokussierte Web-Telemetrietests; 168 native/shared/server-Telemetrie- und Maintenance-Tests; 11 Website-Tests einschließlich fünf neuer Consent-/Privacy-Fälle; sieben Infrastruktur-CLI-Tests; ein gezielter Chromium-Test des One-click-Provider-Updates. Vollständiges Fork-Format/Lint und alle 13 Workspace-Typprüfungen bestanden.

Scoped Commits: App/Fork `23e6ac132`, Website `5d9ba28`, Infrastruktur `e5f2c2c`. Bereits vorhandene Änderungen in allen drei Worktrees wurden erhalten und nicht in diese Commits aufgenommen.

Der zusätzliche breite Web-/Chromium-Lauf meldete **20 fehlgeschlagene Browser-Tests in vier Dateien** (`ChatView.browser.tsx`, `SettingsPanels.browser.tsx`, `ProviderModelPicker.browser.tsx`, `ChatMarkdown.browser.tsx`) und einen unbehandelten Fehler bei der Auflösung der primären Umgebung. Die gezielte Provider-Update-Prüfung wurde danach separat erfolgreich wiederholt. Die übrigen Browser-Befunde sind offen; ihre vollständige Ursachen-/Baseline-Abgrenzung war nicht Bestandteil dieses Tracking-Audits. Deshalb keine Gesamt- oder Releasefreigabe.

Im Fork: `vp check`, `vp run typecheck`; Web-Tests **aus `apps/web`**, damit die Web-Aliase geladen werden; native/shared/server-Telemetrietests aus dem Fork. Ein zunächst vom Fork-Root gestarteter gemischter Web-Lauf scheiterte an fehlenden `~/`-Alias-Auflösungen und wurde nicht als Produktfehler gewertet.

Website: `npm run check` (Typen, Unit-Tests, Build und Dist-Vertrag). Infrastruktur: `python3 -m unittest discover -s scripts -p test_posthog_health.py`, danach `scripts/posthog-health.py --check`, `--audit` und `--health` mit dokumentierter Credential-Übergabe. Der Live-Health-Check meldete erwartungsgemäß `attention_required`/Exit 1 aufgrund der zwei beobachteten Installationsfehler, nicht fälschlich einen gesunden Zustand. Details stehen im Infrastruktur-Runbook `docs/posthog-health.md`.

## Referenzen

- [PostHog Event-Deduplizierung](https://github.com/PostHog/posthog.com/blob/master/contents/docs/data/events.mdx): UUID, Eventname, Zeitstempel und distinct_id müssen stabil bleiben; Zusammenführung erfolgt asynchron.
- [PostHog Alarme](https://posthog.com/docs/alerts): Empfänger, Kanäle, Schwellen und Intervalle; Funktionsumfang des selbstgehosteten Builds separat prüfen.
