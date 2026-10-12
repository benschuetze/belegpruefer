import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "~/lib/db/client";
import * as schema from "~/lib/db/schema";
import { seed } from "~/lib/db/seed";

/** Fresh in-memory Postgres with all migrations, no network. */
export async function createTestDb({ seeded = true } = {}): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  if (seeded) await seed(db as unknown as Db);
  return { db: db as unknown as Db, client };
}
