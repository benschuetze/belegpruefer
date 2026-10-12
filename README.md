# Belegprüfer

Eingangsrechnungen für mehrere Mandanten: hochladen, auslesen, nach SKR03 kontieren, von einem zweiten Agenten prüfen lassen, automatisch buchen oder dir vorlegen, festschreiben, als DATEV-Buchungsstapel exportieren. Dazu eine Messung, ob sich das Agenten-Team gegenüber einem einzelnen Modell lohnt.

**Demo:** _(Link folgt nach dem ersten Deployment)_ · schreibgeschützt, zwei erfundene Mandanten, erfundene Rechnungen, die Agenten laufen dort als feste Stichwort-Modelle („Mockdaten“).

Die Startseite beantwortet eine Frage: **Wie viele Belege sind fertig, wie viele brauchen dich?**

## Was es kann

- **Mehrere Mandanten, strikt getrennt.** Der Mandant kommt nur aus der signierten Session, nie aus URL oder Formular. Jede Tabelle hat `tenant_id`, jeder Index beginnt damit, jede Funktion in `app/lib` nimmt `tenantId` als ersten Parameter. Ein fremder Beleg sieht aus wie ein nicht vorhandener (404).
- **Upload** von XRechnung (CII) und ZUGFeRD als XML, deterministisch geparst; PDF über ein Vision-Modell mit festem Schema und Konfidenz je Feld. Jede Datei bekommt eine Antwort: neu, Duplikat (SHA-256 je Mandant) oder mit Grund abgelehnt.
- **Validator in Code:** Summen auf den Cent (Positionen → Steuergruppen → Brutto), Pflichtangaben nach § 14 UStG bzw. § 33 UStDV für Kleinbetragsrechnungen, USt-IdNr.-Format je EU-Land, Datum, Reverse-Charge-Hinweis, GWG-Grenze, Bewirtungsangaben.
- **Agenten-Team** (siehe unten): Recherche bei unbekanntem Lieferanten, Kontierer, Prüfer. Entschieden wird in Code.
- **Prüf-Oberfläche:** Beleg links, Vorschlag mit Begründung und Einwand des Prüfers rechts, Validator-Befunde, Gründe für die Vorlage. „Passt, buchen“ oder „Konto ändern“.
- **Protokoll** jeder Entscheidung, nur anhängend: Modell, Prompt-Version, Eingabe, Ausgabe, Konfidenz, Tokens, Kosten, Dauer. Die Datenbank lehnt UPDATE und DELETE per Trigger ab.
- **Festschreiben** eines Zeitraums (verweigert, solange dort etwas offen ist). Danach ist eine Buchung unveränderbar, auch für die Datenbank; Korrektur nur per Storno plus neuer Buchung.
- **DATEV-Export** als Buchungsstapel (EXTF 700, Kategorie 21, Version 13), Semikolon, Dezimalkomma, Windows-1252.
- **Eval mit Ablation:** vier Aufstellungen auf 150+ erfundenen Belegen, Kennzahl „falsch trotz automatisch“.

## Architektur

```
 Upload (XML/PDF)
      │  SHA-256 je Mandant → neu | Duplikat | abgelehnt (mit Grund)
      ▼
 ┌──────────────┐  XML   ┌────────────┐
 │  documents   ├───────►│  Parser    │  Code, CII (XRechnung, ZUGFeRD)
 │  status=neu  │  PDF   ├────────────┤
 └──────┬───────┘───────►│ Extraktor  │  Claude Vision, Schema, Konfidenz je Feld
        │                └─────┬──────┘
        │                      ▼
        │                ┌────────────┐
        │                │ Validator  │  Code: Summen, § 14 UStG, USt-IdNr., Datum
        │                └─────┬──────┘
        │        Lieferant     ▼        bestätigte Buchungen
        │        unbekannt? ┌────────────┐  desselben Mandanten
        │       ┌──────────►│ Recherche  │  vies_pruefen, lieferant_historie (nur lesend, ≤ 4 Schritte)
        │       │           └─────┬──────┘
        │       │                 ▼
        │       │           ┌────────────┐
        │       └───────────┤ Kontierer  │  Konto (Enum), BU-Schlüssel, Konfidenz, Begründung
        │                   └─────┬──────┘
        │                         ▼
        │                   ┌────────────┐
        │                   │  Prüfer    │  anderes Modell, sieht die Konfidenz nicht
        │                   └─────┬──────┘
        │                         ▼
        │                   ┌────────────┐
        │                   │Entscheidung│  Code: automatisch | prüfen
        │                   └─────┬──────┘
        ▼                         ▼
   eine Transaktion: Protokoll (decisions) + Lieferant + Buchung + Status
        │
        ▼
   prüfen → Mensch bestätigt/ändert (reviews) → festschreiben → DATEV-Export
                                                   └─ danach nur Storno + neue Buchung
```

