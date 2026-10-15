import "dotenv/config";
import { type SQL, sql } from "drizzle-orm";
import { APP_LOGIN, createDb, runtimeDatabaseUrl } from "~/lib/db/client";

/**
 * Creates the login role the app connects with, or sets its password to APP_DB_PASSWORD again. Runs in every
 * production build right after the migrations (as owner, DATABASE_URL), so rotating the secret in Vercel and
 * redeploying is all it takes. The role only inherits the rights of belegpruefer_app from migration 0005. Prints
 * no secret.
 */
const ownerUrl = process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;
if (!ownerUrl) throw new Error("DATABASE_URL fehlt (Eigentümer-Zugang)");
if (!password) {
  console.log("APP_DB_PASSWORD nicht gesetzt: keine eigene Login-Rolle, die App nutzt DATABASE_URL.");
  process.exit(0);
}
runtimeDatabaseUrl(); // checks the length before anything is created

const db = createDb(ownerUrl);
const rows = async <T>(query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows;
const [{ n: exists } = { n: 0 }] = await rows<{ n: number }>(
  sql`select count(*)::int as n from pg_roles where rolname = ${APP_LOGIN}`,
);
// format(%L) quotes the password as a literal; CREATE ROLE takes no bind parameters.
const statement = exists
  ? sql`select format('alter role %I with login password %L', ${APP_LOGIN}::text, ${password}::text) as q`
  : sql`select format('create role %I with login password %L in role belegpruefer_app', ${APP_LOGIN}::text, ${password}::text) as q`;
const [row] = await rows<{ q: string }>(statement);
if (!row) throw new Error("format() lieferte nichts");
await db.execute(sql.raw(row.q));
await db.execute(sql`grant belegpruefer_app to ${sql.identifier(APP_LOGIN)}`);

// An existing role may carry more than it should (from an earlier hand-made setup): refuse instead of trusting it.
const [attrs] = await rows<{ extra: boolean; others: string[] }>(sql`
  select (r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolbypassrls or r.rolreplication or not r.rolinherit)
           as extra,
         array(select g.rolname::text from pg_auth_members m join pg_roles g on g.oid = m.roleid
               where m.member = r.oid and g.rolname <> 'belegpruefer_app') as others
  from pg_roles r where r.rolname = ${APP_LOGIN}`);
if (attrs?.extra || (attrs?.others.length ?? 0) > 0) {
  throw new Error(
    `${APP_LOGIN} hat mehr Rechte als vorgesehen (Attribute oder Mitgliedschaft in ${attrs?.others.join(", ")}). ` +
      "Von Hand bereinigen, dann erneut ausführen.",
  );
}
console.log(`Login-Rolle ${APP_LOGIN} ${exists ? "aktualisiert" : "angelegt"}.`);
process.exit(0);
