-- The app does not run as the owner of its tables. The owner could switch the protocol triggers off
-- (ALTER TABLE ... DISABLE TRIGGER) or TRUNCATE; with stolen app credentials, "append-only" would then be a promise
-- the database cannot keep. Migrations and the demo reset run as the owner; the app connects as a login role that
-- is a member of belegpruefer_app and gets exactly the row rights below. No ALTER, no TRUNCATE, no ownership.
-- The login role itself carries a password and is created outside of migrations: scripts/create-app-login.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'belegpruefer_app') THEN
    CREATE ROLE belegpruefer_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO belegpruefer_app;
--> statement-breakpoint
-- Postgres 15 and later already deny this by default; stated so it holds on any version: no new tables, no
-- functions or triggers of the runtime role's own.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
-- Tenants are created by the seed, not by the app.
GRANT SELECT ON tenants TO belegpruefer_app;
--> statement-breakpoint
-- UPDATE only on the columns the code writes. File, hash, tenant and name of a document stay as uploaded.
GRANT SELECT, INSERT ON documents TO belegpruefer_app;
--> statement-breakpoint
GRANT UPDATE (status, extracted_jsonb, findings_jsonb, error) ON documents TO belegpruefer_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON suppliers TO belegpruefer_app;
--> statement-breakpoint
GRANT UPDATE (ust_id, profile_jsonb, profile_source) ON suppliers TO belegpruefer_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON meta TO belegpruefer_app;
--> statement-breakpoint
GRANT UPDATE (value) ON meta TO belegpruefer_app;
--> statement-breakpoint
-- Unlocked bookings are replaced when a document is confirmed; locking sets locked_at. The trigger keeps locked
-- bookings final.
GRANT SELECT, INSERT, DELETE ON bookings TO belegpruefer_app;
--> statement-breakpoint
GRANT UPDATE (locked_at) ON bookings TO belegpruefer_app;
--> statement-breakpoint
-- Protocol and exports: written once, never changed. Without UPDATE and DELETE the role cannot even try.
GRANT SELECT, INSERT ON decisions, reviews, exports TO belegpruefer_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON login_attempts TO belegpruefer_app;
