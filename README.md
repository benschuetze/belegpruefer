# Belegprüfer

Eingangsrechnungen für mehrere Mandanten: hochladen, auslesen, nach SKR03 kontieren, von einem zweiten Agenten prüfen lassen, automatisch buchen oder dir vorlegen, festschreiben, als DATEV-Buchungsstapel exportieren. Dazu eine Messung, ob sich das Agenten-Team gegenüber einem einzelnen Modell lohnt.

**Demo:** _noch nicht veröffentlicht_ (Vercel-Projekt mit Neon in Frankfurt ist vorbereitet: `vercel.json`, `DEMO_MODE=true`, `AI_MOCK=1`) · schreibgeschützt, zwei erfundene Mandanten, erfundene Rechnungen, die Agenten laufen dort als feste Stichwort-Modelle („Mockdaten“).

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
- **Eval mit Ablation:** vier Aufstellungen auf 165 erfundenen Belegen, Kennzahl „falsch trotz automatisch“, gemessen gegen das echte Modell.

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
- Konfidenz unter der Schwelle: 0,85, für Risikokonten (Bewirtung, GWG, Reverse Charge) 0,9 → `pruefen`
- Leistung aus einem Drittland ohne deutsche Steuer → `pruefen`
- sonst `automatisch`

Die Schwelle 0,85 kommt aus dem Eval (Startwert war 0,8), siehe unten.

## Eval

Gemessen am **12.10.2026** auf **165 erfundenen Belegen** (`evals/belege.json`), Kontierer und Recherche `claude-haiku-5-5`, Prüfer `claude-sonnet-5-5`, Prompts `kontierer-2026-10-12.2` / `pruefer-2026-10-12.2`. Rohdaten je Beleg in `evals/runs/`, Zusammenfassung in `evals/ergebnis.json`, im Demo unter „Eval“. Der ganze Lauf hat 2,05 $ gekostet.

Die Tabelle zeigt die Entscheidung mit der gewählten Schwelle (0,85 normal, 0,9 für Risikokonten); die Bewertung spielt die Entscheidung in Code auf den gespeicherten Antworten nach.

| Aufstellung | Konto richtig | BU richtig | automatisch | **falsch trotz automatisch** | Kosten/Beleg | Zeit/Beleg |
|---|---:|---:|---:|---:|---:|---:|
| 1 Kontierer allein | 97,6 % | 100 % | 72,7 % | **0 %** (0) | 0,016 ct | 1,7 s |
| 2 + Prüfer | 97,6 % | 100 % | 72,1 % | **0 %** (0) | 0,362 ct | 4,2 s |
| 3 + Prüfer + Recherche | 97,6 % | 100 % | 69,7 % | **0 %** (0) | 0,374 ct | 5,8 s |
| 4 + Prüfer + Recherche + Beispiele | 98,8 % | 100 % | 71,5 % | **0 %** (0) | 0,378 ct | 5,8 s |

Kalibrierung (Aufstellung 4, Anteil richtig kontierter Belege je Konfidenzbereich): 0–0,6: 13 Belege, 100 % · 0,6–0,8: 4, 75 % · 0,8–0,9: 12, 92 % · 0,9–1,0: 136, 100 %. Extraktion aus PDF (`claude-sonnet-5-5`, 20 erfundene Rechnungen in drei Layouts): alle neun Felder bei allen 20 richtig, 0,93 ct je Beleg.

**Lohnt sich der Prüfer?** Auf diesem Set nicht: Er hat nur bei vier Belegen widersprochen, die der Kontierer ohnehin unsicher gemeldet hatte, und keine einzige falsche automatische Buchung zusätzlich verhindert, kostet aber das 22-Fache (absolut 0,35 ct je Beleg). Er bleibt drin, weil die Belege hier sauber erfunden sind und echte Rechnungen unordentlicher sind; der nächste Schritt wäre, ihn nur unterhalb von 0,95 Konfidenz und bei Risikokonten zu fragen. **Lohnt sich die Recherche?** Nicht messbar: gleiche Kontogenauigkeit, etwas weniger Automatik, 1,6 s mehr je Beleg. Was hilft, sind **Beispiele aus bestätigten Buchungen** desselben Lieferanten (97,6 % → 98,8 % Konto richtig).

**Schwelle.** Mit dem Startwert 0,8 ging in Aufstellung 3 ein Beleg falsch durch: Visitenkarten auf Bürobedarf statt Werbung, Konfidenz 0,80 (fachlich vertretbar, aber nicht der Erwartungswert). Über alle vier Aufstellungen lag jede falsche Kontierung bei 0,80 oder darunter, im Bereich 0,9–1,0 war jede richtig. Deshalb 0,85: gut ein Prozentpunkt weniger Automatik, dafür Abstand zur Zone, in der die Fehler liegen. Das Schwellen-Raster steht in `evals/ergebnis.json` (`sweep`).