## Agenten

| Rolle | Art | Eingabe | Ausgabe | Werkzeuge |
|---|---|---|---|---|
| Parser | Code | XML | strukturierter Beleg | – |
| Extraktor | `claude-sonnet-5-5`, Vision, festes Schema | PDF | Beleg, Konfidenz je Feld | – |
| Validator | Code | Beleg | Befunde (Fehler/Hinweis) | – |
| Recherche | `claude-haiku-5-5`, höchstens 4 Schritte | Lieferant, Positionen | Kurzprofil: verkauft was, Land, USt-IdNr. gültig | `vies_pruefen`, `lieferant_historie`, beide nur lesend |
| Kontierer | `claude-haiku-5-5`, festes Schema | Beleg, Mandant, bis 5 bestätigte Buchungen desselben Lieferanten, Profil | je Steuersatz Konto und BU-Schlüssel, Konfidenz, Begründung | – |
| Prüfer | `claude-sonnet-5-5`, eigener Prompt | Beleg, Vorschlag ohne Konfidenz | einverstanden oder Einwand mit Gegenvorschlag | – |
| Entscheidung | Code | alles oben | `automatisch` / `pruefen` | – |

Regeln für alle Agenten:

- **Belegtext ist Daten.** Er steht als JSON in einem abgegrenzten Block (`<beleg>…</beleg>`); `<` und `>` im Text werden escaped, sodass eine Rechnung den Block nicht schließen kann. Der Systemprompt sagt, dass Anweisungen im Beleg ein Warnsignal sind.
- **Jede Antwort geht durch Zod.** Konto ist ein Enum der erlaubten Konten. Kaputtes JSON, unbekanntes Konto, falscher Steuersatz, fehlende Antwort, Fehler der API → `pruefen`, nie geraten.
- **Keine schreibenden Werkzeuge.** Geschrieben wird nur von `processDocument` nach der Entscheidung.
- **Prompt-Version und Modell-ID** stehen bei jeder Entscheidung im Protokoll.
- **Prompt Caching** für Systemprompt und Kontenliste (`cacheControl` am Systemprompt). Hinweis: Unterhalb der Mindestlänge des Modells cached die API still nicht; ob es greift, zeigt `cache_read` im Protokoll.
- **Tageslimit** für KI-Aufrufe (`takeFromDailyBudget`, Standard 600).
- **Parallelität:** Belege laufen zu dritt parallel. Innerhalb eines Belegs braucht der Prüfer den Vorschlag des Kontierers und der Kontierer das Recherche-Profil, deshalb ist diese Kette sequenziell; Historie und Lieferantendaten werden vorher geladen.

### Entscheidungsregel (Code)

- Validator meldet einen Fehler → `pruefen`
- Kontierer ohne verwertbare Antwort, oder Vorschlag deckt nicht genau die Steuersätze des Belegs ab → `pruefen`
- BU-Schlüssel passt nicht zum Steuersatz oder Reverse Charge ohne EU-Lieferant mit Hinweis → `pruefen` (der Code prüft, nicht das Modell)
- Anlagevermögen (z. B. Laptop über 800 € netto) → immer `pruefen`
- Für das Konto fehlen Angaben (Bewirtung ohne Anlass und Teilnehmer, GWG über der Grenze) → `pruefen`
- Prüfer mit Einwand oder ohne Antwort → `pruefen`
- Konfidenz unter der Schwelle: 0,8, für Risikokonten (Bewirtung, GWG, Reverse Charge) 0,9 → `pruefen`
- sonst `automatisch`

Die Schwellen sind Startwerte; siehe Eval.

## Eval

_Noch nicht gemessen._ `pnpm eval` ruft das echte Modell und kostet Guthaben; es läuft nur nach Rückfrage.

## Entscheidungen

