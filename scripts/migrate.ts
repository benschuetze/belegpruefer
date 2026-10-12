import "dotenv/config";

import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL fehlt");
const migrationsFolder = "drizzle";

if (new URL(url).hostname.endsWith(".neon.tech")) {
  const pool = new NeonPool({ connectionString: url });
  await migrateNeon(drizzleNeon(pool), { migrationsFolder });
  await pool.end();
} else {
  const pool = new pg.Pool({ connectionString: url });
  await migrateNodePg(drizzleNodePg(pool), { migrationsFolder });
  await pool.end();
}
console.log("Migrationen angewendet");
