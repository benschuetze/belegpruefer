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
- **Append-only:** UPDATE/DELETE auf `decisions` und `reviews` schlägt fehl.
- **Storno statt Änderung:** festgeschriebene Buchung unveränderbar, Korrektur ergibt Storno + neue Buchung, Summe stimmt.
- **Abbruch ohne halbe Daten:** Fehler beim Schreiben → weder Protokoll noch Buchung, Status `fehler`, Wiederholung klappt.
- **Injection:** Anweisung im Belegtext führt nie zu `automatisch` mit dem eingeschleusten Konto.
- **DATEV:** Kopfsatz, Spalten, Komma, TTMM, Längen, Windows-1252.

## Hinweise

- Ports der E2E-Läufe: 5299 (App), 5298 (Demo), 5334 (PGlite). Andere Projekte auf derselben Maschine nutzen 5199/5198/5434; deren Prozesse nicht beenden.
- „Sichtbar“ reicht nicht, wenn etwas überdeckt sein kann: `elementFromPoint` prüfen.