Grenzen der Messung: ein Lauf je Aufstellung, keine Wiederholungen (Unterschiede von ein, zwei Belegen sind Rauschen); die Belege sind aus Vorlagen erzeugt und damit leichter als echte; die Erwartungswerte sind regelbasiert festgelegt und vom `tax-reviewer` fachlich geprüft. Eine Stichprobe von 30 Fällen zur Prüfung von Hand liegt in `evals/stichprobe.md` und ist **noch nicht abgehakt**.

`pnpm eval --dry-run` schätzt die Kosten, `pnpm eval` misst (nur nach Rückfrage; auch als manueller Workflow „Eval“), `pnpm eval --nur-auswerten` rechnet die Tabelle aus den gespeicherten Läufen neu.

## Entscheidungen

**Datenbanktreiber und Transaktionen.** Die Verarbeitung eines Belegs schreibt Protokoll, Lieferant, Buchung und Status in einer interaktiven Transaktion; Bestätigen und Storno ebenso. Der HTTP-Treiber von Neon (`neon-http`) kann keine Transaktion über mehrere Anweisungen offen halten (nur Batches ohne Zwischenergebnisse). Deshalb läuft die App über `drizzle-orm/neon-serverless` mit `Pool` (WebSocket). Lesen über HTTP wäre etwas schneller, aber ein zweiter Treiber hieße zwei Verhaltensweisen; bei diesen Datenmengen lohnt das nicht. Lokal und in CI läuft `node-postgres`, in Tests PGlite.

**Mandantentrennung.** Eine Instanz, viele Mandanten, Trennung in der Anwendung: Mandant nur aus der Session, `tenantId` als erster Parameter jeder Funktion, jeder Index beginnt mit `tenant_id`, Tests für fremde IDs (Seite, Datei, Aktion, Beispiele für den Kontierer). In der Datenbank zeigen Buchungen, Protokoll und Reviews über zusammengesetzte Fremdschlüssel `(tenant_id, document_id)` auf den Beleg; eine Zeile kann also nicht auf den Beleg eines anderen Mandanten verweisen. Row Level Security mit `set_config('app.tenant_id', …)` wäre die nächste Linie; noch nicht umgesetzt.

**Protokoll und Festschreibung in der Datenbank.** Append-only und „festgeschrieben ist endgültig“ prüft nicht nur der Code, sondern ein Trigger (auch gegen `TRUNCATE`). Ein Fehler im Code oder ein Handgriff in der Datenbank kann die Geschichte nicht umschreiben. Was nach dem Festschreiben eines Zeitraums noch gebucht wird (Storno, Korrektur, ein verspäteter Beleg), landet im laufenden Zeitraum; der exportierte bleibt Zeile für Zeile, wie er war.

**Prompt Injection, zwei Linien.** Erstens geht Belegtext nur als abgegrenzte Daten an die Modelle. Zweitens erkennt der Validator Text, der wie eine Anweisung an die Buchhaltung aussieht („buche auf 4900“, „Konfidenz 1“, „SYSTEM:“, ein schließendes `</beleg>`), in jedem Freitextfeld; so ein Beleg geht immer zu einem Menschen, auch wenn beide Agenten der Anweisung folgen würden. Ein Test spielt genau diesen schlimmsten Fall für alle Injection-Belege des Eval-Sets durch.

**Prüfer auf anderem Modell.** Zwei Aufrufe desselben Modells teilen dessen blinde Flecken. Der Prüfer läuft auf einem stärkeren Modell und sieht die Konfidenz des Kontierers nicht, damit er die Buchung beurteilt und nicht die Selbsteinschätzung.

**Ablage.** Dateien liegen vorerst Base64-kodiert in Postgres (`storage_key = 'db'`). Das reicht für die Demo und hält alles in einer Transaktion; für echte Mengen gehört das in einen Objektspeicher mit Object Lock (siehe Grenzen).

## Fachlich offen

Vor einem echten Einsatz von einer Steuerberaterin prüfen lassen:

- **BU-Schlüssel für Reverse Charge.** Verwendet wird 46 (sonstige Leistung eines Unternehmers aus dem übrigen Gemeinschaftsgebiet, § 13b Abs. 1 UStG, 19 %). Öffentliche Quellen nennen auch 94 bzw. die neueren dreistelligen DATEV-Schlüssel; die Zuordnung hängt von der Schlüsseltabelle des Mandanten ab.
- **Konto für Anlagevermögen.** Laptops über der GWG-Grenze gehen auf 0420 (Büroeinrichtung) und immer zur Prüfung; je nach Kanzlei ist 0410 oder 0490 üblich.
- **DATEV-Format.** Kopfsatz (31 Felder) und die ersten 14 Spalten folgen den öffentlich beschriebenen Formaten; die vollständige Schnittstellenbeschreibung ist nur mit DATEV-Login zugänglich. Der Import in DATEV selbst ist nicht getestet. Die Festschreibung im Kopf steht auf 0: in der App ist der Zeitraum zu, in DATEV kann die Kanzlei noch korrigieren.
- **Gegenkonto 1600.** Gebucht wird gegen das Sammelkonto Verbindlichkeiten. In DATEV sind Kreditorenkonten (ab 70000) üblich, mit Offene-Posten-Führung; das bräuchte Kreditorenstammdaten je Mandant.
- **Storno.** Als Gegenbuchung im Haben; DATEV kennt dafür auch die Generalumkehr über den BU-Schlüssel, die die Verkehrszahlen nicht aufbläht.
- **Bewirtung.** Gebucht wird der volle Betrag auf 4650. Steuerlich abziehbar sind 70 % (§ 4 Abs. 5 Nr. 2 EStG); die Aufteilung auf 4654 (nicht abzugsfähig) überlässt die App der Kanzlei. Der Validator prüft Anlass und Teilnehmer, nicht Ort, Tag, Bewirtenden und die Angaben einer maschinellen Rechnung.
- **Drittland.** Leistungen aus Nicht-EU-Ländern ohne deutsche Steuer (§ 13b Abs. 2 UStG) gehen immer zur Prüfung; den Steuerschlüssel setzt die App dort nicht selbst.
- **GWG und Sammelposten.** Als GWG gelten nur selbständig nutzbare Gegenstände (Stuhl, Regal, Leuchte), nicht Monitor oder Drucker. Die Wahl des Sammelpostens (250 bis 1.000 €, § 6 Abs. 2a EStG) je Mandant fehlt.
- **Kontenwahl als Kanzleientscheidung.** Rohkaffee und Tüten einer Rösterei als Wareneingang (3300/3400) statt Roh- und Hilfsstoffe, Getränke fürs Büro auf 4930 statt 4140: gängig, aber nicht die einzige richtige Wahl. 4955 und 4957 (Buchführung, Abschluss) sind aus der Kontenliste übernommen, aber nicht gegen einen Kanzlei-Kontenplan geprüft.

## Grenzen

- Nur Eingangsrechnungen, nur SKR03, nur EUR, nur CII (kein UBL), keine Gutschriften.
- Keine Bankanbindung, kein Zahlungsabgleich. Gegenkonto ist immer 1600.
- Ein Passwort pro Instanz, keine Benutzerverwaltung; in der Demo wählt ein Umschalter den Mandanten. Sessions sind zustandslose, signierte Cookies: Abmelden löscht das Cookie, eine kopierte Session bleibt aber bis zu sieben Tage gültig; widerrufen lassen sich alle nur über ein neues Passwort. Die Login-Bremse zählt je IP (fünf Versuche in 15 Minuten), damit niemand den Inhaber global aussperren kann.
- Dateien in der Datenbank statt in einem Objektspeicher.
- Handy: lesbar ab 375 px, nicht dafür optimiert.

## Arbeitsweise mit Agenten

Das Repo wurde mit Claude Code gebaut. In `.claude/` liegen Skills (`verify`, `db-change`, `agent-eval`, `e-ink-design`, `ship`) und drei Review-Agenten (`code-reviewer`, `security-reviewer`, `tax-reviewer`). Jeder PR bekommt über die Claude-Code-GitHub-Action eine Review durch `code-reviewer` und `security-reviewer`; die Anweisungen dafür liest der Workflow vom Basis-Branch, damit ein PR seinen eigenen Reviewer nicht umschreiben kann.

