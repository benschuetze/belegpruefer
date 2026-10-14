import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

/** Every driver (neon-serverless, node-postgres, PGlite) fits this, so app code never cares which one runs. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** What a db.transaction callback receives; functions that must run inside one take this. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let db: Db | undefined;

export function createDb(url: string): Db {
  // Neon over WebSocket, not neon-http: processing a document writes status, protocol and bookings in one
  // interactive transaction, and the HTTP driver cannot hold a transaction open across statements.
  const pool = new URL(url).hostname.endsWith(".neon.tech")
    ? new NeonPool({ connectionString: url, max: 5 })
    : // PGlite behind a socket (local dev, local E2E) serves every connection from one backend, so parallel
      // transactions get mixed up there ("unnamed prepared statement does not exist"). It gets one connection.
      new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX) || 10 });
  // An idle connection the server closes emits "error" on the pool; unhandled, that ends the whole process.
  // The next query simply opens a new connection.
  pool.on("error", (error: Error) => console.error(`Datenbankverbindung geschlossen: ${error.message}`));
  return pool instanceof NeonPool
    ? (drizzleNeon(pool, { schema }) as unknown as Db)
    : (drizzleNodePg(pool, { schema }) as unknown as Db);
}

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL fehlt");
    db = createDb(url);
  }
  return db;
}

/** Tests inject a PGlite database. */
export function setDb(next: Db): void {
  db = next;
}
