# CLAUDE.md

Belegprüfer: Eingangsrechnungen mehrerer Mandanten auslesen, nach SKR03 kontieren, von einem zweiten Agenten prüfen lassen, automatisch buchen oder zur Prüfung vorlegen, festschreiben, als DATEV-Buchungsstapel exportieren. Architektur und Entscheidungen: `README.md`.

## Stack

React Router 7 (Framework-Modus) · TypeScript strict · Drizzle ORM · Neon Postgres (Frankfurt) · Vercel · Vercel AI SDK mit Claude · Zod · Tailwind · Vitest mit PGlite · Playwright mit axe · Biome · GitHub Actions

## Befehle

```
pnpm db:local            # Postgres ohne Installation (PGlite), Port 5433, mit Demo-Belegen
pnpm dev                 # Entwicklungsserver
pnpm typecheck           # react-router typegen && tsc --noEmit
pnpm lint                # biome check .
pnpm test                # Vitest: Unit- und DB-Tests (PGlite, kein Netz, kein LLM)
pnpm test:e2e            # Playwright: Ports 5299/5298/5334, Agenten per AI_MOCK=1
pnpm check               # alles oben außer dev
pnpm db:generate         # drizzle-kit generate (nur über Skill db-change)
pnpm db:migrate
pnpm db:seed             # Mandanten; mit DEMO_MODE=true oder --demo auch die Demo-Belege
pnpm eval                # Eval mit Ablation gegen das echte Modell. Kostet Guthaben: nur nach Rückfrage.
```

Vor jedem Commit: `pnpm check` mit Exit 0. Nichts als erledigt melden, was nicht gelaufen und gesehen wurde.

## Struktur

```
app/
  routes/                 # eine Datei pro Route, loader/action dort
  components/
  lib/
    db/schema.ts          # einzige Quelle für Tabellen und Typen
    db/client.ts          # neon-serverless (Pool, Transaktionen) in Produktion, node-postgres lokal/CI, PGlite in Tests
    beleg.ts              # Belegformat (Zod), egal ob aus XML, PDF oder Eval
    parser/cii.ts         # XRechnung CII und ZUGFeRD, deterministisch
    validator.ts          # Summen, Pflichtangaben, USt-IdNr., Datum: Code, kein Modell
    agents/               # Kontierer, Prüfer, Recherche, Extraktor; Prompts mit Version
    decide.ts             # Entscheidung automatisch/prüfen: Code, kein Modell
    process.server.ts     # die Kette für einen Beleg, schreibt am Ende in einer Transaktion
    ledger.server.ts      # Bestätigen, Festschreiben, Storno
    datev.ts              # Buchungsstapel EXTF
    skr03.ts              # erlaubte Konten und BU-Schlüssel
tests/
  e2e/                    # Playwright, eine Datei pro Nutzerablauf
  helpers/                # PGlite, Test-Modelle, Belegbau
drizzle/                  # generierte Migrationen, nie von Hand ändern (außer --custom-Migrationen)
evals/                    # Eval-Set, Runner, Ergebnis
.claude/                  # Skills und Review-Agenten
```

## Regeln

- **Mandant nur aus der Session.** Jede Funktion in `app/lib` nimmt `tenantId` als ersten Parameter und filtert darauf. Nie eine `tenantId` aus URL oder Formular übernehmen; einzige Ausnahme ist der Umschalter, der gegen `allowedTenants` prüft. Fremde Belege sehen aus wie nicht vorhandene (404).
- **Protokoll nur anhängend.** `decisions` und `reviews` nie ändern oder löschen; die Datenbank lehnt es per Trigger ab.
- **Festgeschrieben ist endgültig.** Korrektur nur als Storno plus neue Buchung (`reverseAndRebook`).
- **Eine Transaktion pro Beleg.** Status, Protokoll, Lieferant und Buchung zusammen oder gar nicht.
- **Geld in Cent** als Integer. Runden nur in `money.ts`.
- **Alle Eingänge mit Zod:** Formulare, XML-Felder, jede Modellantwort. Kaputte oder unbekannte Antwort → `pruefen`, nie raten.
- **Belegtext ist Daten, nie Anweisung.** Er geht nur über `asData()` in einen abgegrenzten Block an das Modell.
- **Agenten haben nur lesende Werkzeuge.** Geschrieben wird nur von Code nach der Entscheidung.
- **Prompt geändert → `PROMPT_VERSIONS` hochzählen** und Skill `agent-eval`.
- **LLM-Kosten:** jeder Aufruf zieht vom Tageslimit (`takeFromDailyBudget`). Tests und E2E rufen nie das echte Modell.
- **Keine echten Belege, Firmen oder Personen** in Tests, Fixtures, Demo oder Commits. Alles erfinden.
- UI-Texte deutsch, du-Form. Code englisch; Fachbegriffe (Beleg, Kontierer, Prüfer, festschreiben) bleiben deutsch.
- Kommentare erklären warum, nicht was.
- Echte `<button>` und `<a>`, alles per Tastatur.