Die Review durch die GitHub-Action läuft beim Öffnen eines PRs und erneut mit dem Label `review`; ein Lauf kostet etwa 0,37 $. Ihr erster Kommentar steht in [PR #1](https://github.com/benschuetze/belegpruefer/pull/1): ein Wettlauf zwischen Buchen und Festschreiben, ein verlorenes Minuszeichen im Buchungstext, ein Fehlalarm der Injection-Erkennung bei „System: Lizenz“, dazu kleinere Punkte; alle behoben im selben PR. Damit die Action überhaupt lief, musste der Workspace-Header über `ANTHROPIC_CUSTOM_HEADERS` gesetzt werden, weil der Key für mehrere Workspaces gilt.

Was die beiden Agenten vor dem ersten PR tatsächlich gefunden haben (lokal über den ganzen Stand, alle behoben, jeweils mit Test):

| Agent | Befund | Folge |
|---|---|---|
| security-reviewer | Storno-Neubuchung bekam das Rechnungsdatum und landete offen im schon festgeschriebenen Monat; ein zweiter Export desselben Zeitraums hätte anders ausgesehen. | Buchungen nach dem Festschreiben gehen in den laufenden Zeitraum. |
| security-reviewer | Login-Sperre global: 30 falsche Versuche von irgendwoher sperrten den Inhaber aus; parallele Anfragen umgingen das Limit je IP. | Erst eintragen, dann zählen; nur noch je IP. |
| security-reviewer | Fremdschlüssel nur auf `documents.id`: eine Zeile hätte auf den Beleg eines anderen Mandanten zeigen können; `TRUNCATE` umging die Append-only-Trigger. | Zusammengesetzte Fremdschlüssel, Trigger gegen `TRUNCATE`. |
| security-reviewer | Review-Workflow las seine Regeln aus dem PR selbst. | Regeln vom Basis-Branch, Werkzeuge auf diesen PR beschränkt. |
| security-reviewer | Keine Größengrenzen: eine 2-MB-Rechnung wäre an jeden Agenten gegangen; Tageslimit zählt nur Aufrufe. Ungültige IDs und Daten ergaben 500 statt 404; Buchungstext konnte in Excel als Formel laufen. | Grenzen im Belegschema, Prüfung von ID und Datum, Formelzeichen am Anfang entfernt. |
| code-reviewer | Die Recherche zählte als ein Aufruf, macht aber bis zu vier. | Tageslimit rechnet mit der Obergrenze. |
| code-reviewer | Extraktions-Eval zählte Felder als richtig, wenn gar nichts gelesen wurde und das Feld auf der Rechnung fehlte. | Nichts gelesen ist überall falsch. |
| code-reviewer | Eval-Runner warf bei der Kostengrenze bezahlte Ergebnisse weg und überschrieb das Extraktionsergebnis. | Zwischenstände werden gespeichert, Ergebnisse zusammengeführt. |
| code-reviewer | Injection-Erkennung schlug bei „Esstisch Buche massiv“ an und übersah die Rechnungsnummer. | Engere Muster, alle Freitextfelder. |
| code-reviewer | Historie suchte per erstem Wort des Lieferanten („Hotel …“ fand jedes Hotel). | Nur derselbe Lieferant. |

Danach hat `tax-reviewer` die Erwartungswerte des Eval-Sets und die Kontenlogik fachlich geprüft, noch bevor gemessen wurde. Sonst hätte das Eval das Modell an falschen Antworten gemessen:

| Befund | Folge |
|---|---|
| Reisekosten einer GmbH oder UG erwartete das Set auf 4670 „Reisekosten Unternehmer“; bei Kapitalgesellschaften reist die Geschäftsführung als Arbeitnehmer. | 4660, Regel im Prompt nach Rechtsform. |
| Monitor, Drucker und Dokumentenkamera als GWG; Peripherie ist nicht selbständig nutzbar. | GWG-Fälle nur noch mit Stuhl, Regal, Leuchte, Schrank; Prompt sagt es ausdrücklich. |
| Wartung eines Trommelrösters auf 4806 „Hard- und Software“. | Eigener Fall auf 4800 „technische Anlagen und Maschinen“. |
| Buchführung und Jahresabschluss auf 4950. | 4955 und 4957 aufgenommen. |
| „Gebühr Kartenterminal“ als steuerfreie Bankleistung; Gerätemiete ist steuerpflichtig. | Fall entfernt. |
| Reverse Charge nur für EU gedacht; Drittland ist auch § 13b, aber mit anderem Schlüssel. | Drittland immer zur Prüfung, eigene Eval-Fälle. |
| Kleinbetragsprivileg galt auch für Reverse Charge (§ 33 Satz 3 UStDV schließt das aus); Anschrift des Empfängers wurde nicht geprüft. | Beides im Validator. |
| WJ-Beginn im DATEV-Kopf falsch bei abweichendem Wirtschaftsjahr. | Richtig berechnet, Stapel über zwei Wirtschaftsjahre abgelehnt. |

Weitere Punkte stehen unter „Fachlich offen“. Bewusst nicht geändert: Abmelden widerruft eine kopierte Session nicht (siehe Grenzen).

## Lokal starten

```bash
pnpm install
cp .env.example .env   # DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres, AI_MOCK=1, APP_PASSWORD, SESSION_SECRET
pnpm db:local          # Postgres ohne Installation, mit Demo-Belegen
pnpm dev
pnpm check             # typecheck, lint, Unit- und DB-Tests, E2E
```

Alle Firmen, Personen, Rechnungen und USt-IdNr. in diesem Repo sind erfunden.