**Datenbanktreiber und Transaktionen.** Die Verarbeitung eines Belegs schreibt Protokoll, Lieferant, Buchung und Status in einer interaktiven Transaktion; Bestätigen und Storno ebenso. Der HTTP-Treiber von Neon (`neon-http`) kann keine Transaktion über mehrere Anweisungen offen halten (nur Batches ohne Zwischenergebnisse). Deshalb läuft die App über `drizzle-orm/neon-serverless` mit `Pool` (WebSocket). Lesen über HTTP wäre etwas schneller, aber ein zweiter Treiber hieße zwei Verhaltensweisen; bei diesen Datenmengen lohnt das nicht. Lokal und in CI läuft `node-postgres`, in Tests PGlite.

**Mandantentrennung.** Eine Instanz, viele Mandanten, Trennung in der Anwendung: Mandant nur aus der Session, `tenantId` als erster Parameter jeder Funktion, jeder Index beginnt mit `tenant_id`, Tests für fremde IDs (Seite, Datei, Aktion, Beispiele für den Kontierer). Row Level Security mit `set_config('app.tenant_id', …)` wäre die zweite Linie in der Datenbank; noch nicht umgesetzt.

**Protokoll und Festschreibung in der Datenbank.** Append-only und „festgeschrieben ist endgültig“ prüft nicht nur der Code, sondern ein Trigger. Ein Fehler im Code oder ein Handgriff in der Datenbank kann die Geschichte nicht umschreiben.

**Prüfer auf anderem Modell.** Zwei Aufrufe desselben Modells teilen dessen blinde Flecken. Der Prüfer läuft auf einem stärkeren Modell und sieht die Konfidenz des Kontierers nicht, damit er die Buchung beurteilt und nicht die Selbsteinschätzung.

**Ablage.** Dateien liegen vorerst Base64-kodiert in Postgres (`storage_key = 'db'`). Das reicht für die Demo und hält alles in einer Transaktion; für echte Mengen gehört das in einen Objektspeicher mit Object Lock (siehe Grenzen).

## Fachlich offen

Vor einem echten Einsatz von einer Steuerberaterin prüfen lassen:

- **BU-Schlüssel für Reverse Charge.** Verwendet wird 46 (sonstige Leistung eines Unternehmers aus dem übrigen Gemeinschaftsgebiet, § 13b Abs. 1 UStG, 19 %). Öffentliche Quellen nennen auch 94 bzw. die neueren dreistelligen DATEV-Schlüssel; die Zuordnung hängt von der Schlüsseltabelle des Mandanten ab.
- **Konto für Anlagevermögen.** Laptops über der GWG-Grenze gehen auf 0420 (Büroeinrichtung) und immer zur Prüfung; je nach Kanzlei ist 0410 oder 0490 üblich.
- **DATEV-Format.** Kopfsatz (31 Felder) und die ersten 14 Spalten folgen den öffentlich beschriebenen Formaten; die vollständige Schnittstellenbeschreibung ist nur mit DATEV-Login zugänglich. Der Import in DATEV selbst ist nicht getestet.

## Grenzen

- Nur Eingangsrechnungen, nur SKR03, nur EUR, nur CII (kein UBL), keine Gutschriften.
- Keine Bankanbindung, kein Zahlungsabgleich. Gegenkonto ist immer 1600.
- Ein Passwort pro Instanz, keine Benutzerverwaltung; in der Demo wählt ein Umschalter den Mandanten.
- Dateien in der Datenbank statt in einem Objektspeicher.
- Handy: lesbar ab 375 px, nicht dafür optimiert.

## Arbeitsweise mit Agenten

Das Repo wurde mit Claude Code gebaut. In `.claude/` liegen Skills (`verify`, `db-change`, `agent-eval`, `e-ink-design`, `ship`) und drei Review-Agenten (`code-reviewer`, `security-reviewer`, `tax-reviewer`). Jeder PR bekommt über die Claude-Code-GitHub-Action eine Review durch `code-reviewer` und `security-reviewer`. _Echte Befunde mit Links folgen, sobald PRs gelaufen sind._

## Lokal starten

```bash
pnpm install
cp .env.example .env   # DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres, AI_MOCK=1, APP_PASSWORD, SESSION_SECRET
pnpm db:local          # Postgres ohne Installation, mit Demo-Belegen
pnpm dev
pnpm check             # typecheck, lint, Unit- und DB-Tests, E2E
```

Alle Firmen, Personen, Rechnungen und USt-IdNr. in diesem Repo sind erfunden.
