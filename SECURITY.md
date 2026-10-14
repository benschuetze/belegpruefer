# Sicherheit

Belegprüfer verarbeitet Rechnungen mehrerer Mandanten und lässt Sprachmodelle darauf los. Die Schutzmaßnahmen, jeweils mit dem Test, der sie belegt.

## Mandantentrennung

| Maßnahme | Test |
|---|---|
| Der Mandant kommt nur aus dem signierten Session-Cookie, nie aus URL oder Formular. Der Umschalter prüft gegen die erlaubten Mandanten. | `tests/e2e/mandanten.spec.ts`, `app/lib/auth.test.ts` |
| Jede Funktion in `app/lib` nimmt `tenantId` als ersten Parameter. Jede Abfrage filtert darauf, und jeder Index beginnt mit `tenant_id`. | `app/lib/db/migrations.test.ts` |
| Buchungen, Protokoll und Reviews verweisen über `(tenant_id, document_id)` auf den Beleg. Die Datenbank lehnt eine Zeile ab, die auf den Beleg eines anderen Mandanten zeigt. | `app/lib/process.test.ts` |
| Ein fremder Beleg antwortet mit 404, genau wie ein nicht vorhandener: Seite, Datei und Aktion. Kaputte IDs ergeben 404 statt 500. | `tests/e2e/mandanten.spec.ts` |
| Beispiele und Historie für die Agenten kommen nur aus dem eigenen Mandanten. | `app/lib/process.test.ts` |

## Sprachmodelle

| Maßnahme | Test |
|---|---|
| Belegtext geht nur als JSON in einem abgegrenzten Block an das Modell. `<` und `>` werden escaped, damit eine Rechnung den Block nicht schließen kann. | `app/lib/process.test.ts` („Prompt Injection“) |
| Klingt ein Text auf dem Beleg nach einer Anweisung an die Buchhaltung, geht der Beleg immer zu einem Menschen. Das gilt auch dann, wenn beide Agenten der Anweisung folgen würden. | `evals/injection.test.ts`, `app/lib/validator.test.ts` |
| Jede Modellantwort wird mit Zod geprüft, Konten sind ein Enum. Ist eine Antwort kaputt, unbekannt oder fehlt sie, landet der Beleg in „prüfen“. Geraten wird nie. | `app/lib/process.test.ts`, `app/lib/team.test.ts` |
| Agenten haben nur lesende Werkzeuge (VIES-Abfrage, Historie des eigenen Mandanten). Schreiben darf nur Code, und zwar erst nach der Entscheidung. | `app/lib/agents/recherche.ts` |
| Felder und Positionen haben Größengrenzen, damit kein 2-MB-Text an jeden Agenten geht. Für die KI-Aufrufe gilt ein Tageslimit. | `app/lib/parser/cii.test.ts`, `app/lib/daily-budget.test.ts` |
| Logs enthalten nie den Anfragetext eines KI-Fehlers. Parsergründe nennen das Feld, nie den Wert. | `app/lib/security.test.ts`, `app/lib/parser/cii.test.ts` |

## Integrität der Buchhaltung

| Maßnahme | Test |
|---|---|
| Die App läuft nicht als Eigentümer ihrer Tabellen. Ihre Rolle `belegpruefer_app` hat je Tabelle nur die nötigen Rechte: auf Protokoll, Reviews und Exporte nur SELECT und INSERT, UPDATE nur auf die Spalten, die der Code schreibt (Datei, Hash und Mandant eines Belegs gehören nicht dazu). Kein ALTER, kein TRUNCATE, keine eigenen Tabellen, keine Trigger abschalten. Die App verbindet über `APP_DATABASE_URL`, Migrationen, Seed und Demo-Reset laufen als Eigentümer über `DATABASE_URL`. Der Produktions-Build bricht ab, wenn die App-Verbindung mehr dürfte. Alle DB-Tests laufen unter der Laufzeitrolle, damit ein fehlendes oder überzähliges Recht auffällt. | `app/lib/db/roles.test.ts`, `scripts/check-app-role.ts` |
| Protokoll (`decisions`) und Reviews sind nur anhängend. Ein Datenbank-Trigger lehnt UPDATE, DELETE und TRUNCATE ab, auch wenn der Eigentümer es versucht. Abschalten kann ihn nur der Eigentümer bewusst per `ALTER TABLE … DISABLE TRIGGER`, wie es der Demo-Reset tut. Das ist die zweite Wand hinter den fehlenden Rechten. | `app/lib/process.test.ts`, `app/lib/ledger.test.ts` |
| Ein Beleg ist ebenfalls Beweismittel: Datei, Hash und Mandant ändern sich nie, der gelesene Inhalt nur während der Verarbeitung durch den Lauf, der ihn beansprucht hat. Festgeschrieben geht er nur per Storno zurück auf „bestätigt“. | `app/lib/ledger.test.ts` |
| Festgeschriebene Buchungen sind unveränderbar, ebenfalls per Trigger. Korrigiert wird nur per Storno plus neuer Buchung im laufenden Zeitraum. | `app/lib/ledger.test.ts`, `tests/e2e/export.spec.ts` |
| Ein Beleg wird in einer Transaktion verarbeitet: entweder alles oder nichts. Nach einem Abbruch steht er auf „fehler“ und kann erneut verarbeitet werden. | `app/lib/process.test.ts` („Abbruch ohne halbe Daten“) |
| Buchen und Festschreiben eines Mandanten laufen unter einer Sperre. So rutscht nichts in einen Zeitraum, der gerade geschlossen wird. | `app/lib/process.server.ts` (`lockLedger`) |

