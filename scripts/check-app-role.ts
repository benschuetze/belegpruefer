import "dotenv/config";
import { type SQL, sql } from "drizzle-orm";
import { createDb, runtimeDatabaseUrl } from "~/lib/db/client";

/**
 * Runs in the production build after the migrations. Without it, a missing APP_DB_PASSWORD would silently fall
 * back to the owner and "append-only" would again depend on nobody stealing the app's credentials. Fails the
 * build (the old deployment stays live) unless the app's connection is the restricted runtime role.
 */
const production = process.env.VERCEL_ENV === "production";
if (!process.env.APP_DB_PASSWORD) {
  if (production) {
    console.error("APP_DB_PASSWORD fehlt: Die App würde als Eigentümer der Tabellen laufen.");
    process.exit(1);
  }
  console.log("APP_DB_PASSWORD nicht gesetzt, außerhalb der Produktion erlaubt (App nutzt DATABASE_URL).");
  process.exit(0);
}
const url = runtimeDatabaseUrl() ?? "";

const db = createDb(url);
const rows = async <T>(query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows;
const [me] = await rows<{
  user: string;
  member: boolean;
  owner: boolean;
  superuser: boolean;
  createrole: boolean;
  update_protocol: boolean;
}>(sql`
  select current_user as user,
         pg_has_role(current_user, 'belegpruefer_app', 'MEMBER') as member,
         exists (select 1 from pg_tables where schemaname = 'public'
                 and pg_has_role(current_user, tableowner, 'MEMBER')) as owner,
         r.rolsuper as superuser, r.rolcreaterole as createrole,
         has_table_privilege('public.decisions', 'UPDATE') as update_protocol
  from pg_roles r where r.rolname = current_user`);
const problems = [
  !me?.member && "ist kein Mitglied von belegpruefer_app",
  me?.owner && "besitzt Tabellen (oder ist Mitglied des Eigentümers)",
  me?.superuser && "ist Superuser",
  me?.createrole && "darf Rollen anlegen",
  me?.update_protocol && "darf das Protokoll ändern",
].filter(Boolean);
if (problems.length > 0) {
  console.error(`App-Verbindung (${me?.user}) ${problems.join(", ")}.`);
  process.exit(1);
}
console.log(`App-Verbindung geprüft: ${me?.user}, nur Zeilenrechte.`);
process.exit(0);
