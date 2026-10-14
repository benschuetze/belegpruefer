---
name: db-change
description: Use when adding, changing or removing a table, column, index or enum in the Drizzle schema. Covers migration generation, review, data backfill and type checks.
---

# Schema ändern

1. Nur `app/lib/db/schema.ts` ändern. Nie Dateien in `drizzle/` von Hand bearbeiten.
2. `pnpm db:generate` ausführen.
3. Erzeugte SQL-Datei in `drizzle/` lesen und prüfen:
   - Kein ungewolltes `DROP` von Spalten oder Tabellen mit Daten.
   - Neue `NOT NULL`-Spalten auf bestehenden Tabellen brauchen einen Default oder einen Backfill.
   - Umbenennungen erscheinen oft als DROP + ADD. Dann abbrechen und mit `ALTER ... RENAME` lösen.
4. Wenn Daten umgezogen werden müssen: Backfill als eigene Migration, getrennt von der Strukturänderung.
5. `pnpm db:migrate` gegen die lokale bzw. Branch-Datenbank.
6. `pnpm typecheck`. Alle Stellen anpassen, die durch die neuen Typen brechen.
7. Seed (`pnpm db:seed`) und Tests anpassen, falls betroffen.
7a. **Rechte der Laufzeitrolle.** Neue Tabelle: in einer `--custom`-Migration `GRANT … TO belegpruefer_app` mit den knappsten Rechten (Protokoll nur SELECT, INSERT; nie TRUNCATE) und denselben Eintrag in `RIGHTS` in `app/lib/db/roles.test.ts`. Neuer Schreibzugriff auf eine bestehende Tabelle: prüfen, ob das Recht schon da ist. Die Tests laufen als `belegpruefer_app` und zeigen fehlende Rechte.
8. Commit mit Schema, Migration und Code-Anpassungen zusammen: `feat(db): ...` bzw. `refactor(db): ...`.

## Konventionen

- Tabellen im Plural, snake_case. Spalten snake_case.
- Primärschlüssel `id` als `uuid` mit `defaultRandom()`.
- Geldbeträge `integer` in Cent, Spaltenname endet auf `_cents`.
- Spaltennamen folgen dem Datenmodell im README (z. B. `extracted_jsonb`).
- Zeitstempel `timestamp with time zone` mit `defaultNow()`, Buchungsdaten als `date`.
- Fremdschlüssel immer mit Index.
- Jede Mandantentabelle hat `tenant_id`, und jeder Index beginnt mit `tenant_id` (Test in `migrations.test.ts`).
- Trigger, Funktionen und Backfills als `pnpm drizzle-kit generate --custom --name …` und dort von Hand schreiben.
- Enums als `pgEnum`, Werte englisch.
- Migrationen, Seed und Demo-Reset laufen als Eigentümer (`DATABASE_URL`), die App über `APP_DATABASE_URL` als `belegpruefer_web` (Mitglied von `belegpruefer_app`, angelegt mit `pnpm db:app-login`). Was nur der Eigentümer darf, testet `createTestDb({ as: "owner" })`.
