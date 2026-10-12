import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/helpers/db";
import { DEMO_TENANTS } from "./seed";

describe("Migrationen und Seed", () => {
  it("laufen auf leerer Datenbank durch und legen beide Demo-Mandanten an", async () => {
    const { db } = await createTestDb();
    const rows = await db.execute(sql`select name from tenants order by mandanten_nr`);
    expect((rows as unknown as { rows: { name: string }[] }).rows.map((r) => r.name)).toEqual(
      DEMO_TENANTS.map((t) => t.name),
    );
  });

  it("jeder Index einer Mandantentabelle beginnt mit tenant_id", async () => {
    const { db } = await createTestDb({ seeded: false });
    const result = await db.execute(sql`
      select tablename, indexdef from pg_indexes
      where schemaname = 'public' and indexname not like '%_pkey'
        and tablename not in ('meta', 'login_attempts', 'tenants')`);
    const rows = (result as unknown as { rows: { tablename: string; indexdef: string }[] }).rows;
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.indexdef, row.tablename).toMatch(/\(tenant_id[,)]/);
    }
  });
});
