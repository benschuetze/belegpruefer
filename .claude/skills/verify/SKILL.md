---
name: verify
description: Use for every code change before calling it done - writing the right tests, running them, and checking the UI in a real browser. Also use when a bug is reported, to first write a failing test that shows it.
---

# Prüfen, bevor etwas fertig ist

## Ablauf

1. Fehlerbericht: zuerst ein Test, der ihn zeigt (rot), dann Fix (grün).
2. Neue Funktion: Tests für das Versprechen an den Nutzer (Pflichtfälle unten).
3. `pnpm typecheck && pnpm lint && pnpm test`
4. UI geändert: `pnpm test:e2e` und die Seite im Browser ansehen (`pnpm db:local` + `pnpm dev`), hell und dunkel, Desktop und 375 px.
5. Berichten, was lief und was zu sehen war. Nichts melden, was nicht gelaufen ist.

## Testebenen

| Ebene | Werkzeug | Was |
|---|---|---|
| Unit | Vitest | `money.ts`, Parser, Validator, Entscheidung, DATEV-Format, Prompt-Aufbau |
| DB | Vitest + PGlite | Migrationen, Trigger (append-only, festgeschrieben), Kette mit Transaktion, Mandantentrennung |
| KI | Vitest + `MockLanguageModelV4` | kaputtes JSON, unbekanntes Konto, Fehler, Injection: immer `pruefen` |
| E2E | Playwright, `AI_MOCK=1` | Nutzerabläufe in Chromium (Desktop) und WebKit (iPhone) |
| Barrierefreiheit | axe | jede Seite ohne serious/critical, hell und dunkel |
| Qualität KI | `pnpm eval` | echtes Modell, nur nach Rückfrage |

## Pflichtfälle

- **Keine Datei verschwindet:** jede Datei ist neu, Duplikat oder mit Grund abgelehnt; jede Verarbeitung endet in `automatisch`, `pruefen` oder `fehler` mit Grund.
- **Unsicher → prüfen:** kaputtes JSON, unbekanntes Konto, fehlende Antwort, Einwand, Konfidenz unter Schwelle, Validator-Fehler.
- **Mandantentrennung:** fremde ID ergibt 404 (Seite, Datei, Aktion), Beispiele und Historie nur aus dem eigenen Mandanten.
- **Append-only, zwei Wände:** Die Laufzeitrolle darf UPDATE, DELETE, TRUNCATE und ALTER auf `decisions` und `reviews` gar nicht (`roles.test.ts`). Der Trigger lehnt sie auch dem Eigentümer ab (Test als `owner`, Meldung „nur anhängend“ prüfen).
- **Warteschlange:** Kein Beleg bleibt hängen (abgebrochener Lauf wird nach der Lease frei), keiner wird doppelt gebucht (abgelöster Lauf schreibt nichts).
- **Schalter scheitern geschlossen:** `DEMO_MODE` auf einer Datenbank mit fremden Mandanten → 503.
- **Storno statt Änderung:** festgeschriebene Buchung unveränderbar, Korrektur ergibt Storno + neue Buchung, Summe stimmt.
- **Abbruch ohne halbe Daten:** Fehler beim Schreiben → weder Protokoll noch Buchung, Status `fehler`, Wiederholung klappt.
- **Injection:** Anweisung im Belegtext führt nie zu `automatisch` mit dem eingeschleusten Konto.
- **DATEV:** Kopfsatz, Spalten, Komma, TTMM, Längen, Windows-1252.

## Leitplanken

