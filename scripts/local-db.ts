/**
 * Postgres without installing Postgres: PGlite behind a socket, so the app talks to it like a normal server.
 * Dev: `pnpm db:local` (persistent in .pglite/). E2E: `--memory --port 5434` for a clean start each run.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "~/lib/db/client";
import { loadDemoData } from "~/lib/db/demo-data";
import * as schema from "~/lib/db/schema";
import { seed } from "~/lib/db/seed";

const args = process.argv.slice(2);
const memory = args.includes("--memory");
const portArg = args.indexOf("--port");
const port = portArg >= 0 ? Number(args[portArg + 1]) : 5433;

const client = await PGlite.create(memory ? undefined : ".pglite");
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: "drizzle" });
await seed(db as unknown as Db);
// Development starts with the invented invoices; E2E runs (--memory) load what each test needs itself.
if (!memory) await loadDemoData(db as unknown as Db);

const server = new PGLiteSocketServer({ db: client, port, host: "127.0.0.1", maxConnections: 20 });
await server.start();
console.log(`Lokale Datenbank läuft: postgres://postgres@127.0.0.1:${port}/postgres${memory ? " (im Speicher)" : ""}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await server.stop();
    await client.close();
    process.exit(0);
  });
}
