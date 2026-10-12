---
name: e-ink-design
description: Use when building or changing any UI in the Belegprüfer, so new screens follow the e-ink ledger look (paper, ink, pen blue, double-underlined sum, pixel labels).
---

# E-Ink-Kassenbuch

Quelle aller Werte: `app/app.css` (Tokens auf `:root`, Nacht invertiert). Komponenten lesen nur Tokens: `bg-paper`, `bg-card`, `text-ink`, `text-muted-ink`, `text-pen`, `bg-pen-paper`, `text-danger`, `border-ink`.

## Regeln

- Pro Ansicht genau eine Hauptzahl in `.summe` (Stiftblau, doppelt unterstrichen). Die Antwort zuerst, dann die Daten.
- Jede große Zahl lässt sich nachrechnen: Kassenbuchzeilen mit `<LedgerLine>` (Label, `.leader`, Wert).
- Labels über Zahlen: `.pixel`. Beträge: `<Amount>` bzw. `.num`.
- Objekte: `.ink-card` (2px Tinte, Radius 3.2px). Kein Schatten, kein Verlauf, kein Gelb, keine Pillen, keine Emojis.
- Knöpfe `.btn` (Primär Tinte, `.secondary` gedämpft), Filter und Umschalter `.chip` mit `aria-pressed` oder `aria-current`.
- Hinweise `.note` (Stiftblau), Einwände und Fehler `.note-danger`.
- Mockdaten sichtbar kennzeichnen (`.pixel` „Mockdaten“ in `.note`).
- Zweispaltig erst ab 900px, darunter einspaltig. Kein horizontales Scrollen bei 375px.

## Prüfen

Skill `verify`: `pnpm check`, dann die Seite hell und dunkel auf 375px und Desktop ansehen. Doppellinie der `.summe` darf nichts überlappen.
