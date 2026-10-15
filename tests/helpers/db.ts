import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "~/lib/db/client";
import * as schema from "~/lib/db/schema";
import { seed } from "~/lib/db/seed";

/**
 * Fresh in-memory Postgres with all migrations, no network. Tests run as the runtime role the app uses in
 * production, so a missing grant fails here. `as: "owner"` is for what only migrations, seed and demo reset do.
 */
export async function createTestDb({
  seeded = true,
  as = "app",
}: {
  seeded?: boolean;
  as?: "app" | "owner";
} = {}): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  if (seeded) await seed(db as unknown as Db);
  if (as === "app") await client.exec("set role belegpruefer_app");
  return { db: db as unknown as Db, client };
}

/** The database's own message for a refused statement; Drizzle wraps it as "Failed query: …" with the cause inside. */
export async function dbRefusal(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(error);
  }
  throw new Error("Die Datenbank hat die Anweisung ausgeführt statt sie abzulehnen.");
}
