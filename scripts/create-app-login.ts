import "dotenv/config";
import { randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { createDb } from "~/lib/db/client";

/**
 * Run by hand, never in CI: it prints a connection string with the password. Creates (or rotates the password of)
 * the login role the app connects with. It only inherits the row rights of
 * belegpruefer_app from migration 0005; the password stays out of migrations and Git. Prints the new connection
 * string once, for APP_DATABASE_URL in the deployment.
 */
const ownerUrl = process.env.DATABASE_URL;
if (!ownerUrl) throw new Error("DATABASE_URL fehlt (Eigentümer-Zugang)");
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

// An existing role may carry more than it should (from an earlier hand-made setup): refuse instead of trusting it.
const [attrs] = await rows<{ extra: boolean; others: string[] }>(sql`
  select (r.rolsuper or r.rolcreaterole or r.rolcreatedb or r.rolbypassrls or r.rolreplication or not r.rolinherit)
           as extra,
         array(select g.rolname::text from pg_auth_members m join pg_roles g on g.oid = m.roleid
               where m.member = r.oid and g.rolname <> 'belegpruefer_app') as others
  from pg_roles r where r.rolname = ${LOGIN}`);
if (attrs?.extra || (attrs?.others.length ?? 0) > 0) {
  throw new Error(
    `${LOGIN} hat mehr Rechte als vorgesehen (Attribute oder Mitgliedschaft in ${attrs?.others.join(", ")}). ` +
      "Von Hand bereinigen, dann erneut ausführen.",
  );
}

const url = new URL(ownerUrl);
url.username = LOGIN;
url.password = password;
console.log(`Rolle ${LOGIN} ${exists ? "neues Passwort gesetzt" : "angelegt"}. APP_DATABASE_URL für die App:`);
console.log(url.toString());
process.exit(0);