## Web

- CSP mit Nonce und `strict-dynamic`, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`.
- CSRF-Prüfung über Fetch Metadata, Origin und Referer. Ohne Signal wird die Anfrage abgelehnt.
- Session-Cookie: `httpOnly`, `secure`, `SameSite=Lax`, eine Woche gültig. In Produktion braucht es ein Secret mit mindestens 32 Zeichen, sonst gibt es keine Sessions.
- Login-Bremse je IP. Erst wird der Versuch eingetragen, dann gezählt, damit parallele Anfragen das Limit nicht umgehen.
- XML mit DOCTYPE wird abgelehnt, also kein XXE und keine Entity-Expansion. Der Dateityp wird am Inhalt erkannt, nicht am Namen.
- Originaldateien und Exporte werden nur als Download ausgeliefert, nie im Ursprung der App dargestellt.
- Die öffentliche Demo ist schreibgeschützt. Nur der Mandanten-Umschalter darf schreiben. Der Demo-Modus läuft nur auf einer Datenbank, die der Demo-Build ausdrücklich als Demo markiert hat und die nur die erfundenen Mandanten enthält. Sonst antwortet jede Seite mit 503, und der Reset löscht nichts. Ein falsch gesetztes `DEMO_MODE=true` macht eine echte Instanz also nicht öffentlich (`app/lib/auth.test.ts`, `app/lib/db/demo-data.test.ts`).
- Weiterleitungen nach Login und Aktionen gehen nur auf eigene Pfade, auch bei Punkt-Segmenten wie `/.//fremd.example` (`app/lib/auth.test.ts`, `tests/e2e/zugang.spec.ts`).
- Actions sind auf Commit-SHA gepinnt, mit minimalen Rechten. CI läuft mit `pnpm audit` und einer OSV-Prüfung.
- Die Claude-Review liest ihre Regeln vom Basis-Branch, nicht aus dem PR selbst.

## Bekannte Grenzen

- **Prompt Injection über PDF bleibt ein Restrisiko.** Ob ein Belegtext nach einer Anweisung klingt, erkennt eine Liste regulärer Ausdrücke (`app/lib/validator.ts`). Umformulierter Text kommt durch, ebenso versteckter, etwa weiße Schrift auf weißem Grund: Das Modell bekommt die Textebene des PDFs mit. Schlimmstenfalls folgen beide Agenten dem Text, und der Beleg wird automatisch auf ein plausibles, aber falsches Konto gebucht. Festschreiben verlangt nur, dass nichts mehr offen ist; eine automatische Buchung muss vorher kein Mensch gesehen haben.
  Was den Schaden begrenzt: Konten und BU-Schlüssel sind ein Enum, Summen und Steuer rechnet Code nach, das Gegenkonto setzt Code, die App bezahlt nichts, und jede Buchung steht mit Begründung im Protokoll. Gegenmaßnahme, noch nicht gebaut: vor dem Festschreiben eine Stichprobe automatischer Buchungen vorlegen, zum Beispiel jede zehnte und alle von neuen Lieferanten, und erst nach dem Abhaken festschreiben.

- Sitzungen sind zustandslos. Eine kopierte Session bleibt bis zu sieben Tage gültig, widerrufen lassen sich alle nur über ein neues Passwort.
- Row Level Security in Postgres ist noch nicht umgesetzt. Die Trennung liegt in der Anwendung und in den Fremdschlüsseln.
- Ein Passwort pro Instanz, keine Benutzerverwaltung.

## Lücken melden

Bitte nicht als öffentliches Issue, sondern über die private Meldefunktion von GitHub („Report a vulnerability“ im Tab „Security“).
