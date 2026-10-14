import "dotenv/config";
import { randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { createDb } from "~/lib/db/client";

/**
 * Creates (or rotates the password of) the login role the app connects with. It only inherits the row rights of
 * belegpruefer_app from migration 0005; the password stays out of migrations and Git. Prints the new connection
 * string once, for DATABASE_URL in the deployment.
 */
const ownerUrl = process.env.MIGRATION_DATABASE_URL;
if (!ownerUrl) throw new Error("MIGRATION_DATABASE_URL fehlt (Eigentümer-Zugang)");
const LOGIN = "belegpruefer_web";
const password = randomBytes(24).toString("base64url");

const db = createDb(ownerUrl);
const rows = async <T>(query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows;
const [{ n: exists } = { n: 0 }] = await rows<{ n: number }>(
  sql`select count(*)::int as n from pg_roles where rolname = ${LOGIN}`,
);
// format(%L) quotes the password as a literal; CREATE ROLE takes no bind parameters.
const statement = exists
  ? sql`select format('alter role %I with login password %L', ${LOGIN}::text, ${password}::text) as q`
  : sql`select format('create role %I with login password %L in role belegpruefer_app', ${LOGIN}::text, ${password}::text) as q`;
const [row] = await rows<{ q: string }>(statement);
if (!row) throw new Error("format() lieferte nichts");
await db.execute(sql.raw(row.q));
await db.execute(sql`grant belegpruefer_app to ${sql.identifier(LOGIN)}`);

const url = new URL(ownerUrl);
url.username = LOGIN;
url.password = password;
console.log(`Rolle ${LOGIN} ${exists ? "neues Passwort gesetzt" : "angelegt"}. DATABASE_URL für die App:`);
console.log(url.toString());
process.exit(0);
