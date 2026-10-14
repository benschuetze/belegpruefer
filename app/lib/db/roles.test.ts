import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb, dbRefusal } from "../../../tests/helpers/db";

/**
 * Every table and what the runtime role may do with it. A new table without an entry here fails the first test:
 * deciding its rights is part of adding it (skill db-change).
 */
const RIGHTS: Record<string, string[]> = {
  tenants: ["SELECT"],
  suppliers: ["SELECT", "INSERT", "UPDATE"],
  documents: ["SELECT", "INSERT", "UPDATE"],
  meta: ["SELECT", "INSERT", "UPDATE"],
  bookings: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  decisions: ["SELECT", "INSERT"],
  reviews: ["SELECT", "INSERT"],
  exports: ["SELECT", "INSERT"],
  login_attempts: ["SELECT", "INSERT", "DELETE"],
};
const ALL = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

describe("Laufzeitrolle der App", () => {
  it("hat für jede Tabelle genau die festgelegten Rechte, nicht mehr", async () => {
    const { client } = await createTestDb({ as: "owner" });
    const tables = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const names = tables.rows.map((r) => r.table_name);
    expect(names.sort()).toEqual(Object.keys(RIGHTS).sort());
    for (const table of names) {
      const granted: string[] = [];
      for (const right of ALL) {
        const res = await client.query<{ ok: boolean }>(
          "select has_table_privilege('belegpruefer_app', $1, $2) as ok",
          [`public.${table}`, right],
        );
        if (res.rows[0]?.ok) granted.push(right);
      }
      expect(granted, table).toEqual(RIGHTS[table]);
    }
  });

  it("besitzt keine Tabelle und kann sich nicht zum Eigentümer machen", async () => {
    const { client } = await createTestDb({ as: "owner" });
    const res = await client.query<{ owned: number; super: boolean; createrole: boolean }>(`
      select (select count(*)::int from pg_tables where tableowner = 'belegpruefer_app') as owned,
             rolsuper as super, rolcreaterole as createrole
      from pg_roles where rolname = 'belegpruefer_app'`);
    expect(res.rows[0]).toEqual({ owned: 0, super: false, createrole: false });
  });

  // With stolen app credentials an attacker gets exactly this role. None of these may work.
  it.each([
    ["Trigger abschalten", "alter table decisions disable trigger user"],
    ["Tabelle ändern", "alter table decisions add column x text"],
    ["Protokoll leeren", "truncate decisions"],
    ["Protokoll ändern", "update decisions set model = 'x'"],
    ["Protokoll löschen", "delete from decisions"],
    ["Reviews ändern", "update reviews set user_label = 'x'"],
    ["Export löschen", "delete from exports"],
    ["Mandant anlegen", "insert into tenants (name, berater_nr, mandanten_nr) values ('X', 1, 2)"],
    ["Migrationen lesen", "select * from drizzle.__drizzle_migrations"],
  ])("verweigert: %s", async (_, statement) => {
    const { db } = await createTestDb();
    expect(await dbRefusal(db.execute(sql.raw(statement)))).toMatch(/permission denied|must be owner/);
  });
});