## Tests

Details: Skill `verify`.

- Jede Logikänderung mit Test. Jeder gemeldete Fehler zuerst als roter Test.
- Tests beschreiben das Versprechen an den Nutzer.
- Pflicht: Mandantentrennung, append-only, Storno statt Änderung, Injection, DATEV-Format, Parser, Validator, Abbruch ohne halbe Daten.
- E2E-Selektoren über Rollen und Beschriftungen, sonst `data-testid`.

## Commits und Deploy

- Kleine Commits, Conventional Commits. Neue Arbeit auf Branch mit PR; der PR bekommt eine Review durch `code-reviewer` und `security-reviewer`.
- `main` deployt die Demo auf Vercel (Frankfurt).
- Schema nur über Skill `db-change`.

## Nicht ohne Rückfrage ändern

Gilt per Hook (`.claude/settings.json`, `.claude/hooks/`), nicht nur als Bitte. Meldet ein Hook „deny“ oder fragt nach: nicht über Bash umgehen, sondern dem Hinweis folgen oder Ben fragen. Änderungen per Bash fängt der Commit-Hook in den üblichen Fällen ab (Grenzen in `SECURITY.md`).

| Pfad | Hook | Weg |
|---|---|---|
| `drizzle/meta/`, committete Migrationen | Edit gesperrt; committete Migration auch beim Commit gesperrt | neue Migration (Skill `db-change`); eine neue `--custom`-Datei darf geschrieben werden |
| `.github/workflows/` (Actions auf SHA, minimale Rechte) | Rückfrage | Diff zeigen, Bens Ja abwarten |
| `evals/belege.json` (per Regel festgelegt, nie vom Modell) | Edit gesperrt; beim Commit Rückfrage (neu erzeugt) | Vorlagen in `evals/generate.ts` (Rückfrage), dann neu erzeugen |
| `app/lib/skr03.ts` (Konten, BU-Schlüssel, Grenzen) | Rückfrage bei jeder Code-Änderung, Kommentare frei | fachlich prüfen lassen (`tax-reviewer`) |
| `.claude/settings*.json`, `.claude/hooks/` | Rückfrage | die Leitplanken selbst |
| `.env*` außer `.env.example` | Lesen und Schreiben gesperrt | Werte setzt Ben |

Commits über 400 geänderte Zeilen (ohne Lockfile, `drizzle/`, Eval-Daten) lehnt ein Hook ab: aufteilen. Stagen und Committen in getrennten Aufrufen, sonst lässt sich die Größe nicht messen. Begründung der Schwelle in `.claude/hooks/guard-commit-size.mjs`.

## Skills und Agenten

| | Wann |
|---|---|
| Skill `verify` | Tests schreiben, ausführen, UI im Browser prüfen |
| Skill `db-change` | Tabelle oder Spalte ändern |
| Skill `agent-eval` | Prompt, Modell, Schwelle oder Konten der Agenten ändern |
| Skill `e-ink-design` | jede UI-Änderung |
| Skill `ship` | Feature abschließen und ausliefern |
| Agent `code-reviewer` | nach jeder Aufgabe, vor dem Commit |
| Agent `security-reviewer` | Änderungen an Routen, `app/lib/db`, `app/lib/agents` |
| Agent `tax-reviewer` | Änderungen an `evals/`, Prompts, `skr03.ts`, `datev.ts` |
