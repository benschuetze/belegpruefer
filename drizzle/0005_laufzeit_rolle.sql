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
-- Tenants are created by the seed, not by the app.
GRANT SELECT ON tenants TO belegpruefer_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON suppliers, documents, meta TO belegpruefer_app;
--> statement-breakpoint
-- Unlocked bookings are replaced when a document is confirmed; the trigger keeps locked ones final.
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO belegpruefer_app;
--> statement-breakpoint
-- Protocol and exports: written once, never changed. Without UPDATE and DELETE the role cannot even try.
GRANT SELECT, INSERT ON decisions, reviews, exports TO belegpruefer_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON login_attempts TO belegpruefer_app;