- Regel, die nicht verletzt werden darf (Pfad, Commit-Größe, Geheimnis): als Hook oder Berechtigung in `.claude/settings.json` erzwingen, nicht nur in CLAUDE.md bitten. Hook mit Test in `tests/hooks/`: erlaubt, blockiert, kaputte Eingabe wirft nicht.
- Hook geändert: `pnpm exec vitest run tests/hooks`. Jeder Test braucht einen Fall, der ohne den Fix rot wäre.
- Prüfpunkte für Hooks (aus der Review der ersten Fassung):
  - Pfade normalisieren, bevor eine Regel greift: gegen `cwd` auflösen, Symlinks auflösen, klein schreiben (macOS und Windows unterscheiden Groß und Klein nicht), `/` statt `\`.
  - Lokal ist macOS (Groß/Klein egal), CI ist Linux (Groß/Klein zählt): Ein Vergleich darf nicht davon abhängen, dass `realpath` die Schreibweise angleicht. Beide Seiten klein schreiben.
  - Die Leitplanken schützen sich selbst (`.claude/settings*.json`, `.claude/hooks/`), sonst schaltet ein Edit sie ab.
  - git aus einem Hook nur im eigenen Repo oder dessen Worktrees und mit `-c core.fsmonitor=false`: Hooks laufen ohne Sandbox, und ein fremdes Repo kann über seine Konfiguration Befehle starten.
  - Was nur der Edit-Hook prüft, umgeht `sed -i`; deshalb prüft der Commit-Hook dieselben Dateien noch einmal am gestagten Stand.
  - Shell-Befehle mit Anführungszeichen, `$( )`, `cd`, `git -C`, `sh -c`, Unterschalen, Wrappern (`env`, `command`, `if … then`) zerlegen. Umleitungen (`2>&1`, `>/dev/null`) und Heredocs sind keine Argumente: sonst werden sie zu Pfadangaben, und der Commit wird gar nicht gemessen. Was sich nicht bestimmen lässt (Pfad aus Variable), wird zur Rückfrage, nicht still erlaubt.
  - Pfade in `git commit <pfad>` gelten relativ zum Verzeichnis des Commits, nicht zur Wurzel.
  - Ein git-Befehl vor dem Commit im selben Aufruf, der Index oder Arbeitsbaum ändert (`add`, `reset --soft`, `stash pop`, `checkout -- pfad`), macht jede Messung vorher wertlos: ablehnen.
  - Testbefehle aus dem Alltag gehören in die Tests (`2>&1 | tail`, Heredoc-Nachricht, `--amend --no-edit`): falsche Sperren sind genauso ein Fehler wie Lücken.
  - Inhaltsprüfungen auf die ganze Datei nach der Änderung anwenden, nie nur auf den Ausschnitt eines Edits.
- Blockiert ein Hook die eigene Arbeit: Meldung lesen und dem genannten Weg folgen, nie per Bash umgehen.

## Hinweise

- Ports der E2E-Läufe: 5299 (App), 5298 (Demo), 5334 (PGlite). Andere Projekte auf derselben Maschine nutzen 5199/5198/5434; deren Prozesse nicht beenden.
- Keine Verbindungs-URL mit `benutzer:passwort@host` als Literal in Tests oder Doku, auch nicht erfunden: GitGuardian meldet sie als Secret. URL im Test per `new URL()` zusammensetzen.
- Ablehnungen über die Meldung prüfen (`dbRefusal` aus `tests/helpers/db.ts`), nie mit nacktem `rejects.toThrow()`.
- Gegenprobe für Schutzcode: Schutz kurz entfernen, Test muss rot werden, dann zurück.
- Lokale PGlite bedient alle Verbindungen aus einem Backend: gegen sie `DATABASE_POOL_MAX=1` (E2E setzt das selbst). „unnamed prepared statement does not exist“ heißt genau das, nicht ein Fehler der App.
- Was nur kurz sichtbar ist (Warteschlange), für Screenshots per `page.route` verzögern.
- „Sichtbar“ reicht nicht, wenn etwas überdeckt sein kann: `elementFromPoint` prüfen.
- E2E-Helfer, die auf einer Seite klicken: erst `data-hydrated` abwarten (sonst schickt der Browser das Formular nativ ab). Läuft auf der Seite ein Poller (Warteschlange), vor dem nächsten `goto` auf Netzwerkruhe warten: Ein abgebrochener `.data`-Request löst in React Router einen harten Reload aus, der das `goto` unterbricht. Wackelnde Tests mit `--repeat-each 5` prüfen, Ursache im Trace suchen.
